// Operator 2026-10-11: a relay dot lets one output feed several inputs; visual
// only (the runtime rewires source -> inputs, abstractruntime reroute_lowering.py).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, VisualFlow } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import { useFlowStore } from '../hooks/useFlow';
import { dropChoicesFor, withRelayTypes } from './relays';

const node = (id: string, type: string, patch: Partial<FlowNodeData> = {}): Node<FlowNodeData> => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { ...createNodeData(getNodeTemplate(type as any)!), ...patch },
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const relayTypes = (nodes: Node<FlowNodeData>[]) =>
  Object.fromEntries(nodes.filter((n) => n.data.nodeType === 'reroute').map((n) => [n.id, [n.data.inputs[0].type, n.data.outputs[0].type]]));

describe('relays', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('carry the type of the output that feeds them, through chained relays; unfed relays are any', () => {
    const nodes = [node('text', 'literal_string'), node('r1', 'reroute'), node('r2', 'reroute'), node('r3', 'reroute')];
    const edges = [wire('text', 'value', 'r1', 'in'), wire('r1', 'out', 'r2', 'in')];
    expect(relayTypes(withRelayTypes(nodes, edges))).toEqual({ r1: ['string', 'string'], r2: ['string', 'string'], r3: ['any', 'any'] });
    // Nothing to change: the same array comes back.
    const typed = withRelayTypes(nodes, edges);
    expect(withRelayTypes(typed, edges)).toBe(typed);
  });

  it('the drop menu offers a relay for data pins, Break Object from objects, nothing for execution pins', () => {
    expect(dropChoicesFor('object', 'source')).toEqual(['relay', 'break_object']);
    expect(dropChoicesFor('any', 'source')).toEqual(['relay', 'break_object']);
    expect(dropChoicesFor('string', 'source')).toEqual(['relay']);
    expect(dropChoicesFor('object', 'target')).toEqual(['relay']);
    expect(dropChoicesFor('execution', 'source')).toEqual([]);
  });

  it('a node created from a dropped wire arrives wired, in one undo step; a refused wire creates nothing', () => {
    const store = useFlowStore.getState();
    store.loadFlow({
      id: 'f',
      name: 'f',
      nodes: [{ id: 'node-1', type: 'llm_call', position: { x: 0, y: 0 }, data: createNodeData(getNodeTemplate('llm_call')!) }],
      edges: [],
    } as unknown as VisualFlow);
    const id = useFlowStore.getState().addNodeAndConnect(getNodeTemplate('break_object')!, { x: 300, y: 0 }, {
      from: { nodeId: 'node-1', handleId: 'data', side: 'source' },
      newPin: 'object',
    });
    const s = useFlowStore.getState();
    expect(s.nodes.find((n) => n.id === id)?.data.nodeType).toBe('break_object');
    expect(s.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle])).toEqual([['node-1', 'data', id, 'object']]);
    s.undo();
    expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['node-1']);
    expect(useFlowStore.getState().edges).toEqual([]);
    // An execution output cannot feed Break Object's data input.
    expect(
      useFlowStore.getState().addNodeAndConnect(getNodeTemplate('break_object')!, { x: 0, y: 0 }, {
        from: { nodeId: 'node-1', handleId: 'exec-out', side: 'source' },
        newPin: 'object',
      })
    ).toBeNull();
    expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['node-1']);
  });

  it('the store retypes a relay when its feeding wire is connected or removed, and saves relays as nodes', () => {
    const store = useFlowStore.getState();
    store.loadFlow({
      id: 'f',
      name: 'f',
      nodes: [
        { id: 'node-1', type: 'literal_string', position: { x: 0, y: 0 }, data: { ...createNodeData(getNodeTemplate('literal_string')!), literalValue: 'hi' } },
        { id: 'node-2', type: 'reroute', position: { x: 200, y: 0 }, data: createNodeData(getNodeTemplate('reroute')!) },
      ],
      edges: [],
    } as unknown as VisualFlow);
    useFlowStore.getState().onConnect({ source: 'node-1', sourceHandle: 'value', target: 'node-2', targetHandle: 'in' });
    expect(relayTypes(useFlowStore.getState().nodes)).toEqual({ 'node-2': ['string', 'string'] });
    const saved = useFlowStore.getState().getFlow();
    expect(saved.nodes.find((n) => n.id === 'node-2')?.type).toBe('reroute');
    expect(saved.edges.map((e) => [e.source, e.target])).toEqual([['node-1', 'node-2']]);
    const edgeId = useFlowStore.getState().edges[0].id;
    useFlowStore.getState().onEdgesChange([{ type: 'remove', id: edgeId }]);
    expect(relayTypes(useFlowStore.getState().nodes)).toEqual({ 'node-2': ['any', 'any'] });
  });
});
