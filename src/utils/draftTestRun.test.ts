import { describe, expect, it, vi } from 'vitest';
import type { VisualFlow } from '../types/flow';
import {
  assistantTestSessionId,
  buildDraftTestReport,
  classifyWait,
  pollDraftTestRun,
  testReportPromptSection,
} from './draftTestRun';

vi.mock('./gatewayClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gatewayClient')>();
  return {
    ...actual,
    gatewayRunSummary: vi.fn(async () => ({
      status: 'waiting',
      waiting: { wait_key: 'w-approve', reason: 'user', details: { mode: 'approval_required', tool_calls: [{ name: 'write_file' }] } },
    })),
    gatewayCancelRun: vi.fn(async () => undefined),
  };
});

// Pure halves of the assistant test loop (adversary review E stage 1). The
// network halves compose gatewayClient helpers verified elsewhere.

const flow: VisualFlow = {
  id: 'f1',
  name: 'Research',
  nodes: [
    {
      id: 'llm-2',
      type: 'llm_call',
      position: { x: 0, y: 0 },
      data: { nodeType: 'llm_call', label: 'Summarize', inputs: [], outputs: [] },
    },
  ] as unknown as VisualFlow['nodes'],
  edges: [],
};

describe('assistant test-run primitives', () => {
  it('mints an isolated session id (never the stable session)', () => {
    expect(assistantTestSessionId('flow:abc')).toBe('assistant-test:flow:abc');
  });

  it('classifies tool-approval waits by mode and kind', () => {
    const wait = classifyWait({
      waiting: { wait_key: 'w1', reason: 'user', details: { mode: 'approval_required', tool_calls: [{ name: 'write_file' }] } },
    });
    expect(wait?.kind).toBe('tool_approval');
    expect(wait?.waitKey).toBe('w1');
    expect(wait?.toolCalls).toHaveLength(1);
  });

  it('classifies ask_user waits reading the prompt at the TOP LEVEL of the wait (the real gateway shape)', () => {
    // mapGatewayRunSummary/extractWaitInfo read wait.prompt, not details.prompt.
    const wait = classifyWait({ waiting: { wait_key: 'w2', reason: 'user', prompt: 'Which city?' } });
    expect(wait?.kind).toBe('ask_user');
    expect(wait?.prompt).toBe('Which city?');
  });

  it('still accepts the details.prompt fallback shape', () => {
    const wait = classifyWait({ waiting: { wait_key: 'w2', reason: 'user', details: { prompt: 'Which city?' } } });
    expect(wait?.prompt).toBe('Which city?');
  });

  it('returns null when the run is not waiting', () => {
    expect(classifyWait({ status: 'running' })).toBeNull();
  });

  it('watchdog expiry with a pending APPROVAL reports needs_interactive_input, never a graph-defect timeout', async () => {
    let clock = 0;
    const outcome = await pollDraftTestRun('run-1', {
      timeoutMs: 1000,
      pollIntervalMs: 1,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });
    expect(outcome.verdict).toBe('needs_interactive_input');
    expect(outcome.status).toBe('timeout');
  });

  it('an early ANSWERED question does not convert a later genuine timeout into needs_interactive_input', async () => {
    // Adversary find: the interactive flag was a sticky latch — one answered
    // ask_user in the first minute mislabeled a run that then ground on LLM
    // loops for the whole budget.
    const { gatewayRunSummary } = await import('./gatewayClient');
    const mock = vi.mocked(gatewayRunSummary);
    mock.mockImplementationOnce(async () => ({
      status: 'waiting',
      waiting: { wait_key: 'w-q', reason: 'user', prompt: 'Which city?' },
    }));
    mock.mockImplementation(async () => ({ status: 'running' }));
    let clock = 0;
    const outcome = await pollDraftTestRun('run-2', {
      timeoutMs: 1000,
      pollIntervalMs: 1,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });
    expect(outcome.status).toBe('timeout');
    expect(outcome.verdict).toBe('timeout');
  });
});

describe('test report distillation', () => {
  it('extracts failed steps with node labels, effect types, and truncated inputs', () => {
    const report = buildDraftTestReport({
      runId: 'r1',
      bundleRef: 'my-flow@draft.x',
      verdict: 'failed',
      durationMs: 84210,
      inputsUsed: { topic: 'quantum sensors' },
      flow,
      flowError: 'run failed',
      records: [
        { node_id: 'llm-2', status: 'failed', error: 'Provider timeout', effect: { type: 'llm_call', payload: { prompt: 'x'.repeat(600) } } },
        { node_id: 'ok-1', status: 'completed', effect: { type: 'tool_calls' } },
      ],
    });
    expect(report.failedSteps).toHaveLength(1);
    expect(report.failedSteps[0]).toMatchObject({ nodeId: 'llm-2', nodeLabel: 'Summarize', effectType: 'llm_call', error: 'Provider timeout' });
    expect(report.failedSteps[0].inputsPreview.endsWith('#TRUNCATION')).toBe(true);
  });

  it('renders the prompt section with verdict, failures, and the fix instruction', () => {
    const report = buildDraftTestReport({
      runId: 'r1',
      bundleRef: 'my-flow@draft.x',
      verdict: 'failed',
      durationMs: 5000,
      inputsUsed: { topic: 't' },
      flow,
      flowError: null,
      records: [{ node_id: 'llm-2', status: 'failed', error: 'boom', effect: { type: 'llm_call', payload: {} } }],
    });
    const text = testReportPromptSection(report);
    expect(text).toContain('verdict=failed');
    expect(text).toContain('FAILED step node=llm-2');
    expect(text).toContain('Fix the graph so this test passes');
  });

  it('passed verdict carries outputs and the plausibility instruction', () => {
    const report = buildDraftTestReport({
      runId: 'r2',
      bundleRef: 'my-flow@draft.x',
      verdict: 'passed',
      durationMs: 3000,
      inputsUsed: {},
      flow,
      records: [{ node_id: 'end-1', status: 'completed', result: { outputs: { report: 'done' } } }],
    });
    expect(report.outputs).toEqual({ report: 'done' });
    const text = testReportPromptSection(report);
    expect(text).toContain('verdict=passed');
    expect(text).toContain('plausibly satisfy the request');
  });
});
