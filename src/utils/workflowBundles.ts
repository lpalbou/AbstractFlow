import {
  capabilityUnavailable,
  endpointFromDescriptor,
  gatewayJson,
  type GatewayContracts,
} from './gatewayClient';

export type WorkflowBundleEntrypoint = {
  flow_id?: string;
  workflow_id?: string;
  name?: string | null;
  description?: string;
  interfaces?: string[];
};

export type WorkflowBundleListItem = {
  bundle_id?: string;
  bundle_version?: string;
  bundle_ref?: string;
  version_channel?: string;
  is_draft?: boolean;
  is_published?: boolean;
  latest_published_version?: string | null;
  latest_any_version?: string | null;
  created_at?: string;
  metadata?: {
    source?: {
      root_flow_id?: string;
      root_flow_name?: string;
      root_flow_updated_at?: string;
    };
    publisher?: {
      published_at?: string;
    };
    lineage?: Record<string, unknown>;
    lifecycle?: Record<string, unknown>;
    [key: string]: unknown;
  };
  entrypoints?: WorkflowBundleEntrypoint[];
};

export type WorkflowBundleListResponse = {
  items?: WorkflowBundleListItem[];
  default_bundle_id?: string | null;
};

export type PublishedBundleTarget = {
  flowId: string;
  bundleId: string;
  bundleVersion: string;
  bundleRef: string;
  createdAt?: string;
};

export function sanitizeBundleId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const replaced = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-');
  return replaced.replace(/^-+/, '').replace(/-+$/, '');
}

export function isDraftBundleVersion(value: unknown): boolean {
  return String(value || '').trim().toLowerCase().startsWith('draft.');
}

function parseSemver(value: unknown): [number, number, number] | null {
  const parts = String(value || '')
    .trim()
    .split('.')
    .map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) return null;
  while (parts.length < 3) parts.push('0');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function compareBundleVersions(a: WorkflowBundleListItem, b: WorkflowBundleListItem): number {
  const aVersion = String(a.bundle_version || '');
  const bVersion = String(b.bundle_version || '');
  const aSemver = parseSemver(aVersion);
  const bSemver = parseSemver(bVersion);
  if (aSemver && bSemver) {
    for (let i = 0; i < 3; i += 1) {
      if (aSemver[i] !== bSemver[i]) return aSemver[i] - bSemver[i];
    }
  } else {
    const byCreated = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (byCreated !== 0) return byCreated;
  }
  return aVersion.localeCompare(bVersion);
}

function bundleMatchesFlow(item: WorkflowBundleListItem, flowId: string): boolean {
  const fid = String(flowId || '').trim();
  if (!fid) return false;
  const sourceFlowId = String(item.metadata?.source?.root_flow_id || '').trim();
  if (sourceFlowId && sourceFlowId === fid) return true;
  return Array.isArray(item.entrypoints) && item.entrypoints.some((ep) => String(ep?.flow_id || '').trim() === fid);
}

export function selectLatestPublishedBundleForFlow(
  items: WorkflowBundleListItem[],
  flowId: string
): PublishedBundleTarget | null {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => bundleMatchesFlow(item, flowId))
    .filter((item) => !item.is_draft && !isDraftBundleVersion(item.bundle_version))
    .filter((item) => String(item.bundle_id || '').trim() && String(item.bundle_version || '').trim());
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aIsLatest = String(a.bundle_version || '').trim() === String(a.latest_published_version || '').trim();
    const bIsLatest = String(b.bundle_version || '').trim() === String(b.latest_published_version || '').trim();
    if (aIsLatest !== bIsLatest) return aIsLatest ? 1 : -1;
    return compareBundleVersions(a, b);
  });
  const selected = candidates[candidates.length - 1];
  const bundleId = String(selected.bundle_id || '').trim();
  const bundleVersion = String(selected.bundle_version || '').trim();
  return {
    flowId: String(flowId || '').trim(),
    bundleId,
    bundleVersion,
    bundleRef: String(selected.bundle_ref || '').trim() || `${bundleId}@${bundleVersion}`,
    createdAt: String(selected.created_at || '').trim() || undefined,
  };
}

export async function resolveLatestPublishedBundleForFlow(
  flowId: string,
  contracts: GatewayContracts | null | undefined
): Promise<PublishedBundleTarget | null> {
  const listDescriptor = contracts?.flow_editor?.bundles?.list;
  if (capabilityUnavailable(listDescriptor)) return null;
  const url = endpointFromDescriptor(
    listDescriptor,
    '/api/gateway/bundles',
    {},
    { all_versions: true, include_drafts: false }
  );
  const payload = await gatewayJson<WorkflowBundleListResponse>(url);
  return selectLatestPublishedBundleForFlow(payload.items || [], flowId);
}
