/**
 * Classify a run wait by what it needs FROM THE USER (backlog 0138).
 *
 * The run modal renders every wait honestly, but OUTSIDE the modal a wait's
 * interactivity decides whether we interrupt the user. The old behavior
 * force-opened the modal + toasted "waiting for your response" for every
 * non-subworkflow wait — including event parks (a resident agent waiting on
 * `wait_event`) and deadline parks (`wait_until`) that need no response.
 *
 * The classification is REASON-FIRST (matching the ledger's exact wait
 * reasons — inventing categories drifts) and content-aware only where a
 * park reason legitimately carries a host-authored prompt (a `wait_event`
 * used as a user-facing ask, not a background park):
 *
 * - `approval`: a tool-approval gate (details.mode==='approval_required' or
 *   details.kind==='tool_approval') — needs Approve/Deny.
 * - `prompt`: needs a typed/selected response — reason `user` (ask_user), or
 *   any wait carrying a real host prompt/choices.
 * - `park`: the run is waiting on something that is NOT the user — an event
 *   park (`event`), a deadline (`wait_until`/`timer`), or a subworkflow.
 *   No force-open, no "respond" wording.
 *
 * Only `approval` and `prompt` are interactive (`isInteractiveWait`).
 */

export type WaitInteractivity = 'approval' | 'prompt' | 'park';

export interface WaitClassificationInput {
  reason?: string | null;
  details?: Record<string, unknown> | null;
  /** The RAW host prompt (undefined/empty when the wait carries none — do
   * NOT pass a defaulted placeholder like "Please respond:"). */
  prompt?: string | null;
  choices?: unknown;
}

// Reasons that are the user's turn to act (a typed/selected reply).
const PROMPT_REASONS = new Set(['user']);
// Reasons that are background parks — the run waits on something else.
const PARK_REASONS = new Set(['event', 'wait_until', 'timer', 'subworkflow', 'wait_event']);
// Placeholder prompts the client synthesizes when a wait carries none: these
// must NOT count as a real host prompt (they would misclassify a park).
const PLACEHOLDER_PROMPTS = new Set(['please respond:', 'please respond', '']);

function hasHostPrompt(input: WaitClassificationInput): boolean {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (prompt && !PLACEHOLDER_PROMPTS.has(prompt.toLowerCase())) return true;
  return Array.isArray(input.choices) && input.choices.length > 0;
}

function isToolApproval(details?: Record<string, unknown> | null): boolean {
  if (!details || typeof details !== 'object') return false;
  const mode = typeof details.mode === 'string' ? details.mode.trim() : '';
  const kind = typeof details.kind === 'string' ? details.kind.trim() : '';
  return mode === 'approval_required' || kind === 'tool_approval';
}

export function classifyWait(input: WaitClassificationInput): WaitInteractivity {
  if (isToolApproval(input.details)) return 'approval';
  const reason = (typeof input.reason === 'string' ? input.reason : '').trim().toLowerCase();
  if (PROMPT_REASONS.has(reason)) return 'prompt';
  if (PARK_REASONS.has(reason)) {
    // A park reason is interactive ONLY when it carries a real host prompt
    // (a wait_event authored as a user-facing ask). A bare park is not.
    return hasHostPrompt(input) ? 'prompt' : 'park';
  }
  // Unknown/empty reason: a real host prompt means "respond"; otherwise it is
  // a park we should not interrupt for (conservative — never force-open a
  // wait that carries no way for the user to answer).
  return hasHostPrompt(input) ? 'prompt' : 'park';
}

export function isInteractiveWait(input: WaitClassificationInput): boolean {
  return classifyWait(input) !== 'park';
}

/** The toast wording for an interactive wait; parks get no "respond" toast. */
export function waitNotificationText(interactivity: WaitInteractivity): string | null {
  switch (interactivity) {
    case 'approval':
      return 'Flow needs your approval';
    case 'prompt':
      return 'Flow is waiting for your response';
    case 'park':
      return null;
  }
}
