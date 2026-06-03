#!/usr/bin/env node

/**
 * CLI entry point for @abstractframework/flow
 * Serves the visual workflow editor on a configurable port.
 *
 * NOTE: The editor UI expects a gateway API at `/api/*`.
 * This CLI proxies `/api/*` (HTTP + SSE) to a configurable gateway URL.
 */

import * as http from 'http';
import * as https from 'https';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8080';

function normalizeGatewayUrl(value, fallback = '') {
  let raw = String(value || '').trim();
  for (let i = 0; i < 2 && raw; i += 1) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && parsed !== raw) {
        raw = parsed.trim();
        continue;
      }
    } catch {
      // Not a JSON string; continue with quote-pair cleanup below.
    }
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      raw = raw.slice(1, -1).trim();
      continue;
    }
    break;
  }
  raw = raw.replace(/\/+$/, '');
  return raw || fallback;
}

function connectionConfigPath() {
  return join(homedir() || '.', '.abstractflow', 'gateway_connection.json');
}

function readPersistedConnection() {
  try {
    const path = connectionConfigPath();
    if (!existsSync(path) || !statSync(path).isFile()) return {};
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const persisted = readPersistedConnection();
  const envUrl = normalizeGatewayUrl(process.env.ABSTRACTGATEWAY_URL || process.env.ABSTRACTFLOW_GATEWAY_URL || '');
  const out = {
    host: process.env.HOST || '0.0.0.0',
    port: Number.parseInt(String(process.env.PORT || '3003'), 10),
    gatewayUrl: envUrl || normalizeGatewayUrl(persisted.gateway_url || '') || DEFAULT_GATEWAY_URL,
  };

  const args = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const next = i + 1 < args.length ? args[i + 1] : undefined;

    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }

    if (a === '--host' && typeof next === 'string') {
      out.host = next;
      i += 1;
      continue;
    }
    if (a === '--port' && typeof next === 'string') {
      const p = Number.parseInt(next, 10);
      if (Number.isFinite(p) && p > 0) out.port = p;
      i += 1;
      continue;
    }
    if (a === '--gateway-url' && typeof next === 'string') {
      out.gatewayUrl = normalizeGatewayUrl(next);
      i += 1;
      continue;
    }
    if (a === '--gateway-token' && typeof next === 'string') {
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(out.port) || out.port <= 0) out.port = 3003;
  return out;
}

const OPTS = parseArgs(process.argv.slice(2));
const PORT = OPTS.port;
const HOST = OPTS.host;

if (OPTS.help) {
  console.log(`AbstractFlow Editor (static) — @abstractframework/flow

Usage:
  npx @abstractframework/flow [--port 3003] [--host 0.0.0.0] [--gateway-url http://127.0.0.1:8080]

Env vars:
  PORT, HOST
  ABSTRACTGATEWAY_URL (or ABSTRACTFLOW_GATEWAY_URL)

Notes:
  - Proxies /api/* to the gateway URL (HTTP + SSE).
  - Browser users sign in with Gateway URL + user + user token.
  - The user token is exchanged for an HTTP-only browser session and is not stored.
  - Start the gateway with: ABSTRACTGATEWAY_USER_AUTH=1 abstractgateway serve --host 127.0.0.1 --port 8080
`);
  process.exit(0);
}

const CONNECTION = {
  gatewayUrl: normalizeGatewayUrl(OPTS.gatewayUrl, DEFAULT_GATEWAY_URL),
};

const GATEWAY_SESSION_URL_COOKIE = 'abstractflow_gateway_url';
const GATEWAY_SESSION_ID_COOKIE = 'abstractflow_gateway_session';
const GATEWAY_SESSION_CSRF_COOKIE = 'abstractflow_gateway_csrf';
const GATEWAY_SESSION_TOKEN_COOKIE = 'abstractflow_gateway_token';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return Boolean(fallback);
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

