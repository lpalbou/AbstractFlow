import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import {
  buildSubflowFlow,
  danglingSubflowHandles,
  MAX_SUBFLOW_DEFINITIONS_PER_EMISSION,
  parseSubflowDefinitions,
  resolveSubflowHandles,
} from './subflowAuthoring';

/** A well-formed helper definition in the document grammar. */
function helperDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: 'extract-claims',
    flow_name: 'extract-claims',
    description: 'Extracts factual claims from a text block.',
    nodes: [
      {
        id: 'start',
        type: 'on_flow_start',
        outputs: [{ id: 'text', type: 'string' }],
      },
      {
        id: 'end',
        type: 'on_flow_end',
        inputs: [{ id: 'claims', type: 'string' }],
      },
    ],
    edges: ['start.exec-out -> end.exec-in', 'start.text -> end.claims'],
    ...overrides,
  };
}

function graphWith(subflows: unknown[], nodes: unknown[] = []): Record<string, unknown> {
  return { flow_name: 'Main', nodes, edges: [], subflows };
}

const NO_SAVED = { savedFlows: [], refMap: {} };

describe('parseSubflowDefinitions', () => {
  it('parses a valid definition', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition()]), NO_SAVED);
    expect(parsed.errors).toEqual([]);
    expect(parsed.definitions).toHaveLength(1);
    expect(parsed.definitions[0].ref).toBe('extract-claims');
    expect(parsed.definitions[0].flowName).toBe('extract-claims');
  });

  it('is absent-safe: no subflows key means no definitions and no errors', () => {
    const parsed = parseSubflowDefinitions({ flow_name: 'Main', nodes: [], edges: [] }, NO_SAVED);
    expect(parsed.errors).toEqual([]);
    expect(parsed.definitions).toEqual([]);
  });

  it('refuses missing ref, name, description, and empty nodes with repairable errors', () => {
    const parsed = parseSubflowDefinitions(
      graphWith([
        helperDefinition({ ref: '' }),
        helperDefinition({ ref: 'no-name', flow_name: '' }),
        helperDefinition({ ref: 'no-desc', description: '' }),
        helperDefinition({ ref: 'no-nodes', nodes: [] }),
      ]),
      NO_SAVED
    );
    expect(parsed.definitions).toEqual([]);
    expect(parsed.errors).toHaveLength(4);
    expect(parsed.errors[0]).toContain('missing "ref"');
    expect(parsed.errors[1]).toContain('missing "flow_name"');
    expect(parsed.errors[2]).toContain('missing "description"');
    expect(parsed.errors[3]).toContain('no nodes');
  });

  it('refuses duplicate refs and invalid handle spellings', () => {
    const parsed = parseSubflowDefinitions(
      graphWith([helperDefinition(), helperDefinition(), helperDefinition({ ref: 'Bad Handle!' })]),
      NO_SAVED
    );
    expect(parsed.definitions).toHaveLength(1);
    expect(parsed.errors.some((error) => error.includes('duplicate ref'))).toBe(true);
    expect(parsed.errors.some((error) => error.includes('not a valid handle'))).toBe(true);
  });

  it('refuses a ref colliding with a saved workflow id', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition({ ref: 'abc12345' })]), {
      savedFlows: [{ id: 'abc12345', name: 'existing' }],
      refMap: {},
    });
    expect(parsed.definitions).toEqual([]);
    expect(parsed.errors[0]).toContain('collides with an existing saved workflow id');
  });

  it('refuses a flow_name colliding with an unrelated library workflow', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition({ flow_name: 'deep-research' })]), {
      savedFlows: [{ id: 'dp-research', name: 'deep-research' }],
      refMap: {},
    });
    expect(parsed.definitions).toEqual([]);
    expect(parsed.errors[0]).toContain('already exists');
  });

  it('allows the update path to keep its own name (ref already mapped to that id)', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition()]), {
      savedFlows: [{ id: 'f1o2w3', name: 'extract-claims' }],
      refMap: { 'extract-claims': 'f1o2w3' },
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.definitions).toHaveLength(1);
  });

  it('enforces the per-emission budget', () => {
    const defs = Array.from({ length: MAX_SUBFLOW_DEFINITIONS_PER_EMISSION + 1 }, (_, index) =>
      helperDefinition({ ref: `helper-${index}` })
    );
    const parsed = parseSubflowDefinitions(graphWith(defs), NO_SAVED);
    expect(parsed.definitions).toEqual([]);
    expect(parsed.errors[0]).toContain('budget');
  });
});

