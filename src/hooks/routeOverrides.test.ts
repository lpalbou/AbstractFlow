// Operator 2026-10-11: a Reviewer sends a ForEach back to work with NEW tasks
// ("i absolutely NEED visually, to be able to link my array to for each").
// ForEach has two entries (Planner, If/Else false) and its `items` already has
// the Planner's wire; the reviewer's tasks come from a Break Object two nodes
// before the If/Else. Dropping that wire asks which entry it feeds and draws a
// per-path wire; the Properties panel edits the same wires.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'reactflow';
import type { VisualFlow } from '../types/flow';
import { useFlowStore } from './useFlow';
import { routeChoicesForConnection, validateConnection } from '../utils/validation';
import { buildConnectionPreviewForNode } from '../utils/connectionPreview';
import { RouteChoiceMenu } from '../components/RouteChoiceMenu';

const X = { id: 'exec-in', label: '', type: 'execution' as const };
const O = { id: 'exec-out', label: '', type: 'execution' as const };

function reviewLoop(withStoredOverride = false): VisualFlow {
  const node = (id: string, nodeType: string, label: string, inputs: unknown[], outputs: unknown[], extra = {}) => ({
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: { nodeType, label, inputs, outputs, ...extra },
  });
  return {
    id: 'review-loop',
    name: 'review loop',
    nodes: [
      node('start', 'on_flow_start', 'On Flow Start', [], [O]),
      node('planner', 'llm_call', 'Planner', [X], [O, { id: 'data', label: 'data', type: 'object' }]),
      node('plan', 'break_object', 'Break Object', [{ id: 'object', label: 'object', type: 'object' }], [{ id: 'tasks', label: 'tasks', type: 'array' }]),
      node('fe', 'loop', 'ForEach', [X, { id: 'items', label: 'items', type: 'array' }], [
        { id: 'loop', label: 'loop', type: 'execution' },
        { id: 'done', label: 'done', type: 'execution' },
        { id: 'item', label: 'item', type: 'any' },
      ]),
      node('reviewer', 'llm_call', 'Reviewer', [X], [O, { id: 'data', label: 'data', type: 'object' }]),
      node('review', 'break_object', 'Break Object', [{ id: 'object', label: 'object', type: 'object' }], [
        { id: 'success', label: 'success', type: 'boolean' },
        { id: 'tasks', label: 'tasks', type: 'array' },
      ]),
      node('if', 'if', 'If/Else', [X, { id: 'condition', label: 'condition', type: 'boolean' }], [
        { id: 'true', label: 'true', type: 'execution' },
        { id: 'false', label: 'false', type: 'execution' },
      ]),
    ].map((n) =>
      n.id === 'fe' && withStoredOverride
        ? { ...n, data: { ...n.data, inputRouteOverrides: { items: { 'if::false': { sourceNodeId: 'review', sourceHandle: 'tasks' } } } } }
        : n
    ),
    edges: [
      { id: 'e1', source: 'start', sourceHandle: 'exec-out', target: 'planner', targetHandle: 'exec-in' },
      { id: 'e2', source: 'planner', sourceHandle: 'exec-out', target: 'fe', targetHandle: 'exec-in' },
      { id: 'e3', source: 'planner', sourceHandle: 'data', target: 'plan', targetHandle: 'object' },
      { id: 'e4', source: 'plan', sourceHandle: 'tasks', target: 'fe', targetHandle: 'items' },
      { id: 'e5', source: 'fe', sourceHandle: 'done', target: 'reviewer', targetHandle: 'exec-in' },
      { id: 'e6', source: 'reviewer', sourceHandle: 'exec-out', target: 'if', targetHandle: 'exec-in' },
      { id: 'e7', source: 'reviewer', sourceHandle: 'data', target: 'review', targetHandle: 'object' },
      { id: 'e8', source: 'review', sourceHandle: 'success', target: 'if', targetHandle: 'condition' },
      { id: 'e9', source: 'if', sourceHandle: 'false', target: 'fe', targetHandle: 'exec-in' },
    ],
  } as unknown as VisualFlow;
}

const reviewerTasks: Connection = { source: 'review', sourceHandle: 'tasks', target: 'fe', targetHandle: 'items' };
const overridesOf = (flow: VisualFlow) => (flow.nodes.find((n) => n.id === 'fe')!.data as any).inputRouteOverrides;

