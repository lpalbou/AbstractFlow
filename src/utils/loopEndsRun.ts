/**
 * A loop whose body ends at On Flow End (operator 2026-10-25).
 *
 * The runtime runs a ForEach / For / While body once per item (pass). When
 * the body's execution chain reaches On Flow End, the run ends there: the
 * compiler lets an explicit end node terminate the run even inside a loop
 * (abstractruntime visualflow_compiler/compiler.py, "Explicit end node should
 * always terminate the run, even inside a control block"), so a ForEach over
 * five emails shows one. The body's last node needs no wire out: when its
 * chain ends, control returns to the loop for the next item, and `done` runs
 * after the last one.
 *
 * This module finds every such loop (`loopEndsRunIssues`), words it
 * (`loopEndsRunMessage`), and builds the one-click fix: the body's wires into
 * that On Flow End are removed and the loop's `done` is wired to it
 * (`loopEndFix`, applied by the `fix_loop_end` authoring command, one undo step).
 */
import type { FlowNodeData, NodeType, VisualFlow } from '../types/flow';
import { automationSaveWarning } from './triggerPins';

type GraphNode = { id: string; data: Pick<FlowNodeData, 'nodeType' | 'label' | 'inputs' | 'outputs'> };
type GraphEdge = { id: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null };

/** Loops with a body (`loop`) and an exit (`done`) execution output. */
export const LOOP_BODY_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>(['loop', 'for', 'while']);

export interface LoopEndsRunIssue {
  loopId: string;
  endId: string;
  /** The body's execution wires into that On Flow End (what the fix removes). */
  bodyEdgeIds: string[];
  /** The fix can wire `done` to On Flow End (false when `done` already leads somewhere else). */
  fixable: boolean;
}

function isExecWire(byId: Map<string, GraphNode>, edge: GraphEdge): boolean {
  const handle = String(edge.sourceHandle || '');
  const pin = byId.get(edge.source)?.data.outputs?.find((p) => p.id === handle);
  if (pin) return pin.type === 'execution';
  return handle === 'exec-out' || edge.targetHandle === 'exec-in';
}

/**
 * Every loop whose body reaches an On Flow End without going through the
 * loop's `done`: the walk starts at the wire out of `loop`, follows execution
 * wires, never re-enters the loop itself, and through an inner loop follows
 * only what runs after it (the inner body is the inner loop's own case).
 */
export function loopEndsRunIssues(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): LoopEndsRunIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const execOut = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || !isExecWire(byId, edge)) continue;
    const list = execOut.get(edge.source);
    if (list) list.push(edge);
    else execOut.set(edge.source, [edge]);
  }
  const issues: LoopEndsRunIssue[] = [];
  for (const loop of nodes) {
    if (!LOOP_BODY_NODE_TYPES.has(loop.data.nodeType)) continue;
    const intoEnd = new Map<string, string[]>();
    const seen = new Set<string>([loop.id]);
    const queue: GraphEdge[] = (execOut.get(loop.id) || []).filter((e) => e.sourceHandle === 'loop');
    while (queue.length > 0) {
      const wire = queue.shift() as GraphEdge;
      const target = byId.get(wire.target);
      if (!target || target.id === loop.id) continue;
      if (target.data.nodeType === 'on_flow_end') {
        const ids = intoEnd.get(target.id) || [];
        ids.push(wire.id);
        intoEnd.set(target.id, ids);
        continue;
      }
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      const inner = LOOP_BODY_NODE_TYPES.has(target.data.nodeType);
      for (const next of execOut.get(target.id) || []) {
        if (inner && next.sourceHandle === 'loop') continue;
        queue.push(next);
      }
    }
    const doneWired = edges.some((e) => e.source === loop.id && e.sourceHandle === 'done');
    for (const [endId, bodyEdgeIds] of intoEnd) {
      issues.push({ loopId: loop.id, endId, bodyEdgeIds, fixable: !doneWired });
    }
  }
  return issues;
}

/** The words, for the loop's kind: ForEach stops after its first item, For / While after their first pass. */
export function loopEndsRunMessage(loopType: NodeType | string | undefined): string {
  const unit = loopType === 'loop' ? 'item' : 'pass';
  return `This loop stops after its first ${unit}: its body ends at On Flow End. Wire Done to On Flow End; the body's last node needs no wire out.`;
}

/** Said under the fix when `done` already leads somewhere else (the fix would have to choose). */
export const LOOP_DONE_TAKEN_HINT = 'Done already leads to another node: remove the body’s wire into On Flow End, and end the path after Done with On Flow End.';

/** The fix as edits: the body's wires into On Flow End to remove, and the `done` wire to add. Null when it cannot apply. */
export function loopEndFix(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  loopId: string,
  endId: string
): { removeEdgeIds: string[]; connect: { source: string; sourceHandle: 'done'; target: string; targetHandle: 'exec-in' } } | null {
  const issue = loopEndsRunIssues(nodes, edges).find((i) => i.loopId === loopId && i.endId === endId);
  if (!issue || !issue.fixable) return null;
  return {
    removeEdgeIds: issue.bodyEdgeIds,
    connect: { source: loopId, sourceHandle: 'done', target: endId, targetHandle: 'exec-in' },
  };
}

/** The loop-ends-run sentences for a saved flow (one per loop), or null. */
export function loopEndsRunSaveWarning(flow: Pick<VisualFlow, 'nodes' | 'edges'>): string | null {
  const issues = loopEndsRunIssues(flow.nodes, flow.edges);
  if (issues.length === 0) return null;
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const loops = Array.from(new Set(issues.map((i) => i.loopId)));
  return loops
    .map((loopId) => {
      const loop = byId.get(loopId);
      const name = String(loop?.data.label || '').trim() || loopId;
      return `${name}: ${loopEndsRunMessage(loop?.data.nodeType)}`;
    })
    .join(' ');
}

/** What a save says (the save still happens): the automation's empty-result warning and any loop that ends the run, or null. */
export function flowSaveWarning(flow: Pick<VisualFlow, 'nodes' | 'edges' | 'automation_defaults'>): string | null {
  const automation = automationSaveWarning(flow);
  const loops = loopEndsRunSaveWarning(flow);
  if (!loops) return automation;
  return automation ? `${automation} ${loops}` : `Saved. ${loops}`;
}
