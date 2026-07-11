export const RESEARCH_EFFORT_OPTIONS = [
  { value: 'quick', label: 'Quick search' },
  { value: 'standard', label: 'Standard search' },
  { value: 'thorough', label: 'Thorough search' },
];

export function isResearchEffortPin(pinId: string): boolean {
  return pinId === 'effort' || pinId === 'effort_preset';
}

export function normalizeResearchEffort(value: unknown): string {
  if (typeof value !== 'string') return 'standard';
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (normalized === 'quick' || normalized === 'quick search' || normalized === 'quick report' || normalized === 'fast search') {
    return 'quick';
  }
  if (normalized === 'thorough' || normalized === 'thorough search' || normalized === 'thorough report' || normalized === 'deep research') {
    return 'thorough';
  }
  return 'standard';
}
