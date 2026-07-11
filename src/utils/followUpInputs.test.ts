import { describe, expect, it } from 'vitest';
import { extractFollowUpPromptText, pickFollowUpPromptKey } from './followUpInputs';

describe('follow-up prompt key fidelity (backlog 0115)', () => {
  it('extracts the prior prompt from the first non-empty candidate key', () => {
    expect(extractFollowUpPromptText({ prompt: 'build a snake game' })).toBe('build a snake game');
    expect(extractFollowUpPromptText({ task: 'summarize the doc' })).toBe('summarize the doc');
    expect(extractFollowUpPromptText({ prompt: '', task: 'real task' })).toBe('real task');
    expect(extractFollowUpPromptText({ other: 'x' })).toBe('');
    expect(extractFollowUpPromptText(null)).toBe('');
  });

  it('injects into the key the prior run actually used', () => {
    expect(pickFollowUpPromptKey({ task: 'summarize the doc', depth: 2 })).toBe('task');
    expect(pickFollowUpPromptKey({ query: 'find papers' })).toBe('query');
    expect(pickFollowUpPromptKey({ prompt: 'hello' })).toBe('prompt');
  });

  it('prefers extraction order when several candidates are present', () => {
    expect(pickFollowUpPromptKey({ question: 'q', prompt: 'p' })).toBe('prompt');
    // Same walk as extraction: the injected message lands where the prior
    // prompt was read from.
    expect(extractFollowUpPromptText({ question: 'q', prompt: 'p' })).toBe('p');
  });

  it('falls back to a present-but-empty candidate key before inventing prompt', () => {
    expect(pickFollowUpPromptKey({ task: '' })).toBe('task');
    expect(pickFollowUpPromptKey({ task: '', prompt: '' })).toBe('prompt');
  });

  it('defaults to prompt when no candidate key exists', () => {
    expect(pickFollowUpPromptKey({ workspace_root: '/tmp' })).toBe('prompt');
    expect(pickFollowUpPromptKey(null)).toBe('prompt');
    expect(pickFollowUpPromptKey(undefined)).toBe('prompt');
  });
});
