import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type EmbeddingsStatus = {
  ok?: boolean;
  provider?: string;
  model?: string;
  dimension?: number;
  error?: string;
  detail?: string;
};

export type GatewayConnectionStatus = {
  ok: boolean;
  gateway_url: string;
  has_token: boolean;
  token_source: string;
  embeddings: EmbeddingsStatus;
};

export async function fetchGatewayConnection(): Promise<GatewayConnectionStatus> {
  const res = await fetch('/api/connection/gateway');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as GatewayConnectionStatus;
}

export async function saveGatewayConnection(payload: { gateway_url?: string; gateway_token?: string; persist?: boolean; validate_only?: boolean }): Promise<GatewayConnectionStatus> {
  const res = await fetch('/api/connection/gateway', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as GatewayConnectionStatus;
}

export async function clearGatewayConnection(): Promise<void> {
  const res = await fetch('/api/connection/gateway', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

function statusBadge(status: GatewayConnectionStatus | null): { label: string; tone: 'ok' | 'warn' | 'err' } {
  if (!status) return { label: 'Unknown', tone: 'warn' };
  if (!status.has_token) return { label: 'Gateway token missing', tone: 'err' };
  const emb = status.embeddings || {};
  const ok = emb.ok === true;
  if (ok) return { label: `Connected · gateway ${emb.model || 'verified'}`, tone: 'ok' };
  const err = emb.error || emb.detail;
  if (typeof err === 'string' && err.trim()) return { label: 'Gateway connection failed', tone: 'err' };
  return { label: 'Gateway connection not verified', tone: 'err' };
}

export function GatewayConnectionModal({
  isOpen,
  onClose,
  blocking = false,
  onSaved,
  onCleared,
}: {
  isOpen: boolean;
  onClose: () => void;
  blocking?: boolean;
  onSaved?: (status: GatewayConnectionStatus) => void;
  onCleared?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<GatewayConnectionStatus | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState('http://127.0.0.1:8080');
  const [gatewayToken, setGatewayToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [persist, setPersist] = useState(true);

  const badge = useMemo(() => statusBadge(status), [status]);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchGatewayConnection()
      .then((s) => {
        setStatus(s);
        if (typeof s.gateway_url === 'string' && s.gateway_url.trim()) setGatewayUrl(s.gateway_url.trim());
      })
      .catch((e) => {
        toast.error(`Failed to load connection status: ${String(e?.message || e)}`);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const s = await saveGatewayConnection({
        gateway_url: gatewayUrl,
        gateway_token: gatewayToken,
        persist,
      });
      setStatus(s);
      setGatewayToken('');
      onSaved?.(s);
      toast.success('Connected to gateway');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const s = await saveGatewayConnection({
        gateway_url: gatewayUrl,
        gateway_token: gatewayToken,
        persist: false,
        validate_only: true,
      });
      setStatus(s);
      toast.success('Connection checked');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await clearGatewayConnection();
      setGatewayToken('');
      const s = await fetchGatewayConnection();
      setStatus(s);
      onCleared?.();
      toast.success('Cleared saved connection');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay gateway-connection-overlay" onClick={blocking ? undefined : onClose}>
      <div className="modal gateway-connection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gateway-connection-hero">
          <div>
            <div className="gateway-connection-kicker">AbstractFlow connection</div>
            <h3>Connect to AbstractGateway</h3>
            <p>
              Choose the gateway this Flow UI should use. The token is stored server-side and injected by the Flow proxy;
              it is never returned to the browser.
            </p>
          </div>
          <div className="gateway-connection-orb" aria-hidden="true">↔</div>
        </div>

        <div className="gateway-connection-status-row">
          <span className={`gateway-connection-status ${badge.tone}`}>
            {badge.label}
          </span>
          {status ? (
            <span className="gateway-connection-token-source">
              token: {status.has_token ? `${status.token_source}` : 'missing'}
            </span>
          ) : null}
        </div>

        <div className="gateway-connection-form">
          <label className="property-label">Gateway URL</label>
          <input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} placeholder="http://127.0.0.1:8080" />

          <label className="property-label">Gateway token</label>
          <div className="gateway-connection-token-input">
            <input
              type={showToken ? 'text' : 'password'}
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder={status?.has_token ? '(token already configured)' : 'dev-token'}
            />
            <button className="toolbar-button" type="button" onClick={() => setShowToken((v) => !v)}>
              {showToken ? '🙈' : '👁️'}
            </button>
          </div>

          <label className="property-label">Remember me</label>
          <label className="gateway-connection-checkbox">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
            Save this gateway on this machine
          </label>
        </div>

        <div className="modal-actions">
          {!blocking ? (
            <button className="modal-button cancel" onClick={onClose} disabled={saving || loading}>
            Close
            </button>
          ) : null}
          {!blocking ? (
            <button className="modal-button" onClick={handleClear} disabled={saving || loading}>
              Logout / clear
            </button>
          ) : null}
          <button className="modal-button" onClick={handleTest} disabled={saving || loading}>
            {loading ? 'Checking…' : 'Test'}
          </button>
          <button className="modal-button primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
