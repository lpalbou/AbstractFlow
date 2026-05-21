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
  if (task === 'tts') return 'Speech';
  if (task === 'stt') return 'Transcription';
  return task.replace(/_/g, ' ');
}

function taskOptions(contracts: GatewayContracts | null): AfSelectOption[] {
  const residency = contracts?.common?.model_residency;
  const supports = residency?.supports || {};
  const rawTasks = Array.isArray(residency?.tasks) && residency.tasks.length > 0
    ? residency.tasks
    : ['text_generation', 'image_generation', 'tts', 'stt'];
  const seen = new Set<string>();
  const out: AfSelectOption[] = [];
  for (const task of rawTasks) {
    if (typeof task !== 'string') continue;
    const t = task.trim();
    if (!t || seen.has(t)) continue;
    if (supports[t] === false) continue;
    if ((t === 'tts' || t === 'stt') && supports[t] !== true) continue;
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

function statusText(row: ModelResidencyRecord): string {
  return firstString(row.state, row.health) || (row.resident === false || row.loaded === false ? 'not resident' : 'resident');
}

function statusKind(row: ModelResidencyRecord): 'ok' | 'muted' | 'error' {
  const text = statusText(row).toLowerCase();
  if (firstString(row.error) || text.includes('error') || text.includes('fail') || text.includes('unhealthy')) return 'error';
  if (row.resident === false || row.loaded === false || text.includes('not') || text.includes('unloaded')) return 'muted';
  return 'ok';
}

export function ModelResidencyPanel({ isOpen, gatewayContracts, onClose }: ModelResidencyPanelProps) {
  const residency = gatewayContracts?.common?.model_residency;
  const routeAvailable = modelResidencyAvailable(gatewayContracts);
  const loadedAvailable = residencyEndpointAvailable(gatewayContracts, 'loaded');
  const loadAvailable = residencyEndpointAvailable(gatewayContracts, 'load');
  const unloadAvailable = residencyEndpointAvailable(gatewayContracts, 'unload');
  const controlsAvailable = routeAvailable && residency?.available !== false;
  const configHint = typeof residency?.config_hint === 'string' ? residency.config_hint : '';
  const tasks = useMemo(() => taskOptions(gatewayContracts), [gatewayContracts]);
  const [task, setTask] = useState(() => tasks[0]?.value || 'text_generation');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [pin, setPin] = useState(true);

  useEffect(() => {
    if (tasks.some((option) => option.value === task)) return;
    setTask(tasks[0]?.value || 'text_generation');
    setProvider('');
    setModel('');
  }, [task, tasks]);

  const loadedQuery = useLoadedModels(gatewayContracts, isOpen && controlsAvailable && loadedAvailable);
  const loadMutation = useLoadModelResidency(gatewayContracts);
  const unloadMutation = useUnloadModelResidency(gatewayContracts);

  const providersQuery = useProviders(isOpen && controlsAvailable && task === 'text_generation');
  const modelsQuery = useModels(provider, isOpen && controlsAvailable && task === 'text_generation' && Boolean(provider));
  const visionEndpoint = gatewayContracts?.common?.discovery?.vision_provider_models || '';
  const voiceCatalogEndpoint = gatewayContracts?.common?.discovery?.voice_voices || '';
  const ttsModelsEndpoint = gatewayContracts?.common?.discovery?.audio_speech_models || '';
  const sttModelsEndpoint = gatewayContracts?.common?.discovery?.audio_transcription_models || '';
  const imageCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'vision-provider-models', visionEndpoint],
    queryFn: async () => parseProviderModelCatalog(await gatewayJson<unknown>(gatewayPath(visionEndpoint, {}, { task: 'text_to_image' }))),
    enabled: isOpen && controlsAvailable && task === 'image_generation' && Boolean(visionEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const ttsVoiceCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'voice-catalog', voiceCatalogEndpoint, provider, model],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(voiceCatalogEndpoint, {}, { provider: provider || undefined, model: model || undefined })),
    enabled: isOpen && controlsAvailable && task === 'tts' && Boolean(voiceCatalogEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const ttsModelsQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'tts-models', ttsModelsEndpoint, provider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(ttsModelsEndpoint, {}, { provider: provider || undefined })),
    enabled: isOpen && controlsAvailable && task === 'tts' && Boolean(ttsModelsEndpoint),
    staleTime: 30_000,
    retry: 1,
  });
  const sttCatalogQuery = useQuery({
    queryKey: ['gateway', 'model-residency', 'stt-models', sttModelsEndpoint, provider],
    queryFn: async () => gatewayJson<unknown>(gatewayPath(sttModelsEndpoint, {}, { provider: provider || undefined })),
    enabled: isOpen && controlsAvailable && task === 'stt' && Boolean(sttModelsEndpoint),
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
    if (task === 'image_generation') {
      for (const option of imagePairs) add(option.provider);
    } else if (task === 'tts') {
      for (const option of providerValuesFrom(ttsVoiceCatalogQuery.data, ['tts_providers', 'providers', 'available_tts_providers'], ['tts_models_by_provider', 'tts_profiles_by_provider', 'tts_voices_by_provider'])) add(option);
      for (const option of providerValuesFrom(ttsModelsQuery.data, ['tts_providers', 'providers', 'available_providers'], ['models_by_provider', 'tts_models_by_provider'])) add(option);
    } else if (task === 'stt') {
      for (const option of providerValuesFrom(sttCatalogQuery.data, ['stt_providers', 'providers', 'available_providers'], ['models_by_provider', 'stt_models_by_provider'])) add(option);
    } else {
      for (const option of providersQuery.data || []) add(option.name, option.display_name || option.name);
    }
    if (provider) add(provider);
    return out;
  }, [imagePairs, provider, providersQuery.data, sttCatalogQuery.data, task, ttsModelsQuery.data, ttsVoiceCatalogQuery.data]);

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
    } else {
      for (const item of modelsQuery.data || []) add(item);
    }
    if (model) add(model);
    return out;
  }, [imagePairs, model, modelsQuery.data, provider, sttCatalogQuery.data, task, ttsModelsQuery.data]);

  const rows = loadedQuery.data?.models || [];
  const busy = loadMutation.isPending || unloadMutation.isPending;
  const loadDisabled = !controlsAvailable || !loadAvailable || busy || !task || !provider.trim() || !model.trim();
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
            : 'Model…';
  const providerLoading =
    providersQuery.isLoading ||
    imageCatalogQuery.isLoading ||
    ttsVoiceCatalogQuery.isLoading ||
    ttsModelsQuery.isLoading ||
    sttCatalogQuery.isLoading;
  const modelLoading =
    modelsQuery.isLoading ||
    imageCatalogQuery.isLoading ||
    ttsModelsQuery.isLoading ||
    sttCatalogQuery.isLoading;

  const loadSelected = async () => {
    if (loadDisabled) return;
    try {
      const result = await loadMutation.mutateAsync({
        task,
        provider: provider.trim(),
        model: model.trim(),
        pin,
      });
      if (result.ok === false) {
        toast.error(firstString(result.error, result.code) || 'Model load request failed');
      } else {
        toast.success(result.loaded_new === false ? 'Model already loaded' : 'Model load requested');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model load request failed');
    }
  };

  const unloadRow = async (row: ModelResidencyRecord) => {
    const rid = runtimeIdFor(row);
    const p = firstString(row.provider);
    const m = firstString(row.model);
    const label = [p, m].filter(Boolean).join(' / ') || rid || 'selected model';
    if (!window.confirm(`Unload ${label}?`)) return;
    try {
      const result = await unloadMutation.mutateAsync({
        task: firstString(row.task) || undefined,
        runtime_id: rid || undefined,
        provider: rid ? undefined : p || undefined,
        model: rid ? undefined : m || undefined,
      });
      if (result.ok === false) {
        toast.error(firstString(result.error, result.code) || 'Model unload request failed');
      } else {
        toast.success(result.unloaded === false ? 'Model was not resident' : 'Model unloaded');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Model unload request failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal model-residency-modal" onClick={(e) => e.stopPropagation()}>
        <div className="model-residency-header">
          <div>
            <h3>Loaded Models</h3>
            <p>Current Gateway/Runtime state. Loaded models stay resident until an explicit unload or provider eviction.</p>
          </div>
          <button type="button" className="modal-button cancel" onClick={onClose}>Close</button>
        </div>

        {!routeAvailable ? (
          <div className="model-residency-empty">
            Gateway does not advertise model residency controls.
          </div>
        ) : residency?.available === false ? (
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
              <label className="model-residency-pin">
                <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
                Keep loaded
              </label>
              <button type="button" className="modal-button primary" disabled={loadDisabled} onClick={loadSelected} title={!loadAvailable ? 'Load endpoint not advertised by this Gateway runtime.' : undefined}>
                Load
              </button>
              <button type="button" className="modal-button" onClick={() => loadedQuery.refetch()} disabled={!loadedAvailable || loadedQuery.isFetching}>
                Refresh
              </button>
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
            ) : rows.length === 0 ? (
              <div className="model-residency-empty">
                {loadedQuery.isLoading ? 'Loading resident models…' : 'No resident models reported.'}
              </div>
            ) : (
              <div className="model-residency-table-wrap">
                <table className="model-residency-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Provider</th>
                      <th>Model</th>
                      <th>Runtime</th>
                      <th>Status</th>
                      <th>Loaded</th>
                      <th>Last Used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={modelKey(row, index)}>
                        <td>{taskLabel(firstString(row.task) || 'model')}</td>
                        <td>{firstString(row.provider) || '-'}</td>
                        <td className="model-residency-model">{firstString(row.model) || firstString(row.runtime_id, row.id) || '-'}</td>
                        <td className="model-residency-runtime">
                          {runtimeIdFor(row) || '-'}
                          {firstString(row.source) ? <span>{firstString(row.source)}</span> : null}
                        </td>
                        <td>
                          <span className={`model-residency-status model-residency-status--${statusKind(row)}`}>
                            {statusText(row)}
                            {row.pinned === true ? ' · pinned' : ''}
                          </span>
                        </td>
                        <td>{displayDate(row.loaded_at) || '-'}</td>
                        <td>{displayDate(row.last_used_at) || '-'}</td>
                        <td>
                          <button type="button" className="modal-button danger" disabled={busy || !unloadAvailable} onClick={() => unloadRow(row)} title={!unloadAvailable ? 'Unload endpoint not advertised by this Gateway runtime.' : undefined}>
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
        )}
      </div>
    </div>
  );
}

export default ModelResidencyPanel;
