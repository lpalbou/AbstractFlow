import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { GatewaySessionSignInCard } from '@abstractframework/ui-kit';

type EmbeddingsStatus = {
  ok?: boolean;
  provider?: string;
  model?: string;
  dimension?: number;
  error?: string;
  detail?: string;
  principal?: {
    user_id?: string;
    runtime_id?: string;
    source?: string;
    admin?: boolean;
  };
  auth?: {
    mode?: string;
    user_auth_enabled?: boolean;
  };
  routing?: {
    mode?: string;
  };
};

export type GatewayConnectionStatus = {
  ok: boolean;
  gateway_url: string;
  has_token: boolean;
  token_source: string;
  embeddings: EmbeddingsStatus;
  gateway?: EmbeddingsStatus;
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

export async function saveGatewayConnection(payload: {
  gateway_url?: string;
  gateway_user_id?: string;
  gateway_token?: string;
  persist?: boolean;
  validate_only?: boolean;
}): Promise<GatewayConnectionStatus> {
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
  if (!status) return { label: 'Signed out', tone: 'warn' };
  if (!status.has_token) return { label: 'Signed out', tone: 'err' };
  const emb = status.gateway || status.embeddings || {};
  const ok = emb.ok === true;
  const user = emb.principal?.user_id;
  const runtime = emb.principal?.runtime_id;
  if (ok && user) return { label: `Signed in as ${user}${runtime ? ` · runtime ${runtime}` : ''}`, tone: 'ok' };
  if (ok) return { label: 'Signed in', tone: 'ok' };
  const err = emb.error || emb.detail;
  if (typeof err === 'string' && err.trim()) return { label: 'Could not sign in', tone: 'err' };
  return { label: 'Sign in required', tone: 'err' };
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
  const [gatewayUserId, setGatewayUserId] = useState('admin');
  const [gatewayToken, setGatewayToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [persist, setPersist] = useState(true);
  const [error, setError] = useState('');

  const badge = useMemo(() => statusBadge(status), [status]);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchGatewayConnection()
      .then((s) => {
        setStatus(s);
        if (typeof s.gateway_url === 'string' && s.gateway_url.trim()) setGatewayUrl(s.gateway_url.trim());
        const principal = (s.gateway || s.embeddings)?.principal;
        if (principal?.user_id) setGatewayUserId(principal.user_id);
      })
      .catch((e) => {
        toast.error(`Failed to load connection status: ${String(e?.message || e)}`);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const s = await saveGatewayConnection({
        gateway_url: gatewayUrl,
        gateway_user_id: gatewayUserId,
        gateway_token: gatewayToken,
        persist,
      });
      setStatus(s);
      setGatewayToken('');
      onSaved?.(s);
      toast.success('Signed in to gateway');
    } catch (e: any) {
      const message = String(e?.message || e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError('');
    try {
      await clearGatewayConnection();
      setGatewayToken('');
      const s = await fetchGatewayConnection();
      setStatus(s);
      onCleared?.();
      toast.success('Signed out');
    } catch (e: any) {
      const message = String(e?.message || e);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const tokenSource = status?.has_token
    ? `token: ${status.token_source || 'browser session'}`
    : 'token: missing';

  return (
    <div className="modal-overlay gateway-connection-overlay" onClick={blocking ? undefined : onClose}>
      <div className="modal gateway-connection-modal" onClick={(e) => e.stopPropagation()}>
        <GatewaySessionSignInCard
          kicker="AbstractFlow connection"
          title="Connect this browser to AbstractGateway"
          description="Sign in with a Gateway user token. Flow exchanges it for an HTTP-only browser session and never stores the raw token."
          statusLabel={badge.label}
          statusTone={badge.tone}
          tokenSourceLabel={tokenSource}
          showGatewayUrl
          gatewayUrl={gatewayUrl}
          onGatewayUrlChange={setGatewayUrl}
          userId={gatewayUserId}
          onUserIdChange={setGatewayUserId}
          token={gatewayToken}
          tokenPlaceholder={status?.has_token ? '(browser session already signed in)' : 'Paste Gateway user token'}
          showToken={showToken}
          onTokenChange={setGatewayToken}
          onShowTokenChange={setShowToken}
          remember={persist}
          rememberLabel="Keep this browser signed in"
          onRememberChange={setPersist}
          loading={loading}
          submitting={saving}
          submittingLabel="Signing in..."
          showClose={!blocking}
          onClose={onClose}
          showSignOut={!blocking}
          onSignOut={handleClear}
          error={error}
          onSubmit={handleSave}
        />
      </div>
    </div>
  );
}
