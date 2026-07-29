import type { VisualFlow } from '../types/flow';

/**
 * Workflow family derivation for the Flow Library (backlog 0144, built on
 * operator green-light 2026-07-12).
 *
 * Grouping is DERIVED from the subflow reference graph with a declaration
 * pin — never a persisted role field (a stored "helper" flag lies the moment
 * a flow gains a host interface or loses its last referencer):
 * - refs(F) = distinct subflowId targets of F's subflow nodes.
 * - inbound(H) counts DISTINCT OTHER flows referencing H; self-references
 *   never count (a recursive flow must not bury itself).
 * - FIRST-LEVEL = declares a normalized non-empty `interfaces` list OR has
 *   zero external inbound. Interface-less cycles with no external parent are
 *   promoted whole (coverage invariant: no flow is ever unreachable).
 *
 * The interface CLASS facet is local until the gateway-served registry
 * exists (adversary H candidate i): the executable toggle reads
 * entrypoint-class declarations, so the pin's retirement onto
 * "entrypoint-class ∩ declared ≠ ∅" is a data change, not a redesign.
 */

export type InterfaceClass = 'entrypoint' | 'contract' | 'domain';

export interface KnownInterface {
  id: string;
  label: string;
  description: string;
  class: InterfaceClass;
  /** Boundary pins the contract requires (informational + future validation). */
  requiredStartPins?: string[];
  requiredEndPins?: string[];
}

/**
 * Local interface vocabulary. Replaced by a gateway-served registry when the
 * governance lane ships (fetch + #FALLBACK to this list).
 */
export const KNOWN_INTERFACES: KnownInterface[] = [
  {
    id: 'abstractcode.agent.v1',
    label: 'Runnable agent (v1)',
    description:
      'Executable as a specialized workflow by chat-like hosts (AbstractCode, entity phases, gateway agency loops). Contract: provider/model/prompt inputs on On Flow Start; response/success/meta outputs on On Flow End.',
    class: 'entrypoint',
    requiredStartPins: ['provider', 'model', 'prompt'],
    requiredEndPins: ['response', 'success', 'meta'],
  },
  {
    id: 'abstractresearch.deep.v1',
    label: 'Deep research',
    description: 'Domain marker for the deep-research family. No framework consumer yet.',
    class: 'domain',
  },
  {
    id: 'abstractmeta.intelligence.v1',
    label: 'Meta-intelligence',
    description:
      'Domain marker for co-orchestrated deliberation patterns (consensus, debate, introspection, multi-angle, plan-verify). Each flow also conforms to abstractcode.agent.v1 so it benchmarks 1:1 against an isolated LLM call.',
    class: 'domain',
  },
  {
    id: 'abstractcode.coding.v1',
    label: 'Coding agent (v1)',
    description:
      'Runnable coding workflow: builder agent + independent build/execute/match verification with specific-failure reprompting. Superset of the runnable-agent contract with a workspace_root input and a structured pass/failure result.',
    class: 'entrypoint',
    requiredStartPins: ['request'],
    requiredEndPins: ['report', 'passed'],
  },
  {
    id: 'abstractresearch.coscientist.v1',
    label: 'AI co-scientist',
    description:
      'Runnable multi-agent hypothesis engine inspired by the Nature AI co-scientist: supervisor loop over generate/reflect/rank(Elo tournament)/evolve + a final meta-review. Takes a research_goal, returns Elo-ranked hypotheses + a research overview. Simplified vs the paper (synchronous loop, one debate pass/cycle, meta-review runs once, no proximity dedup, grounding opt-in).',
    class: 'entrypoint',
    requiredStartPins: ['research_goal'],
    requiredEndPins: ['research_overview', 'ranked_hypotheses'],
  },
  {
    id: 'abstractreview.adversarial.v1',
    label: 'Adversarial review (composable)',
    description:
      'Reusable review primitive: three-lens critics (correctness / design / requirements-fit) merged into a severity-ranked pass/revise/block verdict. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: ['artifact'],
    requiredEndPins: ['findings', 'verdict'],
  },
  {
    id: 'abstractextract.structured.v1',
    label: 'Structured extract (composable)',
    description:
      'Reusable extraction primitive: text -> schema-validated JSON with a validate/reprompt correction loop. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: ['source_text', 'fields_spec'],
    requiredEndPins: ['data', 'valid'],
  },
  {
    id: 'abstractbatch.mapreduce.v1',
    label: 'Map-reduce (composable)',
    description:
      'Reusable batch primitive: map a per-item LLM instruction over an array, then reduce the results with a synthesis instruction. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: ['items'],
    requiredEndPins: ['results', 'synthesis'],
  },
];

export function knownInterface(id: string): KnownInterface | undefined {
  return KNOWN_INTERFACES.find((entry) => entry.id === id);
}

