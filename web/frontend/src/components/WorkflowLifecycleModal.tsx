import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

function sanitizeBundleId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const replaced = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-');
  return replaced.replace(/^-+/, '').replace(/-+$/, '');
}

type DeprecateBundleRequest = {
  bundle_id?: string;
  flow_id?: string;
  reason?: string;
};

type DeprecateBundleResponse = {
  ok: boolean;
  bundle_id: string;
  flow_id: string;
  deprecated_at?: string | null;
  reason?: string | null;
  removed?: boolean | null;
};

async function deprecateBundle(flowId: string, payload: DeprecateBundleRequest): Promise<DeprecateBundleResponse> {
  const response = await fetch(`/api/flows/${flowId}/deprecate`, {
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

async function undeprecateBundle(flowId: string, payload: DeprecateBundleRequest): Promise<DeprecateBundleResponse> {
  const response = await fetch(`/api/flows/${flowId}/undeprecate`, {
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

export function WorkflowLifecycleModal({
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
  const [entryFlowId, setEntryFlowId] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<DeprecateBundleResponse | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBundleId(defaultBundleId);
    setEntryFlowId('');
    setReason('');
    setIsSubmitting(false);
    setResult(null);
  }, [defaultBundleId, isOpen]);

  if (!isOpen) return null;

  const canSubmit = Boolean(flowId) && !isSubmitting;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Workflow lifecycle (gateway)</h3>
        <p>
          Deprecated workflows are hidden from discovery and cannot be launched, but remain installed for traceability
          of previous runs.
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
          <label className="run-form-label">flow_id (optional)</label>
          <input
            className="run-form-input"
            type="text"
            value={entryFlowId}
            onChange={(e) => setEntryFlowId(e.target.value)}
            placeholder="(blank = all entrypoints)"
            disabled={isSubmitting}
          />
          <span className="property-hint">Only needed when the bundle has multiple entrypoints.</span>
        </div>

        <div className="run-form-field" style={{ marginTop: 12 }}>
          <label className="run-form-label">reason (optional)</label>
          <input
            className="run-form-input"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this deprecated?"
            disabled={isSubmitting}
          />
        </div>

        {result ? (
          <div style={{ marginTop: 16 }}>
            <div className="property-hint">
              Bundle: <code>{result.bundle_id}</code> • flow: <code>{result.flow_id}</code>
            </div>
            {result.deprecated_at ? (
              <div className="property-hint">
                deprecated_at: <code>{result.deprecated_at}</code>
              </div>
            ) : null}
            {result.reason ? (
              <div className="property-hint">
                reason: <code>{result.reason}</code>
              </div>
            ) : null}
            {typeof result.removed === 'boolean' ? (
              <div className="property-hint">
                undeprecate: <code>{result.removed ? 'changed' : 'no-op'}</code>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose} disabled={isSubmitting}>
            Close
          </button>
          <button
            className="modal-button danger"
            disabled={!canSubmit}
            onClick={async () => {
              if (!flowId) return;
              setIsSubmitting(true);
              try {
                const payload: DeprecateBundleRequest = {};
                const bid = sanitizeBundleId(bundleId);
                if (bid) payload.bundle_id = bid;
                const fid = (entryFlowId || '').trim();
                if (fid) payload.flow_id = fid;
                const r = (reason || '').trim();
                if (r) payload.reason = r;
                const res = await deprecateBundle(flowId, payload);
                setResult(res);
                toast.success(`Deprecated ${res.bundle_id}:${res.flow_id}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to deprecate bundle');
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? 'Working…' : 'Deprecate'}
          </button>
          <button
            className="modal-button"
            disabled={!canSubmit}
            onClick={async () => {
              if (!flowId) return;
              setIsSubmitting(true);
              try {
                const payload: DeprecateBundleRequest = {};
                const bid = sanitizeBundleId(bundleId);
                if (bid) payload.bundle_id = bid;
                const fid = (entryFlowId || '').trim();
                if (fid) payload.flow_id = fid;
                const res = await undeprecateBundle(flowId, payload);
                setResult(res);
                toast.success(`Undeprecated ${res.bundle_id}:${res.flow_id}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Failed to undeprecate bundle');
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? 'Working…' : 'Undeprecate'}
          </button>
        </div>
      </div>
    </div>
  );
}

