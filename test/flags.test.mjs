/**
 * The AbstractFlow server's launch flags (bin/flags.js on the app-server
 * kit) and the `abstractflow-editor` entry point's --help / bad-flag exits.
 * Every case runs with a scratch HOME and an explicit environment: the
 * operator's ~/.abstractframework/gateway.json and ~/.abstractflow are never read.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseFlowFlags, savedGatewayUrl } from '../bin/flags.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
// Dead ports only (discard/echo/daytime/chargen): nothing here may ever reach a real gateway.
const POINTER_URL = 'http://127.0.0.1:9';

let home;
const warnings = [];
const warn = (m) => warnings.push(m);

function writePointer(url = POINTER_URL) {
  mkdirSync(join(home, '.abstractframework'), { recursive: true });
  const port = Number(new URL(url).port);
  writeFileSync(
    join(home, '.abstractframework', 'gateway.json'),
    JSON.stringify({ schema: 1, url, port, data_dir: null, updated_at: '2026-09-28T00:00:00Z', written_by: 'serve' }),
    { mode: 0o600 }
  );
}

function writeSaved(url) {
  mkdirSync(join(home, '.abstractflow'), { recursive: true });
  writeFileSync(join(home, '.abstractflow', 'gateway_connection.json'), JSON.stringify({ gateway_url: url }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'abstractflow-flags-'));
  warnings.length = 0;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('parseFlowFlags', () => {
  it('defaults: 127.0.0.1:3003, the built-in gateway as a resolver that follows the pointer', () => {
    const { flags, gatewayUrl } = parseFlowFlags([], { env: {}, home, warn });
    expect(flags).toMatchObject({ port: 3003, host: '127.0.0.1', gatewayUrl: 'http://127.0.0.1:8080', gatewayUrlSource: 'default' });
    expect(gatewayUrl.current()).toBe('http://127.0.0.1:8080');
    // The gateway appears (writes its pointer): a refused connection re-reads it.
    writePointer();
    expect(gatewayUrl.refresh()).toBe(true);
    expect(gatewayUrl.current()).toBe(POINTER_URL);
  });

  it('no flag, no env: the local gateway pointer', () => {
    writePointer();
    const { flags, gatewayUrl } = parseFlowFlags([], { env: {}, home, warn });
    expect(flags.gatewayUrlSource).toBe('pointer');
    expect(gatewayUrl.current()).toBe(POINTER_URL);
  });

  it('--gateway-url and its aliases win over everything, and never move', () => {
    writePointer();
    for (const flag of ['--gateway-url', '--gateway', '--url']) {
      const { flags, gatewayUrl } = parseFlowFlags([flag, 'http://127.0.0.1:7/'], { env: { ABSTRACTFLOW_GATEWAY_URL: 'http://127.0.0.1:13' }, home, warn });
      expect(flags).toMatchObject({ gatewayUrl: 'http://127.0.0.1:7', gatewayUrlSource: 'flag' });
      expect(gatewayUrl).toBe('http://127.0.0.1:7');
    }
  });

  it('legacy environment (how the gateway launches managed apps): PORT, HOST, ABSTRACTFLOW_GATEWAY_URL', () => {
    writePointer();
    const { flags, gatewayUrl } = parseFlowFlags([], {
      env: { PORT: '18960', HOST: '127.0.0.1', ABSTRACTFLOW_GATEWAY_URL: 'http://127.0.0.1:13' },
      home,
      warn,
    });
    expect(flags).toMatchObject({ port: 18960, host: '127.0.0.1', gatewayUrlSource: 'env:ABSTRACTFLOW_GATEWAY_URL' });
    expect(gatewayUrl).toBe('http://127.0.0.1:13');
  });

  it('a saved login beats the pointer; a saved old default does not', () => {
    writePointer();
    writeSaved('http://127.0.0.1:19');
    expect(parseFlowFlags([], { env: {}, home, warn }).gatewayUrl.current()).toBe('http://127.0.0.1:19');
    writeSaved('http://127.0.0.1:8080');
    expect(parseFlowFlags([], { env: {}, home, warn }).gatewayUrl.current()).toBe(POINTER_URL);
  });

  it('an unreadable saved login is ignored with a warning, never silently', () => {
    mkdirSync(join(home, '.abstractflow'), { recursive: true });
    writeFileSync(join(home, '.abstractflow', 'gateway_connection.json'), '{not json');
    expect(savedGatewayUrl({ home, warn })).toBeUndefined();
    expect(warnings.join('\n')).toContain('gateway_connection.json');
  });
});

describe('abstractflow-editor entry point', () => {
  const run = (args) =>
    spawnSync(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8', timeout: 20_000 });

  it('--help prints the shared usage and exits 0', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: abstractflow-editor [options]');
    expect(r.stdout).toContain('--gateway-url <url>');
    expect(r.stdout).toContain('ABSTRACTFLOW_GATEWAY_URL');
  });

  it('an unknown flag (the retired --gateway-token included) exits 2 with the reason', () => {
    const r = run(['--gateway-token', 'x']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown option --gateway-token');
  });
});
