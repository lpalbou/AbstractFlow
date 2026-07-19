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
    // The meta-intelligence family (operator ask 2026-07-16): five
    // co-orchestrated deliberation patterns, each agent.v1-conformant so it
    // benchmarks 1:1 against an isolated LLM call.
    '../../examples/flows/meta-consensus.json',
    '../../examples/flows/meta-debate.json',
    '../../examples/flows/meta-reflect.json',
    '../../examples/flows/meta-perspectives.json',
    '../../examples/flows/meta-deliberate.json',
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
    bundleVersion: '0.1.6',
    bundleRef: 'deep-research@0.1.6',
  },
  '81795ea9': {
    flowId: '81795ea9',
    bundleId: 'basic-agent',
    bundleVersion: '0.0.1',
    bundleRef: 'basic-agent@0.0.1',
  },
  'coding-agent': {
    flowId: 'coding-agent',
    bundleId: 'coding-agent',
    // 0.2.0 = deterministic-gates redesign (R-Type post-mortem): delivery +
    // integration gates before the LLM, browser_probe execution gate for web
    // entrypoints (fail-closed), environment-vs-fixable failure split.
    bundleVersion: '0.2.0',
    bundleRef: 'coding-agent@0.2.0',
  },
  coder: {
    flowId: 'coder',
    bundleId: 'coding-agent',
    bundleVersion: '0.2.0',
    bundleRef: 'coding-agent@0.2.0',
  },
  'co-scientist': {
    flowId: 'co-scientist',
    bundleId: 'co-scientist',
    // 0.1.7 = deep-* subflow rename (grounding via deep-plan/deep-investigate).
    bundleVersion: '0.1.7',
    bundleRef: 'co-scientist@0.1.7',
  },
  'adversarial-review': {
    flowId: 'adversarial-review',
    bundleId: 'adversarial-review',
    bundleVersion: '0.1.0',
    bundleRef: 'adversarial-review@0.1.0',
  },
  'structured-extract': {
    flowId: 'structured-extract',
    bundleId: 'structured-extract',
    bundleVersion: '0.1.0',
    bundleRef: 'structured-extract@0.1.0',
  },
  'map-reduce': {
    flowId: 'map-reduce',
    bundleId: 'map-reduce',
    bundleVersion: '0.1.0',
    bundleRef: 'map-reduce@0.1.0',
  },
  'meta-consensus': {
    flowId: 'meta-consensus',
    bundleId: 'meta-consensus',
    bundleVersion: '0.1.0',
    bundleRef: 'meta-consensus@0.1.0',
  },
  'meta-debate': {
    flowId: 'meta-debate',
    bundleId: 'meta-debate',
    bundleVersion: '0.1.0',
    bundleRef: 'meta-debate@0.1.0',
  },
  'meta-reflect': {
    flowId: 'meta-reflect',
    bundleId: 'meta-reflect',
    bundleVersion: '0.1.0',
    bundleRef: 'meta-reflect@0.1.0',
  },
  'meta-perspectives': {
    flowId: 'meta-perspectives',
    bundleId: 'meta-perspectives',
    bundleVersion: '0.1.0',
    bundleRef: 'meta-perspectives@0.1.0',
  },
  'meta-deliberate': {
    flowId: 'meta-deliberate',
    bundleId: 'meta-deliberate',
    bundleVersion: '0.1.0',
    bundleRef: 'meta-deliberate@0.1.0',
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
