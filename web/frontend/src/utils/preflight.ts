import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { isEntryNodeType } from '../types/flow';

export type RunPreflightIssue = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  message: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function inputConnected(edges: Edge[], nodeId: string, handleId: string): boolean {
  return edges.some((e) => e.target === nodeId && e.targetHandle === handleId);
}

function pinTypeOf(node: Node<FlowNodeData>, handleId: string, isInput: boolean): string | null {
  const pins = isInput ? node.data.inputs : node.data.outputs;
  const p = pins?.find((x) => x.id === handleId);
  return p ? String(p.type || '') : null;
}

function isExecutionEdge(nodesById: Map<string, Node<FlowNodeData>>, edge: Edge): boolean {
  const src = nodesById.get(edge.source);
  const tgt = nodesById.get(edge.target);
  if (!src || !tgt) return false;
  const st = pinTypeOf(src, edge.sourceHandle || '', false);
  const tt = pinTypeOf(tgt, edge.targetHandle || '', true);
  return st === 'execution' || tt === 'execution';
}

function reachableExecNodes(nodes: Node<FlowNodeData>[], edges: Edge[]): Set<string> {
  if (!nodes.length) return new Set<string>();
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const entry =
    nodes.find((n) => isEntryNodeType(n.data.nodeType)) ||
    nodesById.get(nodes[0].id) ||
    null;
  if (!entry) return new Set<string>();

  const reachable = new Set<string>([entry.id]);
  const q: string[] = [entry.id];
  while (q.length) {
    const cur = q.shift() as string;
    for (const e of edges) {
      if (e.source !== cur) continue;
      if (!isExecutionEdge(nodesById, e)) continue;
      const nxt = e.target;
      if (!nxt || reachable.has(nxt)) continue;
      reachable.add(nxt);
      q.push(nxt);
    }
  }
  return reachable;
}

export function computeRunPreflightIssues(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
): RunPreflightIssue[] {
  const reachable = reachableExecNodes(nodes, edges);
  const issues: RunPreflightIssue[] = [];

  const push = (node: Node<FlowNodeData>, message: string) => {
    const label = isNonEmptyString(node.data.label) ? node.data.label.trim() : node.id;
    issues.push({
      id: `${node.id}:${message}`,
      nodeId: node.id,
      nodeLabel: label,
      message,
    });
  };

  for (const n of nodes) {
    if (!reachable.has(n.id)) continue;

    const t = n.data.nodeType;
    if (t === 'llm_call') {
      const providerOk =
        inputConnected(edges, n.id, 'provider') || isNonEmptyString(n.data.effectConfig?.provider);
      const modelOk =
        inputConnected(edges, n.id, 'model') || isNonEmptyString(n.data.effectConfig?.model);
      if (!providerOk) push(n, 'Missing required field: provider');
      if (!modelOk) push(n, 'Missing required field: model');
    }

    if (t === 'agent') {
      const providerOk =
        inputConnected(edges, n.id, 'provider') || isNonEmptyString(n.data.agentConfig?.provider);
      const modelOk =
        inputConnected(edges, n.id, 'model') || isNonEmptyString(n.data.agentConfig?.model);
      if (!providerOk) push(n, 'Missing required field: provider');
      if (!modelOk) push(n, 'Missing required field: model');
    }
  }

  // Stable ordering: node label then message (keeps UX consistent).
  issues.sort((a, b) => {
    const la = a.nodeLabel.toLowerCase();
    const lb = b.nodeLabel.toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.message.localeCompare(b.message);
  });
  return issues;
}



