import type { GatewayAuthoringCapability } from './nodeCapabilities';

export type GatewayQueryValue = string | number | boolean | null | undefined;

export interface GatewayEndpointDescriptor {
  available?: boolean;
  endpoint?: string;
  transport?: string;
  [key: string]: unknown;
}

export interface GatewaySurfaceReadinessMediaSurface {
  available?: boolean;
  route_available?: boolean;
  configured?: boolean;
  workflow_available?: boolean;
  config_hint?: string;
  [key: string]: unknown;
}

export interface GatewaySurfaceReadinessContract {
  contract?: string;
  version?: number;
  truth_scope?: string;
  limitations?: string[];
  surfaces?: {
    media?: Record<string, GatewaySurfaceReadinessMediaSurface | undefined>;
    model_residency?: {
      available?: boolean;
      route_available?: boolean;
      supported_tasks?: string[];
      unsupported_tasks?: string[];
      supports?: Record<string, boolean>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GatewayDurableBlocPromptCacheContract {
  available?: boolean;
  route_available?: boolean;
  lifecycle_available?: boolean;
  source?: string;
  endpoints?: {
    upsert_text?: string;
    record?: string;
    list?: string;
    delete?: string;
    kv_manifest?: string;
    kv_list?: string;
    kv_ensure?: string;
    kv_load?: string;
    kv_delete?: string;
    kv_prune?: string;
  };
  stable_identifiers?: string[];
  exact_reuse_binding_param?: string;
  ledger?: string;
  config_hint?: string;
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
    purge_drafts?: GatewayEndpointDescriptor;
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
  configuration?: {
    capability_defaults?: GatewayEndpointDescriptor & {
      item_endpoint?: string;
      schema?: string;
    };
  };
  execution?: {
    code?: GatewayCodeExecutionContract;
  };
  discovery?: {
    capabilities?: string;
    providers?: string;
    provider_models?: string;
    model_capabilities?: string;
    voice_voices?: string;
    audio_speech_models?: string;
    audio_transcription_models?: string;
    audio_music_providers?: string;
    audio_music_models?: string;
    embedding_models?: string;
    vision_provider_models?: string;
    vision_models?: string;
    tools?: string;
    semantics?: string;
    catalog_contract?: {
      contract?: string;
      version?: number;
      metadata_field?: string;
      primary_items_field?: string;
      [key: string]: unknown;
    };
  };
  prompt_cache?: {
    provider_controls?: boolean;
    session_lifecycle?: boolean;
    durable_blocs?: GatewayDurableBlocPromptCacheContract;
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
  readiness?: GatewaySurfaceReadinessContract;
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
    configured?: boolean;
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
  direct_endpoint?: GatewayEndpointDescriptor & { configured?: boolean };
  workflow?: GatewayMediaWorkflowDescriptor;
}

export interface GatewayGeneratedMusicContract {
  direct_endpoint?: GatewayEndpointDescriptor & {
    route_available?: boolean;
    configured?: boolean;
    providers_endpoint?: string;
    provider_models_endpoint?: string;
    provider_models_task?: string;
    durability?: string;
    returns_child_run_id?: boolean;
    formats?: string[];
    selected_backend?: string;
    config_hint?: string;
  };
  workflow?: GatewayMediaWorkflowDescriptor;
}

export interface GatewayGeneratedVideoContract {
  direct_endpoint?: GatewayEndpointDescriptor & {
    route_available?: boolean;
    configured?: boolean;
    provider_models_endpoint?: string;
    provider_models_task?: string;
    progress_event_name?: string;
    progress_scope?: string;
    durability?: string;
    returns_child_run_id?: boolean;
    formats?: string[];
    selected_backend?: string;
    config_hint?: string;
  };
  workflow?: GatewayMediaWorkflowDescriptor;
}

export interface GatewayMediaContract {
  generated_image?: GatewayGeneratedImageContract;
  edited_image?: GatewayGeneratedImageContract;
  generated_video?: GatewayGeneratedVideoContract;
  image_to_video?: GatewayGeneratedVideoContract;
  generated_voice?: GatewayGeneratedVoiceContract;
  generated_music?: GatewayGeneratedMusicContract;
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
  execution?: {
    code?: GatewayCodeExecutionContract;
  };
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

export interface GatewayCodeExecutionMode {
  id?: string;
  value?: string;
  label?: string;
  available?: boolean;
  default?: boolean;
  disabled_reason?: string;
  reason?: string;
  config_hint?: string;
  [key: string]: unknown;
}

export interface GatewayCodeExecutionContract {
  contract?: string;
  version?: number;
  available?: boolean;
  default_mode?: string;
  simulate?: GatewayEndpointDescriptor;
  modes?: GatewayCodeExecutionMode[];
  [key: string]: unknown;
}

export interface CodePermissionOption {
  value: string;
  label: string;
  disabled?: boolean;
  reason?: string;
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
  promptCacheDurableBlocs: boolean;
  kgMemory: boolean;
  generatedImage: boolean;
  editedImage: boolean;
  generatedVideo: boolean;
  imageToVideo: boolean;
  generatedVoice: boolean;
  generatedMusic: boolean;
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

export interface GatewayAuthoringCapabilityStatus {
  capability: GatewayAuthoringCapability;
  label: string;
  available: boolean;
  checking: boolean;
  reason: string;
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

const AUTHORING_CAPABILITY_LABELS: Record<GatewayAuthoringCapability, string> = {
  generated_image: 'Generate Image',
  edited_image: 'Edit Image',
  generated_video: 'Generate Video',
  image_to_video: 'Image To Video',
  generated_voice: 'Generate Voice',
  generated_music: 'Generate Music',
  model_residency: 'Model Residency',
  tools: 'Tool execution',
  kg_memory: 'Knowledge graph memory',
};

const AUTHORING_CAPABILITY_OPTIONAL_KEYS: Record<GatewayAuthoringCapability, keyof GatewayOptionalFeatureStatus> = {
  generated_image: 'generatedImage',
  edited_image: 'editedImage',
  generated_video: 'generatedVideo',
  image_to_video: 'imageToVideo',
  generated_voice: 'generatedVoice',
  generated_music: 'generatedMusic',
  model_residency: 'modelResidency',
  tools: 'tools',
  kg_memory: 'kgMemory',
};

export function gatewayAuthoringCapabilityStatus(
  readiness: GatewayFlowEditorReadiness | null | undefined,
  capability: GatewayAuthoringCapability | undefined | null,
  options: { loading?: boolean; known?: boolean } = {}
): GatewayAuthoringCapabilityStatus | null {
  if (!capability) return null;
  const label = AUTHORING_CAPABILITY_LABELS[capability];
  if (options.loading || options.known === false || !readiness) {
    return {
      capability,
      label,
      available: true,
      checking: true,
      reason: `Checking Gateway support for ${label}.`,
    };
  }

  const available = Boolean(readiness.optional[AUTHORING_CAPABILITY_OPTIONAL_KEYS[capability]]);
  return {
    capability,
    label,
    available,
    checking: false,
    reason: available ? '' : `${label} is unavailable on this Gateway.`,
  };
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

export function durableBlocPromptCacheAvailable(
  contract: GatewayDurableBlocPromptCacheContract | undefined | null
): boolean {
  if (!contract || contract.route_available === false || contract.available === false) return false;
  const endpoints = contract.endpoints || {};
  return Boolean(
    stringEndpointAvailable(endpoints.record) &&
      stringEndpointAvailable(endpoints.kv_manifest) &&
      stringEndpointAvailable(endpoints.kv_list) &&
      stringEndpointAvailable(endpoints.kv_ensure) &&
      stringEndpointAvailable(endpoints.kv_load)
  );
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

export function getCodeExecutionContract(
  contracts: GatewayContracts | null | undefined
): GatewayCodeExecutionContract | null {
  const flowCode = contracts?.flow_editor?.execution?.code;
  const commonCode = contracts?.common?.execution?.code;
  const code = flowCode || commonCode;
  if (!code || typeof code !== 'object') return null;
  return code.contract === 'code_execution_policy_v1' ? code : null;
}

export function codePermissionOptions(
  contracts: GatewayContracts | null | undefined,
  currentValue = ''
): CodePermissionOption[] {
  const contract = getCodeExecutionContract(contracts);
  const modes = Array.isArray(contract?.modes) ? contract.modes : [];
  const out: CodePermissionOption[] = [];
  const seen = new Set<string>();

  const add = (value: string, label: string, disabled = false, reason = '') => {
    const clean = value.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ value: clean, label, disabled, reason });
  };

  for (const mode of modes) {
    const value = typeof mode.id === 'string' && mode.id.trim() ? mode.id.trim() : typeof mode.value === 'string' ? mode.value.trim() : '';
    if (!value) continue;
    const label = typeof mode.label === 'string' && mode.label.trim() ? mode.label.trim() : value;
    const reason =
      typeof mode.disabled_reason === 'string' && mode.disabled_reason.trim()
        ? mode.disabled_reason.trim()
        : typeof mode.reason === 'string' && mode.reason.trim()
          ? mode.reason.trim()
          : typeof mode.config_hint === 'string' && mode.config_hint.trim()
            ? mode.config_hint.trim()
            : '';
    add(value, mode.available === false ? `${label} (unavailable)` : label, mode.available === false, reason);
  }

  if (!seen.has('sandbox')) add('sandbox', 'Sandbox');
  const current = currentValue.trim();
  if (current && !seen.has(current)) add(current, `${current} (not advertised by Gateway)`, true, 'Gateway did not advertise this Code execution mode.');
  return out;
}

export function codePermissionUnavailableReason(
  contracts: GatewayContracts | null | undefined,
  value: string
): string {
  const clean = value.trim();
  if (!clean) return '';
  const option = codePermissionOptions(contracts, clean).find((o) => o.value === clean);
  return option?.disabled ? option.reason || `${clean} is not available on this Gateway runtime.` : '';
}

function stringEndpointAvailable(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function gatewaySurfaceReadiness(
  common: GatewayCommonContract | undefined | null
): GatewaySurfaceReadinessContract | null {
  const readiness = common?.readiness;
  return readiness?.contract === 'gateway_surface_readiness_v1' ? readiness : null;
}

function gatewayMediaSurface(
  readiness: GatewaySurfaceReadinessContract | null,
  key: string
): GatewaySurfaceReadinessMediaSurface | undefined {
  const surface = readiness?.surfaces?.media?.[key];
  return surface && typeof surface === 'object' ? surface : undefined;
}

function gatewayDirectMediaSurfaceAllows(surface: GatewaySurfaceReadinessMediaSurface | undefined): boolean {
  if (!surface) return true;
  return surface.available === true && surface.route_available !== false && surface.configured !== false;
}

function gatewayWorkflowMediaSurfaceAllows(surface: GatewaySurfaceReadinessMediaSurface | undefined): boolean {
  if (!surface) return true;
  return surface.workflow_available === true;
}

function gatewayModelResidencySurfaceAllows(readiness: GatewaySurfaceReadinessContract | null): boolean {
  const surface = readiness?.surfaces?.model_residency;
  return !surface || surface.route_available !== false;
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
  const surfaceReadiness = gatewaySurfaceReadiness(common);

  const checks: GatewayCapabilityCheck[] = [];
  const add = (check: GatewayCapabilityCheck) => {
    checks.push(check);
    return check;
  };

  const contractVersionValue = contracts?.version;
  const contractVersionNumber =
    typeof contractVersionValue === 'number' && Number.isFinite(contractVersionValue)
      ? contractVersionValue
      : null;
  const contractVersion = add({
    key: 'contracts.version',
    label: 'Gateway client contract v1',
    ok: contractVersionNumber === 1,
    reason:
      contractVersionNumber === null
        ? 'Gateway discovery did not return a versioned client contract.'
        : `Gateway client contract version ${contractVersionNumber} is not supported by this editor.`,
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
  const directGeneratedMediaAvailable = (
    direct: (GatewayEndpointDescriptor & { route_available?: boolean; configured?: boolean }) | undefined | null,
    surface: GatewaySurfaceReadinessMediaSurface | undefined
  ): boolean =>
    Boolean(
      direct &&
        direct.available !== false &&
        direct.route_available !== false &&
        direct.configured !== false &&
        gatewayDirectMediaSurfaceAllows(surface) &&
        descriptorEndpointAvailable(direct)
    );

  const generatedImage = (() => {
    const image = flow?.media?.generated_image || contracts?.assistant?.media?.generated_image;
    const surface = gatewayMediaSurface(surfaceReadiness, 'generated_image');
    return Boolean(
      (image?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(image?.direct_endpoint, surface)
    );
  })();
  const editedImage = (() => {
    const image = flow?.media?.edited_image || contracts?.assistant?.media?.edited_image;
    const surface = gatewayMediaSurface(surfaceReadiness, 'edited_image');
    return Boolean(
      (image?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(image?.direct_endpoint, surface)
    );
  })();
  const generatedVideo = (() => {
    const video = flow?.media?.generated_video || contracts?.assistant?.media?.generated_video;
    const surface = gatewayMediaSurface(surfaceReadiness, 'generated_video');
    return Boolean(
      (video?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(video?.direct_endpoint, surface)
    );
  })();
  const imageToVideo = (() => {
    const video = flow?.media?.image_to_video || contracts?.assistant?.media?.image_to_video;
    const surface = gatewayMediaSurface(surfaceReadiness, 'image_to_video');
    return Boolean(
      (video?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(video?.direct_endpoint, surface)
    );
  })();
  const generatedVoice = (() => {
    const voice = flow?.media?.generated_voice || contracts?.assistant?.media?.generated_voice;
    const surface = gatewayMediaSurface(surfaceReadiness, 'generated_voice');
    return Boolean(
      (voice?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(voice?.direct_endpoint, surface)
    );
  })();
  const generatedMusic = (() => {
    const music = flow?.media?.generated_music || contracts?.assistant?.media?.generated_music;
    const surface = gatewayMediaSurface(surfaceReadiness, 'generated_music');
    return Boolean(
      (music?.workflow?.available === true && gatewayWorkflowMediaSurfaceAllows(surface)) ||
        directGeneratedMediaAvailable(music?.direct_endpoint, surface)
    );
  })();
  const promptCacheSessionEndpoints = common?.prompt_cache?.session_endpoints;
  const durableBlocPromptCache = common?.prompt_cache?.durable_blocs;
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
      promptCacheDurableBlocs: durableBlocPromptCacheAvailable(durableBlocPromptCache),
      kgMemory: Boolean(common?.memory?.available === true && descriptorEndpointAvailable(common.memory)),
      generatedImage,
      editedImage,
      generatedVideo,
      imageToVideo,
      generatedVoice,
      generatedMusic,
      attachmentsUpload: descriptorEndpointAvailable(common?.attachments?.upload),
      modelResidency: Boolean(modelResidencyRouteAvailable && gatewayModelResidencySurfaceAllows(surfaceReadiness)),
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
