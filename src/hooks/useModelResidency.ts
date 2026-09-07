import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  descriptorEndpointAvailable,
  endpointFromDescriptor,
  gatewayJson,
  jsonRequest,
  type GatewayContracts,
  type GatewayEndpointDescriptor,
  type GatewayQueryValue,
} from '../utils/gatewayClient';

export interface ModelResidencyRecord {
  runtime_id?: string | null;
  load_id?: string | null;
  id?: string | null;
  task?: string | null;
  provider?: string | null;
  model?: string | null;
  state?: string | null;
  health?: string | null;
  source?: string | null;
  loaded?: boolean | null;
  resident?: boolean | null;
  pinned?: boolean | null;
  loaded_at?: string | null;
  last_used_at?: string | null;
  [key: string]: unknown;
}

/**
 * Typed row for the gateway's `model_residency_row_v1` schema (the `rows`
 * array on GET /models/loaded and /host/state). Every field is nullable on
 * the wire; `resident` is TRI-STATE — null means "unknown", which the UI
 * renders as a distinct third state, not as "no".
 */
export interface ModelResidencyRowV1 {
  runtime_id?: string | null;
  task?: string | null;
  provider?: string | null;
  model?: string | null;
  source?: string | null;
  resident?: boolean | null;
  state?: string | null;
  pinned?: boolean | null;
  default?: boolean | null;
  locked?: boolean | null;
  lockable?: boolean | null;
  modalities?: string[] | null;
  size_bytes?: number | null;
  size_vram_bytes?: number | null;
  /** Estimated weight footprint when the runtime reports no measured size. */
  est_weights_bytes?: number | null;
  /** Prompt/KV cache this model currently holds, when the host reports it. */
  cache_bytes?: number | null;
  expires_at?: string | null;
  context_length?: number | null;
  calibrated_context_length?: number | null;
  context_calibrated?: boolean | null;
  host_id?: string | null;
  host_name?: string | null;
  loaded_at?: string | null;
  last_used_at?: string | null;
  details?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export const MODEL_RESIDENCY_ROW_SCHEMA = 'model_residency_row_v1';

export interface ModelResidencyResponse {
  ok?: boolean;
  supported?: boolean;
  available?: boolean;
  operation?: string;
  models?: ModelResidencyRecord[];
  rows?: ModelResidencyRowV1[];
  row_schema?: string;
  runtime?: ModelResidencyRecord | null;
  unloaded?: boolean;
  loaded_new?: boolean;
  warnings?: string[];
  error?: unknown;
  code?: string;
  config_hint?: string;
  source?: string;
  [key: string]: unknown;
}

export interface ModelResidencyLoadPayload {
  task: string;
  provider?: string;
  model?: string;
  lock?: boolean;
  options?: Record<string, unknown>;
  base_url?: string;
  timeout_s?: number;
}

export interface ModelResidencyUnloadPayload {
  task?: string;
  runtime_id?: string;
  provider?: string;
  model?: string;
  force?: boolean;
  options?: Record<string, unknown>;
  base_url?: string;
  timeout_s?: number;
}

export interface ModelResidencyLockPayload {
  runtime_id?: string;
  provider?: string;
  model?: string;
}

export type ModelResidencyEndpointKey = 'loaded' | 'load' | 'unload' | 'lock' | 'unlock' | 'context_estimate';

function residencyDescriptor(
  contracts: GatewayContracts | null | undefined,
  key: ModelResidencyEndpointKey
): GatewayEndpointDescriptor | string | undefined {
  const residency = contracts?.common?.model_residency;
  if (!residency) return undefined;
  const direct = (residency as Record<string, unknown>)[key] as GatewayEndpointDescriptor | string | undefined;
  const nested = residency.endpoints?.[key] as GatewayEndpointDescriptor | string | undefined;
  return direct || nested;
}

export function modelResidencyEndpointAvailable(
  contracts: GatewayContracts | null | undefined,
  key: ModelResidencyEndpointKey
): boolean {
  return descriptorEndpointAvailable(residencyDescriptor(contracts, key));
}

function requireResidencyDescriptor(
  contracts: GatewayContracts | null | undefined,
  key: ModelResidencyEndpointKey
): GatewayEndpointDescriptor | string {
  const descriptor = residencyDescriptor(contracts, key);
  if (!descriptorEndpointAvailable(descriptor)) {
    throw new Error(`Gateway model residency ${key} endpoint is not advertised`);
  }
  return descriptor as GatewayEndpointDescriptor | string;
}

export function modelResidencyAvailable(contracts: GatewayContracts | null | undefined): boolean {
  const residency = contracts?.common?.model_residency;
  if (!residency || residency.route_available === false) return false;
  return (
    descriptorEndpointAvailable(residencyDescriptor(contracts, 'loaded')) ||
    descriptorEndpointAvailable(residencyDescriptor(contracts, 'load')) ||
    descriptorEndpointAvailable(residencyDescriptor(contracts, 'unload'))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeRecord(value: unknown): ModelResidencyRecord | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const out: ModelResidencyRecord = { ...rec };
  for (const [from, to] of [
    ['runtimeId', 'runtime_id'],
    ['loadId', 'load_id'],
    ['loadedAt', 'loaded_at'],
    ['lastUsedAt', 'last_used_at'],
  ] as const) {
    const value = rec[from];
    if (out[to] === undefined && typeof value === 'string') out[to] = value;
  }
  return out;
}

export function normalizeModelResidencyResponse(value: unknown): ModelResidencyResponse {
  if (Array.isArray(value)) {
    return { ok: true, operation: 'list_loaded', models: value.map(normalizeRecord).filter(Boolean) as ModelResidencyRecord[] };
  }
  const rec = asRecord(value);
  if (!rec) return { ok: false, models: [], error: 'Invalid model residency response' };

  const out: ModelResidencyResponse = { ...rec };
  // The v1 row schema is authoritative when advertised: prefer `rows` over the
  // legacy alias-guessing chain so typed row fields survive normalization.
  // Exception: a transitional/buggy gateway can send `rows: []` NEXT TO a
  // populated legacy array — an empty schema array must not blank the panel,
  // so it only wins when it carries rows or nothing legacy is populated.
  const schemaRows =
    rec.row_schema === MODEL_RESIDENCY_ROW_SCHEMA && Array.isArray(rec.rows) ? rec.rows : null;
  const legacyRows =
    Array.isArray(rec.models) ? rec.models :
    Array.isArray(rec.items) ? rec.items :
    Array.isArray(rec.loaded) ? rec.loaded :
    Array.isArray(rec.runtimes) ? rec.runtimes :
    Array.isArray(rec.data) ? rec.data :
    [];
  const useSchemaRows = schemaRows !== null && (schemaRows.length > 0 || legacyRows.length === 0);
  const rows = useSchemaRows ? (schemaRows as unknown[]) : legacyRows;
  out.models = rows.map(normalizeRecord).filter(Boolean) as ModelResidencyRecord[];
  if (useSchemaRows) {
    out.rows = out.models as ModelResidencyRowV1[];
    out.row_schema = MODEL_RESIDENCY_ROW_SCHEMA;
  } else {
    // Do not let the spread carry a rejected/junk `rows` (or a stale v1
    // row_schema tag) into the normalized response: consumers key the v1
    // rendering path off these two fields.
    delete out.rows;
    if (out.row_schema === MODEL_RESIDENCY_ROW_SCHEMA) delete out.row_schema;
  }
  const runtime = normalizeRecord(rec.runtime);
  if (runtime) out.runtime = runtime;
  return out;
}

/** True when a normalized response carries typed `model_residency_row_v1` rows. */
export function residencyResponseHasRowV1(
  response: ModelResidencyResponse | null | undefined
): boolean {
  return Boolean(response && response.row_schema === MODEL_RESIDENCY_ROW_SCHEMA && Array.isArray(response.rows));
}

export function useLoadedModels(
  contracts: GatewayContracts | null | undefined,
  enabled = true,
  filters: Record<string, GatewayQueryValue> = {}
) {
  const descriptor = residencyDescriptor(contracts, 'loaded');
  const available = descriptorEndpointAvailable(descriptor);
  return useQuery({
    queryKey: ['gateway', 'model-residency', 'loaded', descriptor, filters],
    queryFn: async () => {
      const endpoint = endpointFromDescriptor(requireResidencyDescriptor(contracts, 'loaded'), '/models/loaded', {}, filters);
      return normalizeModelResidencyResponse(await gatewayJson<unknown>(endpoint));
    },
    enabled: enabled && available,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useLoadModelResidency(contracts: GatewayContracts | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ModelResidencyLoadPayload) => {
      const endpoint = endpointFromDescriptor(requireResidencyDescriptor(contracts, 'load'), '/models/load');
      return normalizeModelResidencyResponse(await gatewayJson<unknown>(endpoint, { ...jsonRequest(payload, { method: 'POST' }), timeoutMs: 0 }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', 'model-residency'] });
    },
  });
}

export function useUnloadModelResidency(contracts: GatewayContracts | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ModelResidencyUnloadPayload) => {
      const endpoint = endpointFromDescriptor(requireResidencyDescriptor(contracts, 'unload'), '/models/unload');
      return normalizeModelResidencyResponse(await gatewayJson<unknown>(endpoint, { ...jsonRequest(payload, { method: 'POST' }), timeoutMs: 0 }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', 'model-residency'] });
    },
  });
}

export function useLockModel(contracts: GatewayContracts | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ModelResidencyLockPayload) => {
      const endpoint = endpointFromDescriptor(requireResidencyDescriptor(contracts, 'lock'), '/models/lock');
      return normalizeModelResidencyResponse(await gatewayJson<unknown>(endpoint, jsonRequest(payload, { method: 'POST' })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', 'model-residency'] });
    },
  });
}

export function useUnlockModel(contracts: GatewayContracts | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ModelResidencyLockPayload) => {
      const endpoint = endpointFromDescriptor(requireResidencyDescriptor(contracts, 'unlock'), '/models/unlock');
      return normalizeModelResidencyResponse(await gatewayJson<unknown>(endpoint, jsonRequest(payload, { method: 'POST' })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', 'model-residency'] });
    },
  });
}

export interface ContextEstimateResponse {
  ok?: boolean;
  confidence?: string | number;
  predicted_max_context?: number | null;
  notes?: string[];
  [key: string]: unknown;
}

export interface ContextEstimateParams {
  provider: string;
  model: string;
  context_length?: number | null;
}

export function useContextEstimate(
  contracts: GatewayContracts | null | undefined,
  params: ContextEstimateParams,
  enabled = true
) {
  const descriptor = residencyDescriptor(contracts, 'context_estimate');
  const available = descriptorEndpointAvailable(descriptor);
  const provider = params.provider.trim();
  const model = params.model.trim();
  return useQuery({
    queryKey: ['gateway', 'model-residency', 'context-estimate', descriptor, provider, model, params.context_length ?? null],
    queryFn: async () => {
      const endpoint = endpointFromDescriptor(
        requireResidencyDescriptor(contracts, 'context_estimate'),
        '/models/context_estimate',
        {},
        { provider, model, context_length: params.context_length ?? undefined }
      );
      return gatewayJson<ContextEstimateResponse>(endpoint);
    },
    enabled: enabled && available && Boolean(provider) && Boolean(model),
    staleTime: 30_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Host state (memory/GPU/totals) + session prompt caches
// ---------------------------------------------------------------------------

export interface HostMemoryRam {
  total_bytes?: number | null;
  available_bytes?: number | null;
  used_bytes?: number | null;
  percent?: number | null;
  [key: string]: unknown;
}

export interface HostMemoryDevice {
  backend?: string | null;
  /**
   * PROCESS-LOCAL allocation. On Apple silicon this reads 0 while tens of GB
   * are resident in another process, so it must never be the headline figure
   * when `host_in_use_bytes` is available.
   */
  allocated_bytes?: number | null;
  total_bytes?: number | null;
  free_bytes?: number | null;
  /**
   * Accelerator heap in use across ALL PROCESSES. Not the machine's memory
   * use and not a denominator: it is blind to memory-mapped GGUF weights,
   * which llama.cpp maps from disk rather than allocating on the driver.
   */
  host_in_use_bytes?: number | null;
  /** The real accelerator ceiling (Metal wired limit), below total_bytes. */
  wired_limit_bytes?: number | null;
  [key: string]: unknown;
}

export interface HostMemoryProcess {
  rss_bytes?: number | null;
  [key: string]: unknown;
}

export interface HostMemoryInfo {
  ram?: HostMemoryRam | null;
  process?: HostMemoryProcess | null;
  device?: HostMemoryDevice | null;
  host?: unknown;
  [key: string]: unknown;
}

export interface SessionCacheRecord {
  key?: string | null;
  provider?: string | null;
  model?: string | null;
  session_id?: string | null;
  bytes?: number | null;
  token_count?: number | null;
  created_at_s?: number | null;
  [key: string]: unknown;
}

export interface HostStateResponse {
  ok?: boolean;
  ts?: number | string;
  memory?: HostMemoryInfo | null;
  gpu?: unknown;
  /** null = the host could not enumerate this section (degraded), not "none". */
  models?: ModelResidencyRowV1[] | null;
  session_caches?: SessionCacheRecord[] | null;
  totals?: Record<string, unknown> | null;
  degraded?: string[];
  reasons?: Record<string, string>;
  row_schema?: string;
  [key: string]: unknown;
}

function hostStateDescriptor(
  contracts: GatewayContracts | null | undefined
): GatewayEndpointDescriptor | string | undefined {
  const hostState = contracts?.common?.host_state;
  if (!hostState || hostState.route_available === false || hostState.available === false) return undefined;
  const nested = hostState.endpoints?.state;
  if (descriptorEndpointAvailable(nested)) return nested;
  return descriptorEndpointAvailable(hostState) ? hostState : undefined;
}

export function hostStateAvailable(contracts: GatewayContracts | null | undefined): boolean {
  return descriptorEndpointAvailable(hostStateDescriptor(contracts));
}

/**
 * Polls GET /host/state. The endpoint is slow, so it only refetches (every
 * ~5s) while `enabled` is true — callers must scope that to "panel open".
 */
export function useHostState(contracts: GatewayContracts | null | undefined, enabled = true) {
  const descriptor = hostStateDescriptor(contracts);
  const available = descriptorEndpointAvailable(descriptor);
  return useQuery({
    queryKey: ['gateway', 'model-residency', 'host-state', descriptor],
    queryFn: async () => {
      const endpoint = endpointFromDescriptor(descriptor, '/host/state');
      return gatewayJson<HostStateResponse>(endpoint);
    },
    enabled: enabled && available,
    refetchInterval: enabled && available ? 5_000 : false,
    staleTime: 4_000,
    retry: 1,
  });
}

function sessionCachesContract(contracts: GatewayContracts | null | undefined) {
  const caches = contracts?.common?.session_caches;
  if (!caches || caches.route_available === false || caches.available === false) return undefined;
  return caches;
}

function sessionCachesListDescriptor(
  contracts: GatewayContracts | null | undefined
): GatewayEndpointDescriptor | string | undefined {
  const caches = sessionCachesContract(contracts);
  if (!caches) return undefined;
  const nested = caches.endpoints?.list;
  if (descriptorEndpointAvailable(nested)) return nested;
  return descriptorEndpointAvailable(caches) ? caches : undefined;
}

export function sessionCachesAvailable(contracts: GatewayContracts | null | undefined): boolean {
  return descriptorEndpointAvailable(sessionCachesListDescriptor(contracts));
}

export function sessionCacheClearAvailable(contracts: GatewayContracts | null | undefined): boolean {
  return descriptorEndpointAvailable(sessionCachesContract(contracts)?.endpoints?.clear_all);
}

export function useSessionCaches(contracts: GatewayContracts | null | undefined, enabled = true) {
  const descriptor = sessionCachesListDescriptor(contracts);
  const available = descriptorEndpointAvailable(descriptor);
  return useQuery({
    queryKey: ['gateway', 'model-residency', 'session-caches', descriptor],
    queryFn: async () => {
      const endpoint = endpointFromDescriptor(descriptor, '/sessions/prompt_cache');
      return gatewayJson<unknown>(endpoint);
    },
    enabled: enabled && available,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useClearSessionCache(contracts: GatewayContracts | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const descriptor = sessionCachesContract(contracts)?.endpoints?.clear_all;
      if (!descriptorEndpointAvailable(descriptor)) {
        throw new Error('Gateway session cache clear endpoint is not advertised');
      }
      const endpoint = endpointFromDescriptor(
        descriptor,
        '/sessions/{session_id}/prompt_cache/clear_all',
        { session_id: sessionId, id: sessionId }
      );
      return gatewayJson<unknown>(endpoint, jsonRequest({}, { method: 'POST' }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway', 'model-residency'] });
    },
  });
}
