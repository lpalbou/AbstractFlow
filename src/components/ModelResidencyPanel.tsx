import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useModels, useProviders } from '../hooks/useProviders';
import { TEXT_OUTPUT_CAPABILITY_ROUTE } from '../utils/capabilityRoutes';
import {
  hostStateAvailable,
  modelResidencyAvailable,
  modelResidencyEndpointAvailable,
  residencyResponseHasRowV1,
  sessionCacheClearAvailable,
  sessionCachesAvailable,
  useClearSessionCache,
  useContextEstimate,
  useHostState,
  useLoadedModels,
  useLoadModelResidency,
  useLockModel,
  useSessionCaches,
  useUnloadModelResidency,
  useUnlockModel,
  type ModelResidencyRecord,
  type ModelResidencyRowV1,
} from '../hooks/useModelResidency';
import { gatewayJson, gatewayPath, type GatewayContracts } from '../utils/gatewayClient';
import {
  buildHostMemoryView,
  buildSessionCacheViews,
  canUnloadRow,
  componentLabelFor,
  contextEstimateHint,
  displayDate,
  displayModelFor,
  filterResidencyRows,
  firstString,
  modelKey,
  providerLoadedText,
  residencyResultMessage,
  residentStateLabel,
  resolveModalityChip,
  rowConfigOnlyV1,
  rowContextView,
  rowKeyV1,
  rowLockAction,
  rowLockAdopts,
  rowResidentState,
  rowSizeCell,
  rowStateKindV1,
  runtimeIdFor,
  statusKind,
  statusText,
  taskLabel,
  unloadButtonTitle,
  unloadConflictOffersForce,
  type SessionCacheView,
} from '../utils/modelResidencyView';
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

type PanelTab = 'models' | 'memory' | 'caches';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function isVisionCatalogTask(task: string): boolean {
  return task === 'image_generation' || task === 'image_to_image' || task === 'image_upscale' || task === 'text_to_video' || task === 'image_to_video';
}

function visionProviderModelsTask(task: string): string {
  if (task === 'image_to_image') return 'image_to_image';
  if (task === 'image_upscale') return 'image_upscale';
  if (task === 'text_to_video' || task === 'image_to_video') return task;
  return 'text_to_image';
}

