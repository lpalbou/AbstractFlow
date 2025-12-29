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
    queryFn: () => fetchJson<ProviderInfo[]>('/api/providers'),
    enabled,
    staleTime: 30_000,
  });
}

export function useModels(provider: string | undefined, enabled: boolean) {
  const p = (provider || '').trim();
  return useQuery({
    queryKey: ['providers', p, 'models'],
    queryFn: () => fetchJson<string[]>(`/api/providers/${encodeURIComponent(p)}/models`),
    enabled: enabled && Boolean(p),
    staleTime: 30_000,
  });
}



