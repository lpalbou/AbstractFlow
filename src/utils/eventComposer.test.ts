import { describe, expect, it } from 'vitest';
import { buildEmitEventCommandPayload, parseEventWaitKey } from './eventComposer';

describe('parseEventWaitKey (backlog 0111)', () => {
  it('parses the four scopes', () => {
    expect(parseEventWaitKey('evt:global:global:agent-inbox')).toEqual({
      scope: 'global',
      scopeId: 'global',
      name: 'agent-inbox',
    });
    expect(parseEventWaitKey('evt:session:sess-1:visitor_message')).toEqual({
      scope: 'session',
      scopeId: 'sess-1',
      name: 'visitor_message',
    });
    expect(parseEventWaitKey('evt:workflow:wf-2:tick')).toEqual({
      scope: 'workflow',
      scopeId: 'wf-2',
      name: 'tick',
    });
    expect(parseEventWaitKey('evt:run:run-3:done')).toEqual({ scope: 'run', scopeId: 'run-3', name: 'done' });
  });

  it('keeps colons inside event names', () => {
    expect(parseEventWaitKey('evt:global:global:abstract.chat.thread:42')).toEqual({
      scope: 'global',
      scopeId: 'global',
      name: 'abstract.chat.thread:42',
    });
  });

  it('rejects non-event keys honestly', () => {
    expect(parseEventWaitKey('subworkflow:abc')).toBeNull();
    expect(parseEventWaitKey('pause:xyz')).toBeNull();
    expect(parseEventWaitKey('evt:unknown:x:name')).toBeNull();
    expect(parseEventWaitKey('evt:global:global:')).toBeNull();
    expect(parseEventWaitKey('')).toBeNull();
    expect(parseEventWaitKey(undefined)).toBeNull();
  });
});

describe('buildEmitEventCommandPayload (backlog 0111)', () => {
  it('maps the scope id onto the field the gateway reads for each scope', () => {
    expect(
      buildEmitEventCommandPayload({ scope: 'session', scopeId: 's1', name: 'ping' }, { a: 1 })
    ).toEqual({ name: 'ping', scope: 'session', payload: { a: 1 }, session_id: 's1' });
    expect(
      buildEmitEventCommandPayload({ scope: 'workflow', scopeId: 'w1', name: 'ping' }, {})
    ).toEqual({ name: 'ping', scope: 'workflow', payload: {}, workflow_id: 'w1' });
    expect(buildEmitEventCommandPayload({ scope: 'run', scopeId: 'r1', name: 'ping' }, {})).toEqual({
      name: 'ping',
      scope: 'run',
      payload: {},
      run_id: 'r1',
    });
    expect(buildEmitEventCommandPayload({ scope: 'global', scopeId: 'global', name: 'ping' }, {})).toEqual({
      name: 'ping',
      scope: 'global',
      payload: {},
    });
  });

  it('adds durable only when requested', () => {
    const parsed = { scope: 'global' as const, scopeId: 'global', name: 'inbox' };
    expect(buildEmitEventCommandPayload(parsed, {}, { durable: true }).durable).toBe(true);
    expect('durable' in buildEmitEventCommandPayload(parsed, {})).toBe(false);
  });
});
