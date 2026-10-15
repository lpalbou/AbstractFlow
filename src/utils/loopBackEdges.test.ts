import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { loopBackWires, wireLoopLimit } from './loopBackEdges';

const X = { id: 'exec-in', label: '', type: 'execution' as const };
const O = { id: 'exec-out', label: '', type: 'execution' as const };
const node = (id: string, nodeType: string, outputs: any[] = [O], inputs: any[] = [X]): Node<FlowNodeData> =>
  ({ id, type: 'custom', position: { x: 0, y: 0 }, data: { nodeType, label: id, inputs, outputs } }) as any;
const wire = (id: string, source: string, sourceHandle: string, target: string, targetHandle = 'exec-in'): Edge => ({ id, source, sourceHandle, target, targetHandle });
const loopNode = (id: string) =>
  node(id, 'loop', [{ id: 'loop', label: 'loop', type: 'execution' }, { id: 'done', label: 'done', type: 'execution' }, { id: 'item', label: 'item', type: 'any' }], [X, { id: 'items', label: 'items', type: 'array' }]);
const ifNode = (id: string) =>
  node(id, 'if', [{ id: 'true', label: 'true', type: 'execution' }, { id: 'false', label: 'false', type: 'execution' }], [X, { id: 'condition', label: 'condition', type: 'boolean' }]);
const limitNode = (id: string) =>
  node(id, 'loop_limit', [{ id: 'again', label: 'again', type: 'execution' }, { id: 'limit_reached', label: 'limit reached', type: 'execution' }, { id: 'count', label: 'count', type: 'number' }], [X, { id: 'max', label: 'max', type: 'number' }]);

const start = node('start', 'on_flow_start', [O, { id: 'prompt', label: 'prompt', type: 'string' }], []);
const nodes = [start, node('planner', 'llm_call'), loopNode('loop'), node('body', 'agent'), node('reviewer', 'agent'), ifNode('if'), node('report', 'llm_call'), limitNode('limit')];
const review = [
  wire('e1', 'start', 'exec-out', 'planner'),
  wire('e2', 'planner', 'exec-out', 'loop'),
  wire('e3', 'loop', 'loop', 'body'),
  wire('e5', 'reviewer', 'exec-out', 'if'),
  wire('e6', 'if', 'true', 'report'),
  wire('e7', 'if', 'false', 'loop'),
  { id: 'd1', source: 'start', sourceHandle: 'prompt', target: 'loop', targetHandle: 'items' }, // a data wire: never a loop-back
];

