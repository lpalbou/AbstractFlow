#!/usr/bin/env node

/**
 * CLI entry point for @abstractframework/flow
 * Serves the visual workflow editor on a configurable port.
 *
 * NOTE: The editor UI expects a backend API at `/api/*`.
 * This CLI proxies `/api/*` (HTTP + WebSocket upgrades) to a configurable backend URL.
 */

import * as http from 'http';
import * as https from 'https';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

function parseArgs(argv) {
  const out = {
    host: process.env.HOST || '0.0.0.0',
    port: Number.parseInt(String(process.env.PORT || '3003'), 10),
    backendUrl:
      process.env.ABSTRACTFLOW_BACKEND_URL ||
      process.env.BACKEND_URL ||
      'http://127.0.0.1:8080',
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
    if ((a === '--backend-url' || a === '--backend') && typeof next === 'string') {
      out.backendUrl = next;
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
  npx @abstractframework/flow [--port 3003] [--host 0.0.0.0] [--backend-url http://127.0.0.1:8080]

Env vars:
  PORT, HOST
  ABSTRACTFLOW_BACKEND_URL (or BACKEND_URL)

Notes:
  - Proxies /api/* to the backend URL (HTTP + WebSocket).
  - Start the backend with: abstractflow serve --port 8080
`);
  process.exit(0);
}

let BACKEND;
try {
  BACKEND = new URL(String(OPTS.backendUrl || '').trim());
} catch {
  console.error(`Invalid backend URL: ${String(OPTS.backendUrl || '')}`);
  process.exit(2);
}
if (!BACKEND.port) {
  BACKEND.port = BACKEND.protocol === 'https:' ? '443' : '80';
}
const BACKEND_ORIGIN = `${BACKEND.protocol}//${BACKEND.host}`;

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

function proxyApiRequest(req, res) {
  const client = BACKEND.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: BACKEND.host };

  const proxyReq = client.request(
    {
      protocol: BACKEND.protocol,
      hostname: BACKEND.hostname,
      port: BACKEND.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          detail: `Backend not reachable at ${BACKEND_ORIGIN} (${String(err?.message || err)})`,
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
  const client = BACKEND.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: BACKEND.host };

  const proxyReq = client.request({
    protocol: BACKEND.protocol,
    hostname: BACKEND.hostname,
    port: BACKEND.port,
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
  🔌 Backend: ${BACKEND_ORIGIN}

  📐 Drag-and-drop workflow authoring
  🔗 Configure AbstractGateway in the Connect modal
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
