import { describe, expect, it } from 'vitest';
import { useFlowStore } from './useFlow';
import { listBundledFlows } from '../utils/bundledFlows';
import type { VisualFlow } from '../types/flow';

function toolbarSignature(flow: Partial<VisualFlow> | null | undefined): string {
  const value = flow || {};
  const normalizeNode = (node: any) => {
    if (!node || typeof node !== 'object') return node;
    return {
      id: node.id,
      type: node.type,
      position: node.position || null,
      data: node.data || null,
      parentNode: node.parentNode,
      parentId: node.parentId,
      extent: node.extent,
    };
  };
  const normalizeEdge = (edge: any) => {
    if (!edge || typeof edge !== 'object') return edge;
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: edge.type,
      data: edge.data || null,
      label: edge.label,
    };
  };
  return JSON.stringify({
    name: String(value.name || '').trim(),
    description: String(value.description || ''),
    interfaces: Array.isArray(value.interfaces) ? value.interfaces : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeNode) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(normalizeEdge) : [],
    entryNode: value.entryNode || null,
  });
}

describe('useFlowStore.loadFlow', () => {
  it('returns the canonical loaded flow so bundled workflows are clean after load', () => {
    const bundled = listBundledFlows().find((flow) => flow.id === 'deep-research');
    expect(bundled).toBeTruthy();

    const store = useFlowStore.getState();
    store.clearFlow();

    const loaded = store.loadFlow(bundled as VisualFlow);
    // Bundled workflow families are loaded read-only and run through their bundle target,
    // so Toolbar clears flowId after load. That must not create a dirty signature.
    useFlowStore.getState().setFlowId(null);

    const current = useFlowStore.getState().getFlow();
    expect(toolbarSignature(current)).toEqual(toolbarSignature(loaded));
  });
});

// ---------------------------------------------------------------------------
// Render-fold (0156 Stage 1) store contracts.
//
// The fold is a pure render projection, but it changes what the author can SEE
// and therefore what "delete this node" and "select this node" have to mean.
// These are the two places where a render-only feature is allowed to touch the
// document, plus the guard that stops the projection leaking back into it.
// ---------------------------------------------------------------------------

function foldFixture() {
  const pin = (id: string, type = 'any') => ({ id, label: id, type });
  const getter = (id: string, name: string) => ({
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
  });
  const consumer = (id: string) => ({
    id,
    type: 'custom',
    position: { x: 600, y: 0 },
    data: {
      nodeType: 'code',
      label: id,
      icon: '',
      headerColor: '',
      inputs: [pin('exec-in', 'execution'), pin('a'), pin('b')],
      outputs: [pin('exec-out', 'execution')],
    },
  });
  const nodes = [getter('g1', 'fix_cycles'), getter('g2', 'provider'), consumer('c1'), consumer('c2')];
  const edges = [
    // g1 folds onto c1.a (single consumer).
    { id: 'e1', source: 'g1', sourceHandle: 'value', target: 'c1', targetHandle: 'a' },
    // g2 is SHARED (c1 + c2) — drawn as a card, never folded.
    { id: 'e2', source: 'g2', sourceHandle: 'value', target: 'c1', targetHandle: 'b' },
    { id: 'e3', source: 'g2', sourceHandle: 'value', target: 'c2', targetHandle: 'a' },
  ];
  useFlowStore.getState().clearFlow();
  useFlowStore.setState({
    nodes: nodes as any,
    edges: edges as any,
    foldReads: true,
    execView: false,
    past: [],
    future: [],
    selectedNode: null,
    selectedEdge: null,
  });
}

const nodeIds = () => useFlowStore.getState().nodes.map((n) => n.id).sort();