/** Trim + drop empties + dedupe. The gateway accepts [""] so raw reads lie. */
export function normalizeInterfaces(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** Executable = declares at least one entrypoint-class interface. */
export function isExecutableFlow(flow: Pick<VisualFlow, 'interfaces'>): boolean {
  return normalizeInterfaces(flow.interfaces).some((id) => knownInterface(id)?.class === 'entrypoint');
}

/** Distinct subflow ids referenced by a flow (self-references included). */
export function flowRefs(flow: VisualFlow): string[] {
  const refs = new Set<string>();
  for (const node of flow.nodes || []) {
    const data = node.data as { nodeType?: unknown; subflowId?: unknown } | undefined;
    if (data?.nodeType !== 'subflow') continue;
    const target = typeof data.subflowId === 'string' ? data.subflowId.trim() : '';
    if (target) refs.add(target);
  }
  return Array.from(refs);
}

export interface FlowFamilyIndex {
  /** Distinct referenced subflow ids per flow id (self-refs included). */
  refs: Map<string, string[]>;
  /** Distinct OTHER flows referencing each id (self-refs excluded). */
  inboundBy: Map<string, string[]>;
  /** Flow ids that render at the top level. */
  firstLevelIds: Set<string>;
  /** First-level ids that reference at least one existing subflow. */
  familyRootIds: Set<string>;
  /** Flows referencing themselves (badge; never counted as inbound). */
  selfReferencingIds: Set<string>;
  /** Flows promoted only by the coverage sweep (interface-less cycles). */
  cyclePromotedIds: Set<string>;
  /** Referenced ids that do not exist in the catalog, per referencing flow. */
  missingRefsBy: Map<string, string[]>;
  /** Distinct transitive family members per root (existing flows, root excluded). */
  familyMembers: Map<string, string[]>;
}

export interface FlowFamilyIndexOptions {
  /** Flow ids that fold under referencers in the library even when they declare interfaces. */
  composedOnlyIds?: ReadonlySet<string>;
}

/** Derive the whole family index for a catalog of flows. Pure; memoize per flows array. */
export function buildFlowFamilyIndex(flows: VisualFlow[], options?: FlowFamilyIndexOptions): FlowFamilyIndex {
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  const refs = new Map<string, string[]>();
  const inbound = new Map<string, Set<string>>();
  const selfReferencingIds = new Set<string>();
  const missingRefsBy = new Map<string, string[]>();

  for (const flow of flows) {
    const targets = flowRefs(flow);
    refs.set(flow.id, targets);
    const missing: string[] = [];
    for (const target of targets) {
      if (target === flow.id) {
        selfReferencingIds.add(flow.id);
        continue;
      }
      if (!byId.has(target)) {
        missing.push(target);
        continue;
      }
      let set = inbound.get(target);
      if (!set) inbound.set(target, (set = new Set()));
      set.add(flow.id);
    }
    if (missing.length > 0) missingRefsBy.set(flow.id, missing);
  }

  const composedOnlyIds = options?.composedOnlyIds;
  const firstLevelIds = new Set<string>();
  for (const flow of flows) {
    const composedOnly = composedOnlyIds?.has(flow.id) ?? false;
    const pinned = normalizeInterfaces(flow.interfaces).length > 0 && !composedOnly;
    const externalInbound = inbound.get(flow.id)?.size || 0;
    if (pinned || externalInbound === 0) firstLevelIds.add(flow.id);
  }

  // Coverage sweep: everything must be reachable from the first level.
  // Interface-less cycles with no external parent are promoted WHOLE —
  // visibility is the correct failure mode for pathological graphs.
  const reached = new Set<string>();
  const queue = [...firstLevelIds];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const target of refs.get(current) || []) {
      if (byId.has(target) && !reached.has(target)) queue.push(target);
    }
  }
  const cyclePromotedIds = new Set<string>();
  for (const flow of flows) {
    if (reached.has(flow.id)) continue;
    firstLevelIds.add(flow.id);
    cyclePromotedIds.add(flow.id);
    // Promotion makes the whole cycle reachable; sweep from it.
    const sweep = [flow.id];
    while (sweep.length > 0) {
      const current = sweep.pop() as string;
      if (reached.has(current)) continue;
      reached.add(current);
      for (const target of refs.get(current) || []) {
        if (byId.has(target) && !reached.has(target)) sweep.push(target);
      }
    }
  }

  const familyRootIds = new Set<string>();
  const familyMembers = new Map<string, string[]>();
  for (const id of firstLevelIds) {
    const members = new Set<string>();
    const stack = [...(refs.get(id) || [])];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === id || members.has(current) || !byId.has(current)) continue;
      members.add(current);
      for (const target of refs.get(current) || []) stack.push(target);
    }
    if (members.size > 0 || (missingRefsBy.get(id) || []).length > 0) {
      familyRootIds.add(id);
      familyMembers.set(id, Array.from(members));
    }
  }

  const inboundBy = new Map<string, string[]>();
  for (const [id, set] of inbound) inboundBy.set(id, Array.from(set));

  return {
    refs,
    inboundBy,
    firstLevelIds,
    familyRootIds,
    selfReferencingIds,
    cyclePromotedIds,
    missingRefsBy,
    familyMembers,
  };
}

/** Per-parent subflow reference multiplicity (node instances per target id). */
export function refMultiplicity(flow: VisualFlow, targetId: string): number {
  let count = 0;
  for (const node of flow.nodes || []) {
    const data = node.data as { nodeType?: unknown; subflowId?: unknown } | undefined;
    if (data?.nodeType === 'subflow' && typeof data.subflowId === 'string' && data.subflowId.trim() === targetId) {
      count += 1;
    }
  }
  return count;
}
