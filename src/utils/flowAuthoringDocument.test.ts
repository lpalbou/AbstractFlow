import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { applyFlowAuthoringCommands, type FlowAuthoringApplyResult } from './flowAuthoringCommands';
import {
  diffAuthoringDocument,
  flowToAuthoringDocument,
  parseEdgeEndpoint,
  stableStringify,
} from './flowAuthoringDocument';

function emptyState() {
  return {
    flowName: 'Untitled Flow',
    flowInterfaces: [],
    nodes: [] as Node<FlowNodeData>[],
    edges: [] as Edge[],
  };
}

function toVisualFlow(result: FlowAuthoringApplyResult): VisualFlow {
  return {
    id: 'test-flow',
    name: result.flowName,
    nodes: result.nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      position: node.position,
      data: node.data,
    })),
    edges: result.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle || '',
      target: edge.target,
      targetHandle: edge.targetHandle || '',
    })),
  };
}

function buildFlow(commands: unknown[], flowName = 'Test Flow'): VisualFlow {
  const result = applyFlowAuthoringCommands({ ...emptyState(), flowName, commands });
  expect(result.errors).toEqual([]);
  return toVisualFlow(result);
}

/** Apply a document to a flow through the diff compiler + command machinery. */
function applyDocument(flow: VisualFlow, document: unknown): { result: FlowAuthoringApplyResult; diffErrors: string[] } {
  const diff = diffAuthoringDocument(flow, document);
  const result = applyFlowAuthoringCommands({
    flowName: flow.name,
    flowInterfaces: [],
    nodes: flow.nodes.map((node) => ({ id: node.id, type: 'custom', position: node.position, data: node.data })),
    edges: flow.edges.map((edge) => ({ ...edge })),
    commands: diff.commands,
    allowDestructive: true,
  });
  return { result, diffErrors: diff.errors };
}

const RESEARCH_FLOW_COMMANDS = [
  { action: 'set_flow_name', name: 'Research Flow' },
  { action: 'add_node', id: 'start', nodeType: 'on_flow_start', position: { x: 0, y: 0 } },
  { action: 'add_output_pin', nodeId: 'start', id: 'topic', label: 'topic', pinType: 'string' },
  { action: 'add_node', id: 'agent', nodeType: 'agent', label: 'Research agent', position: { x: 320, y: 0 } },
  { action: 'set_pin_default', nodeId: 'agent', pin: 'system', value: 'You are a research agent.' },
  { action: 'add_node', id: 'end', nodeType: 'on_flow_end', position: { x: 640, y: 0 } },
  { action: 'add_input_pin', nodeId: 'end', id: 'report', label: 'report', pinType: 'string' },
  { action: 'connect', source: 'start', sourceHandle: 'exec-out', target: 'agent', targetHandle: 'exec-in' },
  { action: 'connect', source: 'start', sourceHandle: 'topic', target: 'agent', targetHandle: 'prompt' },
  { action: 'connect', source: 'agent', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' },
  { action: 'connect', source: 'agent', sourceHandle: 'response', target: 'end', targetHandle: 'report' },
];

describe('flowToAuthoringDocument', () => {
  it('serializes nodes, dynamic pins, defaults, and edges', () => {
    const flow = buildFlow(RESEARCH_FLOW_COMMANDS);
    const doc = flowToAuthoringDocument(flow);

    expect(doc.flow_name).toBe('Research Flow');
    expect(doc.nodes.map((node) => node.id)).toEqual(['start', 'agent', 'end']);
    const start = doc.nodes.find((node) => node.id === 'start');
    expect(start?.outputs).toEqual([{ id: 'topic', type: 'string' }]);
    const agent = doc.nodes.find((node) => node.id === 'agent');
    expect(agent?.label).toBe('Research agent');
    expect(agent?.pin_defaults?.system).toBe('You are a research agent.');
    const end = doc.nodes.find((node) => node.id === 'end');
    expect(end?.inputs).toEqual([{ id: 'report', type: 'string' }]);
    expect(doc.edges).toContain('start.topic -> agent.prompt');
    expect(doc.edges).toContain('agent.response -> end.report');
  });

  it('redacts secret-looking defaults in the serialized document', () => {
    // Secrets cannot enter through authoring commands (they are refused), but
    // user-built flows edited in the Properties panel can contain them; the
    // serialized document must never leak them to the model.
    const flow = buildFlow([{ action: 'add_node', id: 'tmpl', nodeType: 'string_template' }]);
    const tmpl = flow.nodes.find((node) => node.id === 'tmpl');
    tmpl!.data.pinDefaults = { template: 'sk-aaaaaaaaaaaaaaaaaaaaaaaa', api_key: 'whatever' };
    const doc = flowToAuthoringDocument(flow);
    const serialized = doc.nodes.find((node) => node.id === 'tmpl');
    expect(serialized?.pin_defaults?.template).toBe('<redacted>');
    expect(serialized?.pin_defaults?.api_key).toBe('<redacted>');
    // And the diff never writes the sentinel back.
    const diff = diffAuthoringDocument(flow, doc);
    expect(diff.commands).toEqual([]);
  });
});

describe('diffAuthoringDocument round trip', () => {
  it('produces zero commands when re-emitting the serialized document', () => {
    // THE core invariant: an idempotent re-emit must not look like progress.
    const flow = buildFlow(RESEARCH_FLOW_COMMANDS);
    const doc = flowToAuthoringDocument(flow);
    const diff = diffAuthoringDocument(flow, doc);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([]);
  });

  it('round-trips switch, sequence, break object, code, and concat configuration', () => {
    const flow = buildFlow([
      { action: 'add_node', id: 'sw', nodeType: 'switch', label: 'Route by intent' },
      { action: 'set_switch_cases', nodeId: 'sw', cases: [{ value: 'research' }, { value: 'chat' }] },
      { action: 'add_node', id: 'seq', nodeType: 'sequence', label: 'Fan out' },
      { action: 'set_branch_count', nodeId: 'seq', count: 3 },
      { action: 'add_node', id: 'brk', nodeType: 'break_object', label: 'Split result' },
      { action: 'set_break_paths', nodeId: 'brk', paths: [{ path: 'report', pinType: 'string' }, { path: 'sources', pinType: 'object' }] },
      { action: 'add_node', id: 'code', nodeType: 'code', label: 'Shape output', codeBody: 'return {"ok": True}' },
      { action: 'add_node', id: 'cat', nodeType: 'concat', label: 'Join', concatSeparator: ', ' },
    ]);
    const doc = flowToAuthoringDocument(flow);
    const diff = diffAuthoringDocument(flow, doc);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([]);
  });

  it('builds a full flow from a model-emitted document and re-applies idempotently', () => {
    const emptyFlow: VisualFlow = { id: 'draft', name: 'Untitled Flow', nodes: [], edges: [] };
    const document = {
      flow_name: 'News Digest',
      nodes: [
        { id: 'start', type: 'on_flow_start', outputs: [{ id: 'topic', type: 'string' }] },
        {
          id: 'agent',
          type: 'agent',
          label: 'Digest agent',
          pin_defaults: { system: 'Summarize the news.', max_iterations: 50 },
        },
        { id: 'end', type: 'on_flow_end', inputs: [{ id: 'digest', type: 'string' }] },
      ],
      edges: [
        'start.exec-out -> agent.exec-in',
        'start.topic -> agent.prompt',
        'agent.exec-out -> end.exec-in',
        'agent.response -> end.digest',
      ],
    };

    const { result, diffErrors } = applyDocument(emptyFlow, document);
    expect(diffErrors).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.flowName).toBe('News Digest');
    expect(result.nodes.map((node) => node.id)).toEqual(['start', 'agent', 'end']);
    expect(result.edges).toHaveLength(4);
    // New nodes get auto-layout positions (no overlap at origin).
    const positions = result.nodes.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);

    // Re-emitting the same document against the built flow is a no-op.
    const rebuilt = toVisualFlow(result);
    const second = diffAuthoringDocument(rebuilt, document);
    expect(second.errors).toEqual([]);
    expect(second.commands).toEqual([]);
  });
});

