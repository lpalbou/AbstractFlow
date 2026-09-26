/**
 * The AbstractFlow server (bin/cli.js) against a fake gateway on loopback:
 * every gateway-bound request — status probe, sign-in (token check + login),
 * sign-out, proxied /api/* calls, live streams (SSE) and WebSocket upgrades —
 * carries X-Forwarded-For = the browser's socket peer (overwritten, never
 * appended) and X-AbstractFramework-App-Proxy: abstractflow (client value
 * dropped). Same rules as @abstractframework/app-server.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyGatewayForwarding,
  gatewayForwardingHeaders,
  socketPeerAddress,
} from '../bin/gateway_forwarding.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

/** What the fake gateway saw, keyed by path (last request wins). */
const seen = new Map();

function record(req) {
  const names = req.rawHeaders.filter((_, i) => i % 2 === 0).map((h) => h.toLowerCase());
  seen.set(req.url.split('?')[0], {
    xff: req.headers['x-forwarded-for'] ?? null,
    xffCount: names.filter((h) => h === 'x-forwarded-for').length,
    marker: req.headers['x-abstractframework-app-proxy'] ?? null,
    markerCount: names.filter((h) => h === 'x-abstractframework-app-proxy').length,
    forwarded: req.headers.forwarded ?? null,
    xRealIp: req.headers['x-real-ip'] ?? null,
    xfHost: req.headers['x-forwarded-host'] ?? null,
    xfProto: req.headers['x-forwarded-proto'] ?? null,
    session: req.headers['x-abstractgateway-session'] ?? null,
  });
}

