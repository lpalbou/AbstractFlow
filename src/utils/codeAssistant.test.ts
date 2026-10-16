import { describe, expect, it } from 'vitest';
import type { Pin } from '../types/flow';
import {
  buildCodeAssistantPrompt,
  buildCodeAssistantSystemPrompt,
  deniedModulesOf,
  extractCodeBlock,
  replyTextFromRunOutput,
  resolveCodeAssistantModel,
  variableLines,
  type CodeAssistantContext,
} from './codeAssistant';

const params: Pin[] = [
  { id: 'input', label: 'input', type: 'any' },
  { id: 'user-name', label: 'User name', type: 'string' },
];

const policy = {
  contract: 'code_execution_policy_v1',
  modes: [
    { id: 'sandbox', imports: { allowed: 'python standard library', denied_modules: ['os', 'subprocess', 'operator'] } },
    { id: 'full_access', available: false },
  ],
};

const ctx: CodeAssistantContext = {
  flowName: 'Daily digest',
  nodeLabel: 'Format body',
  params,
  currentBody: 'return _input',
  sampleInput: '{\n  "input": null\n}',
  permissions: 'sandbox',
  policy,
};

describe('the Code node assistant knows the node (operator 2026-10-16 14:37: "it should know the context of the workflow")', () => {
  it('lists the variables the body can read, with their access expression', () => {
    expect(variableLines(params)).toEqual([
      '_input (dict) — the whole input payload',
      'input (any) = _input.get("input")',
      'user_name (string) = _input.get("user-name")',
    ]);
  });

  it('the system prompt states the body-only contract, the variables, the sandbox rule with the denied modules, Python only, and the reply format', () => {
    const system = buildCodeAssistantSystemPrompt(ctx);
    expect(system).toContain('BODY of `def transform(_input):`');
    expect(system).toContain('Never write the `def transform` line');
    expect(system).toContain('    user_name (string) = _input.get("user-name")');
    expect(system).toContain("Python's standard library is importable (json, re, datetime");
    expect(system).toContain('these modules: os, subprocess, operator');
    expect(system).toContain('Return JSON data only');
    expect(system).toContain('Python only.');
    expect(system).toContain('exactly one ```python fenced block');
  });

  it('without a policy the sandbox rule still names what is refused; full access says any import', () => {
    expect(deniedModulesOf(null)).toEqual([]);
    expect(buildCodeAssistantSystemPrompt({ ...ctx, policy: null })).toContain('the modules that reach processes, files, the network or code loading');
    expect(buildCodeAssistantSystemPrompt({ ...ctx, permissions: 'full_access' })).toContain('full access: any import is available');
  });

  it('the prompt carries the workflow, the node, the current body, the test input, the recent turns and the request', () => {
    const prompt = buildCodeAssistantPrompt(
      ctx,
      [
        { role: 'user', text: 'add the time' },
        { role: 'assistant', text: 'Here it is.', code: 'import time\nreturn time.ctime()' },
        { role: 'assistant', text: 'gateway down', error: true },
      ],
      'now also the date'
    );
    expect(prompt).toContain('Workflow: Daily digest · Node: Format body');
    expect(prompt).toContain('Current body of transform(_input):\n```python\nreturn _input\n```');
    expect(prompt).toContain('Test input (JSON): {\n  "input": null\n}');
    expect(prompt).toContain('User: add the time');
    expect(prompt).toContain('Assistant: Here it is.\n```python\nimport time\nreturn time.ctime()\n```');
    expect(prompt).not.toContain('gateway down');
    expect(prompt.endsWith('Request: now also the date')).toBe(true);
  });
});

describe('the reply becomes a body the editor can take', () => {
  it('takes the first python fence', () => {
    expect(extractCodeBlock('Sure.\n```python\nimport json\nreturn json.dumps(_input)\n```\nDone.')).toBe('import json\nreturn json.dumps(_input)');
    expect(extractCodeBlock('```\nreturn 1\n```')).toBe('return 1');
    expect(extractCodeBlock('no code here')).toBeNull();
  });

  it('unwraps a def transform the model wrote anyway, and drops the variables header', () => {
    const reply = '```python\n# Available variables:\n# _input (dict)\n# input (any)\n\ndef transform(_input):\n    x = _input.get("input")\n    return {"x": x}\n```';
    expect(extractCodeBlock(reply)).toBe('x = _input.get("input")\nreturn {"x": x}');
    expect(extractCodeBlock('```python\n# Available variables:\n# _input (dict)\n\nreturn 2\n```')).toBe('return 2');
  });

  it('finds the model text in a basic-agent run output', () => {
    expect(replyTextFromRunOutput({ response: ' hi ', success: true })).toBe('hi');
    expect(replyTextFromRunOutput({ output: { response: 'nested' } })).toBe('nested');
    expect(replyTextFromRunOutput('plain')).toBe('plain');
    expect(replyTextFromRunOutput({ meta: {} })).toBe('');
  });

  it('resolves the gateway default text model, or nothing', () => {
    expect(resolveCodeAssistantModel({ routes: [{ key: 'output.text', provider: 'lmstudio', model: 'qwen3-8b' }] })).toEqual({ provider: 'lmstudio', model: 'qwen3-8b', label: 'lmstudio / qwen3-8b' });
    expect(resolveCodeAssistantModel({ routes: [] })).toBeNull();
    expect(resolveCodeAssistantModel(null)).toBeNull();
  });
});
