import { describe, expect, it } from 'vitest';

import { unambiguousSubRunCandidate } from './subrunAttach';
import type { ExecutionEvent } from '../types/flow';

/**
 * Sub-run attach gate (backlog 0138 — subrun-attach tightening).
 *
 * Pins the concurrency contract: the last-resort attach may only fire when
 * exactly one distinct unclaimed sub-run is emitting traces. Two concurrent
 * agents (two unclaimed sub-runs) MUST resolve to null — the old "latest
 * trace_update runId wins" heuristic attached another agent's cycles to the
 * selected step.
 */

function trace(runId: string): ExecutionEvent {
  return { type: 'trace_update', runId, nodeId: 'inner', steps: [{}] };
}

describe('unambiguousSubRunCandidate', () => {
  it('returns the single unclaimed sub-run (live single-agent case)', () => {
    const result = unambiguousSubRunCandidate({
      traceEvents: [trace('root'), trace('sub-a'), trace('sub-a')],
      rootRunId: 'root',
      linkedSubRunIds: [],
    });
    expect(result).toBe('sub-a');
  });

  it('returns null when two concurrent unclaimed sub-runs emit traces', () => {
    const result = unambiguousSubRunCandidate({
      traceEvents: [trace('sub-a'), trace('sub-b'), trace('sub-a')],
      rootRunId: 'root',
      linkedSubRunIds: [],
    });
    expect(result).toBeNull();
  });

  it('excludes sub-runs claimed by explicit subworkflow links', () => {
    // sub-b is linked to some other node; if it were the selected step's,
    // the link lookup would already have matched before this fallback.
    const result = unambiguousSubRunCandidate({
      traceEvents: [trace('sub-a'), trace('sub-b')],
      rootRunId: 'root',
      linkedSubRunIds: ['sub-b'],
    });
    expect(result).toBe('sub-a');
  });

  it('returns null when the only candidate is claimed by a link', () => {
    const result = unambiguousSubRunCandidate({
      traceEvents: [trace('sub-b')],
      rootRunId: 'root',
      linkedSubRunIds: ['sub-b'],
    });
    expect(result).toBeNull();
  });

  it('ignores root-run traces and non-trace events', () => {
    const result = unambiguousSubRunCandidate({
      traceEvents: [
        trace('root'),
        { type: 'node_complete', runId: 'sub-x', nodeId: 'n' },
      ],
      rootRunId: 'root',
      linkedSubRunIds: [],
    });
    expect(result).toBeNull();
  });

  it('returns null with no candidates at all', () => {
    expect(
      unambiguousSubRunCandidate({ traceEvents: [], rootRunId: 'root', linkedSubRunIds: [] })
    ).toBeNull();
  });
});