function requestHostname(req) {
  const trustProxyHeaders = envBool('ABSTRACTFLOW_TRUST_PROXY_HEADERS') || envBool('ABSTRACTGATEWAY_TRUST_PROXY_HEADERS');
  const headerValue = trustProxyHeaders ? (req?.headers?.['x-forwarded-host'] || req?.headers?.host) : req?.headers?.host;
  const raw = String(headerValue || '').split(',', 1)[0].trim();
  if (!raw) return '';
  if (raw.startsWith('[')) return raw.slice(1).split(']', 1)[0].trim().toLowerCase();
  if ((raw.match(/:/g) || []).length === 1) return raw.split(':')[0].trim().toLowerCase();
  return raw.toLowerCase();
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  return h === 'localhost' || h === 'localhost.localdomain' || h === '::1' || h.startsWith('127.');
}

function browserGatewayConnectionConfigAllowed(req) {
  if (envBool('ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG')) return true;
  return isLoopbackHostname(requestHostname(req));
}

function browserGatewayConnectionConfigDenial(req) {
  const host = requestHostname(req) || 'unknown host';
  return (
    `Browser-supplied Gateway URL changes are disabled for this non-local Flow host (${host}). ` +
    'Use the server-configured Gateway URL, or set ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1 behind your own access control.'
  );
}

function resolveBackend(gatewayUrl = CONNECTION.gatewayUrl) {
  const backend = new URL(normalizeGatewayUrl(gatewayUrl, DEFAULT_GATEWAY_URL));
  if (!backend.port) {
    backend.port = backend.protocol === 'https:' ? '443' : '80';
  }
  return {
    url: backend,
    origin: `${backend.protocol}//${backend.host}`,
    client: backend.protocol === 'https:' ? https : http,
  };
}

