import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AfSwitch } from '@abstractframework/ui-kit';
import {
  capabilityUnavailable,
  endpointFromDescriptor,
  gatewayJson,
  getGatewayFlowEditorReadiness,
  jsonRequest,
  type GatewayContracts,
} from '../utils/gatewayClient';
import { sanitizeBundleId } from '../utils/workflowBundles';

type PublishFlowRequest = {
  bundle_id?: string;
  bundle_version?: string;
  reload_gateway?: boolean;
};

export type PublishFlowResponse = {
  ok: boolean;
  bundle_id: string;
  bundle_version: string;
  bundle_ref: string;
  bundle_path: string;
  gateway_reloaded?: boolean;
  gateway_reload_error?: string | null;
};

export async function publishFlow(
  flowId: string,
  payload: PublishFlowRequest,
  contracts: GatewayContracts | null | undefined
): Promise<PublishFlowResponse> {
  const readiness = getGatewayFlowEditorReadiness(contracts);
  if (!readiness.operations.publish.ready) {
    throw new Error(readiness.operations.publish.reason || 'Gateway cannot publish VisualFlows');
  }
  const publish = contracts?.flow_editor?.visualflows?.publish;
  if (capabilityUnavailable(publish)) {
    const hint = typeof publish?.install_hint === 'string' ? publish.install_hint : '';
    throw new Error(hint || 'Gateway cannot publish VisualFlows');
  }
  const url = endpointFromDescriptor(publish, 'api/gateway/visualflows/{flow_id}/publish', { flow_id: flowId });
  return gatewayJson<PublishFlowResponse>(url, jsonRequest(payload, { method: 'POST' }));
}

export function PublishFlowModal({
  isOpen,
  flowId,
  flowName,
  gatewayContracts,
  onClose,
  onPublished,
}: {
  isOpen: boolean;
  flowId: string | null;
  flowName: string;
  gatewayContracts?: GatewayContracts | null;
  onClose: () => void;
  onPublished?: (result: PublishFlowResponse) => void;
}) {
  const defaultBundleId = useMemo(() => sanitizeBundleId(flowName), [flowName]);
  const [bundleId, setBundleId] = useState(defaultBundleId);
  const [bundleVersion, setBundleVersion] = useState('');
  const [reloadGateway, setReloadGateway] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<PublishFlowResponse | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBundleId(defaultBundleId);
    setBundleVersion('');
    setReloadGateway(true);
    setIsSubmitting(false);
    setResult(null);
  }, [defaultBundleId, isOpen]);

  if (!isOpen) return null;

  const canSubmit = Boolean(flowId) && !isSubmitting;
  const name = flowName.trim() || 'This flow';

  const submit = async () => {
    if (!flowId) return;
    setIsSubmitting(true);
    try {
      const payload: PublishFlowRequest = {};
      const bid = sanitizeBundleId(bundleId);
      if (bid) payload.bundle_id = bid;
      const bver = (bundleVersion || '').trim();
      if (bver) payload.bundle_version = bver;
      payload.reload_gateway = Boolean(reloadGateway);
      const res = await publishFlow(flowId, payload, gatewayContracts);
      setResult(res);
      onPublished?.(res);
      if (payload.reload_gateway && !res.gateway_reloaded) {
        toast.error('It was saved, but the gateway did not load it yet: try again in a moment.');
      }
    } catch (e) {
      toast.error(`It could not be made available: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal publish-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <h3 id="publish-title">Make it available</h3>
        {result ? (
          <p className="automation-on-sentence" role="status">
            {availableSentence(name)}
          </p>
        ) : (
          <p className="automation-intro">
            Makes the saved {name} available to Observer and the Assistant, so people and automations can run it. Each time keeps the earlier ones.
          </p>
        )}

        <details className="automation-more publish-details">
          <summary>Details</summary>
          <div className="automation-more-body">
            <div className="run-form-field automation-field">
              <label className="run-form-label" htmlFor="publish-bundle-id">
                Name in the gateway
              </label>
              <input
                id="publish-bundle-id"
                className="run-form-input"
                type="text"
                value={bundleId}
                onChange={(e) => setBundleId(e.target.value)}
                placeholder={defaultBundleId || 'my-agent'}
                disabled={isSubmitting}
              />
              <span className="property-hint">Stays the same from one time to the next; the flow’s name by default.</span>
            </div>
            <div className="run-form-field automation-field">
              <label className="run-form-label" htmlFor="publish-bundle-version">
                Version <span className="new-flow-optional">optional</span>
              </label>
              <input
                id="publish-bundle-version"
                className="run-form-input"
                type="text"
                value={bundleVersion}
                onChange={(e) => setBundleVersion(e.target.value)}
                placeholder="Next version (recommended)"
                disabled={isSubmitting}
              />
            </div>
            <AfSwitch
              variant="row"
              label="Load it into the gateway now"
              description="Off: it is stored and loaded at the gateway's next start."
              action="reload-gateway"
              checked={reloadGateway}
              busy={isSubmitting}
              onChange={setReloadGateway}
            />
            {result ? (
              <div className="property-hint">
                {result.bundle_ref} · {result.bundle_path}
              </div>
            ) : null}
          </div>
        </details>

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose} disabled={isSubmitting}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {result ? null : (
            <button className="modal-button primary" disabled={!canSubmit} onClick={() => void submit()}>
              {isSubmitting ? 'Making it available…' : 'Make it available'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Release digest is ready for Observer and the Assistant." */
export function availableSentence(name: string): string {
  return `${name} is ready for Observer and the Assistant.`;
}
