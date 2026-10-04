import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AfAboutDialog, AfTopBarActions, aboutVersionsFromGateway, frameworkIdentity } from '@abstractframework/ui-kit';

import {
  ABOUT_VERSIONS_LOADING,
  ABSTRACTFLOW_IDENTITY,
  APP_VERSION,
  GATEWAY_ABOUT_PATH,
  fetchGatewayAboutVersions,
  gatewayAboutErrorReason,
  useAboutAction,
} from './useAboutAction';
import { GatewayHttpError } from '../utils/gatewayClient';

// Wrap the kit's helper (behaviour unchanged) so the tests can prove the
// versions come from it and not from a local copy.
vi.mock('@abstractframework/ui-kit', async (importOriginal) => {
  const kit = await importOriginal<typeof import('@abstractframework/ui-kit')>();
  return { ...kit, aboutVersionsFromGateway: vi.fn(kit.aboutVersionsFromGateway) };
});

const ROOT = resolve(__dirname, '../..');
const PKG_VERSION = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version as string;

const PAYLOAD = {
  abstractframework: '0.9.6',
  abstractgateway: '0.12.0',
  packages: { abstractgateway: '0.12.0', abstractruntime: '0.8.4', abstractcore: '2.23.1', abstractvoice: null },
};

function decode(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function TopBarWithAbout() {
  const about = useAboutAction(async () => ABOUT_VERSIONS_LOADING);
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
    expect(html).not.toContain('role="dialog"');
  });

  it('shows name + version, framework and gateway versions, six links and the licence line — and no package list', async () => {
    const versions = await fetchGatewayAboutVersions(async () => PAYLOAD);
    const html = decode(
      renderToStaticMarkup(createElement(AfAboutDialog, { open: true, onClose: () => {}, identity: ABSTRACTFLOW_IDENTITY, versions }))
    );
    const fw = frameworkIdentity();
    expect(html).toContain(`AbstractFlow <span class="af-about-card__version">${PKG_VERSION}</span>`);
    expect(html).toContain('<dt>AbstractFramework</dt><dd>0.9.6</dd>');
    expect(html).toContain('<dt>AbstractGateway</dt><dd>0.12.0</dd>');
    const links = [
      'https://abstractframework.ai/flow',
      'https://github.com/lpalbou/AbstractFlow',
      'https://github.com/lpalbou/AbstractFlow#readme',
      'https://github.com/lpalbou/AbstractFlow/issues',
      'https://github.com/lpalbou/AbstractFlow/issues/new?labels=feedback',
    ];
    for (const href of links) expect(html).toContain(`href="${href}" title="${href}" target="_blank" rel="noopener noreferrer"`);
    expect((html.match(/target="_blank"/g) || []).length).toBe(5);
    expect(html).toContain(`href="mailto:${fw.contact_email}"`);
    expect(html).toContain(fw.copyright);
    // The content rule: never a package list.
    for (const banned of ['abstractruntime', '0.8.4', '2.23.1', 'abstractvoice', 'Gateway package']) expect(html).not.toContain(banned);
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
  it('fetches GET /api/gateway/about and keeps only framework + gateway versions (kit helper)', async () => {
    const seen: string[] = [];
    vi.mocked(aboutVersionsFromGateway).mockClear();
    const versions = await fetchGatewayAboutVersions(async (path) => {
      seen.push(path);
      return PAYLOAD;
    });
    expect(seen).toEqual(['api/gateway/about']);
    expect(GATEWAY_ABOUT_PATH).toBe('api/gateway/about');
    expect(vi.mocked(aboutVersionsFromGateway)).toHaveBeenCalledWith(PAYLOAD);
    expect(versions).toEqual({ framework: '0.9.6', gateway: '0.12.0' });
  });

  it('framework not installed on the gateway host', async () => {
    const versions = await fetchGatewayAboutVersions(async () => ({ abstractframework: null, abstractgateway: '0.12.0', packages: {} }));
    expect(versions).toEqual({ framework: null, gateway: '0.12.0', frameworkNote: 'not installed on the gateway host' });
  });

  it('an HTTP error is visible in place of the gateway version', async () => {
    vi.mocked(aboutVersionsFromGateway).mockClear();
    const versions = await fetchGatewayAboutVersions(async () => {
      throw new GatewayHttpError('HTTP 404 Not Found: Not Found', 404, null);
    });
    expect(vi.mocked(aboutVersionsFromGateway)).toHaveBeenCalledWith(null, 'HTTP 404 Not Found: Not Found');
    expect(versions.gatewayNote).toBe('unavailable (HTTP 404 Not Found: Not Found)');
    const html = renderToStaticMarkup(createElement(AfAboutDialog, { open: true, onClose: () => {}, identity: ABSTRACTFLOW_IDENTITY, versions }));
    expect(html).toContain('<dd>unavailable (HTTP 404 Not Found: Not Found)</dd>');
  });

  it('a network error is visible too', async () => {
    const versions = await fetchGatewayAboutVersions(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(versions.gatewayNote).toBe('unavailable (Failed to fetch)');
    expect(gatewayAboutErrorReason({ status: 503, message: 'x' })).toBe('HTTP 503: x');
  });

  it('a payload without a gateway version is reported as unavailable', async () => {
    const versions = await fetchGatewayAboutVersions(async () => ({}) as never);
    expect(versions.gatewayNote).toBe('unavailable (the gateway did not report its version)');
  });
});
