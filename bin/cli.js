#!/usr/bin/env node

/**
 * `abstractflow-editor` (`npx @abstractframework/flow`): serve the AbstractFlow
 * visual workflow editor at / on 127.0.0.1:3003 (the gateway serves the same
 * server at /apps/flow/). Flags: ./flags.js; the server: ./server.js.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFlowFlags } from './flags.js';
import { createFlowServer } from './server.js';

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const { flags, gatewayUrl } = parseFlowFlags(process.argv.slice(2));

let server;
try {
  server = createFlowServer({ distDir: DIST_DIR, gatewayUrl });
} catch (err) {
  process.stderr.write(`abstractflow-editor: ${err.message}\n`);
  process.exit(1);
}

server.on('error', (err) => {
  process.stderr.write(`abstractflow-editor: cannot listen on ${flags.host}:${flags.port}: ${err.message}\n`);
  process.exit(1);
});

server.listen(flags.port, flags.host, () => {
  const host = flags.host === '0.0.0.0' || flags.host === '::' ? 'localhost' : flags.host.includes(':') ? `[${flags.host}]` : flags.host;
  process.stdout.write(
    [
      'AbstractFlow visual editor is running.',
      `  Open:    http://${host}:${flags.port}/`,
      `  Gateway: ${flags.gatewayUrl} (${flags.gatewayUrlSource})`,
      '  Through the gateway it is served at /apps/flow/.',
      '  Press Ctrl+C to stop.',
      '',
    ].join('\n')
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
