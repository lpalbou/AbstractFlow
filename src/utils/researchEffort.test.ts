import { describe, expect, it } from 'vitest';
import { isResearchEffortPin, normalizeResearchEffort } from './researchEffort';

describe('research effort controls', () => {
  it('normalizes supported effort labels', () => {
    expect(normalizeResearchEffort('quick search')).toBe('quick');
    expect(normalizeResearchEffort('Standard search')).toBe('standard');
    expect(normalizeResearchEffort('deep research')).toBe('thorough');
    expect(normalizeResearchEffort('Thorough report')).toBe('thorough');
  });

  it('recognizes current and legacy effort pin ids', () => {
    expect(isResearchEffortPin('effort')).toBe(true);
    expect(isResearchEffortPin('effort_preset')).toBe(true);
    expect(isResearchEffortPin('max_iterations')).toBe(false);
  });
});