describe('resolveSubflowHandles + danglingSubflowHandles', () => {
  const mainNodes = [
    { id: 'call', type: 'subflow', subflow_ref: 'ref:extract-claims' },
    { id: 'call2', type: 'subflow', subflow_ref: 'extract-claims' },
    { id: 'call3', type: 'subflow', subflow_ref: 'realid99' },
  ];

  it('rewrites ref: and bare handles to the mapped id, leaving real ids alone', () => {
    const resolved = resolveSubflowHandles(graphWith([], mainNodes), { 'extract-claims': 'new1234' }) as {
      nodes: { subflow_ref?: string }[];
    };
    expect(resolved.nodes[0].subflow_ref).toBe('new1234');
    expect(resolved.nodes[1].subflow_ref).toBe('new1234');
    expect(resolved.nodes[2].subflow_ref).toBe('realid99');
  });

  it('reports ref:-shaped handles that have no definition and no mapping', () => {
    const dangling = danglingSubflowHandles(graphWith([], mainNodes), new Set(), {});
    expect(dangling).toEqual(['extract-claims']);
    // With a definition present it is not dangling.
    expect(danglingSubflowHandles(graphWith([], mainNodes), new Set(['extract-claims']), {})).toEqual([]);
  });
});

describe('buildSubflowFlow', () => {
  const buildContext = { savedFlows: [], resolvedSubflows: new Map<string, VisualFlow>() };

  it('builds a store-shaped flow through the validated document lane', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition()]), NO_SAVED);
    const built = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    expect(built.errors).toEqual([]);
    expect(built.flow).not.toBeNull();
    expect(built.flow?.name).toBe('extract-claims');
    expect(built.flow?.description).toContain('claims');
    expect(built.flow?.nodes).toHaveLength(2);
    expect(built.flow?.edges).toHaveLength(2);
    expect(built.flow?.entryNode).toBe('start');
  });

  it('refuses a definition without on_flow_start', () => {
    const def = helperDefinition({
      nodes: [{ id: 'end', type: 'on_flow_end', inputs: [{ id: 'out', type: 'string' }] }],
      edges: [],
    });
    const parsed = parseSubflowDefinitions(graphWith([def]), NO_SAVED);
    const built = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    expect(built.flow).toBeNull();
    expect(built.errors[0]).toContain('no On Flow Start');
  });

  it('warns (not errors) when on_flow_end is missing', () => {
    const def = helperDefinition({
      nodes: [{ id: 'start', type: 'on_flow_start', outputs: [{ id: 'text', type: 'string' }] }],
      edges: [],
    });
    const parsed = parseSubflowDefinitions(graphWith([def]), NO_SAVED);
    const built = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    expect(built.errors).toEqual([]);
    expect(built.flow?.warnings.some((warning) => warning.includes('no On Flow End'))).toBe(true);
  });

  it('refuses nested ref: handles inside a definition', () => {
    const def = helperDefinition({
      nodes: [
        { id: 'start', type: 'on_flow_start', outputs: [] },
        { id: 'inner', type: 'subflow', subflow_ref: 'ref:another-helper' },
      ],
      edges: ['start.exec-out -> inner.exec-in'],
    });
    const parsed = parseSubflowDefinitions(graphWith([def]), NO_SAVED);
    const built = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    expect(built.flow).toBeNull();
    expect(built.errors[0]).toContain('SAVED workflows only');
  });

  it('reports a faithful re-emission of an existing helper as unchanged', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition()]), NO_SAVED);
    const first = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    expect(first.flow).not.toBeNull();
    const saved: VisualFlow = {
      id: 'f1o2w3',
      name: first.flow!.name,
      description: first.flow!.description,
      interfaces: [],
      nodes: first.flow!.nodes,
      edges: first.flow!.edges,
      entryNode: first.flow!.entryNode,
    };
    const second = buildSubflowFlow(parsed.definitions[0], { baseFlow: saved, ...buildContext });
    expect(second.errors).toEqual([]);
    expect(second.unchanged).toBe(true);
  });

  it('applies an update when the definition changes the graph', () => {
    const parsed = parseSubflowDefinitions(graphWith([helperDefinition()]), NO_SAVED);
    const first = buildSubflowFlow(parsed.definitions[0], { baseFlow: null, ...buildContext });
    const saved: VisualFlow = {
      id: 'f1o2w3',
      name: first.flow!.name,
      interfaces: [],
      nodes: first.flow!.nodes,
      edges: first.flow!.edges,
      entryNode: first.flow!.entryNode,
    };
    const changed = helperDefinition({
      nodes: [
        { id: 'start', type: 'on_flow_start', outputs: [{ id: 'text', type: 'string' }, { id: 'lang', type: 'string' }] },
        { id: 'end', type: 'on_flow_end', inputs: [{ id: 'claims', type: 'string' }] },
      ],
    });
    const parsedChanged = parseSubflowDefinitions(graphWith([changed]), NO_SAVED);
    const second = buildSubflowFlow(parsedChanged.definitions[0], { baseFlow: saved, ...buildContext });
    expect(second.errors).toEqual([]);
    expect(second.unchanged).toBeUndefined();
    const startNode = second.flow?.nodes.find((node) => node.type === 'on_flow_start');
    expect(startNode?.data.outputs?.some((pin) => pin.id === 'lang')).toBe(true);
  });
});