describe('diffAuthoringDocument ownership semantics', () => {
  it('deletes nodes omitted from the document together with their edges', () => {
    const flow = buildFlow(RESEARCH_FLOW_COMMANDS);
    const doc = flowToAuthoringDocument(flow);
    const withoutAgent = {
      ...doc,
      nodes: doc.nodes.filter((node) => node.id !== 'agent'),
      edges: doc.edges.filter((edge) => !edge.includes('agent')),
    };
    const diff = diffAuthoringDocument(flow, withoutAgent);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([{ action: 'delete_node', nodeId: 'agent' }]);

    const { result } = applyDocument(flow, withoutAgent);
    expect(result.errors).toEqual([]);
    expect(result.nodes.map((node) => node.id)).toEqual(['start', 'end']);
    expect(result.edges).toEqual([]);
  });

  it('replaces a rewired edge with disconnect before connect', () => {
    const flow = buildFlow(RESEARCH_FLOW_COMMANDS);
    const doc = flowToAuthoringDocument(flow);
    const rewired = {
      ...doc,
      edges: doc.edges.map((edge) => (edge === 'agent.response -> end.report' ? 'agent.data -> end.report' : edge)),
    };
    const diff = diffAuthoringDocument(flow, rewired);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([
      { action: 'disconnect', source: 'agent', sourceHandle: 'response', target: 'end', targetHandle: 'report' },
      { action: 'connect', source: 'agent', sourceHandle: 'data', target: 'end', targetHandle: 'report' },
    ]);
  });

  it('merges pin_defaults per key and never writes redacted values back', () => {
    const flow = buildFlow([
      { action: 'add_node', id: 'agent', nodeType: 'agent', label: 'Agent' },
      { action: 'set_pin_default', nodeId: 'agent', pin: 'system', value: 'Old system' },
      { action: 'set_pin_default', nodeId: 'agent', pin: 'prompt', value: 'Keep me' },
    ]);
    const document = {
      flow_name: flow.name,
      nodes: [
        {
          id: 'agent',
          type: 'agent',
          label: 'Agent',
          // 'prompt' omitted (kept), system changed, api-key-ish value redacted.
          pin_defaults: { system: 'New system', context: '<redacted>' },
        },
      ],
      edges: [],
    };
    const diff = diffAuthoringDocument(flow, document);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([{ action: 'set_pin_default', nodeId: 'agent', pin: 'system', value: 'New system' }]);
  });

  it('adds and removes dynamic pins to match the document pin list', () => {
    const flow = buildFlow([
      { action: 'add_node', id: 'start', nodeType: 'on_flow_start' },
      { action: 'add_output_pin', nodeId: 'start', id: 'old_topic', pinType: 'string' },
    ]);
    const document = {
      flow_name: flow.name,
      nodes: [{ id: 'start', type: 'on_flow_start', outputs: [{ id: 'topic', type: 'string' }] }],
      edges: [],
    };
    const diff = diffAuthoringDocument(flow, document);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([
      { action: 'add_output_pin', nodeId: 'start', id: 'topic', pinType: 'string' },
      { action: 'remove_pin', nodeId: 'start', id: 'old_topic', side: 'output' },
    ]);

    const { result } = applyDocument(flow, document);
    expect(result.errors).toEqual([]);
    const start = result.nodes.find((node) => node.id === 'start');
    expect(start?.data.outputs.map((pin) => pin.id)).toEqual(['exec-out', 'topic']);
  });

  it('rejects a type change on a stable node id with an actionable error', () => {
    const flow = buildFlow([{ action: 'add_node', id: 'agent', nodeType: 'agent', label: 'Agent' }]);
    const document = {
      flow_name: flow.name,
      nodes: [{ id: 'agent', type: 'llm_call', label: 'Agent' }],
      edges: [],
    };
    const diff = diffAuthoringDocument(flow, document);
    expect(diff.errors.some((error) => error.includes('cannot change type'))).toBe(true);
    expect(diff.commands).toEqual([]);
  });

  it('reports malformed and unknown-node edges without discarding the document', () => {
    const flow = buildFlow([{ action: 'add_node', id: 'start', nodeType: 'on_flow_start' }]);
    const document = {
      flow_name: flow.name,
      nodes: [{ id: 'start', type: 'on_flow_start' }],
      edges: ['nonsense edge text', 'ghost.exec-out -> start.exec-in'],
    };
    const diff = diffAuthoringDocument(flow, document);
    expect(diff.errors.some((error) => error.includes('must use the form'))).toBe(true);
    expect(diff.errors.some((error) => error.includes('unknown node'))).toBe(true);
    expect(diff.commands).toEqual([]);
  });
});

