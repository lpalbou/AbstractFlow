import { describe, expect, it } from 'vitest';

import { createLedgerMappingState, mapLedgerRecordToEvents, type LedgerRecord } from './ledgerEvents';

/**
 * Ledger→ExecutionEvent mapping contract tests.
 *
 * Pins the client half of the visit seam-spec clarifications (a2a thread
 * 0013, addendum 081021Z):
 * - spec-mandated ledger records are NODE-ANCHORED (run_id + node_id) — the
 *   mapper's drop of node-less records is a ruled contract, not an accident;
 * - deadline-bearing waits carry `until` beside `wait_key` and
 *   `details.kind` end to end (WAIT_EVENT idle deadline, D3);
 * - event parks are not questions: prompts pass through only when explicit.
 */

function waitingRecord(overrides: Partial<LedgerRecord> = {}, wait: Record<string, unknown> = {}): LedgerRecord {
  return {
    run_id: 'run-1',
    step_id: 'step-1',
    node_id: 'park',
    status: 'waiting',
    started_at: '2026-07-10T08:00:00+00:00',
    result: { wait: { reason: 'event', wait_key: 'visitor_input', ...wait } },
    ...overrides,
  };
}

describe('mapLedgerRecordToEvents — wait passthrough (seam-spec D3 contract)', () => {
  it('carries wait_key, until, and details.kind together on a visitor park', () => {
    const state = createLedgerMappingState();
    const events = mapLedgerRecordToEvents(
      waitingRecord({}, {
        until: '2999-01-01T10:00:00+00:00',
        details: { kind: 'visitor_message' },
      }),
      state
    );
    const waiting = events.find((ev) => ev.type === 'flow_waiting');
    expect(waiting).toBeDefined();
    expect(waiting?.wait_key).toBe('visitor_input');
    expect(waiting?.until).toBe('2999-01-01T10:00:00+00:00');
    expect(waiting?.reason).toBe('event');
    expect((waiting?.details as Record<string, unknown> | undefined)?.kind).toBe('visitor_message');
  });

  it('does not invent a prompt for event parks (prompt only when explicit)', () => {
    const state = createLedgerMappingState();
    const parked = mapLedgerRecordToEvents(waitingRecord(), state);
    const parkedWaiting = parked.find((ev) => ev.type === 'flow_waiting');
    expect(parkedWaiting?.prompt).toBeUndefined();

    const prompted = mapLedgerRecordToEvents(
      waitingRecord({ node_id: 'park2' }, { prompt: 'Send the next payload.' }),
      createLedgerMappingState()
    );
    const promptedWaiting = prompted.find((ev) => ev.type === 'flow_waiting');
    expect(promptedWaiting?.prompt).toBe('Send the next payload.');
  });

  it('keeps user-input waits intact (prompt, choices, allow_free_text)', () => {
    const state = createLedgerMappingState();
    const events = mapLedgerRecordToEvents(
      waitingRecord({ node_id: 'ask' }, {
        reason: 'user',
        wait_key: 'ask_user:1',
        prompt: 'Pick one:',
        choices: ['a', 'b'],
        allow_free_text: false,
      }),
      state
    );
    const waiting = events.find((ev) => ev.type === 'flow_waiting');
    expect(waiting?.prompt).toBe('Pick one:');
    expect(waiting?.choices).toEqual(['a', 'b']);
    expect(waiting?.allow_free_text).toBe(false);
    expect(waiting?.until).toBeUndefined();
  });
});

describe('mapLedgerRecordToEvents — event-park resume payload visibility (backlog 0111)', () => {
  function resumeRecord(waitReason: string, payload: Record<string, unknown>): LedgerRecord {
    return {
      run_id: 'run-1',
      step_id: 'step-2',
      node_id: 'park',
      status: 'completed',
      started_at: '2026-07-10T08:00:00+00:00',
      ended_at: '2026-07-10T08:00:01+00:00',
      effect: { type: 'resume', payload: { wait_reason: waitReason, payload } },
      result: { resumed: true },
    };
  }

  it('surfaces the full event envelope that woke an event park', () => {
    const envelope = {
      event_id: 'ev-1',
      name: 'agent-inbox',
      scope: 'global',
      payload: { kind: 'note', body: 'hello resident' },
      emitter: { source: 'external', client_id: 'cli-1' },
    };
    const events = mapLedgerRecordToEvents(resumeRecord('event', envelope), createLedgerMappingState());
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete).toBeDefined();
    expect(complete?.result).toEqual(envelope);
  });

  it('keeps the narrow visibility rule for user-wait resumes', () => {
    // Internal bookkeeping payloads without recognized reply keys stay
    // suppressed for user waits (approval resumes etc. are not step outputs).
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { approved: true, auto_approved: true }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.result).toBeUndefined();
  });

  it('still surfaces recognized user replies', () => {
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { response: 'yes, continue' }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.result).toEqual({ response: 'yes, continue' });
  });
});

describe('mapLedgerRecordToEvents — node anchoring (0013 addendum ruling)', () => {
  it('drops records without a node_id (spec-mandated records must be node-anchored)', () => {
    const state = createLedgerMappingState();
    const events = mapLedgerRecordToEvents(
      waitingRecord({ node_id: undefined }),
      state
    );
    expect(events).toEqual([]);
  });

  it('drops records without a run_id', () => {
    const state = createLedgerMappingState();
    const events = mapLedgerRecordToEvents(waitingRecord({ run_id: undefined }), state);
    expect(events).toEqual([]);
  });

  it('maps a node-anchored completed record to node_complete + trace_update', () => {
    const state = createLedgerMappingState();
    const events = mapLedgerRecordToEvents(
      {
        run_id: 'run-1',
        step_id: 'step-2',
        node_id: 'grant_tools',
        status: 'completed',
        started_at: '2026-07-10T08:00:00+00:00',
        ended_at: '2026-07-10T08:00:01+00:00',
        result: { granted: ['read_file'] },
      },
      state
    );
    expect(events.map((ev) => ev.type)).toEqual(['node_complete', 'trace_update']);
    expect(events[0].nodeId).toBe('grant_tools');
    expect(events[0].result).toEqual({ granted: ['read_file'] });
  });
});
