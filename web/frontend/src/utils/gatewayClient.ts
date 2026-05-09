export type GatewayQueryValue = string | number | boolean | null | undefined;

export interface GatewayEndpointDescriptor {
  available?: boolean;
  endpoint?: string;
  transport?: string;
  [key: string]: unknown;
}

export interface GatewayCommonContract {
  runs?: {
    start?: GatewayEndpointDescriptor;
    schedule?: GatewayEndpointDescriptor;
    summary?: GatewayEndpointDescriptor;
    list?: GatewayEndpointDescriptor;
    commands?: GatewayEndpointDescriptor & { types?: string[] };
  };
  ledger?: {
    replay?: GatewayEndpointDescriptor;
    batch?: GatewayEndpointDescriptor;
    stream?: GatewayEndpointDescriptor;
  };
  artifacts?: {
    list?: GatewayEndpointDescriptor;
    metadata?: GatewayEndpointDescriptor;
    content?: GatewayEndpointDescriptor;
  };
  attachments?: {
    upload?: GatewayEndpointDescriptor;
    max_upload_bytes?: number;
  };
  workspace?: {
    policy_endpoint?: string;
  };
  discovery?: {
    capabilities?: string;
    providers?: string;
    provider_models?: string;
    model_capabilities?: string;
    tools?: string;
    semantics?: string;
  };
  prompt_cache?: {
    provider_controls?: boolean;
    session_lifecycle?: boolean;
    endpoints?: Record<string, string>;
    session_endpoints?: {
      status?: string;
      prepare?: string;
      clear?: string;
      rebuild?: string;
    };
  };
}

export interface GatewayMediaWorkflowDescriptor {
  available?: boolean;
  backend?: string | null;
  config_hint?: string;
  event_contract?: string;
  [key: string]: unknown;
}

export interface GatewayGeneratedImageContract {
  direct_endpoint?: GatewayEndpointDescriptor & {
    route_available?: boolean;
    event_name?: string;
    formats?: string[];
    max_image_bytes?: number;
    config_hint?: string;
  };
  workflow?: GatewayMediaWorkflowDescriptor;
}

export interface GatewayGeneratedVoiceContract {
  direct_endpoint?: GatewayEndpointDescriptor;
  workflow?: GatewayMediaWorkflowDescriptor;
}

export interface GatewayMediaContract {
  generated_image?: GatewayGeneratedImageContract;
  generated_voice?: GatewayGeneratedVoiceContract;
  [key: string]: unknown;
}

export interface GatewayFlowEditorContract {
  available?: boolean;
  version?: number;
  visualflows?: {
    crud?: {
      available?: boolean;
      collection_endpoint?: string;
      item_endpoint?: string;
    };
    publish?: GatewayEndpointDescriptor & { install_hint?: string };
  };
  bundles?: Record<string, GatewayEndpointDescriptor | undefined>;
  run_input_schema?: GatewayEndpointDescriptor & { version?: number };
  runs?: GatewayCommonContract['runs'];
  ledger?: GatewayCommonContract['ledger'];
  artifacts?: GatewayCommonContract['artifacts'];
  helpers?: Record<string, string>;
}

export interface GatewayAssistantContract {
  available?: boolean;
  version?: number;
  runs?: GatewayCommonContract['runs'];
  ledger?: GatewayCommonContract['ledger'];
  artifacts?: GatewayCommonContract['artifacts'];
  voice?: Record<string, unknown>;
  media?: GatewayMediaContract;
  prompt_cache?: Record<string, unknown>;
}

export interface GatewayContracts {
  version?: number;
  common?: GatewayCommonContract;
  flow_editor?: GatewayFlowEditorContract;
  assistant?: GatewayAssistantContract;
  [key: string]: unknown;
}

export interface GatewayCapabilities {
  contracts?: GatewayContracts;
  [key: string]: unknown;
}

export interface GatewayCapabilitiesResponse {
  capabilities?: GatewayCapabilities;
}

export class GatewayHttpError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'GatewayHttpError';
    this.status = status;
    this.detail = detail;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function gatewayPath(
  template: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  query: Record<string, GatewayQueryValue> = {}
): string {
  let path = String(template || '').trim();
  if (!path) path = '/api/gateway';
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.startsWith('/api/gateway')) path = `/api/gateway${path}`;

  path = path.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    const raw = params[key];
    return encodeURIComponent(String(raw ?? ''));
  });

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const queryString = qs.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function endpointFromDescriptor(
  descriptor: GatewayEndpointDescriptor | string | undefined | null,
  fallback: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
  query: Record<string, GatewayQueryValue> = {}
): string {
  const endpoint =
    typeof descriptor === 'string'
      ? descriptor
      : descriptor && typeof descriptor.endpoint === 'string' && descriptor.endpoint.trim()
        ? descriptor.endpoint
        : fallback;
  return gatewayPath(endpoint, params, query);
}

export function capabilityUnavailable(descriptor: { available?: boolean } | undefined | null): boolean {
  return descriptor ? descriptor.available === false : false;
}

export function getGatewayContracts(payload: GatewayCapabilitiesResponse | GatewayCapabilities | null | undefined): GatewayContracts | null {
  const top = asRecord(payload);
  if (!top) return null;
  const caps = asRecord(top.capabilities) || top;
  const contracts = asRecord(caps.contracts);
  return contracts ? (contracts as GatewayContracts) : null;
}

async function gatewayErrorFromResponse(res: Response): Promise<GatewayHttpError> {
  const text = await res.text().catch(() => '');
  let detail: unknown = text;
  if (text) {
    try {
      detail = JSON.parse(text);
    } catch {
      detail = text;
    }
  }
  const rec = asRecord(detail);
  const msg =
    rec && typeof rec.detail === 'string'
      ? rec.detail
      : typeof detail === 'string' && detail.trim()
        ? detail.trim()
        : `HTTP ${res.status}`;
  return new GatewayHttpError(msg, res.status, detail);
}

export async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) throw await gatewayErrorFromResponse(res);
  return res;
}

export async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gatewayFetch(path, init);
  return (await res.json()) as T;
}

export function jsonRequest(payload: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: JSON.stringify(payload),
  };
}

export function makeGatewayRequestId(prefix = 'gw'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
