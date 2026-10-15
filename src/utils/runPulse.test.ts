// Operator 2026-10-11: while a run goes on, show elapsed time, the best
// estimate of what is left and what it has done so far.
import { describe, expect, it } from 'vitest';
import records from '../components/__fixtures__/approved_tool_call_ledger.json';
import { createLedgerMappingState, mapLedgerRecordToEvents } from './ledgerEvents';
import { computeRunPulse, estimateRemaining, toolKind } from './runPulse';
import { estimateText, pulseChips } from '../components/RunPulseBar';
import type { ExecutionEvent } from '../types/flow';

const SUB = '615ab196-8834-4360-8e24-0a09cbe736ba';
const ROOT = 'root-run';
const events = (recs: Array<Record<string, unknown>>): ExecutionEvent[] => {
  const state = createLedgerMappingState();
  return recs.flatMap((rec) => mapLedgerRecordToEvents(rec as any, state));
};
const llm = (run: string, step: string, usage: Record<string, number>) => ({
  run_id: run,
  step_id: step,
  node_id: 'reason',
  status: 'completed',
  effect: { type: 'llm_call', payload: {} },
  result: { content: 'x', usage },
  started_at: '2026-10-11T15:56:00+00:00',
  ended_at: '2026-10-11T15:56:05+00:00',
});

describe('run pulse', () => {
  it('counts tools by kind across the run tree, an approved call once, and its approval', () => {
    const p = computeRunPulse(events(records as any), ROOT);
    // Fixture: read_file x2 + analyze_code x3 in one step; one approved edit_file.
    expect([p.toolCalls, p.filesRead, p.filesWritten, p.approvals, p.subRuns]).toEqual([6, 5, 1, 1, 1]);
    expect(p.toolFailures).toBe((records as any[]).filter((r) => r.step_id.startsWith('e8be0d59')).flatMap((r) => r.result.results).filter((x: any) => !x.success).length);
  });

  it('adds model tokens, and keeps a total that has no input/output split apart', () => {
    const p = computeRunPulse(
      events([
        llm(ROOT, 'a', { input_tokens: 1000, output_tokens: 50 }),
        llm(SUB, 'b', { prompt_tokens: 200, completion_tokens: 20 }),
        llm(SUB, 'c', { input_tokens: 0, output_tokens: 0, total_tokens: 4157 }),
        // The Responses-dialect case seen on run b683459f: the split survives only in the raw response.
        { ...llm(SUB, 'd', { input_tokens: 0, output_tokens: 0, total_tokens: 6568 }), result: { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 6568 }, raw_response: { usage: { input_tokens: 6340, output_tokens: 228, total_tokens: 6568 } } } },
      ]),
      ROOT
    );
    expect([p.modelCalls, p.inputTokens, p.outputTokens, p.unsplitTokens]).toEqual([4, 7540, 298, 4157]);
    expect(pulseChips(p)).toEqual(['4 model calls', '7.5k tokens in · 298 out', '4.2k tokens (no in/out split)', '1 sub-run']);
  });

  it('classifies the tools people care about', () => {
    expect(['read_file', 'edit_file', 'search_files', 'web_search', 'fetch_url', 'execute_command', 'remember'].map(toolKind)).toEqual([
      'read',
      'write',
      'search',
      'web_search',
      'fetch',
      'command',
      'other',
    ]);
  });

  it('estimates from the median of finished runs of the flow, and says so when there is none', () => {
    const run = (status: string, minutes: number) => ({
      status,
      created_at: '2026-10-11T10:00:00Z',
      updated_at: new Date(Date.parse('2026-10-11T10:00:00Z') + minutes * 60000).toISOString(),
    });
    const past = [run('completed', 30), run('completed', 50), run('completed', 40), run('cancelled', 5), run('failed', 1)];
    expect(estimateRemaining(10 * 60000, past)).toEqual({ typicalMs: 40 * 60000, sample: 3, remainingMs: 30 * 60000 });
    expect(estimateText(estimateRemaining(10 * 60000, past))).toBe('About 30 min left (typical run 40 min, median of 3)');
    expect(estimateText(estimateRemaining(55 * 60000, past))).toBe('Longer than the typical run (typical run 40 min, median of 3)');
    expect(estimateRemaining(60000, [run('cancelled', 5)])).toBeNull();
    expect(estimateText(null)).toBe('No estimate yet: this flow has no finished run to compare with');
  });
});
