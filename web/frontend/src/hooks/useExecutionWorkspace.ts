import { useQuery } from '@tanstack/react-query';

export interface ExecutionWorkspaceInfo {
  base_execution_dir: string;
  default_random_root: string;
  alias_pattern?: string;
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
    queryFn: () => fetchJson<ExecutionWorkspaceInfo>('/api/runs/execution-workspace'),
    enabled,
    staleTime: 30_000,
  });
}

