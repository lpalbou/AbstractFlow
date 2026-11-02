import { describe, expect, it } from 'vitest';

import { isStringListPin, stringListToText, textToStringList } from './pinLists';

describe('string list pins', () => {
  it('recognises array pins whose items are strings or an enum', () => {
    expect(isStringListPin({ type: 'array', schema: { type: 'array', items: { type: 'string' } } })).toBe(true);
    expect(isStringListPin({ type: 'array', schema: { type: 'array', items: { enum: ['a', 'b'] } } })).toBe(true);
    expect(isStringListPin({ type: 'array' })).toBe(false);
    expect(isStringListPin({ type: 'array', schema: { type: 'array', items: { type: 'object' } } })).toBe(false);
    expect(isStringListPin({ type: 'string', schema: { type: 'array', items: { type: 'string' } } })).toBe(false);
  });

  it('round-trips a typed line and a stored list', () => {
    expect(textToStringList('returns, shipping ,billing,, returns')).toEqual(['returns', 'shipping', 'billing']);
    expect(textToStringList('   ')).toEqual([]);
    expect(stringListToText(['Calm', 'Frustrated'])).toBe('Calm, Frustrated');
    expect(stringListToText(undefined)).toBe('');
    expect(stringListToText(['a', { name: 'b' }])).toBe('a, {"name":"b"}');
  });
});
