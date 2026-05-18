import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const GATEWAY_URL =
  process.env.ABSTRACTGATEWAY_URL ||
  process.env.ABSTRACTFLOW_GATEWAY_URL ||
  'http://localhost:8080';
const GATEWAY_AUTH_TOKEN =
  process.env.ABSTRACTGATEWAY_AUTH_TOKEN ||
  '';

let runtimeGatewayToken = GATEWAY_AUTH_TOKEN;
let runtimeGatewayUrl = GATEWAY_URL.replace(/\/+$/, '');

async function checkGatewayConnection(gatewayUrl = runtimeGatewayUrl, token = runtimeGatewayToken) {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  const auth = String(token || '').trim();
  if (!base) return { ok: false, error: 'Gateway URL is required' };
  if (!auth) return { ok: false, error: 'Gateway token missing' };
  try {
    const response = await fetch(`${base}/api/gateway/discovery/capabilities`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${auth}`,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `HTTP ${response.status}: ${detail || response.statusText || 'Gateway error'}` };
    }
    return { ok: true, provider: 'gateway', model: 'discovery' };
  } catch (error: any) {
    return { ok: false, error: String(error?.message || error) };
  }
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
          const gateway = await checkGatewayConnection();
          return {
            ok: Boolean(gateway.ok),
            gateway_url: runtimeGatewayUrl,
            has_token: Boolean(runtimeGatewayToken),
            token_source: runtimeGatewayToken ? 'dev-server' : 'none',
            embeddings: gateway,
            gateway,
          };
        };
        if (req.method === 'GET') {
          statusPayload().then((payload) => send(200, payload));
          return;
        }
        if (req.method === 'POST') {
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
                : runtimeGatewayToken;
            const gateway = await checkGatewayConnection(candidateUrl, candidateToken);
            if (!gateway.ok) {
              send(401, { detail: gateway.error || 'Gateway connection failed', gateway });
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
            runtimeGatewayUrl = candidateUrl;
            runtimeGatewayToken = candidateToken;
            send(200, {
              ok: true,
              gateway_url: runtimeGatewayUrl,
              has_token: Boolean(runtimeGatewayToken),
              token_source: runtimeGatewayToken ? 'dev-server' : 'none',
              embeddings: gateway,
              gateway,
            });
          });
          return;
        }
        if (req.method === 'DELETE') {
          runtimeGatewayToken = '';
          send(200, { ok: true });
          return;
        }
        send(405, { detail: 'Method not allowed' });
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
            const hasAuth = Boolean(req.headers.authorization);
            if (runtimeGatewayToken && !hasAuth) {
              proxyReq.setHeader('Authorization', `Bearer ${runtimeGatewayToken}`);
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
