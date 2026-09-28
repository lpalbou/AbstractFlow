/**
 * The AbstractFlow web server: the built editor (dist/) plus the shared
 * gateway session proxy, on the `@abstractframework/app-server` kit.
 *
 * It serves at `/` when run on its own (`npx @abstractframework/flow`) and
 * under the gateway at `/apps/flow/` (the gateway relays to this server on
 * 127.0.0.1 with `X-Forwarded-Prefix: /apps/flow`):
 *  - every response carries `X-AbstractFramework-App: flow; mount=1`
 *    (createMountedHandler); the gateway only serves an app that says so;
 *  - the page gets `<base href="<base path>/">` and `base_path` in
 *    `window.__ABSTRACT_UI_CONFIG__` (injectShell); the editor names every
 *    same-origin URL relatively (ui-kit gateway_paths, gatewayRequestPath), so assets and API
 *    calls stay under the base path;
 *  - "who is asking" is `requestContext(req)` (the browser's address, even
 *    behind the gateway), never the socket peer: the session proxy's
 *    browser-chosen gateway URL gate uses it;
 *  - the session cookies carry `Path=<base path>/` and the first value of a
 *    cookie wins (the kit's session proxy).
 * `/api/*` is the gateway, through the session proxy (HTTP and SSE; the
 * editor opens no WebSocket, so upgrades are refused).
 */

import * as http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import {
  createGatewaySessionProxy,
  createMountedHandler,
  injectShell,
  rejectUpgrade,
  requestContext,
} from '@abstractframework/app-server';

/** The gateway's catalog id: the app is served at /apps/flow/. */
export const MOUNT_APP_ID = 'flow';
/** Names the session cookies (abstractflow_gateway_*) and the CSRF header (x-abstractflow-csrf). */
export const SESSION_APP_ID = 'abstractflow';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * options:
 *   distDir      the built editor (required; index.html must exist)
 *   gatewayUrl   the server-pinned gateway: a URL, or a resolver
 *                {current(), refresh()} from createGatewayUrlResolver
 * Returns an http.Server (not listening).
 */
export function createFlowServer({ distDir, gatewayUrl } = {}) {
  const root = resolve(String(distDir || ''));
  const indexPath = join(root, 'index.html');
  if (!isFile(indexPath)) {
    throw new Error(`AbstractFlow: the built editor is missing (${indexPath}). Run \`npm run build\` first.`);
  }
  const proxy = createGatewaySessionProxy({ appId: SESSION_APP_ID, defaultGatewayUrl: gatewayUrl });

  function sendShell(res, ctx) {
    const page = injectShell(readFileSync(indexPath, 'utf8'), {
      basePath: ctx.basePath,
      config: { gateway_url: proxy.defaultGatewayUrl },
    });
    res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-cache' });
    res.end(page);
  }

  /** A file under dist/, or null (never a path outside it). */
  function distFile(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;
    const file = resolve(root, `.${decoded}`);
    if (file !== root && !file.startsWith(root + sep)) return null;
    return isFile(file) ? file : null;
  }

  const handler = createMountedHandler({ appId: MOUNT_APP_ID }, (req, res, ctx) => {
    const pathname = new URL(req.url || '/', 'http://flow.invalid').pathname;

    // Local readiness for launchers and supervisors (the gateway's app manager).
    if (pathname === '/api/health' || pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        status: 'healthy',
        service: 'abstractflow',
        mode: 'web',
        gateway_url: proxy.defaultGatewayUrl,
        base_path: ctx.basePath,
      });
      return;
    }
    // /api/connection/gateway (sign-in) and every other /api/* call.
    if (proxy.handle(req, res, pathname)) return;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { detail: 'Method not allowed' });
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      sendShell(res, ctx);
      return;
    }
    const file = distFile(pathname);
    if (file) {
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
      return;
    }
    // A missing asset is a 404, never the page (a stale bundle must fail loudly).
    if (pathname.startsWith('/assets/')) {
      sendJson(res, 404, { detail: `Not found: ${pathname}` });
      return;
    }
    // Any other path is the single-page editor.
    sendShell(res, ctx);
  });

  const server = http.createServer(handler);
  server.on('upgrade', (req, socket) => {
    try {
      requestContext(req);
    } catch (err) {
      rejectUpgrade(socket, 400, err.message);
      return;
    }
    rejectUpgrade(socket, 404, 'AbstractFlow serves no WebSocket');
  });
  return server;
}
