/**
 * Follow-up prompt-key fidelity (backlog 0115).
 *
 * A follow-up run reuses the prior run's input defaults and replaces only the
 * prompt-like input with the user's new message. Extraction (what the prior
 * prompt WAS) and injection (where the new message goes) must walk the same
 * ordered candidate list — the old injection hardcoded `prompt`, so a flow
 * whose entry pin is `task`/`query` re-ran the OLD task with the new message
 * parked in an unused `prompt` key.
 */

export const FOLLOW_UP_PROMPT_KEYS = ['prompt', 'message', 'task', 'query', 'question'] as const;

/** The prior run's prompt text: first candidate key holding a non-empty string. */
export function extractFollowUpPromptText(input: Record<string, unknown> | null | undefined): string {
  if (!input || typeof input !== 'object') return '';
  for (const key of FOLLOW_UP_PROMPT_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * The input key a follow-up message should be written to:
 * 1. the key the prior run actually used (non-empty string value);
 * 2. else the first candidate key present on the inputs at all;
 * 3. else `prompt` (a flow without any prompt-like input gets the historical
 *    default rather than an invented key).
 */
export function pickFollowUpPromptKey(input: Record<string, unknown> | null | undefined): string {
  if (input && typeof input === 'object') {
    for (const key of FOLLOW_UP_PROMPT_KEYS) {
      const value = input[key];
      if (typeof value === 'string' && value.trim()) return key;
    }
    for (const key of FOLLOW_UP_PROMPT_KEYS) {
      if (key in input) return key;
    }
  }
  return 'prompt';
}
