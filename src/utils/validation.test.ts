import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { areTypesCompatible, getConnectionError, validateConnection } from './validation';

describe('pin type compatibility', () => {
  it('treats json_schema as an object-compatible nominal type', () => {
    expect(areTypesCompatible('json_schema', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'object')).toBe(true);
    expect(areTypesCompatible('object', 'json_schema')).toBe(true);
    expect(areTypesCompatible('json_schema', 'string')).toBe(false);
  });

  it('lets the dynamic any type feed nominal provider/model pins (loop.item -> llm_call.model)', () => {
    expect(areTypesCompatible('any', 'model')).toBe(true);
    expect(areTypesCompatible('any', 'model_text')).toBe(true);
    expect(areTypesCompatible('any', 'provider')).toBe(true);
    expect(areTypesCompatible('model', 'any')).toBe(true);
  });

  it('keeps nominal guards for non-any payload types', () => {
    expect(areTypesCompatible('string', 'model')).toBe(false);
    expect(areTypesCompatible('model', 'string')).toBe(false);
    expect(areTypesCompatible('execution', 'any')).toBe(false);
    expect(areTypesCompatible('any', 'execution')).toBe(false);
  });
});

describe('expression-adapter connections', () => {
  const mkNode = (
    id: string,
    data: Partial<FlowNodeData>
  ): Node<FlowNodeData> => ({
    id,
    type: 'base',
    position: { x: 0, y: 0 },
    data: { nodeType: 'code', label: id, inputs: [], outputs: [], ...data } as FlowNodeData,
  });

  const producer = mkNode('planner', {
    outputs: [{ id: 'data', label: 'data', type: 'object' }],
  });

  it('a target pin carrying an expression accepts a wire of ANY data type (the expression is the adapter)', () => {
    // The canonical fx pattern: planner.data(object) -> gate1.prompt(string)
    // with `gate1_prompt(value)` on the pin. The load-time filter used to
    // drop this edge, block Run with false positives, and persist the loss
    // on save (wave-B live verifier P1-A).
    const consumer = mkNode('gate1', {
      inputs: [{ id: 'prompt', label: 'prompt', type: 'string' }],
      pinExpressions: { prompt: 'gate1_prompt(value)' },
    });
    const edges: Edge[] = [];
    expect(
      validateConnection([producer, consumer], edges, {
        source: 'planner',
        sourceHandle: 'data',
        target: 'gate1',
        targetHandle: 'prompt',
      })
    ).toBe(true);
  });

  it('without an expression the same wire stays refused; exec pins are never expression-adapted', () => {
    const bare = mkNode('gate1', {
      inputs: [
        { id: 'prompt', label: 'prompt', type: 'string' },
        { id: 'exec-in', label: '', type: 'execution' },
      ],
      pinExpressions: { 'exec-in': 'never legal' },
    });
    expect(
      validateConnection([producer, bare], [], {
        source: 'planner',
        sourceHandle: 'data',
        target: 'gate1',
        targetHandle: 'prompt',
      })
    ).toBe(false);
    expect(
      validateConnection([producer, bare], [], {
        source: 'planner',
        sourceHandle: 'data',
        target: 'gate1',
        targetHandle: 'exec-in',
      })
    ).toBe(false);
  });
});

describe('getConnectionError names a folded read (0156)', () => {
  const pin = (id: string, type = 'any') => ({ id, label: id, type });
  const getter = (id: string, name: string): Node<FlowNodeData> =>
    ({
      id,
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'get_var',
        label: `Get ${name}`,
        icon: '',
        headerColor: '',
        inputs: [pin('name', 'string'), pin('default')],
        outputs: [pin('value')],
        pinDefaults: { name },
      },
    }) as unknown as Node<FlowNodeData>;
  const consumer = (id: string): Node<FlowNodeData> =>
    ({
      id,
      type: 'custom',
      position: { x: 600, y: 0 },
      data: {
        nodeType: 'code',
        label: id,
        icon: '',
        headerColor: '',
        inputs: [pin('exec-in', 'execution'), pin('a')],
        outputs: [pin('exec-out', 'execution')],
      },
    }) as unknown as Node<FlowNodeData>;
  const feed = (source: string): Edge =>
    ({ id: `e-${source}`, source, sourceHandle: 'value', target: 'c1', targetHandle: 'a' }) as Edge;
  const secondWire = { source: 'src', sourceHandle: 'out', target: 'c1', targetHandle: 'a' };
  const producer: Node<FlowNodeData> = {
    id: 'src',
    type: 'custom',
    position: { x: 0, y: 300 },
    data: {
      nodeType: 'code',
      label: 'src',
      icon: '',
      headerColor: '',
      inputs: [],
      outputs: [pin('out')],
    },
  } as unknown as Node<FlowNodeData>;

  it('points at the read pill, not at an invisible node id, when the feed is folded', () => {
    const nodes = [getter('g1', 'fix_cycles'), consumer('c1'), producer];
    const error = getConnectionError(nodes, [feed('g1')], secondWire);
    // The author sees no wire on that pin — only a teal pill. Naming the
    // variable and the pill is the only way the refusal makes sense.
    expect(error).toContain("read pill on this pin row");
    expect(error).toContain("'fix_cycles'");
    // The node id stays in the message so the authoring assistant can act.
    expect(error).toContain('g1');
  });

  it('falls back to the wire spelling when the getter is drawn (shared read)', () => {
    const nodes = [getter('g1', 'fix_cycles'), consumer('c1'), consumer('c2'), producer];
    const edges = [
      feed('g1'),
      { id: 'e-shared', source: 'g1', sourceHandle: 'value', target: 'c2', targetHandle: 'a' } as Edge,
    ];
    const error = getConnectionError(nodes, edges, secondWire);
    expect(error).toContain('from g1.value');
    expect(error).toContain("reads variable 'fix_cycles'");
    expect(error).not.toContain('read pill');
  });

  it('keeps the plain message for a non-getter source', () => {
    const other: Node<FlowNodeData> = { ...producer, id: 'other' } as Node<FlowNodeData>;
    const nodes = [other, consumer('c1'), producer];
    const error = getConnectionError(nodes, [feed('other')], secondWire);
    expect(error).toBe("Input pin 'a' already connected (from other.value)");
  });
});
