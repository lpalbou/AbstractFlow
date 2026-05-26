export const ABSTRACTFLOW_DRAFT_SOURCE = 'abstractflow.editor';
export const ABSTRACTFLOW_DRAFT_PURPOSE = 'draft_test';
export const ABSTRACTFLOW_DRAFT_VISIBILITY = 'private';
export const ABSTRACTFLOW_DRAFT_RETENTION_MODE = 'ephemeral';
export const ABSTRACTFLOW_PUBLISHED_PURPOSE = 'published_run';
export const ABSTRACTFLOW_PUBLISHED_VISIBILITY = 'normal';
export const ABSTRACTFLOW_PUBLISHED_RETENTION_MODE = 'durable';

export type AbstractFlowRunLifecycle = {
  source: string;
  purpose: string;
  visibility: string;
  retention: {
    mode: string;
  };
  editor_session_id?: string;
  flow_id?: string;
  bundle_id?: string;
  bundle_version?: string;
  bundle_ref?: string;
};

export function sanitizeDraftVersionPart(value: string | null | undefined): string {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'session';
}

export function draftBundleVersion(editorSessionId: string | null | undefined): string {
  return `draft.${sanitizeDraftVersionPart(editorSessionId).slice(0, 48)}`;
}

export function buildDraftRunMetadata(args: {
  editorSessionId?: string | null;
  flowId?: string | null;
  bundleVersion?: string | null;
} = {}): AbstractFlowRunLifecycle {
  const bundleVersion = String(args.bundleVersion || '').trim();
  const out: AbstractFlowRunLifecycle = {
    source: ABSTRACTFLOW_DRAFT_SOURCE,
    purpose: ABSTRACTFLOW_DRAFT_PURPOSE,
    visibility: ABSTRACTFLOW_DRAFT_VISIBILITY,
    retention: {
      mode: ABSTRACTFLOW_DRAFT_RETENTION_MODE,
    },
  };
  const editorSessionId = String(args.editorSessionId || '').trim();
  if (editorSessionId) out.editor_session_id = editorSessionId;
  const flowId = String(args.flowId || '').trim();
  if (flowId) out.flow_id = flowId;
  if (bundleVersion) out.bundle_version = bundleVersion;
  return out;
}

export function buildPublishedRunMetadata(args: {
  flowId?: string | null;
  bundleId: string;
  bundleVersion: string;
  bundleRef?: string | null;
}): AbstractFlowRunLifecycle {
  const bundleId = String(args.bundleId || '').trim();
  const bundleVersion = String(args.bundleVersion || '').trim();
  const bundleRef = String(args.bundleRef || '').trim();
  const out: AbstractFlowRunLifecycle = {
    source: ABSTRACTFLOW_DRAFT_SOURCE,
    purpose: ABSTRACTFLOW_PUBLISHED_PURPOSE,
    visibility: ABSTRACTFLOW_PUBLISHED_VISIBILITY,
    retention: {
      mode: ABSTRACTFLOW_PUBLISHED_RETENTION_MODE,
    },
  };
  const flowId = String(args.flowId || '').trim();
  if (flowId) out.flow_id = flowId;
  if (bundleId) out.bundle_id = bundleId;
  if (bundleVersion) out.bundle_version = bundleVersion;
  if (bundleRef) out.bundle_ref = bundleRef;
  return out;
}
