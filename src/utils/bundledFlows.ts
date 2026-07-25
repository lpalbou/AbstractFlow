import type { VisualFlow } from '../types/flow';
import type { PublishedBundleTarget } from './workflowBundles';

// Bundled read-only catalog: the deep-research family + the framework default
// basic-agent (81795ea9) with its status helper (15f19f7f). basic-agent ships
// as a gateway bundle but was invisible in the library (and in the Runnable
// view) because only the research family was globbed — "it's used everywhere"
// and the library couldn't show it.
// 2026-07-16 operator ruling: the dp- prefix is retired — ids and files are
// deep-* now (deep-research/-plan/-investigate/-review/-render).
const bundledFlowModules = import.meta.glob<VisualFlow>(
  [
    '../../examples/flows/deep-*.json',
    '../../examples/flows/81795ea9.json',
    '../../examples/flows/15f19f7f.json',
    // The five framework workflows (operator ask 2026-07-14): two runnable
    // flagships (coding-agent, co-scientist) + three composable primitives
    // (adversarial-review, structured-extract, map-reduce). coding-verify-gates
    // is coding-agent's gate subflow (composed, listed as a child).
    '../../examples/flows/coding-agent.json',
    '../../examples/flows/coder.json',
    '../../examples/flows/coding-verify-gates.json',
    '../../examples/flows/adversarial-review.json',
    '../../examples/flows/structured-extract.json',
    '../../examples/flows/map-reduce.json',
    '../../examples/flows/co-scientist.json',
    // co-scientist's professional-figure subflow (2026-07-20): without it in
    // the catalog the family renders a dangling "diagram-render (missing)"
    // reference (operator report).
    '../../examples/flows/diagram-render.json',
    // The meta-intelligence family (operator ask 2026-07-16): five
    // co-orchestrated deliberation patterns, each agent.v1-conformant so it
    // benchmarks 1:1 against an isolated LLM call.
    '../../examples/flows/meta-consensus.json',
    '../../examples/flows/meta-debate.json',
    '../../examples/flows/meta-reflect.json',
    '../../examples/flows/meta-perspectives.json',
    '../../examples/flows/meta-deliberate.json',
    // The multi-agent coding pipeline (operator directive 2026-07-23, backlog
    // 0152): scouts -> planner -> gate -> build/verify loop -> doc -> PR ->
    // gate -> merge. Wildcard (the deep-* precedent) so new family members
    // surface at the next build without editing this list — the 2026-07-25
    // invisibility incident was a per-file list lagging the family
    // (entity-tool-rounds/-goodbye existed on disk, absent here) on top of a
    // stale dist.
    '../../examples/flows/multiagent-*.json',
    // The ENTITY BRAIN family (operator directive 2026-07-24, backlog 0153):
    // the master life loop + its cognition subflows, animating the served
    // cognition_graph. entity-life is the master (THE DAY GATE routes each
    // moment to one phase); entity-chat is the agent.v1 chat door; the rest
    // are the named brain processes (composed, listed as children). Same
    // wildcard rationale as multiagent-*.
    '../../examples/flows/entity-*.json',
  ],
  {
    eager: true,
    import: 'default',
  }
);

