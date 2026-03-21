import { useQuery } from '@tanstack/react-query';

export interface ToolSpec {
  name: string;
  description?: string;
  /**
   * Tool parameter schema (best-effort, JSON-safe).
   * Convention: absence of `default` means "required".
   */
  parameters?: Record<string, { type?: string; default?: any }>;
  required_args?: string[];
  toolset?: string;
  tags?: string[];
  when_to_use?: string;
  examples?: unknown[];
}

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

export function useTools(enabled: boolean) {
  return useQuery({
    queryKey: ['tools'],
    queryFn: async () => {
      const res = await fetchJson<{ items?: ToolSpec[] }>('/api/gateway/discovery/tools');
      if (!Array.isArray(res.items)) {
        console.warn('#FALLBACK: tools response missing items; returning empty list');
        return [];
      }
      return res.items;
    },
    enabled,
    staleTime: 30_000,
  });
}
