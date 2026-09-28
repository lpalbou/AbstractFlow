import { describe, expect, it } from 'vitest';

import { estimateTokens, foldHistoryWindow, HISTORY_REPLAY_MAX_TOKENS } from './historyWindow';

describe('estimateTokens (mirrors AbstractRuntime memory.token_budget fallback)', () => {
  it('is ~4 chars per token, at least 1 for non-empty text, 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
    expect(estimateTokens('x'.repeat(4003))).toBe(1000);
  });
});

describe('foldHistoryWindow (newest whole messages up to the budget)', () => {
  const len = (s: string) => s.length;

  it("defaults to the runtime's 50,000-token window", () => {
    expect(HISTORY_REPLAY_MAX_TOKENS).toBe(50_000);
    expect(foldHistoryWindow(['a'], len).report.maxTokens).toBe(50_000);
  });

  it('keeps everything that fits, in order; exactly maxTokens fits', () => {
    expect(foldHistoryWindow(['aa', 'bbb', 'c'], len, 10).kept).toEqual(['aa', 'bbb', 'c']);
    expect(foldHistoryWindow(['aaaaa', 'bbbbb'], len, 10).report.droppedMessages).toBe(0);
  });

  it('drops the oldest whole items and is contiguous', () => {
    const { kept, report } = foldHistoryWindow(['a', 'b', 'cccccccc', 'dd', 'ee'], len, 6);
    expect(kept).toEqual(['dd', 'ee']);
    expect(report).toMatchObject({ replayedMessages: 2, replayedTokens: 4, droppedMessages: 3, droppedTokens: 10, totalMessages: 5 });
  });

  it('keeps an oversize newest item whole and alone', () => {
    const { kept, report } = foldHistoryWindow(['old', 'x'.repeat(50)], len, 10);
    expect(kept).toEqual(['x'.repeat(50)]);
    expect(report).toMatchObject({ oversizeMessageKept: true, replayedMessages: 1, droppedMessages: 1 });
  });

  it('refuses a non-positive budget loudly', () => {
    expect(() => foldHistoryWindow(['a'], len, 0)).toThrow(/positive integer/);
  });
});
