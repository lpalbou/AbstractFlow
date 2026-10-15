// Operator 2026-10-11 (run b683459f): each Agent node showed twice in the run
// window ("Reviewer 0ms" then "Reviewer 14.5s"). One Agent execution writes
// several ledger steps (start sub-run, resume, structured-output call); rows
// are one per execution (executionIdFor). Real root ledger of b683459f.
import { describe, expect, it } from 'vitest';
import records from './__fixtures__/agent_phases_ledger.json';
import { createLedgerMappingState, mapLedgerRecordToEvents } from './ledgerEvents';
import type { ExecutionEvent } from '../types/flow';

const ROOT = (records as any[])[0].run_id as string;

function mapped(): ExecutionEvent[] {
  const state = createLedgerMappingState();
  return (records as any[]).flatMap((rec) => mapLedgerRecordToEvents(rec, state));
}

/** The rows the run window builds: one per (run, execId). */
function rows(events: ExecutionEvent[]): Array<{ nodeId: string; execId: string }> {
  const seen = new Map<string, { nodeId: string; execId: string }>();
  for (const ev of events) {
    if ((ev.type === 'node_start' || ev.type === 'node_complete') && ev.runId === ROOT && ev.execId && ev.nodeId) {
      const key = `${ev.runId}:${ev.execId}`;
      if (!seen.has(key)) seen.set(key, { nodeId: ev.nodeId, execId: ev.execId });
    }
  }
  return [...seen.values()];
}

describe('one row per node execution', () => {
  it('an Agent execution (start sub-run, resume, structured-output call) is one row', () => {
    const recs = records as any[];
    const reviewerSteps = recs.filter((r) => r.node_id === 'node-32' && ['17:24:52', '17:25:15'].some((t) => r.started_at.includes(t))).map((r) => r.step_id);
    expect(new Set(reviewerSteps).size).toBeGreaterThanOrEqual(3); // three ledger steps...
    const events = mapped();
    const reviewerExecs = new Set(
      events.filter((e) => e.nodeId === 'node-32' && e.execId && e.stepId && reviewerSteps.includes(e.stepId)).map((e) => e.execId)
    );
    expect(reviewerExecs.size).toBe(1); // ...one execution
  });

  it('every Agent execution is one row, and successive executions of a node stay separate', () => {
    const recs = records as any[];
    const events = mapped();
    const agentRows = rows(events).filter((r) => r.nodeId === 'node-8' || r.nodeId === 'node-32');
    // One sub-run started per Agent execution.
    const subRunStarts = recs.filter((r) => (r.node_id === 'node-8' || r.node_id === 'node-32') && r.effect?.type === 'start_subworkflow' && r.status === 'started');
    expect(agentRows.length).toBe(subRunStarts.length);
    expect(subRunStarts.length).toBeGreaterThan(10);
  });

  it('a resume closes nothing early: no row of the run is left open at the end of a finished phase chain', () => {
    const events = mapped();
    const started = new Set<string>();
    const completed = new Set<string>();
    for (const e of events) {
      if (e.runId !== ROOT || !e.execId) continue;
      if (e.type === 'node_start') started.add(e.execId);
      if (e.type === 'node_complete') completed.add(e.execId);
    }
    // Every execution but the one still running when the fixture was taken has completed.
    expect([...started].filter((id) => !completed.has(id)).length).toBeLessThanOrEqual(1);
  });
});
