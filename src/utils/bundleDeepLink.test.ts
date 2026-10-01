import { describe, expect, it } from 'vitest';
import type { VisualFlow } from '../types/flow';
import {
  DEEP_LINK_GONE,
  DEEP_LINK_MISSING_ID,
  deepLinkErrorSentence,
  loadBundleDeepLink,
  parseBundleDeepLink,
  type BundleDeepLinkIO,
  type BundleManifestView,
} from './bundleDeepLink';

function flow(id: string, name = id): VisualFlow {
  return { id, name, nodes: [], edges: [] } as VisualFlow;
}

function httpError(status: number, detail: unknown) {
  return Object.assign(new Error(`HTTP ${status}`), { status, detail });
}

function io(manifest: BundleManifestView, opts: { saved?: VisualFlow[]; calls?: string[] } = {}): BundleDeepLinkIO {
  const calls = opts.calls || [];
  return {
    async getBundle(id, version) {
      calls.push(`bundle ${id}@${version}`);
      return manifest;
    },
    async getBundleFlow(id, flowId, version) {
      calls.push(`flow ${id}@${version}:${flowId}`);
      return flow(flowId, `Flow ${flowId}`);
    },
    async getVisualFlow(id) {
      calls.push(`visualflow ${id}`);
      return (opts.saved || []).find((f) => f.id === id) || null;
    },
  };
}

describe('parseBundleDeepLink', () => {
  it('is null without a bundle parameter (normal editor start)', () => {
    expect(parseBundleDeepLink('')).toBeNull();
    expect(parseBundleDeepLink('?monitor-gpu=1')).toBeNull();
  });

  it('reads bundle, version and flow', () => {
    expect(parseBundleDeepLink('?bundle=basic-agent&version=1.2.0&flow=root')).toEqual({
      bundleId: 'basic-agent',
      version: '1.2.0',
      flowId: 'root',
    });
    expect(parseBundleDeepLink('?bundle=my%20wf')).toEqual({ bundleId: 'my wf', version: '', flowId: '' });
  });

  it('says what is missing when the id is empty', () => {
    expect(parseBundleDeepLink('?bundle=&version=1')).toEqual({ error: DEEP_LINK_MISSING_ID });
  });
});

describe('loadBundleDeepLink', () => {
  const shipped: BundleManifestView = {
    bundle_id: 'basic-agent',
    bundle_version: '0.3.0',
    default_entrypoint: 'root',
    entrypoints: [{ flow_id: 'root', name: 'Basic agent' }],
    metadata: {},
    shipped: true,
  };

  it('opens a shipped bundle as an unsaved copy titled name · id@version', async () => {
    const calls: string[] = [];
    const res = await loadBundleDeepLink({ bundleId: 'basic-agent', version: '0.3.0', flowId: '' }, io(shipped, { calls }));
    expect(res.kind).toBe('copy');
    expect(res.shipped).toBe(true);
    expect(res.flow.id).toBe('');
    expect(res.flow.name).toBe('Basic agent · basic-agent@0.3.0');
    expect(calls).toEqual(['bundle basic-agent@0.3.0', 'flow basic-agent@0.3.0:root']);
  });

  it('opens the user’s own saved root flow when the bundle was published from it', async () => {
    const published: BundleManifestView = {
      bundle_id: 'my-wf',
      bundle_version: '0.0.2',
      default_entrypoint: 'f1',
      entrypoints: [{ flow_id: 'f1', name: 'Mine' }],
      metadata: { source: { root_flow_id: 'f1' } },
      shipped: false,
    };
    const res = await loadBundleDeepLink({ bundleId: 'my-wf', version: '0.0.2', flowId: '' }, io(published, { saved: [flow('f1', 'My flow')] }));
    expect(res).toMatchObject({ kind: 'saved', bundleRef: 'my-wf@0.0.2', shipped: false });
    expect(res.flow.id).toBe('f1');
  });

  it('falls back to a copy when the root flow is not in the user’s flows', async () => {
    const published: BundleManifestView = {
      bundle_id: 'their-wf',
      bundle_version: '1.0.0',
      entrypoints: [{ flow_id: 'f9', name: 'Theirs' }],
      metadata: { source: { root_flow_id: 'f9' } },
    };
    const res = await loadBundleDeepLink({ bundleId: 'their-wf', version: '', flowId: '' }, io(published));
    expect(res.kind).toBe('copy');
    expect(res.flow.name).toBe('Theirs · their-wf@1.0.0');
  });

  it('honours an explicit flow parameter', async () => {
    const calls: string[] = [];
    const multi: BundleManifestView = { ...shipped, entrypoints: [{ flow_id: 'root' }, { flow_id: 'helper', name: 'Helper' }] };
    const res = await loadBundleDeepLink({ bundleId: 'basic-agent', version: '0.3.0', flowId: 'helper' }, io(multi, { calls }));
    expect(res.flow.name).toBe('Helper · basic-agent@0.3.0');
    expect(calls[1]).toBe('flow basic-agent@0.3.0:helper');
  });
});

describe('deepLinkErrorSentence', () => {
  const link = { bundleId: 'x', version: '1.0.0', flowId: '' };
  it('404 = the workflow is gone', () => {
    expect(deepLinkErrorSentence(httpError(404, { detail: 'Bundle not found' }), link)).toBe(DEEP_LINK_GONE);
  });
  it('a refusal shows the gateway sentence', () => {
    const msg = "This workflow isn't available to users on this gateway. Ask an admin.";
    expect(deepLinkErrorSentence(httpError(403, { detail: { reason_code: 'workflow_unavailable', message: msg } }), link)).toBe(msg);
  });
  it('anything else names the workflow and the reason', () => {
    expect(deepLinkErrorSentence(new Error('network down'), link)).toBe('AbstractFlow could not open x@1.0.0: network down');
  });
});
