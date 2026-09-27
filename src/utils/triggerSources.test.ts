import { describe, expect, it, vi } from 'vitest';
import { GatewayHttpError, type GatewayContracts } from './gatewayClient';
import {
  TRIGGER_SOURCES_DEFAULT_ENDPOINT,
  TriggerSourceCache,
  TriggerSourcesContractError,
  fetchTriggerSources,
  triggerSourcesEndpoint,
} from './triggerSources';
import { MANUAL_V1, SCHEDULE_V1, TRIGGER_SOURCES_RESPONSE } from './triggerSources.fixtures';

const advertised: GatewayContracts = {
  version: 1,
  common: {
    automations: {
      available: true,
      version: 1,
      endpoint: '/api/gateway/automations',
      trigger_sources_endpoint: '/api/gateway/v2-test/trigger-sources',
    },
  },
};

describe('triggerSourcesEndpoint', () => {
  it('takes the path from the capabilities descriptor', () => {
    expect(triggerSourcesEndpoint(advertised)).toBe('/api/gateway/v2-test/trigger-sources');
  });

  it('uses the contract path when the descriptor does not name one', () => {
    expect(triggerSourcesEndpoint({ version: 1, common: {} })).toBe(TRIGGER_SOURCES_DEFAULT_ENDPOINT);
    expect(triggerSourcesEndpoint(null)).toBe('/api/gateway/trigger-sources');
  });
});

describe('fetchTriggerSources', () => {
  it('fetches the advertised path and parses every item', async () => {
    const fetchJson = vi.fn(async () => TRIGGER_SOURCES_RESPONSE);
    const result = await fetchTriggerSources(advertised, fetchJson);
    expect(fetchJson).toHaveBeenCalledWith('/api/gateway/v2-test/trigger-sources');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.items.map((s) => `${s.id}:${s.available}`)).toEqual([
      'schedule:true',
      'manual:true',
      'fixture_source:true',
      'broken_plugin:false',
    ]);
  });

  it('lists unavailable sources as such, with their reason', async () => {
    const result = await fetchTriggerSources(null, async () => TRIGGER_SOURCES_RESPONSE);
    if (result.status !== 'ok') throw new Error('expected ok');
    const broken = result.items.find((s) => s.id === 'broken_plugin');
    expect(broken).toEqual({
      id: 'broken_plugin',
      label: 'broken_plugin',
      available: false,
      unavailable_reason: 'entry point failed to import: ModuleNotFoundError: no module named broken',
    });
    // An unavailable item carries no descriptor: nothing to bind.
    expect(broken && 'config_schema' in broken).toBe(false);
  });

  it('reports a gateway without the route (404) as unavailable, not as an empty list', async () => {
    const result = await fetchTriggerSources(null, async () => {
      throw new GatewayHttpError('HTTP 404', 404, { detail: 'Not Found' });
    });
    expect(result).toEqual({
      status: 'unavailable',
      endpoint: '/api/gateway/trigger-sources',
      reason: 'Trigger sources are unavailable on this gateway.',
    });
  });

  it('reports automations advertised as off without calling the route', async () => {
    const fetchJson = vi.fn(async () => TRIGGER_SOURCES_RESPONSE);
    const result = await fetchTriggerSources({ common: { automations: { available: false } } }, fetchJson);
    expect(result.status).toBe('unavailable');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('throws on other HTTP errors (no silent empty list)', async () => {
    await expect(
      fetchTriggerSources(null, async () => {
        throw new GatewayHttpError('HTTP 500', 500, {});
      })
    ).rejects.toThrow('HTTP 500');
  });

  it('throws when the answer breaks the contract', async () => {
    await expect(fetchTriggerSources(null, async () => ({ sources: [] }))).rejects.toBeInstanceOf(
      TriggerSourcesContractError
    );
    const { config_schema: _dropped, ...noSchema } = SCHEDULE_V1;
    await expect(fetchTriggerSources(null, async () => ({ items: [noSchema] }))).rejects.toThrow(
      'items[0].config_schema is not an object'
    );
    await expect(
      fetchTriggerSources(null, async () => ({ items: [{ ...MANUAL_V1, version: 0 }] }))
    ).rejects.toThrow('items[0].version is not an integer >= 1');
    await expect(
      fetchTriggerSources(null, async () => ({ items: [{ ...MANUAL_V1, available: undefined }] }))
    ).rejects.toThrow('items[0].available is not a boolean');
  });
});

describe('TriggerSourceCache', () => {
  it('caches one answer per gateway URL and re-fetches on explicit refresh', async () => {
    let served: unknown[] = [SCHEDULE_V1];
    const fetchJson = vi.fn(async () => ({ items: served }));
    const cache = new TriggerSourceCache(fetchJson);

    const first = await cache.load('http://127.0.0.1:18900/', null);
    const again = await cache.load('http://127.0.0.1:18900', null);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(again).toBe(first);

    // Another gateway has its own entry.
    await cache.load('http://127.0.0.1:18901', null);
    expect(fetchJson).toHaveBeenCalledTimes(2);

    // The gateway gains a source: only an explicit refresh sees it.
    served = [SCHEDULE_V1, MANUAL_V1];
    const stale = await cache.load('http://127.0.0.1:18900', null);
    expect(stale.status === 'ok' && stale.items.length).toBe(1);
    const refreshed = await cache.load('http://127.0.0.1:18900', null, { refresh: true });
    expect(refreshed.status === 'ok' && refreshed.items.map((s) => s.id)).toEqual(['schedule', 'manual']);
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failure', async () => {
    const fetchJson = vi
      .fn<(path: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new GatewayHttpError('HTTP 503', 503, {}))
      .mockResolvedValueOnce({ items: [MANUAL_V1] });
    const cache = new TriggerSourceCache(fetchJson);
    await expect(cache.load('http://gw', null)).rejects.toThrow('HTTP 503');
    const retry = await cache.load('http://gw', null);
    expect(retry.status).toBe('ok');
  });

  it('refuses to cache without a gateway URL', async () => {
    const cache = new TriggerSourceCache(async () => TRIGGER_SOURCES_RESPONSE);
    await expect(cache.load('', null)).rejects.toThrow('needs the connected gateway URL');
  });
});