describe('loop-back wires', () => {
  it('finds the wire from If/Else back to the ForEach, unlimited, and only that one', () => {
    const edges = [...review, wire('e4', 'loop', 'done', 'reviewer')];
    expect([...loopBackWires(nodes, edges)]).toEqual([['e7', { wireLimit: null, limited: false, leavesLoopBody: false, leavesLoop: null }]]);
  });

  it('a Loop Limit anywhere on the loop counts (the assist flow: done → ↺ → Reviewer)', () => {
    const edges = [...review, wire('e4', 'loop', 'done', 'limit'), wire('e8', 'limit', 'again', 'reviewer')];
    expect(loopBackWires(nodes, edges).get('e7')).toEqual({ wireLimit: null, limited: true, leavesLoopBody: false, leavesLoop: null });
  });

  it('a second way round that skips the Loop Limit leaves the loop unlimited', () => {
    // The body also reaches the Reviewer directly: that way round has no limit.
    const edges = [...review, wire('e4', 'loop', 'done', 'limit'), wire('e8', 'limit', 'again', 'reviewer'), wire('e9', 'body', 'exec-out', 'reviewer')];
    expect(loopBackWires(nodes, edges).get('e7')?.limited).toBe(false);
  });

  it('the same loop is found whatever the order the wires were drawn in', () => {
    const edges = [...review, wire('e4', 'loop', 'done', 'reviewer')];
    expect([...loopBackWires(nodes, [...edges].reverse()).keys()]).toEqual(['e7']);
  });

  it('a wire that jumps out of a loop body is marked: the runtime cannot repeat it', () => {
    const outer = loopNode('outer');
    const ns = [start, outer, loopNode('inner'), node('step', 'agent'), ifNode('if')];
    const edges = [
      wire('e1', 'start', 'exec-out', 'outer'),
      wire('e2', 'outer', 'loop', 'inner'),
      wire('e3', 'inner', 'loop', 'step'),
      wire('e4', 'step', 'exec-out', 'if'),
      wire('e5', 'if', 'false', 'outer'),
    ];
    expect(loopBackWires(ns, edges).get('e5')).toEqual({ wireLimit: null, limited: false, leavesLoopBody: true, leavesLoop: 'outer' });
    // Back to a step inside the same body: fine.
    const inside = [wire('e1', 'start', 'exec-out', 'outer'), wire('e2', 'outer', 'loop', 'step'), wire('e4', 'step', 'exec-out', 'if'), wire('e5', 'if', 'false', 'step')];
    expect(loopBackWires(ns, inside).get('e5')).toEqual({ wireLimit: null, limited: false, leavesLoopBody: false, leavesLoop: null });
  });

  it('leavesLoop names the loop whose body the wire leaves: the first on the way round from the target, left through its loop pin', () => {
    const outer = loopNode('outer');
    const middle = loopNode('middle');
    const ns = [start, outer, middle, loopNode('inner'), node('step', 'agent'), ifNode('if'), node('after', 'agent')];
    // outer.loop → middle.loop → inner.loop → step → if; if.false → middle: re-enters middle from inside its own body.
    const edges = [
      wire('e1', 'start', 'exec-out', 'outer'),
      wire('e2', 'outer', 'loop', 'middle'),
      wire('e3', 'middle', 'loop', 'inner'),
      wire('e4', 'inner', 'loop', 'step'),
      wire('e5', 'step', 'exec-out', 'if'),
      wire('e6', 'if', 'false', 'middle'),
    ];
    expect(loopBackWires(ns, edges).get('e6')?.leavesLoop).toBe('middle');
    // Back to the outermost loop: the loop named is the one re-entered, the first on the way round.
    expect(loopBackWires(ns, [...edges.filter((e) => e.id !== 'e6'), wire('e6', 'if', 'false', 'outer')]).get('e6')?.leavesLoop).toBe('outer');
    // A loop passed through its done pin is not a body the wire leaves.
    const afterDone = [
      wire('e1', 'start', 'exec-out', 'outer'),
      wire('e2', 'outer', 'loop', 'step'),
      wire('e3', 'outer', 'done', 'inner'),
      wire('e4', 'inner', 'done', 'if'),
      wire('e5', 'if', 'false', 'outer'),
    ];
    expect(loopBackWires(ns, afterDone).get('e5')).toEqual({ wireLimit: null, limited: false, leavesLoopBody: false, leavesLoop: null });
  });

  it('no repeating path means none; a loop in a part the entry never reaches is still found', () => {
    expect(loopBackWires(nodes, [wire('e1', 'start', 'exec-out', 'planner'), wire('e2', 'planner', 'exec-out', 'report')]).size).toBe(0);
    const edges = [wire('e1', 'start', 'exec-out', 'planner'), wire('e8', 'reviewer', 'exec-out', 'if'), wire('e9', 'if', 'false', 'reviewer')];
    expect([...loopBackWires(nodes, edges).keys()]).toEqual(['e9']);
  });
});

