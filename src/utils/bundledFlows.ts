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
    // The two HAND-WIRED LOOP coders (operator directive 2026-07-31): a ReAct
    // loop and a Ralph loop built from llm_call + tool_calls with NO agent
    // node, so the loop itself is on the canvas and benchmarks against the
    // multiagent pipeline. Same wildcard rationale as multiagent-*.
    '../../examples/flows/react-*.json',
    '../../examples/flows/ralph-*.json',
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
    // 0.0.4 = 2026-08-01: the status helper subflow gained its missing
    // On Flow End — 0.0.3 runs never terminated (the child run could not
    // reach a terminal state, so the parent waited on it forever).
    bundleVersion: '0.0.4',
    bundleRef: 'basic-agent@0.0.4',
  },
  'coding-agent': {
    flowId: 'coding-agent',
    bundleId: 'coding-agent',
    // 0.2.0 = deterministic-gates redesign (R-Type post-mortem): delivery +
    // integration gates before the LLM, browser_probe execution gate for web
    // entrypoints (fail-closed), environment-vs-fixable failure split.
    // 0.2.5 = the interactive bar (2026-07-31): every round drains
    // `_runtime.inbox` (inject_guidance / Runtime.steer) into the builder
    // prompt behind a run-owned watermark, and emits a "coding round N of M"
    // progress line — the same steering + progress contract the new
    // react-coder / ralph-coder loops ship with.
    // 0.2.8 = ADR-0026 (2026-09-28): whole failure text to the fixer, no
    // verifier output cap. The version the gateway ships (0.2.6 before it;
    // this pin still named 0.2.5, which a fresh install does not have).
    bundleVersion: '0.2.8',
    bundleRef: 'coding-agent@0.2.8',
  },
  coder: {
    flowId: 'coder',
    bundleId: 'coding-agent',
    bundleVersion: '0.2.8',
    bundleRef: 'coding-agent@0.2.8',
  },
  'co-scientist': {
    flowId: 'co-scientist',
    bundleId: 'co-scientist',
    // 0.2.0 = the doctrine rework: four state blobs dissolved into flat run
    // vars (set_vars writes, get_var chips read), every code node on the exec
    // lane, 133 prompt/report sentences moved into editable pin defaults with
    // {{slots}}, five subflow calls converted to per-field pins, eight legacy
    // `get` nodes removed, two pin expressions for the real derivations.
    // NO OUTPUT CHANGED: scripts/coscientist_smoke.py replays 63 golden cases
    // captured from 0.1.16 and fails on one byte of drift.
    // 0.1.16 = TOTAL citation-verification coverage (every fetched ledger URL
    // re-fetched and title-checked; failures barred from citation).
    // 0.1.8 = quality wave vs the Nature paper: hardened grounding + citation
    // allowlist, decoration-free generative views, novelty floor + diversity,
    // structured per-hypothesis protocols, Elo-evolution figure + methodology.
    // 0.2.1 = ADR-0026 (2026-09-28): no count/char caps on what a model reads
    // (feedback, open questions, meta-review, figure prompt, citation titles).
    bundleVersion: '0.2.1',
    bundleRef: 'co-scientist@0.2.1',
  },
  'diagram-render': {
    flowId: 'diagram-render',
    bundleId: 'diagram-render',
    // 0.2.1 = ADR-0026: #FALLBACK warnings carry the whole error.
    bundleVersion: '0.2.1',
    bundleRef: 'diagram-render@0.2.1',
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
    // 0.1.2 = ADR-0026: the reducer reads every per-item result whole.
    bundleVersion: '0.1.2',
    bundleRef: 'map-reduce@0.1.2',
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
  'multiagent-coder': {
    flowId: 'multiagent-coder',
    bundleId: 'multiagent-coding',
    // 0.0.16 = PINS, NOT BLOBS: every subflow node in the family DECLARES the
    // child's on_flow_start fields as its own input pins, so a call's contract
    // is wired on the canvas instead of assembled off it. The wrapper's
    // `map_input` code node and the root's `make_object "Build JSON"` are both
    // deleted (their coercions were already the child door's job), leaving the
    // wrapper as pure wiring: start -> build -> compose answer -> end. Builds
    // on 0.0.15 (state blob removal: flat, top-level, typed run vars; writes
    // are `set_vars`, reads are one `get_var` chip per variable) and 0.0.14
    // (no ACCESS expression anywhere in the family; every prompt/report/
    // advisory in an editable pin default). Sole library run target.
    bundleVersion: '0.0.16',
    bundleRef: 'multiagent-coding@0.0.16',
  },
  // The two hand-wired loop coders (2026-07-31). Only the agent.v1 WRAPPERS
  // are run targets: the coding.v1 roots and ralph's per-cycle session are
  // composed members (see BUNDLED_COMPOSED_ONLY_IDS), same shape as
  // multiagent-coder / multiagent-coding.
  'react-coder': {
    flowId: 'react-coder',
    bundleId: 'react-coding',
    // 0.1.1 = the LATE STEER DRAIN (found on live gateway run 97d61a88's
    // class): the inbox is drained again after the model claims it is done,
    // and a steer that landed while it was answering re-opens the loop for
    // one more cycle instead of being dropped silently.
    // 0.1.2 = ADR-0026 labeling: the progress-line preview says it is cut.
    bundleVersion: '0.1.2',
    bundleRef: 'react-coding@0.1.2',
  },
  'ralph-coder': {
    flowId: 'ralph-coder',
    bundleId: 'ralph-coding',
    // 0.1.1 = the LATE STEER DRAIN (found on live gateway run 07989c5d: the
    // deterministic check passed on cycle 1 and the in-flight steer was never
    // applied). Fresh steering now RE-OPENS a completion.
    // 0.2.0 = warm start + two-green early stop (this pin had stayed 0.1.1).
    // 0.2.1 = ADR-0026: the warm-start progress tail is the newest whole
    // entries up to the 50k-token history window; no step-trace default bound.
    bundleVersion: '0.2.1',
    bundleRef: 'ralph-coding@0.2.1',
  },
};

/**
 * Bundled flows that are composed members only — fold under their library
 * referencer even when they declare interfaces (multiagent-coding carries
 * abstractcode.coding.v1 but only multiagent-coder is the operator-facing row).
 */
export const BUNDLED_COMPOSED_ONLY_IDS: ReadonlySet<string> = new Set([
  'multiagent-coding',
  'multiagent-verify-gates',
  'react-coding',
  'ralph-coding',
  'ralph-cycle',
]);

/** Names produced by Toolbar/Rename family duplicate — used by cleanup script classification only. */
export function isLibraryDuplicateCopy(flow: Pick<VisualFlow, 'name'>): boolean {
  const name = String(flow.name || '').trim();
  return /\s\(copy\)(?:\s*\(copy\))*$/i.test(name);
}

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

/**
 * One bundled flow by id, or null. Consumers that resolve a flow by id
 * (subflow pin sync) must check here BEFORE fetching from the gateway:
 * bundled-only flows (multiagent-verify-gates, the entity family) are not in
 * gateway visualflow storage and used to 404 on every canvas render.
 */
export function getBundledFlow(flowId: string | null | undefined): VisualFlow | null {
  const fid = String(flowId || '').trim();
  if (!fid) return null;
  const found = Object.values(bundledFlowModules).filter(isVisualFlow).find((f) => f.id === fid);
  return found ? cloneFlow(found) : null;
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
