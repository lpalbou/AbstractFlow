import type { VisualFlow } from '../types/flow';
import type { PublishedBundleTarget } from './workflowBundles';

const bundledFlowModules = import.meta.glob<VisualFlow>('../../examples/flows/dp-*.json', {
  eager: true,
  import: 'default',
});

const bundledRunTargets: Record<string, PublishedBundleTarget> = {
  'dp-research': {
    flowId: 'dp-research',
    bundleId: 'dp-research',
    bundleVersion: '0.1.0',
    bundleRef: 'dp-research@0.1.0',
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
