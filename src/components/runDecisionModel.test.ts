import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Pin, VisualFlow } from '../types/flow';
import { useFlowStore } from '../hooks/useFlow';
import { decisionModelOptions, decisionModelPinIds } from '../utils/decisionPins';
import { flowCompleteEventFromSummary } from '../utils/ledgerEvents';
import { flowCompletionRow, modelPickerWaitsForProvider, modelScopeForPin, runFormTypeLabel } from './RunFlowModal';

const EXAMPLE = resolve(__dirname, '../../examples/flows/decision-triage.json');
const example = (): VisualFlow => JSON.parse(readFileSync(EXAMPLE, 'utf8')) as VisualFlow;

const node = (id: string, nodeType: string) => ({ id, data: { nodeType } });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  source,
  sourceHandle,
  target,
  targetHandle,
});
const modelPin: Pin = { id: 'model', label: 'model', type: 'model' };

describe('Run dialog: a model input that only feeds Decision nodes picks a decision model', () => {
  const nodes = [node('start', 'on_flow_start'), node('d1', 'decide'), node('d2', 'decide'), node('llm', 'llm_call')];

  it('finds the entry pins whose every wire ends on a Decision `model` input', () => {
    const ids = decisionModelPinIds('start', nodes, [
      edge('start', 'model', 'd1', 'model'),
      edge('start', 'model', 'd2', 'model'),
      edge('start', 'text_model', 'llm', 'model'),
      edge('start', 'mixed', 'd1', 'model'),
      edge('start', 'mixed', 'llm', 'model'),
      edge('start', 'ticket', 'd1', 'state'),
    ]);
    expect([...ids]).toEqual(['model']);
    expect(decisionModelPinIds(undefined, nodes, [edge('start', 'model', 'd1', 'model')]).size).toBe(0);
  });

  it('the example flow`s `model` input is a decision model picker that needs no provider input', () => {
    const flow = example();
    const ids = decisionModelPinIds(flow.entryNode, flow.nodes as never, flow.edges as never);
    expect(ids.has('model')).toBe(true);
    const start = flow.nodes.find((n) => n.id === flow.entryNode)!;
    const pins = start.data.outputs.filter((p) => p.type !== 'execution');
    expect(pins.some((p) => p.type === 'provider' || p.id === 'provider')).toBe(false);
    const scope = modelScopeForPin(modelPin, pins, ids);
    expect(scope).toBe('decision');
    expect(modelPickerWaitsForProvider(scope, false, '')).toBe(false);
    // Without the graph scope the same pin is a text model.
    expect(modelScopeForPin(modelPin, pins)).toBe('text');
  });

  it('offers `provider/model` handles, so the chosen value carries its provider', () => {
    const catalog = {
      providers: [{ name: 'mlx' }, { name: 'typesafe' }] as never,
      modelsByProvider: { mlx: ['AbstractFramework/kev-0.8b-mlx-8bit'], typesafe: ['jev-latest'] },
    };
    expect(decisionModelOptions(catalog, '').map((o) => o.value)).toEqual([
      'mlx/AbstractFramework/kev-0.8b-mlx-8bit',
      'typesafe/jev-latest',
    ]);
    expect(decisionModelOptions(catalog, 'typesafe').map((o) => o.value)).toEqual(['jev-latest']);
  });

  it('a model picker waits for a provider only when the form has that provider input', () => {
    expect(modelPickerWaitsForProvider('text', true, '')).toBe(true);
    expect(modelPickerWaitsForProvider('text', true, 'ollama')).toBe(false);
    expect(modelPickerWaitsForProvider('text', false, '')).toBe(false);
    expect(modelPickerWaitsForProvider('image', false, '')).toBe(false);
  });
});

describe('decision-triage example', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('loads with every wire drawn (no connection kept hidden for a type mismatch)', () => {
    useFlowStore.getState().loadFlow(example());
    const report = useFlowStore.getState().loadEdgeReport;
    expect(report.dropped).toEqual([]);
    expect(report.preserved).toEqual([]);
  });
});

describe('a completed run`s final result is the run record`s output', () => {
  it('never invents an On Flow End row for a graph that has one', () => {
    expect(flowCompletionRow(false, true)).toBe('none');
    expect(flowCompletionRow(true, true)).toBe('update');
    expect(flowCompletionRow(false, false)).toBe('implicit');
  });

  it('flow_complete from the run summary carries summary.output', () => {
    const output = { department: 'shipping', escalate: true, answered_by: 'AbstractFramework/kev-0.8b-mlx-8bit' };
    expect(flowCompleteEventFromSummary('r1', { status: 'completed', output }, 't')).toEqual({
      type: 'flow_complete',
      runId: 'r1',
      ts: 't',
      result: output,
    });
    expect(flowCompleteEventFromSummary('r1', { status: 'completed', output: null }, 't')).toEqual({
      type: 'flow_complete',
      runId: 'r1',
      ts: 't',
    });
  });
});

describe('Run-form type tag', () => {
  it('never repeats the label ("model (model)"), and names a decision model', () => {
    expect(runFormTypeLabel(modelPin)).toBeNull();
    expect(runFormTypeLabel(modelPin, 'decision')).toBe('decision model');
    expect(runFormTypeLabel({ id: 'ticket', label: 'ticket', type: 'string' })).toBe('string');
  });
});
