import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import {
  diffAuthoringDocument,
  flowToAuthoringDocument,
  validateSubflowReference,
} from './flowAuthoringDocument';
import { applyFlowAuthoringCommands } from './flowAuthoringCommands';
import { savedFlowGraphsFromResponse, workflowContractSummary } from './subflowPins';

// Workflow composition (maintainer directive 2026-07-12: "create workflow2,
// then create workflow1 and leverage workflow2 in workflow1") + the
// deletion-budget and pin-update safety mechanics from the same adversary
// wave. These pin the PURE layers: document round-trip, diff, command apply.

function node(id: string, nodeType: string, data: Partial<FlowNodeData> = {}): VisualFlow['nodes'][number] {
  return {
    id,
    type: nodeType as VisualFlow['nodes'][number]['type'],
    position: { x: 0, y: 0 },
    data: {
      nodeType: nodeType as FlowNodeData['nodeType'],
      label: data.label ?? id,
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      ...data,
    } as FlowNodeData,
  };
}

function simpleFlow(nodes: VisualFlow['nodes'], edges: VisualFlow['edges'] = []): VisualFlow {
  return { id: 'root-flow', name: 'Root', nodes, edges };
}

function childFlow(id: string, name: string): VisualFlow {
  return {
    id,
    name,
    nodes: [
      node('start', 'on_flow_start', {
        outputs: [
          { id: 'exec-out', label: '', type: 'execution' },
          { id: 'text', label: 'text', type: 'string' },
        ],
      }),
      node('end', 'on_flow_end', {
        inputs: [
          { id: 'exec-in', label: '', type: 'execution' },
          { id: 'sentiment', label: 'sentiment', type: 'string' },
        ],
      }),
    ],
    edges: [],
  };
}

const configuredSubflowNode = () =>
  node('sub-1', 'subflow', {
    subflowId: 'wf2-id',
    inputs: [
      { id: 'exec-in', label: '', type: 'execution' },
      { id: 'inherit_context', label: 'inherit_context', type: 'boolean' },
      { id: 'text', label: 'text', type: 'string' },
    ],
    outputs: [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'sentiment', label: 'sentiment', type: 'string' },
    ],
  });

describe('workflow composition: document round-trip and subflow_ref', () => {
  it('round-trips a configured subflow node with zero commands', () => {
    const flow = simpleFlow([configuredSubflowNode()]);
    const document = flowToAuthoringDocument(flow);
    expect(document.nodes[0].subflow_ref).toBe('wf2-id');
    expect(document.nodes[0].subflow_interface?.inputs.map((pin) => pin.id)).toEqual(['text']);
    expect(document.nodes[0].subflow_interface?.outputs.map((pin) => pin.id)).toEqual(['sentiment']);
    const diff = diffAuthoringDocument(flow, document, { savedFlows: [{ id: 'wf2-id', name: 'Sentiment' }] });
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([]);
  });

  it('emits set_subflow for a valid reference on a new subflow node', () => {
    const flow = simpleFlow([]);
    const diff = diffAuthoringDocument(
      flow,
      { flow_name: 'Root', nodes: [{ id: 'sub-1', type: 'subflow', subflow_ref: 'wf2-id' }], edges: [] },
      { savedFlows: [{ id: 'wf2-id', name: 'Sentiment' }] }
    );
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toContainEqual({ action: 'set_subflow', nodeId: 'sub-1', subflowId: 'wf2-id' });
  });

  it('refuses an unknown reference with the available list', () => {
    const refusal = validateSubflowReference('nope', { savedFlows: [{ id: 'wf2-id', name: 'Sentiment' }] });
    expect(refusal).toContain('does not match any saved workflow');
    expect(refusal).toContain('wf2-id (Sentiment)');
  });

  it('redirects a name-shaped reference to the saved id', () => {
    const refusal = validateSubflowReference('Sentiment', { savedFlows: [{ id: 'wf2-id', name: 'Sentiment' }] });
    expect(refusal).toContain('matches a workflow NAME');
    expect(refusal).toContain('wf2-id');
  });

  it('refuses self-reference naming the manual recursion path', () => {
    const refusal = validateSubflowReference('root-id', {
      savedFlows: [{ id: 'root-id', name: 'Root' }],
      currentFlowId: 'root-id',
    });
    expect(refusal).toContain('self-reference');
    expect(refusal).toContain('Properties panel');
  });

  it('refuses a reference cycle discovered through resolved child graphs', () => {
    // wf2 references root -> root referencing wf2 would be a cycle.
    const wf2 = childFlow('wf2-id', 'Sentiment');
    wf2.nodes.push(node('sub-back', 'subflow', { subflowId: 'root-id' }));
    const refusal = validateSubflowReference('wf2-id', {
      savedFlows: [{ id: 'wf2-id', name: 'Sentiment' }],
      currentFlowId: 'root-id',
      resolvedSubflows: new Map([['wf2-id', wf2]]),
    });
    expect(refusal).toContain('reference cycle');
    expect(refusal).toContain('root-id -> wf2-id');
  });
});

