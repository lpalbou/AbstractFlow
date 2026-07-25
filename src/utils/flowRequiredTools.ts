import type { VisualFlow, VisualNode } from '../types/flow';

/**
 * Flattened required-tools analysis for the tool-tiers grant surface
 * (operator order dm#49/dm#221; tool-tiers design plans/tool-tiers.md items
 * B + G). Given a flow, compute the set of tool "powers" the flow's nodes
 * REQUIRE across the whole graph — INCLUDING subflows and the deterministic
 * purpose-built tool_invoke nodes (camera family) — so the Run modal can show
 * the runner a truthful "this flow needs: [...]" declaration BEFORE start
 * (Laurent's "a user must KNOW what powers they grant").
 *
 * Design contract (flow cycle-2/3, plans/tool-tiers.md):
 * - This computes REQUIRED TOOL NAMES only. It does NOT assign risk tiers —
 *   the risk_tier of each name is a SERVED fact (core's versioned fact->tier
 *   fold, gateway discovery). Flow renders the served tier badge over these
 *   names; it never fabricates risk (the boundary-vs-risk separation the room
 *   converged on). So this util is deliberately tier-agnostic and has ZERO
 *   dependency on the served facts landing — it ships today.
 * - "Statically closed" is the honesty flag: when a tool allowlist pin is
 *   CONNECTED (fed by a variable/upstream, not a literal default) or a subflow
 *   reference cannot be resolved, the true required set is a SUPERSET of what
 *   we can see. The declaration must then read "AT LEAST these" and the
 *   runtime gate-1 grant wall (ruled c4440/c4451: a verb above the grant is
 *   absent from the granted registry and fails loudly) is the real backstop.
 *
 * Enforcement lives in the runtime/gateway grant wall, never here. This is a
 * DISCLOSURE computation: what to show the runner, not what to allow.
 */

/**
 * The fixed verb each deterministic camera node bakes into its tool_invoke
 * effect. MIRRORS abstractruntime `CAMERA_TOOL_INVOKE_VERBS`
 * (visualflow_compiler/visual/executor.py) — the runtime map is the source of
 * truth; this copy exists only so the flow editor can name required powers
 * without a runtime round-trip. Keep in sync when the camera node family grows
 * (the diary_type-clamp drift class: two copies, no shared source).
 */
export const PURPOSE_BUILT_NODE_VERBS: Readonly<Record<string, string>> = {
  camera_open: 'camera_open',
  camera_capture_photo: 'camera_capture_photo',
  camera_capture_video: 'camera_capture_video',
  camera_analyze_media: 'analyze_media',
  camera_close: 'camera_close',
};

/** Node types whose tool allowlist declares required tool names. */
const ALLOWLIST_NODE_TYPES = new Set(['agent', 'tool_calls', 'call_tool', 'llm_call']);

export interface RequiredToolsResult {
  /** Sorted, de-duplicated tool names the flow requires across the flat graph. */
  tools: string[];
  /**
   * True when every required tool could be resolved statically. False when a
   * connected allowlist pin or an unresolved subflow means the real set is a
   * superset ("AT LEAST these"). The Run-modal declaration reads this flag.
   */
  staticallyClosed: boolean;
  /** Human-readable reasons the set is not statically closed (empty when closed). */
  openReasons: string[];
}

/** Read a node's stored tool allowlist, or null when the pin is connected/absent. */
function allowlistFor(node: VisualNode): { names: string[] | null; connected: boolean } {
  const data = node.data as
    | { agentConfig?: { tools?: unknown }; effectConfig?: { allowed_tools?: unknown; tools?: unknown }; pinDefaults?: Record<string, unknown> }
    | undefined;
  if (!data) return { names: null, connected: false };

  // Precedence mirrors the compiler: an explicit config/pinDefault list is the
  // authored allowlist; a connected pin (no literal) means "resolved at
  // runtime" and we cannot know the names.
  const candidates: unknown[] = [
    data.agentConfig?.tools,
    data.effectConfig?.allowed_tools,
    data.effectConfig?.tools,
    data.pinDefaults?.tools,
    data.pinDefaults?.allowed_tools,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const names = c.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
      return { names, connected: false };
    }
  }
  return { names: null, connected: false };
}

/**
 * Compute the flattened required tool names for `rootId`.
 *
 * @param rootId    the flow to analyze.
 * @param flowsById resolver for subflow references (bundled + stored flows the
 *                  editor knows). A subflow ref absent from the map marks the
 *                  result not-statically-closed (its powers are unknown).
 */
export function computeRequiredTools(rootId: string, flowsById: Map<string, VisualFlow>): RequiredToolsResult {
  const tools = new Set<string>();
  const openReasons: string[] = [];
  let closed = true;

  const visited = new Set<string>();
  const stack: string[] = [rootId];

  while (stack.length) {
    const flowId = stack.pop() as string;
    if (visited.has(flowId)) continue; // cycle / diamond guard
    visited.add(flowId);

    const flow = flowsById.get(flowId);
    if (!flow) {
      // The root missing is a caller error; a missing SUBFLOW is an honest
      // open edge (we can't see its powers).
      if (flowId !== rootId) {
        closed = false;
        openReasons.push(`subflow '${flowId}' could not be resolved — its required powers are unknown`);
      }
      continue;
    }

    for (const node of flow.nodes || []) {
      const data = node.data as { nodeType?: string; subflowId?: unknown; label?: string } | undefined;
      const nodeType = data?.nodeType || (node as { type?: string }).type || '';

      // Deterministic purpose-built nodes: the baked verb IS the required power.
      const bakedVerb = PURPOSE_BUILT_NODE_VERBS[nodeType];
      if (bakedVerb) {
        tools.add(bakedVerb);
        continue;
      }

      // Allowlist-bearing nodes (agent / tool_calls / call_tool / llm_call).
      if (ALLOWLIST_NODE_TYPES.has(nodeType)) {
        const { names } = allowlistFor(node);
        if (names === null) {
          // No literal allowlist authored. For an agent with no allowlist the
          // runtime grants the full default tool set — a genuine open edge the
          // runner must be told about, not a silent "no tools".
          closed = false;
          openReasons.push(
            `${nodeType} node '${data?.label || node.id}' has no explicit tool allowlist — it may use any granted tool`
          );
        } else {
          for (const n of names) tools.add(n);
        }
        continue;
      }

      // Subflow reference: recurse into its graph.
      if (nodeType === 'subflow') {
        const target = typeof data?.subflowId === 'string' ? data.subflowId.trim() : '';
        if (target) stack.push(target);
        else {
          closed = false;
          openReasons.push(`subflow node '${data?.label || node.id}' has no target — its powers are unknown`);
        }
      }
    }
  }

  return {
    tools: Array.from(tools).sort(),
    staticallyClosed: closed,
    openReasons,
  };
}