describe('render-fold: deleting a consumer takes the reads drawn on it', () => {
  it('cascades the folded getter, leaves the shared one, and undo restores both', () => {
    foldFixture();
    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'c1' }]);

    // g1 was drawn as a pill ON c1 — it goes with the card. g2 is a visible
    // shared card with another consumer, so it stays put.
    expect(nodeIds()).toEqual(['c2', 'g2']);
    expect(useFlowStore.getState().edges.map((e) => e.id)).toEqual(['e3']);

    useFlowStore.getState().undo();
    expect(nodeIds()).toEqual(['c1', 'c2', 'g1', 'g2']);
    expect(useFlowStore.getState().edges.length).toBe(3);
  });

  it('cascades through the properties-panel delete action too', () => {
    foldFixture();
    useFlowStore.getState().deleteNode('c1');
    expect(nodeIds()).toEqual(['c2', 'g2']);
  });

  it('never cascades when the fold is OFF — the author is deleting what they can see', () => {
    foldFixture();
    useFlowStore.getState().setFoldReads(false);
    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'c1' }]);
    expect(nodeIds()).toEqual(['c2', 'g1', 'g2']);
  });

  it('never cascades in exec view, where no pill is drawn either', () => {
    foldFixture();
    useFlowStore.setState({ execView: true });
    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'c1' }]);
    expect(nodeIds()).toEqual(['c2', 'g1', 'g2']);
    useFlowStore.setState({ execView: false });
  });

  it('deleting the folded getter itself never touches its consumer', () => {
    foldFixture();
    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'g1' }]);
    expect(nodeIds()).toEqual(['c1', 'c2', 'g2']);
  });
});

describe('render-fold: selectNodeById is a real selection', () => {
  it('sets the React Flow selected flag, not just the panel pointer', () => {
    foldFixture();
    // The read pill uses this: React Flow routes Delete/Backspace by
    // `node.selected`, so a reveal that only moved `selectedNode` would give
    // the author a card they cannot delete and no selection ring.
    useFlowStore.getState().selectNodeById('g1');
    const state = useFlowStore.getState();
    expect(state.selectedNode?.id).toBe('g1');
    expect(state.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['g1']);

    useFlowStore.getState().selectNodeById('c1');
    expect(useFlowStore.getState().nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['c1']);

    useFlowStore.getState().selectNodeById(null);
    expect(useFlowStore.getState().nodes.some((n) => n.selected)).toBe(false);
    expect(useFlowStore.getState().selectedNode).toBeNull();
  });

  it('leaves untouched nodes referentially identical (no whole-canvas re-render)', () => {
    foldFixture();
    // Nodes start with `selected: undefined`. A strict `n.selected === false`
    // test would rewrite every node object on the first call, re-rendering the
    // whole canvas to flip one flag.
    const before = new Map(useFlowStore.getState().nodes.map((n) => [n.id, n]));
    useFlowStore.getState().selectNodeById('g1');
    for (const n of useFlowStore.getState().nodes) {
      if (n.id === 'g1') expect(n.selected).toBe(true);
      else expect(n).toBe(before.get(n.id));
    }
  });
});

describe('render-fold: the canvas projection never leaks into the document', () => {
  it('strips `hidden` from reset changes (useReactFlow().setEdges/setNodes round trip)', () => {
    foldFixture();
    const displayEdges = useFlowStore.getState().edges.map((e) => ({
      ...e,
      hidden: e.id === 'e1', // what the canvas hands React Flow for a folded read
      className: 'var-edge',
    }));
    // This is exactly the shape `useReactFlow().setEdges` emits: a `reset`
    // change per element, carrying the DISPLAYED object.
    useFlowStore
      .getState()
      .onEdgesChange(displayEdges.map((item) => ({ type: 'reset', item })) as any);
    expect(useFlowStore.getState().edges.some((e) => 'hidden' in e)).toBe(false);
    expect(useFlowStore.getState().edges.length).toBe(3);

    const displayNodes = useFlowStore.getState().nodes.map((n) => ({ ...n, hidden: n.id === 'g1' }));
    useFlowStore
      .getState()
      .onNodesChange(displayNodes.map((item) => ({ type: 'reset', item })) as any);
    expect(useFlowStore.getState().nodes.some((n) => 'hidden' in n)).toBe(false);
    expect(nodeIds()).toEqual(['c1', 'c2', 'g1', 'g2']);
  });
});
