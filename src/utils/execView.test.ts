import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { computeExecNodeIds, computeExecSubgraph, execNodeFamily, execPins, isExecEdge } from './execView';

function makeNode(id: string, type: FlowNodeData['nodeType']): Node<FlowNodeData> {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`missing template: ${type}`);
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: structuredClone(createNodeData(template)),
  };
}

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id, source, sourceHandle, target, targetHandle };
}

describe('execNodeFamily', () => {
  it('classifies event nodes including prefix-based and explicit types', () => {
    expect(execNodeFamily('on_flow_start')).toBe('event');
    expect(execNodeFamily('on_flow_end')).toBe('event');
    expect(execNodeFamily('wait_event')).toBe('event');
    expect(execNodeFamily('emit_event')).toBe('event');
    expect(execNodeFamily('delay')).toBe('event');
  });

  it('classifies control, interaction, generative, media, io, memory, subflow', () => {
    expect(execNodeFamily('sequence')).toBe('control');
    expect(execNodeFamily('if')).toBe('control');
    expect(execNodeFamily('ask_user')).toBe('interaction');
    expect(execNodeFamily('llm_call')).toBe('generative');
    expect(execNodeFamily('agent')).toBe('generative');
    expect(execNodeFamily('generate_image')).toBe('media');
    expect(execNodeFamily('write_pdf')).toBe('io');
    expect(execNodeFamily('tool_calls')).toBe('io');
    expect(execNodeFamily('memory_note')).toBe('memory');
    expect(execNodeFamily('subflow')).toBe('subflow');
  });

  it('falls back to logic for pure/unknown types', () => {
    expect(execNodeFamily('concat')).toBe('logic');
    expect(execNodeFamily('set_var')).toBe('logic');
    expect(execNodeFamily('')).toBe('logic');
    expect(execNodeFamily('some_future_type')).toBe('logic');
  });
});

describe('isExecEdge / computeExecNodeIds', () => {
  it('keeps only nodes linked by execution edges', () => {
    const start = makeNode('start', 'on_flow_start');
    const llm = makeNode('llm', 'llm_call');
    const end = makeNode('end', 'on_flow_end');
    const literal = makeNode('lit', 'literal_string');
    const concat = makeNode('cc', 'concat');
    const nodes = [start, llm, end, literal, concat];
    const edges = [
      edge('e1', 'start', 'exec-out', 'llm', 'exec-in'),
      edge('e2', 'llm', 'exec-out', 'end', 'exec-in'),
      // Data-only wiring must not pull nodes into the exec view.
      edge('e3', 'lit', 'value', 'cc', 'a'),
      edge('e4', 'cc', 'result', 'llm', 'prompt'),
    ];

    const ids = computeExecNodeIds(nodes, edges);
    expect(ids).toEqual(new Set(['start', 'llm', 'end']));

    const subgraph = computeExecSubgraph(nodes, edges);
    expect(subgraph.nodeIds).toEqual(ids);
    expect(subgraph.edgeIds).toEqual(new Set(['e1', 'e2']));
  });

  it('detects exec edges via pin types and via exec-in/exec-out id fallback', () => {
    const seq = makeNode('seq', 'sequence');
    const llm = makeNode('llm', 'llm_call');
    const byId = new Map([
      ['seq', seq],
      ['llm', llm],
    ]);

    // sequence "then:0" output is an execution pin by type.
    expect(isExecEdge(byId, edge('a', 'seq', 'then:0', 'llm', 'exec-in'))).toBe(true);
    // Unknown node data: falls back to the exec handle id convention.
    expect(isExecEdge(new Map(), edge('b', 'ghost', 'exec-out', 'ghost2', 'exec-in'))).toBe(true);
    // Data pins are not exec edges.
    expect(isExecEdge(byId, edge('c', 'llm', 'response', 'seq', 'value'))).toBe(false);
  });

  it('exposes execution pins per direction, preserving order', () => {
    const seq = makeNode('seq', 'sequence');
    const pins = execPins(seq.data);
    expect(pins.inputs.map((p) => p.id)).toEqual(['exec-in']);
    expect(pins.outputs.map((p) => p.id)).toEqual(['then:0', 'then:1']);

    const ifNode = makeNode('br', 'if');
    expect(execPins(ifNode.data).outputs.map((p) => p.id)).toEqual(['true', 'false']);
  });
});
