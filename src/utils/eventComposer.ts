/**
 * Event wait-key parsing + emit command composition (backlog 0111).
 *
 * The runtime's durable event rendezvous key format (core/event_keys.py):
 *
 *     evt:{scope}:{scope_id}:{name}
 *
 * Scopes: session (scope_id = session id), workflow (workflow_id),
 * run (run_id), global (literal "global"). Event names may contain
 * colons-free arbitrary text; scope ids never contain ':' in practice, but
 * the parser is conservative: the first three segments are structural and
 * the remainder (joined) is the name.
 */

export type ParsedEventKey = {
  scope: 'session' | 'workflow' | 'run' | 'global';
  scopeId: string;
  name: string;
};

export function parseEventWaitKey(waitKey: string | null | undefined): ParsedEventKey | null {
  const raw = String(waitKey || '').trim();
  if (!raw.startsWith('evt:')) return null;
  const parts = raw.split(':');
  if (parts.length < 4) return null;
  const scope = parts[1].trim().toLowerCase();
  if (!['session', 'workflow', 'run', 'global'].includes(scope)) return null;
  const scopeId = parts[2].trim();
  const name = parts.slice(3).join(':').trim();
  if (!name) return null;
  return { scope: scope as ParsedEventKey['scope'], scopeId, name };
}

/**
 * The gateway `emit_event` command payload matching a parsed wait key
 * (runner._apply_emit_event contract: name + scope + scope-id field named by
 * scope + payload [+ durable]).
 */
export function buildEmitEventCommandPayload(
  parsed: ParsedEventKey,
  eventPayload: Record<string, unknown>,
  options?: { durable?: boolean }
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: parsed.name,
    scope: parsed.scope,
    payload: eventPayload,
  };
  if (parsed.scope === 'session' && parsed.scopeId) out.session_id = parsed.scopeId;
  if (parsed.scope === 'workflow' && parsed.scopeId) out.workflow_id = parsed.scopeId;
  if (parsed.scope === 'run' && parsed.scopeId) out.run_id = parsed.scopeId;
  if (options?.durable) out.durable = true;
  return out;
}
