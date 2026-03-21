import { useQuery } from '@tanstack/react-query';
import type { ProviderInfo } from '../types/flow';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg =
      err && typeof err === 'object' && 'detail' in err && typeof (err as any).detail === 'string'
        ? (err as any).detail
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

export function useProviders(enabled: boolean) {
  return useQuery({
    queryKey: ['providers'],
    queryFn: async () => {
      const res = await fetchJson<{ items?: ProviderInfo[] }>('/api/gateway/discovery/providers');
      if (!Array.isArray(res.items)) {
        console.warn('#FALLBACK: providers response missing items; returning empty list');
        return [];
      }
      return res.items;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useModels(provider: string | undefined, enabled: boolean) {
  const p = (provider || '').trim();
  return useQuery({
    queryKey: ['providers', p, 'models'],
    queryFn: async () => {
      const res = await fetchJson<{ items?: string[]; models?: string[] }>(
        `/api/gateway/discovery/providers/${encodeURIComponent(p)}/models`
      );
      const models = Array.isArray(res.models)
        ? res.models
        : Array.isArray(res.items)
          ? res.items
          : [];
      if (models.length === 0 && !Array.isArray(res.models) && !Array.isArray(res.items)) {
        console.warn('#FALLBACK: provider models response missing models/items; returning empty list');
      }
      return models;
    },
    enabled: enabled && Boolean(p),
    staleTime: 30_000,
  });
}





