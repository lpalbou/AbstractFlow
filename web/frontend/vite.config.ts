import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@abstractuic/monitor-flow', replacement: resolve(__dirname, '../../../abstractuic/monitor-flow/src') },
      { find: '@abstractuic/monitor-active-memory', replacement: resolve(__dirname, '../../../abstractuic/monitor-active-memory/src') },
      { find: '@abstractutils/monitor-gpu', replacement: resolve(__dirname, '../../../abstractuic/monitor-gpu/src') },
      // Shared workspace packages (imported from outside this Vite root) can’t
      // resolve `reactflow` via node_modules traversal, so pin it explicitly.
      { find: /^reactflow$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/esm/index.mjs') },
      { find: /^reactflow\/dist\/style\.css$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/style.css') },
      { find: /^reactflow\/dist\/base\.css$/, replacement: resolve(__dirname, './node_modules/reactflow/dist/base.css') },
    ],
  },
  server: {
    port: 3000,
    fs: {
      // Vite blocks serving files outside an allowlist. When we customize it to
      // include shared workspace packages (e.g. AbstractUIC), we must also include
      // this app's own root directory or Vite will 403 on `/index.html`.
      allow: [resolve(__dirname), resolve(__dirname, '../../../abstractuic')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