const bundledRunTargets: Record<string, PublishedBundleTarget> = {
  'deep-research': {
    flowId: 'deep-research',
    // New bundle id (dp- retirement); version lineage continues from
    // deep-research@0.1.5 so ordering reads naturally across the rename.
    bundleId: 'deep-research',
    bundleVersion: '0.1.7',
    bundleRef: 'deep-research@0.1.7',
  },
  '81795ea9': {
    flowId: '81795ea9',
    bundleId: 'basic-agent',
    // 0.0.3 = the stale-model-pin republish (2026-07-21): 0.0.2 pins
    // lmstudio/qwen3-next-80b and fails for default-following clients.
    // 0.0.2 stayed registered on the gateway, so this pin silently kept
    // one-click library runs on the known-bad version until the surfacing
    // check compared pins against the registry (2026-07-25).
    bundleVersion: '0.0.3',
    bundleRef: 'basic-agent@0.0.3',
  },
  'coding-agent': {
    flowId: 'coding-agent',
    bundleId: 'coding-agent',
    // 0.2.0 = deterministic-gates redesign (R-Type post-mortem): delivery +
    // integration gates before the LLM, browser_probe execution gate for web
    // entrypoints (fail-closed), environment-vs-fixable failure split.
    bundleVersion: '0.2.4',
    bundleRef: 'coding-agent@0.2.4',
  },
  coder: {
    flowId: 'coder',
    bundleId: 'coding-agent',
    bundleVersion: '0.2.4',
    bundleRef: 'coding-agent@0.2.4',
  },
  'co-scientist': {
    flowId: 'co-scientist',
    bundleId: 'co-scientist',
    // 0.1.8 = quality wave vs the Nature paper: hardened grounding + citation
    // allowlist, decoration-free generative views, novelty floor + diversity,
    // structured per-hypothesis protocols, Elo-evolution figure + methodology.
    // 0.1.7 = deep-* subflow rename (grounding via deep-plan/deep-investigate).
    bundleVersion: '0.1.16',
    bundleRef: 'co-scientist@0.1.16',
  },
  'diagram-render': {
    flowId: 'diagram-render',
    bundleId: 'diagram-render',
    bundleVersion: '0.2.0',
    bundleRef: 'diagram-render@0.2.0',
  },
  'adversarial-review': {
    flowId: 'adversarial-review',
    bundleId: 'adversarial-review',
    bundleVersion: '0.1.1',
    bundleRef: 'adversarial-review@0.1.1',
  },
  'structured-extract': {
    flowId: 'structured-extract',
    bundleId: 'structured-extract',
    bundleVersion: '0.1.1',
    bundleRef: 'structured-extract@0.1.1',
  },
  'map-reduce': {
    flowId: 'map-reduce',
    bundleId: 'map-reduce',
    bundleVersion: '0.1.1',
    bundleRef: 'map-reduce@0.1.1',
  },
  'meta-consensus': {
    flowId: 'meta-consensus',
    bundleId: 'meta-consensus',
    bundleVersion: '0.1.1',
    bundleRef: 'meta-consensus@0.1.1',
  },
  'meta-debate': {
    flowId: 'meta-debate',
    bundleId: 'meta-debate',
    bundleVersion: '0.1.1',
    bundleRef: 'meta-debate@0.1.1',
  },
  'meta-reflect': {
    flowId: 'meta-reflect',
    bundleId: 'meta-reflect',
    bundleVersion: '0.1.1',
    bundleRef: 'meta-reflect@0.1.1',
  },
  'meta-perspectives': {
    flowId: 'meta-perspectives',
    bundleId: 'meta-perspectives',
    bundleVersion: '0.1.1',
    bundleRef: 'meta-perspectives@0.1.1',
  },
  'meta-deliberate': {
    flowId: 'meta-deliberate',
    bundleId: 'meta-deliberate',
    bundleVersion: '0.1.1',
    bundleRef: 'meta-deliberate@0.1.1',
  },
  'multiagent-coding': {
    flowId: 'multiagent-coding',
    bundleId: 'multiagent-coding',
    // 0.0.2 = dual-interface: coding.v1 strict root (gated) + agent.v1 wrapper
    // 'multiagent-coder' (picker-visible), so agent apps can drive it like
    // basic-agent/coder. 0.0.1 = cycle-3 fix wave (coding.v1, gateway-truth
    // skills, diagnostic-grammar lint, MERGED_OK sentinel, verifier-death
    // fold, gate-2 escalation, post-doc hash guard).
    bundleVersion: '0.0.3',
    bundleRef: 'multiagent-coding@0.0.3',
  },
  'multiagent-coder': {
    flowId: 'multiagent-coder',
    bundleId: 'multiagent-coding',
    bundleVersion: '0.0.3',
    bundleRef: 'multiagent-coding@0.0.3',
  },
};

export interface FlowCatalog {
  flows: VisualFlow[];
  bundledFlowIds: string[];
  bundledRunTargetIds: string[];
}

function isVisualFlow(value: unknown): value is VisualFlow {
  if (!value || typeof value !== 'object') return false;
  const flow = value as Partial<VisualFlow>;
  return (
    typeof flow.id === 'string' &&
    flow.id.trim().length > 0 &&
    typeof flow.name === 'string' &&
    Array.isArray(flow.nodes) &&
    Array.isArray(flow.edges)
  );
}

function cloneFlow(flow: VisualFlow): VisualFlow {
  const clone = globalThis.structuredClone as ((value: VisualFlow) => VisualFlow) | undefined;
  if (clone) return clone(flow);
  return JSON.parse(JSON.stringify(flow)) as VisualFlow;
}

export function listBundledFlows(): VisualFlow[] {
  return Object.values(bundledFlowModules)
    .filter(isVisualFlow)
    .map(cloneFlow)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getBundledRunTarget(flowId: string | null | undefined): PublishedBundleTarget | null {
  const fid = String(flowId || '').trim();
  const target = fid ? bundledRunTargets[fid] : null;
  return target ? { ...target } : null;
}

export function mergeFlowCatalogs(savedFlows: VisualFlow[] | undefined, bundledFlows = listBundledFlows()): FlowCatalog {
  const saved = Array.isArray(savedFlows) ? savedFlows.filter(isVisualFlow) : [];
  const bundled = Array.isArray(bundledFlows) ? bundledFlows.filter(isVisualFlow) : [];
  const savedIds = new Set(saved.map((flow) => flow.id));
  const flowsById = new Map<string, VisualFlow>();

  for (const flow of bundled) {
    flowsById.set(flow.id, cloneFlow(flow));
  }
  for (const flow of saved) {
    flowsById.set(flow.id, cloneFlow(flow));
  }

  return {
    flows: Array.from(flowsById.values()),
    bundledFlowIds: bundled.filter((flow) => !savedIds.has(flow.id)).map((flow) => flow.id),
    bundledRunTargetIds: bundled
      .filter((flow) => !savedIds.has(flow.id) && Boolean(getBundledRunTarget(flow.id)))
      .map((flow) => flow.id),
  };
}
