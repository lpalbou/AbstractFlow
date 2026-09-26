import type { FlowNodeData, Pin, PinType, VisualFlow } from '../types/flow';

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

/**
 * One boundary pin an interface requires. Start pins are OUTPUTS of the
 * On Flow Start node (what a host sends in); end pins are INPUTS of the
 * On Flow End node (what a host reads back).
 */
export interface InterfacePinSpec {
  id: string;
  label: string;
  type: PinType;
  description?: string;
}

export interface KnownInterface {
  id: string;
  label: string;
  description: string;
  class: InterfaceClass;
  /** On Flow Start outputs the contract requires (added to the node when the interface is declared). */
  requiredStartPins?: InterfacePinSpec[];
  /** On Flow End inputs the contract requires (added to the node when the interface is declared). */
  requiredEndPins?: InterfacePinSpec[];
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
    // Types: what AbstractCode sends (prompt/provider/model at the top level
    // of input_data) and the typed pins of the shipped agent flows.
    requiredStartPins: [
      { id: 'provider', label: 'provider', type: 'provider_text', description: 'LLM provider chosen by the host (empty = gateway default).' },
      { id: 'model', label: 'model', type: 'model', description: 'Model chosen by the host (empty = gateway default).' },
      { id: 'prompt', label: 'prompt', type: 'string', description: 'The user message the host sends to this workflow.' },
    ],
    requiredEndPins: [
      { id: 'response', label: 'response', type: 'string', description: 'The answer shown to the user.' },
      { id: 'success', label: 'success', type: 'boolean', description: 'True when the workflow completed its task.' },
      { id: 'meta', label: 'meta', type: 'object', description: 'Run metadata (provider, model, tool counts, ...).' },
    ],
  },
  {
    id: 'abstractassistant.agent.v1',
    label: 'Assistant orchestrator (v1)',
    description:
      'Executable as the AbstractAssistant orchestrator: the assistant sends provider/model/prompt to On Flow Start and reads response/success/meta from On Flow End (every end branch, chat and media alike).',
    class: 'entrypoint',
    // Types: AbstractAssistant's run input (gateway/run_input.py: prompt, and
    // provider/model when overridden) and its managed orchestrator flow
    // (assistant_workflow.py), whose every On Flow End carries this trio.
    requiredStartPins: [
      { id: 'provider', label: 'provider', type: 'provider_text', description: 'LLM provider chosen by the assistant (empty = gateway default).' },
      { id: 'model', label: 'model', type: 'model', description: 'Model chosen by the assistant (empty = gateway default).' },
      { id: 'prompt', label: 'prompt', type: 'string', description: 'The user message the assistant sends to this workflow.' },
    ],
    requiredEndPins: [
      { id: 'response', label: 'response', type: 'string', description: 'The reply shown to the user.' },
      { id: 'success', label: 'success', type: 'boolean', description: 'True when the workflow completed its task.' },
      { id: 'meta', label: 'meta', type: 'object', description: 'Run metadata (provider, model, ...).' },
    ],
  },
  {
    id: 'abstractcode.goal.v1',
    label: 'Goal loop (v1)',
    description:
      'Runnable goal loop for AbstractCode /goal: works toward a goal cycle by cycle until it is verified done or max_cycles is reached. AbstractCode sends goal, max_cycles, provider/model and an explicit tools list.',
    class: 'entrypoint',
    // Types: AbstractCode TUI run input (tui/src/run_input.rs: goal,
    // max_cycles, provider, model, tools) and goal-agent.json, the flow that
    // implements the contract (both of its On Flow End nodes).
    requiredStartPins: [
      { id: 'goal', label: 'goal', type: 'string', description: 'The goal to reach.' },
      { id: 'max_cycles', label: 'max_cycles', type: 'number', description: 'Upper bound on work cycles.' },
      { id: 'provider', label: 'provider', type: 'provider_text', description: 'LLM provider chosen by the host (empty = gateway default).' },
      { id: 'model', label: 'model', type: 'model', description: 'Model chosen by the host (empty = gateway default).' },
      { id: 'tools', label: 'tools', type: 'array', description: 'Tool names the loop may use.' },
    ],
    requiredEndPins: [
      { id: 'result', label: 'result', type: 'string', description: 'What was achieved.' },
      { id: 'success', label: 'success', type: 'boolean', description: 'True when the goal was verified done.' },
      { id: 'cycles_used', label: 'cycles_used', type: 'number', description: 'Work cycles consumed.' },
      { id: 'stopped_reason', label: 'stopped_reason', type: 'string', description: 'Why the loop stopped.' },
    ],
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
    requiredStartPins: [
      { id: 'request', label: 'request', type: 'string', description: 'What to build or change.' },
    ],
    requiredEndPins: [
      { id: 'report', label: 'report', type: 'string', description: 'Human-readable account of what was done and verified.' },
      { id: 'passed', label: 'passed', type: 'boolean', description: 'True when the verification gates passed.' },
    ],
  },
  {
    id: 'abstractresearch.coscientist.v1',
    label: 'AI co-scientist',
    description:
      'Runnable multi-agent hypothesis engine inspired by the Nature AI co-scientist: supervisor loop over generate/reflect/rank(Elo tournament)/evolve + a final meta-review. Takes a research_goal, returns Elo-ranked hypotheses + a research overview. Simplified vs the paper (synchronous loop, one debate pass/cycle, meta-review runs once, no proximity dedup, grounding opt-in).',
    class: 'entrypoint',
    requiredStartPins: [
      { id: 'research_goal', label: 'research_goal', type: 'string', description: 'The research goal to generate hypotheses for.' },
    ],
    requiredEndPins: [
      { id: 'research_overview', label: 'research_overview', type: 'string', description: 'Research overview written by the final meta-review.' },
      { id: 'ranked_hypotheses', label: 'ranked_hypotheses', type: 'array', description: 'Hypotheses ranked by Elo tournament score.' },
    ],
  },
  {
    id: 'abstractreview.adversarial.v1',
    label: 'Adversarial review (composable)',
    description:
      'Reusable review primitive: three-lens critics (correctness / design / requirements-fit) merged into a severity-ranked pass/revise/block verdict. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: [
      { id: 'artifact', label: 'artifact', type: 'string', description: 'The text or code to review.' },
    ],
    requiredEndPins: [
      { id: 'findings', label: 'findings', type: 'array', description: 'Severity-ranked review findings.' },
      { id: 'verdict', label: 'verdict', type: 'string', description: 'pass, revise or block.' },
    ],
  },
  {
    id: 'abstractextract.structured.v1',
    label: 'Structured extract (composable)',
    description:
      'Reusable extraction primitive: text -> schema-validated JSON with a validate/reprompt correction loop. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: [
      { id: 'source_text', label: 'source_text', type: 'string', description: 'The text to extract from.' },
      { id: 'fields_spec', label: 'fields_spec', type: 'json_schema', description: 'JSON Schema of the fields to extract.' },
    ],
    requiredEndPins: [
      { id: 'data', label: 'data', type: 'object', description: 'The extracted, schema-validated object.' },
      { id: 'valid', label: 'valid', type: 'boolean', description: 'True when the extraction matches the schema.' },
    ],
  },
  {
    id: 'abstractbatch.mapreduce.v1',
    label: 'Map-reduce (composable)',
    description:
      'Reusable batch primitive: map a per-item LLM instruction over an array, then reduce the results with a synthesis instruction. Composable as a subflow or runnable standalone.',
    class: 'contract',
    requiredStartPins: [
      { id: 'items', label: 'items', type: 'array', description: 'The items to process one by one.' },
    ],
    requiredEndPins: [
      { id: 'results', label: 'results', type: 'array', description: 'One result per item, in input order.' },
      { id: 'synthesis', label: 'synthesis', type: 'string', description: 'The reduce step output.' },
    ],
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

/** One-line notice shown when opening a flow adds missing interface pins. */
export const INTERFACE_PINS_ADDED_NOTICE = 'Interface pins were added to On Flow Start/End; save to store them';

/** A required boundary pin together with the interface that requires it. */
export interface InterfaceBoundaryPin extends InterfacePinSpec {
  interfaceId: string;
}

/**
 * Required On Flow Start outputs / On Flow End inputs for a list of declared
 * interfaces. Declaration order, then contract order; when two interfaces
 * require the same pin id the first declaration wins. Unknown ids add nothing.
 */
export function interfaceBoundaryPins(interfaces: unknown): { start: InterfaceBoundaryPin[]; end: InterfaceBoundaryPin[] } {
  const start: InterfaceBoundaryPin[] = [];
  const end: InterfaceBoundaryPin[] = [];
  for (const id of normalizeInterfaces(interfaces)) {
    const known = knownInterface(id);
    if (!known) continue;
    for (const spec of known.requiredStartPins || []) {
      if (!start.some((pin) => pin.id === spec.id)) start.push({ ...spec, interfaceId: id });
    }
    for (const spec of known.requiredEndPins || []) {
      if (!end.some((pin) => pin.id === spec.id)) end.push({ ...spec, interfaceId: id });
    }
  }
  return { start, end };
}

function pinFromSpec(spec: InterfacePinSpec): Pin {
  const pin: Pin = { id: spec.id, label: spec.label, type: spec.type };
  if (spec.description) pin.description = spec.description;
  return pin;
}

/** The pin side an interface fills on a boundary node, or null for any other node. */
function boundarySide(nodeType: unknown): 'outputs' | 'inputs' | null {
  if (nodeType === 'on_flow_start') return 'outputs';
  if (nodeType === 'on_flow_end') return 'inputs';
  return null;
}

/**
 * Required interface pins missing from ONE node's data: On Flow Start is
 * checked against the start contract (outputs), On Flow End against the end
 * contract (inputs). Other node types never miss anything. A pin counts as
 * present when a pin with the same id exists, whatever its type or label.
 */
export function missingInterfacePins(
  data: Pick<FlowNodeData, 'nodeType' | 'inputs' | 'outputs'>,
  pins: { start: InterfaceBoundaryPin[]; end: InterfaceBoundaryPin[] }
): InterfaceBoundaryPin[] {
  const side = boundarySide(data.nodeType);
  if (!side) return [];
  const required = side === 'outputs' ? pins.start : pins.end;
  if (required.length === 0) return [];
  const existing = new Set((Array.isArray(data[side]) ? data[side] : []).map((pin) => pin.id));
  return required.filter((spec) => !existing.has(spec.id));
}

/**
 * Append the missing required pins of the declared interfaces to one node's
 * data. Never removes, retypes or reorders existing pins. Returns the SAME
 * object when nothing is missing.
 */
export function withInterfacePins<D extends FlowNodeData>(
  data: D,
  pins: { start: InterfaceBoundaryPin[]; end: InterfaceBoundaryPin[] }
): D {
  const missing = missingInterfacePins(data, pins);
  if (missing.length === 0) return data;
  const side = boundarySide(data.nodeType) as 'outputs' | 'inputs';
  const current = Array.isArray(data[side]) ? data[side] : [];
  return { ...data, [side]: [...current, ...missing.map(pinFromSpec)] };
}

/**
 * Give every On Flow Start / On Flow End node the pins its declared
 * interfaces require, so the author sees what a host will send in and read
 * back. Pure; returns the SAME array when no node changes (no re-render).
 */
export function applyInterfacePins<N extends { data: FlowNodeData }>(nodes: N[], interfaces: unknown): N[] {
  const pins = interfaceBoundaryPins(interfaces);
  if (pins.start.length === 0 && pins.end.length === 0) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    if (!node || !node.data) return node;
    const data = withInterfacePins(node.data, pins);
    if (data === node.data) return node;
    changed = true;
    return { ...node, data };
  });
  return changed ? next : nodes;
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