describe('remove_pin command', () => {
  it('removes a dynamic pin and drops its edges', () => {
    const built = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [
        ...RESEARCH_FLOW_COMMANDS,
      ],
    });
    expect(built.errors).toEqual([]);
    const result = applyFlowAuthoringCommands({
      flowName: built.flowName,
      flowInterfaces: [],
      nodes: built.nodes,
      edges: built.edges,
      commands: [{ action: 'remove_pin', nodeId: 'end', id: 'report', side: 'input' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.applied).toContain('Removed input end.report');
    const end = result.nodes.find((node) => node.id === 'end');
    expect(end?.data.inputs.some((pin) => pin.id === 'report')).toBe(false);
    expect(result.edges.some((edge) => edge.target === 'end' && edge.targetHandle === 'report')).toBe(false);
  });

  it('refuses template-owned pins on fixed-pin nodes', () => {
    const built = applyFlowAuthoringCommands({
      ...emptyState(),
      commands: [{ action: 'add_node', id: 'llm', nodeType: 'llm_call', label: 'Call' }],
    });
    const result = applyFlowAuthoringCommands({
      flowName: built.flowName,
      flowInterfaces: [],
      nodes: built.nodes,
      edges: built.edges,
      commands: [{ action: 'remove_pin', nodeId: 'llm', id: 'prompt', side: 'input' }],
    });
    expect(result.errors.some((error) => error.includes('template-owned'))).toBe(true);
  });
});

describe('parseEdgeEndpoint', () => {
  it('prefers the longest known node id over the first dot', () => {
    const known = new Set(['my.node', 'my']);
    expect(parseEdgeEndpoint('my.node.exec-out', known)).toEqual({ node: 'my.node', handle: 'exec-out' });
    expect(parseEdgeEndpoint('brk.user.name', new Set(['brk']))).toEqual({ node: 'brk', handle: 'user.name' });
    expect(parseEdgeEndpoint('unknown.pin', new Set())).toEqual({ node: 'unknown', handle: 'pin' });
    expect(parseEdgeEndpoint('nodot', new Set())).toBeNull();
  });
});

describe('stableStringify', () => {
  it('is key-order independent for objects', () => {
    expect(stableStringify({ a: 1, b: [{ d: 2, c: 3 }] })).toBe(stableStringify({ b: [{ c: 3, d: 2 }], a: 1 }));
  });
});