// MIME types for common file extensions
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveFile(res, filePath) {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return false;
    }
    const content = readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch (err) {
    return false;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

function flowHealthPayload() {
  return {
    ok: true,
    status: 'healthy',
    service: 'abstractflow',
    mode: 'web',
    gateway_url: CONNECTION.gatewayUrl,
  };
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req?.headers?.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function browserSession(req) {
  const cookies = parseCookies(req);
  const cookieUrl = normalizeGatewayUrl(cookies[GATEWAY_SESSION_URL_COOKIE] || '');
  const token = String(cookies[GATEWAY_SESSION_ID_COOKIE] || '').trim();
  const csrfToken = String(cookies[GATEWAY_SESSION_CSRF_COOKIE] || '').trim();
  const allowCookieUrl =
    envBool('ABSTRACTFLOW_ALLOW_BROWSER_GATEWAY_URL_COOKIE') ||
    envBool('ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG') ||
    browserGatewayConnectionConfigAllowed(req);
  const gatewayUrl = cookieUrl && (allowCookieUrl || cookieUrl === CONNECTION.gatewayUrl) ? cookieUrl : CONNECTION.gatewayUrl;
  return { gatewayUrl, token, csrfToken, source: token ? 'browser-session' : 'none' };
}

function cookieValueFromSetCookie(rawHeaders, name) {
  const headers = Array.isArray(rawHeaders) ? rawHeaders : rawHeaders ? [rawHeaders] : [];
  for (const header of headers) {
    for (const candidate of String(header || '').split(/,(?=\s*[^;,=]+=)/)) {
      const first = candidate.split(';', 1)[0];
      const idx = first.indexOf('=');
      if (idx < 0) continue;
      if (first.slice(0, idx).trim() !== name) continue;
      const raw = first.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return '';
}

function cookieSecure(req) {
  return String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase() === 'https' ? '; Secure' : '';
}

function setSessionCookies(res, req, gatewayUrl, sessionId, csrfToken, persist) {
  const maxAge = persist ? '; Max-Age=2592000' : '';
  const secure = cookieSecure(req);
  const attrs = `; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge}`;
  const csrfAttrs = `; Path=/; SameSite=Lax${secure}${maxAge}`;
  res.setHeader('Set-Cookie', [
    `${GATEWAY_SESSION_URL_COOKIE}=${encodeURIComponent(normalizeGatewayUrl(gatewayUrl, CONNECTION.gatewayUrl))}${attrs}`,
    `${GATEWAY_SESSION_ID_COOKIE}=${encodeURIComponent(sessionId)}${attrs}`,
    `${GATEWAY_SESSION_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}${csrfAttrs}`,
    `${GATEWAY_SESSION_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}

function clearSessionCookies(res, req) {
  const secure = cookieSecure(req);
  res.setHeader('Set-Cookie', [
    `${GATEWAY_SESSION_URL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_ID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}

function mutatingMethod(method) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase());
}

function flowCsrfValid(req, session) {
  if (!mutatingMethod(req?.method)) return true;
  const expected = String(session?.csrfToken || '').trim();
  const presented = String(req?.headers?.['x-abstractflow-csrf'] || '').trim();
  return Boolean(expected && presented && expected === presented);
}

function userPrincipalError(gateway, expectedUser) {
  const principal = gateway && typeof gateway === 'object' ? gateway.principal : null;
  if (!expectedUser) return 'Gateway user is required';
  if (!principal || typeof principal !== 'object') return 'Gateway did not return a user principal; cannot validate hosted user login.';
  const actualUser = String(principal.user_id || '').trim();
  if (actualUser !== expectedUser) return `Gateway token resolved to user '${actualUser || 'unknown'}', not '${expectedUser}'.`;
  const auth = gateway && typeof gateway.auth === 'object' ? gateway.auth : {};
  const authMode = String(auth.mode || '').trim();
  if (authMode === 'legacy-token' || auth.user_auth_enabled === false || String(principal.source || '').trim() === 'legacy-token') {
    return 'Only Gateway user tokens can be used for browser sign-in.';
  }
  return null;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function isEventStreamResponse(headers) {
  const value = headers?.['content-type'] || headers?.['Content-Type'] || '';
  return String(Array.isArray(value) ? value.join(',') : value).toLowerCase().includes('text/event-stream');
}

function proxyResponseHeaders(headers, eventStream = false) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const k = String(key).toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(k) || k === 'content-length') continue;
    out[key] = value;
  }
  if (eventStream) {
    const keys = new Set(Object.keys(out).map((key) => key.toLowerCase()));
    if (!keys.has('cache-control')) out['Cache-Control'] = 'no-cache';
    if (!keys.has('x-accel-buffering')) out['X-Accel-Buffering'] = 'no';
  }
  return out;
}

function readRequestJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function checkGatewayConnection(gatewayUrl = CONNECTION.gatewayUrl, gatewayToken = '') {
  return new Promise((resolve) => {
    let backend;
    try {
      backend = resolveBackend(gatewayUrl);
    } catch (err) {
      resolve({ ok: false, error: `Invalid gateway URL: ${String(err?.message || err)}` });
      return;
    }
    const token = String(gatewayToken || '').trim();
    if (!token) {
      resolve({ ok: false, error: 'Gateway token missing' });
      return;
    }

    const req = backend.client.request(
      {
        protocol: backend.url.protocol,
        hostname: backend.url.hostname,
        port: backend.url.port,
        method: 'GET',
        path: '/api/gateway/me',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        timeout: 4000,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((resp.statusCode || 0) >= 200 && (resp.statusCode || 0) < 300) {
            let payload = {};
            try {
              payload = body ? JSON.parse(body) : {};
            } catch {
              payload = {};
            }
            resolve({
              ok: true,
              provider: 'gateway',
              model: 'principal',
              principal: payload && typeof payload === 'object' ? payload.principal : undefined,
              auth: payload && typeof payload === 'object' ? payload.auth : undefined,
              routing: payload && typeof payload === 'object' ? payload.routing : undefined,
            });
          } else {
            resolve({ ok: false, error: `HTTP ${resp.statusCode || 0}: ${body || resp.statusMessage || 'Gateway error'}` });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Gateway check timed out' });
    });
    req.on('error', (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.end();
  });
}

function checkGatewaySession(gatewayUrl = CONNECTION.gatewayUrl, sessionId = '') {
  return new Promise((resolve) => {
    let backend;
    try {
      backend = resolveBackend(gatewayUrl);
    } catch (err) {
      resolve({ ok: false, error: `Invalid gateway URL: ${String(err?.message || err)}` });
      return;
    }
    const session = String(sessionId || '').trim();
    if (!session) {
      resolve({ ok: false, error: 'Gateway sign-in required' });
      return;
    }

    const req = backend.client.request(
      {
        protocol: backend.url.protocol,
        hostname: backend.url.hostname,
        port: backend.url.port,
        method: 'GET',
        path: '/api/gateway/me',
        headers: {
          'X-AbstractGateway-Session': session,
          Accept: 'application/json',
        },
        timeout: 4000,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((resp.statusCode || 0) >= 200 && (resp.statusCode || 0) < 300) {
            let payload = {};
            try {
              payload = body ? JSON.parse(body) : {};
            } catch {
              payload = {};
            }
            resolve({
              ok: true,
              provider: 'gateway',
              model: 'principal',
              principal: payload && typeof payload === 'object' ? payload.principal : undefined,
              auth: payload && typeof payload === 'object' ? payload.auth : undefined,
              routing: payload && typeof payload === 'object' ? payload.routing : undefined,
            });
          } else {
            resolve({ ok: false, error: `HTTP ${resp.statusCode || 0}: ${body || resp.statusMessage || 'Gateway error'}` });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Gateway check timed out' });
    });
    req.on('error', (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.end();
  });
}

function createGatewayBrowserSession(gatewayUrl, userId, token, remember) {
  return new Promise((resolve) => {
    let backend;
    try {
      backend = resolveBackend(gatewayUrl);
    } catch (err) {
      resolve({ ok: false, error: `Invalid gateway URL: ${String(err?.message || err)}` });
      return;
    }
    const body = Buffer.from(
      JSON.stringify({
        user_id: String(userId || '').trim(),
        token: String(token || '').trim(),
        remember: Boolean(remember),
      }),
      'utf8'
    );
    const req = backend.client.request(
      {
        protocol: backend.url.protocol,
        hostname: backend.url.hostname,
        port: backend.url.port,
        method: 'POST',
        path: '/api/gateway/session/login',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
        },
        timeout: 4000,
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (chunk) => chunks.push(chunk));
        resp.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let payload = {};
          try {
            payload = text ? JSON.parse(text) : {};
          } catch {
            payload = {};
          }
          if ((resp.statusCode || 0) >= 200 && (resp.statusCode || 0) < 300) {
            const setCookie = resp.headers?.['set-cookie'];
            const session = payload && typeof payload.session === 'object' ? { ...payload.session } : {};
            const sessionId = cookieValueFromSetCookie(setCookie, 'abstractgateway_session') || String(session.session_id || '').trim();
            const csrfToken = cookieValueFromSetCookie(setCookie, 'abstractgateway_csrf') || String(session.csrf_token || '').trim();
            if (sessionId) session.session_id = sessionId;
            if (csrfToken) session.csrf_token = csrfToken;
            resolve({ ...payload, session, ok: true, gateway_url: backend.origin });
          } else {
            const detail = payload && typeof payload === 'object' ? payload.detail : '';
            resolve({ ok: false, error: `HTTP ${resp.statusCode || 0}: ${detail || text || resp.statusMessage || 'Gateway error'}` });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Gateway browser session request timed out' });
    });
    req.on('error', (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.write(body);
    req.end();
  });
}

function logoutGatewayBrowserSession(gatewayUrl, sessionId, csrfToken) {
  return new Promise((resolve) => {
    let backend;
    try {
      backend = resolveBackend(gatewayUrl);
    } catch {
      resolve({ ok: false });
      return;
    }
    const body = Buffer.from('{}', 'utf8');
    const req = backend.client.request(
      {
        protocol: backend.url.protocol,
        hostname: backend.url.hostname,
        port: backend.url.port,
        method: 'POST',
        path: '/api/gateway/session/logout',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
          'X-AbstractGateway-Session': String(sessionId || ''),
          'X-AbstractGateway-CSRF': String(csrfToken || ''),
        },
        timeout: 2000,
      },
      (resp) => {
        resp.resume();
        resp.on('end', () => resolve({ ok: (resp.statusCode || 0) < 400 }));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(body);
    req.end();
  });
}

async function connectionStatusPayload(req) {
  const session = browserSession(req);
  const gateway = session.token
    ? await checkGatewaySession(session.gatewayUrl, session.token)
    : { ok: false, error: 'Gateway sign-in required', gateway_url: session.gatewayUrl, auth_checked: false };
  return {
    ok: Boolean(gateway.ok),
    gateway_url: session.gatewayUrl,
    has_token: Boolean(session.token),
    has_session: Boolean(session.token),
    token_source: session.source,
    embeddings: gateway,
    gateway,
  };
}

async function handleConnectionApi(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, await connectionStatusPayload(req));
    return;
  }
  if (req.method === 'POST') {
    const canChangeGatewayUrl = browserGatewayConnectionConfigAllowed(req);
    const payload = await readRequestJson(req);
    const nextUrl = typeof payload.gateway_url === 'string' ? normalizeGatewayUrl(payload.gateway_url) : '';
    const nextToken = typeof payload.gateway_token === 'string' ? payload.gateway_token.trim() : '';
    const candidateUrl = nextUrl || CONNECTION.gatewayUrl;
    const candidateToken = nextToken;
    if (!candidateToken) {
      sendJson(res, 400, { detail: 'Gateway token is required' });
      return;
    }
    if (!canChangeGatewayUrl && candidateUrl !== CONNECTION.gatewayUrl) {
      sendJson(res, 403, { detail: browserGatewayConnectionConfigDenial(req) });
      return;
    }
    const gateway = await checkGatewayConnection(candidateUrl, candidateToken);
    if (!gateway.ok) {
      sendJson(res, 401, { detail: gateway.error || 'Gateway connection failed', gateway });
      return;
    }
    const principalError = userPrincipalError(gateway, String(payload.gateway_user_id || '').trim());
    if (principalError) {
      sendJson(res, principalError === 'Gateway user is required' ? 400 : 401, { detail: principalError, gateway });
      return;
    }
    if (payload.validate_only === true) {
      sendJson(res, 200, {
        ok: true,
        gateway_url: candidateUrl,
        has_token: Boolean(candidateToken),
        token_source: candidateToken ? 'candidate' : 'none',
        embeddings: gateway,
        gateway,
      });
      return;
    }
    const browserSessionValue = await createGatewayBrowserSession(
      candidateUrl,
      String(payload.gateway_user_id || '').trim(),
      candidateToken,
      payload.persist === true
    );
    const sessionData =
      browserSessionValue && typeof browserSessionValue === 'object' && typeof browserSessionValue.session === 'object'
        ? browserSessionValue.session
        : {};
    if (!browserSessionValue.ok || !sessionData.session_id || !sessionData.csrf_token) {
      sendJson(res, 401, { detail: browserSessionValue.error || 'Gateway browser session failed', gateway: browserSessionValue });
      return;
    }
    setSessionCookies(res, req, candidateUrl, sessionData.session_id, sessionData.csrf_token, payload.persist === true);
    sendJson(res, 200, {
      ok: true,
      gateway_url: candidateUrl,
      has_token: true,
      has_session: true,
      token_source: 'browser-session',
      embeddings: browserSessionValue,
      gateway: browserSessionValue,
    });
    return;
  }
  if (req.method === 'DELETE') {
    const session = browserSession(req);
    if (session.token) {
      await logoutGatewayBrowserSession(session.gatewayUrl, session.token, session.csrfToken);
    }
    clearSessionCookies(res, req);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { detail: 'Method not allowed' });
}

function proxyApiRequest(req, res) {
  const session = browserSession(req);
  if (!session.token) {
    sendJson(res, 401, { detail: 'Gateway sign-in required' });
    return;
  }
  if (!flowCsrfValid(req, session)) {
    sendJson(res, 403, { detail: 'Flow browser session CSRF token missing or invalid' });
    return;
  }
  let backend;
  try {
    backend = resolveBackend(session.gatewayUrl);
  } catch (err) {
    sendJson(res, 500, { detail: `Invalid gateway URL: ${String(err?.message || err)}` });
    return;
  }
  const headers = { ...req.headers, host: backend.url.host };
  delete headers.cookie;
  delete headers.Cookie;
  delete headers.authorization;
  delete headers.Authorization;
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  headers['x-abstractgateway-session'] = session.token;
  if (session.csrfToken && mutatingMethod(req.method)) {
    headers['x-abstractgateway-csrf'] = session.csrfToken;
  }

  const proxyReq = backend.client.request(
    {
      protocol: backend.url.protocol,
      hostname: backend.url.hostname,
      port: backend.url.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      const eventStream = isEventStreamResponse(proxyRes.headers);
      res.writeHead(proxyRes.statusCode || 502, proxyResponseHeaders(proxyRes.headers, eventStream));
      if (eventStream && typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          detail: `Backend not reachable at ${backend.origin} (${String(err?.message || err)})`,
        },
        null,
        2
      )
    );
  });

  // Forward request body (if any)
  req.pipe(proxyReq);
}

function proxyApiWebSocket(req, socket, head) {
  const session = browserSession(req);
  if (!session.token) {
    try {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{"detail":"Gateway sign-in required"}');
      socket.destroy();
    } catch {
      // ignore
    }
    return;
  }
  let backend;
  try {
    backend = resolveBackend(session.gatewayUrl);
  } catch {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    return;
  }
  const headers = { ...req.headers, host: backend.url.host };
  delete headers.cookie;
  delete headers.Cookie;
  delete headers.authorization;
  delete headers.Authorization;
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  headers['x-abstractgateway-session'] = session.token;

  const proxyReq = backend.client.request({
    protocol: backend.url.protocol,
    hostname: backend.url.hostname,
    port: backend.url.port,
    method: req.method || 'GET',
    path: req.url,
    headers,
  });

  proxyReq.on('error', () => {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  });

  proxyReq.on('response', (proxyRes) => {
    // Backend did not accept the upgrade (e.g. wrong path or backend not running).
    try {
      socket.write(
        `HTTP/1.1 ${proxyRes.statusCode || 502} ${proxyRes.statusMessage || 'Bad Gateway'}\r\n`
      );
      for (const [k, v] of Object.entries(proxyRes.headers || {})) {
        if (Array.isArray(v)) {
          for (const vv of v) socket.write(`${k}: ${vv}\r\n`);
        } else if (typeof v === 'string') {
          socket.write(`${k}: ${v}\r\n`);
        }
      }
      socket.write('\r\n');
    } catch {
      // ignore
    }
    try {
      socket.destroy();
    } catch {
      // ignore
    }
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // Mirror backend's upgrade response.
    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n`
    );
    for (const [k, v] of Object.entries(proxyRes.headers || {})) {
      if (Array.isArray(v)) {
        for (const vv of v) socket.write(`${k}: ${vv}\r\n`);
      } else if (typeof v === 'string') {
        socket.write(`${k}: ${v}\r\n`);
      }
    }
    socket.write('\r\n');

    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);

    proxySocket.pipe(socket).pipe(proxySocket);

    proxySocket.on('error', () => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
    socket.on('error', () => {
      try {
        proxySocket.destroy();
      } catch {
        // ignore
      }
    });
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  // Remove query strings and normalize path
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  // Local process readiness for launchers and supervisors.
  if (pathname === '/api/health' || pathname === '/health') {
    sendJson(res, 200, flowHealthPayload());
    return;
  }

  // Proxy backend API calls.
  if (pathname === '/api/connection/gateway') {
    void handleConnectionApi(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    proxyApiRequest(req, res);
    return;
  }
  
  // Security: prevent directory traversal
  if (pathname.includes('..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Try to serve the requested file
  let filePath = join(DIST_DIR, pathname);
  
  if (serveFile(res, filePath)) {
    return;
  }

  // Try with .html extension
  if (serveFile(res, filePath + '.html')) {
    return;
  }

  // Try index.html in directory
  if (serveFile(res, join(filePath, 'index.html'))) {
    return;
  }

  // SPA fallback: serve index.html for all other routes
  const indexPath = join(DIST_DIR, 'index.html');
  if (serveFile(res, indexPath)) {
    return;
  }

  // If nothing works, return 404
  res.writeHead(404);
  res.end('Not Found');
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      proxyApiWebSocket(req, socket, head);
      return;
    }
  } catch {
    // ignore
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
});

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║       AbstractFlow Visual Editor is running!       ║
╚════════════════════════════════════════════════════╝

  🌐 Local:   http://localhost:${PORT}
  🌐 Network: http://${HOST}:${PORT}
  🔌 Gateway: ${resolveBackend().origin}

  📐 Drag-and-drop workflow authoring
  💾 Export .flow bundles for deployment

  Press Ctrl+C to stop
`);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down AbstractFlow Editor...\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down AbstractFlow Editor...\n');
  process.exit(0);
});
