import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const GATEWAY_URL =
  process.env.ABSTRACTGATEWAY_URL ||
  process.env.ABSTRACTFLOW_GATEWAY_URL ||
  'http://localhost:8080';
let runtimeGatewayUrl = GATEWAY_URL.replace(/\/+$/, '');
const GATEWAY_SESSION_URL_COOKIE = 'abstractflow_gateway_url';
const GATEWAY_SESSION_ID_COOKIE = 'abstractflow_gateway_session';
const GATEWAY_SESSION_CSRF_COOKIE = 'abstractflow_gateway_csrf';
const GATEWAY_SESSION_TOKEN_COOKIE = 'abstractflow_gateway_token';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on']);

function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) return Boolean(fallback);
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

function requestHostname(req: any): string {
  const trustProxyHeaders = envBool('ABSTRACTFLOW_TRUST_PROXY_HEADERS') || envBool('ABSTRACTGATEWAY_TRUST_PROXY_HEADERS');
  const headerValue = trustProxyHeaders ? (req?.headers?.['x-forwarded-host'] || req?.headers?.host) : req?.headers?.host;
  const raw = String(headerValue || '').split(',', 1)[0].trim();
  if (!raw) return '';
  if (raw.startsWith('[')) return raw.slice(1).split(']', 1)[0].trim().toLowerCase();
  if ((raw.match(/:/g) || []).length === 1) return raw.split(':')[0].trim().toLowerCase();
  return raw.toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const h = String(hostname || '').trim().toLowerCase();
  return h === 'localhost' || h === 'localhost.localdomain' || h === '::1' || h.startsWith('127.');
}

function browserGatewayConnectionConfigAllowed(req: any): boolean {
  if (envBool('ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG')) return true;
  return isLoopbackHostname(requestHostname(req));
}

function browserGatewayConnectionConfigDenial(req: any): string {
  const host = requestHostname(req) || 'unknown host';
  return (
    `Browser-supplied Gateway URL changes are disabled for this non-local Flow host (${host}). ` +
    'Use the server-configured Gateway URL, or set ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1 behind your own access control.'
  );
}

