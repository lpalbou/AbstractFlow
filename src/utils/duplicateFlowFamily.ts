import type { VisualFlow, VisualNode } from '../types/flow';
import { flowRefs } from './flowFamilies';

/**
 * Family-aware duplication of read-only (bundled) workflows.
 *
 * Bundled flows live in the app package, not in gateway storage, so a
 * standalone copy of a family ROOT would keep subflow references pointing at
 * ids the gateway cannot resolve at run time (the historical reason
 * bundle-target duplication was refused outright — operator ruling
 * 2026-07-20: make it work instead). The general rule implemented here:
 *
 * - Every reference chain that lands on a READONLY flow is copied (the copy
 *   must be self-contained to be runnable/editable).
 * - References to STORED flows stay shared (existing semantic: "references
 *   shared subflows — they are not copied").
 * - Ids are minted by the gateway on create, so remapping runs as a second
 *   phase: create every copy first (collecting old→new ids), then patch the
 *   copies whose nodes reference any old id. This two-phase shape handles
 *   self-references and mutual cycles without a topological sort.
 */

/** Subflow reference keys the editor understands (see useFlow load compat). */
const SUBFLOW_REF_KEYS = ['subflowId', 'flowId', 'workflowId', 'workflow_id'] as const;

/**
 * The set of flows that must be copied for `rootId` to be self-contained:
 * the root plus every transitively referenced READONLY flow. Stored refs are
 * boundary nodes — not entered, not returned.
 */
export function bundledFamilyClosure(
  rootId: string,
  flowsById: Map<string, VisualFlow>,
  readonlyIds: Set<string>
): VisualFlow[] {
  const root = flowsById.get(rootId);
  if (!root) return [];
  const closure: VisualFlow[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const flow = flowsById.get(id);
    if (!flow) continue;
    // Only the root itself and readonly refs join the closure; a stored ref
    // stays shared and its own refs are its own business.
    if (id !== rootId && !readonlyIds.has(id)) continue;
    closure.push(flow);
    for (const ref of flowRefs(flow)) {
      if (!seen.has(ref) && readonlyIds.has(ref)) stack.push(ref);
    }
  }
  return closure;
}

/** Remap subflow references in `nodes` through `idMap`; returns null when nothing changed. */
export function remapSubflowRefs(
  nodes: VisualNode[],
  idMap: Map<string, string>
): VisualNode[] | null {
  let changed = false;
  const next = nodes.map((node) => {
    const data = node.data as unknown as Record<string, unknown> | undefined;
    if (!data || data.nodeType !== 'subflow') return node;
    let nodeChanged = false;
    const nextData: Record<string, unknown> = { ...data };
    for (const key of SUBFLOW_REF_KEYS) {
      const value = nextData[key];
      if (typeof value === 'string' && idMap.has(value.trim())) {
        nextData[key] = idMap.get(value.trim());
        nodeChanged = true;
      }
    }
    if (!nodeChanged) return node;
    changed = true;
    return { ...node, data: nextData } as unknown as VisualNode;
  });
  return changed ? next : null;
}

export interface DuplicateFamilyIO {
  /** POST a new flow; returns the created flow (gateway mints the id). */
  createFlow: (flow: {
    name: string;
    description: string;
    interfaces: string[];
    nodes: VisualNode[];
    edges: VisualFlow['edges'];
    entryNode?: VisualFlow['entryNode'];
  }) => Promise<VisualFlow>;
  /** PUT updated nodes onto an existing flow (reference remap phase). */
  updateFlowNodes: (flowId: string, flow: VisualFlow, nodes: VisualNode[]) => Promise<VisualFlow>;
  /** DELETE a flow — used to roll back partial families when a phase fails. */
  deleteFlow?: (flowId: string) => Promise<void>;
}

export interface DuplicateFamilyResult {
  root: VisualFlow;
  copies: VisualFlow[];
  /** old id -> new id for every copied flow. */
  idMap: Map<string, string>;
}

/**
 * Duplicate `rootId` and its readonly closure into stored, editable flows.
 * `rootName` names the new root; helper copies get a " (copy)" suffix so the
 * library disambiguates them from the bundled originals at a glance.
 */
export async function duplicateFlowFamily(options: {
  rootId: string;
  rootName: string;
  flows: VisualFlow[];
  readonlyIds: Set<string>;
  io: DuplicateFamilyIO;
}): Promise<DuplicateFamilyResult> {
  const { rootId, rootName, flows, readonlyIds, io } = options;
  const flowsById = new Map(flows.map((flow) => [flow.id, flow] as const));
  const closure = bundledFamilyClosure(rootId, flowsById, readonlyIds);
  if (!closure.length) throw new Error(`Flow "${rootId}" not found`);

  const idMap = new Map<string, string>();
  const createdBySource = new Map<string, VisualFlow>();

  // A failure mid-family must not strand half-remapped orphan copies in
  // storage (they would look loadable but reference unresolvable subflow
  // ids). Roll back best-effort, then rethrow the original failure.
  const rollback = async (): Promise<void> => {
    if (!io.deleteFlow) return;
    for (const created of createdBySource.values()) {
      try {
        await io.deleteFlow(created.id);
      } catch {
        // Best-effort: the original error is the one worth surfacing.
      }
    }
  };

  try {
    // Phase 1: create every copy with references untouched.
    for (const source of closure) {
      const isRoot = source.id === rootId;
      const base = (source.name || 'Untitled').trim() || 'Untitled';
      const created = await io.createFlow({
        name: isRoot ? rootName : `${base} (copy)`,
        description: source.description || '',
        interfaces: Array.isArray(source.interfaces) ? source.interfaces : [],
        nodes: source.nodes,
        edges: source.edges,
        entryNode: source.entryNode,
      });
      idMap.set(source.id, created.id);
      createdBySource.set(source.id, created);
    }

    // Phase 2: patch copies whose nodes reference any copied id (covers
    // parent->child, self-references, and mutual cycles uniformly).
    const copies: VisualFlow[] = [];
    for (const source of closure) {
      const created = createdBySource.get(source.id) as VisualFlow;
      const remapped = remapSubflowRefs(created.nodes, idMap);
      if (remapped) {
        copies.push(await io.updateFlowNodes(created.id, created, remapped));
      } else {
        copies.push(created);
      }
    }

    const newRootId = idMap.get(rootId) as string;
    const root = copies.find((flow) => flow.id === newRootId) as VisualFlow;
    return { root, copies, idMap };
  } catch (error) {
    await rollback();
    throw error;
  }
}
