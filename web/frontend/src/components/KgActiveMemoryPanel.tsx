import { useCallback, useMemo } from 'react';

import { KgActiveMemoryExplorer, type JsonValue, type KgAssertion, type KgQueryParams, type KgQueryResult } from '@abstractuic/monitor-active-memory';

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
  const packets = useMemo(() => (Array.isArray(obj?.packets) ? (obj?.packets as JsonValue[]) : []), [obj?.packets]);
  const packetsVersion = useMemo(() => (typeof obj?.packets_version === 'number' ? obj?.packets_version : undefined), [obj?.packets_version]);
  const packedCount = useMemo(() => (typeof obj?.packed_count === 'number' ? obj?.packed_count : undefined), [obj?.packed_count]);
  const dropped = useMemo(() => (typeof obj?.dropped === 'number' ? obj?.dropped : undefined), [obj?.dropped]);
  const estimatedTokens = useMemo(() => (typeof obj?.estimated_tokens === 'number' ? obj?.estimated_tokens : undefined), [obj?.estimated_tokens]);

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

  return (
    <div style={{ marginBottom: 14 }}>
      <KgActiveMemoryExplorer
        title={title}
        items={items}
        activeMemoryText={activeMemoryText}
        packets={packets}
        packetsVersion={packetsVersion}
        packedCount={packedCount}
        dropped={dropped}
        estimatedTokens={estimatedTokens}
        onQuery={onQuery}
      />
    </div>
  );
}
