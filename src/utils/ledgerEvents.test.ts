import { describe, expect, it } from 'vitest';

import {
  createLedgerMappingState,
  mapLedgerRecordToEvents,
  toolApprovalResumeMarker,
  type LedgerRecord,
} from './ledgerEvents';

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

describe('mapLedgerRecordToEvents — tool-approval resume markers (backlog 0138)', () => {
  function resumeRecord(waitReason: string, payload: Record<string, unknown>): LedgerRecord {
    return {
      run_id: 'run-1',
      step_id: 'step-3',
      node_id: 'tool_calls',
      status: 'completed',
      started_at: '2026-07-21T02:00:00+00:00',
      ended_at: '2026-07-21T02:00:01+00:00',
      effect: { type: 'resume', payload: { wait_reason: waitReason, wait_key: 'tool_calls:run-1:tool_calls', payload } },
      result: { resumed: true },
    };
  }

  it('marks an auto-approved tool-approval resume (result stays suppressed)', () => {
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { approved: true, auto_approved: true }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.result).toBeUndefined();
    expect(complete?.approval).toEqual({ approved: true, auto: true });
  });

  it('marks a manually approved tool-approval resume as non-auto', () => {
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { approved: true }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.approval).toEqual({ approved: true, auto: false });
  });

  it('does not mark denied approvals', () => {
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { approved: false }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.approval).toBeUndefined();
  });

  it('does not mark ordinary user replies', () => {
    const events = mapLedgerRecordToEvents(
      resumeRecord('user', { response: 'yes, continue' }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.approval).toBeUndefined();
  });

  it('does not mark event resumes even when the envelope carries approved:true', () => {
    // An external event payload may coincidentally contain an `approved`
    // key; only WaitReason.USER resumes are tool approvals.
    const events = mapLedgerRecordToEvents(
      resumeRecord('event', { approved: true }),
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.approval).toBeUndefined();
  });

  it('does not mark ordinary (non-resume) completed records', () => {
    const events = mapLedgerRecordToEvents(
      {
        run_id: 'run-1',
        step_id: 'step-4',
        node_id: 'tool_calls',
        status: 'completed',
        result: { approved: true },
      },
      createLedgerMappingState()
    );
    const complete = events.find((ev) => ev.type === 'node_complete');
    expect(complete?.approval).toBeUndefined();
  });
});

describe('toolApprovalResumeMarker (pure helper)', () => {
  it('requires effect.type=resume, result.resumed, wait_reason=user and approved===true', () => {
    const base: LedgerRecord = {
      run_id: 'run-1',
      node_id: 'tool_calls',
      status: 'completed',
      effect: { type: 'resume', payload: { wait_reason: 'user', payload: { approved: true } } },
      result: { resumed: true },
    };
    expect(toolApprovalResumeMarker(base)).toEqual({ approved: true, auto: false });
    expect(
      toolApprovalResumeMarker({ ...base, effect: { type: 'llm_call', payload: {} } })
    ).toBeNull();
    expect(toolApprovalResumeMarker({ ...base, result: { resumed: false } })).toBeNull();
    expect(
      toolApprovalResumeMarker({
        ...base,
        effect: { type: 'resume', payload: { wait_reason: 'job', payload: { approved: true } } },
      })
    ).toBeNull();
    expect(
      toolApprovalResumeMarker({
        ...base,
        // String "true" is not an approval decision — providers/transports
        // must not be able to fabricate the marker with a truthy string.
        effect: { type: 'resume', payload: { wait_reason: 'user', payload: { approved: 'true' } } },
      })
    ).toBeNull();
  });

  it('distinguishes auto from manual via the auto_approved stamp', () => {
    const rec = (payload: Record<string, unknown>): LedgerRecord => ({
      run_id: 'run-1',
      node_id: 'tool_calls',
      status: 'completed',
      effect: { type: 'resume', payload: { wait_reason: 'user', payload } },
      result: { resumed: true },
    });
    expect(toolApprovalResumeMarker(rec({ approved: true, auto_approved: true }))).toEqual({
      approved: true,
      auto: true,
    });
    expect(toolApprovalResumeMarker(rec({ approved: true, auto_approved: 'yes' }))).toEqual({
      approved: true,
      auto: false,
    });
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

describe('mapLedgerRecordToEvents — progress ticks join the running execution (operator 2026-10-16 17:35: one RUNNING card per denoise step)', () => {
  const base = { run_id: 'run-1', node_id: 'node-3', started_at: '2026-10-16T15:32:40Z' };
  const started: LedgerRecord = { ...base, step_id: 'step-A', status: 'started' } as LedgerRecord;
  const tick = (id: string, step: number): LedgerRecord =>
    ({ ...base, step_id: id, status: 'completed', ended_at: `2026-10-16T15:32:${40 + step}Z`, idempotency_key: `system:progress:step-A:${id}`, result: { name: 'abstract.progress', payload: { phase: 'denoise', step, total: 20, percent: step * 5 } } }) as LedgerRecord;
  const done: LedgerRecord = { ...base, step_id: 'step-A', status: 'completed', ended_at: '2026-10-16T15:33:00Z', result: { image_artifact: 'art-1' } } as LedgerRecord;

  it('every tick carries the execution id of the started step, and the completion closes that same execution', () => {
    const state = createLedgerMappingState();
    const kinds = (events: ReturnType<typeof mapLedgerRecordToEvents>) => events.filter((e) => e.type !== 'trace_update');
    const start = kinds(mapLedgerRecordToEvents(started, state));
    expect(start.map((e) => e.type)).toEqual(['node_start']);
    const execId = start[0].execId;
    expect(execId).toBe('step-A');
    const t1 = kinds(mapLedgerRecordToEvents(tick('tick-1', 1), state));
    const t2 = kinds(mapLedgerRecordToEvents(tick('tick-2', 2), state));
    for (const events of [t1, t2]) {
      expect(events.map((e) => e.type)).toEqual(['node_progress']);
      expect(events[0].execId).toBe(execId);
      expect(events[0].nodeId).toBe('node-3');
    }
    expect((t2[0].progress as Record<string, unknown>).step).toBe(2);
    // A tick that lost its idempotency key still joins the node's latest execution.
    const bare = { ...tick('tick-3', 3) } as LedgerRecord;
    delete (bare as Record<string, unknown>).idempotency_key;
    expect(kinds(mapLedgerRecordToEvents(bare, state))[0].execId).toBe(execId);
    // No tick opened an execution of its own: the completion still closes step-A.
    const end = kinds(mapLedgerRecordToEvents(done, state));
    expect(end.map((e) => e.type)).toEqual(['node_complete']);
    expect(end[0].execId).toBe(execId);
  });
});