describe('per-path wires on a multi-entry node', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());
  afterEach(() => vi.unstubAllGlobals());

  it('a wire from a node that is not right before the entry asks which entry it feeds', () => {
    useFlowStore.getState().loadFlow(reviewLoop());
    const { nodes, edges } = useFlowStore.getState();
    expect(validateConnection(nodes, edges, reviewerTasks)).toBe(false);
    expect(routeChoicesForConnection(nodes, edges, reviewerTasks).map((c) => [c.key, c.label])).toEqual([
      ['if::false', 'If/Else / false'],
      ['planner::exec-out', 'Planner'],
    ]);
    // While dragging, the pin shows as a valid target, not a refusal.
    const fe = nodes.find((n) => n.id === 'fe')!;
    const preview = buildConnectionPreviewForNode(nodes, edges, { nodeId: 'review', handleId: 'tasks', handleType: 'source', pinType: 'array' }, fe);
    expect(preview.inputs?.items?.status).toBe('valid');
  });

  it('nothing to ask on a free pin, a single-entry node, a type mismatch, or a known entry', () => {
    useFlowStore.getState().loadFlow(reviewLoop());
    const { nodes, edges } = useFlowStore.getState();
    const freePin = edges.filter((e) => e.id !== 'e4');
    expect(routeChoicesForConnection(nodes, freePin, reviewerTasks)).toEqual([]);
    const singleEntry = edges.filter((e) => e.id !== 'e9');
    expect(routeChoicesForConnection(nodes, singleEntry, reviewerTasks)).toEqual([]);
    expect(routeChoicesForConnection(nodes, edges, { ...reviewerTasks, sourceHandle: 'success' })).toEqual([]);
    // Planner runs right before the Planner entry: that entry is known, no question.
    const fromPlanner: Connection = { source: 'planner', sourceHandle: 'data', target: 'fe', targetHandle: 'items' };
    expect(routeChoicesForConnection(nodes, edges, fromPlanner)).toEqual([]);
  });

  it('choosing an entry draws a per-path wire and saves it as that entry\'s value', () => {
    useFlowStore.getState().loadFlow(reviewLoop());
    useFlowStore.getState().setRouteOverride('fe', 'items', 'if::false', { nodeId: 'review', handle: 'tasks' });
    const drawn = useFlowStore.getState().edges.filter((e) => (e.data as any)?.routeOverride);
    expect(drawn.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle, (e.data as any).routeKey])).toEqual([
      ['review', 'tasks', 'fe', 'items', 'if::false'],
    ]);
    const saved = useFlowStore.getState().getFlow();
    expect(overridesOf(saved)).toEqual({ items: { 'if::false': { sourceNodeId: 'review', sourceHandle: 'tasks' } } });
    // The per-path wire is not saved as a second normal edge into `items`.
    expect(saved.edges.filter((e) => e.target === 'fe' && e.targetHandle === 'items').map((e) => e.source)).toEqual(['plan']);
  });

  it('a second choice for the same entry replaces the first; clearing it removes it', () => {
    useFlowStore.getState().loadFlow(reviewLoop());
    const store = useFlowStore.getState();
    store.setRouteOverride('fe', 'items', 'if::false', { nodeId: 'review', handle: 'tasks' });
    store.setRouteOverride('fe', 'items', 'if::false', { nodeId: 'plan', handle: 'tasks' });
    expect(useFlowStore.getState().edges.filter((e) => (e.data as any)?.routeOverride).map((e) => e.source)).toEqual(['plan']);
    store.setRouteOverride('fe', 'items', 'if::false', null);
    expect(useFlowStore.getState().edges.some((e) => (e.data as any)?.routeOverride)).toBe(false);
    expect(overridesOf(useFlowStore.getState().getFlow())).toBeUndefined();
  });

  it('a stored value loads as a drawn wire, and clearing that wire really removes it', () => {
    useFlowStore.getState().loadFlow(reviewLoop(true));
    const { nodes, edges } = useFlowStore.getState();
    expect(edges.filter((e) => (e.data as any)?.routeOverride).map((e) => e.source)).toEqual(['review']);
    // The wire is the only copy: the node no longer carries a hidden one that
    // would come back on save after the wire is deleted.
    expect((nodes.find((n) => n.id === 'fe')!.data as any).inputRouteOverrides).toBeUndefined();
    expect(overridesOf(useFlowStore.getState().getFlow())).toEqual({
      items: { 'if::false': { sourceNodeId: 'review', sourceHandle: 'tasks' } },
    });
    useFlowStore.getState().setRouteOverride('fe', 'items', 'if::false', null);
    expect(overridesOf(useFlowStore.getState().getFlow())).toBeUndefined();
  });

  it('the menu names the input, the value and each entry, and what a choice replaces', () => {
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
    const html = renderToStaticMarkup(
      createElement(RouteChoiceMenu, {
        nodeLabel: 'ForEach',
        pinLabel: 'items',
        sourceLabel: 'Break Object · tasks',
        choices: [
          { key: 'if::false', sourceNodeId: 'if', sourceHandle: 'false', label: 'If/Else / false' },
          { key: 'planner::exec-out', sourceNodeId: 'planner', sourceHandle: 'exec-out', label: 'Planner' },
        ],
        currentByRoute: { 'if::false': 'Break Object · success' },
        anchor: { x: 400, y: 300 },
        onChoose: () => {},
        onCancel: () => {},
      })
    );
    expect(html).toContain('ForEach · items');
    expect(html).toContain('Break Object · tasks');
    expect(html).toContain('If/Else / false');
    expect(html).toContain('Planner');
    expect(html).toContain('replaces Break Object · success');
  });
});
