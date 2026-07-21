import { describe, expect, it } from 'vitest';
import { classifyWait, isInteractiveWait, waitNotificationText } from './waitClassification';

// Backlog 0138: waits must be classified by what they need FROM THE USER so
// event/deadline parks stop force-opening the modal, while approvals and
// asks still surface. Reason vocabulary matches the ledger exactly.

describe('classifyWait', () => {
  it('tool approval → approval (regardless of reason)', () => {
    expect(classifyWait({ reason: 'user', details: { mode: 'approval_required' } })).toBe('approval');
    expect(classifyWait({ reason: '', details: { kind: 'tool_approval' } })).toBe('approval');
  });

  it('ask_user (reason "user") → prompt', () => {
    expect(classifyWait({ reason: 'user', prompt: 'What is your name?' })).toBe('prompt');
    // Even with only the synthesized placeholder, a user reason is a prompt.
    expect(classifyWait({ reason: 'user' })).toBe('prompt');
  });

  it('event park with no host prompt → park (no interruption)', () => {
    expect(classifyWait({ reason: 'event' })).toBe('park');
    expect(classifyWait({ reason: 'event', prompt: 'Please respond:' })).toBe('park');
  });

  it('deadline waits → park', () => {
    expect(classifyWait({ reason: 'wait_until' })).toBe('park');
    expect(classifyWait({ reason: 'timer' })).toBe('park');
  });

  it('subworkflow → park', () => {
    expect(classifyWait({ reason: 'subworkflow' })).toBe('park');
  });

  it('event/wait_event authored as a user ask (real prompt or choices) → prompt', () => {
    expect(classifyWait({ reason: 'event', prompt: 'Pick a branch' })).toBe('prompt');
    expect(classifyWait({ reason: 'wait_event', choices: ['a', 'b'] })).toBe('prompt');
  });

  it('unknown reason: real prompt → prompt, bare → park', () => {
    expect(classifyWait({ reason: 'mystery', prompt: 'Answer me' })).toBe('prompt');
    expect(classifyWait({ reason: 'mystery' })).toBe('park');
    expect(classifyWait({})).toBe('park');
  });

  it('placeholder prompts never count as a host prompt', () => {
    expect(classifyWait({ reason: 'event', prompt: '  Please respond  ' })).toBe('park');
    expect(classifyWait({ reason: 'event', prompt: '' })).toBe('park');
    expect(classifyWait({ reason: 'event', choices: [] })).toBe('park');
  });
});

describe('isInteractiveWait', () => {
  it('approval and prompt are interactive; park is not', () => {
    expect(isInteractiveWait({ details: { mode: 'approval_required' } })).toBe(true);
    expect(isInteractiveWait({ reason: 'user' })).toBe(true);
    expect(isInteractiveWait({ reason: 'event' })).toBe(false);
    expect(isInteractiveWait({ reason: 'wait_until' })).toBe(false);
  });
});

describe('waitNotificationText', () => {
  it('parks produce no toast; interactive waits get honest wording', () => {
    expect(waitNotificationText('approval')).toMatch(/approval/i);
    expect(waitNotificationText('prompt')).toMatch(/response/i);
    expect(waitNotificationText('park')).toBeNull();
  });
});
