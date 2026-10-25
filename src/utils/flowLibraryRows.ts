import type { VisualFlow } from '../types/flow';
import {
  buildFlowFamilyIndex,
  isExecutableFlow,
  refMultiplicity,
  type FlowFamilyIndex,
  type FlowFamilyIndexOptions,
} from './flowFamilies';
import { FLOW_KINDS, flowKind, flowKindCounts, type FlowKind, type FlowKindCounts } from './flowKinds';

/**
 * Pure row model for the Flow Library list (backlog 0144). Two modes:
 * - BROWSE (empty query): first-level rows, families expandable in place.
 * - LOOKUP (non-empty query): family nesting suspends; matches render flat
 *   with a "used by" context subtitle on helpers.
 * The view is All or one kind (flowKinds.ts: chat / triggered / other, by
 * what starts the flow). All groups its rows under one heading row
 * per kind (collapsible); a kind filter is a plain list of EVERY flow of that
 * kind (a subflow of that kind too, with its "in …" context), so the list
 * always shows as many flows as its pill counts.
 */

export type LibraryViewMode = 'all' | FlowKind;
export type LibrarySortMode = 'recent' | 'name_asc' | 'name_desc';

export interface LibraryRow {
  /** Unique per row INSTANCE (a shared helper renders once per parent). */
  key: string;
  kind: 'group' | 'top' | 'child' | 'cycle' | 'missing';
  /** kind=group: the flow kind this heading introduces. */
  group?: FlowKind;
  /** kind=group: rows in the group (its first-level flows, or its matches). */
  groupCount?: number;
  /** kind=group: flows of this kind that live only inside other flows (browse mode). */
  groupNested?: number;
  /** kind=group: the heading is folded (its rows are not listed). */
  groupCollapsed?: boolean;
  /** Absent for kind=missing (a reference to a flow that does not exist) and kind=group. */
  flow?: VisualFlow;
  /** Missing reference id (kind=missing). */
  missingId?: string;
  depth: number;
  parentId?: string;
  expandable: boolean;
  expanded: boolean;
  /** Distinct existing flows in the family (top rows with refs only). */
  familySize?: number;
  /** Dangling references of THIS flow (collapsed parents must not hide breakage). */
  missingCount?: number;
  /** Node-instance count of this reference within its parent (children). */
  multiplicity?: number;
  /** Distinct parents referencing this flow (children; >1 renders shared ×N). */
  sharedCount?: number;
  /** Flat mode: names of flows referencing this one ("in …" subtitle). */
  contextParents?: string[];
  /** kind=cycle: the ancestor name the reference loops back to. */
  cycleBackTo?: string;
}

export interface LibraryRowsOptions {
  query: string;
  viewMode: LibraryViewMode;
  sortMode: LibrarySortMode;
  expandedIds: ReadonlySet<string>;
  /** All view: the kind headings folded by the person. */
  collapsedGroups?: ReadonlySet<FlowKind>;
  familyIndexOptions?: FlowFamilyIndexOptions;
}

function safeLower(value: unknown): string {
  return (typeof value === 'string' ? value : String(value ?? '')).toLowerCase();
}

function parseIsoMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sortFlows(flows: VisualFlow[], sortMode: LibrarySortMode): VisualFlow[] {
  const sorted = [...flows];
  if (sortMode === 'name_asc') {
    sorted.sort((a, b) => safeLower(a.name).localeCompare(safeLower(b.name)));
  } else if (sortMode === 'name_desc') {
    sorted.sort((a, b) => safeLower(b.name).localeCompare(safeLower(a.name)));
  } else {
    sorted.sort((a, b) => {
      const au = parseIsoMs(a.updated_at) || parseIsoMs(a.created_at);
      const bu = parseIsoMs(b.updated_at) || parseIsoMs(b.created_at);
      if (bu !== au) return bu - au;
      return safeLower(a.name).localeCompare(safeLower(b.name));
    });
  }
  return sorted;
}

