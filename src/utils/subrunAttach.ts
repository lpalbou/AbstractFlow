/**
 * Sub-run attach gating (backlog 0138 — subrun-attach tightening).
 *
 * Attaching an agent's cycles/trace to a displayed step is safe when the
 * sub_run_id is proven: from the step's own output, or from an explicit
 * subworkflow link (subworkflow_update events keyed runId:nodeId[:stepId]).
 * The old last-resort heuristic — "latest non-root trace_update runId wins" —
 * silently attached ANOTHER agent's cycles to the selected step whenever two
 * agents ran concurrently.
 */

import type { ExecutionEvent } from '../types/flow';

/**
 * Last-resort candidate for streams whose subworkflow links never carried the
 * selected step's sub_run_id (older gateways). Attach WITHOUT an explicit
 * link only when it cannot be wrong:
 * - exactly ONE distinct non-root sub-run is emitting trace records, and
 * - that sub-run is not claimed by an explicit subworkflow link (a linked
 *   sub-run belongs to a specific node — if it were the selected step's, the
 *   link lookup would already have matched).
 * Two or more unclaimed candidates are ambiguous by construction (the
 * concurrent-agents case) and return null — the caller renders an honest
 * "waiting for sub_run_id" state instead of someone else's cycles.
 */
export function unambiguousSubRunCandidate(args: {
  traceEvents: ExecutionEvent[];
  rootRunId: string | null;
  linkedSubRunIds: Iterable<string>;
}): string | null {
  const linked = new Set<string>();
  for (const id of args.linkedSubRunIds) {
    const v = typeof id === 'string' ? id.trim() : '';
    if (v) linked.add(v);
  }

  const rootId = typeof args.rootRunId === 'string' ? args.rootRunId.trim() : '';
  const candidates = new Set<string>();
  for (const ev of args.traceEvents) {
    if (ev.type !== 'trace_update') continue;
    const rid = typeof ev.runId === 'string' ? ev.runId.trim() : '';
    if (!rid) continue;
    if (rootId && rid === rootId) continue;
    if (linked.has(rid)) continue;
    candidates.add(rid);
    if (candidates.size > 1) return null;
  }

  if (candidates.size !== 1) return null;
  return Array.from(candidates)[0];
}
