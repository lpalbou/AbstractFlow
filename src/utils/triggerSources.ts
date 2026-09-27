/**
 * Trigger-source discovery (Automations v1, contract C).
 *
 * The list of trigger sources is runtime truth served by the gateway at
 * `GET /api/gateway/trigger-sources`. Flow keeps NO local list: a new runtime
 * `TriggerSource` adapter shows up in the editor with no Flow change.
 *
 * Outcomes:
 * - `ok`: the gateway answered; items may include `available:false` sources
 *   (third-party adapters that failed to load), listed but not bindable.
 * - `unavailable`: the gateway says automations are off, or does not serve
 *   the route (404). Shown as "unavailable on this gateway".
 * - anything else (5xx, network, a payload that breaks the contract) throws.
 */
import type { JsonValue } from '../types/flow';
import {
  GatewayHttpError,
  gatewayJson,
  gatewayPath,
  type GatewayContracts,
} from './gatewayClient';

export const TRIGGER_SOURCES_DEFAULT_ENDPOINT = '/api/gateway/trigger-sources';

export type TriggerSourceKind = 'time' | 'manual' | 'event';

/** A JSON Schema object as served by the source (a subset is rendered as a form). */
export type JsonSchema = { [key: string]: JsonValue };

export interface TriggerSource {
  id: string;
  version: number;
  label: string;
  config_schema: JsonSchema;
  event_schema: JsonSchema;
  capabilities: { kind: TriggerSourceKind };
}

/** A source the gateway serves and that can be bound. */
export interface AvailableTriggerSource extends TriggerSource {
  available: true;
}

/**
 * A source the gateway lists but cannot load (optional third-party adapter).
 * Its descriptor may be missing, so only the identity and the reason are kept.
 */
export interface UnavailableTriggerSource {
  id: string;
  version?: number;
  label: string;
  available: false;
  unavailable_reason: string;
}

export type TriggerSourceItem = AvailableTriggerSource | UnavailableTriggerSource;

export type TriggerSourcesResult =
  | { status: 'ok'; endpoint: string; items: TriggerSourceItem[] }
  | { status: 'unavailable'; endpoint: string; reason: string };

export class TriggerSourcesContractError extends Error {
  constructor(message: string) {
    super(`Gateway trigger-sources answer breaks the contract: ${message}`);
    this.name = 'TriggerSourcesContractError';
  }
}

/** The discovery path: the capabilities descriptor's, else the contract's fixed path. */
export function triggerSourcesEndpoint(contracts: GatewayContracts | null | undefined): string {
  const advertised = contracts?.common?.automations?.trigger_sources_endpoint;
  if (typeof advertised === 'string' && advertised.trim()) return gatewayPath(advertised.trim());
  return TRIGGER_SOURCES_DEFAULT_ENDPOINT;
}

