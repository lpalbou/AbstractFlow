import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useModels, useProviders } from '../hooks/useProviders';
import {
  modelResidencyAvailable,
  useLoadedModels,
  useLoadModelResidency,
  useUnloadModelResidency,
  type ModelResidencyRecord,
} from '../hooks/useModelResidency';
import { descriptorEndpointAvailable, gatewayJson, gatewayPath, jsonRequest, type GatewayContracts } from '../utils/gatewayClient';
import {
  modelOptionsFromGatewayCatalog,
  providerOptionsFromGatewayCatalog,
} from '../utils/gatewayCatalog';
import AfSelect, { type AfSelectOption } from './inputs/AfSelect';

interface ModelResidencyPanelProps {
  isOpen: boolean;
  gatewayContracts: GatewayContracts | null;
  onClose: () => void;
}

interface ProviderModelOption {
  provider: string;
  model: string;
  label: string;
}

interface ModelDefaultView {
  id: string;
  kind: string;
  modality: string;
  task: string;
  label: string;
  provider: string;
  model: string;
  baseUrl: string;
  options: Record<string, unknown>;
  source: string;
  sourceRaw: string;
  status: string;
  configured: boolean;
}

interface CapabilityDefaultRoute {
  key?: string;
  kind?: string;
  direction?: string;
  modality?: string;
  task?: string;
  label?: string;
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  options?: Record<string, unknown> | null;
  source?: string | null;
  configured?: boolean;
}

interface CapabilityDefaultsPayload {
  routes?: CapabilityDefaultRoute[];
  errors?: string[];
  config_file?: string;
  authority?: string;
  writable?: boolean;
  config_hint?: string;
}

interface DefaultDraft {
  provider: string;
  model: string;
  baseUrl: string;
  optionsText: string;
}

type DefaultCatalogTask = 'text_generation' | 'image_generation' | 'tts' | 'stt' | 'music_generation' | 'embedding_text' | 'custom';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw) return raw;
  }
  return '';
}