function startFakeGateway() {
  const server = http.createServer((req, res) => {
    record(req);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const send = (status, obj, headers) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...(headers || {}) });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/gateway/me') {
        const bearer = req.headers.authorization === 'Bearer good-token';
        const session = req.headers['x-abstractgateway-session'] === 'sess-1';
        if (!bearer && !session) return send(401, { detail: 'unauthorized' });
        return send(200, { principal: { user_id: 'admin', source: 'user-token' }, auth: { mode: 'user', user_auth_enabled: true } });
      }
      if (req.url === '/api/gateway/session/login' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (body.token !== 'good-token') return send(401, { detail: 'bad token' });
        return send(
          200,
          { session: { session_id: 'sess-1', csrf_token: 'csrf-1' } },
          { 'Set-Cookie': ['abstractgateway_session=sess-1; Path=/; HttpOnly', 'abstractgateway_csrf=csrf-1; Path=/'] }
        );
      }
      if (req.url === '/api/gateway/session/logout') return send(200, { ok: true });
      if (req.url === '/api/gateway/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: one\n\n');
        setTimeout(() => {
          res.write('data: two\n\n');
          res.end();
        }, 50);
        return;
      }
      if (req.url.startsWith('/api/gateway/echo')) return send(200, { ok: true });
      send(404, { detail: 'not found' });
    });
  });
  server.on('upgrade', (req, socket) => {
    record(req);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Raw request so header names, letter case and duplicates reach the server as written. */
function request(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: { ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': String(raw.length) } : {}), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
}

/** Client-supplied forwarding headers in assorted letter cases, duplicates included. */
const SPOOFED = {
  'X-FORWARDED-FOR': ['203.0.113.9', '198.51.100.4'],
  'x-Forwarded-Host': 'evil.example',
  'X-Forwarded-Proto': 'http',
  FORWARDED: 'for=203.0.113.9',
  'x-real-ip': '203.0.113.9',
  'X-ABSTRACTFRAMEWORK-APP-PROXY': 'assistant',
};

function expectForwarded(path) {
  const got = seen.get(path);
  expect(got, `gateway never saw ${path}`).toBeTruthy();
  expect(got).toMatchObject({
    xff: '127.0.0.1',
    xffCount: 1,
    marker: 'abstractflow',
    markerCount: 1,
    forwarded: null,
    xRealIp: null,
    xfHost: null,
  });
}

let gateway;
let flow;
let flowPort;
let home;
let cookie = '';

beforeAll(async () => {
  gateway = await startFakeGateway();
  flowPort = await freePort();
  // A scratch HOME so the server never reads the operator's ~/.abstractflow.
  home = mkdtempSync(join(tmpdir(), 'abstractflow-cli-test-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ABSTRACTGATEWAY_URL;
  delete env.ABSTRACTFLOW_GATEWAY_URL;
  for (const k of Object.keys(env)) if (/^ABSTRACT(FLOW|GATEWAY)_(ALLOW|TRUST)_/.test(k)) delete env[k];
  flow = spawn(
    process.execPath,
    [CLI, '--host', '127.0.0.1', '--port', String(flowPort), '--gateway-url', `http://127.0.0.1:${gateway.address().port}`],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  flow.stderr.on('data', (c) => (stderr += c));
  flow.stdout.resume();
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const r = await request(flowPort, 'GET', '/api/health');
      if (r.status === 200) break;
    } catch {
      // not listening yet
    }
    if (flow.exitCode !== null || Date.now() > deadline) throw new Error(`abstractflow server did not start: ${stderr}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}, 15_000);

afterAll(async () => {
  flow?.kill('SIGTERM');
  await new Promise((resolve) => gateway?.close(() => resolve()));
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('AbstractFlow server: gateway forwarding identity', () => {
  it('sign-in: the token check and the login both carry the socket peer and the marker', async () => {
    seen.clear();
    const r = await request(flowPort, 'POST', '/api/connection/gateway', {
      headers: SPOOFED,
      body: { gateway_user_id: 'admin', gateway_token: 'good-token' },
    });
    expect(r.status, r.text).toBe(200);
    expectForwarded('/api/gateway/me');
    expectForwarded('/api/gateway/session/login');
    const setCookie = r.headers['set-cookie'] || [];
    cookie = setCookie.map((c) => c.split(';', 1)[0]).join('; ');
    expect(cookie).toContain('abstractflow_gateway_session=sess-1');
  });

  it('status probe carries the socket peer and the marker', async () => {
    seen.clear();
    const r = await request(flowPort, 'GET', '/api/connection/gateway', { headers: { ...SPOOFED, Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expectForwarded('/api/gateway/me');
  });

  it('proxied GET: client forwarding headers dropped in any case, XFF overwritten, marker set', async () => {
    seen.clear();
    const r = await request(flowPort, 'GET', '/api/gateway/echo', { headers: { ...SPOOFED, Cookie: cookie } });
    expect(r.status).toBe(200);
    expectForwarded('/api/gateway/echo');
    expect(seen.get('/api/gateway/echo').xfProto).toBeNull();
    expect(seen.get('/api/gateway/echo').session).toBe('sess-1');
  });

  it('proxied mutating call carries them too', async () => {
    seen.clear();
    const r = await request(flowPort, 'POST', '/api/gateway/echo', {
      headers: { ...SPOOFED, Cookie: cookie, 'x-abstractflow-csrf': 'csrf-1' },
      body: {},
    });
    expect(r.status).toBe(200);
    expectForwarded('/api/gateway/echo');
  });

  it('proxied call without client headers still carries XFF and the marker', async () => {
    seen.clear();
    await request(flowPort, 'GET', '/api/gateway/echo', { headers: { Cookie: cookie } });
    expectForwarded('/api/gateway/echo');
  });

  it('live stream (SSE) carries them and still streams', async () => {
    seen.clear();
    const r = await request(flowPort, 'GET', '/api/gateway/stream', { headers: { ...SPOOFED, Cookie: cookie } });
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.text).toContain('data: one');
    expect(r.text).toContain('data: two');
    expectForwarded('/api/gateway/stream');
  });

  it('WebSocket upgrade carries them', async () => {
    seen.clear();
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: flowPort,
        path: '/api/gateway/ws',
        headers: { ...SPOOFED, Cookie: cookie, Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        resolve();
      });
      req.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
    expectForwarded('/api/gateway/ws');
  });

  it('sign-out carries them', async () => {
    seen.clear();
    const r = await request(flowPort, 'DELETE', '/api/connection/gateway', { headers: { ...SPOOFED, Cookie: cookie } });
    expect(r.status).toBe(200);
    expectForwarded('/api/gateway/session/logout');
  });
});

describe('gateway_forwarding helpers', () => {
  it('socketPeerAddress reads the socket, unwraps IPv4-mapped IPv6, returns "" when unknown', () => {
    expect(socketPeerAddress({ socket: { remoteAddress: '::ffff:10.0.0.7' }, headers: { 'x-forwarded-for': '127.0.0.1' } })).toBe('10.0.0.7');
    expect(socketPeerAddress({ socket: { remoteAddress: '192.168.1.50' } })).toBe('192.168.1.50');
    expect(socketPeerAddress({ socket: { remoteAddress: 'FE80::1' } })).toBe('fe80::1');
    expect(socketPeerAddress({ socket: { remoteAddress: '::1' } })).toBe('::1');
    expect(socketPeerAddress({ socket: {}, headers: { 'x-forwarded-for': '127.0.0.1' } })).toBe('');
    expect(socketPeerAddress(undefined)).toBe('');
  });

  it('applyGatewayForwarding drops every client spelling and overwrites', () => {
    const headers = applyGatewayForwarding(
      { 'X-Forwarded-For': '127.0.0.1', 'x-forwarded-for': '::1', Forwarded: 'for=1.2.3.4', 'X-Real-IP': '1.2.3.4', 'X-Forwarded-Host': 'h', 'x-forwarded-proto': 'https', 'X-AbstractFramework-App-Proxy': 'assistant', accept: 'x' },
      '192.168.1.50'
    );
    expect(headers).toEqual({ accept: 'x', 'x-forwarded-for': '192.168.1.50', 'x-abstractframework-app-proxy': 'abstractflow' });
    expect(gatewayForwardingHeaders('10.0.0.7')).toEqual({ 'X-Forwarded-For': '10.0.0.7', 'X-AbstractFramework-App-Proxy': 'abstractflow' });
  });
});
