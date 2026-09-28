/**
 * The history window for conversation history replayed to a model
 * (operator ruling 2026-09-28, ADR-0026): models get their full context;
 * replayed history is the NEWEST WHOLE messages up to 50,000 estimated
 * tokens, and what was replayed or dropped is recorded. Nothing here cuts a
 * message: budgets are met by selection, never by slicing (ADR-0026 §3).
 *
 * This mirrors AbstractRuntime's one rule (`session_history.fold_history_window`
 * and `memory.token_budget.estimate_tokens`, runtime commit b97d8f4) for
 * history the editor renders into a single prompt, where the runtime's window
 * cannot see individual turns. AbstractContinuum carries the same function
 * for the same reason; it is a candidate for `@abstractframework/ui-kit`.
 */

/** Same budget as AbstractRuntime `HISTORY_REPLAY_MAX_TOKENS`. */
export const HISTORY_REPLAY_MAX_TOKENS = 50_000;

/** Named in every report so a reader knows which estimate produced the numbers. */
export const TOKEN_ESTIMATOR = 'abstractflow historyWindow.estimateTokens (~4 chars per token)';

/**
 * Token estimate for a string: about 4 characters per token, at least 1 for
 * non-empty text. The same rule as AbstractRuntime
 * `memory.token_budget.estimate_tokens` when AbstractCore's tokenizer is not
 * available (a browser has none). It sizes the window only; it never cuts.
 */
export function estimateTokens(text: string): number {
  const s = String(text ?? '');
  if (!s) return 0;
  return Math.max(1, Math.floor(s.length / 4));
}

export interface HistoryWindowReport {
  policy: 'newest_whole_messages';
  maxTokens: number;
  tokenEstimator: string;
  totalMessages: number;
  replayedMessages: number;
  replayedTokens: number;
  droppedMessages: number;
  droppedTokens: number;
  /** True when the newest message alone exceeds the window and was kept whole. */
  oversizeMessageKept: boolean;
}

/**
 * Keep the newest whole items that fit `maxTokens`; return them in their
 * original (chronological) order with the window's report.
 *
 * The walk goes newest-first and stops at the first item that does not fit,
 * so the window is contiguous (skipping one large item to keep older ones
 * would leave a hole in the conversation). A total of exactly `maxTokens`
 * fits. When the NEWEST item alone is larger than the window it is kept whole
 * and alone (`oversizeMessageKept`): cutting it would be lossy truncation of
 * the most relevant message, and a message the model's context cannot hold
 * fails loudly at the provider instead of disappearing here.
 */
export function foldHistoryWindow<T>(
  items: T[],
  tokensOf: (item: T) => number,
  maxTokens: number = HISTORY_REPLAY_MAX_TOKENS
): { kept: T[]; report: HistoryWindowReport } {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error(`history window maxTokens must be a positive integer, got ${maxTokens}`);
  }
  const sized = items.map((item) => ({ item, tokens: tokensOf(item) }));
  let keptTokens = 0;
  let start = sized.length;
  let oversize = false;
  for (let i = sized.length - 1; i >= 0; i -= 1) {
    const t = sized[i].tokens;
    if (keptTokens + t > maxTokens) {
      if (start === sized.length) {
        oversize = true;
        keptTokens += t;
        start = i;
      }
      break;
    }
    keptTokens += t;
    start = i;
  }
  const dropped = sized.slice(0, start);
  return {
    kept: sized.slice(start).map((s) => s.item),
    report: {
      policy: 'newest_whole_messages',
      maxTokens,
      tokenEstimator: TOKEN_ESTIMATOR,
      totalMessages: sized.length,
      replayedMessages: sized.length - start,
      replayedTokens: keptTokens,
      droppedMessages: dropped.length,
      droppedTokens: dropped.reduce((n, s) => n + s.tokens, 0),
      oversizeMessageKept: oversize,
    },
  };
}
