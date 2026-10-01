/**
 * Open a gateway workflow bundle from a link (gateway DESIGN-v3 §5.4).
 *
 *   /apps/flow/?bundle=<bundle_id>&version=<bundle_version>[&flow=<flow_id>]
 *
 * The gateway console's "Open in AbstractFlow" button lands here. The loader asks
 * the gateway for the bundle (`GET api/gateway/bundles/{id}?bundle_version=`: the
 * manifest plus `shipped` / `owner`) and then decides what the editor shows:
 *
 * - the bundle was published from a flow this user still has
 *   (`metadata.source.root_flow_id` is one of their VisualFlows) and no other
 *   flow was asked for -> open THAT saved flow (Save updates it, as usual);
 * - otherwise -> the bundle's flow (`flow`, else the default entrypoint) as an
 *   UNSAVED editor copy titled "<name> · <bundle_id>@<version>". Save creates the
 *   user's own flow; nothing ever writes back into the bundle (a shipped bundle
 *   cannot be overwritten from the editor).
 *
 * Every failure is a sentence for the user, never a status code.
 */

import type { VisualFlow } from '../types/flow';

export interface BundleDeepLink {
  bundleId: string;
  /** Empty = the gateway's latest published version. */
  version: string;
  /** A flow inside the bundle; empty = the bundle's default entrypoint. */
  flowId: string;
}

export const DEEP_LINK_MISSING_ID = 'This link does not name a workflow: it needs ?bundle=<workflow id>.';
export const DEEP_LINK_GONE = "This workflow isn't on this gateway any more.";
export const SHIPPED_BANNER = 'Shipped workflow — read-only. Save creates your own copy.';

/** `null` when the page was opened without a bundle link (the normal editor start). */
export function parseBundleDeepLink(search: string): BundleDeepLink | { error: string } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return null;
  }
  if (!params.has('bundle')) return null;
  const bundleId = String(params.get('bundle') || '').trim();
  if (!bundleId) return { error: DEEP_LINK_MISSING_ID };
  return {
    bundleId,
    version: String(params.get('version') || '').trim(),
    flowId: String(params.get('flow') || '').trim(),
  };
}

export interface BundleManifestView {
  bundle_id: string;
  bundle_version: string;
  default_entrypoint?: string | null;
  entrypoints?: Array<{ flow_id: string; name?: string | null }>;
  flows?: string[];
  metadata?: Record<string, unknown>;
  shipped?: boolean;
  source?: string;
}

/** What the loader needs from the gateway (Toolbar wires the real client; tests a fake). */
export interface BundleDeepLinkIO {
  getBundle(bundleId: string, version: string): Promise<BundleManifestView>;
  getBundleFlow(bundleId: string, flowId: string, version: string): Promise<VisualFlow>;
  /** The user's own VisualFlow, or `null` when they have none with this id (HTTP 404). */
  getVisualFlow(flowId: string): Promise<VisualFlow | null>;
}

export type BundleDeepLinkResult =
  | { kind: 'saved'; flow: VisualFlow; bundleRef: string; shipped: boolean }
  | { kind: 'copy'; flow: VisualFlow; title: string; bundleRef: string; shipped: boolean };

/** An HTTP-ish error: `status` and, for gateway refusals, `detail.detail.message`. */
function errorStatus(err: unknown): number {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

function gatewayMessage(err: unknown): string {
  const detail = (err as { detail?: unknown } | null)?.detail as Record<string, unknown> | undefined;
  const inner = detail && typeof detail === 'object' ? (detail as { detail?: unknown }).detail : undefined;
  if (inner && typeof inner === 'object' && typeof (inner as { message?: unknown }).message === 'string') {
    return String((inner as { message: string }).message);
  }
  if (typeof inner === 'string' && inner.trim()) return inner.trim();
  return err instanceof Error ? err.message : String(err || '');
}

/** The sentence a failed open shows. 404 = gone; a refusal (403/409) says the gateway's reason. */
export function deepLinkErrorSentence(err: unknown, link: BundleDeepLink): string {
  const status = errorStatus(err);
  if (status === 404) return DEEP_LINK_GONE;
  const ref = link.version ? `${link.bundleId}@${link.version}` : link.bundleId;
  const msg = gatewayMessage(err);
  if (status === 401) return `Sign in to the gateway to open ${ref}.`;
  if (status === 403 || status === 409) return msg || `The gateway refused to open ${ref}.`;
  return `AbstractFlow could not open ${ref}: ${msg || 'the gateway did not answer.'}`;
}

function rootFlowIdOf(manifest: BundleManifestView): string {
  const source = (manifest.metadata || {})['source'];
  const id = source && typeof source === 'object' ? (source as Record<string, unknown>)['root_flow_id'] : undefined;
  return typeof id === 'string' ? id.trim() : '';
}

export async function loadBundleDeepLink(link: BundleDeepLink, io: BundleDeepLinkIO): Promise<BundleDeepLinkResult> {
  const manifest = await io.getBundle(link.bundleId, link.version);
  const version = String(manifest.bundle_version || link.version || '').trim();
  const bundleRef = `${manifest.bundle_id || link.bundleId}@${version}`;
  const shipped = manifest.shipped === true;

  const rootFlowId = rootFlowIdOf(manifest);
  if (rootFlowId && (!link.flowId || link.flowId === rootFlowId)) {
    const saved = await io.getVisualFlow(rootFlowId);
    if (saved) return { kind: 'saved', flow: saved, bundleRef, shipped };
  }

  const entrypoints = Array.isArray(manifest.entrypoints) ? manifest.entrypoints : [];
  const flowId =
    link.flowId ||
    String(manifest.default_entrypoint || '').trim() ||
    String(entrypoints[0]?.flow_id || '').trim();
  if (!flowId) throw new Error(`${bundleRef} has no flow to open.`);
  const flow = await io.getBundleFlow(link.bundleId, flowId, version);
  const entry = entrypoints.find((ep) => ep.flow_id === flowId);
  const name = String(entry?.name || flow.name || flowId).trim();
  const title = `${name} · ${bundleRef}`;
  // An editor COPY: no id, so Save creates the user's own flow.
  return { kind: 'copy', flow: { ...flow, id: '', name: title }, title, bundleRef, shipped };
}
