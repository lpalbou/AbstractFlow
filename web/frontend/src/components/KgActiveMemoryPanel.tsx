import { useCallback, useMemo } from 'react';

import { KgActiveMemoryExplorer, type KgAssertion, type KgQueryParams, type KgQueryResult } from '@abstractuic/monitor-active-memory';

interface KgActiveMemoryPanelProps {
  runId: string | null;
  title?: string;
  output: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalizeAssertions(raw: unknown): KgAssertion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => x as KgAssertion)
    .filter((a) => typeof a.subject === 'string' && typeof a.predicate === 'string' && typeof a.object === 'string');
}

export function KgActiveMemoryPanel({ runId, title, output }: KgActiveMemoryPanelProps) {
  const obj = asRecord(output);
  const items = useMemo(() => normalizeAssertions(obj?.items), [obj?.items]);
  const activeMemoryText = useMemo(() => (typeof obj?.active_memory_text === 'string' ? obj.active_memory_text : ''), [obj?.active_memory_text]);

  const onQuery = useCallback(
    async (params: KgQueryParams): Promise<KgQueryResult> => {
      if (!runId) throw new Error('run_id is missing');
      const res = await fetch('/api/memory/kg/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, run_id: runId }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `KG query failed (HTTP ${res.status})`);
      }
      return (await res.json()) as KgQueryResult;
    },
    [runId]
  );

  if (!items.length && !activeMemoryText) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <KgActiveMemoryExplorer title={title} items={items} activeMemoryText={activeMemoryText} onQuery={onQuery} />
    </div>
  );
}

