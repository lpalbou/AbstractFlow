import { describe, expect, it } from 'vitest';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import {
  defaultSubflowPinPatch,
  savedFlowOptions,
  savedFlowSummariesFromResponse,
  subflowExecutionLabel,
  subflowPinPatchForSelectedFlow,
} from './subflowPins';

function nodeData(type: FlowNodeData['nodeType']): FlowNodeData {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`missing template: ${type}`);
  return structuredClone(createNodeData(template));
}

function childFlow(): VisualFlow {
  const start = nodeData('on_flow_start');
  start.outputs = [
    { id: 'exec-out', label: '', type: 'execution' },
    { id: 'prompt', label: 'prompt', type: 'string' },
    { id: 'frames', label: 'frames', type: 'number' },
  ];

  const end = nodeData('on_flow_end');
  end.inputs = [
    { id: 'exec-in', label: '', type: 'execution' },
    { id: 'output1', label: 'output1', type: 'object' },
  ];

  return {
    id: 'generate-video',
    name: 'Generate Video',
    entryNode: 'start',
    nodes: [
      { id: 'start', type: 'on_flow_start', position: { x: 0, y: 0 }, data: start },
      { id: 'end', type: 'on_flow_end', position: { x: 400, y: 0 }, data: end },
    ],
    edges: [],
  };
}

function childJudgeFlow(): VisualFlow {
  const start = nodeData('on_flow_start');
  start.outputs = [
    { id: 'exec-out', label: '', type: 'execution' },
    { id: 'task', label: 'task', type: 'string' },
    { id: 'criteria', label: 'criteria', type: 'object' },
  ];

  const llm = nodeData('llm_call');
  const end = nodeData('on_flow_end');
  end.inputs = [
    { id: 'exec-in', label: '', type: 'execution' },
    { id: 'evaluations', label: 'evaluations', type: 'object' },
  ];

  return {
    id: 'judge',
    name: 'Judge',
    entryNode: 'start',
    nodes: [
      { id: 'start', type: 'on_flow_start', position: { x: 0, y: 0 }, data: start },
      { id: 'llm', type: 'llm_call', position: { x: 250, y: 0 }, data: llm },
      { id: 'end', type: 'on_flow_end', position: { x: 500, y: 0 }, data: end },
    ],
    edges: [
      {
        id: 'criteria-schema',
        source: 'start',
        sourceHandle: 'criteria',
        target: 'llm',
        targetHandle: 'resp_schema',
      },
      {
        id: 'llm-data-output',
        source: 'llm',
        sourceHandle: 'data',
        target: 'end',
        targetHandle: 'evaluations',
      },
    ],
  };
}

function ids(pins: { id: string }[]): string[] {
  return pins.map((pin) => pin.id);
}

describe('subflow pin derivation', () => {
  it('keeps subflow control pins while replacing child data pins from the selected flow', () => {
    const parent = nodeData('subflow');
    const patch = subflowPinPatchForSelectedFlow(parent, childFlow());

    expect(patch).not.toBeNull();
    expect(ids(patch?.inputs || [])).toEqual(['exec-in', 'inherit_context', 'prompt', 'frames']);
    expect(ids(patch?.outputs || [])).toEqual(['exec-out', 'output1']);
  });

  it('resets cleared subflows to the default generic input and output shape', () => {
    const parent = nodeData('subflow');
    parent.inputs = [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'inherit_context', label: 'inherit_context', type: 'boolean' },
      { id: 'prompt', label: 'prompt', type: 'string' },
    ];

    const patch = defaultSubflowPinPatch(parent);

    expect(ids(patch.inputs)).toEqual(['exec-in', 'inherit_context', 'input']);
    expect(ids(patch.outputs)).toEqual(['exec-out', 'output']);
  });

  it('normalizes saved flow list responses for node and panel selectors', () => {
    const summaries = savedFlowSummariesFromResponse([
      { id: 'current', name: 'Current Flow' },
      { id: 'child', name: 'Child Flow' },
      { id: 123, name: 'Bad Flow' },
    ]);

    expect(summaries).toEqual([
      { id: 'current', name: 'Current Flow' },
      { id: 'child', name: 'Child Flow' },
    ]);
    expect(savedFlowOptions(summaries, 'current')).toEqual([
      { value: 'current', label: 'Current Flow (current) - this flow (recursive)' },
      { value: 'child', label: 'Child Flow (child)' },
    ]);
  });

  it('labels subflow execution steps by selected flow name when available', () => {
    const flowNameById = new Map([['judge', 'Judge Flow']]);

    expect(
      subflowExecutionLabel({ nodeType: 'subflow', label: 'Subflow', subflowId: 'judge' }, flowNameById, 'node-3')
    ).toBe('Judge Flow');
    expect(
      subflowExecutionLabel({ nodeType: 'subflow', label: 'Review Step', subflowId: 'missing' }, flowNameById, 'node-4')
    ).toBe('Review Step');
    expect(
      subflowExecutionLabel({ nodeType: 'subflow', label: 'Subflow', subflowId: 'missing' }, flowNameById, 'node-5')
    ).toBe('missing');
  });

  it('preserves child flow output pin schema metadata', () => {
    const parent = nodeData('subflow');
    const flow = childFlow();
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
      },
    };
    const end = flow.nodes.find((node) => node.type === 'on_flow_end');
    if (!end) throw new Error('missing end node');
    end.data.inputs = [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'evaluations', label: 'evaluations', type: 'object', schema },
    ];

    const patch = subflowPinPatchForSelectedFlow(parent, flow);
    expect(patch?.outputs.find((pin) => pin.id === 'evaluations')?.schema).toEqual(schema);
  });

  it('refreshes subflow pins when only schema metadata changes', () => {
    const parent = nodeData('subflow');
    parent.inputs = [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'inherit_context', label: 'inherit_context', type: 'boolean' },
      { id: 'prompt', label: 'prompt', type: 'string' },
      { id: 'frames', label: 'frames', type: 'number' },
    ];
    parent.outputs = [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'output1', label: 'output1', type: 'object' },
    ];

    const flow = childFlow();
    const end = flow.nodes.find((node) => node.type === 'on_flow_end');
    if (!end) throw new Error('missing end node');
    end.data.inputs = [
      { id: 'exec-in', label: '', type: 'execution' },
      {
        id: 'output1',
        label: 'output1',
        type: 'object',
        schema: { type: 'object', properties: { score: { type: 'number' } } },
      },
    ];

    const patch = subflowPinPatchForSelectedFlow(parent, flow);
    expect(patch).not.toBeNull();
    expect(patch?.outputs.find((pin) => pin.id === 'output1')?.schema).toEqual({
      type: 'object',
      properties: { score: { type: 'number' } },
    });
  });

  it('infers child flow output schema through a response schema supplied by a subflow input default', () => {
    const parent = nodeData('subflow');
    parent.pinDefaults = {
      criteria: {
        completion: 0,
        quality: 0,
      },
    };

    const patch = subflowPinPatchForSelectedFlow(parent, childJudgeFlow());
    const evaluations = patch?.outputs.find((pin) => pin.id === 'evaluations');

    expect(evaluations?.schema).toEqual({
      type: 'object',
      properties: {
        completion: { type: 'integer' },
        quality: { type: 'integer' },
      },
      required: ['completion', 'quality'],
    });
  });
});
