/**
 * The AbstractFlow server (bin/server.js) on the app-server kit, against a
 * fake gateway on loopback and a scratch dist/:
 *  - served at / (standalone) and under /apps/flow/ (X-Forwarded-Prefix from
 *    a loopback peer, as the gateway sends it): <base href>, base_path,
 *    the identity header on every response, assets, SPA fallback;
 *  - sign-in cookies at Path=<base path>/, the first cookie value wins;
 *  - every gateway-bound request carries X-Forwarded-For = the BROWSER's
 *    address (the gateway's forwarded one behind /apps/flow/) and
 *    X-AbstractFramework-App-Proxy: abstractflow, client spoofs dropped;
 *  - a browser-chosen gateway URL is refused for a remote browser, even one
 *    reaching the server through the gateway's loopback proxy.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFlowServer } from '../bin/server.js';

const REMOTE = '203.0.113.50';
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>AbstractFlow test</title>' +
  '<script type="module" crossorigin src="./assets/app.js"></script></head><body><div id="root"></div></body></html>';

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
    xfPrefix: req.headers['x-forwarded-prefix'] ?? null,
    session: req.headers['x-abstractgateway-session'] ?? null,
    cookie: req.headers.cookie ?? null,
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
      const path = req.url.split('?')[0];
      if (path === '/api/gateway/me') {
        const sess = req.headers['x-abstractgateway-session'];
        if (sess !== 'sess-mount' && sess !== 'sess-root') return send(401, { detail: 'unauthorized' });
        return send(200, { principal: { user_id: 'admin', source: 'user-registry' }, auth: { mode: 'users', user_auth_enabled: true } });
      }
      if (path === '/api/gateway/session/login' && req.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (body.token !== 'good-token') return send(401, { detail: 'Invalid Gateway user token' });
        return send(
          200,
          { ok: true, principal: { user_id: 'admin', source: 'user-registry' }, auth: { mode: 'users', user_auth_enabled: true } },
          { 'Set-Cookie': ['abstractgateway_session=sess-mount; Path=/; HttpOnly', 'abstractgateway_csrf=csrf-1; Path=/'] }
        );
      }
      if (path === '/api/gateway/session/logout') return send(200, { ok: true });
      if (path === '/api/gateway/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: one\n\n');
        setTimeout(() => {
          res.write('data: two\n\n');
          res.end();
        }, 50);
        return;
      }
      if (path.startsWith('/api/gateway/echo')) return send(200, { ok: true, method: req.method });
      send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
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

/** What the gateway's /apps/flow/ proxy sends the app for a remote browser. */
const MOUNTED = { 'X-Forwarded-Prefix': '/apps/flow', 'X-Forwarded-For': REMOTE, 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'gw.example:8080' };

let gateway;
let gatewayUrl;
let flow;
let port;
let dist;
let scratch;
const savedEnv = {};

beforeAll(async () => {
  // The kit honours these switches; the test must not inherit an operator's.
  for (const k of Object.keys(process.env)) {
    if (/^ABSTRACT(FLOW|GATEWAY)_(ALLOW|TRUST)_/.test(k)) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  gateway = await startFakeGateway();
  gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
  scratch = mkdtempSync(join(tmpdir(), 'abstractflow-dist-'));
  writeFileSync(join(scratch, 'secret.txt'), 'SECRET');
  dist = join(scratch, 'www');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), PAGE);
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("flow app");\n');
  flow = createFlowServer({ distDir: dist, gatewayUrl });
  port = await listen(flow);
});

afterAll(async () => {
  await new Promise((resolve) => flow?.close(() => resolve()));
  await new Promise((resolve) => gateway?.close(() => resolve()));
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  Object.assign(process.env, savedEnv);
});

