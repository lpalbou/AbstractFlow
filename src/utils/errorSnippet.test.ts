import { describe, expect, it } from 'vitest';
import { errorSnippet } from './errorSnippet';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

describe('errorSnippet', () => {
  // The regression this exists for: the toast used to show the first non-empty
  // line of pretty-printed JSON, which for every object error is a lone brace.
  it('never renders a bare brace for an object payload', () => {
    const payload = { detail: 'compile failed: unknown node type' };
    expect(errorSnippet(payload, pretty(payload))).not.toBe('{');
    expect(errorSnippet(payload, pretty(payload))).toBe('compile failed: unknown node type');
  });

  it('prefers detail, then message, then error', () => {
    expect(errorSnippet({ detail: 'D', message: 'M', error: 'E' }, '')).toBe('D');
    expect(errorSnippet({ message: 'M', error: 'E' }, '')).toBe('M');
    expect(errorSnippet({ error: 'E' }, '')).toBe('E');
  });

  it('digs into a nested gateway payload', () => {
    const payload = { detail: { error: 'pin expression on builder.prompt failed' } };
    expect(errorSnippet(payload, pretty(payload))).toContain('pin expression on builder.prompt failed');
  });

  it('appends the failing node when the message does not already name it', () => {
    const payload = { error: 'TypeError: NoneType is not subscriptable', node: 'next_state' };
    expect(errorSnippet(payload, '')).toBe(
      'TypeError: NoneType is not subscriptable (at next_state)'
    );
  });

  it('does not repeat a node already named in the message', () => {
    const payload = { error: 'expression on next_state.lint_out failed', node: 'next_state' };
    expect(errorSnippet(payload, '')).toBe('expression on next_state.lint_out failed');
  });

  it('falls back to COMPACT json when no message key exists', () => {
    const payload = { status: 500, path: '/api/gateway/runs/start' };
    const out = errorSnippet(payload, pretty(payload));
    expect(out).toContain('"status":500');
    expect(out).not.toBe('{');
  });

  it('uses an Error message', () => {
    expect(errorSnippet(new Error('boom'), 'irrelevant')).toBe('boom');
  });

  it('uses the first line of a string', () => {
    expect(errorSnippet('line one\nline two', '')).toBe('line one');
  });

  it('collapses whitespace and truncates long messages', () => {
    const long = 'x'.repeat(400);
    const out = errorSnippet({ detail: long }, '');
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith('…')).toBe(true);
  });

  // LIVE-captured from the gateway (POST /api/gateway/visualflows with a bad
  // body). FastAPI validation errors key the sentence as `msg`; before that key
  // was listed, every 422 fell through to the compact-JSON branch and the toast
  // showed the raw payload including the echoed `input`.
  it('reads the FastAPI validation shape', () => {
    const payload = {
      detail: [
        { type: 'missing', loc: ['body', 'name'], msg: 'Field required', input: { nodes: 'x' } },
        { type: 'list_type', loc: ['body', 'nodes'], msg: 'Input should be a valid list' },
      ],
    };
    expect(errorSnippet(payload, pretty(payload))).toBe('Field required');
  });

  // The real payload the run-failure toast receives for a run that COMPLETED
  // but reported success:false — captured from a live gateway run.
  it('surfaces the outcome sentence of a completed-but-unsuccessful run', () => {
    const payload = {
      type: 'flow_complete',
      success: false,
      error: null,
      result: {
        response:
          '# Multi-agent coding workflow result\n\nOutcome: plan-not-accepted (plan revisions exhausted)',
        success: false,
        meta: { stopped_reason: 'plan-not-accepted' },
      },
    };
    const out = errorSnippet(payload, pretty(payload));
    expect(out).toContain('Multi-agent coding workflow result');
    expect(out).not.toMatch(/^\{/);
  });

  it('prefers a real error over the carried result', () => {
    const payload = {
      error: 'Error code: 400 - credit balance is too low',
      result: { response: 'a long report nobody wants as the headline' },
    };
    expect(errorSnippet(payload, '')).toContain('credit balance is too low');
  });

  it('never returns an empty string', () => {
    expect(errorSnippet(null, '')).toBe('Unknown error');
    expect(errorSnippet({}, '{}')).toBe('Unknown error');
  });
});
