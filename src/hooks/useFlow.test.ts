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

// Declaring an interface on the flow being edited must give its On Flow Start
// / On Flow End nodes the pins the interface requires (operator: "it is
// critical that it does so, so that a user knows what to fill").
function interfaceFixture(interfaces: string[] = []): VisualFlow {
  return {
    id: 'iface-flow',
    name: 'Iface flow',
    interfaces,
    nodes: [
      {
        id: 'start',
        type: 'on_flow_start',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'On Flow Start',
          icon: '',
          headerColor: '',
          inputs: [],
          outputs: [
            { id: 'exec-out', label: '', type: 'execution' },
            { id: 'prompt', label: 'Question', type: 'string' },
          ],
        },
      },
      {
        id: 'end',
        type: 'on_flow_end',
        position: { x: 400, y: 0 },
        data: {
          nodeType: 'on_flow_end',
          label: 'On Flow End',
          icon: '',
          headerColor: '',
          inputs: [{ id: 'exec-in', label: '', type: 'execution' }],
          outputs: [],
        },
      },
    ],
    edges: [{ id: 'x1', source: 'start', sourceHandle: 'exec-out', target: 'end', targetHandle: 'exec-in' }],
  } as VisualFlow;
}

function pinIds(nodeId: string, side: 'inputs' | 'outputs'): string[] {
  const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
  return (node?.data[side] || []).map((p) => p.id);
}

