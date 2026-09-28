import { afterEach, describe, expect, it, vi } from 'vitest';

import { endpointFromDescriptor, gatewayFetch, gatewayPath, gatewayRequestPath } from './gatewayClient';

describe('gateway requests are relative to the page base (/ or /apps/flow/)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gatewayRequestPath: an advertised rooted endpoint, a relative one and an API route', () => {
    expect(gatewayRequestPath('/api/gateway/runs')).toBe('api/gateway/runs');
    expect(gatewayRequestPath('api/gateway/runs?x=1')).toBe('api/gateway/runs?x=1');
    expect(gatewayRequestPath('about')).toBe('api/gateway/about');
    expect(gatewayRequestPath('')).toBe('api/gateway');
  });

  it('gatewayRequestPath refuses any other rooted path (the kit rule)', () => {
    expect(() => gatewayRequestPath('/about')).toThrow(/relative to the gateway API/);
    expect(() => gatewayRequestPath('/api/connection/gateway')).toThrow(/relative to the gateway API/);
  });

  it('resolves under the gateway mount and at the root', () => {
    expect(new URL(gatewayRequestPath('/api/gateway/runs'), 'http://gw.example/apps/flow/').pathname).toBe('/apps/flow/api/gateway/runs');
    expect(new URL(gatewayRequestPath('/api/gateway/runs'), 'http://127.0.0.1:3003/').pathname).toBe('/api/gateway/runs');
  });

  it('gatewayPath / endpointFromDescriptor: fallbacks and advertised descriptors come out relative', () => {
    expect(gatewayPath('api/gateway/runs/{run_id}', { run_id: 'r 1' })).toBe('api/gateway/runs/r%201');
    expect(endpointFromDescriptor({ endpoint: '/api/gateway/v2/runs' }, 'api/gateway/runs')).toBe('api/gateway/v2/runs');
    expect(gatewayPath('about', {}, { a: 1 })).toBe('api/gateway/about?a=1');
  });

  it('gatewayFetch requests the relative URL (an advertised rooted one too) and adds the CSRF twin on writes', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('document', { cookie: 'abstractflow_gateway_csrf=abc%20d; other=1' });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    await gatewayFetch('/api/gateway/visualflows', { method: 'POST', body: '{}' });
    expect(calls[0][0]).toBe('api/gateway/visualflows');
    expect(new Headers(calls[0][1]?.headers).get('X-AbstractFlow-CSRF')).toBe('abc d');
  });
});
