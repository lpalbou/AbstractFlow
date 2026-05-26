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
  runtime_id?: string;
  load_id?: string;
  id?: string;
  task?: string;
  provider?: string;
  model?: string;
  state?: string;
  health?: string;
  source?: string;
  loaded?: boolean;
  resident?: boolean;
  pinned?: boolean;
  loaded_at?: string;
  last_used_at?: string;
  [key: string]: unknown;
}

export interface ModelResidencyResponse {
  ok?: boolean;
  supported?: boolean;
  available?: boolean;
  operation?: string;
  models?: ModelResidencyRecord[];
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
  options?: Record<string, unknown>;
  base_url?: string;
  timeout_s?: number;
}

export interface ModelResidencyUnloadPayload {
  task?: string;
  runtime_id?: string;
  provider?: string;
  model?: string;
  options?: Record<string, unknown>;
  base_url?: string;
  timeout_s?: number;
}

function residencyDescriptor(
  contracts: GatewayContracts | null | undefined,
  key: 'loaded' | 'load' | 'unload'
): GatewayEndpointDescriptor | string | undefined {
  const residency = contracts?.common?.model_residency;
  if (!residency) return undefined;
  const direct = residency[key] as GatewayEndpointDescriptor | string | undefined;
  const nested = residency.endpoints?.[key] as GatewayEndpointDescriptor | string | undefined;
  return direct || nested;
}

function requireResidencyDescriptor(
  contracts: GatewayContracts | null | undefined,
  key: 'loaded' | 'load' | 'unload'
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
  const rows =
    Array.isArray(rec.models) ? rec.models :
    Array.isArray(rec.items) ? rec.items :
    Array.isArray(rec.loaded) ? rec.loaded :
    Array.isArray(rec.runtimes) ? rec.runtimes :
    Array.isArray(rec.data) ? rec.data :
    [];
  out.models = rows.map(normalizeRecord).filter(Boolean) as ModelResidencyRecord[];
  const runtime = normalizeRecord(rec.runtime);
  if (runtime) out.runtime = runtime;
  return out;
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
