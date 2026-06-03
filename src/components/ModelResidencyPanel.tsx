import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useModels, useProviders } from '../hooks/useProviders';
import {
  modelResidencyAvailable,
  useLoadedModels,
  useLoadModelResidency,
  useUnloadModelResidency,
  type ModelResidencyRecord,
} from '../hooks/useModelResidency';
import { descriptorEndpointAvailable, gatewayJson, gatewayPath, type GatewayContracts } from '../utils/gatewayClient';
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
  if (task === 'image_to_image') return 'Image edit';
  if (task === 'text_to_video') return 'Text to video';
  if (task === 'image_to_video') return 'Image to video';
  if (task === 'tts') return 'Speech';
  if (task === 'stt') return 'Transcription';
  if (task === 'music_generation') return 'Music';
  return task.replace(/_/g, ' ');
}

function isVisionCatalogTask(task: string): boolean {
  return task === 'image_generation' || task === 'image_to_image' || task === 'text_to_video' || task === 'image_to_video';
}

function visionProviderModelsTask(task: string): string {
  if (task === 'image_to_image') return 'image_to_image';
  if (task === 'text_to_video' || task === 'image_to_video') return task;
  return 'text_to_image';
}

function taskOptions(contracts: GatewayContracts | null): AfSelectOption[] {
  const residency = contracts?.common?.model_residency;
  const canonicalTasks = ['text_generation', 'image_generation', 'image_to_image', 'text_to_video', 'image_to_video', 'tts', 'stt', 'music_generation'];
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

export function ModelResidencyPanel({ isOpen, gatewayContracts, onClose }: ModelResidencyPanelProps) {
  const residency = gatewayContracts?.common?.model_residency;
  const routeAvailable = modelResidencyAvailable(gatewayContracts);
  const loadedAvailable = residencyEndpointAvailable(gatewayContracts, 'loaded');
  const loadAvailable = residencyEndpointAvailable(gatewayContracts, 'load');
  const unloadAvailable = residencyEndpointAvailable(gatewayContracts, 'unload');
  const residencyControlsAvailable = routeAvailable && residency?.available !== false;
  const configHint =
    typeof residency?.config_hint === 'string' && !/abstractcore/i.test(residency.config_hint)
      ? residency.config_hint
      : '';
  const tasks = useMemo(() => taskOptions(gatewayContracts), [gatewayContracts]);
  const [task, setTask] = useState(() => tasks[0]?.value || 'text_generation');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [pendingUnload, setPendingUnload] = useState<ModelResidencyRecord | null>(null);

  useEffect(() => {
    if (tasks.some((option) => option.value === task)) return;
    setTask(tasks[0]?.value || 'text_generation');
    setProvider('');
    setModel('');
  }, [task, tasks]);

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
  const selectedVisionTask = visionProviderModelsTask(task);
  const imageCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'vision-provider-models', visionEndpoint, selectedVisionTask],
    queryFn: async () => parseProviderModelCatalog(await gatewayJson<unknown>(gatewayPath(visionEndpoint, {}, { task: selectedVisionTask }))),
    enabled: isOpen && residencyControlsAvailable && isVisionCatalogTask(task) && Boolean(visionEndpoint),
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
    if (isVisionCatalogTask(task)) {
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
    if (isVisionCatalogTask(task)) {
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

  const rows = loadedQuery.data?.models || [];
  const providerResidentRows = useMemo(() => rows.filter(isProviderResidentRow), [rows]);
  const hiddenConfigurationRows = Math.max(0, rows.length - providerResidentRows.length);
  const busy = loadMutation.isPending || unloadMutation.isPending;
  const loadDisabled = !residencyControlsAvailable || !loadAvailable || busy || !task || !provider.trim() || !model.trim();
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
      : task === 'image_to_image'
        ? 'Image edit provider…'
      : task === 'text_to_video' || task === 'image_to_video'
        ? 'Video provider…'
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
        : task === 'image_to_image'
          ? 'Image edit model…'
        : task === 'text_to_video' || task === 'image_to_video'
          ? 'Video model…'
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal model-residency-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-residency-header">
          <div>
            <h3>Model Residency</h3>
            <p>Provider-loaded models reported by the Gateway execution host.</p>
          </div>
          <button type="button" className="modal-button cancel" onClick={onClose}>Close</button>
        </div>

        {!residencyControlsAvailable ? (
          <div className="model-residency-empty">
            Gateway does not advertise model residency controls.
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
              <button
                type="button"
                className="modal-button primary"
                disabled={loadDisabled}
                onClick={loadSelected}
                title={!loadAvailable ? 'Load endpoint not advertised by this Gateway runtime.' : !provider.trim() || !model.trim() ? 'Choose an explicit provider and model to load.' : undefined}
              >
                Load
              </button>
              <button type="button" className="modal-button" onClick={() => loadedQuery.refetch()} disabled={!loadedAvailable || loadedQuery.isFetching}>
                Refresh
              </button>
            </div>

            <div className="model-residency-note">
              Only provider-reported resident models appear here. Configure Gateway/Core routing defaults from the Gateway Console multimodal capabilities tab.
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
          </>
        )}
      </div>
    </div>
  );
}

export default ModelResidencyPanel;
