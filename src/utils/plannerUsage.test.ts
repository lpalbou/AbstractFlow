import { describe, expect, it } from 'vitest';
import {
  addUsage,
  emptyUsage,
  formatTokenCount,
  formatUsage,
  usageFromLedgerRecords,
  usageFromValue,
} from './plannerUsage';

describe('usageFromValue', () => {
  it('reads OpenAI-style prompt/completion token fields', () => {
    expect(usageFromValue({ prompt_tokens: 41200, completion_tokens: 1100, total_tokens: 42300 })).toEqual({
      inputTokens: 41200,
      outputTokens: 1100,
      calls: 1,
    });
  });

  it('reads Anthropic-style input/output token fields', () => {
    expect(usageFromValue({ input_tokens: 12, output_tokens: 7 })).toEqual({ inputTokens: 12, outputTokens: 7, calls: 1 });
  });

  it('accepts numeric strings and falls back to total_tokens only', () => {
    expect(usageFromValue({ input_tokens: '15', output_tokens: '3' })).toEqual({ inputTokens: 15, outputTokens: 3, calls: 1 });
    expect(usageFromValue({ total_tokens: 90 })).toEqual({ inputTokens: 90, outputTokens: 0, calls: 1 });
  });

  it('returns null for objects without token counts', () => {
    expect(usageFromValue({ model: 'qwen', latency_ms: 1200 })).toBeNull();
    expect(usageFromValue('usage')).toBeNull();
    expect(usageFromValue(null)).toBeNull();
  });
});

describe('usageFromLedgerRecords', () => {
  it('sums usage across LLM_CALL records including nested locations', () => {
    const records = [
      { result: { usage: { input_tokens: 1000, output_tokens: 100 } } },
      { result: { response: { usage: { prompt_tokens: 2000, completion_tokens: 200 } } } },
      { result: { ok: true } },
      { result: null },
      {},
    ];
    expect(usageFromLedgerRecords(records)).toEqual({ inputTokens: 3000, outputTokens: 300, calls: 2 });
  });

  it('counts each record at most once even when usage is mirrored at several levels', () => {
    const usage = { input_tokens: 500, output_tokens: 50 };
    const records = [{ result: { usage, response: { usage }, meta: { usage } } }];
    expect(usageFromLedgerRecords(records)).toEqual({ inputTokens: 500, outputTokens: 50, calls: 1 });
  });

  it('returns zero-call usage when no record reports tokens', () => {
    expect(usageFromLedgerRecords([{ result: { status: 'completed' } }])).toEqual(emptyUsage());
  });
});

describe('usage formatting', () => {
  it('formats token counts compactly', () => {
    expect(formatTokenCount(987)).toBe('987');
    expect(formatTokenCount(41234)).toBe('41.2k');
    expect(formatTokenCount(1_200_000)).toBe('1.20M');
    expect(formatTokenCount(-5)).toBe('0');
  });

  it('formats a usage summary and stays silent when usage is unavailable', () => {
    expect(formatUsage({ inputTokens: 41200, outputTokens: 1100, calls: 1 })).toBe('41.2k in / 1.1k out tokens');
    expect(formatUsage(emptyUsage())).toBe('');
  });

  it('accumulates turn totals with addUsage', () => {
    const total = addUsage(
      { inputTokens: 1000, outputTokens: 100, calls: 1 },
      { inputTokens: 2000, outputTokens: 300, calls: 2 }
    );
    expect(total).toEqual({ inputTokens: 3000, outputTokens: 400, calls: 3 });
  });
});
