import { useQuery } from '@tanstack/react-query';

export type SemanticsPredicate = {
  id: string;
  label?: string | null;
  inverse?: string | null;
  description?: string | null;
};

export type SemanticsEntityType = {
  id: string;
  label?: string | null;
  parent?: string | null;
  description?: string | null;
};

export type SemanticsRegistry = {
  ok: boolean;
  version: number;
  prefixes: Record<string, string>;
  predicates: SemanticsPredicate[];
  entity_types: SemanticsEntityType[];
};

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

export function useSemanticsRegistry(enabled: boolean) {
  return useQuery({
    queryKey: ['semantics-registry'],
    queryFn: () => fetchJson<SemanticsRegistry>('/api/semantics'),
    enabled,
    staleTime: 60_000,
  });
}

