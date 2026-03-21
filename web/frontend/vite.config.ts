import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const GATEWAY_URL =
  process.env.ABSTRACTGATEWAY_URL ||
  process.env.ABSTRACTFLOW_GATEWAY_URL ||
  process.env.ABSTRACTFLOW_BACKEND_URL || // #FALLBACK: legacy env var
  process.env.BACKEND_URL || // #FALLBACK: legacy env var
  'http://localhost:8080';
const GATEWAY_AUTH_TOKEN =
  process.env.ABSTRACTGATEWAY_AUTH_TOKEN ||
  process.env.ABSTRACTFLOW_GATEWAY_AUTH_TOKEN || // #FALLBACK: legacy env var
  process.env.ABSTRACTCODE_GATEWAY_TOKEN || // #FALLBACK: legacy env var
  '';

if (!process.env.ABSTRACTGATEWAY_URL && !process.env.ABSTRACTFLOW_GATEWAY_URL && (process.env.ABSTRACTFLOW_BACKEND_URL || process.env.BACKEND_URL)) {
  console.warn('#FALLBACK: using legacy ABSTRACTFLOW_BACKEND_URL/BACKEND_URL for gateway URL');
}
if (!process.env.ABSTRACTGATEWAY_AUTH_TOKEN && (process.env.ABSTRACTFLOW_GATEWAY_AUTH_TOKEN || process.env.ABSTRACTCODE_GATEWAY_TOKEN)) {
  console.warn('#FALLBACK: using legacy auth token env var for gateway auth');
}

const PROXY_HEADERS = GATEWAY_AUTH_TOKEN
  ? { Authorization: `Bearer ${GATEWAY_AUTH_TOKEN}` }
  : undefined;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@abstractuic/monitor-flow', replacement: resolve(__dirname, '../../../abstractuic/monitor-flow/src') },
      { find: '@abstractuic/monitor-active-memory', replacement: resolve(__dirname, '../../../abstractuic/monitor-active-memory/src') },
      { find: '@abstractuic/ui-kit', replacement: resolve(__dirname, '../../../abstractuic/ui-kit/src') },
      { find: '@abstractutils/monitor-gpu', replacement: resolve(__dirname, '../../../abstractuic/monitor-gpu/src') },
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
        changeOrigin: true,
        ws: false,
        secure: false,
        ...(PROXY_HEADERS ? { headers: PROXY_HEADERS } : {}),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
