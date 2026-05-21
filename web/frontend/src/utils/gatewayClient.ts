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
    input_data?: GatewayEndpointDescriptor;
    history_bundle?: GatewayEndpointDescriptor;
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
    voice_voices?: string;
    audio_speech_models?: string;
    audio_transcription_models?: string;
    vision_provider_models?: string;
    vision_models?: string;
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
  model_residency?: GatewayEndpointDescriptor & {
    endpoints?: {
      loaded?: GatewayEndpointDescriptor | string;
      load?: GatewayEndpointDescriptor | string;
      unload?: GatewayEndpointDescriptor | string;
    };
    loaded?: GatewayEndpointDescriptor | string;
    load?: GatewayEndpointDescriptor | string;
    unload?: GatewayEndpointDescriptor | string;
    tasks?: string[];
    operations?: string[];
    supports?: Record<string, boolean>;
    source?: string;
    config_hint?: string;
    ledger?: string;
  };
  memory?: GatewayEndpointDescriptor & {
    route_available?: boolean;
    structured_query?: boolean;
    semantic_query?: boolean;
    backend?: string;
    config_hint?: string;
    error?: string;
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
    durability?: string;
    returns_child_run_id?: boolean;
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
  media?: GatewayMediaContract;
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

export interface GatewayCapabilityCheck {
  key: string;
  label: string;
  ok: boolean;
  reason?: string;
}

export interface GatewayFlowOperationStatus {
  ready: boolean;
  reason: string;
  missing: string[];
  checks: GatewayCapabilityCheck[];
}

export interface GatewayOptionalFeatureStatus {
  providers: boolean;
  providerModels: boolean;
  tools: boolean;
  semantics: boolean;
  workspacePolicy: boolean;
  promptCacheSessions: boolean;
  kgMemory: boolean;
  generatedImage: boolean;
  generatedVoice: boolean;
  attachmentsUpload: boolean;
  modelResidency: boolean;
}

export interface GatewayFlowEditorReadiness {
  ready: boolean;
  checks: GatewayCapabilityCheck[];
  operations: {
    save: GatewayFlowOperationStatus;
    publish: GatewayFlowOperationStatus;
    run: GatewayFlowOperationStatus;
    history: GatewayFlowOperationStatus;
    artifacts: GatewayFlowOperationStatus;
    commands: GatewayFlowOperationStatus;
  };
  optional: GatewayOptionalFeatureStatus;
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

export function endpointTemplateFromDescriptor(
  descriptor: GatewayEndpointDescriptor | string | undefined | null
): string {
  if (typeof descriptor === 'string') return descriptor.trim();
  if (descriptor && typeof descriptor.endpoint === 'string') return descriptor.endpoint.trim();
  return '';
}

export function descriptorEndpointAvailable(
  descriptor: GatewayEndpointDescriptor | string | undefined | null
): boolean {
  if (typeof descriptor === 'string') return Boolean(descriptor.trim());
  if (!descriptor || typeof descriptor !== 'object') return false;
  if (descriptor.available === false) return false;
  if ((descriptor as Record<string, unknown>).route_available === false) return false;
  return Boolean(endpointTemplateFromDescriptor(descriptor));
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

function stringEndpointAvailable(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function pickDescriptor(
  ...items: Array<GatewayEndpointDescriptor | string | undefined | null>
): GatewayEndpointDescriptor | string | undefined {
  return items.find((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    return Boolean(item && typeof item === 'object');
  }) || undefined;
}

function endpointCheck(
  key: string,
  label: string,
  descriptor: GatewayEndpointDescriptor | string | undefined | null
): GatewayCapabilityCheck {
  if (descriptorEndpointAvailable(descriptor)) return { key, label, ok: true };
  if (descriptor && typeof descriptor === 'object') {
    const hint =
      typeof (descriptor as Record<string, unknown>).install_hint === 'string'
        ? String((descriptor as Record<string, unknown>).install_hint).trim()
        : '';
    if (descriptor.available === false) {
      return { key, label, ok: false, reason: hint || `${label} is not available from Gateway.` };
    }
    if ((descriptor as Record<string, unknown>).route_available === false) {
      return { key, label, ok: false, reason: `${label} route is not available from Gateway.` };
    }
  }
  return { key, label, ok: false, reason: `${label} endpoint is missing from Gateway discovery.` };
}

function stringEndpointCheck(key: string, label: string, value: unknown): GatewayCapabilityCheck {
  return stringEndpointAvailable(value)
    ? { key, label, ok: true }
    : { key, label, ok: false, reason: `${label} endpoint is missing from Gateway discovery.` };
}

function operationStatus(checks: GatewayCapabilityCheck[]): GatewayFlowOperationStatus {
  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    return { ready: true, reason: '', missing: [], checks };
  }
  const missing = failed.map((c) => c.label);
  const reason =
    failed
      .map((c) => c.reason || `${c.label} is unavailable.`)
      .filter(Boolean)
      .slice(0, 3)
      .join(' ') || 'Gateway Flow Editor contract is incomplete.';
  return { ready: false, reason, missing, checks };
}

export function getGatewayFlowEditorReadiness(
  contracts: GatewayContracts | null | undefined
): GatewayFlowEditorReadiness {
  const flow = contracts?.flow_editor;
  const common = contracts?.common;
  const runs = common?.runs || flow?.runs;
  const ledger = common?.ledger || flow?.ledger;
  const artifacts = common?.artifacts || flow?.artifacts;
  const crud = flow?.visualflows?.crud;

  const checks: GatewayCapabilityCheck[] = [];
  const add = (check: GatewayCapabilityCheck) => {
    checks.push(check);
    return check;
  };

  const contractVersion = add({
    key: 'contracts.version',
    label: 'Gateway client contract v1',
    ok: Boolean(contracts && typeof contracts.version === 'number' && contracts.version >= 1),
    reason: 'Gateway discovery did not return a versioned client contract.',
  });
  const flowEditor = add({
    key: 'flow_editor.available',
    label: 'Flow Editor contract',
    ok: flow?.available === true,
    reason: 'Gateway discovery did not advertise contracts.flow_editor.available.',
  });
  const crudAvailable = add({
    key: 'flow_editor.visualflows.crud',
    label: 'VisualFlow CRUD',
    ok: Boolean(crud && crud.available !== false),
    reason: 'Gateway VisualFlow CRUD is not available.',
  });
  const crudCollection = add(stringEndpointCheck('flow_editor.visualflows.collection', 'VisualFlow collection', crud?.collection_endpoint));
  const crudItem = add(stringEndpointCheck('flow_editor.visualflows.item', 'VisualFlow item', crud?.item_endpoint));
  const publish = add(endpointCheck('flow_editor.visualflows.publish', 'VisualFlow publish', flow?.visualflows?.publish));
  const runInputSchema = add(endpointCheck('flow_editor.run_input_schema', 'Run input schema', flow?.run_input_schema));
  const runsInputData = add(endpointCheck('common.runs.input_data', 'Run input rehydration', pickDescriptor(runs?.input_data, flow?.runs?.input_data)));
  const runsHistoryBundle = add(endpointCheck('common.runs.history_bundle', 'Run history bundle', pickDescriptor(runs?.history_bundle, flow?.runs?.history_bundle)));
  const runsStart = add(endpointCheck('common.runs.start', 'Run start', pickDescriptor(runs?.start, flow?.runs?.start)));
  const runsList = add(endpointCheck('common.runs.list', 'Run listing', pickDescriptor(runs?.list, flow?.runs?.list)));
  const runsSummary = add(endpointCheck('common.runs.summary', 'Run summary', pickDescriptor(runs?.summary, flow?.runs?.summary)));
  const runsCommands = add(endpointCheck('common.runs.commands', 'Run commands', pickDescriptor(runs?.commands, flow?.runs?.commands)));
  const ledgerReplay = add(endpointCheck('common.ledger.replay', 'Ledger replay', pickDescriptor(ledger?.replay, flow?.ledger?.replay)));
  const ledgerStreamBase = add(endpointCheck('common.ledger.stream', 'Ledger stream', pickDescriptor(ledger?.stream, flow?.ledger?.stream)));
  const streamTransport = (() => {
    const desc = pickDescriptor(ledger?.stream, flow?.ledger?.stream);
    if (!ledgerStreamBase.ok) return ledgerStreamBase;
    if (desc && typeof desc === 'object' && typeof desc.transport === 'string' && desc.transport && desc.transport !== 'sse') {
      return {
        key: 'common.ledger.stream.transport',
        label: 'SSE ledger stream',
        ok: false,
        reason: `Gateway ledger stream transport '${desc.transport}' is not supported by this editor.`,
      };
    }
    return { key: 'common.ledger.stream.transport', label: 'SSE ledger stream', ok: true };
  })();
  add(streamTransport);
  const artifactsList = add(endpointCheck('common.artifacts.list', 'Artifact listing', pickDescriptor(artifacts?.list, flow?.artifacts?.list)));
  const artifactsMetadata = add(endpointCheck('common.artifacts.metadata', 'Artifact metadata', pickDescriptor(artifacts?.metadata, flow?.artifacts?.metadata)));
  const artifactsContent = add(endpointCheck('common.artifacts.content', 'Artifact content', pickDescriptor(artifacts?.content, flow?.artifacts?.content)));

  const base = [contractVersion, flowEditor];
  const save = operationStatus([...base, crudAvailable, crudCollection, crudItem]);
  const publishStatus = operationStatus([...base, publish]);
  const run = operationStatus([
    ...base,
    publish,
    runInputSchema,
    runsInputData,
    runsStart,
    runsSummary,
    runsCommands,
    ledgerStreamBase,
    streamTransport,
  ]);
  const history = operationStatus([...base, runsHistoryBundle, runsList, runsSummary, ledgerReplay, artifactsList, artifactsMetadata, artifactsContent]);
  const artifactStatus = operationStatus([...base, artifactsList, artifactsMetadata, artifactsContent]);
  const commands = operationStatus([...base, runsCommands]);

  const generatedImage = (() => {
    const image = flow?.media?.generated_image || contracts?.assistant?.media?.generated_image;
    return Boolean(
      descriptorEndpointAvailable(image?.direct_endpoint) ||
        image?.direct_endpoint?.route_available === true ||
        image?.workflow?.available === true
    );
  })();
  const generatedVoice = (() => {
    const voice = flow?.media?.generated_voice || contracts?.assistant?.media?.generated_voice;
    return Boolean(descriptorEndpointAvailable(voice?.direct_endpoint) || voice?.workflow?.available === true);
  })();
  const promptCacheSessionEndpoints = common?.prompt_cache?.session_endpoints;
  const modelResidency = common?.model_residency;
  const modelResidencyEndpoints = modelResidency?.endpoints || {};
  const modelResidencyRouteAvailable =
    modelResidency?.route_available !== false &&
    (
      descriptorEndpointAvailable(modelResidencyEndpoints.loaded) ||
      descriptorEndpointAvailable(modelResidencyEndpoints.load) ||
      descriptorEndpointAvailable(modelResidencyEndpoints.unload) ||
      descriptorEndpointAvailable(modelResidency?.loaded) ||
      descriptorEndpointAvailable(modelResidency?.load) ||
      descriptorEndpointAvailable(modelResidency?.unload)
    );

  return {
    ready: save.ready && publishStatus.ready && run.ready && history.ready && artifactStatus.ready,
    checks,
    operations: {
      save,
      publish: publishStatus,
      run,
      history,
      artifacts: artifactStatus,
      commands,
    },
    optional: {
      providers: stringEndpointAvailable(common?.discovery?.providers),
      providerModels: stringEndpointAvailable(common?.discovery?.provider_models),
      tools: stringEndpointAvailable(common?.discovery?.tools),
      semantics: stringEndpointAvailable(common?.discovery?.semantics),
      workspacePolicy: stringEndpointAvailable(common?.workspace?.policy_endpoint),
      promptCacheSessions: Boolean(
        common?.prompt_cache?.session_lifecycle === true &&
          stringEndpointAvailable(promptCacheSessionEndpoints?.status) &&
          stringEndpointAvailable(promptCacheSessionEndpoints?.prepare)
      ),
      kgMemory: Boolean(common?.memory?.available === true && descriptorEndpointAvailable(common.memory)),
      generatedImage,
      generatedVoice,
      attachmentsUpload: descriptorEndpointAvailable(common?.attachments?.upload),
      modelResidency: Boolean(modelResidencyRouteAvailable),
    },
  };
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

export async function gatewayFetch(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const timeoutMs = typeof init?.timeoutMs === 'number' ? init.timeoutMs : 30_000;
  const controller = typeof AbortController !== 'undefined' && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  const { timeoutMs: _timeoutMs, signal, ...fetchInit } = init || {};
  const mergedSignal = signal || controller?.signal;
  let res: Response;
  try {
    res = await fetch(path, { ...fetchInit, signal: mergedSignal });
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
  if (!res.ok) throw await gatewayErrorFromResponse(res);
  return res;
}

export async function gatewayJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
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
