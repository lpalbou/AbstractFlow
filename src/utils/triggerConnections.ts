/**
 * Trigger connections (root backlog 1040/1041/1047).
 *
 * A trigger source is a type (email received, feed item, webhook received); a
 * CONNECTION is one person's instance of it (this mailbox, this feed, this
 * webhook), created on the gateway console's Triggers page and listed by
 * `GET /api/gateway/triggers/connections` →
 * `{connections: [{connection_id, source_id, source_version, label, status,
 * created_at, last_event_at, config_public}]}` (the signed-in person's own).
 *
 * The automation dialog lists the connections of the chosen source and
 * stores the choice as `automation_defaults.trigger.connection_id`; "New
 * connection…" opens the console page on that source
 * (`<gateway>/console#triggers?new=<source_id>`).
 */
import type { JsonValue } from '../types/flow';
import { GatewayHttpError, gatewayJson } from './gatewayClient';

export const TRIGGER_CONNECTIONS_ENDPOINT = 'api/gateway/triggers/connections';

export interface TriggerConnection {
  connection_id: string;
  source_id: string;
  source_version: number;
  label: string;
  status: string;
  created_at: string | null;
  last_event_at: string | null;
  config_public: Record<string, JsonValue>;
}

export type TriggerConnectionsResult =
  | { status: 'ok'; connections: TriggerConnection[] }
  | { status: 'unavailable'; reason: string };

export class TriggerConnectionsContractError extends Error {
  constructor(message: string) {
    super(`Gateway trigger-connections answer breaks the contract: ${message}`);
    this.name = 'TriggerConnectionsContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalTimestamp(value: unknown, at: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TriggerConnectionsContractError(`${at} is not a string or null`);
  return value;
}

export function parseTriggerConnection(raw: unknown, index = 0): TriggerConnection {
  const at = `connections[${index}]`;
  if (!isRecord(raw)) throw new TriggerConnectionsContractError(`${at} is not an object`);
  const { connection_id, source_id, source_version, label, status, created_at, last_event_at, config_public } = raw;
  if (typeof connection_id !== 'string' || !connection_id.trim()) throw new TriggerConnectionsContractError(`${at}.connection_id is not a non-empty string`);
  if (typeof source_id !== 'string' || !source_id.trim()) throw new TriggerConnectionsContractError(`${at}.source_id is not a non-empty string`);
  if (typeof source_version !== 'number' || !Number.isInteger(source_version) || source_version < 1) {
    throw new TriggerConnectionsContractError(`${at}.source_version is not an integer >= 1`);
  }
  if (typeof status !== 'string') throw new TriggerConnectionsContractError(`${at}.status is not a string`);
  if (config_public !== undefined && config_public !== null && !isRecord(config_public)) {
    throw new TriggerConnectionsContractError(`${at}.config_public is not an object`);
  }
  return {
    connection_id,
    source_id,
    source_version,
    label: typeof label === 'string' && label.trim() ? label : connection_id,
    status,
    created_at: optionalTimestamp(created_at, `${at}.created_at`),
    last_event_at: optionalTimestamp(last_event_at, `${at}.last_event_at`),
    config_public: (isRecord(config_public) ? config_public : {}) as Record<string, JsonValue>,
  };
}

export function parseTriggerConnectionsResponse(raw: unknown): TriggerConnection[] {
  if (!isRecord(raw) || !Array.isArray(raw.connections)) throw new TriggerConnectionsContractError('no `connections` list');
  return raw.connections.map((item, index) => parseTriggerConnection(item, index));
}

export type ConnectionsJsonFetcher = (path: string) => Promise<unknown>;

const defaultFetcher: ConnectionsJsonFetcher = (path) => gatewayJson<unknown>(path);

/**
 * The signed-in person's connections. A gateway without the route (404) is
 * `unavailable` (said in the dialog); anything else that fails throws.
 */
export async function fetchTriggerConnections(fetchJson: ConnectionsJsonFetcher = defaultFetcher): Promise<TriggerConnectionsResult> {
  let raw: unknown;
  try {
    raw = await fetchJson(TRIGGER_CONNECTIONS_ENDPOINT);
  } catch (error) {
    if (error instanceof GatewayHttpError && error.status === 404) {
      return { status: 'unavailable', reason: 'Trigger connections are unavailable on this gateway (it predates them).' };
    }
    throw error;
  }
  return { status: 'ok', connections: parseTriggerConnectionsResponse(raw) };
}

/** The connections one source version can listen to. */
export function connectionsForSource(
  connections: readonly TriggerConnection[],
  source: { id: string; version: number }
): TriggerConnection[] {
  return connections.filter((c) => c.source_id === source.id && c.source_version === source.version);
}

/**
 * Is `connectionId` one of this person's connections of `source`? Returns the
 * problem as a sentence, or null.
 */
export function connectionProblem(
  connectionId: string | undefined,
  connections: readonly TriggerConnection[],
  source: { id: string; version: number }
): string | null {
  if (!connectionId) return 'choose a connection';
  const own = connections.find((c) => c.connection_id === connectionId);
  if (!own) return `connection ${connectionId} is not one of yours on this gateway`;
  if (own.source_id !== source.id || own.source_version !== source.version) {
    return `connection "${own.label}" belongs to ${own.source_id} v${own.source_version}, not ${source.id} v${source.version}`;
  }
  return null;
}

/** The console's Triggers page, opened on the create dialog of `sourceId`. */
export function consoleNewConnectionUrl(gatewayUrl: string, sourceId: string): string {
  const base = String(gatewayUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('The console link needs the connected gateway URL');
  return `${base}/console#triggers?new=${encodeURIComponent(sourceId)}`;
}

/** One line per connection for the selector ("Work mailbox · paused"). */
export function connectionOptionLabel(c: TriggerConnection): string {
  return c.status && c.status !== 'active' ? `${c.label} · ${c.status}` : c.label;
}
