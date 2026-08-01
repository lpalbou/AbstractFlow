import { describe, expect, it } from 'vitest';
import { findGatedStep, gatedStepKey, type GatedStepLike } from './gatedStep';

const step = (id: string, status?: string, reason?: string, waitKey?: string): GatedStepLike => ({
  id,
  status,
  waiting: reason || waitKey ? { reason, waitKey } : undefined,
});

describe('findGatedStep', () => {
  it('finds a step waiting on the user', () => {
    const steps = [step('a', 'completed'), step('gate1', 'waiting', 'user')];
    expect(findGatedStep(steps)?.id).toBe('gate1');
  });

  // The regression this exists for: the run looked busy while it was actually
  // blocked on a question, because a subworkflow wait renders as RUNNING and
  // nothing distinguished it from a real gate.
  it('ignores a subworkflow wait — that is the parent parked on its child', () => {
    const steps = [step('build', 'waiting', 'subworkflow')];
    expect(findGatedStep(steps)).toBeNull();
  });

  it('finds the gate even when a subworkflow wait sits after it', () => {
    const steps = [
      step('gate1', 'waiting', 'user'),
      step('build', 'waiting', 'subworkflow'),
    ];
    expect(findGatedStep(steps)?.id).toBe('gate1');
  });

  it('returns the most recent gate when several are waiting', () => {
    const steps = [step('gate1', 'waiting', 'user'), step('gate2', 'waiting', 'user')];
    expect(findGatedStep(steps)?.id).toBe('gate2');
  });

  it('treats a tool-approval wait as a gate', () => {
    expect(findGatedStep([step('act', 'waiting', 'tool_calls')])?.id).toBe('act');
  });

  it('is case-insensitive on the reason', () => {
    expect(findGatedStep([step('build', 'waiting', 'SUBWORKFLOW')])).toBeNull();
  });

  it('treats a waiting step with no reason as a gate (fail visible, not silent)', () => {
    expect(findGatedStep([step('ask', 'waiting')])?.id).toBe('ask');
  });

  it('ignores running and completed steps', () => {
    expect(findGatedStep([step('a', 'running'), step('b', 'completed')])).toBeNull();
  });

  it('handles an empty list', () => {
    expect(findGatedStep([])).toBeNull();
  });
});

describe('gatedStepKey', () => {
  it('distinguishes two approval rounds on the SAME node, so the view jumps again', () => {
    const first = step('gate2', 'waiting', 'user', 'ask:round-1');
    const second = step('gate2', 'waiting', 'user', 'ask:round-2');
    expect(gatedStepKey(first)).not.toBe(gatedStepKey(second));
  });

  it('is stable across re-renders of one wait, so the view does not fight the user', () => {
    const a = step('gate1', 'waiting', 'user', 'ask:1');
    const b = step('gate1', 'waiting', 'user', 'ask:1');
    expect(gatedStepKey(a)).toBe(gatedStepKey(b));
  });
});
