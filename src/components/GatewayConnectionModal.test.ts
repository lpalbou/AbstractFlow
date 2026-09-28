import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGatewayConnection, hasBrowserGatewaySession, type GatewayConnectionStatus } from './GatewayConnectionModal';

const signedIn: GatewayConnectionStatus = {
  ok: true,
  gateway_url: 'http://127.0.0.1:8080',
  has_session: true,
  gateway: { principal: { user_id: 'admin', source: 'user-registry' }, auth: { mode: 'users', user_auth_enabled: true } },
};

describe('the app-server session answer (@abstractframework/app-server)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signed in: the gateway accepted the session of a named user', () => {
    expect(hasBrowserGatewaySession(signedIn)).toBe(true);
  });

  it('not signed in: no session, a refused session, no user, or a legacy shared token', () => {
    expect(hasBrowserGatewaySession(null)).toBe(false);
    expect(hasBrowserGatewaySession({ ok: false, gateway_url: '', has_session: false, gateway: { error: 'Gateway sign-in required' } })).toBe(false);
    expect(hasBrowserGatewaySession({ ...signedIn, ok: false, gateway: { detail: 'unauthorized' } })).toBe(false);
    expect(hasBrowserGatewaySession({ ...signedIn, gateway: { principal: {} } })).toBe(false);
    expect(hasBrowserGatewaySession({ ...signedIn, gateway: { ...signedIn.gateway, auth: { mode: 'legacy-token' } } })).toBe(false);
    expect(hasBrowserGatewaySession({ ...signedIn, gateway: { principal: { user_id: 'x', source: 'legacy-token' } } })).toBe(false);
  });

  it('asks the app server at a RELATIVE path (under / or /apps/flow/)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(signedIn), { status: 200 });
    });
    await expect(fetchGatewayConnection()).resolves.toEqual(signedIn);
    expect(urls).toEqual(['api/connection/gateway']);
  });
});