describe('setFlowInterfaces: declaring an interface adds its pins', () => {
  it('adds the missing typed pins to On Flow Start and On Flow End, keeping the authored ones', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']);

    const s = useFlowStore.getState();
    expect(s.flowInterfaces).toEqual(['abstractcode.agent.v1']);
    expect(pinIds('start', 'outputs')).toEqual(['exec-out', 'prompt', 'provider', 'model']);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in', 'response', 'success', 'meta']);
    const start = s.nodes.find((n) => n.id === 'start');
    // The authored pin keeps its label; the added ones carry the contract types.
    expect(start?.data.outputs.find((p) => p.id === 'prompt')?.label).toBe('Question');
    expect(start?.data.outputs.find((p) => p.id === 'provider')?.type).toBe('provider_text');
    expect(s.nodes.find((n) => n.id === 'end')?.data.inputs.find((p) => p.id === 'success')?.type).toBe('boolean');
    // What Save sends carries both the interfaces and the pins.
    const saved = s.getFlow();
    expect(saved.interfaces).toEqual(['abstractcode.agent.v1']);
    expect(saved.nodes.find((n) => n.id === 'end')?.data.inputs.map((p) => p.id)).toContain('meta');
  });

  it('is ONE undo step: undo removes the interface and the pins together; redo brings both back', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']);
    expect(useFlowStore.getState().past).toHaveLength(1);

    useFlowStore.getState().undo();
    expect(useFlowStore.getState().flowInterfaces).toEqual([]);
    expect(pinIds('start', 'outputs')).toEqual(['exec-out', 'prompt']);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in']);

    useFlowStore.getState().redo();
    expect(useFlowStore.getState().flowInterfaces).toEqual(['abstractcode.agent.v1']);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in', 'response', 'success', 'meta']);
  });

  it('keeps unsaved edits and earlier undo history (no reload)', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    useFlowStore.getState().updateNodeData('start', { label: 'Edited, not saved' });
    useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']);
    const s = useFlowStore.getState();
    expect(s.nodes.find((n) => n.id === 'start')?.data.label).toBe('Edited, not saved');
    expect(s.past).toHaveLength(2);
  });

  it('removing an interface keeps the pins; re-declaring the same set is a no-op (no history entry)', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']);
    const nodesAfter = useFlowStore.getState().nodes;
    useFlowStore.getState().setFlowInterfaces([' abstractcode.agent.v1 ', '']);
    expect(useFlowStore.getState().past).toHaveLength(1);
    expect(useFlowStore.getState().nodes).toBe(nodesAfter);

    useFlowStore.getState().setFlowInterfaces([]);
    expect(useFlowStore.getState().flowInterfaces).toEqual([]);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in', 'response', 'success', 'meta']);
  });

  it('refreshes the selected node so the Properties panel shows the new pins', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    useFlowStore.getState().selectNodeById('end');
    useFlowStore.getState().setFlowInterfaces(['abstractcode.agent.v1']);
    expect(useFlowStore.getState().selectedNode?.data.inputs.map((p) => p.id)).toEqual([
      'exec-in',
      'response',
      'success',
      'meta',
    ]);
  });

  it('open-flow interface update (Toolbar sequence): pins added => unsaved; nothing to add => still clean', () => {
    // Mirrors Toolbar.handleUpdateInterfaces for the OPEN flow after the PUT:
    // a clean editor re-baselines to what the gateway now holds (the document
    // with the new interfaces), then the store adds the pins.
    const applyAsToolbar = (interfaces: string[], baseline: string) => {
      const current = toolbarSignature(useFlowStore.getState().getFlow());
      const next = current === baseline
        ? toolbarSignature({ ...useFlowStore.getState().getFlow(), interfaces })
        : baseline;
      useFlowStore.getState().setFlowInterfaces(interfaces);
      return next;
    };

    const store = useFlowStore.getState();
    store.clearFlow();
    let baseline = toolbarSignature(store.loadFlow(interfaceFixture()));
    baseline = applyAsToolbar(['abstractcode.agent.v1'], baseline);
    expect(toolbarSignature(useFlowStore.getState().getFlow())).not.toEqual(baseline);

    // Save sends interfaces + pins; reopening the saved document keeps every
    // pin, adds none, and is clean against the Toolbar's load baseline.
    const sent = useFlowStore.getState().getFlow();
    const reopened = useFlowStore.getState().loadFlow(sent);
    expect(toolbarSignature(useFlowStore.getState().getFlow())).toEqual(toolbarSignature(reopened));
    expect(pinIds('start', 'outputs').sort()).toEqual(['exec-out', 'model', 'prompt', 'provider']);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in', 'response', 'success', 'meta']);

    // A domain marker requires no pin: the gateway copy equals the editor copy.
    baseline = toolbarSignature(reopened);
    baseline = applyAsToolbar(['abstractcode.agent.v1', 'abstractresearch.deep.v1'], baseline);
    expect(toolbarSignature(useFlowStore.getState().getFlow())).toEqual(baseline);
  });
});

describe('loadFlow: a saved flow that declares an interface opens with its pins', () => {
  it('adds the missing pins of a legacy flow and bakes them into the loaded document (no dirty loop)', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    const loaded = store.loadFlow(interfaceFixture(['abstractcode.agent.v1']));
    expect(pinIds('start', 'outputs')).toEqual(expect.arrayContaining(['prompt', 'provider', 'model']));
    expect(pinIds('end', 'inputs')).toEqual(['exec-in', 'response', 'success', 'meta']);
    expect(useFlowStore.getState().past).toEqual([]);

    // The Toolbar baselines on the returned document: it already carries the
    // pins, so the editor is clean after open ...
    expect(toolbarSignature(useFlowStore.getState().getFlow())).toEqual(toolbarSignature(loaded));
    // ... and the next Save persists them: re-opening that document changes nothing.
    const reloaded = useFlowStore.getState().loadFlow(loaded);
    expect(toolbarSignature(reloaded)).toEqual(toolbarSignature(loaded));
  });

  it('leaves flows without interfaces untouched', () => {
    const store = useFlowStore.getState();
    store.clearFlow();
    store.loadFlow(interfaceFixture());
    expect(pinIds('start', 'outputs')).toEqual(['exec-out', 'prompt']);
    expect(pinIds('end', 'inputs')).toEqual(['exec-in']);
  });
});
