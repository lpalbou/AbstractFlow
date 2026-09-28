/**
 * The AbstractFlow server's launch flags and "which gateway" answer.
 *
 * The flags are the ones every AbstractFramework browser app takes
 * (`@abstractframework/app-server` parseAppFlags): --gateway-url (aliases
 * --gateway, --url), --port (default 3003), --host (default 127.0.0.1: the
 * gateway serves the editor at /apps/flow/), --help. PORT, HOST,
 * ABSTRACTFLOW_GATEWAY_URL and ABSTRACTGATEWAY_URL are legacy aliases below the
 * flags. With neither, the gateway is the saved login
 * (~/.abstractflow/gateway_connection.json), else the gateway installed on
 * this computer (~/.abstractframework/gateway.json), else
 * http://127.0.0.1:8080.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createGatewayUrlResolver, parseAppFlagsOrExit } from '@abstractframework/app-server';

export const FLOW_FLAG_OPTIONS = Object.freeze({
  appName: 'AbstractFlow visual workflow editor (@abstractframework/flow)',
  command: 'abstractflow-editor',
  envPrefix: 'ABSTRACTFLOW',
  defaultPort: 3003,
});

/** The gateway URL an earlier version saved for this user, if any. */
export function savedGatewayUrl({ home = homedir(), warn = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const path = join(home || '.', '.abstractflow', 'gateway_connection.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return undefined;
    warn(`abstractflow-editor: ignoring ${path}: ${err.message}`);
    return undefined;
  }
  try {
    const data = JSON.parse(raw);
    const url = data && typeof data.gateway_url === 'string' ? data.gateway_url.trim() : '';
    return url || undefined;
  } catch (err) {
    warn(`abstractflow-editor: ignoring ${path}: ${err.message}`);
    return undefined;
  }
}

/**
 * Parse the launch flags (prints --help and exits 0; a bad flag exits 2).
 * Returns {flags, gatewayUrl}: `gatewayUrl` is the URL itself when a flag or
 * the environment chose it (what the person chose never moves), else a
 * resolver that re-reads the local gateway pointer when the gateway refuses a
 * connection (the session proxy calls refresh()), so a running editor follows
 * the gateway onto a new port.
 * options: {env, home, warn} (tests; default the process's).
 */
export function parseFlowFlags(argv, { env = process.env, home = homedir(), warn } = {}) {
  const savedUrl = savedGatewayUrl({ home, ...(warn ? { warn } : {}) });
  const flags = parseAppFlagsOrExit(argv, { ...FLOW_FLAG_OPTIONS, env, home, savedUrl, ...(warn ? { warn } : {}) });
  const chosen = flags.gatewayUrlSource === 'flag' || flags.gatewayUrlSource.startsWith('env:');
  const gatewayUrl = chosen ? flags.gatewayUrl : createGatewayUrlResolver({ savedUrl, home, ...(warn ? { warn } : {}) });
  return { flags, gatewayUrl };
}
