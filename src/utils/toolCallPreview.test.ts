import { describe, expect, it } from 'vitest';
import { toolCallPreview } from './toolCallPreview';

describe('tool call preview (a collapsed approval row)', () => {
  it('lists the arguments on one line, strings quoted, nested values abbreviated', () => {
    expect(toolCallPreview({ query: 'AI news', num_results: 10, filters: { a: 1 }, tags: [], safe: true })).toBe(
      'query="AI news", num_results=10, filters={…}, tags=[], safe=true'
    );
  });

  it('stops at a readable length, with an ellipsis', () => {
    const line = toolCallPreview({ a: 'x'.repeat(100), b: 'y'.repeat(100), c: 'z'.repeat(100) });
    expect(line.length).toBeLessThanOrEqual(150);
    expect(line.endsWith('…')).toBe(true);
    expect(line.startsWith('a="xxxx')).toBe(true);
  });

  it('says nothing for no arguments', () => {
    expect(toolCallPreview({})).toBe('');
    expect(toolCallPreview(undefined)).toBe('');
  });
});
