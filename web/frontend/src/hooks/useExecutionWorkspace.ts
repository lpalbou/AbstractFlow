import { useQuery } from '@tanstack/react-query';

export interface ExecutionWorkspaceInfo {
  default_random_root?: string;
  policy?: Record<string, unknown>;
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

export function useExecutionWorkspace(enabled: boolean) {
  return useQuery({
    queryKey: ['runs', 'execution-workspace'],
    queryFn: async () => {
      const res = await fetchJson<{ policy?: Record<string, unknown> }>('/api/gateway/workspace/policy');
      const policy = res && typeof res === 'object' ? res.policy : undefined;
      if (!policy || typeof policy !== 'object') {
        console.warn('#FALLBACK: workspace policy missing; UI defaults may be incomplete');
      }
      return { default_random_root: '', policy };
    },
    enabled,
    staleTime: 30_000,
  });
}

