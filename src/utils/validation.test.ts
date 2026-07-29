import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { areTypesCompatible, validateConnection } from './validation';

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
