/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import { createGatewaySessionProxy, createGatewayUrlResolver } from '@abstractframework/app-server';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// The app version shown in the About dialog. Read from package.json at build
// time and injected as the __APP_VERSION__ global (also under vitest, which
// loads this config). A package.json without a version fails the build.
const APP_VERSION: string = (() => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    throw new Error('vite.config.ts: package.json has no "version"; the About dialog needs it');
  }
  return pkg.version;
})();

/**
 * `npm run dev` serves the editor with the SAME server-side session proxy as
 * the published server (bin/server.js): `@abstractframework/app-server`
 * createGatewaySessionProxy, cookies abstractflow_gateway_*, the gateway
 * pinned server-side. Gateway: ABSTRACTFLOW_GATEWAY_URL / ABSTRACTGATEWAY_URL
 * (legacy aliases), else the local gateway pointer, else
 * http://127.0.0.1:8080.
 */
function devAppServerPlugin(): Plugin {
  return {
    name: 'abstractflow-dev-app-server',
    configureServer(server) {
      const proxy = createGatewaySessionProxy({
        appId: 'abstractflow',
        defaultGatewayUrl: createGatewayUrlResolver({
          env: [
            ['ABSTRACTFLOW_GATEWAY_URL', process.env.ABSTRACTFLOW_GATEWAY_URL],
            ['ABSTRACTGATEWAY_URL', process.env.ABSTRACTGATEWAY_URL],
          ],
        }),
      });
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://dev.invalid').pathname;
        if (pathname === '/api/health') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, status: 'healthy', service: 'abstractflow', mode: 'web-dev', gateway_url: proxy.defaultGatewayUrl }));
          return;
        }
        if (proxy.handle(req, res, pathname)) return;
        next();
      });
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the same build serves at / and under the gateway at
  // /apps/flow/ (bin/server.js puts a <base href> in the page).
  base: './',
  plugins: [devAppServerPlugin(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '@abstractframework/monitor-flow', replacement: resolve(__dirname, '../abstractuic/monitor-flow/src') },
      { find: '@abstractframework/monitor-active-memory', replacement: resolve(__dirname, '../abstractuic/monitor-active-memory/src') },
      { find: '@abstractframework/ui-kit', replacement: resolve(__dirname, '../abstractuic/ui-kit/src') },
      { find: '@abstractframework/monitor-gpu', replacement: resolve(__dirname, '../abstractuic/monitor-gpu/src') },
      { find: '@abstractframework/monitor-memory', replacement: resolve(__dirname, '../abstractuic/monitor-memory/src') },
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
      allow: [resolve(__dirname), resolve(__dirname, '../abstractuic')],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // untracked/ holds ignored scratch and audit copies of the repo: never collect them.
  test: {
    exclude: [...configDefaults.exclude, 'untracked/**'],
  },
});
