import { useQuery } from '@tanstack/react-query';

export interface ToolSpec {
  name: string;
  description?: string;
  toolset?: string;
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
    queryFn: () => fetchJson<ToolSpec[]>('/api/tools'),
    enabled,
    staleTime: 30_000,
  });
}

