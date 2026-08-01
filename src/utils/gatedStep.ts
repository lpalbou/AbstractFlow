/**
 * Which run step is BLOCKING on the user.
 *
 * The run view follows live execution, but any manual click disarms following
 * for the rest of the run. A question that blocks the run is not live noise —
 * without a dedicated rule an operator sits watching a run that looks busy
 * while it silently waits for an answer (observed on a plan-approval gate).
 *
 * A `subworkflow` wait is NOT a user block: the parent is parked on its child,
 * the run is progressing, and that row deliberately renders as RUNNING.
 */

export interface GatedStepLike {
  id: string;
  status?: string;
  waiting?: { reason?: string; waitKey?: string } | null;
}

/** The wait reason that means "parked on a child run", not "needs a human". */
const NON_BLOCKING_WAIT_REASONS = new Set(['subworkflow']);

/**
 * The innermost/most recent step waiting on a human, or null.
 * Scanned from the end so a nested gate wins over an outer one.
 */
export function findGatedStep<T extends GatedStepLike>(steps: readonly T[]): T | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step || step.status !== 'waiting') continue;
    const reason = typeof step.waiting?.reason === 'string' ? step.waiting.reason.toLowerCase() : '';
    if (NON_BLOCKING_WAIT_REASONS.has(reason)) continue;
    return step;
  }
  return null;
}

/**
 * Identity of one gate occurrence. Re-entering the SAME node for a second
 * approval round yields a new key (so the view jumps again), while re-renders
 * of one wait yield the same key (so the view does not fight the user).
 */
export function gatedStepKey(step: GatedStepLike): string {
  return `${step.id}::${step.waiting?.waitKey || ''}`;
}
