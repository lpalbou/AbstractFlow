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
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8080';

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

function writePersistedConnection(payload) {
  const path = connectionConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }
}

function clearPersistedConnection() {
  try {
    const path = connectionConfigPath();
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

function parseArgs(argv) {
  const persisted = readPersistedConnection();
  const envUrl = process.env.ABSTRACTGATEWAY_URL || process.env.ABSTRACTFLOW_GATEWAY_URL || '';
  const envToken = process.env.ABSTRACTGATEWAY_AUTH_TOKEN || '';
  const out = {
    host: process.env.HOST || '0.0.0.0',
    port: Number.parseInt(String(process.env.PORT || '3003'), 10),
    gatewayUrl: envUrl || String(persisted.gateway_url || '') || DEFAULT_GATEWAY_URL,
    gatewayToken: envToken || String(persisted.gateway_token || ''),
    gatewayTokenSource: envToken ? 'env' : persisted.gateway_token ? 'config' : 'none',
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
      out.gatewayUrl = next;
      i += 1;
      continue;
    }
    if (a === '--gateway-token' && typeof next === 'string') {
      out.gatewayToken = next;
      out.gatewayTokenSource = 'arg';
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
  npx @abstractframework/flow [--port 3003] [--host 0.0.0.0] [--gateway-url http://127.0.0.1:8080] [--gateway-token <token>]

Env vars:
  PORT, HOST
  ABSTRACTGATEWAY_URL (or ABSTRACTFLOW_GATEWAY_URL)
  ABSTRACTGATEWAY_AUTH_TOKEN

Notes:
  - Proxies /api/* to the gateway URL (HTTP + SSE).
  - If no gateway token is configured, the browser startup dialog can collect one.
  - Start the gateway with: abstractgateway --port 8080
`);
  process.exit(0);
}

const CONNECTION = {
  gatewayUrl: String(OPTS.gatewayUrl || DEFAULT_GATEWAY_URL).trim().replace(/\/+$/, '') || DEFAULT_GATEWAY_URL,
  gatewayToken: String(OPTS.gatewayToken || '').trim(),
  tokenSource: String(OPTS.gatewayTokenSource || 'none'),
};

function resolveBackend(gatewayUrl = CONNECTION.gatewayUrl) {
  const backend = new URL(String(gatewayUrl || DEFAULT_GATEWAY_URL).trim());
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

function checkGatewayConnection(gatewayUrl = CONNECTION.gatewayUrl, gatewayToken = CONNECTION.gatewayToken) {
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
        path: '/api/gateway/discovery/capabilities',
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
          if ((resp.statusCode || 0) >= 200 && (resp.statusCode || 0) < 300) {
            resolve({ ok: true, provider: 'gateway', model: 'discovery' });
          } else {
            const body = Buffer.concat(chunks).toString('utf8');
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

async function connectionStatusPayload() {
  const gateway = await checkGatewayConnection();
  return {
    ok: Boolean(gateway.ok),
    gateway_url: CONNECTION.gatewayUrl,
    has_token: Boolean(CONNECTION.gatewayToken),
    token_source: CONNECTION.tokenSource || (CONNECTION.gatewayToken ? 'runtime' : 'none'),
    embeddings: gateway,
    gateway,
  };
}

async function handleConnectionApi(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, await connectionStatusPayload());
    return;
  }
  if (req.method === 'POST') {
    const payload = await readRequestJson(req);
    const nextUrl = typeof payload.gateway_url === 'string' ? payload.gateway_url.trim().replace(/\/+$/, '') : '';
    const nextToken = typeof payload.gateway_token === 'string' ? payload.gateway_token.trim() : '';
    const candidateUrl = nextUrl || CONNECTION.gatewayUrl;
    const candidateToken = nextToken || CONNECTION.gatewayToken;
    const gateway = await checkGatewayConnection(candidateUrl, candidateToken);
    if (!gateway.ok) {
      sendJson(res, 401, { detail: gateway.error || 'Gateway connection failed', gateway });
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
    CONNECTION.gatewayUrl = candidateUrl;
    CONNECTION.gatewayToken = candidateToken;
    CONNECTION.tokenSource = nextToken ? 'runtime' : CONNECTION.tokenSource;
    if (payload.persist === true) {
      writePersistedConnection({
        version: 1,
        updated_at: new Date().toISOString(),
        gateway_url: CONNECTION.gatewayUrl,
        gateway_token: CONNECTION.gatewayToken,
      });
      if (CONNECTION.gatewayToken) CONNECTION.tokenSource = 'config';
    }
    sendJson(res, 200, await connectionStatusPayload());
    return;
  }
  if (req.method === 'DELETE') {
    clearPersistedConnection();
    CONNECTION.gatewayToken = '';
    CONNECTION.tokenSource = 'none';
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { detail: 'Method not allowed' });
}

function proxyApiRequest(req, res) {
  let backend;
  try {
    backend = resolveBackend();
  } catch (err) {
    sendJson(res, 500, { detail: `Invalid gateway URL: ${String(err?.message || err)}` });
    return;
  }
  const headers = { ...req.headers, host: backend.url.host };
  const authHeader = headers.authorization || headers.Authorization;
  if (CONNECTION.gatewayToken && !authHeader) {
    headers.authorization = `Bearer ${String(CONNECTION.gatewayToken).trim()}`;
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
  let backend;
  try {
    backend = resolveBackend();
  } catch {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    return;
  }
  const headers = { ...req.headers, host: backend.url.host };
  const authHeader = headers.authorization || headers.Authorization;
  if (CONNECTION.gatewayToken && !authHeader) {
    headers.authorization = `Bearer ${String(CONNECTION.gatewayToken).trim()}`;
  }

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
