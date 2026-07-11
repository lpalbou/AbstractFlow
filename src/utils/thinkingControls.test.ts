import { describe, expect, it } from 'vitest';
import { modelNameLooksThinkingCapable, thinkingOptionsFromModelCapabilities } from './thinkingControls';

describe('thinkingControls', () => {
  it('recognizes reasoning model names', () => {
    expect(modelNameLooksThinkingCapable('gpt-5')).toBe(true);
    expect(modelNameLooksThinkingCapable('qwen/qwen3.6-35b-a3b')).toBe(true);
    expect(modelNameLooksThinkingCapable('gemma-4-e4b-it')).toBe(false);
  });

  it('uses advertised reasoning levels when available', () => {
    const options = thinkingOptionsFromModelCapabilities(
      { capabilities: { reasoning_levels: ['low', 'medium', 'high'] } },
      'custom-model'
    );

    expect(options.map((option) => option.value)).toEqual(['', 'low', 'medium', 'high']);
  });

  it('returns no options for non-reasoning models without capability support', () => {
    expect(thinkingOptionsFromModelCapabilities({ capabilities: { thinking_support: false } }, 'gemma-4-e4b-it')).toEqual([]);
  });
});
