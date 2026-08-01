/**
 * Which tool allowlist a node's `tools` pin is ACTUALLY configured with.
 *
 * Two stores can hold a tool allowlist and they are not interchangeable:
 *
 *   - `data.pinDefaults.tools` — the pin's default value, what the flow JSON
 *     carries for pin-default-authored nodes (every agent in the multiagent
 *     bundle, and every subflow with a `tools` pin);
 *   - `data.agentConfig.tools` / `data.effectConfig.tools` — the older
 *     node-config store.
 *
 * The RUNTIME resolves the pin first: the compiler's agent handler takes
 * `tools` from the resolved pin whenever the pin has a value (pin defaults
 * resolve into it) and only falls back to the node config otherwise — an
 * explicit `[]` on the pin disables tools rather than falling back. The editor
 * must read in that same order, or the node's rendered face contradicts what
 * the agent will be allowed to call.
 *
 * (Operator, 2026-07-30, on a DOCUMENTER node whose JSON carried five tools:
 * the pin rendered the bare "Select…" placeholder because the control read
 * `agentConfig.tools` alone.)
 */

export type ToolsPinKind = 'agent' | 'llm' | 'tools_allowlist' | 'subflow';

export type ToolsPinNodeData = {
  agentConfig?: { tools?: unknown } | null;
  effectConfig?: { tools?: unknown } | null;
  pinDefaults?: Record<string, unknown> | null;
  literalValue?: unknown;
};

/**
 * The raw allowlist the runtime would honour, or `undefined` when the node
 * carries no allowlist at all. `[]` is a VALUE (an empty allowlist), never a
 * synonym for "unset".
 */
export function resolveToolsPinSource(
  kind: ToolsPinKind,
  data: ToolsPinNodeData
): unknown[] | undefined {
  const pinDefault = data.pinDefaults?.tools;
  const pick = (...candidates: unknown[]): unknown[] | undefined => {
    for (const c of candidates) if (Array.isArray(c)) return c;
    return undefined;
  };

  switch (kind) {
    // pin default WINS — same precedence the compiler applies
    case 'agent':
      return pick(pinDefault, data.agentConfig?.tools);
    case 'llm':
      return pick(pinDefault, data.effectConfig?.tools);
    case 'tools_allowlist':
      return pick(data.literalValue);
    case 'subflow':
      return pick(pinDefault);
    default:
      return undefined;
  }
}

/** The allowlist as clean, de-duplicated tool names (blank entries dropped). */
export function resolveConfiguredTools(kind: ToolsPinKind, data: ToolsPinNodeData): string[] {
  const raw = resolveToolsPinSource(kind, data);
  if (!raw) return [];
  const cleaned = raw
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim());
  return Array.from(new Set(cleaned));
}

/**
 * True when the node is configured with an allowlist that is deliberately
 * EMPTY (the planner's "no tools" posture) — as opposed to having no allowlist
 * configured at all. The two must never render alike: an author who reads
 * "Select…" on a deliberately tool-less agent will re-pick tools the flow
 * withheld on purpose.
 */
export function isToolsAllowlistExplicitlyEmpty(
  kind: ToolsPinKind,
  data: ToolsPinNodeData
): boolean {
  const raw = resolveToolsPinSource(kind, data);
  return Array.isArray(raw) && raw.length === 0;
}

/** Trigger text for an unfilled tools control, distinguishing empty from unset. */
export function toolsPinPlaceholder(
  kind: ToolsPinKind,
  data: ToolsPinNodeData,
  opts: { loading?: boolean } = {}
): string {
  if (opts.loading) return 'Loading…';
  return isToolsAllowlistExplicitlyEmpty(kind, data) ? 'No tools' : 'Select…';
}

/**
 * Where an author's tool pick must be WRITTEN so the runtime honours it.
 * Once a node carries a `tools` pin default, that value wins at execution
 * time, so writing the pick to `agentConfig` would leave the canvas showing
 * one allowlist while the agent runs another.
 */
export function toolsWriteTarget(
  kind: ToolsPinKind,
  data: ToolsPinNodeData
): 'pinDefaults' | 'nodeConfig' {
  if (kind === 'agent' || kind === 'llm') {
    return Array.isArray(data.pinDefaults?.tools) ? 'pinDefaults' : 'nodeConfig';
  }
  return kind === 'subflow' ? 'pinDefaults' : 'nodeConfig';
}