describe('a limit on the wire', () => {
  it('the wire keeps its limit through save and load, the loop counts as limited, and the checks want the other branch wired', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const { computeRunPreflightIssues } = await import('./preflight');
    const store = useFlowStore.getState();
    store.clearFlow();
    const docNodes = nodes.map((n) => ({ ...n, type: n.data.nodeType }));
    const edges = [...review, wire('e4', 'loop', 'done', 'reviewer')].filter((e) => e.id !== 'e6'); // If/Else true unwired
    store.loadFlow({ id: 'f', name: 'f', nodes: docNodes, edges } as any);
    useFlowStore.getState().setEdgeLoopLimit('e7', 3);
    let s = useFlowStore.getState();
    expect(loopBackWires(s.nodes, s.edges).get('e7')).toEqual({ wireLimit: 3, limited: true, leavesLoopBody: false, leavesLoop: null });
    expect(computeRunPreflightIssues(s.nodes, s.edges).map((i) => i.message)).toContain('wire its true branch: that is where the flow goes on once the 3-times limit is reached');
    s.setEdges([...s.edges, wire('e6', 'if', 'true', 'report')]);
    s = useFlowStore.getState();
    expect(computeRunPreflightIssues(s.nodes, s.edges).some((i) => i.message.includes('limit'))).toBe(false);
    const saved = s.getFlow();
    expect(saved.edges.find((e) => e.id === 'e7')?.data).toEqual({ loopLimit: { max: 3 } });
    store.clearFlow();
    store.loadFlow(saved);
    s = useFlowStore.getState();
    expect(wireLoopLimit(s.edges.find((e) => e.id === 'e7')!)).toBe(3);
    s.setEdgeLoopLimit('e7', null);
    expect(useFlowStore.getState().getFlow().edges.find((e) => e.id === 'e7')?.data).toBeUndefined();
  });

  it('a limit on a wire from something other than an If/Else is warned about: the path ends there', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const { computeRunPreflightIssues } = await import('./preflight');
    const store = useFlowStore.getState();
    store.clearFlow();
    const ns = [start, node('head', 'agent'), node('step', 'agent')].map((n) => ({ ...n, type: n.data.nodeType }));
    store.loadFlow({ id: 'f', name: 'f', nodes: ns, edges: [wire('e1', 'start', 'exec-out', 'head'), wire('e2', 'head', 'exec-out', 'step'), wire('e3', 'step', 'exec-out', 'head')] } as any);
    useFlowStore.getState().setEdgeLoopLimit('e3', 2);
    const s = useFlowStore.getState();
    expect(computeRunPreflightIssues(s.nodes, s.edges).map((i) => i.message)).toContain('the 2-times limit on its wire has nowhere to go: at the limit the path ends (only an If/Else resumes on its other branch)');
  });
});

describe('deleting the Loop Limit that sits on a wire', () => {
  it('draws the wire back and keys the per-path wire on it again', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const store = useFlowStore.getState();
    store.clearFlow();
    const reviewerNode = node('reviewer', 'agent', [O, { id: 'tasks', label: 'tasks', type: 'array' }]);
    const loopWithRoute = { ...loopNode('loop'), data: { ...loopNode('loop').data, inputRouteOverrides: { items: { 'if::false': { sourceNodeId: 'reviewer', sourceHandle: 'tasks' } } } } };
    const docNodes = nodes.map((n) => (n.id === 'reviewer' ? reviewerNode : n.id === 'loop' ? loopWithRoute : n)).map((n) => ({ ...n, type: n.data.nodeType }));
    const edges = [...review, wire('e4', 'loop', 'done', 'reviewer')].filter((e) => e.id !== 'd1');
    store.loadFlow({ id: 'f', name: 'f', nodes: docNodes, edges } as any);
    // A Loop Limit node placed on the wire by hand.
    const s0 = useFlowStore.getState();
    const limitId = 'limit';
    s0.setNodes([...s0.nodes, { ...limitNode(limitId), type: 'custom' }]);
    s0.setEdges([
      ...useFlowStore.getState().edges.filter((e) => e.id !== 'e7').map((e) => ((e.data as any)?.routeKey === 'if::false' ? { ...e, data: { ...(e.data as any), routeKey: 'limit::again' } } : e)),
      wire('e7a', 'if', 'false', limitId),
      wire('e7b', limitId, 'again', 'loop'),
    ]);
    useFlowStore.getState().deleteNode(limitId);
    const s = useFlowStore.getState();
    expect(s.nodes.some((n) => n.id === limitId)).toBe(false);
    expect(s.edges.some((e) => e.source === 'if' && e.sourceHandle === 'false' && e.target === 'loop' && e.targetHandle === 'exec-in')).toBe(true);
    const perPath = s.edges.find((e) => e.source === 'reviewer' && e.targetHandle === 'items')!;
    expect((perPath.data as any).routeKey).toBe('if::false');
    expect(loopBackWires(s.nodes, s.edges).get(s.edges.find((e) => e.source === 'if' && e.sourceHandle === 'false')!.id)?.limited).toBe(false);
  });

  it('a loop closed through limit reached, with again staying inside, is not limited', () => {
    // head → limit; again → step → back to head; limit_reached → step too: the loop never stops.
    const ns = [start, node('head', 'agent'), limitNode('limit'), node('step', 'agent')];
    const edges = [
      wire('e1', 'start', 'exec-out', 'head'),
      wire('e2', 'head', 'exec-out', 'limit'),
      wire('e3', 'limit', 'again', 'step'),
      wire('e4', 'limit', 'limit_reached', 'step'),
      wire('e5', 'step', 'exec-out', 'head'),
    ];
    expect(loopBackWires(ns, edges).get('e5')?.limited).toBe(false);
  });
});

