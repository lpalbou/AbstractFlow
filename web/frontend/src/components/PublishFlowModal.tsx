import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

function sanitizeBundleId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const replaced = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-');
  return replaced.replace(/^-+/, '').replace(/-+$/, '');
}

type PublishFlowRequest = {
  bundle_id?: string;
  bundle_version?: string;
  reload_gateway?: boolean;
};

type PublishFlowResponse = {
  ok: boolean;
  bundle_id: string;
  bundle_version: string;
  bundle_ref: string;
  bundle_path: string;
  gateway_reloaded?: boolean;
  gateway_reload_error?: string | null;
};

async function publishFlow(flowId: string, payload: PublishFlowRequest): Promise<PublishFlowResponse> {
  const response = await fetch(`/api/flows/${flowId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

export function PublishFlowModal({
  isOpen,
  flowId,
  flowName,
  onClose,
}: {
  isOpen: boolean;
  flowId: string | null;
  flowName: string;
  onClose: () => void;
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

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Publish WorkflowBundle</h3>
        <p>
          Creates a new <code>.flow</code> bundle version (history preserved). By default, this publishes into the
          gateway bundles directory and triggers a gateway reload.
        </p>

        <div className="run-form-field">
          <label className="run-form-label">bundle_id</label>
          <input
            className="run-form-input"
            type="text"
            value={bundleId}
            onChange={(e) => setBundleId(e.target.value)}
            placeholder={defaultBundleId || 'my-agent'}
            disabled={isSubmitting}
          />
          <span className="property-hint">Stable workflow identity (no version suffix). Default: flow name.</span>
        </div>

        <div className="run-form-field" style={{ marginTop: 12 }}>
          <label className="run-form-label">bundle_version (optional)</label>
          <input
            className="run-form-input"
            type="text"
            value={bundleVersion}
            onChange={(e) => setBundleVersion(e.target.value)}
            placeholder="Auto-bump (recommended)"
            disabled={isSubmitting}
          />
          <span className="property-hint">Leave empty to auto-bump (e.g., 0.0.1 → 0.0.2).</span>
        </div>

        <label className="run-form-checkbox" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={reloadGateway}
            onChange={(e) => setReloadGateway(e.target.checked)}
            disabled={isSubmitting}
          />
          Reload gateway bundles after publish
        </label>

        {result ? (
          <div style={{ marginTop: 16 }}>
            <div className="property-hint">
              Published <code>{result.bundle_ref}</code>
              {result.gateway_reloaded ? ' (gateway reloaded)' : ''}
            </div>
            <div className="property-hint">
              Path: <code>{result.bundle_path}</code>
            </div>
            {result.gateway_reload_error ? (
              <div className="property-hint" style={{ color: 'var(--warning)' }}>
                Gateway reload error: <code>{result.gateway_reload_error}</code>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose} disabled={isSubmitting}>
            Close
          </button>
          <button
            className="modal-button"
            disabled={!canSubmit}
            onClick={async () => {
              if (!flowId) return;
              setIsSubmitting(true);
              try {
                const payload: PublishFlowRequest = {};
                const bid = sanitizeBundleId(bundleId);
                if (bid) payload.bundle_id = bid;
                const bver = (bundleVersion || '').trim();
                if (bver) payload.bundle_version = bver;
                payload.reload_gateway = Boolean(reloadGateway);

                const res = await publishFlow(flowId, payload);
                setResult(res);
                toast.success(`Published ${res.bundle_ref}`);
                if (payload.reload_gateway && !res.gateway_reloaded) {
                  toast.error('Published, but failed to reload gateway bundles');
                }
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to publish bundle');
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}

