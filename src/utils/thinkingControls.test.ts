import { describe, expect, it } from 'vitest';
import { thinkingOptionsFromModelCapabilities, thinkingOptionsWithSaved } from './thinkingControls';

describe('thinkingControls', () => {
  it('uses the reasoning levels the capability card serves', () => {
    const options = thinkingOptionsFromModelCapabilities({ capabilities: { reasoning_levels: ['low', 'medium', 'high'] } });
    expect(options.map((option) => option.value)).toEqual(['', 'low', 'medium', 'high']);
  });

  it('never guesses from the model name: no served levels, no choices', () => {
    // These names used to be matched by text patterns (gpt-5, qwen3, "thinking").
    for (const model of ['gpt-5', 'qwen/qwen3.6-35b-a3b', 'some-thinking-model']) {
      expect(thinkingOptionsFromModelCapabilities({ model, capabilities: {} })).toEqual([]);
    }
    expect(thinkingOptionsFromModelCapabilities(undefined)).toEqual([]);
    expect(thinkingOptionsFromModelCapabilities({ capabilities: { thinking_support: false } })).toEqual([]);
  });

  it('offers off/auto for a model whose only served control is a prompt switch', () => {
    const options = thinkingOptionsFromModelCapabilities({
      capabilities: { thinking_support: true, thinking_control: { prompt_disable_token: '/no_think' } },
    });
    expect(options.map((option) => option.value)).toEqual(['', 'off', 'auto']);
  });

  it('keeps a saved level the card does not list visible as saved', () => {
    expect(thinkingOptionsWithSaved([], 'high').map((o) => o.label)).toEqual(['Auto (Gateway default)', 'high (saved)']);
    const served = thinkingOptionsFromModelCapabilities({ capabilities: { reasoning_levels: ['low'] } });
    expect(thinkingOptionsWithSaved(served, 'low')).toBe(served);
  });
});
