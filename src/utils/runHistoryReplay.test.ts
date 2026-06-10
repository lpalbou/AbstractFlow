import { describe, expect, it } from 'vitest';

import type { ExecutionEvent } from '../types/flow';
import { extractPendingApprovalWait, extractReplayTraceEvents } from './runHistoryReplay';

const approvalWait: ExecutionEvent = {
  type: 'flow_waiting',
  runId: 'run-child',
  nodeId: 'node-agent',
  prompt: 'Approve tool call?',
  choices: [],
  allow_free_text: false,
  wait_key: 'approval:1',
  reason: 'user',
  details: { mode: 'approval_required', tool_calls: [{ name: 'execute_command' }] },
};

describe('run history replay helpers', () => {
  it('extracts trace_update events for replayed agent panels', () => {
    const trace: ExecutionEvent = {
      type: 'trace_update',
      runId: 'run-child',
      nodeId: 'node-agent',
      steps: [{ step_id: 'step-1', status: 'completed' }],
    };

    expect(extractReplayTraceEvents([{ type: 'flow_start', runId: 'run-root' }, trace])).toEqual([trace]);
  });

  it('keeps an unresolved approval wait pending', () => {
    expect(extractPendingApprovalWait([approvalWait])).toMatchObject({
      runId: 'run-child',
      nodeId: 'node-agent',
      waitKey: 'approval:1',
      allowFreeText: false,
    });
  });

  it('clears stale approval waits when the waiting node completes', () => {
    expect(
      extractPendingApprovalWait([
        approvalWait,
        { type: 'node_complete', runId: 'run-child', nodeId: 'node-agent', result: { ok: true } },
      ])
    ).toBeNull();
  });

  it('clears stale approval waits when the waiting run completes', () => {
    expect(extractPendingApprovalWait([approvalWait, { type: 'flow_complete', runId: 'run-child' }])).toBeNull();
  });
});
