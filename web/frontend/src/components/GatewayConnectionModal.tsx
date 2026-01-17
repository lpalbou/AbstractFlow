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

type GatewayConnectionStatus = {
  ok: boolean;
  gateway_url: string;
  has_token: boolean;
  token_source: string;
  embeddings: EmbeddingsStatus;
};

async function fetchGatewayConnection(): Promise<GatewayConnectionStatus> {
  const res = await fetch('/api/connection/gateway');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as GatewayConnectionStatus;
}

async function saveGatewayConnection(payload: { gateway_url?: string; gateway_token?: string; persist?: boolean }): Promise<GatewayConnectionStatus> {
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

async function clearGatewayConnection(): Promise<void> {
  const res = await fetch('/api/connection/gateway', { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

function statusBadge(status: GatewayConnectionStatus | null): { label: string; tone: 'ok' | 'warn' | 'err' } {
  if (!status) return { label: 'Unknown', tone: 'warn' };
  const emb = status.embeddings || {};
  const ok = emb.ok === true;
  if (ok) return { label: `Embeddings OK (${emb.provider || 'provider'} · ${emb.model || 'model'})`, tone: 'ok' };
  const err = emb.error || emb.detail;
  if (typeof err === 'string' && err.toLowerCase().includes('unauthorized')) return { label: 'Unauthorized (token required)', tone: 'err' };
  if (typeof err === 'string' && err.trim()) return { label: `Embeddings error: ${err}`, tone: 'err' };
  return { label: 'Embeddings not configured', tone: 'warn' };
}

export function GatewayConnectionModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<GatewayConnectionStatus | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState('http://127.0.0.1:8081');
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
      toast.success('Saved gateway connection');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    try {
      const s = await fetchGatewayConnection();
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
      toast.success('Cleared saved connection');
    } catch (e: any) {
      toast.error(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <h3>Connection</h3>
        <p>
          Configure <strong>AbstractGateway</strong> connection for embeddings (required for <code>memory_kg_query</code>{' '}
          <code>query_text</code> and embeddings-backed KG writes).
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: badge.tone === 'ok' ? 'rgba(0,255,0,0.85)' : badge.tone === 'err' ? 'rgba(255,80,80,0.92)' : 'rgba(255,200,120,0.92)',
            }}
          >
            {badge.label}
          </span>
          {status ? (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              token: {status.has_token ? `${status.token_source}` : 'missing'}
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
          <label className="property-label">Gateway URL</label>
          <input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} placeholder="http://127.0.0.1:8081" />

          <label className="property-label">Gateway token</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type={showToken ? 'text' : 'password'}
              value={gatewayToken}
              onChange={(e) => setGatewayToken(e.target.value)}
              placeholder={status?.has_token ? '(token already configured)' : 'dev-token'}
              style={{ flex: 1 }}
            />
            <button className="toolbar-button" type="button" onClick={() => setShowToken((v) => !v)}>
              {showToken ? '🙈' : '👁️'}
            </button>
          </div>

          <label className="property-label">Persist</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
            Save in server runtime dir (survives restart)
          </label>
        </div>

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose} disabled={saving || loading}>
            Close
          </button>
          <button className="modal-button" onClick={handleClear} disabled={saving || loading}>
            Clear
          </button>
          <button className="modal-button" onClick={handleTest} disabled={saving || loading}>
            {loading ? 'Checking…' : 'Test'}
          </button>
          <button className="modal-button primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

