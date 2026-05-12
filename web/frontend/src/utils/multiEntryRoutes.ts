import type { Edge, Node } from 'reactflow';
import type { FlowNodeData, JsonValue } from '../types/flow';
import { isEntryNodeType } from '../types/flow';

type EntryRoute = {
  key: string;
  sourceNodeId: string;
  sourceHandle: string;
  label?: string;
};

type RouteOverrideRef = {
  sourceNodeId: string;
  sourceHandle: string;
};

function routeKey(sourceNodeId: string, sourceHandle: string): string {
  return `${sourceNodeId}::${sourceHandle || 'exec-out'}`;
}

function isExecInEdge(edge: Edge): boolean {
  return edge.targetHandle === 'exec-in';
}

function normalizeHandle(handle: unknown): string {
  const value = typeof handle === 'string' ? handle.trim() : '';
  return value || 'exec-out';
}

function incomingExecEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges
    .filter((e) => e.target === nodeId && isExecInEdge(e))
    .sort((a, b) => {
      const ak = routeKey(String(a.source || '').trim(), normalizeHandle(a.sourceHandle));
      const bk = routeKey(String(b.source || '').trim(), normalizeHandle(b.sourceHandle));
      return ak.localeCompare(bk);
    });
}

function existingRouteLabels(data: FlowNodeData): Map<string, string> {
  const labels = new Map<string, string>();
  const raw = (data as any).entryRoutes;
  if (!Array.isArray(raw)) return labels;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const src = String((item as any).sourceNodeId || (item as any).source || '').trim();
    if (!src) continue;
    const handle = normalizeHandle((item as any).sourceHandle);
    const key = String((item as any).key || routeKey(src, handle)).trim();
    const label = String((item as any).label || '').trim();
    if (key && label) labels.set(key, label);
  }
  return labels;
}

function routeLabel(edge: Edge, index: number): string {
  const handle = normalizeHandle(edge.sourceHandle);
  if (handle === 'exec-out') return `Entry ${index + 1}`;
  return handle;
}

function buildEntryRoutes(node: Node<FlowNodeData>, edges: Edge[]): EntryRoute[] {
  const labels = existingRouteLabels(node.data);
  return incomingExecEdges(node.id, edges).map((edge, index) => {
    const sourceNodeId = String(edge.source || '').trim();
    const sourceHandle = normalizeHandle(edge.sourceHandle);
    const key = routeKey(sourceNodeId, sourceHandle);
    return {
      key,
      sourceNodeId,
      sourceHandle,
      label: labels.get(key) || routeLabel(edge, index),
    };
  });
}

function cleanInputRouteOverrides(
  data: FlowNodeData,
  validRouteKeys: Set<string>,
  validSourceRefs: Set<string>
): Record<string, Record<string, RouteOverrideRef>> | undefined {
  const raw = (data as any).inputRouteOverrides;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const out: Record<string, Record<string, RouteOverrideRef>> = {};
  for (const [pinId, perRoute] of Object.entries(raw as Record<string, unknown>)) {
    if (!pinId || !perRoute || typeof perRoute !== 'object' || Array.isArray(perRoute)) continue;
    const cleaned: Record<string, RouteOverrideRef> = {};
    for (const [route, ref] of Object.entries(perRoute as Record<string, unknown>)) {
      if (!validRouteKeys.has(route)) continue;
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue;
      const sourceNodeId = String((ref as any).sourceNodeId || (ref as any).source || '').trim();
      const sourceHandle = String((ref as any).sourceHandle || (ref as any).handle || '').trim();
      if (!sourceNodeId || !sourceHandle) continue;
      if (!validSourceRefs.has(routeKey(sourceNodeId, sourceHandle))) continue;
      cleaned[route] = { sourceNodeId, sourceHandle };
    }
    if (Object.keys(cleaned).length > 0) out[pinId] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function withMultiEntryRouteData(nodes: Node<FlowNodeData>[], edges: Edge[]): Node<FlowNodeData>[] {
  const validSourceRefs = new Set<string>();
  for (const node of nodes) {
    for (const output of node.data.outputs || []) {
      if (!output || !output.id) continue;
      validSourceRefs.add(routeKey(node.id, output.id));
    }
  }

  return nodes.map((node) => {
    const routes = buildEntryRoutes(node, edges);
    const nextData: FlowNodeData = { ...node.data };
    if (routes.length > 1) {
      (nextData as any).entryRoutes = routes;
      const validRouteKeys = new Set(routes.map((r) => r.key));
      const overrides = cleanInputRouteOverrides(node.data, validRouteKeys, validSourceRefs);
      if (overrides) {
        (nextData as any).inputRouteOverrides = overrides as JsonValue;
      } else {
        delete (nextData as any).inputRouteOverrides;
      }
    } else {
      delete (nextData as any).entryRoutes;
      delete (nextData as any).inputRouteOverrides;
    }
    return { ...node, data: nextData };
  });
}

export function inferEntryNode(nodes: Node<FlowNodeData>[], edges: Edge[]): string | undefined {
  const execTargets = new Set(edges.filter(isExecInEdge).map((e) => e.target));
  const entryTrigger = nodes.find((n) => isEntryNodeType(n.data.nodeType) && !execTargets.has(n.id));
  if (entryTrigger) return entryTrigger.id;

  const execStart = nodes.find(
    (n) => !execTargets.has(n.id) && Array.isArray(n.data.outputs) && n.data.outputs.some((p) => p.type === 'execution')
  );
  if (execStart) return execStart.id;

  const fallbackTrigger = nodes.find((n) => isEntryNodeType(n.data.nodeType));
  return fallbackTrigger?.id || nodes[0]?.id;
}
