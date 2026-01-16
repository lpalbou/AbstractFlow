import { useMemo } from 'react';

import { AgentCyclesPanel, type TraceItem, type TraceStep } from '@abstractuic/monitor-flow';

import type { ExecutionEvent } from '../types/flow';

interface AgentSubrunTracePanelProps {
  rootRunId: string | null;
  events: ExecutionEvent[];
  subRunId?: string | null;
  title?: string;
  subtitle?: string;
  onOpenSubRun?: () => void;
}

export function AgentSubrunTracePanel({
  rootRunId,
  events,
  subRunId,
  title,
  subtitle,
  onOpenSubRun,
}: AgentSubrunTracePanelProps) {
  const items = useMemo<TraceItem[]>(() => {
    if (!rootRunId) return [];
    const out: TraceItem[] = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type !== 'trace_update') continue;
      if (!ev.runId || ev.runId === rootRunId) continue;
      if (subRunId && ev.runId !== subRunId) continue;
      const nodeId = ev.nodeId;
      if (!nodeId) continue;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      for (let j = 0; j < steps.length; j++) {
        const st = steps[j];
        if (!st || typeof st !== 'object') continue;
        const step = st as TraceStep;
        const ts = typeof step.ts === 'string' ? step.ts : undefined;
        const status = typeof step.status === 'string' ? step.status : 'unknown';
        out.push({
          id: `trace:${ev.runId}:${nodeId}:${i}:${j}:${ts || ''}`,
          runId: ev.runId,
          nodeId,
          ts,
          status,
          step,
        });
      }
    }

    // Best-effort sort by trace timestamp (fallback to arrival order).
    out.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : NaN;
      const tb = b.ts ? new Date(b.ts).getTime() : NaN;
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      return 0;
    });

    return out;
  }, [events, rootRunId, subRunId]);

  if (!rootRunId) return null;

  return (
    <AgentCyclesPanel
      items={items}
      subRunId={subRunId}
      title={title}
      subtitle={subtitle}
      onOpenSubRun={onOpenSubRun}
    />
  );
}