describe('limits on both branches of one If/Else', () => {
  it('warns that the other branch repeats too, and that per-path values are skipped on the resume path', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const { computeRunPreflightIssues } = await import('./preflight');
    const store = useFlowStore.getState();
    store.clearFlow();
    const reviewerNode = node('reviewer', 'agent', [O, { id: 'tasks', label: 'tasks', type: 'array' }]);
    const loopWithRoute = { ...loopNode('loop'), data: { ...loopNode('loop').data, inputRouteOverrides: { items: { 'if::false': { sourceNodeId: 'reviewer', sourceHandle: 'tasks' } } } } };
    const docNodes = nodes.map((n) => (n.id === 'reviewer' ? reviewerNode : n.id === 'loop' ? loopWithRoute : n)).map((n) => ({ ...n, type: n.data.nodeType }));
    const edges = [...review.filter((e) => e.id !== 'e6' && e.id !== 'd1'), wire('e4', 'loop', 'done', 'reviewer'), wire('e6', 'if', 'true', 'loop')];
    store.loadFlow({ id: 'f', name: 'f', nodes: docNodes, edges } as any);
    useFlowStore.getState().setEdgeLoopLimit('e6', 2);
    useFlowStore.getState().setEdgeLoopLimit('e7', 2);
    const s = useFlowStore.getState();
    const messages = computeRunPreflightIssues(s.nodes, s.edges).map((i) => i.message);
    expect(messages.some((m) => m.includes('both of its branches repeat with a limit'))).toBe(true);
    // Only the false wire limited: at the limit the flow goes on through the (unlimited) true wire,
    // entering the ForEach by a way its per-path values never name.
    useFlowStore.getState().setEdgeLoopLimit('e6', null);
    const s2 = useFlowStore.getState();
    const again = computeRunPreflightIssues(s2.nodes, s2.edges).map((i) => i.message);
    expect(again.some((m) => m.includes('its true branch repeats without a limit'))).toBe(true);
    expect(again.some((m) => m.includes('per-path values do not apply'))).toBe(true);
  });
});

describe('deleting the Loop Limit with the Delete key', () => {
  it('also draws the wire back (the React Flow removal path)', async () => {
    const { useFlowStore } = await import('../hooks/useFlow');
    const store = useFlowStore.getState();
    store.clearFlow();
    const docNodes = [...nodes, limitNode('limit')].map((n) => ({ ...n, type: n.data.nodeType }));
    const edges = [
      wire('e1', 'start', 'exec-out', 'planner'),
      wire('e2', 'planner', 'exec-out', 'loop'),
      wire('e4a', 'loop', 'done', 'limit'),
      wire('e4b', 'limit', 'again', 'reviewer'),
      wire('e4c', 'limit', 'limit_reached', 'report'),
      wire('e5', 'reviewer', 'exec-out', 'if'),
      wire('e6', 'if', 'true', 'report'),
      wire('e7', 'if', 'false', 'loop'),
    ];
    store.loadFlow({ id: 'f', name: 'f', nodes: docNodes, edges } as any);
    useFlowStore.getState().onNodesChange([{ type: 'remove', id: 'limit' }]);
    const s = useFlowStore.getState();
    expect(s.nodes.some((n) => n.id === 'limit')).toBe(false);
    expect(s.edges.some((e) => e.source === 'loop' && e.sourceHandle === 'done' && e.target === 'reviewer' && e.targetHandle === 'exec-in')).toBe(true);
    expect([...loopBackWires(s.nodes, s.edges).keys()]).toEqual(['e7']);
  });
});