describe('AbstractFlow server: standalone at / and mounted at /apps/flow/', () => {
  it('refuses to start without a built editor', () => {
    expect(() => createFlowServer({ distDir: join(dist, 'nope'), gatewayUrl })).toThrow(/built editor is missing/);
  });

  it('standalone: the page gets <base href="/"> and base_path ""', async () => {
    const r = await request(port, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<head><base href="/">');
    expect(r.text).toContain('"base_path":""');
    expect(r.text).toContain(`"gateway_url":"${gatewayUrl}"`);
    expect(r.headers['x-abstractframework-app']).toBe('flow; mount=1');
  });

  it('mounted: the page gets <base href="/apps/flow/"> and base_path "/apps/flow"', async () => {
    const r = await request(port, 'GET', '/', { headers: MOUNTED });
    expect(r.status).toBe(200);
    expect(r.text).toContain('<head><base href="/apps/flow/">');
    expect(r.text).toContain('"base_path":"/apps/flow"');
    expect(r.text).toContain('src="./assets/app.js"');
  });

  it('mounted: an editor route is the page (SPA fallback), with the base', async () => {
    const r = await request(port, 'GET', '/flows/abc', { headers: MOUNTED });
    expect(r.status).toBe(200);
    expect(r.text).toContain('<base href="/apps/flow/">');
  });

  it('assets are served, a missing asset is a 404 (never the page), traversal never escapes dist', async () => {
    const a = await request(port, 'GET', '/assets/app.js', { headers: MOUNTED });
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toContain('application/javascript');
    expect(a.text).toContain('flow app');
    expect(a.headers['x-abstractframework-app']).toBe('flow; mount=1');
    const missing = await request(port, 'GET', '/assets/gone.js');
    expect(missing.status).toBe(404);
    // A file beside dist/ is never served, however the path is spelled.
    for (const path of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const r = await request(port, 'GET', path);
      expect(r.text, path).not.toContain('SECRET');
    }
  });

  it('health carries the identity header and the base path', async () => {
    const r = await request(port, 'GET', '/api/health', { headers: MOUNTED });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, service: 'abstractflow', gateway_url: gatewayUrl, base_path: '/apps/flow' });
    expect(r.headers['x-abstractframework-app']).toBe('flow; mount=1');
  });

  it('a malformed X-Forwarded-Prefix from a loopback peer is refused (400), identity header still set', async () => {
    const r = await request(port, 'GET', '/', { headers: { 'X-Forwarded-Prefix': '/apps/../etc' } });
    expect(r.status).toBe(400);
    expect(r.headers['x-abstractframework-app']).toBe('flow; mount=1');
  });

  it('a WebSocket upgrade is refused', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/gateway/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
      req.on('upgrade', () => reject(new Error('upgraded')));
      req.on('response', (res) => resolve(res.statusCode));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });
});