async function checkGatewayConnection(gatewayUrl = runtimeGatewayUrl, token = '') {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  const auth = String(token || '').trim();
  if (!base) return { ok: false, error: 'Gateway URL is required' };
  if (!auth) return { ok: false, error: 'Gateway token missing' };
  try {
    const response = await fetch(`${base}/api/gateway/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth}`,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${detail || response.statusText || 'Gateway error'}` };
    }
    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      provider: 'gateway',
      model: 'principal',
      principal: payload && typeof payload === 'object' ? (payload as any).principal : undefined,
      auth: payload && typeof payload === 'object' ? (payload as any).auth : undefined,
      routing: payload && typeof payload === 'object' ? (payload as any).routing : undefined,
    };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function checkGatewaySession(gatewayUrl = runtimeGatewayUrl, sessionId = '') {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  const session = String(sessionId || '').trim();
  if (!base) return { ok: false, error: 'Gateway URL is required' };
  if (!session) return { ok: false, error: 'Gateway sign-in required' };
  try {
    const response = await fetch(`${base}/api/gateway/me`, {
      headers: {
        Accept: 'application/json',
        'X-AbstractGateway-Session': session,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${detail || response.statusText || 'Gateway error'}` };
    }
    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      provider: 'gateway',
      model: 'principal',
      principal: payload && typeof payload === 'object' ? (payload as any).principal : undefined,
      auth: payload && typeof payload === 'object' ? (payload as any).auth : undefined,
      routing: payload && typeof payload === 'object' ? (payload as any).routing : undefined,
    };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function createGatewayBrowserSession(gatewayUrl: string, userId: string, token: string, remember: boolean) {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  const response = await fetch(`${base}/api/gateway/session/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, token, remember }),
  });
  const payload = await response.json().catch(async () => ({ detail: await response.text().catch(() => '') }));
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? (payload as any).detail : '';
    return { ok: false, error: `HTTP ${response.status}: ${detail || response.statusText || 'Gateway error'}` };
  }
  const getSetCookie = (response.headers as any).getSetCookie;
  const rawSetCookie =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : (response.headers as any).raw?.()?.['set-cookie'] || response.headers.get('set-cookie');
  const data = payload && typeof payload === 'object' ? { ...(payload as any) } : {};
  const session = data.session && typeof data.session === 'object' ? { ...data.session } : {};
  const sessionId = cookieValueFromSetCookie(rawSetCookie, 'abstractgateway_session') || String(session.session_id || '').trim();
  const csrfToken = cookieValueFromSetCookie(rawSetCookie, 'abstractgateway_csrf') || String(session.csrf_token || '').trim();
  if (sessionId) session.session_id = sessionId;
  if (csrfToken) session.csrf_token = csrfToken;
  return { ...data, session, ok: true, gateway_url: base };
}

function cookieValueFromSetCookie(rawHeaders: unknown, name: string): string {
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

async function logoutGatewayBrowserSession(gatewayUrl: string, sessionId: string, csrfToken: string) {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  const session = String(sessionId || '').trim();
  if (!base || !session) return { ok: false };
  try {
    const response = await fetch(`${base}/api/gateway/session/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-AbstractGateway-Session': session,
        'X-AbstractGateway-CSRF': String(csrfToken || '').trim(),
      },
      body: '{}',
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

function parseCookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
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

function browserSession(req: any): { gatewayUrl: string; sessionId: string; csrfToken: string; source: string } {
  const cookies = parseCookies(req);
  const cookieUrl = String(cookies[GATEWAY_SESSION_URL_COOKIE] || '').trim().replace(/\/+$/, '');
  const sessionId = String(cookies[GATEWAY_SESSION_ID_COOKIE] || '').trim();
  const csrfToken = String(cookies[GATEWAY_SESSION_CSRF_COOKIE] || '').trim();
  const allowCookieUrl =
    envBool('ABSTRACTFLOW_ALLOW_BROWSER_GATEWAY_URL_COOKIE') ||
    envBool('ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG') ||
    browserGatewayConnectionConfigAllowed(req);
  const gatewayUrl = cookieUrl && (allowCookieUrl || cookieUrl === runtimeGatewayUrl) ? cookieUrl : runtimeGatewayUrl;
  return { gatewayUrl, sessionId, csrfToken, source: sessionId ? 'browser-session' : 'none' };
}

function cookieSecure(req: any): string {
  return String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase() === 'https' ? '; Secure' : '';
}

function setSessionCookies(res: any, req: any, gatewayUrl: string, sessionId: string, csrfToken: string, persist: boolean) {
  const maxAge = persist ? '; Max-Age=2592000' : '';
  const secure = cookieSecure(req);
  const attrs = `; Path=/; HttpOnly; SameSite=Lax${secure}${maxAge}`;
  const csrfAttrs = `; Path=/; SameSite=Lax${secure}${maxAge}`;
  res.setHeader('Set-Cookie', [
    `${GATEWAY_SESSION_URL_COOKIE}=${encodeURIComponent(gatewayUrl)}${attrs}`,
    `${GATEWAY_SESSION_ID_COOKIE}=${encodeURIComponent(sessionId)}${attrs}`,
    `${GATEWAY_SESSION_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}${csrfAttrs}`,
    `${GATEWAY_SESSION_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}

function clearSessionCookies(res: any, req: any) {
  const secure = cookieSecure(req);
  res.setHeader('Set-Cookie', [
    `${GATEWAY_SESSION_URL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_ID_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_CSRF_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
    `${GATEWAY_SESSION_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}

function mutatingMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase());
}

function flowCsrfValid(req: any, session: { csrfToken: string }): boolean {
  if (!mutatingMethod(req?.method)) return true;
  const expected = String(session.csrfToken || '').trim();
  const header = String(req?.headers?.['x-abstractflow-csrf'] || '').trim();
  return Boolean(expected && header && expected === header);
}

function userPrincipalError(gateway: any, expectedUser: string): string | null {
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

function devConnectionPlugin(): Plugin {
  return {
    name: 'abstractflow-dev-gateway-connection',
    configureServer(server) {
      server.middlewares.use('/api/connection/gateway', (req, res) => {
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload, null, 2));
        };
        const statusPayload = async () => {
          const session = browserSession(req);
          const gateway = session.sessionId
            ? await checkGatewaySession(session.gatewayUrl, session.sessionId)
            : { ok: false, error: 'Gateway sign-in required', gateway_url: session.gatewayUrl, auth_checked: false };
          return {
            ok: Boolean(gateway.ok),
            gateway_url: session.gatewayUrl,
            has_token: Boolean(session.sessionId),
            has_session: Boolean(session.sessionId),
            token_source: session.source,
            embeddings: gateway,
            gateway,
          };
        };
        if (req.method === 'GET') {
          statusPayload().then((payload) => send(200, payload));
          return;
        }
        if (req.method === 'POST') {
          const canChangeGatewayUrl = browserGatewayConnectionConfigAllowed(req);
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on('end', async () => {
            let payload: any = {};
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            } catch {
              payload = {};
            }
            const candidateUrl =
              typeof payload.gateway_url === 'string' && payload.gateway_url.trim()
                ? payload.gateway_url.trim().replace(/\/+$/, '')
                : runtimeGatewayUrl;
            const candidateToken =
              typeof payload.gateway_token === 'string' && payload.gateway_token.trim()
                ? payload.gateway_token.trim()
                : '';
            if (!candidateToken) {
              send(400, { detail: 'Gateway token is required' });
              return;
            }
            if (!canChangeGatewayUrl && candidateUrl !== runtimeGatewayUrl) {
              send(403, { detail: browserGatewayConnectionConfigDenial(req) });
              return;
            }
            const gateway = await checkGatewayConnection(candidateUrl, candidateToken);
            if (!gateway.ok) {
              send(401, { detail: gateway.error || 'Gateway connection failed', gateway });
              return;
            }
            const principalError = userPrincipalError(gateway, String(payload.gateway_user_id || '').trim());
            if (principalError) {
              send(principalError === 'Gateway user is required' ? 400 : 401, { detail: principalError, gateway });
              return;
            }
            if (payload.validate_only === true) {
              send(200, {
                ok: true,
                gateway_url: candidateUrl,
                has_token: Boolean(candidateToken),
                token_source: candidateToken ? 'candidate' : 'none',
                embeddings: gateway,
                gateway,
              });
              return;
            }
            const browserSession = await createGatewayBrowserSession(
              candidateUrl,
              String(payload.gateway_user_id || '').trim(),
              candidateToken,
              payload.persist === true
            );
            const sessionData =
              browserSession && typeof browserSession === 'object' && typeof (browserSession as any).session === 'object'
                ? (browserSession as any).session
                : {};
            if (!browserSession.ok || !sessionData.session_id || !sessionData.csrf_token) {
              send(401, { detail: browserSession.error || 'Gateway browser session failed', gateway: browserSession });
              return;
            }
            setSessionCookies(res, req, candidateUrl, sessionData.session_id, sessionData.csrf_token, payload.persist === true);
            send(200, {
              ok: true,
              gateway_url: candidateUrl,
              has_token: true,
              has_session: true,
              token_source: 'browser-session',
              embeddings: browserSession,
              gateway: browserSession,
            });
          });
          return;
        }
        if (req.method === 'DELETE') {
          const session = browserSession(req);
          if (session.sessionId) {
            void logoutGatewayBrowserSession(session.gatewayUrl, session.sessionId, session.csrfToken);
          }
          clearSessionCookies(res, req);
          send(200, { ok: true });
          return;
        }
        send(405, { detail: 'Method not allowed' });
      });
      server.middlewares.use('/api', (req, res, next) => {
        const path = String(req.url || '');
        if (path.startsWith('/connection/gateway')) {
          next();
          return;
        }
        const session = browserSession(req);
        if (!session.sessionId) {
          res.statusCode = 401;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: 'Gateway sign-in required' }));
          return;
        }
        if (!flowCsrfValid(req, session)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ detail: 'Flow browser session CSRF token missing or invalid' }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devConnectionPlugin(), react()],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@abstractframework/monitor-flow', replacement: resolve(__dirname, '../../../abstractuic/monitor-flow/src') },
      { find: '@abstractframework/monitor-active-memory', replacement: resolve(__dirname, '../../../abstractuic/monitor-active-memory/src') },
      { find: '@abstractframework/ui-kit', replacement: resolve(__dirname, '../../../abstractuic/ui-kit/src') },
      { find: '@abstractframework/monitor-gpu', replacement: resolve(__dirname, '../../../abstractuic/monitor-gpu/src') },
      // Shared workspace packages (imported from outside this Vite root) can’t
      // resolve `reactflow` via node_modules traversal, so pin it explicitly.
      { find: /^reactflow$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/esm/index.mjs') },
      { find: /^reactflow\/dist\/style\.css$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/style.css') },
      { find: /^reactflow\/dist\/base\.css$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/base.css') },
    ],
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    strictPort: false,
    cors: true,
    port: 3000,
    fs: {
      // Vite blocks serving files outside an allowlist. When we customize it to
      // include shared workspace packages (e.g. AbstractUIC), we must also include
      // this app's own root directory or Vite will 403 on `/index.html`.
      allow: [resolve(__dirname), resolve(__dirname, '../../../abstractuic')],
    },
    proxy: {
      '/api': {
        target: GATEWAY_URL,
        router: () => runtimeGatewayUrl,
        changeOrigin: true,
        ws: false,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const session = browserSession(req);
            proxyReq.removeHeader('Cookie');
            proxyReq.removeHeader('cookie');
            proxyReq.removeHeader('Authorization');
            proxyReq.removeHeader('authorization');
            proxyReq.removeHeader('X-Forwarded-For');
            proxyReq.removeHeader('x-forwarded-for');
            proxyReq.removeHeader('X-Forwarded-Host');
            proxyReq.removeHeader('x-forwarded-host');
            proxyReq.removeHeader('X-Forwarded-Proto');
            proxyReq.removeHeader('x-forwarded-proto');
            if (session.sessionId) {
              proxyReq.setHeader('X-AbstractGateway-Session', session.sessionId);
            }
            if (session.csrfToken && mutatingMethod(req.method)) {
              proxyReq.setHeader('X-AbstractGateway-CSRF', session.csrfToken);
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
