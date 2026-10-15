import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { isExecEdge } from './execView';
import { inferEntryNode } from './multiEntryRoutes';

/**
 * The wires that make execution repeat (operator 2026-10-14: "when there is a recursive path (eg
 * from if/else back to the beginning of foreach), this would be automatically detected"): a
 * depth-first walk over the execution wires from the flow's entry (children in the order of the
 * source's output pins, so the result does not depend on the order wires were drawn); a wire
 * that lands on a node still on the walk's stack closes a loop. A loop's body returns to its
 * ForEach without a wire, so only drawn wires can close a loop, and the loop's head is the node
 * the walk reached first.
 */
/** The limit a wire carries (`edge.data.loopLimit.max`), or null. */
export function wireLoopLimit(edge: Edge): number | null {
  const raw = (edge.data as Record<string, unknown> | undefined)?.loopLimit;
  const max = raw && typeof raw === 'object' ? (raw as { max?: unknown }).max : undefined;
  return typeof max === 'number' && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : null;
}

export interface LoopBackWire {
  /** The wire carries its own limit (`data.loopLimit`): the simple form, no node and no exit to wire. */
  wireLimit: number | null;
  /** A Loop Limit already sits somewhere on this loop (the wire's own, or a node every way round passes through). */
  limited: boolean;
  /**
   * The wire jumps out of a ForEach / For / While body (the loop is entered through `loop`
   * between the head and the wire's source). The runtime cannot repeat such a loop today.
   */
  leavesLoopBody: boolean;
}

const LOOP_TYPES = new Set(['loop', 'for', 'while']);

export function loopBackWires(nodes: Node<FlowNodeData>[], edges: Edge[]): Map<string, LoopBackWire> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!isExecEdge(byId, edge)) continue;
    const list = out.get(edge.source);
    if (list) list.push(edge);
    else out.set(edge.source, [edge]);
  }
  const pinIndex = (edge: Edge) => {
    const outputs = byId.get(edge.source)?.data.outputs || [];
    const at = outputs.findIndex((p) => p.id === edge.sourceHandle);
    return at < 0 ? outputs.length : at;
  };
  for (const list of out.values()) list.sort((a, b) => pinIndex(a) - pinIndex(b) || a.id.localeCompare(b.id));

  const found = new Map<string, LoopBackWire>();
  const done = new Set<string>();
  // The walk's stack: each node with the pin it was left through.
  const stack: Array<{ id: string; handle: string }> = [];
  const onStack = new Map<string, number>();
  const walk = (id: string) => {
    onStack.set(id, stack.length);
    stack.push({ id, handle: '' });
    for (const edge of out.get(id) || []) {
      stack[stack.length - 1].handle = String(edge.sourceHandle || '');
      const at = onStack.get(edge.target);
      if (at !== undefined) {
        const leavesLoopBody = stack
          .slice(at)
          .some((entry) => LOOP_TYPES.has(byId.get(entry.id)?.data.nodeType || '') && entry.handle === 'loop');
        found.set(edge.id, { wireLimit: wireLoopLimit(edge), limited: false, leavesLoopBody });
      } else if (!done.has(edge.target)) walk(edge.target);
    }
    stack.pop();
    onStack.delete(id);
    done.add(id);
  };
  const entry = inferEntryNode(nodes, edges);
  if (entry) walk(entry);
  // Parts no path from the entry reaches still get their loops found.
  for (const node of nodes) if (!done.has(node.id)) walk(node.id);

  // Limited = every way round the loop passes through a limit (a Loop Limit's `again`, or a wire
  // carrying its own limit): the wire is one itself, or with every such wire removed the wire's
  // target no longer reaches its source.
  const isLimit = (id: string) => byId.get(id)?.data.nodeType === 'loop_limit';
  const isAgain = (e: Edge) => (isLimit(e.source) && e.sourceHandle === 'again') || wireLoopLimit(e) !== null;
  for (const [edgeId, info] of found) {
    const edge = edges.find((e) => e.id === edgeId)!;
    if (isAgain(edge)) {
      info.limited = true;
      continue;
    }
    const seen = new Set<string>([edge.target]);
    const queue = [edge.target];
    let reaches = false;
    while (queue.length && !reaches) {
      const id = queue.shift()!;
      for (const next of out.get(id) || []) {
        if (next.id === edgeId || isAgain(next) || seen.has(next.target)) continue;
        if (next.target === edge.source) {
          reaches = true;
          break;
        }
        seen.add(next.target);
        queue.push(next.target);
      }
    }
    info.limited = !reaches;
  }
  return found;
}