describe('workflow pick-time contracts', () => {
  it('derives identity, purpose, and the boundary contract from a full graph', () => {
    const wf2 = childFlow('wf2-id', 'Sentiment');
    wf2.description = 'Classifies text sentiment.';
    const start = wf2.nodes.find((entry) => entry.id === 'start');
    if (start) {
      start.data.outputs = [
        { id: 'exec-out', label: '', type: 'execution' },
        { id: 'text', label: 'text', type: 'string', description: 'Text to analyze' },
        { id: 'depth', label: 'depth', type: 'number' },
      ];
      start.data.pinDefaults = { depth: 2 };
    }
    const contract = workflowContractSummary(wf2);
    expect(contract).toMatchObject({ id: 'wf2-id', name: 'Sentiment', description: 'Classifies text sentiment.' });
    expect(contract.inputs).toEqual([
      { id: 'text', type: 'string', description: 'Text to analyze', required: true },
      { id: 'depth', type: 'number', required: false, defaultValue: 2 },
    ]);
    expect(contract.outputs).toEqual([{ id: 'sentiment', type: 'string' }]);
  });

  it('keeps full graphs from the collection response (the summary helper drops them)', () => {
    const graphs = savedFlowGraphsFromResponse([
      childFlow('wf2-id', 'Sentiment'),
      { id: 'not-a-flow', name: 'missing nodes' },
      null,
    ]);
    expect(graphs).toHaveLength(1);
    expect(graphs[0].nodes.length).toBeGreaterThan(0);
  });
});

describe('set_subflow command application', () => {
  it('patches pins from the child boundary and names the node after it', () => {
    const base = node('sub-1', 'subflow', {
      label: 'Subflow',
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'inherit_context', label: 'inherit_context', type: 'boolean' },
        { id: 'input', label: 'input', type: 'object' },
      ],
      outputs: [
        { id: 'exec-out', label: '', type: 'execution' },
        { id: 'output', label: 'output', type: 'object' },
      ],
    });
    const result = applyFlowAuthoringCommands({
      flowName: 'Root',
      flowInterfaces: [],
      nodes: [base as unknown as Node<FlowNodeData>],
      edges: [],
      commands: [{ action: 'set_subflow', nodeId: 'sub-1', subflowId: 'wf2-id' }],
      resolvedSubflows: new Map([['wf2-id', childFlow('wf2-id', 'Sentiment')]]),
    });
    expect(result.errors).toEqual([]);
    const data = result.nodes[0].data;
    expect(data.subflowId).toBe('wf2-id');
    expect(data.label).toBe('Sentiment');
    expect((data.inputs || []).map((pin) => pin.id)).toEqual(['exec-in', 'inherit_context', 'text']);
    expect((data.outputs || []).map((pin) => pin.id)).toEqual(['exec-out', 'sentiment']);
  });

  it('refuses set_subflow on a non-subflow node', () => {
    const result = applyFlowAuthoringCommands({
      flowName: 'Root',
      flowInterfaces: [],
      nodes: [node('llm-1', 'llm_call') as unknown as Node<FlowNodeData>],
      edges: [],
      commands: [{ action: 'set_subflow', nodeId: 'llm-1', subflowId: 'wf2-id' }],
    });
    expect(result.errors.some((error) => error.includes('not a subflow'))).toBe(true);
  });
});

describe('deletion budget', () => {
  const sixNodes = () => [
    node('start', 'on_flow_start', { outputs: [{ id: 'exec-out', label: '', type: 'execution' }] }),
    node('a', 'concat'),
    node('b', 'concat'),
    node('c', 'concat'),
    node('d', 'concat'),
    node('end', 'on_flow_end', { inputs: [{ id: 'exec-in', label: '', type: 'execution' }] }),
  ];

  it('refuses a truncation-shaped document (mass omission) without confirmation', () => {
    const flow = simpleFlow(sixNodes());
    const diff = diffAuthoringDocument(flow, {
      flow_name: 'Root',
      nodes: [{ id: 'start', type: 'on_flow_start' }],
      edges: [],
    });
    expect(diff.commands).toEqual([]);
    expect(diff.errors.some((error) => error.includes('omits 5 of 6 existing nodes'))).toBe(true);
    expect(diff.errors.some((error) => error.includes('confirm_deletions'))).toBe(true);
  });

  it('applies the mass deletion when every omitted id is confirmed', () => {
    const flow = simpleFlow(sixNodes());
    const diff = diffAuthoringDocument(flow, {
      flow_name: 'Root',
      nodes: [{ id: 'start', type: 'on_flow_start' }],
      edges: [],
      confirm_deletions: ['a', 'b', 'c', 'd', 'end'],
    });
    expect(diff.errors).toEqual([]);
    const deletions = diff.commands.filter(
      (command) => (command as { action?: string }).action === 'delete_node'
    );
    expect(deletions).toHaveLength(5);
  });

  it('small deletions stay budget-free (the normal editing shape)', () => {
    const flow = simpleFlow(sixNodes());
    const diff = diffAuthoringDocument(flow, {
      flow_name: 'Root',
      nodes: sixNodes().slice(0, 5).map((entry) => ({ id: entry.id, type: String(entry.data.nodeType) })),
      edges: [],
    });
    expect(diff.errors).toEqual([]);
    expect(diff.commands.filter((command) => (command as { action?: string }).action === 'delete_node')).toHaveLength(1);
  });
});