describe('AbstractFlow server: gateway sign-in through the kit session proxy', () => {
  let mountCookie = '';

  it('mounted sign-in: cookies at Path=/apps/flow/, the gateway sees the REMOTE browser', async () => {
    seen.clear();
    const r = await request(port, 'POST', '/api/connection/gateway', {
      headers: { ...MOUNTED, 'X-Real-IP': '198.51.100.9', Forwarded: 'for=198.51.100.9', 'X-AbstractFramework-App-Proxy': 'assistant' },
      body: { gateway_user_id: 'admin', gateway_token: 'good-token', persist: true },
    });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ ok: true, has_session: true, gateway_url: gatewayUrl });
    const cookies = r.headers['set-cookie'] || [];
    expect(cookies).toHaveLength(3);
    for (const c of cookies) expect(c).toContain('Path=/apps/flow/');
    expect(cookies.join(' | ')).toContain('abstractflow_gateway_session=sess-mount');
    expect(seen.get('/api/gateway/session/login')).toMatchObject({ xff: REMOTE, xffCount: 1, marker: 'abstractflow', markerCount: 1, forwarded: null, xRealIp: null, xfPrefix: null });
    mountCookie = cookies.map((c) => c.split(';', 1)[0]).join('; ');
  });

  it('standalone sign-in: cookies at Path=/', async () => {
    const r = await request(port, 'POST', '/api/connection/gateway', { body: { gateway_user_id: 'admin', gateway_token: 'good-token' } });
    expect(r.status, r.text).toBe(200);
    for (const c of r.headers['set-cookie'] || []) expect(c).toContain('Path=/;');
  });

  it('a wrong token is refused with the gateway reason', async () => {
    const r = await request(port, 'POST', '/api/connection/gateway', { headers: MOUNTED, body: { gateway_user_id: 'admin', gateway_token: 'bad' } });
    expect(r.status).toBe(401);
    expect(r.json.detail).toBe('Invalid Gateway user token');
  });

  it('status probe: signed in, the gateway sees the remote browser', async () => {
    seen.clear();
    const r = await request(port, 'GET', '/api/connection/gateway', { headers: { ...MOUNTED, Cookie: mountCookie } });
    expect(r.json).toMatchObject({ ok: true, has_session: true, gateway: { principal: { user_id: 'admin' } } });
    expect(seen.get('/api/gateway/me')).toMatchObject({ xff: REMOTE, marker: 'abstractflow', session: 'sess-mount' });
  });

  it('first cookie wins: the /apps/flow/ session beats a Path=/ twin sent after it', async () => {
    seen.clear();
    const twins = `${mountCookie}; abstractflow_gateway_session=sess-root; abstractflow_gateway_csrf=csrf-root`;
    await request(port, 'GET', '/api/gateway/echo', { headers: { ...MOUNTED, Cookie: twins } });
    expect(seen.get('/api/gateway/echo').session).toBe('sess-mount');
  });

  it('proxied calls: browser cookies never reach the gateway; writes need the CSRF twin', async () => {
    seen.clear();
    const get = await request(port, 'GET', '/api/gateway/echo', { headers: { ...MOUNTED, Cookie: mountCookie, 'X-Forwarded-For': '10.9.9.9' } });
    expect(get.status).toBe(200);
    expect(seen.get('/api/gateway/echo')).toMatchObject({ xff: '10.9.9.9', xffCount: 1, cookie: null, marker: 'abstractflow' });
    const noCsrf = await request(port, 'POST', '/api/gateway/echo', { headers: { ...MOUNTED, Cookie: mountCookie }, body: {} });
    expect(noCsrf.status).toBe(403);
    const withCsrf = await request(port, 'POST', '/api/gateway/echo', { headers: { ...MOUNTED, Cookie: mountCookie, 'x-abstractflow-csrf': 'csrf-1' }, body: {} });
    expect(withCsrf.status).toBe(200);
  });

  it('live stream (SSE) streams through', async () => {
    const r = await request(port, 'GET', '/api/gateway/stream', { headers: { ...MOUNTED, Cookie: mountCookie } });
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.text).toContain('data: one');
    expect(r.text).toContain('data: two');
  });

  it('a browser-chosen gateway URL: refused for a remote browser behind the gateway, allowed on this machine', async () => {
    const other = { gateway_url: 'http://127.0.0.1:9', gateway_user_id: 'admin', gateway_token: 'good-token' };
    const remote = await request(port, 'POST', '/api/connection/gateway', { headers: MOUNTED, body: other });
    expect(remote.status).toBe(403);
    // Same machine (no forwarding): allowed to try — port 9 is dead, so the attempt itself fails.
    const local = await request(port, 'POST', '/api/connection/gateway', { body: other });
    expect(local.status).not.toBe(403);
  });

  it('mounted sign-out clears both the /apps/flow/ cookies and their Path=/ twins', async () => {
    seen.clear();
    const r = await request(port, 'DELETE', '/api/connection/gateway', { headers: { ...MOUNTED, Cookie: mountCookie } });
    expect(r.status).toBe(200);
    const cookies = r.headers['set-cookie'] || [];
    expect(cookies.filter((c) => c.includes('Path=/apps/flow/'))).toHaveLength(3);
    expect(cookies.filter((c) => c.includes('Path=/;'))).toHaveLength(3);
    expect(seen.get('/api/gateway/session/logout')).toMatchObject({ xff: REMOTE, marker: 'abstractflow', session: 'sess-mount' });
  });
});
