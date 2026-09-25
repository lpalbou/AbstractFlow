import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AfAboutDialog, AfTopBarActions, frameworkIdentity, gatewayVersionRows } from '@abstractframework/ui-kit';

import {
  ABSTRACTFLOW_IDENTITY,
  APP_VERSION,
  GATEWAY_ABOUT_PATH,
  fetchGatewayAboutRows,
  gatewayAboutErrorReason,
  useAboutAction,
} from './useAboutAction';
import { GatewayHttpError } from '../utils/gatewayClient';

// Wrap the kit's formatter (behaviour unchanged) so the tests can prove the
// gateway rows come from it and not from a local copy.
vi.mock('@abstractframework/ui-kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('@abstractframework/ui-kit')>();
  return { ...kit, gatewayVersionRows: vi.fn(kit.gatewayVersionRows) };
});

const ROOT = resolve(__dirname, '../..');
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version as string;

function decode(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function TopBarWithAbout() {
  const about = useAboutAction(async () => []);
  return createElement(AfTopBarActions, {
    appearance: { onOpen: () => {} },
    about,
    connection: { phase: 'connected', onConnect: () => {}, onDisconnect: () => {} },
  } as any);
}

describe('About dialog (AbstractFlow)', () => {
  it('uses the package.json version injected at build time', () => {
    expect(PKG_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION).toBe(PKG_VERSION);
    expect(ABSTRACTFLOW_IDENTITY.name).toBe('AbstractFlow');
    expect(ABSTRACTFLOW_IDENTITY.version).toBe(PKG_VERSION);
  });

  it('renders the About action in the top-bar cluster', () => {
    const html = decode(renderToStaticMarkup(createElement(TopBarWithAbout)));
    expect(html).toContain('af-topbar__btn--about');
    expect(html).toContain('aria-label="About AbstractFlow"');
    expect(html).toContain('aria-haspopup="dialog"');
    // Closed until clicked.
    expect(html).not.toContain('role="dialog"');
  });

  it('shows the app version, framework website, author line and the six links', async () => {
    const extraRows = await fetchGatewayAboutRows(async () => ({
      abstractframework: '0.3.3',
      abstractgateway: '0.4.3',
      packages: { abstractcore: '2.15.2', abstractruntime: '0.4.33' },
    }));
    const html = decode(
      renderToStaticMarkup(
        createElement(AfAboutDialog, { open: true, onClose: () => {}, identity: ABSTRACTFLOW_IDENTITY, extraRows })
      )
    );
    const fw = frameworkIdentity();
    expect(html).toContain('About AbstractFlow');
    expect(html).toContain(`AbstractFlow ${PKG_VERSION}`);
    expect(fw.website).toBe('https://abstractframework.ai');
    expect(html).toContain('AbstractFramework — <a class="af-about__link"');
    expect(html).toContain(`href="${fw.website}" target="_blank" rel="noopener noreferrer"`);
    expect(html).toContain('Laurent-Philippe Albou, PhD (2023-2026)');
    const links = [
      fw.website,
      'https://abstractframework.ai/flow',
      'https://github.com/lpalbou/AbstractFlow',
      'https://github.com/lpalbou/AbstractFlow#readme',
      'https://github.com/lpalbou/AbstractFlow/issues',
      'https://github.com/lpalbou/AbstractFlow/issues/new?labels=feedback',
    ];
    for (const href of links) {
      expect(html).toContain(`href="${href}" target="_blank" rel="noopener noreferrer"`);
    }
    const external = html.match(/target="_blank"/g) || [];
    expect(external.length).toBe(6);
    expect(html).toContain('AbstractGateway 0.4.3');
    expect(html).toContain('AbstractFramework 0.3.3');
    expect(html).toContain('Gateway package abstractcore');
  });

  it('every AfTopBarActions in the app passes the shared about action', () => {
    const src = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    const instances = src.split('<AfTopBarActions').slice(1);
    expect(instances.length).toBeGreaterThan(0);
    for (const chunk of instances) {
      const props = chunk.slice(0, chunk.indexOf('extraActions') >= 0 ? chunk.indexOf('extraActions') : 400);
      expect(props).toContain('about={about_action}');
    }
    expect(src).toContain('const about_action = useAboutAction()');
  });
});

describe('gateway versions for the About dialog', () => {
  it('fetches GET /api/gateway/about and formats it with the kit helper', async () => {
    const seen: string[] = [];
    vi.mocked(gatewayVersionRows).mockClear();
    const payload = {
      abstractframework: '0.3.3',
      abstractgateway: '0.4.3',
      packages: { abstractgateway: '0.4.3', abstractruntime: '0.4.33', abstractcore: '2.15.2', abstractvoice: null },
    };
    const rows = await fetchGatewayAboutRows(async (path) => {
      seen.push(path);
      return payload;
    });
    expect(seen).toEqual(['/api/gateway/about']);
    expect(GATEWAY_ABOUT_PATH).toBe('/api/gateway/about');
    expect(vi.mocked(gatewayVersionRows)).toHaveBeenCalledWith(payload);
    expect(rows).toEqual([
      ['Gateway', 'AbstractGateway 0.4.3'],
      ['Gateway framework', 'AbstractFramework 0.3.3'],
      ['Gateway package abstractcore', '2.15.2'],
      ['Gateway package abstractruntime', '0.4.33'],
    ]);
  });

  it('says when AbstractFramework is not installed on the gateway host', async () => {
    const rows = await fetchGatewayAboutRows(async () => ({ abstractframework: null, abstractgateway: '0.4.3', packages: {} }));
    expect(rows).toEqual([
      ['Gateway', 'AbstractGateway 0.4.3'],
      ['Gateway framework', 'not installed on the gateway host'],
    ]);
  });

  it('shows one visible failure row on an HTTP error', async () => {
    vi.mocked(gatewayVersionRows).mockClear();
    const rows = await fetchGatewayAboutRows(async () => {
      throw new GatewayHttpError('HTTP 404 Not Found: Not Found', 404, null);
    });
    expect(vi.mocked(gatewayVersionRows)).toHaveBeenCalledWith({ error: 'HTTP 404 Not Found: Not Found' });
    expect(rows).toEqual([['Gateway', 'unavailable (HTTP 404 Not Found: Not Found)']]);
  });

  it('shows one visible failure row on a network error', async () => {
    const rows = await fetchGatewayAboutRows(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(rows).toEqual([['Gateway', 'unavailable (Failed to fetch)']]);
    expect(gatewayAboutErrorReason({ status: 503, message: 'x' })).toBe('HTTP 503: x');
  });

  it('reports a payload without a gateway version as unavailable', async () => {
    const rows = await fetchGatewayAboutRows(async () => ({}) as never);
    expect(rows).toEqual([['Gateway', 'unavailable (the gateway did not report its version)']]);
  });
});