function taskOptions(contracts: GatewayContracts | null): AfSelectOption[] {
  const residency = contracts?.common?.model_residency;
  const canonicalTasks = ['text_generation', 'image_generation', 'image_to_image', 'image_upscale', 'text_to_video', 'image_to_video', 'tts', 'stt', 'music_generation'];
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

interface PendingUnload {
  row: ModelResidencyRecord;
  force: boolean;
}

interface EstimateTarget {
  key: string;
  provider: string;
  model: string;
  contextLength: number | null;
}

export function ModelResidencyPanel({ isOpen, gatewayContracts, onClose }: ModelResidencyPanelProps) {
  const residency = gatewayContracts?.common?.model_residency;
  const routeAvailable = modelResidencyAvailable(gatewayContracts);
  const loadedAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'loaded');
  const loadAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'load');
  const unloadAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'unload');
  const lockAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'lock');
  const unlockAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'unlock');
  const estimateAvailable = modelResidencyEndpointAvailable(gatewayContracts, 'context_estimate');
  const hostStateOk = hostStateAvailable(gatewayContracts);
  const cachesOk = sessionCachesAvailable(gatewayContracts);
  const cacheClearOk = sessionCacheClearAvailable(gatewayContracts);
  const modalityUi = residency?.modality_ui || null;
  const residencyControlsAvailable = routeAvailable && residency?.available !== false;
  const configHint =
    typeof residency?.config_hint === 'string' && !/abstractcore/i.test(residency.config_hint)
      ? residency.config_hint
      : '';
  const tasks = useMemo(() => taskOptions(gatewayContracts), [gatewayContracts]);
  const [tab, setTab] = useState<PanelTab>('models');
  const [task, setTask] = useState(() => tasks[0]?.value || 'text_generation');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [lockOnLoad, setLockOnLoad] = useState(false);
  const [showNonResident, setShowNonResident] = useState(false);
  const [pendingUnload, setPendingUnload] = useState<PendingUnload | null>(null);
  const [pendingClearCache, setPendingClearCache] = useState<SessionCacheView | null>(null);
  const [estimateTarget, setEstimateTarget] = useState<EstimateTarget | null>(null);

  useEffect(() => {
    if (tasks.some((option) => option.value === task)) return;
    setTask(tasks[0]?.value || 'text_generation');
    setProvider('');
    setModel('');
  }, [task, tasks]);

  // Transient dialog/detail state must not survive a close: a stale (possibly
  // force-upgraded) unload confirm or clear-cache confirm reappearing on the
  // next open could fire against rows that no longer exist.
  useEffect(() => {
    if (isOpen) return;
    setPendingUnload(null);
    setPendingClearCache(null);
    setEstimateTarget(null);
  }, [isOpen]);

  const loadedQuery = useLoadedModels(gatewayContracts, isOpen && residencyControlsAvailable && loadedAvailable);
  const loadMutation = useLoadModelResidency(gatewayContracts);
  const unloadMutation = useUnloadModelResidency(gatewayContracts);
  const lockMutation = useLockModel(gatewayContracts);
  const unlockMutation = useUnlockModel(gatewayContracts);
  const clearCacheMutation = useClearSessionCache(gatewayContracts);
  // /host/state is slow: only poll while the panel is open on the Memory tab.
  const hostStateQuery = useHostState(gatewayContracts, isOpen && tab === 'memory' && hostStateOk);
  const sessionCachesQuery = useSessionCaches(gatewayContracts, isOpen && tab === 'caches' && cachesOk);
  const loadEstimateQuery = useContextEstimate(
    gatewayContracts,
    { provider: provider.trim(), model: model.trim() },
    isOpen && tab === 'models' && estimateAvailable && residencyControlsAvailable
  );
  const rowEstimateQuery = useContextEstimate(
    gatewayContracts,
    {
      provider: estimateTarget?.provider || '',
      model: estimateTarget?.model || '',
      context_length: estimateTarget?.contextLength ?? undefined,
    },
    isOpen && tab === 'models' && estimateAvailable && Boolean(estimateTarget)
  );

  const providersQuery = useProviders(isOpen && residencyControlsAvailable && task === 'text_generation');
  const modelsQuery = useModels(provider, isOpen && residencyControlsAvailable && task === 'text_generation' && Boolean(provider), TEXT_OUTPUT_CAPABILITY_ROUTE);
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

  const rows = useMemo(() => loadedQuery.data?.models || [], [loadedQuery.data]);
  const rowV1 = residencyResponseHasRowV1(loadedQuery.data);
  const { visible: visibleRows, hiddenCount } = useMemo(
    () => filterResidencyRows(rows, rowV1, showNonResident),
    [rows, rowV1, showNonResident]
  );
  const busy =
    loadMutation.isPending ||
    unloadMutation.isPending ||
    lockMutation.isPending ||
    unlockMutation.isPending ||
    clearCacheMutation.isPending;
  const loadDisabled = !residencyControlsAvailable || !loadAvailable || busy || !task || !provider.trim() || !model.trim();
  const loadEstimateHint =
    provider.trim() && model.trim() && estimateAvailable
      ? loadEstimateQuery.isLoading
        ? 'Estimating usable context…'
        : contextEstimateHint(loadEstimateQuery.data)
      : '';
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
        : task === 'image_upscale'
          ? 'Image upscaler provider…'
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
          : task === 'image_upscale'
            ? 'Image upscaler model…'
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
        lock: lockOnLoad || undefined,
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

  const unloadRow = async (pending: PendingUnload) => {
    const { row, force } = pending;
    const rid = runtimeIdFor(row);
    const p = firstString(row.provider);
    const m = firstString(row.model);
    const preferProviderModel = rowV1 && p && m;
    try {
      const result = await unloadMutation.mutateAsync({
        task: firstString(row.task) || undefined,
        runtime_id: preferProviderModel ? undefined : rid || undefined,
        provider: preferProviderModel || !rid ? p || undefined : undefined,
        model: preferProviderModel || !rid ? m || undefined : undefined,
        force: force || undefined,
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
      if (!force && unloadConflictOffersForce(error)) {
        // 409 model_locked: keep the dialog open, upgraded to a force confirm.
        setPendingUnload({ row, force: true });
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Model unload request failed');
    }
  };

  const toggleLockRow = async (row: ModelResidencyRowV1, lock: boolean) => {
    const rid = firstString(row.runtime_id);
    const payload = rid
      ? { runtime_id: rid }
      : { provider: firstString(row.provider) || undefined, model: firstString(row.model) || undefined };
    try {
      const mutation = lock ? lockMutation : unlockMutation;
      const result = await mutation.mutateAsync(payload);
      if (result.ok === false) {
        toast.error(residencyResultMessage(result, lock ? 'Model lock request failed' : 'Model unlock request failed'));
      } else {
        toast.success(lock ? 'Model locked' : 'Model unlocked');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : lock ? 'Model lock request failed' : 'Model unlock request failed');
    }
  };

  const clearSessionCache = async (cache: SessionCacheView) => {
    try {
      await clearCacheMutation.mutateAsync(cache.sessionId);
      setPendingClearCache(null);
      toast.success('Session prompt cache cleared');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Session cache clear failed');
    }
  };

  const toggleEstimateRow = (key: string, row: ModelResidencyRowV1) => {
    if (estimateTarget?.key === key) {
      setEstimateTarget(null);
      return;
    }
    const contextLength = typeof row.context_length === 'number' && Number.isFinite(row.context_length) ? row.context_length : null;
    setEstimateTarget({
      key,
      provider: firstString(row.provider),
      model: firstString(row.model),
      contextLength,
    });
  };

  const pendingRow = pendingUnload?.row || null;
  const pendingUnloadRuntimeId = pendingRow ? runtimeIdFor(pendingRow) : '';
  const pendingUnloadProvider = pendingRow ? firstString(pendingRow.provider) : '';
  const pendingUnloadModel = pendingRow ? displayModelFor(pendingRow) : '';
  const pendingUnloadLabel =
    [pendingUnloadProvider, pendingUnloadModel].filter(Boolean).join(' / ') ||
    pendingUnloadRuntimeId ||
    'selected model';

  const memoryView = useMemo(() => buildHostMemoryView(hostStateQuery.data), [hostStateQuery.data]);
  const sessionCacheViews = useMemo(() => buildSessionCacheViews(sessionCachesQuery.data), [sessionCachesQuery.data]);

  if (!isOpen) return null;

  const estimateDetail = (key: string) => {
    if (estimateTarget?.key !== key) return null;
    const text = rowEstimateQuery.isLoading
      ? 'Estimating usable context…'
      : rowEstimateQuery.isError
        ? `Context estimate failed: ${rowEstimateQuery.error instanceof Error ? rowEstimateQuery.error.message : 'unknown error'}`
        : contextEstimateHint(rowEstimateQuery.data) || 'No context estimate available for this model.';
    return (
      <tr className="model-residency-estimate-detail">
        <td colSpan={8}>{text}</td>
      </tr>
    );
  };

  const modelsTable = rowV1 ? (
    <div className="model-residency-table-wrap">
      <table className="model-residency-table">
        <thead>
          <tr>
            <th>Modality</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Resident</th>
            <th>Size</th>
            <th>Ctx</th>
            <th aria-label="Locked">🔒</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((record, index) => {
            const row = record as ModelResidencyRowV1;
            const key = rowKeyV1(row, index);
            const chip = resolveModalityChip(modalityUi, typeof row.task === 'string' ? row.task : null);
            const resident = rowResidentState(row);
            const ctx = rowContextView(row);
            // Size = the coalesced display size (reported -> VRAM ->
            // ESTIMATED weights) plus this row's own prompt cache, with a
            // title that names the source so an estimate never reads as
            // measured truth.
            const size = rowSizeCell(row);
            const locked = row.locked === true;
            // A lock on EVERY resident line: sweep-resident rows (lockable
            // unreported) are lockable too, because locking adopts them.
            const lockAction = rowLockAction(row);
            const configOnly = rowConfigOnlyV1(row);
            const hasTarget = Boolean(firstString(row.runtime_id) || (firstString(row.provider) && firstString(row.model)));
            return (
              <Fragment key={key}>
                <tr>
                  <td>
                    <span
                      className="model-residency-chip"
                      style={{ borderColor: chip.color, color: chip.color }}
                      title={firstString(row.task) || 'Task unknown'}
                    >
                      <span className="model-residency-chip-dot" style={{ background: chip.color }} />
                      {chip.label}
                    </span>
                  </td>
                  <td>{firstString(row.provider) || '-'}</td>
                  <td className="model-residency-model">
                    {firstString(row.model) || firstString(row.runtime_id) || '-'}
                    {firstString(row.state) ? (
                      <span className={`model-residency-substate model-residency-substate--${rowStateKindV1(row)}`}>
                        {firstString(row.state)}
                        {row.pinned === true ? ' · pinned' : ''}
                        {row.default === true ? ' · default' : ''}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`model-residency-status model-residency-status--resident-${resident}`}>
                      {residentStateLabel(resident)}
                    </span>
                  </td>
                  <td title={size.title}>{size.text || '-'}</td>
                  <td title={ctx.calibrated ? 'Calibrated context length' : undefined}>
                    {ctx.text ? (
                      <>
                        {ctx.text}
                        {ctx.calibrated ? <span className="model-residency-ctx-calibrated"> ✓</span> : null}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td title={locked ? 'Locked: protected from unload/eviction.' : lockAction === 'lock' ? 'Unlocked' : undefined}>
                    {locked ? '🔒' : ''}
                  </td>
                  <td>
                    <div className="model-residency-row-actions">
                      <button
                        type="button"
                        className="modal-button danger"
                        disabled={busy || !unloadAvailable || configOnly || !hasTarget}
                        onClick={() => setPendingUnload({ row, force: false })}
                        title={
                          !unloadAvailable
                            ? 'Unload endpoint not advertised by this Gateway runtime.'
                            : configOnly
                              ? 'This is a default configuration row, not a resident model.'
                              : undefined
                        }
                      >
                        Unload
                      </button>
                      {lockAction ? (
                        <button
                          type="button"
                          className="modal-button"
                          disabled={busy || (lockAction === 'unlock' ? !unlockAvailable : !lockAvailable)}
                          onClick={() => toggleLockRow(row, lockAction === 'lock')}
                          title={
                            lockAction === 'unlock'
                              ? unlockAvailable
                                ? resident === 'yes'
                                  ? 'Allow this model to be unloaded/evicted again.'
                                  : 'Release a lock whose model is no longer in memory (the lock still blocks unloads).'
                                : 'Unlock endpoint not advertised by this Gateway runtime.'
                              : lockAvailable
                                ? rowLockAdopts(row)
                                  ? 'Protect this model from unload/eviction — it was loaded outside this Gateway, so locking adopts it first.'
                                  : 'Protect this model from unload/eviction.'
                                : 'Lock endpoint not advertised by this Gateway runtime.'
                          }
                        >
                          {lockAction === 'unlock' ? 'Unlock' : 'Lock'}
                        </button>
                      ) : null}
                      {estimateAvailable && firstString(row.provider) && firstString(row.model) ? (
                        <button
                          type="button"
                          className="modal-button"
                          onClick={() => toggleEstimateRow(key, row)}
                          title="Estimate the usable context window for this model on this host."
                        >
                          Estimate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {estimateDetail(key)}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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
          {visibleRows.map((row, index) => (
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
                <button type="button" className="modal-button danger" disabled={busy || !canUnloadRow(row, unloadAvailable)} onClick={() => setPendingUnload({ row, force: false })} title={unloadButtonTitle(row, unloadAvailable)}>
                  Unload
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const modelsTab = (
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

      <div className="model-residency-loadbar-meta">
        {lockAvailable ? (
          <label className="run-form-checkbox model-residency-lock-checkbox" title="Ask the Gateway to protect the loaded model from unload/eviction.">
            <input type="checkbox" checked={lockOnLoad} onChange={(e) => setLockOnLoad(e.target.checked)} />
            <span>Lock after load</span>
          </label>
        ) : null}
        {loadEstimateHint ? <span className="model-residency-estimate-hint">{loadEstimateHint}</span> : null}
      </div>

      <div className="model-residency-note">
        <label className="run-form-checkbox model-residency-filter-toggle">
          <input type="checkbox" checked={showNonResident} onChange={(e) => setShowNonResident(e.target.checked)} />
          <span>Show cached/non-resident</span>
        </label>
        {!showNonResident && hiddenCount > 0
          ? ` ${hiddenCount} configuration/cache row${hiddenCount === 1 ? '' : 's'} hidden from this list.`
          : ''}
        {' '}Configure Gateway/Core routing defaults from the Gateway Console multimodal capabilities tab.
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
      ) : visibleRows.length === 0 ? (
        <div className="model-residency-empty">
          {loadedQuery.isLoading
            ? 'Loading resident models…'
            : hiddenCount > 0
              ? 'No provider-resident models reported. Enable "Show cached/non-resident" to inspect cached and configuration rows.'
              : 'No provider-resident models reported.'}
        </div>
      ) : (
        modelsTable
      )}
    </>
  );

  const memoryTab = !hostStateOk ? (
    <div className="model-residency-empty">
      This Gateway runtime does not advertise host state (memory) reporting.
    </div>
  ) : hostStateQuery.isError ? (
    <div className="model-residency-empty">
      Failed to read host state: {hostStateQuery.error instanceof Error ? hostStateQuery.error.message : 'unknown error'}
    </div>
  ) : !hostStateQuery.data ? (
    <div className="model-residency-empty">Loading host memory state…</div>
  ) : (
    <div className="model-residency-memory">
      {memoryView.meters.length === 0 ? (
        <div className="model-residency-empty">Host state reported no memory meters.</div>
      ) : (
        memoryView.meters.map((meter) => (
          <div className="model-residency-meter" key={meter.id} title={meter.title}>
            <div className="model-residency-meter-head">
              <span>{meter.label}</span>
              <span>
                {meter.usedText && meter.totalText
                  ? `${meter.usedText} / ${meter.totalText}`
                  : meter.usedText || (meter.fraction === null ? 'unknown' : '')}
                {meter.percentText ? ` (${meter.percentText})` : ''}
              </span>
            </div>
            <div className="model-residency-meter-track">
              <div
                className={`model-residency-meter-fill model-residency-meter-fill--${meter.level}`}
                style={{ width: `${Math.round((meter.fraction ?? 0) * 100)}%` }}
              />
            </div>
            {meter.note ? <div className="model-residency-meter-note">{meter.note}</div> : null}
          </div>
        ))
      )}
      {/* What is using memory, in three kinds of line: ITEMS (facts the
          framework knows, each labelled with what it measures), then a rule
          and the REFERENCES (separate counters that must NOT be added to the
          items), then the GGUF note when Σ weights exceeds the accelerator
          heap. No remainder: subtracting these from an accelerator counter
          that cannot see mmapped GGUF weights is a category error. */}
      {memoryView.breakdown.items.length > 0 || memoryView.breakdown.references.length > 0 ? (
        <div className="model-residency-breakdown">
          <div
            className="model-residency-breakdown-head"
            title="Every line below is a figure the host reported, labelled with what it measures."
          >
            What is using memory
          </div>
          {memoryView.breakdown.items.map((item) => (
            <div className="model-residency-breakdown-row" key={item.key} title={item.detail || undefined}>
              <span className="model-residency-breakdown-name">
                {item.name}
                {item.detail ? <span className="model-residency-breakdown-note"> — {item.detail}</span> : null}
              </span>
              <span className="model-residency-breakdown-bytes">{item.bytesText || 'unknown'}</span>
            </div>
          ))}
          {memoryView.breakdown.references.length > 0 ? (
            <>
              <div className="model-residency-breakdown-separator" role="separator" />
              <div className="model-residency-breakdown-subhead">
                Separate counters — not summable with the lines above
              </div>
              {memoryView.breakdown.references.map((reference) => (
                <div
                  className="model-residency-breakdown-row model-residency-breakdown-row--reference"
                  key={reference.key}
                  title={reference.detail || undefined}
                >
                  <span className="model-residency-breakdown-name">
                    {reference.name}
                    {reference.detail ? (
                      <span className="model-residency-breakdown-note"> — {reference.detail}</span>
                    ) : null}
                  </span>
                  <span className="model-residency-breakdown-bytes">{reference.valueText || 'unknown'}</span>
                </div>
              ))}
            </>
          ) : null}
          {memoryView.breakdown.note ? (
            <div className="model-residency-breakdown-gguf-note">{memoryView.breakdown.note}</div>
          ) : null}
        </div>
      ) : null}
      {/* No standalone RSS row: the gateway process RSS is the `process_rss`
          breakdown item above, stated once and labelled with what it
          measures. Showing it twice is the double-counting this panel
          exists to remove. */}
      {memoryView.totals.length > 0 ? (
        <div className="model-residency-memory-totals">
          {memoryView.totals.map((total) => (
            <span className="model-residency-total-pill" key={total.label}>
              {total.label}: {total.value}
            </span>
          ))}
        </div>
      ) : null}
      {memoryView.degraded.length > 0 ? (
        <div className="model-residency-memory-degraded">
          {memoryView.degraded.map((item) => (
            <span
              className="model-residency-status model-residency-status--warn"
              key={item.name}
              title={item.reason || undefined}
            >
              {item.name}
              {item.reason ? ` — ${item.reason}` : ''}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  const cachesTab = !cachesOk ? (
    <div className="model-residency-empty">
      This Gateway runtime does not advertise session prompt-cache listing.
    </div>
  ) : sessionCachesQuery.isError ? (
    <div className="model-residency-empty">
      Failed to read session caches: {sessionCachesQuery.error instanceof Error ? sessionCachesQuery.error.message : 'unknown error'}
    </div>
  ) : sessionCacheViews.length === 0 ? (
    <div className="model-residency-empty">
      {sessionCachesQuery.isLoading ? 'Loading session caches…' : 'No session prompt caches reported.'}
    </div>
  ) : (
    <div className="model-residency-table-wrap">
      <table className="model-residency-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Session</th>
            <th>Size</th>
            <th>Tokens</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sessionCacheViews.map((cache) => (
            <tr key={cache.key}>
              <td className="model-residency-model">{cache.key}</td>
              <td>{cache.provider || '-'}</td>
              <td className="model-residency-model">{cache.model || '-'}</td>
              <td className="model-residency-runtime">{cache.sessionId || '-'}</td>
              <td>{cache.sizeText || '-'}</td>
              <td>{cache.tokenText || '-'}</td>
              <td>{cache.createdText || '-'}</td>
              <td>
                <button
                  type="button"
                  className="modal-button danger"
                  disabled={busy || !cacheClearOk || !cache.sessionId}
                  onClick={() => setPendingClearCache(cache)}
                  title={!cacheClearOk ? 'Cache clear endpoint not advertised by this Gateway runtime.' : !cache.sessionId ? 'This cache row did not report a session id.' : undefined}
                >
                  Clear
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal model-residency-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-residency-header">
          <div>
            <h3>Resources</h3>
            <p>Models, memory, and session caches reported by the Gateway execution host.</p>
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
            <div className="model-residency-tabs" role="tablist" aria-label="Resources sections">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'models'}
                className={`model-residency-tab${tab === 'models' ? ' active' : ''}`}
                onClick={() => setTab('models')}
              >
                Models
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'memory'}
                className={`model-residency-tab${tab === 'memory' ? ' active' : ''}`}
                onClick={() => setTab('memory')}
              >
                Memory
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'caches'}
                className={`model-residency-tab${tab === 'caches' ? ' active' : ''}`}
                onClick={() => setTab('caches')}
              >
                Session caches
              </button>
            </div>

            {tab === 'models' ? modelsTab : tab === 'memory' ? memoryTab : cachesTab}

            {pendingUnload ? (
              <div className="model-residency-confirm-backdrop" role="presentation" onClick={() => setPendingUnload(null)}>
                <div
                  className="model-residency-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="model-residency-confirm-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 id="model-residency-confirm-title">{pendingUnload.force ? 'Force Unload Locked Model' : 'Unload Model'}</h4>
                  <p>
                    {pendingUnload.force ? (
                      <>
                        <strong>{pendingUnloadLabel}</strong> is locked against unload. Force unload anyway?
                      </>
                    ) : (
                      <>
                        Unload <strong>{pendingUnloadLabel}</strong> from the provider?
                      </>
                    )}
                  </p>
                  <div className="modal-actions">
                    <button type="button" className="modal-button cancel" onClick={() => setPendingUnload(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" className="modal-button danger" onClick={() => unloadRow(pendingUnload)} disabled={busy}>
                      {pendingUnload.force ? 'Force Unload' : 'Unload'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {pendingClearCache ? (
              <div className="model-residency-confirm-backdrop" role="presentation" onClick={() => setPendingClearCache(null)}>
                <div
                  className="model-residency-confirm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="model-residency-clear-cache-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 id="model-residency-clear-cache-title">Clear Session Cache</h4>
                  <p>
                    Clear all prompt caches for session <strong>{pendingClearCache.sessionId}</strong>
                    {pendingClearCache.model ? <> ({pendingClearCache.provider ? `${pendingClearCache.provider} / ` : ''}{pendingClearCache.model})</> : null}?
                  </p>
                  <div className="modal-actions">
                    <button type="button" className="modal-button cancel" onClick={() => setPendingClearCache(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" className="modal-button danger" onClick={() => clearSessionCache(pendingClearCache)} disabled={busy}>
                      Clear
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