function matchesQuery(flow: VisualFlow, q: string): boolean {
  return `${flow.name ?? ''}\n${flow.description ?? ''}\n${flow.id ?? ''}`.toLowerCase().includes(q);
}

export interface LibraryRowsResult {
  rows: LibraryRow[];
  /** Catalog-wide counts for the header line (independent of query). */
  totalCount: number;
  topLevelCount: number;
  executableCount: number;
  /** Flows of each kind (every flow once, subflows included): the filter pills. */
  kindCounts: FlowKindCounts;
}

/** Children of one parent, sorted name-asc (reference order is canvas geometry, not meaning). */
function childIdsOf(parentId: string, index: FlowFamilyIndex, byId: Map<string, VisualFlow>): string[] {
  const ids = (index.refs.get(parentId) || []).filter((id) => id !== parentId);
  return [...ids].sort((a, b) => {
    const an = byId.get(a)?.name || a;
    const bn = byId.get(b)?.name || b;
    return safeLower(an).localeCompare(safeLower(bn));
  });
}

export function buildLibraryRows(
  flows: VisualFlow[],
  index: FlowFamilyIndex,
  options: LibraryRowsOptions
): LibraryRowsResult {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  const kindOf = new Map(flows.map((flow) => [flow.id, flowKind(flow)]));
  const counts = {
    totalCount: flows.length,
    topLevelCount: index.firstLevelIds.size,
    executableCount: flows.filter((flow) => isExecutableFlow(flow)).length,
    kindCounts: flowKindCounts(flows),
  };
  const view = options.viewMode;
  const inView = (id: string) => view === 'all' || kindOf.get(id) === view;
  const collapsed = options.collapsedGroups || new Set<FlowKind>();
  const q = options.query.trim().toLowerCase();
  const rows: LibraryRow[] = [];

  /** One flat row (lookup matches; a kind filter's subflows). */
  const flatRow = (flow: VisualFlow): LibraryRow => {
    // Unique parent NAMES: several saved copies of one workflow (same
    // name, different ids) otherwise render "in deep-research, deep-research".
    const parents = Array.from(
      new Set((index.inboundBy.get(flow.id) || []).map((id) => byId.get(id)?.name || id))
    ).sort((a, b) => safeLower(a).localeCompare(safeLower(b)));
    return {
      key: `flat:${flow.id}`,
      kind: 'top' as const,
      flow,
      depth: 0,
      expandable: false,
      expanded: false,
      ...(parents.length > 0 ? { contextParents: parents } : {}),
      ...(index.familyRootIds.has(flow.id) ? { familySize: (index.familyMembers.get(flow.id) || []).length } : {}),
    };
  };

  const pushChildren = (parentId: string, depth: number, ancestorPath: string[], pathKey: string) => {
    const parentFlow = byId.get(parentId);
    for (const childId of childIdsOf(parentId, index, byId)) {
      const child = byId.get(childId);
      const childKey = `${pathKey}>${childId}`;
      if (!child) {
        rows.push({
          key: `${childKey}:missing`,
          kind: 'missing',
          missingId: childId,
          depth,
          parentId,
          expandable: false,
          expanded: false,
        });
        continue;
      }
      if (ancestorPath.includes(childId)) {
        rows.push({
          key: `${childKey}:cycle`,
          kind: 'cycle',
          flow: child,
          depth,
          parentId,
          expandable: false,
          expanded: false,
          cycleBackTo: byId.get(childId)?.name || childId,
        });
        continue;
      }
      const grandchildren = childIdsOf(childId, index, byId);
      const childMissing = (index.missingRefsBy.get(childId) || []).length;
      const expandable = grandchildren.length > 0 || childMissing > 0;
      const expanded = expandable && options.expandedIds.has(childKey);
      rows.push({
        key: childKey,
        kind: 'child',
        flow: child,
        depth,
        parentId,
        expandable,
        expanded,
        multiplicity: parentFlow ? refMultiplicity(parentFlow, childId) : undefined,
        sharedCount: (index.inboundBy.get(childId) || []).length,
        ...(childMissing > 0 ? { missingCount: childMissing } : {}),
      });
      if (expanded) pushChildren(childId, depth + 1, [...ancestorPath, childId], childKey);
    }
    // Missing refs already rendered inside the child loop (a ref whose target
    // does not exist IS one of the parent's refs) — no second pass.
  };

  /** A first-level row and, when unfolded, its family (browse mode). */
  const pushTop = (flow: VisualFlow) => {
    const isRoot = index.familyRootIds.has(flow.id);
    const expanded = isRoot && options.expandedIds.has(flow.id);
    const missingCount = (index.missingRefsBy.get(flow.id) || []).length;
    rows.push({
      key: flow.id,
      kind: 'top',
      flow,
      depth: 0,
      expandable: isRoot,
      expanded,
      ...(isRoot ? { familySize: (index.familyMembers.get(flow.id) || []).length } : {}),
      ...(missingCount > 0 ? { missingCount } : {}),
    });
    if (expanded) pushChildren(flow.id, 1, [flow.id], flow.id);
  };

  const pushGroup = (kind: FlowKind, count: number, nested: number) => {
    rows.push({
      key: `group:${kind}`,
      kind: 'group',
      group: kind,
      groupCount: count,
      ...(nested > 0 ? { groupNested: nested } : {}),
      groupCollapsed: collapsed.has(kind),
      depth: 0,
      expandable: false,
      expanded: false,
    });
  };

  if (q) {
    // LOOKUP mode: flat, all matches (helpers included), context subtitles;
    // All groups the matches by kind.
    const matches = sortFlows(
      flows.filter((flow) => inView(flow.id) && matchesQuery(flow, q)),
      options.sortMode
    );
    if (view !== 'all') return { ...counts, rows: matches.map(flatRow) };
    for (const kind of FLOW_KINDS) {
      const ofKind = matches.filter((flow) => kindOf.get(flow.id) === kind);
      if (!ofKind.length) continue;
      pushGroup(kind, ofKind.length, 0);
      if (!collapsed.has(kind)) rows.push(...ofKind.map(flatRow));
    }
    return { ...counts, rows };
  }

  if (view !== 'all') {
    // A kind: every flow of that kind. First-level ones keep their family
    // unfolding; one living only inside other flows says where ("in …").
    for (const flow of sortFlows(flows.filter((f) => inView(f.id)), options.sortMode)) {
      if (index.firstLevelIds.has(flow.id)) pushTop(flow);
      else rows.push(flatRow(flow));
    }
    return { ...counts, rows };
  }

  // BROWSE All: one heading per kind, its first-level rows below; expanded
  // families walk in place.
  const topFlows = sortFlows(
    flows.filter((flow) => index.firstLevelIds.has(flow.id)),
    options.sortMode
  );
  for (const kind of FLOW_KINDS) {
    const ofKind = topFlows.filter((flow) => kindOf.get(flow.id) === kind);
    if (!ofKind.length) continue;
    pushGroup(kind, ofKind.length, counts.kindCounts[kind] - ofKind.length);
    if (!collapsed.has(kind)) for (const flow of ofKind) pushTop(flow);
  }

  return { ...counts, rows };
}

/** Convenience: index + rows in one call (memoize per input identity in the UI). */
export function libraryRowsFor(flows: VisualFlow[], options: LibraryRowsOptions): LibraryRowsResult {
  return buildLibraryRows(flows, buildFlowFamilyIndex(flows, options.familyIndexOptions), options);
}

/** "3 nodes · 1 edge": a flow's size in words (also what tells same-named flows apart, never their ids). */
export function graphSize(flow: { nodes?: unknown[]; edges?: unknown[] }): string {
  const n = Array.isArray(flow.nodes) ? flow.nodes.length : 0;
  const e = Array.isArray(flow.edges) ? flow.edges.length : 0;
  return `${n} node${n === 1 ? '' : 's'} · ${e} edge${e === 1 ? '' : 's'}`;
}