describe('dynamic pin updates (type change repairs)', () => {
  it('diffs a same-id type change into update_pin instead of silence', () => {
    const flow = simpleFlow([
      node('start', 'on_flow_start', {
        outputs: [
          { id: 'exec-out', label: '', type: 'execution' },
          { id: 'topic', label: 'topic', type: 'string' },
        ],
      }),
    ]);
    const diff = diffAuthoringDocument(flow, {
      flow_name: 'Root',
      nodes: [
        { id: 'start', type: 'on_flow_start', outputs: [{ id: 'topic', type: 'number' }] },
      ],
      edges: [],
    });
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toContainEqual(
      expect.objectContaining({ action: 'update_pin', nodeId: 'start', id: 'topic', pinType: 'number' })
    );
  });

  it('applies update_pin retype and keeps compatible edges', () => {
    const start = node('start', 'on_flow_start', {
      outputs: [
        { id: 'exec-out', label: '', type: 'execution' },
        { id: 'topic', label: 'topic', type: 'string' },
      ],
    });
    const end = node('end', 'on_flow_end', {
      inputs: [
        { id: 'exec-in', label: '', type: 'execution' },
        { id: 'result', label: 'result', type: 'any' },
      ],
    });
    const result = applyFlowAuthoringCommands({
      flowName: 'Root',
      flowInterfaces: [],
      nodes: [start, end] as unknown as Node<FlowNodeData>[],
      edges: [
        { id: 'e1', source: 'start', sourceHandle: 'topic', target: 'end', targetHandle: 'result' },
      ],
      commands: [{ action: 'update_pin', nodeId: 'start', id: 'topic', side: 'output', pinType: 'number' }],
    });
    expect(result.errors).toEqual([]);
    expect(result.nodes[0].data.outputs?.find((pin) => pin.id === 'topic')?.type).toBe('number');
    // number -> any stays a valid connection; the edge survives.
    expect(result.edges).toHaveLength(1);
  });

  it('re-emitting a pin default with a NESTED redacted secret compiles to zero commands (round-trip)', () => {
    const flow = simpleFlow([
      node('http-1', 'http_request', {
        pinDefaults: { headers: { Authorization: 'Bearer sk-1234567890abcdefghij' } },
      } as never),
    ]);
    const document = flowToAuthoringDocument(flow);
    const headers = document.nodes[0].pin_defaults?.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe('<redacted>');
    const diff = diffAuthoringDocument(flow, document);
    expect(diff.errors).toEqual([]);
    expect(diff.commands).toEqual([]);
  });

  it('carries description and schema through add_output_pin', () => {
    const flow = simpleFlow([
      node('start', 'on_flow_start', { outputs: [{ id: 'exec-out', label: '', type: 'execution' }] }),
    ]);
    const diff = diffAuthoringDocument(flow, {
      flow_name: 'Root',
      nodes: [
        {
          id: 'start',
          type: 'on_flow_start',
          outputs: [
            {
              id: 'documents',
              type: 'array',
              description: 'Folder of PDFs to analyze',
              schema: { type: 'array', items: { type: 'string', 'x-abstract-type': 'file' } },
            },
          ],
        },
      ],
      edges: [],
    });
    const add = diff.commands.find((command) => (command as { action?: string }).action === 'add_output_pin') as
      | Record<string, unknown>
      | undefined;
    expect(add).toBeTruthy();
    expect(add?.description).toBe('Folder of PDFs to analyze');
    expect((add?.schema as Record<string, unknown>)?.items).toEqual({ type: 'string', 'x-abstract-type': 'file' });

    const result = applyFlowAuthoringCommands({
      flowName: 'Root',
      flowInterfaces: [],
      nodes: flow.nodes as unknown as Node<FlowNodeData>[],
      edges: [],
      commands: diff.commands,
    });
    const pin = result.nodes[0].data.outputs?.find((entry) => entry.id === 'documents');
    expect(pin?.description).toBe('Folder of PDFs to analyze');
    expect(pin?.schema?.items).toEqual({ type: 'string', 'x-abstract-type': 'file' });
  });
});
