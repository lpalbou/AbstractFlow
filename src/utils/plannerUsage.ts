/**
 * Token usage extraction for authoring planner runs.
 *
 * Gateway ledger records carry provider usage in `result.usage` (LLM_CALL
 * effects) or nested under `result.output/response/data/meta`. Field names
 * vary by provider family (`input_tokens`/`output_tokens` vs
 * `prompt_tokens`/`completion_tokens`), so extraction is tolerant: it sums
 * every distinct usage object found across the run tree's ledger records.
 * Usage is observability-only — absence must never block the authoring loop.
 */

export interface PlannerUsage {
  inputTokens: number;
  outputTokens: number;
  /** Number of usage-reporting records found (0 = usage unavailable). */
  calls: number;
}

export function emptyUsage(): PlannerUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

export function addUsage(a: PlannerUsage, b: PlannerUsage): PlannerUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    calls: a.calls + b.calls,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function tokenCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function firstTokenCount(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const count = tokenCount(record[key]);
    if (count !== null) return count;
  }
  return null;
}

/** Parse one usage object; null when it carries no recognizable token counts. */
export function usageFromValue(value: unknown): PlannerUsage | null {
  const record = asRecord(value);
  if (!record) return null;
  const input = firstTokenCount(record, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens']);
  const output = firstTokenCount(record, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens']);
  if (input === null && output === null) {
    // Some providers only report a total; attribute it to input so the sum
    // stays truthful even when the split is unknown.
    const total = firstTokenCount(record, ['total_tokens', 'totalTokens']);
    if (total === null) return null;
    return { inputTokens: total, outputTokens: 0, calls: 1 };
  }
  return { inputTokens: input ?? 0, outputTokens: output ?? 0, calls: 1 };
}

/** Candidate homes for a usage object inside one ledger record's result. */
function usageCandidates(result: Record<string, unknown>): unknown[] {
  return [
    result.usage,
    asRecord(result.output)?.usage,
    asRecord(result.response)?.usage,
    asRecord(result.data)?.usage,
    asRecord(result.meta)?.usage,
    asRecord(asRecord(result.output)?.meta)?.usage,
  ];
}

/**
 * Sum token usage across ledger records. Each record contributes at most one
 * usage object (the first recognizable candidate), so a usage object mirrored
 * at several nesting levels is not double-counted.
 */
export function usageFromLedgerRecords(records: { result?: unknown }[]): PlannerUsage {
  let total = emptyUsage();
  for (const record of records) {
    const result = asRecord(record.result);
    if (!result) continue;
    for (const candidate of usageCandidates(result)) {
      const usage = usageFromValue(candidate);
      if (usage) {
        total = addUsage(total, usage);
        break;
      }
    }
  }
  return total;
}

/**
 * Rough token estimate from text length (~4 chars/token for Latin-script
 * prose/JSON). Used ONLY for pre-send observability labels — always rendered
 * with an explicit "est." marker — never for any budgeting or truncation
 * decision (ADR-0026).
 */
export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

/** "~34k tokens est." pre-send size label for a request payload. */
export function formatEstimatedTokens(text: string): string {
  return `~${formatTokenCount(estimateTokensFromText(text))} tokens est.`;
}

/** Compact token count: 987 -> "987", 41_234 -> "41.2k", 1_200_000 -> "1.20M". */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1000) return String(Math.floor(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** "41.2k in / 1.1k out tokens", or '' when no usage was reported. */
export function formatUsage(usage: PlannerUsage): string {
  if (usage.calls === 0) return '';
  return `${formatTokenCount(usage.inputTokens)} in / ${formatTokenCount(usage.outputTokens)} out tokens`;
}
