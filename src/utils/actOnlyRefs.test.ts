import { describe, expect, it } from 'vitest';

import { actOnlyRefLabel, collectActOnlyRefs, parseActOnlyRef } from './actOnlyRefs';

/**
 * $act_only ref recognition — pinned against the FROZEN seam-spec shape
 * (a2a thread 0013): lone `$act_only` top-level key, exact JSON, detection
 * by parse never regex. The words never appear; only the act-frame does.
 */

const FRAME = {
  tool: 'diary_read',
  entry_id: 'diary_ab12cd34',
  reason: 'visitor asked about last time',
  gist: 'a night walk and a question about bridges',
};

describe('parseActOnlyRef', () => {
  it('recognizes the decoded object shape (lone $act_only key)', () => {
    const ref = parseActOnlyRef({ $act_only: FRAME });
    expect(ref).not.toBeNull();
    expect(ref?.tool).toBe('diary_read');
    expect(ref?.entry_id).toBe('diary_ab12cd34');
    expect(ref?.gist).toBe(FRAME.gist);
  });

  it('recognizes the JSON-string shape (tool message content lane)', () => {
    const ref = parseActOnlyRef(JSON.stringify({ $act_only: FRAME }));
    expect(ref?.tool).toBe('diary_read');
  });

  it('refuses objects where $act_only is not the LONE top-level key', () => {
    expect(parseActOnlyRef({ $act_only: FRAME, extra: 1 })).toBeNull();
  });

  it('refuses non-ref values without throwing (parse, never regex)', () => {
    expect(parseActOnlyRef('plain text mentioning $act_only')).toBeNull();
    expect(parseActOnlyRef('{"$act_only": not-json')).toBeNull();
    expect(parseActOnlyRef({ $artifact: 'art-1' })).toBeNull();
    expect(parseActOnlyRef(null)).toBeNull();
    expect(parseActOnlyRef(42)).toBeNull();
    expect(parseActOnlyRef({ $act_only: { gist: 'no tool named' } })).toBeNull();
  });
});

describe('collectActOnlyRefs', () => {
  it('finds refs nested in message lists and step outputs', () => {
    const output = {
      messages: [
        { role: 'assistant', content: 'looking it up' },
        { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ $act_only: FRAME }) },
      ],
      result: { $act_only: { tool: 'diary_list' } },
    };
    const refs = collectActOnlyRefs(output);
    expect(refs.map((r) => r.tool).sort()).toEqual(['diary_list', 'diary_read']);
  });

  it('returns an empty list when no refs exist', () => {
    expect(collectActOnlyRefs({ messages: [{ role: 'user', content: 'hello' }] })).toEqual([]);
  });
});

describe('actOnlyRefLabel', () => {
  it('labels with tool and entry id, never gist words as the label', () => {
    expect(actOnlyRefLabel({ tool: 'diary_read', entry_id: 'diary_ab12cd34' })).toBe(
      'diary_read · diary_ab12cd34'
    );
    expect(actOnlyRefLabel({ tool: 'diary_list' })).toBe('diary_list');
  });
});