/** The gateway explicitly advertises automations as off. */
export function automationsDisabledByCapabilities(contracts: GatewayContracts | null | undefined): boolean {
  return contracts?.common?.automations?.available === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const KINDS: ReadonlySet<string> = new Set(['time', 'manual', 'event']);

export function parseTriggerSourceItem(raw: unknown, index = 0): TriggerSourceItem {
  const at = `items[${index}]`;
  if (!isRecord(raw)) throw new TriggerSourcesContractError(`${at} is not an object`);
  const { id, version, label, config_schema, event_schema, capabilities, available, unavailable_reason } = raw;
  if (typeof id !== 'string' || !id.trim()) throw new TriggerSourcesContractError(`${at}.id is not a non-empty string`);
  if (typeof available !== 'boolean') throw new TriggerSourcesContractError(`${at}.available is not a boolean`);
  if (unavailable_reason !== undefined && unavailable_reason !== null && typeof unavailable_reason !== 'string') {
    throw new TriggerSourcesContractError(`${at}.unavailable_reason is not a string`);
  }
  // Unavailable third-party entries may lack a loadable descriptor; they are
  // listed (disabled) with their reason, never bound.
  if (!available) {
    if (version !== undefined && version !== null && (typeof version !== 'number' || !Number.isInteger(version) || version < 1)) {
      throw new TriggerSourcesContractError(`${at}.version is not an integer >= 1`);
    }
    return {
      id,
      ...(typeof version === 'number' ? { version } : {}),
      label: typeof label === 'string' && label.trim() ? label : id,
      available: false,
      unavailable_reason:
        typeof unavailable_reason === 'string' && unavailable_reason.trim()
          ? unavailable_reason
          : 'The gateway lists this source as unavailable without a reason.',
    };
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new TriggerSourcesContractError(`${at}.version is not an integer >= 1`);
  }
  if (typeof label !== 'string' || !label.trim()) throw new TriggerSourcesContractError(`${at}.label is not a non-empty string`);
  if (!isRecord(config_schema)) throw new TriggerSourcesContractError(`${at}.config_schema is not an object`);
  if (!isRecord(event_schema)) throw new TriggerSourcesContractError(`${at}.event_schema is not an object`);
  if (!isRecord(capabilities) || typeof capabilities.kind !== 'string' || !KINDS.has(capabilities.kind)) {
    throw new TriggerSourcesContractError(`${at}.capabilities.kind is not one of time|manual|event`);
  }
  return {
    id,
    version,
    label,
    config_schema: config_schema as JsonSchema,
    event_schema: event_schema as JsonSchema,
    capabilities: { kind: capabilities.kind as TriggerSourceKind },
    available: true,
  };
}

export function parseTriggerSourcesResponse(raw: unknown): TriggerSourceItem[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw new TriggerSourcesContractError('no `items` list');
  return raw.items.map((item, index) => parseTriggerSourceItem(item, index));
}

export type GatewayJsonFetcher = (path: string) => Promise<unknown>;

const defaultFetcher: GatewayJsonFetcher = (path) => gatewayJson<unknown>(path);

export async function fetchTriggerSources(
  contracts: GatewayContracts | null | undefined,
  fetchJson: GatewayJsonFetcher = defaultFetcher
): Promise<TriggerSourcesResult> {
  const endpoint = triggerSourcesEndpoint(contracts);
  if (automationsDisabledByCapabilities(contracts)) {
    return { status: 'unavailable', endpoint, reason: 'Automations are not available on this gateway.' };
  }
  let raw: unknown;
  try {
    raw = await fetchJson(endpoint);
  } catch (error) {
    if (error instanceof GatewayHttpError && error.status === 404) {
      return { status: 'unavailable', endpoint, reason: 'Trigger sources are unavailable on this gateway.' };
    }
    throw error;
  }
  return { status: 'ok', endpoint, items: parseTriggerSourcesResponse(raw) };
}

/**
 * One cached discovery answer per gateway URL. `refresh: true` re-fetches;
 * a failed fetch is not cached (the next call tries again).
 */
export class TriggerSourceCache {
  private readonly entries = new Map<string, Promise<TriggerSourcesResult>>();

  constructor(private readonly fetchJson: GatewayJsonFetcher = defaultFetcher) {}

  load(
    gatewayUrl: string,
    contracts: GatewayContracts | null | undefined,
    options: { refresh?: boolean } = {}
  ): Promise<TriggerSourcesResult> {
    const key = String(gatewayUrl || '').trim().replace(/\/+$/, '');
    if (!key) return Promise.reject(new Error('Trigger-source discovery needs the connected gateway URL'));
    const cached = this.entries.get(key);
    if (cached && !options.refresh) return cached;
    const pending = fetchTriggerSources(contracts, this.fetchJson);
    this.entries.set(key, pending);
    pending.catch(() => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
    });
    return pending;
  }

  clear(gatewayUrl?: string): void {
    if (gatewayUrl === undefined) this.entries.clear();
    else this.entries.delete(String(gatewayUrl).trim().replace(/\/+$/, ''));
  }
}

/** The app-wide cache (tests build their own with an injected fetcher). */
export const triggerSourceCache = new TriggerSourceCache();
