import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { GATEWAY_CONNECTION_PATH, GatewaySessionSignInCard } from '@abstractframework/ui-kit';

/** What the gateway said about this browser's session (`GET /api/gateway/me`
 * on a probe, the sign-in answer after a sign-in). */
type GatewaySessionInfo = {
  ok?: boolean;
  error?: string;
  detail?: unknown;
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

/** The app server's session endpoint (`@abstractframework/app-server`
 * createGatewaySessionProxy): `ok` = the gateway accepted the session. */
export type GatewayConnectionStatus = {
  ok: boolean;
  gateway_url: string;
  has_session: boolean;
  gateway?: GatewaySessionInfo;
};

/**
 * True when this browser holds a gateway session the editor can use: the
 * gateway accepted it (`ok`) for a named USER (a legacy shared token never
 * signs a browser in).
 */
export function hasBrowserGatewaySession(status: GatewayConnectionStatus | null): boolean {
  if (!(status?.ok === true && status.has_session === true)) return false;
  const principal = status.gateway?.principal;
  if (!principal?.user_id) return false;
  const auth = status.gateway?.auth;
  if (auth?.mode === 'legacy-token' || auth?.user_auth_enabled === false) return false;
  if (principal.source === 'legacy-token') return false;
  return true;
}

export async function fetchGatewayConnection(): Promise<GatewayConnectionStatus> {
  const res = await fetch(GATEWAY_CONNECTION_PATH);
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
}): Promise<GatewayConnectionStatus> {
  const res = await fetch(GATEWAY_CONNECTION_PATH, {
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
  const res = await fetch(GATEWAY_CONNECTION_PATH, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data && typeof data === 'object' && (data as any).detail ? String((data as any).detail) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

function normalizeGatewayUrl(value: string): string {
  let raw = String(value || '').trim();
  for (let i = 0; i < 2 && raw; i += 1) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string' && parsed !== raw) {
        raw = parsed.trim();
        continue;
      }
    } catch {
      // User input is usually not JSON; keep going with quote-pair cleanup.
    }
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      raw = raw.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return raw.replace(/\/+$/, '');
}

function statusBadge(status: GatewayConnectionStatus | null): { label: string; tone: 'ok' | 'warn' | 'err' } {
  if (!status) return { label: 'Signed out', tone: 'warn' };
  if (!status.has_session) return { label: 'Signed out', tone: 'err' };
  const user = status.gateway?.principal?.user_id;
  const runtime = status.gateway?.principal?.runtime_id;
  if (status.ok && user) return { label: `Signed in as ${user}${runtime ? ` · runtime ${runtime}` : ''}`, tone: 'ok' };
  if (status.ok) return { label: 'Signed in', tone: 'ok' };
  if (status.gateway?.error || status.gateway?.detail) return { label: 'Could not sign in', tone: 'err' };
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
        if (typeof s.gateway_url === 'string' && s.gateway_url.trim()) setGatewayUrl(normalizeGatewayUrl(s.gateway_url));
        const principal = s.gateway?.principal;
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
      const normalizedGatewayUrl = normalizeGatewayUrl(gatewayUrl);
      setGatewayUrl(normalizedGatewayUrl);
      const s = await saveGatewayConnection({
        gateway_url: normalizedGatewayUrl,
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

  const tokenSource = status?.has_session ? 'token: browser session' : 'token: missing';

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
          onGatewayUrlChange={(value) => setGatewayUrl(normalizeGatewayUrl(value))}
          userId={gatewayUserId}
          onUserIdChange={setGatewayUserId}
          token={gatewayToken}
          tokenPlaceholder={status?.has_session ? '(browser session already signed in)' : 'Paste Gateway user token'}
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
