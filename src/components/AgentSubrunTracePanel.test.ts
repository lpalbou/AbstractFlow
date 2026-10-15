// Operator 2026-10-11 (run 15dc6e47): agent cycles showed "WAITING" with every
// approved tool twice. The runtime parks a tool call needing approval and, once
// approved, records its execution under a NEW step_id with the SAME
// idempotency key; the trace grouped by step_id only.
import { describe, expect, it } from 'vitest';
import records from './__fixtures__/approved_tool_call_ledger.json';
import { buildTraceItems, ledgerStepKey } from './AgentSubrunTracePanel';
import { createLedgerMappingState, mapLedgerRecordToEvents } from '../utils/ledgerEvents';
import type { ExecutionEvent } from '../types/flow';

const SUB = '615ab196-8834-4360-8e24-0a09cbe736ba';

function eventsOf(recs: Array<Record<string, unknown>>): ExecutionEvent[] {
  const state = createLedgerMappingState();
  return recs.flatMap((rec) => mapLedgerRecordToEvents(rec as any, state));
}

describe('agent trace steps', () => {
  it('an approved tool call is one step, completed, not a waiting step plus a copy', () => {
    const items = buildTraceItems(eventsOf(records as any), 'root-run', SUB);
    const tools = items.filter((item) => (item.step as any).effect?.type === 'tool_calls');
    expect(tools.map((item) => [item.status, (item.step as any).effect.payload.tool_calls.map((c: any) => c.name).join(',')])).toEqual([
      ['completed', 'read_file,read_file,analyze_code,analyze_code,analyze_code'],
      ['completed', 'edit_file'],
    ]);
  });

  it('keys tool calls by idempotency key, everything else by step id', () => {
    expect(ledgerStepKey({ effect: { type: 'tool_calls' }, idempotency_key: 'k1' }, 's1')).toBe('idem:k1');
    expect(ledgerStepKey({ effect: { type: 'tool_calls' } }, 's1')).toBe('s1');
    expect(ledgerStepKey({ effect: { type: 'llm_call' }, idempotency_key: 'k1' }, 's1')).toBe('s1');
  });
});
