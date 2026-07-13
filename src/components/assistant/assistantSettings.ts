/** Cycle-cap setting shared by the composer and the authoring loop (leaf module). */

/** User-selectable cap on autonomous planning cycles per turn. */
export const AUTHORING_CYCLE_OPTIONS = [10, 20, 40, 60, 80] as const;
export const AUTHORING_DEFAULT_MAX_CYCLES = 40;

/** Coerce any persisted/foreign value to a supported cycle cap (default 40). */
export function normalizeMaxCycles(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed === 'number' && (AUTHORING_CYCLE_OPTIONS as readonly number[]).includes(parsed)) return parsed;
  return AUTHORING_DEFAULT_MAX_CYCLES;
}
