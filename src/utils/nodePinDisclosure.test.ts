import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { getNodePinDisclosure, hasNonDefaultConfiguredPinValue } from './nodePinDisclosure';
import { fromVisualFlow, toVisualFlow } from './serialization';
import { validateConnection } from './validation';

function nodeData(type: FlowNodeData['nodeType']): FlowNodeData {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`missing template: ${type}`);
  return structuredClone(createNodeData(template));
}

function disclosure(
  data: FlowNodeData,
  options: {
    input?: string[];
    output?: string[];
    expanded?: boolean;
  } = {}
) {
  return getNodePinDisclosure({
    data,
    inputs: data.inputs,
    outputs: data.outputs,
    connectedInputPinIds: new Set(options.input || []),
    connectedOutputPinIds: new Set(options.output || []),
    expanded: Boolean(options.expanded),
  });
}

function ids(pins: { id: string }[]): string[] {
  return pins.map((pin) => pin.id);
}

describe('node pin disclosure policy', () => {
  it('compacts image generation to primary authoring pins and artifact output', () => {
    const data = nodeData('generate_image');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(['exec-in', 'prompt']);
    expect(ids(result.outputPins)).toEqual(['exec-out', 'image_artifact']);
    expect(result.hiddenCount).toBeGreaterThan(0);
    expect(result.expandable).toBe(true);
  });

  it('compacts image upscale to source and result artifact pins', () => {
    const data = nodeData('upscale_image');
    const result = disclosure(data);

    expect(data.pinDefaults?.resolution).toBe('2x');
    expect(data.pinDefaults?.softness).toBe(0.25);
    expect(ids(result.inputPins)).toEqual(['exec-in', 'image_artifact']);
    expect(ids(result.outputPins)).toEqual(['exec-out', 'image_artifact']);
    expect(result.hiddenCount).toBeGreaterThan(1);
    expect(result.expandable).toBe(true);
  });

  it('shows connected advanced pins while collapsed', () => {
    const data = nodeData('generate_image');
    const result = disclosure(data, { input: ['width'], output: ['meta'] });

    expect(ids(result.inputPins)).toContain('width');
    expect(ids(result.outputPins)).toContain('meta');
  });

  it('does not treat materialized template defaults as authored values', () => {
    const data = nodeData('generate_image');

    expect(data.pinDefaults?.steps).toBe(20);
    expect(hasNonDefaultConfiguredPinValue(data, 'steps')).toBe(false);
    expect(ids(disclosure(data).inputPins)).not.toContain('steps');
  });

  it('keeps non-default configured values visible while collapsed', () => {
    const data = nodeData('generate_image');
    data.pinDefaults = { ...(data.pinDefaults || {}), steps: 28 };

    expect(hasNonDefaultConfiguredPinValue(data, 'steps')).toBe(true);
    expect(ids(disclosure(data).inputPins)).toContain('steps');
  });

  it('hides unset LLM routing and diagnostics but keeps primary prompt/system', () => {
    const data = nodeData('llm_call');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(['exec-in', 'system', 'prompt']);
    expect(ids(result.inputPins)).not.toContain('provider');
    expect(ids(result.inputPins)).not.toContain('model');
    expect(ids(result.outputPins)).toEqual(['exec-out', 'response']);
  });

  it('keeps configured LLM response schema visible while collapsed', () => {
    const data = nodeData('llm_call');
    data.pinDefaults = {
      ...(data.pinDefaults || {}),
      resp_schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    };
    const result = disclosure(data);

    expect(ids(result.inputPins)).toContain('resp_schema');
    expect(ids(result.outputPins)).toEqual(['exec-out', 'response', 'data']);
  });

  it('shows structured data output when the response schema input is connected', () => {
    const data = nodeData('llm_call');
    const result = disclosure(data, { input: ['resp_schema'] });

    expect(ids(result.inputPins)).toContain('resp_schema');
    expect(ids(result.outputPins)).toEqual(['exec-out', 'response', 'data']);
  });

  it('keeps Agent structured data output visible when a response schema is configured', () => {
    const data = nodeData('agent');
    data.pinDefaults = {
      ...(data.pinDefaults || {}),
      resp_schema: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'] },
    };
    const result = disclosure(data);

    expect(ids(result.outputPins)).toEqual(['exec-out', 'response', 'data']);
  });

  it('keeps Agent tools visible as a primary pin', () => {
    const data = nodeData('agent');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(['exec-in', 'system', 'prompt', 'tools']);
  });

  it('keeps explicit LLM provider and model overrides visible', () => {
    const data = nodeData('llm_call');
    data.effectConfig = { provider: 'lmstudio', model: 'qwen/qwen3.6-35b-a3b' };
    const result = disclosure(data);

    expect(ids(result.inputPins)).toContain('provider');
    expect(ids(result.inputPins)).toContain('model');
  });

  it('suppresses thinking for non-reasoning selected models', () => {
    const data = nodeData('llm_call');
    data.effectConfig = { provider: 'lmstudio', model: 'gemma-4-e4b-it' };
    const result = disclosure(data, { expanded: true });

    expect(ids(result.inputPins)).not.toContain('thinking');
  });

  it('shows thinking for reasoning-capable selected models when expanded', () => {
    const data = nodeData('llm_call');
    data.effectConfig = { provider: 'lmstudio', model: 'qwen/qwen3.6-35b-a3b' };
    const result = disclosure(data, { expanded: true });

    expect(ids(result.inputPins)).toContain('thinking');
  });

  it('does not collapse nodes with only one optional pin', () => {
    const data = nodeData('answer_user');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(['exec-in', 'message', 'level']);
    expect(result.hiddenCount).toBe(0);
    expect(result.expandable).toBe(false);
  });

  it('compacts generated video defaults without treating them as authored values', () => {
    const data = nodeData('generate_video');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(['exec-in', 'prompt']);
    expect(ids(result.outputPins)).toEqual(['exec-out', 'video_artifact']);
    expect(result.hiddenCount).toBeGreaterThan(1);
  });

  it('surfaces plural media outputs when batch generation is configured', () => {
    const data = nodeData('generate_image');
    data.pinDefaults = {
      ...(data.pinDefaults || {}),
      count: 2,
      seeds: [101, 102],
    };
    const result = disclosure(data);

    expect(ids(result.inputPins)).toContain('count');
    expect(ids(result.inputPins)).toContain('seeds');
    expect(ids(result.outputPins)).toContain('image_artifacts');
  });

  it('leaves unlisted small transform nodes unchanged', () => {
    const data = nodeData('add');
    const result = disclosure(data);

    expect(ids(result.inputPins)).toEqual(ids(data.inputs));
    expect(ids(result.outputPins)).toEqual(ids(data.outputs));
    expect(result.hiddenCount).toBe(0);
  });

  it('exposes string predicate utility pins', () => {
    const empty = nodeData('is_empty_string');
    expect(empty.inputs).toEqual([{ id: 'text', label: 'text', type: 'string' }]);
    expect(empty.outputs).toEqual([{ id: 'result', label: 'result', type: 'boolean' }]);
    expect(ids(disclosure(empty).inputPins)).toEqual(['text']);

    const contains = nodeData('contains');
    expect(ids(contains.inputs)).toEqual(['text', 'pattern']);
    expect(contains.outputs).toEqual([{ id: 'result', label: 'result', type: 'boolean' }]);
    expect(ids(disclosure(contains).inputPins)).toEqual(['text', 'pattern']);
  });

  it('keeps serialized input and output arrays unchanged when pins are compacted', () => {
    const data = nodeData('generate_image');
    const result = disclosure(data);
    const nodes: Node<FlowNodeData>[] = [
      {
        id: 'image_1',
        type: 'custom',
        position: { x: 10, y: 20 },
        data,
      },
    ];
    const edges: Edge[] = [];

    expect(ids(result.inputPins)).not.toEqual(ids(data.inputs));
    expect(ids(result.outputPins)).not.toEqual(ids(data.outputs));

    const visualFlow = toVisualFlow('pin_disclosure_flow', 'Pin Disclosure Flow', nodes, edges);
    expect(ids(visualFlow.nodes[0].data.inputs)).toEqual(ids(data.inputs));
    expect(ids(visualFlow.nodes[0].data.outputs)).toEqual(ids(data.outputs));
    expect(visualFlow.nodes[0].data.pinDefaults).toEqual(data.pinDefaults);
  });

  it('round-trips enum response schemas stored in pinDefaults', () => {
    const data = nodeData('llm_call');
    data.pinDefaults = {
      ...(data.pinDefaults || {}),
      resp_schema: {
        type: 'object',
        properties: {
          choice: {
            type: 'string',
            enum: ['approve', 'reject'],
          },
        },
        required: ['choice'],
      },
    };
    const nodes: Node<FlowNodeData>[] = [
      {
        id: 'llm_1',
        type: 'custom',
        position: { x: 10, y: 20 },
        data,
      },
    ];
    const visualFlow = toVisualFlow('enum_schema_flow', 'Enum Schema Flow', nodes, []);
    const roundTrip = fromVisualFlow(visualFlow);

    expect(visualFlow.nodes[0].data.pinDefaults?.resp_schema).toEqual(data.pinDefaults.resp_schema);
    expect(roundTrip.nodes[0].data.pinDefaults?.resp_schema).toEqual(data.pinDefaults.resp_schema);
  });

  it('wires structured LLM data directly into Break Object while response stays text', () => {
    const llmData = nodeData('llm_call');
    llmData.pinDefaults = {
      ...(llmData.pinDefaults || {}),
      resp_schema: {
        type: 'object',
        properties: {
          choice: { type: 'string', enum: ['summarize', 'classify'] },
          confidence: { type: 'number' },
        },
        required: ['choice'],
      },
    };
    const breakData = nodeData('break_object');
    const nodes: Node<FlowNodeData>[] = [
      { id: 'llm_1', type: 'custom', position: { x: 0, y: 0 }, data: llmData },
      { id: 'break_1', type: 'custom', position: { x: 320, y: 0 }, data: breakData },
    ];

    expect(
      validateConnection(nodes, [], {
        source: 'llm_1',
        sourceHandle: 'data',
        target: 'break_1',
        targetHandle: 'object',
      })
    ).toBe(true);
    expect(
      validateConnection(nodes, [], {
        source: 'llm_1',
        sourceHandle: 'response',
        target: 'break_1',
        targetHandle: 'object',
      })
    ).toBe(false);
  });
});