function addProviderModel(out: ProviderModelOption[], seen: Set<string>, provider: string, model: string, label?: string) {
  const p = provider.trim();
  const m = model.trim();
  if (!p || !m) return;
  const key = `${p}\n${m}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ provider: p, model: m, label: label || `${p} / ${m}` });
}

function collectProviderModels(value: unknown, out: ProviderModelOption[], seen: Set<string>, inheritedProvider = '') {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return;
    const split = raw.split(' / ');
    if (split.length >= 2) {
      addProviderModel(out, seen, split[0], split.slice(1).join(' / '), raw);
    } else if (inheritedProvider) {
      addProviderModel(out, seen, inheritedProvider, raw);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderModels(item, out, seen, inheritedProvider);
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  const provider = firstString(rec.provider, rec.provider_id, rec.backend, rec.source, inheritedProvider);
  const model = firstString(rec.model, rec.model_id, rec.id, rec.name);
  const label = firstString(rec.label, rec.display_name, rec.name) || (provider && model ? `${provider} / ${model}` : '');
  if (!provider && model.includes(' / ')) {
    const parts = model.split(' / ');
    addProviderModel(out, seen, parts[0], parts.slice(1).join(' / '), label || model);
    return;
  }
  if (provider && model) addProviderModel(out, seen, provider, model, label);

  for (const key of ['models', 'items', 'provider_models', 'catalog']) {
    if (Array.isArray(rec[key])) collectProviderModels(rec[key], out, seen, provider);
  }
}

function parseProviderModelCatalog(payload: unknown): ProviderModelOption[] {
  const out: ProviderModelOption[] = [];
  collectProviderModels(payload, out, new Set());
  return out;
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function stringValuesFrom(payload: unknown, keys: string[]): string[] {
  const rec = asRecord(payload);
  if (!rec) return [];
  const out: string[] = [];
  for (const key of keys) {
    const values = Array.isArray(rec[key]) ? rec[key] : [];
    for (const item of values) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
      else if (item && typeof item === 'object') {
        const model = firstString((item as Record<string, unknown>).id, (item as Record<string, unknown>).model, (item as Record<string, unknown>).model_id, (item as Record<string, unknown>).name);
        if (model) out.push(model);
      }
    }
  }
  return uniqueStrings(out);
}

function providerValuesFrom(payload: unknown, arrayKeys: string[], mapKeys: string[] = []): string[] {
  const rec = asRecord(payload);
  if (!rec) return [];
  const out: string[] = [];
  for (const key of arrayKeys) {
    const values = Array.isArray(rec[key]) ? rec[key] : [];
    for (const item of values) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  for (const key of mapKeys) {
    const value = rec[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const item of Object.keys(value)) {
      if (item.trim()) out.push(item.trim());
    }
  }
  return uniqueStrings(out);
}

function taskLabel(task: string): string {
  if (task === 'text_generation') return 'Text';
  if (task === 'image_generation') return 'Image';
  if (task === 'tts') return 'Speech';
  if (task === 'stt') return 'Transcription';
  if (task === 'music_generation') return 'Music';
  return task.replace(/_/g, ' ');
}

function taskOptions(contracts: GatewayContracts | null): AfSelectOption[] {
  const residency = contracts?.common?.model_residency;
  const canonicalTasks = ['text_generation', 'image_generation', 'tts', 'stt', 'music_generation'];
  const rawTasks = [
    ...canonicalTasks,
    ...(Array.isArray(residency?.tasks) ? residency.tasks : []),
  ];
  const seen = new Set<string>();
  const out: AfSelectOption[] = [];
  for (const task of rawTasks) {
    if (typeof task !== 'string') continue;
    const t = task.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({ value: t, label: taskLabel(t) });
  }
  return out.length > 0 ? out : [{ value: 'text_generation', label: 'Text' }];
}

function defaultCatalogTask(row: ModelDefaultView | null): DefaultCatalogTask {
  if (!row) return 'custom';
  const kind = row.kind.toLowerCase();
  const modality = row.modality.toLowerCase();
  if (kind === 'output') {
    if (modality === 'image' || modality === 'video') return 'image_generation';
    if (modality === 'voice') return 'tts';
    if (modality === 'music' || modality === 'sound') return 'music_generation';
    if (modality === 'text') return 'text_generation';
  }
  if (kind === 'input') {
    if (modality === 'voice') return 'stt';
    if (modality === 'text' || modality === 'image' || modality === 'video') return 'text_generation';
  }
  if (kind === 'embedding' && modality === 'text') return 'embedding_text';
  return 'custom';
}

function defaultVisionCatalogTask(row: ModelDefaultView | null): string {
  const modality = row?.modality.toLowerCase() || '';
  if (modality === 'video') return 'text_to_video';
  return 'text_to_image';
}

function defaultProviderPlaceholder(catalogTask: DefaultCatalogTask): string {
  if (catalogTask === 'image_generation') return 'Image provider…';
  if (catalogTask === 'tts') return 'Speech provider…';
  if (catalogTask === 'stt') return 'Transcription provider…';
  if (catalogTask === 'music_generation') return 'Music provider…';
  if (catalogTask === 'embedding_text') return 'Embedding provider…';
  return 'Provider…';
}

function defaultModelPlaceholder(catalogTask: DefaultCatalogTask, provider: string): string {
  if (!provider) return 'Pick provider…';
  if (catalogTask === 'image_generation') return 'Image model…';
  if (catalogTask === 'tts') return 'Speech model…';
  if (catalogTask === 'stt') return 'Transcription model…';
  if (catalogTask === 'music_generation') return 'Music model…';
  if (catalogTask === 'embedding_text') return 'Embedding model…';
  return 'Model…';
}

function residencyEndpointAvailable(
  contracts: GatewayContracts | null,
  key: 'loaded' | 'load' | 'unload'
): boolean {
  const residency = contracts?.common?.model_residency;
  return descriptorEndpointAvailable(residency?.[key] || residency?.endpoints?.[key]);
}

function displayDate(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

function modelKey(row: ModelResidencyRecord, index: number): string {
  return (
    firstString(row.runtime_id, row.load_id, row.id) ||
    `${firstString(row.task)}:${firstString(row.provider)}:${firstString(row.model)}:${index}`
  );
}

function runtimeIdFor(row: ModelResidencyRecord): string {
  return firstString(row.runtime_id, row.load_id, row.id);
}

function rowDetails(row: ModelResidencyRecord): Record<string, unknown> | null {
  return asRecord(row.details);
}

function rowRuntimeInfo(row: ModelResidencyRecord): Record<string, unknown> | null {
  return asRecord(rowDetails(row)?.runtime_info);
}

function displayModelFor(row: ModelResidencyRecord): string {
  const details = rowDetails(row);
  const runtimeInfo = rowRuntimeInfo(row);
  const direct = firstString(row.model);
  if (direct) return direct;
  const resolved = firstString(
    row.display_model,
    row.resolved_model,
    row.effective_model,
    row.model_id,
    details?.display_model,
    details?.resolved_model,
    details?.model_id,
    details?.model,
    runtimeInfo?.model_id,
    runtimeInfo?.model,
  );
  if (resolved) return resolved;
  const runtimeId = runtimeIdFor(row);
  if (runtimeId.toLowerCase().endsWith(':default')) return 'default';
  return runtimeId || '-';
}

function componentLabelFor(row: ModelResidencyRecord): string {
  const raw = firstString(row.component, rowDetails(row)?.component).toLowerCase();
  if (raw === 'tts_engine') return 'TTS engine';
  if (raw === 'cloning_engine') return 'Clone engine';
  if (raw === 'stt_engine') return 'STT engine';
  if (raw === 'image_engine') return 'Image engine';
  if (raw === 'music_engine') return 'Music engine';
  return raw ? raw.replace(/_/g, ' ') : '-';
}

function isProviderResidentRow(row: ModelResidencyRecord): boolean {
  if (row.provider_resident === true || row.provider_loaded === true) return true;
  if (row.provider_resident === false || row.provider_loaded === false) return false;
  const state = firstString(row.state, row.provider_state).toLowerCase();
  if (state === 'provider_loaded' || state === 'loaded' || state === 'resident') return true;
  return row.loaded === true || row.resident === true;
}

function isDefaultRuntimeConfigRow(row: ModelResidencyRecord): boolean {
  return row.default === true && !isProviderResidentRow(row);
}

function statusText(row: ModelResidencyRecord): string {
  const raw = firstString(row.state, row.health);
  if (raw === 'provider_loaded') return 'provider loaded';
  if (raw === 'provider_not_loaded') return 'provider not loaded';
  if (raw === 'client_cached') return 'runtime client cached';
  if (raw === 'client_cached_unverified') return 'runtime cache unverified';
  if (raw === 'not_found') return 'not resident';
  if (raw === 'not_loaded') return 'not loaded';
  if (isDefaultRuntimeConfigRow(row)) return 'default config';
  return raw || (row.resident === false || row.loaded === false ? 'not resident' : 'resident');
}

function statusKind(row: ModelResidencyRecord): 'ok' | 'muted' | 'error' {
  if (isDefaultRuntimeConfigRow(row)) return 'muted';
  const text = statusText(row).toLowerCase();
  if (firstString(row.error) || text.includes('error') || text.includes('fail') || text.includes('unhealthy')) return 'error';
  if (row.resident === false || row.loaded === false || text.includes('not') || text.includes('unloaded')) return 'muted';
  return 'ok';
}

function residencyResultMessage(result: Record<string, unknown>, fallback: string): string {
  const warning = Array.isArray(result.warnings)
    ? result.warnings.find((item) => typeof item === 'string' && item.trim())
    : '';
  return firstString(result.error, warning, result.message, result.code) || fallback;
}

function unloadButtonTitle(row: ModelResidencyRecord, unloadAvailable: boolean): string | undefined {
  if (!unloadAvailable) return 'Unload endpoint not advertised by this Gateway runtime.';
  if (isDefaultRuntimeConfigRow(row)) {
    return 'This is Gateway/Runtime default configuration, not proof of a loaded provider model. Change Gateway config or restart the Runtime process to remove it.';
  }
  if (row.default === true && row.provider_resident !== true) {
    return 'This default Runtime client is cached, but the provider does not report the model as loaded. Restart Gateway to remove the default client cache.';
  }
  if (row.default === true) {
    return 'This is the default Runtime client; provider unload is best-effort and the Runtime client remains cached.';
  }
  if (row.provider_resident === false) {
    return 'Provider does not report this model as loaded; unload clears the Runtime client cache.';
  }
  return undefined;
}

function canUnloadRow(row: ModelResidencyRecord, unloadAvailable: boolean): boolean {
  return unloadAvailable && !isDefaultRuntimeConfigRow(row);
}

function providerLoadedText(row: ModelResidencyRecord): string {
  if (row.provider_resident === true || row.provider_loaded === true) return 'yes';
  if (row.provider_resident === false || row.provider_loaded === false) return 'no';
  if (row.loaded === true || row.resident === true) return 'runtime cached';
  return '-';
}

function sourceLabel(source: unknown): string {
  const raw = firstString(source);
  if (!raw) return '-';
  if (raw === 'abstractcore.local') return 'AbstractCore config';
  if (raw === 'abstractruntime.local') return 'Runtime config';
  if (raw === 'abstractruntime.discovery_facade') return 'Runtime discovery';
  if (raw === 'abstractcore.capability_defaults') return 'AbstractCore defaults';
  if (raw === 'abstractcore.default_models') return 'AbstractCore global default';
  if (raw === 'abstractcore.vision') return 'AbstractCore vision config';
  if (raw === 'abstractcore.audio') return 'AbstractCore audio config';
  if (raw === 'gateway_config') return 'Gateway runtime config';
  if (raw === 'abstractcore.server') return 'AbstractCore server';
  if (raw === 'flow_defaults') return 'Flow defaults';
  if (raw === 'not_configured') return '-';
  return raw.replace(/_/g, ' ');
}

function routeKindLabel(kind: string): string {
  if (kind === 'input') return 'Input';
  if (kind === 'output') return 'Output';
  if (kind === 'embedding') return 'Embedding';
  if (kind === 'rerank') return 'Rerank';
  return kind || '-';
}

function displayOptions(options: Record<string, unknown> | null | undefined): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return '-';
  const entries = Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return '-';
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

function parseOptionsText(text: string): Record<string, unknown> {
  const raw = text.trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Options must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function statusFromDefault(row: CapabilityDefaultRoute): string {
  if (row.configured) {
    const hasProvider = Boolean(firstString(row.provider));
    const hasModel = Boolean(firstString(row.model));
    if (hasProvider && hasModel) return 'configured';
    return 'partial config';
  }
  return 'not configured';
}

export function ModelResidencyPanel({ isOpen, gatewayContracts, onClose }: ModelResidencyPanelProps) {
  const queryClient = useQueryClient();
  const residency = gatewayContracts?.common?.model_residency;
  const routeAvailable = modelResidencyAvailable(gatewayContracts);
  const loadedAvailable = residencyEndpointAvailable(gatewayContracts, 'loaded');
  const loadAvailable = residencyEndpointAvailable(gatewayContracts, 'load');
  const unloadAvailable = residencyEndpointAvailable(gatewayContracts, 'unload');
  const residencyControlsAvailable = routeAvailable && residency?.available !== false;
  const capabilityDefaultsDescriptor = gatewayContracts?.common?.configuration?.capability_defaults;
  const capabilityDefaultsEndpoint =
    capabilityDefaultsDescriptor && typeof capabilityDefaultsDescriptor.endpoint === 'string'
      ? capabilityDefaultsDescriptor.endpoint
      : '/config/capability-defaults';
  const capabilityDefaultsItemEndpoint =
    capabilityDefaultsDescriptor && typeof capabilityDefaultsDescriptor.item_endpoint === 'string'
      ? capabilityDefaultsDescriptor.item_endpoint
      : '/config/capability-defaults/{kind}/{modality}';
  const capabilityDefaultsAvailable =
    capabilityDefaultsDescriptor?.available !== false && descriptorEndpointAvailable(capabilityDefaultsDescriptor?.endpoint);
  const configHint =
    typeof residency?.config_hint === 'string' && !/abstractcore/i.test(residency.config_hint)
      ? residency.config_hint
      : '';
  const tasks = useMemo(() => taskOptions(gatewayContracts), [gatewayContracts]);
  const [task, setTask] = useState(() => tasks[0]?.value || 'text_generation');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [view, setView] = useState<'loaded' | 'defaults'>('loaded');
  const [pendingUnload, setPendingUnload] = useState<ModelResidencyRecord | null>(null);
  const [editingDefault, setEditingDefault] = useState<ModelDefaultView | null>(null);
  const [defaultDraft, setDefaultDraft] = useState<DefaultDraft>({ provider: '', model: '', baseUrl: '', optionsText: '' });

  useEffect(() => {
    if (tasks.some((option) => option.value === task)) return;
    setTask(tasks[0]?.value || 'text_generation');
    setProvider('');
    setModel('');
  }, [task, tasks]);

  useEffect(() => {
    if (isOpen && view === 'loaded' && !residencyControlsAvailable && capabilityDefaultsAvailable) {
      setView('defaults');
    }
  }, [capabilityDefaultsAvailable, isOpen, residencyControlsAvailable, view]);

  const loadedQuery = useLoadedModels(gatewayContracts, isOpen && residencyControlsAvailable && loadedAvailable);
  const loadMutation = useLoadModelResidency(gatewayContracts);
  const unloadMutation = useUnloadModelResidency(gatewayContracts);

  const providersQuery = useProviders(isOpen && residencyControlsAvailable && task === 'text_generation');
  const modelsQuery = useModels(provider, isOpen && residencyControlsAvailable && task === 'text_generation' && Boolean(provider));
  const visionEndpoint = gatewayContracts?.common?.discovery?.vision_provider_models || '';
  const ttsModelsEndpoint = gatewayContracts?.common?.discovery?.audio_speech_models || '';
  const sttModelsEndpoint = gatewayContracts?.common?.discovery?.audio_transcription_models || '';
  const musicProvidersEndpoint = gatewayContracts?.common?.discovery?.audio_music_providers || '';
  const musicModelsEndpoint = gatewayContracts?.common?.discovery?.audio_music_models || '';
  const embeddingModelsEndpoint = gatewayContracts?.common?.discovery?.embedding_models || '';
  const editingDefaultCatalogTask = defaultCatalogTask(editingDefault);
  const editingDefaultVisionTask = defaultVisionCatalogTask(editingDefault);
  const editingDefaultProvider = defaultDraft.provider.trim();
  const editingDefaultModel = defaultDraft.model.trim();
  const imageCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'vision-provider-models', visionEndpoint],
    queryFn: async () => parseProviderModelCatalog(await gatewayJson<unknown>(gatewayPath(visionEndpoint, {}, { task: 'text_to_image' }))),
    enabled: isOpen && residencyControlsAvailable && task === 'image_generation' && Boolean(visionEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const ttsProviderCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'tts-providers', ttsModelsEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(ttsModelsEndpoint, {}, { providers_only: true })),
    enabled: isOpen && residencyControlsAvailable && task === 'tts' && Boolean(ttsModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const ttsModelsQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'tts-models', ttsModelsEndpoint, provider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(ttsModelsEndpoint, {}, { provider: provider || undefined })),
    enabled: isOpen && residencyControlsAvailable && task === 'tts' && Boolean(ttsModelsEndpoint) && Boolean(provider),
    staleTime: 30_000,
    retry: 1,
  });
  const sttCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'stt-models', sttModelsEndpoint, provider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(sttModelsEndpoint, {}, { provider: provider || undefined })),
    enabled: isOpen && residencyControlsAvailable && task === 'stt' && Boolean(sttModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const musicProvidersQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'music-providers', musicProvidersEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(musicProvidersEndpoint, {}, { task: 'text_to_music' })),
    enabled: isOpen && residencyControlsAvailable && task === 'music_generation' && Boolean(musicProvidersEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const musicModelsQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'music-models', musicModelsEndpoint, provider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(musicModelsEndpoint, {}, { task: 'text_to_music', provider: provider || undefined })),
    enabled: isOpen && residencyControlsAvailable && task === 'music_generation' && Boolean(musicModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultTextProvidersQuery = useProviders(isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'text_generation');
  const defaultTextModelsQuery = useModels(
    editingDefaultProvider,
    isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'text_generation' && Boolean(editingDefaultProvider)
  );
  const defaultImageProviderCatalogQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'vision-provider-catalog', visionEndpoint, editingDefaultVisionTask],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(visionEndpoint, {}, { task: editingDefaultVisionTask, providers_only: true })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'image_generation' && Boolean(visionEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultImageModelCatalogQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'vision-model-catalog', visionEndpoint, editingDefaultVisionTask, editingDefaultProvider],
    queryFn: async () =>
      parseProviderModelCatalog(
        await gatewayJson<unknown>(
          gatewayPath(visionEndpoint, {}, { task: editingDefaultVisionTask, provider: editingDefaultProvider || undefined })
        )
      ),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'image_generation' && Boolean(visionEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultTtsProviderCatalogQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'tts-providers', ttsModelsEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(ttsModelsEndpoint, {}, { providers_only: true })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'tts' && Boolean(ttsModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultTtsModelsQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'tts-models', ttsModelsEndpoint, editingDefaultProvider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(ttsModelsEndpoint, {}, { provider: editingDefaultProvider || undefined })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'tts' && Boolean(ttsModelsEndpoint) && Boolean(editingDefaultProvider),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultSttProviderCatalogQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'stt-providers', sttModelsEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(sttModelsEndpoint, {}, { providers_only: true })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'stt' && Boolean(sttModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultSttModelsQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'stt-models', sttModelsEndpoint, editingDefaultProvider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(sttModelsEndpoint, {}, { provider: editingDefaultProvider || undefined })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'stt' && Boolean(sttModelsEndpoint) && Boolean(editingDefaultProvider),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultMusicProvidersQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'music-providers', musicProvidersEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(musicProvidersEndpoint, {}, { task: 'text_to_music' })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'music_generation' && Boolean(musicProvidersEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultMusicModelsQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'music-models', musicModelsEndpoint, editingDefaultProvider],
    queryFn: async () =>
      gatewayJson<unknown>(gatewayPath(musicModelsEndpoint, {}, { task: 'text_to_music', provider: editingDefaultProvider || undefined })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'music_generation' && Boolean(musicModelsEndpoint) && Boolean(editingDefaultProvider),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultEmbeddingProviderCatalogQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'embedding-providers', embeddingModelsEndpoint],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(embeddingModelsEndpoint, {}, { providers_only: true })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'embedding_text' && Boolean(embeddingModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const defaultEmbeddingModelsQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', 'embedding-models', embeddingModelsEndpoint, editingDefaultProvider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(embeddingModelsEndpoint, {}, { provider: editingDefaultProvider || undefined })),
    enabled: isOpen && Boolean(editingDefault) && editingDefaultCatalogTask === 'embedding_text' && Boolean(embeddingModelsEndpoint) && Boolean(editingDefaultProvider),
    staleTime: 30_000,
    retry: 1,
  });
  const capabilityDefaultsQuery = useQuery({
    queryKey: ['gateway', 'capability-defaults', capabilityDefaultsEndpoint],
    queryFn: async () => gatewayJson<CapabilityDefaultsPayload>(gatewayPath(capabilityDefaultsEndpoint)),
    enabled: isOpen && capabilityDefaultsAvailable && view === 'defaults' && Boolean(capabilityDefaultsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const saveDefaultMutation = useMutation({
    mutationFn: async () => {
      if (!editingDefault) throw new Error('No capability default is selected.');
      const options = parseOptionsText(defaultDraft.optionsText);
      const payload = {
        provider: defaultDraft.provider.trim() || null,
        model: defaultDraft.model.trim() || null,
        base_url: defaultDraft.baseUrl.trim() || null,
        options,
      };
      return gatewayJson<CapabilityDefaultsPayload>(
        gatewayPath(capabilityDefaultsItemEndpoint, { kind: editingDefault.kind, modality: editingDefault.modality }),
        jsonRequest(payload, { method: 'PUT' })
      );
    },
    onSuccess: () => {
      toast.success('Execution default updated');
      setEditingDefault(null);
      queryClient.invalidateQueries({ queryKey: ['gateway', 'capability-defaults'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update execution default');
    },
  });
  const clearDefaultMutation = useMutation({
    mutationFn: async (row: ModelDefaultView) =>
      gatewayJson<CapabilityDefaultsPayload>(
        gatewayPath(capabilityDefaultsItemEndpoint, { kind: row.kind, modality: row.modality }),
        { method: 'DELETE' }
      ),
    onSuccess: () => {
      toast.success('Execution default cleared');
      setEditingDefault(null);
      queryClient.invalidateQueries({ queryKey: ['gateway', 'capability-defaults'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to clear execution default');
    },
  });

  const imagePairs = imageCatalogQuery.data || [];
  const providerOptions = useMemo<AfSelectOption[]>(() => {
    const seen = new Set<string>();
    const out: AfSelectOption[] = [];
    const add = (value: string, label?: string) => {
      const clean = value.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    if (task === 'image_generation') {
      for (const option of imagePairs) add(option.provider);
    } else if (task === 'tts') {
      for (const option of providerOptionsFromGatewayCatalog(ttsProviderCatalogQuery.data, ['tts_providers', 'providers', 'available_providers'], ['models_by_provider', 'tts_models_by_provider'])) add(option.value, option.label);
      for (const option of providerValuesFrom(ttsModelsQuery.data, ['tts_providers', 'providers', 'available_providers'], ['models_by_provider', 'tts_models_by_provider'])) add(option);
    } else if (task === 'stt') {
      for (const option of providerValuesFrom(sttCatalogQuery.data, ['stt_providers', 'providers', 'available_providers'], ['models_by_provider', 'stt_models_by_provider'])) add(option);
    } else if (task === 'music_generation') {
      for (const option of providerOptionsFromGatewayCatalog(musicProvidersQuery.data, ['music_providers', 'providers', 'available_providers', 'provider_details'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
      for (const option of providerOptionsFromGatewayCatalog(musicModelsQuery.data, ['music_providers', 'providers', 'available_providers'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
    } else {
      for (const option of providersQuery.data || []) add(option.name, option.display_name || option.name);
    }
    if (provider) add(provider);
    return out;
  }, [imagePairs, musicModelsQuery.data, musicProvidersQuery.data, provider, providersQuery.data, sttCatalogQuery.data, task, ttsModelsQuery.data, ttsProviderCatalogQuery.data]);

  const modelOptions = useMemo<AfSelectOption[]>(() => {
    const seen = new Set<string>();
    const out: AfSelectOption[] = [];
    const add = (value: string, label?: string) => {
      const clean = value.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    if (task === 'image_generation') {
      for (const option of imagePairs) {
        if (!provider || option.provider === provider) add(option.model, option.label);
      }
    } else if (task === 'tts') {
      for (const option of stringValuesFrom(ttsModelsQuery.data, ['models', 'data', 'tts_models'])) add(option);
    } else if (task === 'stt') {
      for (const option of stringValuesFrom(sttCatalogQuery.data, ['models', 'data', 'stt_models'])) add(option);
    } else if (task === 'music_generation') {
      for (const option of modelOptionsFromGatewayCatalog(musicModelsQuery.data, provider, ['models', 'items', 'data', 'provider_models', 'music_models'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
    } else {
      for (const item of modelsQuery.data || []) add(item);
    }
    if (model) add(model);
    return out;
  }, [imagePairs, model, modelsQuery.data, musicModelsQuery.data, provider, sttCatalogQuery.data, task, ttsModelsQuery.data]);

  const defaultProviderOptions = useMemo<AfSelectOption[]>(() => {
    const seen = new Set<string>();
    const out: AfSelectOption[] = [];
    const add = (value: string, label?: string) => {
      const clean = value.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    if (editingDefaultCatalogTask === 'image_generation') {
      for (const option of providerOptionsFromGatewayCatalog(defaultImageProviderCatalogQuery.data, ['providers', 'available_providers'], ['models_by_provider'])) add(option.value, option.label);
      for (const option of defaultImageModelCatalogQuery.data || []) add(option.provider);
    } else if (editingDefaultCatalogTask === 'tts') {
      for (const option of providerOptionsFromGatewayCatalog(defaultTtsProviderCatalogQuery.data, ['tts_providers', 'providers', 'available_providers'], ['models_by_provider', 'tts_models_by_provider'])) add(option.value, option.label);
    } else if (editingDefaultCatalogTask === 'stt') {
      for (const option of providerOptionsFromGatewayCatalog(defaultSttProviderCatalogQuery.data, ['stt_providers', 'providers', 'available_providers'], ['models_by_provider', 'stt_models_by_provider'])) add(option.value, option.label);
    } else if (editingDefaultCatalogTask === 'music_generation') {
      for (const option of providerOptionsFromGatewayCatalog(defaultMusicProvidersQuery.data, ['music_providers', 'providers', 'available_providers', 'provider_details'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
      for (const option of providerOptionsFromGatewayCatalog(defaultMusicModelsQuery.data, ['music_providers', 'providers', 'available_providers'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
    } else if (editingDefaultCatalogTask === 'embedding_text') {
      for (const option of providerOptionsFromGatewayCatalog(defaultEmbeddingProviderCatalogQuery.data, ['providers', 'available_providers', 'embedding_providers'], ['models_by_provider', 'embedding_models_by_provider'])) add(option.value, option.label);
    } else if (editingDefaultCatalogTask === 'text_generation') {
      for (const option of defaultTextProvidersQuery.data || []) add(option.name, option.display_name || option.name);
    }
    if (editingDefaultProvider) add(editingDefaultProvider);
    return out;
  }, [
    defaultImageModelCatalogQuery.data,
    defaultImageProviderCatalogQuery.data,
    defaultMusicModelsQuery.data,
    defaultMusicProvidersQuery.data,
    defaultEmbeddingProviderCatalogQuery.data,
    defaultSttProviderCatalogQuery.data,
    defaultTextProvidersQuery.data,
    defaultTtsProviderCatalogQuery.data,
    editingDefaultCatalogTask,
    editingDefaultProvider,
  ]);

  const defaultModelOptions = useMemo<AfSelectOption[]>(() => {
    const seen = new Set<string>();
    const out: AfSelectOption[] = [];
    const add = (value: string, label?: string) => {
      const clean = value.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    if (editingDefaultCatalogTask === 'image_generation') {
      for (const option of defaultImageModelCatalogQuery.data || []) {
        if (!editingDefaultProvider || option.provider === editingDefaultProvider) add(option.model, option.label);
      }
    } else if (editingDefaultCatalogTask === 'tts') {
      for (const option of modelOptionsFromGatewayCatalog(defaultTtsModelsQuery.data, editingDefaultProvider, ['models', 'data', 'tts_models'], ['models_by_provider', 'tts_models_by_provider'])) add(option.value, option.label);
      for (const option of stringValuesFrom(defaultTtsModelsQuery.data, ['models', 'data', 'tts_models'])) add(option);
    } else if (editingDefaultCatalogTask === 'stt') {
      for (const option of modelOptionsFromGatewayCatalog(defaultSttModelsQuery.data, editingDefaultProvider, ['models', 'data', 'stt_models'], ['models_by_provider', 'stt_models_by_provider'])) add(option.value, option.label);
      for (const option of stringValuesFrom(defaultSttModelsQuery.data, ['models', 'data', 'stt_models'])) add(option);
    } else if (editingDefaultCatalogTask === 'music_generation') {
      for (const option of modelOptionsFromGatewayCatalog(defaultMusicModelsQuery.data, editingDefaultProvider, ['models', 'items', 'data', 'provider_models', 'music_models'], ['models_by_provider', 'music_models_by_provider'])) add(option.value, option.label);
    } else if (editingDefaultCatalogTask === 'embedding_text') {
      for (const option of modelOptionsFromGatewayCatalog(defaultEmbeddingModelsQuery.data, editingDefaultProvider, ['models', 'data', 'embedding_models'], ['models_by_provider', 'embedding_models_by_provider'])) add(option.value, option.label);
      for (const option of stringValuesFrom(defaultEmbeddingModelsQuery.data, ['models', 'data', 'embedding_models'])) add(option);
    } else if (editingDefaultCatalogTask === 'text_generation') {
      for (const option of defaultTextModelsQuery.data || []) add(option);
    }
    if (editingDefaultModel) add(editingDefaultModel);
    return out;
  }, [
    defaultImageModelCatalogQuery.data,
    defaultMusicModelsQuery.data,
    defaultEmbeddingModelsQuery.data,
    defaultSttModelsQuery.data,
    defaultTextModelsQuery.data,
    defaultTtsModelsQuery.data,
    editingDefaultCatalogTask,
    editingDefaultModel,
    editingDefaultProvider,
  ]);

  const rows = loadedQuery.data?.models || [];
  const providerResidentRows = useMemo(() => rows.filter(isProviderResidentRow), [rows]);
  const defaultConfigRows = useMemo(
    () => rows.filter((row) => row.default === true || !isProviderResidentRow(row)),
    [rows]
  );
  const hiddenConfigurationRows = Math.max(0, rows.length - providerResidentRows.length);
  const defaultViews = useMemo<ModelDefaultView[]>(() => {
    const capabilityRows = Array.isArray(capabilityDefaultsQuery.data?.routes)
      ? capabilityDefaultsQuery.data.routes
      : [];
    if (capabilityRows.length > 0) {
      return capabilityRows.map((route) => {
        const kind = firstString(route.kind, route.direction) || 'output';
        const modality = firstString(route.modality) || 'text';
        const id = firstString(route.key) || `${kind}.${modality}`;
        const taskName = firstString(route.task) || id;
        const options = route.options && typeof route.options === 'object' && !Array.isArray(route.options)
          ? route.options
          : {};
        return {
          id,
          kind,
          modality,
          task: taskName,
          label: firstString(route.label) || taskLabel(taskName),
          provider: firstString(route.provider) || '-',
          model: firstString(route.model) || '-',
          baseUrl: firstString(route.base_url) || '-',
          options,
          source: sourceLabel(route.source),
          sourceRaw: firstString(route.source),
          status: statusFromDefault(route),
          configured: Boolean(route.configured),
        };
      });
    }
    return [];
  }, [capabilityDefaultsQuery.data]);
  const busy = loadMutation.isPending || unloadMutation.isPending;
  const loadDisabled = !residencyControlsAvailable || !loadAvailable || busy || !task;
  const partialControlHint =
    !loadedAvailable
      ? 'This Gateway runtime does not advertise loaded-model listing.'
      : !loadAvailable && !unloadAvailable
        ? 'This Gateway runtime currently exposes read-only residency state.'
        : !loadAvailable
          ? 'This Gateway runtime advertises unload/list controls only.'
          : !unloadAvailable
            ? 'This Gateway runtime advertises load/list controls only.'
            : '';
  const providerPlaceholder =
    task === 'image_generation'
      ? 'Image provider…'
      : task === 'tts'
        ? 'Speech provider…'
        : task === 'stt'
          ? 'Transcription provider…'
          : task === 'music_generation'
            ? 'Music provider…'
          : 'Provider…';
  const modelPlaceholder =
    !provider
      ? 'Pick provider…'
      : task === 'image_generation'
        ? 'Image model…'
        : task === 'tts'
          ? 'Speech model…'
          : task === 'stt'
            ? 'Transcription model…'
            : task === 'music_generation'
              ? 'Music model…'
            : 'Model…';
  const providerLoading =
    providersQuery.isLoading ||
    imageCatalogQuery.isLoading ||
    ttsProviderCatalogQuery.isLoading ||
    ttsModelsQuery.isLoading ||
    sttCatalogQuery.isLoading ||
    musicProvidersQuery.isLoading ||
    musicModelsQuery.isLoading;
  const modelLoading =
    modelsQuery.isLoading ||
    imageCatalogQuery.isLoading ||
    ttsModelsQuery.isLoading ||
    sttCatalogQuery.isLoading ||
    musicModelsQuery.isLoading;
  const defaultProviderLoading =
    defaultTextProvidersQuery.isLoading ||
    defaultImageProviderCatalogQuery.isLoading ||
    defaultImageModelCatalogQuery.isLoading ||
    defaultTtsProviderCatalogQuery.isLoading ||
    defaultSttProviderCatalogQuery.isLoading ||
    defaultMusicProvidersQuery.isLoading ||
    defaultMusicModelsQuery.isLoading ||
    defaultEmbeddingProviderCatalogQuery.isLoading;
  const defaultModelLoading =
    defaultTextModelsQuery.isLoading ||
    defaultImageModelCatalogQuery.isLoading ||
    defaultTtsModelsQuery.isLoading ||
    defaultSttModelsQuery.isLoading ||
    defaultMusicModelsQuery.isLoading ||
    defaultEmbeddingModelsQuery.isLoading;

  const loadSelected = async () => {
    if (loadDisabled) return;
    try {
      const result = await loadMutation.mutateAsync({
        task,
        provider: provider.trim() || undefined,
        model: model.trim() || undefined,
      });
      if (result.ok === false) {
        toast.error(residencyResultMessage(result, 'Model load request failed'));
      } else {
        const msg = residencyResultMessage(
          result,
          result.loaded_new === false ? 'Model was not newly loaded' : 'Model load requested'
        );
        if (result.loaded_new === false) toast(msg);
        else toast.success(msg);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model load request failed');
    }
  };

  const unloadRow = async (row: ModelResidencyRecord) => {
    const rid = runtimeIdFor(row);
    const p = firstString(row.provider);
    const m = firstString(row.model);
    try {
      const result = await unloadMutation.mutateAsync({
        task: firstString(row.task) || undefined,
        runtime_id: rid || undefined,
        provider: rid ? undefined : p || undefined,
        model: rid ? undefined : m || undefined,
      });
      setPendingUnload(null);
      if (result.ok === false) {
        toast.error(residencyResultMessage(result, 'Model unload request failed'));
      } else {
        const msg = residencyResultMessage(result, result.unloaded === false ? 'No resident provider model was unloaded' : 'Model unloaded');
        if (result.unloaded === false) toast(msg);
        else toast.success(msg);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model unload request failed');
    }
  };

  const pendingUnloadRuntimeId = pendingUnload ? runtimeIdFor(pendingUnload) : '';
  const pendingUnloadProvider = pendingUnload ? firstString(pendingUnload.provider) : '';
  const pendingUnloadModel = pendingUnload ? displayModelFor(pendingUnload) : '';
  const pendingUnloadLabel =
    [pendingUnloadProvider, pendingUnloadModel].filter(Boolean).join(' / ') ||
    pendingUnloadRuntimeId ||
    'selected model';
  const openDefaultEditor = (row: ModelDefaultView) => {
    setDefaultDraft({
      provider: row.provider === '-' ? '' : row.provider,
      model: row.model === '-' ? '' : row.model,
      baseUrl: row.baseUrl === '-' ? '' : row.baseUrl,
      optionsText: row.options && Object.keys(row.options).length > 0 ? JSON.stringify(row.options, null, 2) : '',
    });
    setEditingDefault(row);
  };
  const defaultEditBusy = saveDefaultMutation.isPending || clearDefaultMutation.isPending;
  const capabilityDefaultsWritable = capabilityDefaultsQuery.data?.writable !== false;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal model-residency-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-residency-header">
          <div>
            <h3>Model Residency</h3>
            <p>Provider-loaded models and execution defaults are tracked separately.</p>
          </div>
          <button type="button" className="modal-button cancel" onClick={onClose}>Close</button>
        </div>

        {!residencyControlsAvailable && !capabilityDefaultsAvailable ? (
          <div className="model-residency-empty">
            Gateway does not advertise model residency or capability-default controls.
            {configHint ? <span>{configHint}</span> : null}
          </div>
        ) : (
          <>
            <div className="model-residency-tabs" role="tablist" aria-label="Model residency views">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'loaded'}
                className={`model-residency-tab ${view === 'loaded' ? 'active' : ''}`}
                disabled={!residencyControlsAvailable}
                onClick={() => setView('loaded')}
              >
                Loaded models
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'defaults'}
                className={`model-residency-tab ${view === 'defaults' ? 'active' : ''}`}
                disabled={!capabilityDefaultsAvailable}
                onClick={() => setView('defaults')}
              >
                Defaults
              </button>
            </div>

            {view === 'loaded' ? (
              !residencyControlsAvailable ? (
                <div className="model-residency-empty">
                  Model residency controls are not active for this Gateway runtime.
                  {configHint ? <span>{configHint}</span> : null}
                </div>
              ) : (
              <>
                <div className="model-residency-loadbar">
                  <AfSelect
                    value={task}
                    options={tasks}
                    placeholder="Task"
                    searchable={false}
                    minPopoverWidth={180}
                    onChange={(value) => {
                      setTask(value || tasks[0]?.value || 'text_generation');
                      setProvider('');
                      setModel('');
                    }}
                  />
                  <AfSelect
                    value={provider}
                    options={providerOptions}
                    placeholder={providerPlaceholder}
                    loading={providerLoading}
                    allowCustom
                    clearable
                    minPopoverWidth={280}
                    onChange={(value) => {
                      setProvider(value);
                      setModel('');
                    }}
                  />
                  <AfSelect
                    value={model}
                    options={modelOptions}
                    placeholder={modelPlaceholder}
                    disabled={!provider}
                    loading={modelLoading}
                    allowCustom
                    clearable
                    minPopoverWidth={420}
                    onChange={setModel}
                  />
                  <button type="button" className="modal-button primary" disabled={loadDisabled} onClick={loadSelected} title={!loadAvailable ? 'Load endpoint not advertised by this Gateway runtime.' : undefined}>
                    Load
                  </button>
                  <button type="button" className="modal-button" onClick={() => loadedQuery.refetch()} disabled={!loadedAvailable || loadedQuery.isFetching}>
                    Refresh
                  </button>
                </div>

                <div className="model-residency-note">
                  Only provider-reported resident models appear here. Default routing and Runtime cache rows are on the Defaults tab.
                  {hiddenConfigurationRows > 0 ? ` ${hiddenConfigurationRows} configuration/cache row${hiddenConfigurationRows === 1 ? '' : 's'} hidden from this list.` : ''}
                </div>

                {partialControlHint ? (
                  <div className="model-residency-empty">
                    {partialControlHint}
                  </div>
                ) : null}

                {!loadedAvailable ? (
                  <div className="model-residency-empty">
                    Loaded-model listing is not available on this Gateway runtime.
                  </div>
                ) : loadedQuery.isError ? (
                  <div className="model-residency-empty">
                    Failed to read loaded models: {loadedQuery.error instanceof Error ? loadedQuery.error.message : 'unknown error'}
                  </div>
                ) : providerResidentRows.length === 0 ? (
                  <div className="model-residency-empty">
                    {loadedQuery.isLoading ? 'Loading resident models…' : 'No provider-resident models reported.'}
                  </div>
                ) : (
                  <div className="model-residency-table-wrap">
                    <table className="model-residency-table">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Provider</th>
                          <th>Model</th>
                          <th>Component</th>
                          <th>Runtime</th>
                          <th>Status</th>
                          <th>Provider Loaded</th>
                          <th>Last Used</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {providerResidentRows.map((row, index) => (
                          <tr key={modelKey(row, index)}>
                            <td>{taskLabel(firstString(row.task) || 'model')}</td>
                            <td>{firstString(row.provider) || '-'}</td>
                            <td className="model-residency-model">{displayModelFor(row)}</td>
                            <td>{componentLabelFor(row)}</td>
                            <td className="model-residency-runtime">
                              {runtimeIdFor(row) || '-'}
                              {firstString(row.source) ? <span>{firstString(row.source)}</span> : null}
                            </td>
                            <td>
                              <span className={`model-residency-status model-residency-status--${statusKind(row)}`}>
                                {statusText(row)}
                              </span>
                            </td>
                            <td>{providerLoadedText(row)}</td>
                            <td>{displayDate(row.last_used_at) || '-'}</td>
                            <td>
                              <button type="button" className="modal-button danger" disabled={busy || !canUnloadRow(row, unloadAvailable)} onClick={() => setPendingUnload(row)} title={unloadButtonTitle(row, unloadAvailable)}>
                                Unload
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
              )
            ) : (
              <>
                <div className="model-residency-note">
                  Capability route defaults are execution-host configuration. These rows do not imply a provider has the model loaded.
                </div>
                <div className="model-residency-table-wrap">
                  <table className="model-residency-table model-residency-defaults-table">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th>Capability</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>Base URL</th>
                        <th>Options</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {defaultViews.map((row) => (
                        <tr key={row.id}>
                          <td>{routeKindLabel(row.kind)}</td>
                          <td>{row.label}</td>
                          <td>{row.provider}</td>
                          <td className="model-residency-model">{row.model}</td>
                          <td className="model-residency-runtime">{row.baseUrl}</td>
                          <td className="model-residency-runtime">{displayOptions(row.options)}</td>
                          <td>{row.source}</td>
                          <td>
                            <span className={`model-residency-status ${row.configured && row.status === 'configured' ? '' : 'model-residency-status--muted'}`}>
                              {row.status}
                            </span>
                          </td>
                          <td>
                            <button type="button" className="modal-button" onClick={() => openDefaultEditor(row)}>
                              Set
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {capabilityDefaultsQuery.isError ? (
                  <div className="model-residency-empty">
                    Failed to read capability defaults: {capabilityDefaultsQuery.error instanceof Error ? capabilityDefaultsQuery.error.message : 'unknown error'}
                  </div>
                ) : null}
                {Array.isArray(capabilityDefaultsQuery.data?.errors) && capabilityDefaultsQuery.data.errors.length > 0 ? (
                  <div className="model-residency-empty">
                    {capabilityDefaultsQuery.data.errors.join(' ')}
                  </div>
                ) : null}
                {capabilityDefaultsQuery.data?.config_hint ? (
                  <div className="model-residency-empty">
                    {capabilityDefaultsQuery.data.config_hint}
                  </div>
                ) : null}
                {defaultConfigRows.length > 0 ? (
                  <div className="model-residency-note">
                    Runtime configuration/cache records: {defaultConfigRows.length}
                  </div>
                ) : null}
              </>
            )}
            {pendingUnload ? (
              <div className="model-residency-confirm-backdrop" role="presentation" onClick={() => setPendingUnload(null)}>
                <div
                  className="model-residency-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="model-residency-confirm-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 id="model-residency-confirm-title">Unload Model</h4>
                  <p>
                    Unload <strong>{pendingUnloadLabel}</strong> from the provider?
                  </p>
                  <div className="modal-actions">
                    <button type="button" className="modal-button cancel" onClick={() => setPendingUnload(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" className="modal-button danger" onClick={() => unloadRow(pendingUnload)} disabled={busy}>
                      Unload
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {editingDefault ? (
              <div className="model-residency-confirm-backdrop" role="presentation" onClick={() => !defaultEditBusy && setEditingDefault(null)}>
                <div
                  className="model-residency-confirm model-residency-default-editor"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="model-residency-default-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 id="model-residency-default-title">Set Execution Default</h4>
                  <p>
                    {routeKindLabel(editingDefault.kind)} / {editingDefault.label}
                  </p>
                  <div className="model-residency-default-form">
                    <label>
                      <span>Provider</span>
                      <AfSelect
                        value={defaultDraft.provider}
                        options={defaultProviderOptions}
                        placeholder={defaultProviderPlaceholder(editingDefaultCatalogTask)}
                        loading={defaultProviderLoading}
                        allowCustom
                        clearable
                        minPopoverWidth={320}
                        onChange={(value) => setDefaultDraft((prev) => ({ ...prev, provider: value, model: '' }))}
                      />
                    </label>
                    <label>
                      <span>Model</span>
                      <AfSelect
                        value={defaultDraft.model}
                        options={defaultModelOptions}
                        placeholder={defaultModelPlaceholder(editingDefaultCatalogTask, editingDefaultProvider)}
                        disabled={!editingDefaultProvider}
                        loading={defaultModelLoading}
                        allowCustom
                        clearable
                        minPopoverWidth={440}
                        onChange={(value) => setDefaultDraft((prev) => ({ ...prev, model: value }))}
                      />
                    </label>
                    <label>
                      <span>Base URL</span>
                      <input
                        value={defaultDraft.baseUrl}
                        onChange={(event) => setDefaultDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                        placeholder="http://127.0.0.1:1234/v1"
                      />
                    </label>
                    <label>
                      <span>Options JSON</span>
                      <textarea
                        value={defaultDraft.optionsText}
                        onChange={(event) => setDefaultDraft((prev) => ({ ...prev, optionsText: event.target.value }))}
                        placeholder='{"voice":"M1"}'
                        rows={4}
                      />
                    </label>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="modal-button cancel" onClick={() => setEditingDefault(null)} disabled={defaultEditBusy}>
                      Cancel
                    </button>
                    <button type="button" className="modal-button" onClick={() => clearDefaultMutation.mutate(editingDefault)} disabled={defaultEditBusy || !capabilityDefaultsWritable || editingDefault.sourceRaw !== 'abstractcore.capability_defaults'}>
                      Clear
                    </button>
                    <button type="button" className="modal-button primary" onClick={() => saveDefaultMutation.mutate()} disabled={defaultEditBusy || !capabilityDefaultsWritable}>
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default ModelResidencyPanel;
