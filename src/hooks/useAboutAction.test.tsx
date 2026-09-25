import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AfAboutDialog, AfTopBarActions, frameworkIdentity } from '@abstractframework/ui-kit';

import {
  ABSTRACTFLOW_IDENTITY,
  APP_VERSION,
  GATEWAY_ABOUT_PATH,
  fetchGatewayAboutRows,
  gatewayAboutFailureRow,
  gatewayAboutRows,
  useAboutAction,
} from './useAboutAction';
import { GatewayHttpError } from '../utils/gatewayClient';

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

  it('shows the app version, framework website, author line and the five links', () => {
    const extraRows = gatewayAboutRows({
      abstractframework: '0.3.3',
      abstractgateway: '0.4.3',
      packages: { abstractcore: '2.15.2', abstractruntime: '0.4.33' },
    });
    const html = decode(
      renderToStaticMarkup(
        createElement(AfAboutDialog, { open: true, onClose: () => {}, identity: ABSTRACTFLOW_IDENTITY, extraRows })
      )
    );
    const fw = frameworkIdentity();
    expect(html).toContain('About AbstractFlow');
    expect(html).toContain(`AbstractFlow ${PKG_VERSION}`);
    expect(fw.website).toBe('https://abstractframework.ai');
    expect(html).toContain(`AbstractFramework — ${fw.website}`);
    expect(html).toContain('Laurent-Philippe Albou, PhD (2023-2026)');
    const links = [
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
    expect(external.length).toBe(5);
    expect(html).toContain('abstractgateway 0.4.3');
    expect(html).toContain('abstractframework 0.3.3');
    expect(html).toContain('abstractcore');
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
  it('fetches GET /api/gateway/about', async () => {
    const seen: string[] = [];
    const rows = await fetchGatewayAboutRows(async (path) => {
      seen.push(path);
      return { abstractframework: '0.3.3', abstractgateway: '0.4.3', packages: { abstractgateway: '0.4.3', abstractcore: '2.15.2' } };
    });
    expect(seen).toEqual(['/api/gateway/about']);
    expect(GATEWAY_ABOUT_PATH).toBe('/api/gateway/about');
    expect(rows).toEqual([
      ['Gateway', 'abstractgateway 0.4.3'],
      ['Gateway framework', 'abstractframework 0.3.3'],
      ['abstractcore', '2.15.2'],
    ]);
  });

  it('shows one visible failure row on an HTTP error', async () => {
    const rows = await fetchGatewayAboutRows(async () => {
      throw new GatewayHttpError('HTTP 404 Not Found: Not Found', 404, null);
    });
    expect(rows).toEqual([['Gateway', 'unavailable (HTTP 404 Not Found: Not Found)']]);
  });

  it('shows one visible failure row on a network error', async () => {
    const rows = await fetchGatewayAboutRows(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(rows).toEqual([['Gateway', 'unavailable (Failed to fetch)']]);
    expect(gatewayAboutFailureRow({ status: 503, message: 'x' })).toEqual(['Gateway', 'unavailable (HTTP 503: x)']);
  });

  it('reports a payload without a gateway version as unavailable', () => {
    expect(gatewayAboutRows({})).toEqual([['Gateway', 'unavailable (response has no abstractgateway version)']]);
  });
});
