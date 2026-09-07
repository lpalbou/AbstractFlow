/**
 * Pure view-model helpers for the Resources panel (models & memory).
 *
 * Everything here is deliberately side-effect free so the row/meter/cache
 * presentation logic can be unit-tested without rendering components. The
 * panel component consumes these builders and stays purely declarative.
 */

import type {
  ContextEstimateResponse,
  HostStateResponse,
  ModelResidencyRecord,
  ModelResidencyRowV1,
  SessionCacheRecord,
} from '../hooks/useModelResidency';
import type { GatewayModalityUiContract } from './gatewayClient';
import { MODALITY_COLORS, type ResidencyModality } from '../types/flow';
import { formatBytes } from './formatBytes';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw) return raw;
  }
  return '';
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function displayDate(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString();
}

export function displayEpochSeconds(raw: unknown): string {
  const s = finiteNumber(raw);
  if (s === null || s <= 0) return '';
  const d = new Date(s * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function taskLabel(task: string): string {
  if (task === 'text_generation') return 'Text';
  if (task === 'image_generation') return 'Image';
  if (task === 'image_to_image') return 'Image edit';
  if (task === 'image_upscale') return 'Image upscale';
  if (task === 'text_to_video') return 'Text to video';
  if (task === 'image_to_video') return 'Image to video';
  if (task === 'tts') return 'Speech';
  if (task === 'stt') return 'Transcription';
  if (task === 'music_generation') return 'Music';
  return task.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Modality chips
// ---------------------------------------------------------------------------

export interface ModalityChip {
  color: string;
  label: string;
  modality: ResidencyModality;
}

export function modalityFromTask(task: string | null | undefined): ResidencyModality {
  const t = String(task || '').trim().toLowerCase();
  if (!t) return 'unknown';
  if (t.includes('video')) return 'video';
  if (t.includes('image') || t.includes('vision') || t.includes('upscale')) return 'image';
  if (
    t === 'tts' ||
    t === 'stt' ||
    t.includes('speech') ||
    t.includes('voice') ||
    t.includes('transcription') ||
    t.includes('audio')
  ) {
    return 'voice';
  }
  if (t.includes('music')) return 'music';
  if (t.includes('embed')) return 'embedding';
  if (t.includes('3d') || t.includes('mesh')) return '3d';
  if (t.includes('text') || t.includes('chat') || t.includes('completion') || t.includes('generation')) return 'text';
  return 'unknown';
}

/**
 * Resolves a modality chip for a residency row. The gateway's modality_ui
 * contract is canonical: its `colors` entry for the row's task (or resolved
 * modality) wins; the local MODALITY_COLORS constant is only the fallback.
 * A null/absent task renders as the distinct "Unknown" chip.
 */
export function resolveModalityChip(
  modalityUi: GatewayModalityUiContract | null | undefined,
  task: string | null | undefined
): ModalityChip {
  const cleanTask = typeof task === 'string' ? task.trim() : '';
  const modality = modalityFromTask(cleanTask);
  const entry = (cleanTask ? modalityUi?.colors?.[cleanTask] : undefined) || modalityUi?.colors?.[modality];
  const color = firstString(entry?.color) || MODALITY_COLORS[modality] || MODALITY_COLORS.unknown;
  const label = firstString(entry?.label) || (cleanTask ? taskLabel(cleanTask) : 'Unknown');
  return { color, label, modality };
}

// ---------------------------------------------------------------------------
// Legacy (pre-row_v1) alias-guessing readers — fallback path only
// ---------------------------------------------------------------------------

export function runtimeIdFor(row: ModelResidencyRecord): string {
  return firstString(row.runtime_id, row.load_id, row.id);
}

export function modelKey(row: ModelResidencyRecord, index: number): string {
  return (
    runtimeIdFor(row) ||
    `${firstString(row.task)}:${firstString(row.provider)}:${firstString(row.model)}:${index}`
  );
}

function rowDetails(row: ModelResidencyRecord): Record<string, unknown> | null {
  return asRecord(row.details);
}

function rowRuntimeInfo(row: ModelResidencyRecord): Record<string, unknown> | null {
  return asRecord(rowDetails(row)?.runtime_info);
}

export function displayModelFor(row: ModelResidencyRecord): string {
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

export function componentLabelFor(row: ModelResidencyRecord): string {
  const raw = firstString(row.component, rowDetails(row)?.component).toLowerCase();
  if (raw === 'tts_engine') return 'TTS engine';
  if (raw === 'cloning_engine') return 'Clone engine';
  if (raw === 'stt_engine') return 'STT engine';
  if (raw === 'image_engine') return 'Image engine';
  if (raw === 'music_engine') return 'Music engine';
  return raw ? raw.replace(/_/g, ' ') : '-';
}

export function isProviderResidentRow(row: ModelResidencyRecord): boolean {
  if (row.provider_resident === true || row.provider_loaded === true) return true;
  if (row.provider_resident === false || row.provider_loaded === false) return false;
  const state = firstString(row.state, row.provider_state).toLowerCase();
  if (state === 'provider_loaded' || state === 'loaded' || state === 'resident') return true;
  return row.loaded === true || row.resident === true;
}

export function isDefaultRuntimeConfigRow(row: ModelResidencyRecord): boolean {
  return row.default === true && !isProviderResidentRow(row);
}

export function statusText(row: ModelResidencyRecord): string {
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

export function statusKind(row: ModelResidencyRecord): 'ok' | 'muted' | 'error' {
  if (isDefaultRuntimeConfigRow(row)) return 'muted';
  const text = statusText(row).toLowerCase();
  if (firstString(row.error) || text.includes('error') || text.includes('fail') || text.includes('unhealthy')) return 'error';
  if (row.resident === false || row.loaded === false || text.includes('not') || text.includes('unloaded')) return 'muted';
  return 'ok';
}

export function providerLoadedText(row: ModelResidencyRecord): string {
  if (row.provider_resident === true || row.provider_loaded === true) return 'yes';
  if (row.provider_resident === false || row.provider_loaded === false) return 'no';
  if (row.loaded === true || row.resident === true) return 'runtime cached';
  return '-';
}

export function residencyResultMessage(result: Record<string, unknown>, fallback: string): string {
  const warning = Array.isArray(result.warnings)
    ? result.warnings.find((item) => typeof item === 'string' && item.trim())
    : '';
  return firstString(result.error, warning, result.message, result.code) || fallback;
}

export function unloadButtonTitle(row: ModelResidencyRecord, unloadAvailable: boolean): string | undefined {
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

export function canUnloadRow(row: ModelResidencyRecord, unloadAvailable: boolean): boolean {
  return unloadAvailable && !isDefaultRuntimeConfigRow(row);
}

// ---------------------------------------------------------------------------
// row_v1 field readers
// ---------------------------------------------------------------------------

export type ResidentState = 'yes' | 'no' | 'unknown';

/**
 * Tri-state residency for a v1 row: `resident` null/absent is a real third
 * state ("unknown") that must never collapse into "no".
 */
export function rowResidentState(row: ModelResidencyRowV1): ResidentState {
  if (row.resident === true) return 'yes';
  if (row.resident === false) return 'no';
  return 'unknown';
}

export function residentStateLabel(state: ResidentState): string {
  if (state === 'yes') return 'Yes';
  if (state === 'no') return 'No';
  return 'Unknown';
}

export function rowSizeText(row: ModelResidencyRowV1): string {
  return formatBytes(finiteNumber(row.size_bytes));
}

export function rowVramText(row: ModelResidencyRowV1): string {
  return formatBytes(finiteNumber(row.size_vram_bytes));
}

// ---------------------------------------------------------------------------
// Display size: ONE coalesce rule, shared with the gateway console
// ---------------------------------------------------------------------------

export type DisplaySizeSource = 'size_bytes' | 'size_vram_bytes' | 'est_weights_bytes' | '';

export interface DisplaySizeView {
  bytes: number | null;
  source: DisplaySizeSource;
  /** Human phrasing of WHERE the number came from — never hidden from the UI. */
  label: string;
}

/**
 * The display size for a residency row: the first KNOWN of `size_bytes` ->
 * `size_vram_bytes` -> `est_weights_bytes`. The source rides along so an
 * ESTIMATE is never presented as a measurement — an MLX/HF row that only
 * reports `est_weights_bytes` used to render a blank size cell.
 */
export function rowDisplaySize(row: ModelResidencyRowV1): DisplaySizeView {
  const pick = (value: unknown, source: DisplaySizeSource, label: string): DisplaySizeView | null => {
    const n = finiteNumber(value);
    return n !== null && n >= 0 ? { bytes: n, source, label } : null;
  };
  return (
    pick(row.size_bytes, 'size_bytes', 'reported size') ||
    pick(row.size_vram_bytes, 'size_vram_bytes', 'reported VRAM size') ||
    pick(row.est_weights_bytes, 'est_weights_bytes', 'ESTIMATED weights (not measured)') || {
      bytes: null,
      source: '',
      label: 'size unknown',
    }
  );
}

/** Prompt/KV cache bytes this model holds, or null when unreported. */
export function rowCacheBytes(row: ModelResidencyRowV1): number | null {
  const n = finiteNumber(row.cache_bytes);
  return n !== null && n >= 0 ? n : null;
}

export interface RowSizeCell {
  text: string;
  title: string;
}

/**
 * The Size cell: the coalesced display size with the row's cache as a
 * secondary figure, and a title that NAMES the source so an estimate can
 * never be read as measured truth.
 *
 * An ESTIMATED size (`est_weights_bytes`) is prefixed with `~` in the
 * RENDERED text, matching the TUIs — a tooltip-only marker is invisible.
 */
export function rowSizeCell(row: ModelResidencyRowV1): RowSizeCell {
  const size = rowDisplaySize(row);
  const cache = rowCacheBytes(row);
  const sizeText =
    size.bytes === null ? '' : `${size.source === 'est_weights_bytes' ? '~' : ''}${formatBytes(size.bytes)}`;
  const cacheText = cache === null ? '' : formatBytes(cache);
  const text = sizeText
    ? cacheText
      ? `${sizeText} + ${cacheText} cache`
      : sizeText
    : cacheText
      ? `${cacheText} cache`
      : '';
  const bits: string[] = [
    size.bytes === null ? 'Size unknown — this host reported no size for the model' : `${size.label} (${size.source})`,
  ];
  const vram = finiteNumber(row.size_vram_bytes);
  if (vram !== null && size.source !== 'size_vram_bytes') bits.push(`VRAM ${formatBytes(vram)}`);
  if (cache !== null) bits.push(`prompt/KV cache ${cacheText}`);
  return { text, title: bits.join(' · ') };
}

// ---------------------------------------------------------------------------
// Lock control: a lock on EVERY resident line
// ---------------------------------------------------------------------------

export type RowLockAction = 'lock' | 'unlock' | null;

/**
 * Which lock control a row offers. Locking now ADOPTS externally loaded
 * (LM Studio / ollama) resident models, so a sweep-resident row whose
 * `lockable` the host never reported (null) is lockable too — only an
 * EXPLICIT `lockable: false` withholds the control. A locked row always
 * offers Unlock, resident or not: a locked-but-evicted lock still blocks
 * unloads and must never be stranded.
 */
export function rowLockAction(row: ModelResidencyRowV1): RowLockAction {
  if (row.locked === true) return 'unlock';
  if (row.lockable !== false && row.resident === true) return 'lock';
  return null;
}

/**
 * Whether locking this row ADOPTS a model this host loaded outside the
 * Gateway. The residency sweep stamps every row `lockable: true`, so keying
 * the adopt wording off `lockable` never fired; `source === 'provider_server'`
 * is the field that actually says "the provider had this loaded already".
 * This decides WORDING ONLY — the lock gate stays `rowLockAction`.
 */
export function rowLockAdopts(row: ModelResidencyRowV1): boolean {
  return firstString(row.source) === 'provider_server';
}

export interface RowContextView {
  text: string;
  calibrated: boolean;
}

/**
 * Context column: prefers the calibrated context length and marks it so the
 * UI can render the calibration indicator.
 */
export function rowContextView(row: ModelResidencyRowV1): RowContextView {
  const calibrated = row.context_calibrated === true;
  const calibratedLength = finiteNumber(row.calibrated_context_length);
  const declaredLength = finiteNumber(row.context_length);
  const length = calibrated && calibratedLength !== null ? calibratedLength : declaredLength ?? calibratedLength;
  if (length === null) return { text: '', calibrated: false };
  return { text: length.toLocaleString('en-US'), calibrated: calibrated && calibratedLength !== null };
}

export function rowStateKindV1(row: ModelResidencyRowV1): 'ok' | 'muted' | 'error' {
  const state = firstString(row.state).toLowerCase();
  if (state.includes('error') || state.includes('fail') || state.includes('unhealthy')) return 'error';
  const resident = rowResidentState(row);
  if (resident === 'yes') return 'ok';
  return 'muted';
}

export function rowKeyV1(row: ModelResidencyRowV1, index: number): string {
  return (
    firstString(row.runtime_id) ||
    `${firstString(row.task)}:${firstString(row.provider)}:${firstString(row.model)}:${index}`
  );
}

/**
 * Default-config-only rows (advertised default routes that are known not to
 * be resident) cannot be unloaded; everything else can be offered an unload.
 */
export function rowConfigOnlyV1(row: ModelResidencyRowV1): boolean {
  return row.default === true && row.resident === false;
}

// ---------------------------------------------------------------------------
// Visibility filter (Models tab)
// ---------------------------------------------------------------------------

export interface ResidencyFilterResult<T> {
  visible: T[];
  hiddenCount: number;
}

/**
 * The Models tab shows resident rows by default; the "Show cached /
 * non-resident" toggle reveals everything. Works for both row_v1 (tri-state
 * `resident`) and legacy rows (provider-resident heuristics).
 */
export function filterResidencyRows<T extends ModelResidencyRecord>(
  rows: T[],
  rowV1: boolean,
  showNonResident: boolean
): ResidencyFilterResult<T> {
  if (showNonResident) return { visible: rows, hiddenCount: 0 };
  const visible = rows.filter((row) =>
    rowV1 ? rowResidentState(row as ModelResidencyRowV1) === 'yes' : isProviderResidentRow(row)
  );
  return { visible, hiddenCount: Math.max(0, rows.length - visible.length) };
}

// ---------------------------------------------------------------------------
// Unload 409 (model_locked) → force retry decision
// ---------------------------------------------------------------------------

function errorCodesFromDetail(detail: unknown): string[] {
  const out: string[] = [];
  const rec = asRecord(detail);
  if (!rec) return out;
  for (const value of [rec.error, rec.code, asRecord(rec.detail)?.error, asRecord(rec.error)?.code]) {
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  }
  return out;
}

/**
 * Decides whether a failed unload should offer a force retry. The gateway
 * signals a locked model with HTTP 409 {error:"model_locked"}; a truly
 * bodyless 409 on this endpoint means the same thing. A 409 carrying a
 * DIFFERENT error code, an unparseable non-empty body (e.g. an HTML proxy
 * page), or a parsed body without a recognizable lock code does NOT offer
 * force — those surface as a generic conflict error instead.
 */
export function unloadConflictOffersForce(error: unknown): boolean {
  const rec = error && typeof error === 'object' ? (error as { status?: unknown; detail?: unknown }) : null;
  if (!rec || Number(rec.status) !== 409) return false;
  const detail = rec.detail;
  if (detail === null || detail === undefined) return true;
  if (typeof detail === 'string') return detail.trim() === '' || detail.trim() === 'model_locked';
  return errorCodesFromDetail(detail).includes('model_locked');
}

// ---------------------------------------------------------------------------
// Context estimate hint
// ---------------------------------------------------------------------------

export function contextEstimateHint(estimate: ContextEstimateResponse | null | undefined): string {
  if (!estimate) return '';
  const predicted = finiteNumber(estimate.predicted_max_context);
  const confidence =
    typeof estimate.confidence === 'string'
      ? estimate.confidence.trim()
      : typeof estimate.confidence === 'number' && Number.isFinite(estimate.confidence)
        ? `${Math.round(estimate.confidence * 100)}%`
        : '';
  const notes = Array.isArray(estimate.notes)
    ? estimate.notes.filter((n): n is string => typeof n === 'string' && Boolean(n.trim()))
    : [];
  const parts: string[] = [];
  if (predicted !== null) parts.push(`Predicted max context ${predicted.toLocaleString('en-US')}`);
  if (confidence) parts.push(`confidence ${confidence}`);
  const head = parts.join(' · ');
  if (!head && notes.length === 0) return '';
  return [head, ...notes].filter(Boolean).join(' — ');
}

// ---------------------------------------------------------------------------
// Memory tab: meters, totals, degraded pills
// ---------------------------------------------------------------------------

export type MeterLevel = 'ok' | 'warn' | 'error';

export interface MeterView {
  id: string;
  label: string;
  fraction: number | null;
  percentText: string;
  usedText: string;
  totalText: string;
  level: MeterLevel;
  /** Tooltip explaining exactly which figure the bar shows. */
  title?: string;
  /** Caveat rendered as a sub-line under the bar (accelerator heap: GGUF). */
  note?: string;
}

export function meterFraction(used: unknown, total: unknown): number | null {
  const u = finiteNumber(used);
  const t = finiteNumber(total);
  if (u === null || t === null || t <= 0) return null;
  return Math.min(1, Math.max(0, u / t));
}

export function meterLevel(fraction: number | null): MeterLevel {
  if (fraction === null) return 'ok';
  if (fraction >= 0.92) return 'error';
  if (fraction >= 0.75) return 'warn';
  return 'ok';
}

function makeMeter(id: string, label: string, usedBytes: number | null, totalBytes: number | null, fractionOverride: number | null = null): MeterView | null {
  const fraction = fractionOverride !== null ? Math.min(1, Math.max(0, fractionOverride)) : meterFraction(usedBytes, totalBytes);
  if (fraction === null && usedBytes === null && totalBytes === null) return null;
  return {
    id,
    label,
    fraction,
    percentText: fraction === null ? '' : `${(fraction * 100).toFixed(0)}%`,
    usedText: usedBytes === null ? '' : formatBytes(usedBytes),
    totalText: totalBytes === null ? '' : formatBytes(totalBytes),
    level: meterLevel(fraction),
  };
}

function gpuMeters(gpu: unknown): MeterView[] {
  const out: MeterView[] = [];
  const top = asRecord(gpu);
  if (!top || top.supported === false) return out;
  const entries = Array.isArray(top.gpus) ? top.gpus : [top];
  entries.forEach((entry, index) => {
    const rec = asRecord(entry);
    if (!rec) return;
    const used = finiteNumber(rec.memory_used_bytes) ?? finiteNumber(rec.vram_used_bytes);
    const total = finiteNumber(rec.memory_total_bytes) ?? finiteNumber(rec.vram_total_bytes);
    const name = firstString(rec.name, rec.model);
    const label = name ? `GPU ${name}` : entries.length > 1 ? `GPU ${index}` : 'GPU memory';
    if (used !== null && total !== null && total > 0) {
      const meter = makeMeter(`gpu-${index}`, label, used, total);
      if (meter) out.push(meter);
      return;
    }
    const pct = finiteNumber(rec.utilization_gpu_pct);
    if (pct !== null) {
      const meter = makeMeter(`gpu-${index}`, name ? `GPU ${name} utilization` : 'GPU utilization', null, null, pct / 100);
      if (meter) out.push(meter);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Accelerator heap: an accelerator-heap figure that always names its scope
// ---------------------------------------------------------------------------

/**
 * EXACT caveat carried on every rendering of the accelerator figure.
 * `host_in_use_bytes` counts driver-allocated accelerator buffers; llama.cpp
 * mmaps a GGUF and wraps the pages with `newBufferWithBytesNoCopy`, so those
 * weights never become driver-allocated and never appear here.
 */
export const ACCELERATOR_NOTE = 'memory-mapped GGUF weights are not counted here';

/** The only two scope words this figure may use. */
export type AcceleratorScope = 'all processes' | 'this process only';

export interface DeviceMemoryView {
  scope: AcceleratorScope;
  backend: string;
  usedBytes: number | null;
  ceilingBytes: number | null;
  hostInUseBytes: number | null;
  processBytes: number | null;
  wiredLimitBytes: number | null;
  totalBytes: number | null;
  /** EXACT: `Accelerator heap · <backend> (<scope>)`. */
  label: string;
  /** EXACT: the GGUF caveat, for a tooltip or sub-line. */
  note: string;
  /** The note, which figure this is, and what the ceiling means. */
  detail: string;
}

/**
 * The accelerator-heap figure. `device.allocated_bytes` is PROCESS-LOCAL: on
 * Apple silicon it reads 0 while a 90 GB GGUF is resident in another process.
 * `device.host_in_use_bytes` is the accelerator heap across ALL PROCESSES and
 * `device.wired_limit_bytes` the real ceiling (`total_bytes` is the whole
 * unified pool, not what the accelerator may take). Both win whenever known.
 *
 * The label names the scope in the only two permitted phrasings — `all
 * processes` / `this process only` — so this figure can never be read as the
 * machine's memory use. It is NOT a system meter and NOT a denominator: it is
 * blind to memory-mapped GGUF weights, which is why the note rides along.
 */
export function deviceMemoryView(device: unknown): DeviceMemoryView | null {
  const rec = asRecord(device);
  if (!rec) return null;
  const nonNegative = (value: unknown): number | null => {
    const n = finiteNumber(value);
    return n !== null && n >= 0 ? n : null;
  };
  const backend = firstString(rec.backend);
  const hostInUseBytes = nonNegative(rec.host_in_use_bytes);
  const wiredLimitBytes = nonNegative(rec.wired_limit_bytes);
  const totalBytes = nonNegative(rec.total_bytes);
  const freeBytes = nonNegative(rec.free_bytes);
  let processBytes = nonNegative(rec.allocated_bytes);
  if (processBytes === null && totalBytes !== null && freeBytes !== null) {
    processBytes = Math.max(0, totalBytes - freeBytes);
  }
  const scope: AcceleratorScope = hostInUseBytes === null ? 'this process only' : 'all processes';
  const usedBytes = hostInUseBytes === null ? processBytes : hostInUseBytes;
  const ceilingBytes = wiredLimitBytes === null ? totalBytes : wiredLimitBytes;
  const label = `Accelerator heap · ${backend || 'device'} (${scope})`;
  const bits: string[] = [
    ACCELERATOR_NOTE,
    scope === 'all processes'
      ? 'accelerator heap in use across every process on this machine (device.host_in_use_bytes)'
      : 'this process only (device.allocated_bytes) — no all-processes figure was reported, so a model resident in another process is not counted here',
  ];
  if (ceilingBytes !== null) {
    bits.push(
      wiredLimitBytes !== null
        ? `ceiling: wired limit ${formatBytes(wiredLimitBytes)}`
        : `ceiling: device total ${formatBytes(totalBytes)}`
    );
  }
  if (scope === 'all processes' && processBytes !== null) bits.push(`this process: ${formatBytes(processBytes)}`);
  if (wiredLimitBytes !== null && totalBytes !== null) bits.push(`device total ${formatBytes(totalBytes)}`);
  return {
    scope,
    backend,
    usedBytes,
    ceilingBytes,
    hostInUseBytes,
    processBytes,
    wiredLimitBytes,
    totalBytes,
    label,
    note: ACCELERATOR_NOTE,
    detail: bits.join(' · '),
  };
}

// ---------------------------------------------------------------------------
// Itemized memory breakdown: what is actually consuming the memory
// ---------------------------------------------------------------------------

/**
 * EXACT: the GGUF explanation, emitted when the itemized model weights exceed
 * the accelerator heap. That is the NORMAL case for mmapped weights, not an
 * inconsistency, and it is why no remainder is computed against this figure.
 */
export const GGUF_BREAKDOWN_NOTE =
  'Σ model weights exceeds the accelerator heap. That is the normal case for memory-mapped GGUF weights: llama.cpp maps them from disk, so they are resident as process RSS and are not counted in the accelerator heap.';

/** EXACT phrasing per field that supplied a model item's byte figure. */
const DISPLAY_SIZE_SOURCE_PHRASE: Record<Exclude<DisplaySizeSource, ''>, string> = {
  size_bytes: 'reported by the model server (size_bytes)',
  size_vram_bytes: 'reported by the model server (size_vram_bytes)',
  est_weights_bytes: 'estimated on-disk weight size (est_weights_bytes)',
};

/** A fact the framework knows, labelled with what it measures. */
export interface MemoryBreakdownItem {
  key: string;
  kind: 'item';
  name: string;
  detail: string;
  bytes: number;
  bytesText: string;
  /** True when the figure is an estimate — rendered with a `~` prefix. */
  estimated: boolean;
}

/** A separate counter. NEVER summable with the items. */
export interface MemoryBreakdownReference {
  key: string;
  kind: 'reference';
  name: string;
  detail: string;
  bytes: number | null;
  /** `<used> / <total>`, or `<used>` alone when no ceiling is known. */
  valueText: string;
}

export interface MemoryBreakdownView {
  items: MemoryBreakdownItem[];
  references: MemoryBreakdownReference[];
  /** GGUF_BREAKDOWN_NOTE when Σ weights exceeds the accelerator heap, else ''. */
  note: string;
}

/**
 * The itemized view under the meters, in three kinds of line:
 *
 *  - ITEMS: facts the framework knows, each labelled with what it measures —
 *    one per resident model with a known size (weights only), the model KV
 *    caches, the session caches, and the gateway process RSS.
 *  - REFERENCES: separate counters (Σ weights, RAM, the accelerator heap)
 *    that the reader must NOT add to the items.
 *  - NOTE: the GGUF explanation, when Σ weights exceeds the accelerator heap.
 *
 * A line is emitted when its value is KNOWN and omitted when unknown; a known
 * `0` IS emitted, and no line is conditional on being non-zero.
 *
 * There is deliberately NO remainder. The old `host_in_use_bytes − (models +
 * caches + rss)` subtracted RAM-dimensioned quantities from an accelerator
 * counter that is blind to mmapped GGUF weights; live it computed −79 GB and
 * clamped to `0 B`, blaming "overlap" for a category error. Attribution
 * against RAM would need per-process accounting the framework does not have,
 * so no replacement remainder is introduced.
 */
export function buildMemoryBreakdown(state: HostStateResponse | null | undefined): MemoryBreakdownView {
  const snapshot = asRecord(state);
  const memory = asRecord(snapshot?.memory);
  const ram = asRecord(memory?.ram);
  const process = asRecord(memory?.process);
  const totals = asRecord(snapshot?.totals);
  const nonNegative = (value: unknown): number | null => {
    const n = finiteNumber(value);
    return n !== null && n >= 0 ? n : null;
  };

  const items: MemoryBreakdownItem[] = [];
  const references: MemoryBreakdownReference[] = [];

  const modelRows = Array.isArray(snapshot?.models) ? (snapshot?.models as ModelResidencyRowV1[]) : [];
  const residentRows = modelRows.filter((row) => row && row.resident === true);

  // One item per resident row with a KNOWN display size. A resident row whose
  // size the host never reported is SKIPPED — never an invented zero.
  //
  // The key rule is NORMATIVE across all four surfaces: `model:<runtime_id>`
  // when the row carries one, else `model:<provider>:<model>`. No index and
  // no task segment — real sweep rows have `runtime_id: null`, and an
  // index-bearing key would differ per surface for the same model. Two rows
  // colliding on the key are BOTH kept: a genuine duplicate provider+model
  // row is itself worth seeing.
  const modelItems: MemoryBreakdownItem[] = [];
  residentRows.forEach((row) => {
    const size = rowDisplaySize(row);
    if (size.bytes === null || size.source === '') return;
    const estimated = size.source === 'est_weights_bytes';
    const identity =
      firstString(row.runtime_id) || `${firstString(row.provider)}:${firstString(row.model)}`;
    modelItems.push({
      key: `model:${identity}`,
      kind: 'item',
      name: firstString(row.model) || firstString(row.runtime_id) || 'model',
      detail: `resident model weights · ${DISPLAY_SIZE_SOURCE_PHRASE[size.source]}`,
      bytes: size.bytes,
      bytesText: `${estimated ? '~' : ''}${formatBytes(size.bytes)}`,
      estimated,
    });
  });
  items.push(...modelItems);
  const sumModelWeights = modelItems.length === 0 ? null : modelItems.reduce((acc, item) => acc + item.bytes, 0);

  let modelCacheBytes = nonNegative(totals?.cache_bytes_models);
  if (modelCacheBytes === null) {
    modelCacheBytes = residentRows.reduce<number | null>((acc, row) => {
      const value = rowCacheBytes(row);
      return value === null ? acc : (acc === null ? 0 : acc) + value;
    }, null);
  }
  if (modelCacheBytes !== null) {
    items.push({
      key: 'model_caches',
      kind: 'item',
      name: 'model KV caches',
      detail: 'prompt-cache bytes held for resident models',
      bytes: modelCacheBytes,
      bytesText: formatBytes(modelCacheBytes),
      estimated: false,
    });
  }

  let sessionCacheBytes = nonNegative(totals?.session_cache_bytes);
  if (sessionCacheBytes === null) {
    const cacheRows = Array.isArray(snapshot?.session_caches) ? (snapshot?.session_caches as unknown[]) : null;
    if (cacheRows !== null) {
      sessionCacheBytes = cacheRows.reduce<number | null>((acc, entry) => {
        const value = nonNegative(asRecord(entry)?.bytes);
        return value === null ? acc : (acc === null ? 0 : acc) + value;
      }, null);
    }
  }
  if (sessionCacheBytes !== null) {
    items.push({
      key: 'session_caches',
      kind: 'item',
      name: 'session caches',
      detail: 'prompt-cache bytes held by gateway sessions',
      bytes: sessionCacheBytes,
      bytesText: formatBytes(sessionCacheBytes),
      estimated: false,
    });
  }

  const rss = nonNegative(process?.rss_bytes);
  if (rss !== null) {
    items.push({
      key: 'process_rss',
      kind: 'item',
      name: 'gateway process RSS',
      detail: 'resident set size of the gateway process — includes memory-mapped GGUF weights',
      bytes: rss,
      bytesText: formatBytes(rss),
      estimated: false,
    });
  }

  if (sumModelWeights !== null) {
    references.push({
      key: 'sum_model_weights',
      kind: 'reference',
      name: 'Σ model weights',
      detail: 'sum of the resident model weights above',
      bytes: sumModelWeights,
      valueText: formatBytes(sumModelWeights),
    });
  }

  const ramUsed = nonNegative(ram?.used_bytes);
  if (ramUsed !== null) {
    const ramTotal = nonNegative(ram?.total_bytes);
    references.push({
      key: 'ram',
      kind: 'reference',
      name: 'RAM used',
      detail: 'system memory in use / installed',
      bytes: ramUsed,
      valueText: ramTotal === null ? formatBytes(ramUsed) : `${formatBytes(ramUsed)} / ${formatBytes(ramTotal)}`,
    });
  }

  const accelerator = deviceMemoryView(memory?.device);
  const acceleratorUsed = accelerator?.usedBytes ?? null;
  if (accelerator !== null && acceleratorUsed !== null) {
    references.push({
      key: 'accelerator',
      kind: 'reference',
      name: accelerator.label,
      detail: accelerator.note,
      bytes: acceleratorUsed,
      valueText:
        accelerator.ceilingBytes === null
          ? formatBytes(acceleratorUsed)
          : `${formatBytes(acceleratorUsed)} / ${formatBytes(accelerator.ceilingBytes)}`,
    });
  }

  const note =
    sumModelWeights !== null && acceleratorUsed !== null && sumModelWeights > acceleratorUsed
      ? GGUF_BREAKDOWN_NOTE
      : '';

  return { items, references, note };
}

/**
 * NOTE: there is deliberately no `rssText` here. The gateway process RSS is
 * reported ONCE, as the `process_rss` breakdown item that names what it
 * measures; a second standalone row is the double-counting this panel exists
 * to remove.
 */
export interface HostMemoryView {
  meters: MeterView[];
  totals: Array<{ label: string; value: string }>;
  degraded: Array<{ name: string; reason: string }>;
  breakdown: MemoryBreakdownView;
}

export function buildHostMemoryView(state: HostStateResponse | null | undefined): HostMemoryView {
  const memory = asRecord(state?.memory);
  const meters: MeterView[] = [];

  const ram = asRecord(memory?.ram);
  if (ram) {
    const total = finiteNumber(ram.total_bytes);
    const available = finiteNumber(ram.available_bytes);
    let used = finiteNumber(ram.used_bytes);
    if (used === null && total !== null && available !== null) used = Math.max(0, total - available);
    const percent = finiteNumber(ram.percent);
    const fraction = meterFraction(used, total) ?? (percent !== null ? percent / 100 : null);
    const meter = makeMeter('ram', 'RAM', used, total, fraction);
    if (meter) meters.push(meter);
  }

  // Accelerator-heap meter, AFTER the RAM meter: RAM stays the meter a reader
  // takes as "how full is this machine". This one is the accelerator heap —
  // the all-processes figure over the process-local one, the wired limit over
  // the device total — and its label names its scope, with the GGUF caveat
  // carried as a note so nobody reads it as whole-system usage.
  const device = deviceMemoryView(memory?.device);
  if (device) {
    const meter = makeMeter('device', device.label, device.usedBytes, device.ceilingBytes);
    if (meter) meters.push({ ...meter, title: device.detail, note: device.note });
  }

  meters.push(...gpuMeters(state?.gpu));

  const totals: Array<{ label: string; value: string }> = [];
  const totalsRec = asRecord(state?.totals);
  if (totalsRec) {
    for (const [key, raw] of Object.entries(totalsRec)) {
      const label = key.replace(/_/g, ' ');
      const num = finiteNumber(raw);
      if (num !== null) {
        totals.push({ label, value: /_bytes$/.test(key) ? formatBytes(num) || String(num) : num.toLocaleString('en-US') });
      } else if (typeof raw === 'string' && raw.trim()) {
        totals.push({ label, value: raw.trim() });
      }
    }
  }

  const degraded: Array<{ name: string; reason: string }> = [];
  const reasons = asRecord(state?.reasons);
  if (Array.isArray(state?.degraded)) {
    for (const item of state.degraded) {
      if (typeof item !== 'string' || !item.trim()) continue;
      const name = item.trim();
      const reason = typeof reasons?.[name] === 'string' ? String(reasons[name]).trim() : '';
      degraded.push({ name, reason });
    }
  }

  return { meters, totals, degraded, breakdown: buildMemoryBreakdown(state) };
}

// ---------------------------------------------------------------------------
// Session caches tab
// ---------------------------------------------------------------------------

export interface SessionCacheView {
  key: string;
  provider: string;
  model: string;
  sessionId: string;
  sizeText: string;
  tokenText: string;
  createdText: string;
}

export function buildSessionCacheViews(payload: unknown): SessionCacheView[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : (() => {
        const rec = asRecord(payload);
        if (!rec) return [];
        for (const key of ['session_caches', 'caches', 'items', 'data']) {
          if (Array.isArray(rec[key])) return rec[key] as unknown[];
        }
        return [];
      })();

  const out: SessionCacheView[] = [];
  list.forEach((item, index) => {
    const rec = asRecord(item) as SessionCacheRecord | null;
    if (!rec) return;
    const sessionId = firstString(rec.session_id, rec.session);
    const key = firstString(rec.key) || sessionId || `cache-${index}`;
    const bytes = finiteNumber(rec.bytes);
    const tokens = finiteNumber(rec.token_count);
    out.push({
      key,
      provider: firstString(rec.provider),
      model: firstString(rec.model),
      sessionId,
      sizeText: bytes === null ? '' : formatBytes(bytes),
      tokenText: tokens === null ? '' : tokens.toLocaleString('en-US'),
      createdText: displayEpochSeconds(rec.created_at_s),
    });
  });
  return out;
}
