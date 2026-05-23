/**
 * Smart Run Flow Modal
 *
 * Auto-generates form fields based on the entry node's output pins.
 * Shows execution progress and results.
 */

import { useState, useCallback, useMemo, useEffect, useRef, type DragEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFlowStore } from '../hooks/useFlow';
import type { ExecutionEvent, ExecutionMetrics, Pin, FlowRunResult, RunSummary } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import { RECALL_LEVEL_OPTIONS } from '../types/recall';
import type { WaitingInfo } from '../hooks/useWebSocket';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentSubrunTracePanel } from './AgentSubrunTracePanel';
import AfSelect from './inputs/AfSelect';
import AfMultiSelect from './inputs/AfMultiSelect';
import { useProviders, useModels } from '../hooks/useProviders';
import { useTools } from '../hooks/useTools';
import { useExecutionWorkspace } from '../hooks/useExecutionWorkspace';
import { RunSwitcherDropdown } from './RunSwitcherDropdown';
import { JsonViewer } from './JsonViewer';
import { KgActiveMemoryPanel } from './KgActiveMemoryPanel';
import { artifactContentUrl, useArtifactObjectUrl } from './ArtifactPlayer';
import {
  endpointFromDescriptor,
  descriptorEndpointAvailable,
  gatewayJson,
  gatewayPath,
  jsonRequest,
  type GatewayContracts,
  type GatewayDurableBlocPromptCacheContract,
  type GatewayEndpointDescriptor,
} from '../utils/gatewayClient';
import {
  modelOptionsFromGatewayCatalog,
  providerOptionsFromGatewayCatalog,
} from '../utils/gatewayCatalog';

type FlowGraphNode = {
  id: string;
  data?: Record<string, unknown> & {
    nodeType?: string;
    label?: string;
    effectConfig?: Record<string, unknown>;
    agentConfig?: Record<string, unknown>;
    pinDefaults?: Record<string, unknown>;
    literalValue?: unknown;
  };
};

type FlowGraphEdge = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type PromptCacheGraphTarget =
  | {
      provider: string;
      model: string;
      source: 'graph';
      label?: string;
      count: number;
      multiple: false;
    }
  | {
      provider: '';
      model: '';
      source: 'graph';
      count: number;
      multiple: true;
    };

type DurableBlocOperation = 'record' | 'list' | 'kv_manifest' | 'kv_list' | 'kv_ensure' | 'kv_load';
type PromptCacheBindingValue = string | Record<string, unknown>;

interface RunFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (inputData: Record<string, unknown>) => void;
  onFollowUpSubmit?: (payload: {
    message: string;
    attachments: File[];
    contextMessages?: FollowUpMessage[];
    sessionId?: string;
    threadRootRunId?: string;
    inputDataDefaults?: Record<string, unknown> | null;
  }) => Promise<void> | void;
  onNewRun?: () => void;
  onApproveAll?: (ctx?: { rootRunId?: string; sessionId?: string }) => void;
  isRunning: boolean;
  isPaused?: boolean;
  result: FlowRunResult | null;
  events?: ExecutionEvent[];
  traceEvents?: ExecutionEvent[];
  isWaiting?: boolean;
  waitingInfo?: WaitingInfo | null;
  onResume?: (response: string | { response?: string; approved?: boolean; reason?: string; runId?: string; waitKey?: string }) => void;
  onPause?: () => void;
  onResumeRun?: () => void;
  onCancelRun?: () => void;
  onSelectRunId?: (runId: string) => void;
  runSummary?: RunSummary | null;
  stableSessionId?: string;
  threadRootRunId?: string;
  runWorkflowId?: string | null;
  gatewayContracts?: GatewayContracts | null;
}

type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type FollowUpMessage = { role: 'user' | 'assistant'; content: string };
type FollowUpContext = { messages: FollowUpMessage[]; workflowKey?: string; rootRunId?: string | null };

function parseJson<T>(raw: string): JsonParseResult<T> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { ok: false, error: 'Empty' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return { ok: false, error: msg };
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function pickNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function parsePromptCacheBindingText(raw: string): PromptCacheBindingValue | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    const parsed = parseJson<unknown>(text);
    if (parsed.ok && isRecord(parsed.value)) return parsed.value;
    return null;
  }
  return text;
}

function extractPromptCacheBinding(value: unknown): PromptCacheBindingValue | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return null;

  const direct = value.prompt_cache_binding ?? value.expected_prompt_cache_binding;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (isRecord(direct)) return direct;

  for (const key of ['artifact', 'manifest', 'result', 'data']) {
    const nested = value[key];
    const found = extractPromptCacheBinding(nested);
    if (found) return found;
  }
  return null;
}

function summarizeDurableBlocResult(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const pairs: Array<[string, string]> = [
      ['bloc_id', 'bloc_id'],
      ['sha256', 'sha256'],
      ['provider', 'provider'],
      ['model', 'model'],
      ['artifact_path', 'artifact_path'],
      ['artifact_id', 'artifact_id'],
      ['binding_id', 'binding_id'],
      ['key', 'key'],
    ];
    for (const [src, dst] of pairs) {
      const raw = candidate[src];
      if (out[dst] || raw === undefined || raw === null || raw === '') continue;
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        out[dst] = String(raw);
      }
    }
  };

  visit(value);
  if (isRecord(value)) {
    for (const key of ['record', 'artifact', 'manifest', 'result', 'data']) visit(value[key]);
    const binding = extractPromptCacheBinding(value);
    visit(binding);
  }
  return out;
}

function durableBlocEndpoint(
  contract: GatewayDurableBlocPromptCacheContract | undefined | null,
  key: DurableBlocOperation,
  fallback: string
): string {
  const endpoint = contract?.endpoints?.[key];
  return typeof endpoint === 'string' && endpoint.trim() ? endpoint : fallback;
}

async function copyTextToClipboard(text: string): Promise<void> {
  const value = String(text || '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

function isExecutionHandle(value: unknown): boolean {
  const handle = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return handle.includes('exec');
}

type ResidencyResultStatusInfo = {
  label: 'UNSUPPORTED' | 'SKIPPED';
  className: 'waiting';
  title: string;
  message: string;
};

function residencyResultStatusInfo(value: unknown): ResidencyResultStatusInfo | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  const code = typeof result.code === 'string' ? result.code.toLowerCase() : '';
  if (result.supported === false || result.available === false || code.includes('unsupported') || code.includes('unavailable')) {
    return {
      label: 'UNSUPPORTED',
      className: 'waiting',
      title: 'Gateway/Runtime reported this residency operation is unsupported here.',
      message:
        'Gateway/Runtime reported this residency operation is unsupported for the selected task, provider, or deployment.',
    };
  }
  if (result.ok === false) {
    return {
      label: 'SKIPPED',
      className: 'waiting',
      title: 'Optional residency request completed without changing runtime state.',
      message: 'This optional residency request completed without changing runtime state.',
    };
  }
  return null;
}

function extractPreferredModelInfo(value: unknown): { provider?: string; model?: string } {
  if (!value || typeof value !== 'object') return {};
  const obj = value as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  let provider = pick(obj.media_provider);
  let model = pick(obj.media_model);

  const metadata = obj.metadata;
  if ((!provider || !model) && metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    provider = provider ?? pick(m.media_provider);
    model = model ?? pick(m.media_model);
  }

  const outputs = obj.outputs;
  if ((!provider || !model) && outputs && typeof outputs === 'object') {
    const outputGroups = outputs as Record<string, unknown>;
    for (const value of Object.values(outputGroups)) {
      if (!Array.isArray(value)) continue;
      const item = value.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined;
      if (!item) continue;
      provider = provider ?? pick(item.media_provider) ?? pick(item.provider);
      model = model ?? pick(item.media_model) ?? pick(item.model);
      if (provider || model) break;
    }
  }

  provider = provider ?? pick(obj.provider);
  model = model ?? pick(obj.model);

  if ((!provider || !model) && metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    provider = provider ?? pick(m.provider);
    model = model ?? pick(m.model);
  }

  const raw = obj.raw;
  if ((!provider || !model) && raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    provider = provider ?? pick(r.provider);
    model = model ?? pick(r.model);
  }

  const nested = obj.result;
  if ((!provider || !model) && nested && typeof nested === 'object') {
    const n = nested as Record<string, unknown>;
    provider = provider ?? pick(n.media_provider) ?? pick(n.provider);
    model = model ?? pick(n.media_model) ?? pick(n.model);
  }

  return { provider, model };
}

function parseSequenceHandleIndex(value: unknown): number | null {
  const handle = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = /^then:(\d+)$/.exec(handle);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function reachableExecutionNodeIds(nodes: FlowGraphNode[], edges: FlowGraphEdge[]): Set<string> {
  const starts = nodes
    .filter((n) => {
      const nodeType = pickNonEmptyString(n.data?.nodeType);
      return nodeType ? isEntryNodeType(nodeType as Parameters<typeof isEntryNodeType>[0]) : false;
    })
    .map((n) => n.id);
  if (starts.length === 0 && nodes[0]?.id) starts.push(nodes[0].id);

  const bySource = new Map<string, FlowGraphEdge[]>();
  for (const edge of edges) {
    const source = pickNonEmptyString(edge.source);
    const target = pickNonEmptyString(edge.target);
    if (!source || !target) continue;
    if (!isExecutionHandle(edge.sourceHandle) && !isExecutionHandle(edge.targetHandle)) continue;
    const list = bySource.get(source) || [];
    list.push(edge);
    bySource.set(source, list);
  }

  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const edge of bySource.get(id) || []) {
      const target = pickNonEmptyString(edge.target);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

function inferConnectedPinDefault(
  nodeId: string,
  pinId: 'provider' | 'model',
  nodesById: Map<string, FlowGraphNode>,
  edges: FlowGraphEdge[]
): string {
  for (const edge of edges) {
    if (edge.target !== nodeId || edge.targetHandle !== pinId) continue;
    const sourceId = pickNonEmptyString(edge.source);
    if (!sourceId) continue;
    const source = nodesById.get(sourceId);
    const data = source?.data;
    if (!data) continue;
    const sourceHandle = pickNonEmptyString(edge.sourceHandle) || pinId;

    const pinDefaults = isRecord(data.pinDefaults) ? data.pinDefaults : null;
    const fromDefault = pinDefaults ? pickNonEmptyString(pinDefaults[sourceHandle]) : '';
    if (fromDefault) return fromDefault;

    const literalValue = data.literalValue;
    const literalString = pickNonEmptyString(literalValue);
    if (literalString) return literalString;
    if (isRecord(literalValue)) {
      const fromDefaultKey = pickNonEmptyString(literalValue.default);
      if (fromDefaultKey) return fromDefaultKey;
      const fromHandle = pickNonEmptyString(literalValue[sourceHandle]);
      if (fromHandle) return fromHandle;
    }
  }
  return '';
}

function inferPromptCacheGraphTarget(nodes: FlowGraphNode[], edges: FlowGraphEdge[]): PromptCacheGraphTarget | null {
  const nodesById = new Map(nodes.map((n) => [n.id, n] as const));
  const reachable = reachableExecutionNodeIds(nodes, edges);
  const useReachable = reachable.size > 0;
  const pairs = new Map<string, { provider: string; model: string; label?: string; count: number }>();

  for (const node of nodes) {
    if (useReachable && !reachable.has(node.id)) continue;
    const data = node.data;
    const nodeType = pickNonEmptyString(data?.nodeType);
    const cfg =
      nodeType === 'agent'
        ? data?.agentConfig
        : nodeType === 'llm_call' || nodeType === 'memory_compact'
          ? data?.effectConfig
          : null;
    if (!cfg) continue;

    const provider = pickNonEmptyString(cfg.provider) || inferConnectedPinDefault(node.id, 'provider', nodesById, edges);
    const model = pickNonEmptyString(cfg.model) || inferConnectedPinDefault(node.id, 'model', nodesById, edges);
    if (!provider || !model) continue;

    const normalizedProvider = provider.toLowerCase();
    const key = `${normalizedProvider}\x1f${model}`;
    const existing = pairs.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      pairs.set(key, {
        provider: normalizedProvider,
        model,
        label: pickNonEmptyString(data?.label) || node.id,
        count: 1,
      });
    }
  }

  if (pairs.size === 0) return null;
  if (pairs.size > 1) return { provider: '', model: '', source: 'graph', count: pairs.size, multiple: true };
  const only = Array.from(pairs.values())[0];
  return { ...only, source: 'graph', multiple: false };
}

type GeneratedImagePreview = {
  artifactId: string;
  src: string;
  fallbackSrcs?: string[];
  contentType?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  width?: number;
  height?: number;
  format?: string;
};

type GeneratedAudioPreview = {
  artifactId: string;
  src: string;
  fallbackSrcs?: string[];
  contentType?: string;
  text?: string;
  provider?: string;
  model?: string;
  voice?: string;
  format?: string;
};

type GeneratedTextPreview = {
  artifactId: string;
  text: string;
  provider?: string;
  model?: string;
};

type RunGeneratedArtifact =
  | { kind: 'image'; preview: GeneratedImagePreview; stepLabel: string }
  | { kind: 'audio'; preview: GeneratedAudioPreview; stepLabel: string }
  | { kind: 'text'; preview: GeneratedTextPreview; stepLabel: string };

type ArtifactRunScope = string | null | undefined | Array<string | null | undefined>;

function artifactRunScopeValues(scope: ArtifactRunScope): string[] {
  const values = Array.isArray(scope) ? scope : [scope];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = pickNonEmptyString(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function artifactRecordRunCandidates(artifactId: string, ...records: Array<Record<string, unknown> | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: unknown) => {
    const clean = pickNonEmptyString(value);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  for (const record of records) {
    if (!record) continue;
    add(record.run_id);
    add(record.artifact_run_id);
    add(record.owner_run_id);
    const tags = isRecord(record.tags) ? record.tags : null;
    if (tags) {
      add(tags.run_id);
      add(tags.artifact_run_id);
      add(tags.owner_run_id);
      const projectedArtifactId = pickNonEmptyString(tags.projected_from_artifact_id);
      if (projectedArtifactId && projectedArtifactId === artifactId) add(tags.projected_from_run_id);
    }
    const projectedArtifactId = pickNonEmptyString(record.projected_from_artifact_id);
    if (projectedArtifactId && projectedArtifactId === artifactId) add(record.projected_from_run_id);
  }
  return out;
}

function artifactContentType(record: Record<string, unknown> | null | undefined): string {
  return pickNonEmptyString(record?.content_type || record?.contentType).toLowerCase();
}

function artifactModality(record: Record<string, unknown> | null | undefined): string {
  return pickNonEmptyString(record?.modality || record?.type || record?.kind).toLowerCase();
}

function artifactLooksLikeImage(record: Record<string, unknown> | null | undefined): boolean {
  const contentType = artifactContentType(record);
  const modality = artifactModality(record);
  return contentType.startsWith('image/') || modality === 'image';
}

function artifactLooksLikeAudio(record: Record<string, unknown> | null | undefined): boolean {
  const contentType = artifactContentType(record);
  const modality = artifactModality(record);
  return (
    contentType.startsWith('audio/') ||
    modality === 'audio' ||
    modality === 'voice' ||
    modality === 'music'
  );
}

function extractGeneratedImagePreview(
  value: unknown,
  runScope: ArtifactRunScope,
  artifactContentDescriptor?: GatewayEndpointDescriptor | string | null
): GeneratedImagePreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : '';
  const payloadRaw = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
    ? (obj.payload as Record<string, unknown>)
    : obj;
  const asRecord = (item: unknown): Record<string, unknown> | null =>
    item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
  const imageEvent = name === 'abstract.media.image.generated';
  const genericArtifactRaw = payloadRaw.artifact_ref ?? payloadRaw.artifact;
  const genericArtifact = asRecord(genericArtifactRaw);
  const directArtifactRaw =
    payloadRaw.image_artifact ??
    payloadRaw.image ??
    (imageEvent || artifactLooksLikeImage(genericArtifact) ? genericArtifactRaw : undefined);
  const directImage = asRecord(directArtifactRaw);
  const directArtifactId =
    typeof directArtifactRaw === 'string' && directArtifactRaw.trim() ? directArtifactRaw.trim() : '';
  const outputs = asRecord(payloadRaw.outputs);
  const outputImageRaw = outputs?.image;
  const imageItems = Array.isArray(outputImageRaw) ? outputImageRaw : outputImageRaw != null ? [outputImageRaw] : [];
  const generatedItem = imageItems.find((item) => typeof item === 'string' || asRecord(item));
  const generatedRecord = asRecord(generatedItem);
  const generatedArtifactRaw =
    generatedRecord?.artifact_ref ??
    generatedRecord?.image_artifact ??
    generatedRecord?.artifact ??
    generatedItem;
  const generatedArtifact = asRecord(generatedArtifactRaw);
  const generatedArtifactId =
    typeof generatedArtifactRaw === 'string' && generatedArtifactRaw.trim()
      ? generatedArtifactRaw.trim()
      : '';
  const imageRaw = directImage || generatedArtifact;
  const payloadImageArtifactId =
    imageEvent || artifactLooksLikeImage(payloadRaw)
      ? (typeof payloadRaw.artifact_id === 'string' && payloadRaw.artifact_id.trim()) ||
        (typeof payloadRaw.$artifact === 'string' && payloadRaw.$artifact.trim()) ||
        ''
      : '';
  if (name && !imageEvent && !imageRaw && !directArtifactId && !generatedArtifactId && !payloadImageArtifactId) return null;
  const artifactId =
    (imageRaw && typeof imageRaw.artifact_id === 'string' && imageRaw.artifact_id.trim()) ||
    (imageRaw && typeof imageRaw.$artifact === 'string' && imageRaw.$artifact.trim()) ||
    directArtifactId ||
    generatedArtifactId ||
    payloadImageArtifactId ||
    '';
  if (!artifactId) return null;
  const runCandidates = [
    ...artifactRecordRunCandidates(artifactId, imageRaw, generatedRecord, generatedArtifact, payloadRaw, obj),
    ...artifactRunScopeValues(runScope),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (!runCandidates.length) return null;
  const imageProvider =
    (imageRaw && typeof imageRaw.media_provider === 'string' && imageRaw.media_provider.trim()) ||
    (typeof generatedRecord?.media_provider === 'string' && generatedRecord.media_provider.trim()) ||
    (imageRaw && typeof imageRaw.provider === 'string' && imageRaw.provider.trim()) ||
    (typeof generatedRecord?.provider === 'string' && generatedRecord.provider.trim()) ||
    (typeof payloadRaw.image_provider === 'string' && payloadRaw.image_provider.trim()) ||
    (typeof payloadRaw.media_provider === 'string' && payloadRaw.media_provider.trim()) ||
    (typeof payloadRaw.provider === 'string' && payloadRaw.provider.trim()) ||
    undefined;
  const imageModel =
    (imageRaw && typeof imageRaw.media_model === 'string' && imageRaw.media_model.trim()) ||
    (typeof generatedRecord?.media_model === 'string' && generatedRecord.media_model.trim()) ||
    (imageRaw && typeof imageRaw.model === 'string' && imageRaw.model.trim()) ||
    (typeof generatedRecord?.model === 'string' && generatedRecord.model.trim()) ||
    (typeof payloadRaw.image_model === 'string' && payloadRaw.image_model.trim()) ||
    (typeof payloadRaw.media_model === 'string' && payloadRaw.media_model.trim()) ||
    (typeof payloadRaw.model === 'string' && payloadRaw.model.trim()) ||
    undefined;
  return {
    artifactId,
    src: artifactContentUrl(artifactContentDescriptor, runCandidates[0], artifactId),
    fallbackSrcs: runCandidates.slice(1).map((candidate) => artifactContentUrl(artifactContentDescriptor, candidate, artifactId)),
    contentType: imageRaw && typeof imageRaw.content_type === 'string' ? imageRaw.content_type : typeof generatedRecord?.content_type === 'string' ? generatedRecord.content_type : undefined,
    prompt: typeof payloadRaw.prompt === 'string' ? payloadRaw.prompt : typeof generatedRecord?.prompt === 'string' ? generatedRecord.prompt : undefined,
    provider: imageProvider,
    model: imageModel,
    width: typeof payloadRaw.width === 'number' ? payloadRaw.width : typeof generatedRecord?.width === 'number' ? generatedRecord.width : undefined,
    height: typeof payloadRaw.height === 'number' ? payloadRaw.height : typeof generatedRecord?.height === 'number' ? generatedRecord.height : undefined,
    format: typeof payloadRaw.format === 'string' ? payloadRaw.format : typeof generatedRecord?.format === 'string' ? generatedRecord.format : undefined,
  };
}

function extractGeneratedAudioPreview(
  value: unknown,
  runScope: ArtifactRunScope,
  artifactContentDescriptor?: GatewayEndpointDescriptor | string | null
): GeneratedAudioPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : '';
  const payloadRaw = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
    ? (obj.payload as Record<string, unknown>)
    : obj;
  const audioEvent =
    name === 'abstract.media.voice.generated' ||
    name === 'abstract.media.music.generated' ||
    name === 'abstract.media.audio.generated' ||
    name === 'abstract.voice.tts';

  const genericAudioRaw = payloadRaw.artifact_ref || payloadRaw.artifact;
  const genericAudioRecord = genericAudioRaw && typeof genericAudioRaw === 'object' && !Array.isArray(genericAudioRaw)
    ? (genericAudioRaw as Record<string, unknown>)
    : null;
  const directAudioRaw =
    payloadRaw.audio_artifact ||
    payloadRaw.music_artifact ||
    (audioEvent || artifactLooksLikeAudio(genericAudioRecord) ? genericAudioRaw : undefined);
  const directAudio = directAudioRaw && typeof directAudioRaw === 'object' && !Array.isArray(directAudioRaw)
    ? (directAudioRaw as Record<string, unknown>)
    : null;
  const directAudioId = typeof directAudioRaw === 'string' && directAudioRaw.trim() ? directAudioRaw.trim() : '';
  const outputs = payloadRaw.outputs && typeof payloadRaw.outputs === 'object' && !Array.isArray(payloadRaw.outputs)
    ? (payloadRaw.outputs as Record<string, unknown>)
    : null;
  const outputAudioRaw = outputs?.music ?? outputs?.voice ?? outputs?.audio;
  const voiceItems = Array.isArray(outputAudioRaw) ? outputAudioRaw : outputAudioRaw != null ? [outputAudioRaw] : [];
  const generatedItemRaw = voiceItems.find((item) => typeof item === 'string' || (item && typeof item === 'object' && !Array.isArray(item)));
  const generatedItem = generatedItemRaw && typeof generatedItemRaw === 'object' && !Array.isArray(generatedItemRaw)
    ? (generatedItemRaw as Record<string, unknown>)
    : undefined;
  const itemArtifactRaw =
    generatedItem?.artifact_ref ??
    generatedItem?.music_artifact ??
    generatedItem?.audio_artifact ??
    generatedItem?.artifact ??
    generatedItemRaw;
  const itemArtifact = itemArtifactRaw && typeof itemArtifactRaw === 'object' && !Array.isArray(itemArtifactRaw)
    ? (itemArtifactRaw as Record<string, unknown>)
    : null;
  const itemArtifactId = typeof itemArtifactRaw === 'string' && itemArtifactRaw.trim()
    ? itemArtifactRaw.trim()
    : '';
  const audioRaw = directAudio || itemArtifact;
  const hasAudioArtifactShape =
    Boolean(directAudio) ||
    Boolean(directAudioId) ||
    Boolean(itemArtifact) ||
    Boolean(itemArtifactId) ||
    Boolean(audioEvent || artifactLooksLikeAudio(payloadRaw));
  if (!audioEvent && !hasAudioArtifactShape) return null;

  const payloadAudioArtifactId =
    audioEvent || artifactLooksLikeAudio(payloadRaw)
      ? (typeof payloadRaw.artifact_id === 'string' && payloadRaw.artifact_id.trim()) ||
        (typeof payloadRaw.$artifact === 'string' && payloadRaw.$artifact.trim()) ||
        ''
      : '';
  const artifactId =
    (audioRaw && typeof audioRaw.artifact_id === 'string' && audioRaw.artifact_id.trim()) ||
    (audioRaw && typeof audioRaw.$artifact === 'string' && audioRaw.$artifact.trim()) ||
    directAudioId ||
    itemArtifactId ||
    payloadAudioArtifactId ||
    '';
  if (!artifactId) return null;
  const runCandidates = [
    ...artifactRecordRunCandidates(artifactId, audioRaw, generatedItem, itemArtifact, payloadRaw, obj),
    ...artifactRunScopeValues(runScope),
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  if (!runCandidates.length) return null;
  const audioProvider =
    (generatedItem && typeof generatedItem.media_provider === 'string' && generatedItem.media_provider.trim()) ||
    (audioRaw && typeof audioRaw.media_provider === 'string' && audioRaw.media_provider.trim()) ||
    (generatedItem && typeof generatedItem.provider === 'string' && generatedItem.provider.trim()) ||
    (audioRaw && typeof audioRaw.provider === 'string' && audioRaw.provider.trim()) ||
    (typeof payloadRaw.media_provider === 'string' && payloadRaw.media_provider.trim()) ||
    (typeof payloadRaw.music_provider === 'string' && payloadRaw.music_provider.trim()) ||
    (typeof payloadRaw.provider === 'string' && payloadRaw.provider.trim()) ||
    undefined;
  const audioModel =
    (generatedItem && typeof generatedItem.media_model === 'string' && generatedItem.media_model.trim()) ||
    (audioRaw && typeof audioRaw.media_model === 'string' && audioRaw.media_model.trim()) ||
    (generatedItem && typeof generatedItem.model === 'string' && generatedItem.model.trim()) ||
    (audioRaw && typeof audioRaw.model === 'string' && audioRaw.model.trim()) ||
    (typeof payloadRaw.media_model === 'string' && payloadRaw.media_model.trim()) ||
    (typeof payloadRaw.music_model === 'string' && payloadRaw.music_model.trim()) ||
    (typeof payloadRaw.model === 'string' && payloadRaw.model.trim()) ||
    undefined;

  return {
    artifactId,
    src: artifactContentUrl(artifactContentDescriptor, runCandidates[0], artifactId),
    fallbackSrcs: runCandidates.slice(1).map((candidate) => artifactContentUrl(artifactContentDescriptor, candidate, artifactId)),
    contentType: audioRaw && typeof audioRaw.content_type === 'string' ? audioRaw.content_type : typeof generatedItem?.content_type === 'string' ? generatedItem.content_type : undefined,
    text: typeof payloadRaw.text === 'string' ? payloadRaw.text : typeof payloadRaw.prompt === 'string' ? payloadRaw.prompt : undefined,
    provider: audioProvider,
    model: audioModel,
    voice: typeof payloadRaw.voice === 'string' ? payloadRaw.voice : typeof generatedItem?.voice === 'string' ? generatedItem.voice : undefined,
    format: typeof payloadRaw.format === 'string' ? payloadRaw.format : typeof generatedItem?.format === 'string' ? generatedItem.format : undefined,
  };
}

function extractGeneratedTextPreview(value: unknown, step: { id: string; nodeType?: string }): GeneratedTextPreview | null {
  const nodeType = String(step.nodeType || '').trim();
  if (!['llm_call', 'agent', 'memory_compact'].includes(nodeType)) return null;
  if (value == null) return null;

  const asRecord = (item: unknown): Record<string, unknown> | null =>
    item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
  const pickText = (item: unknown): string => {
    if (typeof item === 'string') return item.trim();
    const obj = asRecord(item);
    if (!obj) return '';
    for (const key of ['content', 'text', 'message', 'response', 'result', 'output']) {
      const raw = obj[key];
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    for (const key of ['result', 'output', 'data']) {
      const nested = pickText(obj[key]);
      if (nested) return nested;
    }
    return '';
  };
  const root = asRecord(value);
  const text = pickText(value);
  if (!text) return null;

  const raw = asRecord(root?.raw) || asRecord(root?.raw_response);
  const result = asRecord(root?.result);
  const provider =
    (typeof root?.provider === 'string' && root.provider.trim()) ||
    (typeof result?.provider === 'string' && result.provider.trim()) ||
    (typeof raw?.provider === 'string' && raw.provider.trim()) ||
    undefined;
  const model =
    (typeof root?.model === 'string' && root.model.trim()) ||
    (typeof result?.model === 'string' && result.model.trim()) ||
    (typeof raw?.model === 'string' && raw.model.trim()) ||
    undefined;

  return {
    artifactId: `text:${step.id}`,
    text,
    provider,
    model,
  };
}

function GeneratedImageCard({ preview, compact = false }: { preview: GeneratedImagePreview; compact?: boolean }) {
  const { objectUrl, loading, error } = useArtifactObjectUrl(preview.src, preview.contentType || 'image/png', preview.fallbackSrcs);
  const displayUrl = objectUrl || preview.src;
  return (
    <div className={`run-generated-image ${compact ? 'run-generated-artifact-card' : ''}`}>
      {loading ? (
        <div className="run-details-empty">Loading image artifact...</div>
      ) : error ? (
        <div className="run-details-error">{error}</div>
      ) : (
        <img
          src={displayUrl}
          alt={preview.prompt || preview.artifactId}
          className="run-generated-image-img"
        />
      )}
      <div className="run-output-meta">
        {preview.prompt && !compact ? (
          <div>
            <span className="run-output-meta-key">Prompt</span>
            <span className="run-output-meta-val">{preview.prompt}</span>
          </div>
        ) : null}
        {(preview.provider || preview.model) ? (
          <div>
            <span className="run-output-meta-key">Model</span>
            <span className="run-output-meta-val">
              <span className="run-output-meta-badges">
                {preview.provider ? <span className="run-metric-badge metric-provider" title={preview.provider}>{preview.provider}</span> : null}
                {preview.model ? <span className="run-metric-badge metric-model" title={preview.model}>{preview.model}</span> : null}
              </span>
            </span>
          </div>
        ) : null}
        <div>
          <span className="run-output-meta-key">Artifact</span>
          <span className="run-output-meta-val">{preview.artifactId}</span>
        </div>
        <div>
          <span className="run-output-meta-key">Open</span>
          <span className="run-output-meta-val">
            <a className="run-output-link" href={displayUrl} target="_blank" rel="noreferrer" download={`${preview.artifactId}.${preview.format || 'png'}`}>
              artifact content
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

function GeneratedAudioCard({ preview, autoPlay = false, compact = false }: { preview: GeneratedAudioPreview; autoPlay?: boolean; compact?: boolean }) {
  const { objectUrl, loading, error } = useArtifactObjectUrl(preview.src, preview.contentType || 'audio/wav', preview.fallbackSrcs);
  const displayUrl = objectUrl || preview.src;
  return (
    <div className={`run-generated-audio ${compact ? 'run-generated-artifact-card' : ''}`}>
      {loading ? (
        <div className="run-details-empty">Loading audio artifact...</div>
      ) : error ? (
        <div className="run-details-error">{error}</div>
      ) : (
        <audio
          src={displayUrl}
          controls
          autoPlay={autoPlay}
          className="run-generated-audio-player"
        />
      )}
      <div className="run-output-meta">
        {preview.text && !compact ? (
          <div>
            <span className="run-output-meta-key">Text</span>
            <span className="run-output-meta-val">{preview.text}</span>
          </div>
        ) : null}
        {(preview.provider || preview.model || preview.voice) ? (
          <div>
            <span className="run-output-meta-key">Audio</span>
            <span className="run-output-meta-val">
              <span className="run-output-meta-badges">
                {preview.provider ? <span className="run-metric-badge metric-provider" title={preview.provider}>{preview.provider}</span> : null}
                {preview.model ? <span className="run-metric-badge metric-model" title={preview.model}>{preview.model}</span> : null}
                {preview.voice ? <span className="run-metric-badge" title={preview.voice}>{preview.voice}</span> : null}
              </span>
            </span>
          </div>
        ) : null}
        <div>
          <span className="run-output-meta-key">Artifact</span>
          <span className="run-output-meta-val">{preview.artifactId}</span>
        </div>
        <div>
          <span className="run-output-meta-key">Open</span>
          <span className="run-output-meta-val">
            <a className="run-output-link" href={displayUrl} target="_blank" rel="noreferrer" download={`${preview.artifactId}.${preview.format || 'wav'}`}>
              artifact content
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

function GeneratedTextCard({ preview, compact = false }: { preview: GeneratedTextPreview; compact?: boolean }) {
  return (
    <div className={`run-generated-text ${compact ? 'run-generated-artifact-card' : ''}`}>
      <div className="run-details-markdown run-generated-text-body">
        <MarkdownRenderer markdown={preview.text} />
      </div>
      <div className="run-output-meta">
        {(preview.provider || preview.model) ? (
          <div>
            <span className="run-output-meta-key">Model</span>
            <span className="run-output-meta-val">
              <span className="run-output-meta-badges">
                {preview.provider ? <span className="run-metric-badge metric-provider" title={preview.provider}>{preview.provider}</span> : null}
                {preview.model ? <span className="run-metric-badge metric-model" title={preview.model}>{preview.model}</span> : null}
              </span>
            </span>
          </div>
        ) : null}
        {!compact ? (
          <div>
            <span className="run-output-meta-key">Artifact</span>
            <span className="run-output-meta-val">{preview.artifactId}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MinimizeWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 9l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15 4h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 20H4v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RestoreWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 15h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 9h-5V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 10l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrayParamEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  // Support empty -> []
  const trimmed = (value || '').trim();
  const parsed = trimmed ? parseJson<unknown>(trimmed) : ({ ok: true, value: [] } as const);

  const canUseList = parsed.ok && isStringArray(parsed.value);
  const items = canUseList ? parsed.value : [];

  const setItems = (nextItems: string[]) => {
    onChange(stringifyJson(nextItems));
  };

  if (!canUseList) {
    const hint =
      !trimmed
        ? 'Enter a JSON array (e.g., ["a","b"]).'
        : !parsed.ok
          ? `Invalid JSON: ${parsed.error}`
          : 'This array contains non-string items. Use Raw JSON to edit advanced arrays.';

    return (
      <div className="array-editor">
        <span className="property-hint">{hint}</span>
        <textarea
          className="run-form-input property-textarea code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="[ ]"
          rows={5}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div className="array-editor">
      {items.map((item, index) => (
        <div key={index} className="array-item">
          <input
            type="text"
            className="run-form-input array-item-input"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[index] = e.target.value;
              setItems(next);
            }}
            placeholder={`Item ${index + 1}`}
            disabled={disabled}
          />
          <button
            type="button"
            className="array-item-remove"
            onClick={() => setItems(items.filter((_, i) => i !== index))}
            title="Remove item"
            disabled={disabled}
          >
            &times;
          </button>
        </div>
      ))}

      <button
        type="button"
        className="array-add-button"
        onClick={() => setItems([...items, ''])}
        disabled={disabled}
      >
        + Add Item
      </button>

      <span className="property-hint">{items.length} items</span>

      <details className="raw-json-details">
        <summary>Raw JSON (advanced)</summary>
        <textarea
          className="run-form-input property-textarea code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='[\n  "item"\n]'
          rows={6}
          disabled={disabled}
        />
      </details>
    </div>
  );
}

// Map pin types to input field types
function getInputTypeForPin(pinType: string): 'text' | 'number' | 'checkbox' | 'textarea' {
  switch (pinType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'string':
    case 'object':
    case 'memory':
    case 'array':
      return 'textarea';
    default:
      return 'text';
  }
}

// Get placeholder text for pin type
function getPlaceholderForPin(pin: Pin): string {
  switch (pin.type) {
    case 'string':
      return `Enter ${pin.label}...`;
    case 'number':
      return '0';
    case 'object':
    case 'memory':
      return '{ }';
    case 'array':
      return '[ ]';
    case 'provider':
    case 'provider_text':
    case 'provider_image':
    case 'provider_voice':
    case 'provider_music':
      return 'Select provider…';
    case 'model':
    case 'model_text':
    case 'model_image':
    case 'model_voice':
    case 'model_music':
      return 'Select model…';
    default:
      return '';
  }
}

type ProviderScope = 'text' | 'image' | 'voice' | 'music';
type RunSelectOption = { value: string; label: string };

function providerScopeForPin(pin: Pin): ProviderScope | null {
  if (pin.type === 'provider_image' || pin.id === 'image_provider' || pin.id === 'provider_image') return 'image';
  if (
    pin.type === 'provider_voice' ||
    pin.id === 'tts_provider' ||
    pin.id === 'stt_provider' ||
    pin.id === 'provider_voice'
  ) {
    return 'voice';
  }
  if (pin.type === 'provider_music' || pin.id === 'music_provider' || pin.id === 'provider_music') return 'music';
  if (pin.type === 'provider' || pin.type === 'provider_text' || pin.id === 'provider') return 'text';
  return null;
}

function isTextProviderInputPin(pin: Pin): boolean {
  return providerScopeForPin(pin) === 'text';
}

function isImageProviderInputPin(pin: Pin): boolean {
  return providerScopeForPin(pin) === 'image';
}

function isVoiceProviderInputPin(pin: Pin): boolean {
  return providerScopeForPin(pin) === 'voice';
}

function isMusicProviderInputPin(pin: Pin): boolean {
  return providerScopeForPin(pin) === 'music';
}

function modelScopeForPin(pin: Pin, pins: Pin[]): ProviderScope {
  if (pin.type === 'model_image' || pin.id === 'image_model' || pin.id === 'model_image') return 'image';
  if (
    pin.type === 'model_voice' ||
    pin.id === 'tts_model' ||
    pin.id === 'stt_model' ||
    pin.id === 'model_voice'
  ) {
    return 'voice';
  }
  if (pin.type === 'model_music' || pin.id === 'music_model' || pin.id === 'model_music') return 'music';
  if (pin.type === 'model_text' || pin.id === 'model_text') return 'text';

  // Generic `model` is intentionally scoped by the provider pin in the same
  // launch form. If a form only exposes an image or voice provider, the model
  // dropdown must use that catalog rather than the generic LLM model catalog.
  if (pin.type === 'model' || pin.id === 'model') {
    const scopes = new Set(pins.map(providerScopeForPin).filter(Boolean) as ProviderScope[]);
    if (scopes.size === 1 && scopes.has('image')) return 'image';
    if (scopes.size === 1 && scopes.has('voice')) return 'voice';
    if (scopes.size === 1 && scopes.has('music')) return 'music';
    return 'text';
  }
  return 'text';
}

function isModelInputPin(pin: Pin): boolean {
  return (
    pin.type === 'model' ||
    pin.type === 'model_text' ||
    pin.type === 'model_image' ||
    pin.type === 'model_voice' ||
    pin.type === 'model_music' ||
    pin.id === 'model' ||
    pin.id.endsWith('_model')
  );
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function dedupeOptions(options: RunSelectOption[]): RunSelectOption[] {
  const seen = new Set<string>();
  const out: RunSelectOption[] = [];
  for (const option of options) {
    const value = textValue(option.value);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value, label: textValue(option.label) || value });
  }
  return out;
}

function providerOptionsFromCatalog(payload: unknown, keys: string[]): RunSelectOption[] {
  return providerOptionsFromGatewayCatalog(payload, keys, [
    'models_by_provider',
    'provider_models',
    'tts_models_by_provider',
    'stt_models_by_provider',
    'music_models_by_provider',
  ]).map((option) => ({ value: option.value, label: option.label }));
}

function modelOptionsFromCatalog(payload: unknown, provider: string, keys: string[]): RunSelectOption[] {
  return modelOptionsFromGatewayCatalog(payload, provider, keys, [
    'models_by_provider',
    'provider_models',
    'tts_models_by_provider',
    'stt_models_by_provider',
    'music_models_by_provider',
  ]).map((option) => ({ value: option.value, label: option.label }));
}

export function RunFlowModal({
  isOpen,
  onClose,
  onRun,
  onFollowUpSubmit,
  onNewRun,
  onApproveAll,
  isRunning,
  isPaused = false,
  result,
  events = [],
  traceEvents = [],
  isWaiting = false,
  waitingInfo = null,
  onResume,
  onPause,
  onResumeRun,
  onCancelRun,
  onSelectRunId,
  runSummary = null,
  stableSessionId,
  threadRootRunId,
  runWorkflowId,
  gatewayContracts = null,
}: RunFlowModalProps) {
  const { nodes, edges, flowName, flowId, lastLoopProgress, loopProgressByNodeId } = useFlowStore();
  const currentWorkflowKey = useMemo(() => (typeof flowId === 'string' ? flowId.trim() : ''), [flowId]);
  const runWorkflowKey = useMemo(() => {
    const raw =
      (typeof runWorkflowId === 'string' && runWorkflowId.trim()) ||
      (typeof runSummary?.workflow_id === 'string' && runSummary.workflow_id.trim()) ||
      '';
    if (!raw || !currentWorkflowKey) return raw;
    if (
      raw === currentWorkflowKey ||
      raw.endsWith(`:${currentWorkflowKey}`) ||
      raw.endsWith(`/${currentWorkflowKey}`)
    ) {
      return currentWorkflowKey;
    }
    return raw;
  }, [currentWorkflowKey, runSummary?.workflow_id, runWorkflowId]);
  const followUpWorkflowKey = useMemo(() => {
    return runWorkflowKey || currentWorkflowKey;
  }, [currentWorkflowKey, runWorkflowKey]);

  const memoryScopeOptions = useMemo(() => {
    // Heuristic: `scope` is a platform-wide memory routing enum.
    // - `all` is only meaningful for query-like operations (fan-out over run+session+global).
    const allowAll = nodes.some((n) => {
      const t = n?.data?.nodeType;
      if (t === 'memory_query' || t === 'memory_tag' || t === 'memory_kg_query') return true;
      if (t === 'subflow') {
        const ins = Array.isArray(n?.data?.inputs) ? n.data.inputs : [];
        return ins.some((p: any) => p && (p.id === 'query_text' || p.id === 'query'));
      }
      return false;
    });
    return allowAll ? ['run', 'session', 'global', 'all'] : ['run', 'session', 'global'];
  }, [nodes]);

  const nodeById = useMemo(() => {
    const map = new Map<string, (typeof nodes)[number]>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  const resolveNodeMeta = useCallback((nodeId: string | undefined) => {
    if (!nodeId) return null;
    const n = nodeById.get(nodeId);
    if (!n) {
      if (nodeId === '__follow_up__') {
        return {
          label: 'Follow Up',
          type: 'ask_user',
          icon: '...',
          color: '#3a4a5a',
        };
      }
      if (nodeId === '__implicit_flow_end__') {
        return {
          label: 'On Flow End',
          type: 'on_flow_end',
          icon: '🏁',
          color: '#2f8f8d',
        };
      }
      return null;
    }
    return {
      label: n.data.label || nodeId,
      type: n.data.nodeType,
      icon: n.data.icon,
      color: n.data.headerColor,
    };
  }, [nodeById]);

  const sequenceLayouts = useMemo(() => {
    const out = new Map<string, Array<{ handleId: string; index: number; label: string; targetNodeId: string }>>();

    for (const node of nodes) {
      if (node.data?.nodeType !== 'sequence') continue;

      const labelByHandle = new Map<string, string>();
      const outputs = Array.isArray(node.data?.outputs) ? node.data.outputs : [];
      for (const pin of outputs) {
        if (!pin) continue;
        const handleId = pickNonEmptyString(pin.id);
        const idx = parseSequenceHandleIndex(handleId);
        if (idx == null) continue;
        const label = pickNonEmptyString(pin.label) || `Then ${idx}`;
        labelByHandle.set(handleId, label);
      }

      const branches: Array<{ handleId: string; index: number; label: string; targetNodeId: string }> = [];
      for (const edge of edges) {
        if (pickNonEmptyString(edge.source) !== node.id) continue;
        if (pickNonEmptyString(edge.targetHandle) !== 'exec-in') continue;
        const handleId = pickNonEmptyString(edge.sourceHandle);
        const idx = parseSequenceHandleIndex(handleId);
        const targetNodeId = pickNonEmptyString(edge.target);
        if (idx == null || !targetNodeId) continue;
        branches.push({
          handleId,
          index: idx,
          label: labelByHandle.get(handleId) || `Then ${idx}`,
          targetNodeId,
        });
      }

      if (branches.length === 0) continue;
      branches.sort((a, b) => a.index - b.index || a.handleId.localeCompare(b.handleId));
      out.set(node.id, branches);
    }

    return out;
  }, [edges, nodes]);

  // Find the entry node (node with no incoming execution edges, typically event nodes)
  const entryNode = useMemo(() => {
    // Look for event nodes first
    const eventNode = nodes.find((n) => isEntryNodeType(n.data.nodeType));
    if (eventNode) return eventNode;

    // Fallback to first node
    return nodes[0];
  }, [nodes]);

  // Get output pins from entry node (these become the input form)
  const inputPins = useMemo(() => {
    if (!entryNode) return [];
    return entryNode.data.outputs.filter(p => p.type !== 'execution');
  }, [entryNode]);

  const formInputPins = useMemo(() => {
    return inputPins.filter((p) => p.id !== 'workspace_root');
  }, [inputPins]);

  // Form state for each input pin
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [toolsValues, setToolsValues] = useState<Record<string, string[]>>({});
  const [workspaceRandom, setWorkspaceRandom] = useState(true);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [manualWorkspaceRoot, setManualWorkspaceRoot] = useState('');
  type WorkspaceAccessMode = 'workspace_only' | 'workspace_or_allowed' | 'all_except_ignored';
  const [workspaceAccessMode, setWorkspaceAccessMode] = useState<WorkspaceAccessMode>('workspace_only');
  const [workspaceIgnoredPathsText, setWorkspaceIgnoredPathsText] = useState('');
  const [showIgnoredPaths, setShowIgnoredPaths] = useState(false);
  const [sessionIdOverride, setSessionIdOverride] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const lastAutoTerminalStepIdRef = useRef<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(false);
  // Nested subflow observability: folded by default; per-step expansion keyed by the
  // parent step id (stable across this modal's event stream).
  const [expandedSubflows, setExpandedSubflows] = useState<Record<string, boolean>>({});
  const [resumeDraft, setResumeDraft] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [rehydrateArtifactMarkdown, setRehydrateArtifactMarkdown] = useState<string | null>(null);
  const [rehydrateArtifactError, setRehydrateArtifactError] = useState<string | null>(null);
  const [rehydrateArtifactLoading, setRehydrateArtifactLoading] = useState(false);
  const [startInputData, setStartInputData] = useState<Record<string, unknown> | null>(null);
  const [startInputDefaults, setStartInputDefaults] = useState<Record<string, unknown> | null>(null);
  const [followUpContext, setFollowUpContext] = useState<FollowUpContext | null>(null);
  const [lastRunSeed, setLastRunSeed] = useState<FollowUpContext | null>(null);
  // Follow-up modal state.
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [followUpAttachments, setFollowUpAttachments] = useState<File[]>([]);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpSubmitting, setFollowUpSubmitting] = useState(false);
  const [followUpDragActive, setFollowUpDragActive] = useState(false);
  const [promptCacheBusy, setPromptCacheBusy] = useState(false);
  const [promptCacheResult, setPromptCacheResult] = useState<Record<string, unknown> | null>(null);
  const [promptCacheError, setPromptCacheError] = useState<string | null>(null);
  const [promptCacheRuntimeHint, setPromptCacheRuntimeHint] = useState<Record<string, unknown> | null>(null);
  const [durableBlocBusy, setDurableBlocBusy] = useState(false);
  const [durableBlocResult, setDurableBlocResult] = useState<Record<string, unknown> | null>(null);
  const [durableBlocError, setDurableBlocError] = useState<string | null>(null);
  const [durableBlocId, setDurableBlocId] = useState('');
  const [durableBlocSha256, setDurableBlocSha256] = useState('');
  const [durableBlocArtifactPath, setDurableBlocArtifactPath] = useState('');
  const [durableBlocCacheKey, setDurableBlocCacheKey] = useState('');
  const [durablePromptCacheBindingInput, setDurablePromptCacheBindingInput] = useState('');

  const sessionPinId = useMemo(() => {
    const pin = formInputPins.find((p) => p.id === 'session_id' || p.id === 'sessionId');
    return pin?.id || null;
  }, [formInputPins]);


  const derivedSessionId = useMemo(() => {
    const fromInput =
      typeof startInputData?.sessionId === 'string' && startInputData.sessionId.trim()
        ? startInputData.sessionId.trim()
        : typeof startInputData?.session_id === 'string' && startInputData.session_id.trim()
          ? startInputData.session_id.trim()
          : '';
    if (fromInput) return fromInput;
    return typeof stableSessionId === 'string' && stableSessionId.trim() ? stableSessionId.trim() : '';
  }, [stableSessionId, startInputData]);

  const textProviderPinId = useMemo(() => {
    const pin = formInputPins.find(isTextProviderInputPin);
    return pin?.id || null;
  }, [formInputPins]);

  const selectedProvider = useMemo(() => {
    return textProviderPinId ? (formValues[textProviderPinId] || '') : '';
  }, [formValues, textProviderPinId]);

  const imageProviderPinId = useMemo(() => {
    const pin = formInputPins.find(isImageProviderInputPin);
    return pin?.id || null;
  }, [formInputPins]);

  const selectedImageProvider = useMemo(() => {
    return imageProviderPinId ? (formValues[imageProviderPinId] || '') : '';
  }, [formValues, imageProviderPinId]);

  const voiceProviderPinId = useMemo(() => {
    const pin = formInputPins.find(isVoiceProviderInputPin);
    return pin?.id || null;
  }, [formInputPins]);

  const selectedVoiceProvider = useMemo(() => {
    return voiceProviderPinId ? (formValues[voiceProviderPinId] || '') : '';
  }, [formValues, voiceProviderPinId]);

  const voiceModelMode = voiceProviderPinId && voiceProviderPinId.toLowerCase().includes('stt') ? 'stt' : 'tts';

  const musicProviderPinId = useMemo(() => {
    const pin = formInputPins.find(isMusicProviderInputPin);
    return pin?.id || null;
  }, [formInputPins]);

  const selectedMusicProvider = useMemo(() => {
    return musicProviderPinId ? (formValues[musicProviderPinId] || '') : '';
  }, [formValues, musicProviderPinId]);

  const modelPinId = useMemo(() => {
    const pin = formInputPins.find((p) => isModelInputPin(p) && modelScopeForPin(p, formInputPins) === 'text');
    return pin?.id || null;
  }, [formInputPins]);

  const selectedModel = useMemo(() => {
    return modelPinId ? (formValues[modelPinId] || '') : '';
  }, [formValues, modelPinId]);

  const promptCacheGraphTarget = useMemo(
    () => inferPromptCacheGraphTarget(nodes as unknown as FlowGraphNode[], edges as unknown as FlowGraphEdge[]),
    [edges, nodes]
  );

  const promptCacheSessionLifecycle = gatewayContracts?.common?.prompt_cache?.session_lifecycle === true;
  const promptCacheSessionEndpoints = gatewayContracts?.common?.prompt_cache?.session_endpoints || {};
  const durableBlocPromptCacheContract = gatewayContracts?.common?.prompt_cache?.durable_blocs;
  const durableBlocEndpoints = durableBlocPromptCacheContract?.endpoints || {};
  const durableBlocRouteAvailable = durableBlocPromptCacheContract?.route_available !== false;
  const durableBlocAvailable = Boolean(
    durableBlocPromptCacheContract &&
      durableBlocRouteAvailable &&
      durableBlocPromptCacheContract.available !== false &&
      durableBlocEndpoints.record &&
      durableBlocEndpoints.kv_manifest &&
      durableBlocEndpoints.kv_list &&
      durableBlocEndpoints.kv_ensure &&
      durableBlocEndpoints.kv_load
  );
  const durableBlocStatus = (() => {
    if (!durableBlocPromptCacheContract) return 'not advertised';
    if (!durableBlocRouteAvailable) return 'route unavailable';
    if (durableBlocPromptCacheContract.available === false) return 'unavailable';
    if (durableBlocResult) return String(durableBlocResult.operation || 'loaded');
    return 'exact reuse';
  })();
  const durableBlocSelectionNote = (() => {
    if (!durableBlocPromptCacheContract) return 'Gateway discovery did not advertise durable bloc prompt-cache support.';
    if (!durableBlocRouteAvailable) return 'Durable bloc routes are not available on this Gateway.';
    if (durableBlocPromptCacheContract.available === false) {
      return durableBlocPromptCacheContract.config_hint || 'This Gateway runtime is not wired to durable bloc controls.';
    }
    if (!durableBlocId.trim() && !durableBlocSha256.trim()) {
      return 'Enter a bloc_id or sha256 to inspect or load an exact-reuse binding.';
    }
    return '';
  })();
  const runInputDataDescriptor = gatewayContracts?.common?.runs?.input_data || gatewayContracts?.flow_editor?.runs?.input_data;
  const strictGatewayContract = Boolean(
    gatewayContracts && typeof gatewayContracts.version === 'number' && gatewayContracts.version >= 1
  );
  const artifactMetadataDescriptor =
    gatewayContracts?.common?.artifacts?.metadata || gatewayContracts?.flow_editor?.artifacts?.metadata;
  const artifactContentDescriptor =
    gatewayContracts?.common?.artifacts?.content || gatewayContracts?.flow_editor?.artifacts?.content;
  const kgMemoryDescriptor = gatewayContracts?.common?.memory;
  const kgMemoryAvailable = descriptorEndpointAvailable(kgMemoryDescriptor);
  const promptCacheProvider = (
    selectedProvider.trim() ||
    (promptCacheGraphTarget && !promptCacheGraphTarget.multiple ? promptCacheGraphTarget.provider : '')
  ).toLowerCase();
  const promptCacheModel =
    selectedModel.trim() ||
    (promptCacheGraphTarget && !promptCacheGraphTarget.multiple ? promptCacheGraphTarget.model : '');
  const promptCacheGraphAmbiguous = Boolean(promptCacheGraphTarget?.multiple);
  const promptCacheSessionIdRaw = sessionPinId ? formValues[sessionPinId] : sessionIdOverride;
  const promptCacheSessionId = String(promptCacheSessionIdRaw || '').trim() || derivedSessionId;
  const promptCacheEnabled = Boolean(promptCacheSessionLifecycle && promptCacheProvider && promptCacheModel && promptCacheSessionId);
  const promptCacheResultUnavailable = Boolean(
    promptCacheResult && (promptCacheResult.ok === false || promptCacheResult.supported === false)
  );
  const promptCacheHeaderStatus = (() => {
    if (promptCacheResultUnavailable) return String(promptCacheResult?.mode || promptCacheResult?.code || 'unavailable');
    if (promptCacheRuntimeHint) return 'ready';
    if (promptCacheResult) return String(promptCacheResult.mode || promptCacheResult.code || 'checked');
    if (promptCacheGraphTarget && !promptCacheGraphTarget.multiple) return 'configured';
    return 'session';
  })();
  const promptCacheSelectionNote =
    !promptCacheProvider || !promptCacheModel
      ? promptCacheGraphAmbiguous
        ? 'Multiple LLM provider/model pairs are configured; select provider and model to manage a session cache.'
        : 'Select provider and model to manage a session cache.'
      : !promptCacheSessionId
        ? 'Set a session id to manage a session cache.'
        : '';
  const promptCacheResultMessage =
    promptCacheResult && typeof promptCacheResult.error === 'string' && promptCacheResult.error.trim()
      ? promptCacheResult.error.trim()
      : promptCacheResult && typeof promptCacheResult.hint === 'string' && promptCacheResult.hint.trim()
        ? promptCacheResult.hint.trim()
        : '';
  const durableBlocSummary = useMemo(() => summarizeDurableBlocResult(durableBlocResult), [durableBlocResult]);
  const durableBlocLoadedBinding = useMemo(() => extractPromptCacheBinding(durableBlocResult), [durableBlocResult]);
  const durablePromptCacheBindingParsed = useMemo(
    () => parsePromptCacheBindingText(durablePromptCacheBindingInput),
    [durablePromptCacheBindingInput]
  );

  const wantProviderDropdown = Boolean(isOpen && formInputPins.some(isTextProviderInputPin));
  const wantModelDropdown = Boolean(
    isOpen && formInputPins.some((p) => isModelInputPin(p) && modelScopeForPin(p, formInputPins) === 'text')
  );
  const providersQuery = useProviders(wantProviderDropdown);
  const modelsQuery = useModels(selectedProvider || undefined, wantModelDropdown);
  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];

  const discovery = gatewayContracts?.common?.discovery || {};
  const generatedMusicContract =
    gatewayContracts?.flow_editor?.media?.generated_music || gatewayContracts?.assistant?.media?.generated_music;
  const visionProviderModelsEndpoint = discovery.vision_provider_models || '';
  const voiceCatalogEndpoint = discovery.voice_voices || '';
  const ttsModelsEndpoint = discovery.audio_speech_models || '';
  const sttModelsEndpoint = discovery.audio_transcription_models || '';
  const musicProvidersEndpoint =
    discovery.audio_music_providers ||
    (typeof generatedMusicContract?.direct_endpoint?.providers_endpoint === 'string' ? generatedMusicContract.direct_endpoint.providers_endpoint : '');
  const musicModelsEndpoint =
    discovery.audio_music_models ||
    (typeof generatedMusicContract?.direct_endpoint?.provider_models_endpoint === 'string' ? generatedMusicContract.direct_endpoint.provider_models_endpoint : '');
  const musicProviderModelsTask =
    typeof generatedMusicContract?.direct_endpoint?.provider_models_task === 'string' && generatedMusicContract.direct_endpoint.provider_models_task.trim()
      ? generatedMusicContract.direct_endpoint.provider_models_task.trim()
      : 'text_to_music';

  const wantsImageProviderDropdown = Boolean(isOpen && formInputPins.some(isImageProviderInputPin));
  const wantsImageModelDropdown = Boolean(
    isOpen && formInputPins.some((p) => isModelInputPin(p) && modelScopeForPin(p, formInputPins) === 'image')
  );
  const imageProvidersQuery = useQuery({
    queryKey: ['run-input', 'image-providers', visionProviderModelsEndpoint],
    enabled: wantsImageProviderDropdown && Boolean(visionProviderModelsEndpoint),
    staleTime: 30_000,
    queryFn: async () => {
      const data = await gatewayJson<Record<string, unknown>>(
        gatewayPath(visionProviderModelsEndpoint, {}, { task: 'text_to_image', providers_only: true }),
        { timeoutMs: 5_000 }
      );
      return providerOptionsFromCatalog(data, ['providers', 'image_providers']);
    },
  });
  const imageModelsQuery = useQuery({
    queryKey: ['run-input', 'image-models', visionProviderModelsEndpoint, selectedImageProvider],
    enabled: wantsImageModelDropdown && Boolean(visionProviderModelsEndpoint) && Boolean(selectedImageProvider.trim()),
    staleTime: 30_000,
    queryFn: async () => {
      const data = await gatewayJson<Record<string, unknown>>(
        gatewayPath(visionProviderModelsEndpoint, {}, { task: 'text_to_image', provider: selectedImageProvider }),
        { timeoutMs: 30_000 }
      );
      return modelOptionsFromCatalog(data, selectedImageProvider, ['models', 'items', 'available_models', 'local_models']);
    },
  });
  const imageProviderOptions = Array.isArray(imageProvidersQuery.data) ? imageProvidersQuery.data : [];
  const imageModelOptions = Array.isArray(imageModelsQuery.data) ? imageModelsQuery.data : [];

  const wantsVoiceProviderDropdown = Boolean(isOpen && formInputPins.some(isVoiceProviderInputPin));
  const wantsVoiceModelDropdown = Boolean(
    isOpen && formInputPins.some((p) => isModelInputPin(p) && modelScopeForPin(p, formInputPins) === 'voice')
  );
  const voiceProvidersQuery = useQuery({
    queryKey: ['run-input', 'voice-providers', voiceCatalogEndpoint, ttsModelsEndpoint, sttModelsEndpoint, voiceModelMode],
    enabled: wantsVoiceProviderDropdown && Boolean(voiceCatalogEndpoint || ttsModelsEndpoint || sttModelsEndpoint),
    staleTime: 30_000,
    queryFn: async () => {
      const providerKeys =
        voiceModelMode === 'stt' ? ['stt_providers', 'providers'] : ['tts_providers', 'providers'];
      const modelEndpoint = voiceModelMode === 'stt' ? sttModelsEndpoint : ttsModelsEndpoint;
      const [voiceData, modelData] = await Promise.all([
        voiceCatalogEndpoint
          ? gatewayJson<Record<string, unknown>>(
              gatewayPath(voiceCatalogEndpoint, {}, { providers_only: true }),
              { timeoutMs: 5_000 }
            ).catch(() => ({}))
          : Promise.resolve({}),
        modelEndpoint
          ? gatewayJson<Record<string, unknown>>(gatewayPath(modelEndpoint, {}, {}), { timeoutMs: 5_000 }).catch(() => ({}))
          : Promise.resolve({}),
      ]);
      return dedupeOptions([
        ...providerOptionsFromCatalog(voiceData, providerKeys),
        ...providerOptionsFromCatalog(modelData, ['providers']),
      ]);
    },
  });
  const voiceModelsQuery = useQuery({
    queryKey: ['run-input', 'voice-models', voiceModelMode, selectedVoiceProvider, voiceCatalogEndpoint, ttsModelsEndpoint, sttModelsEndpoint],
    enabled:
      wantsVoiceModelDropdown &&
      Boolean(selectedVoiceProvider.trim()) &&
      Boolean(voiceModelMode === 'stt' ? sttModelsEndpoint : ttsModelsEndpoint || voiceCatalogEndpoint),
    staleTime: 30_000,
    queryFn: async () => {
      const modelEndpoint = voiceModelMode === 'stt' ? sttModelsEndpoint : ttsModelsEndpoint;
      const [modelData, voiceData] = await Promise.all([
        modelEndpoint
          ? gatewayJson<Record<string, unknown>>(
              gatewayPath(modelEndpoint, {}, { provider: selectedVoiceProvider }),
              { timeoutMs: 30_000 }
            ).catch(() => ({}))
          : Promise.resolve({}),
        voiceModelMode === 'tts' && voiceCatalogEndpoint
          ? gatewayJson<Record<string, unknown>>(
              gatewayPath(voiceCatalogEndpoint, {}, { provider: selectedVoiceProvider }),
              { timeoutMs: 30_000 }
            ).catch(() => ({}))
          : Promise.resolve({}),
      ]);
      return dedupeOptions([
        ...modelOptionsFromCatalog(modelData, selectedVoiceProvider, ['models', 'items', 'data', 'tts_models', 'stt_models']),
        ...modelOptionsFromCatalog(voiceData, selectedVoiceProvider, ['models', 'tts_models']),
      ]);
    },
  });
  const voiceProviderOptions = Array.isArray(voiceProvidersQuery.data) ? voiceProvidersQuery.data : [];
  const voiceModelOptions = Array.isArray(voiceModelsQuery.data) ? voiceModelsQuery.data : [];

  const wantsMusicProviderDropdown = Boolean(isOpen && formInputPins.some(isMusicProviderInputPin));
  const wantsMusicModelDropdown = Boolean(
    isOpen && formInputPins.some((p) => isModelInputPin(p) && modelScopeForPin(p, formInputPins) === 'music')
  );
  const musicProvidersQuery = useQuery({
    queryKey: ['run-input', 'music-providers', musicProvidersEndpoint, musicProviderModelsTask],
    enabled: wantsMusicProviderDropdown && Boolean(musicProvidersEndpoint),
    staleTime: 30_000,
    queryFn: async () => {
      const data = await gatewayJson<Record<string, unknown>>(
        gatewayPath(musicProvidersEndpoint, {}, { task: musicProviderModelsTask }),
        { timeoutMs: 5_000 }
      );
      return providerOptionsFromCatalog(data, ['music_providers', 'providers', 'available_providers', 'provider_details']);
    },
  });
  const musicModelsQuery = useQuery({
    queryKey: ['run-input', 'music-models', musicModelsEndpoint, selectedMusicProvider, musicProviderModelsTask],
    enabled: wantsMusicModelDropdown && Boolean(musicModelsEndpoint) && Boolean(selectedMusicProvider.trim()),
    staleTime: 30_000,
    queryFn: async () => {
      const data = await gatewayJson<Record<string, unknown>>(
        gatewayPath(musicModelsEndpoint, {}, { task: musicProviderModelsTask, provider: selectedMusicProvider }),
        { timeoutMs: 30_000 }
      );
      return modelOptionsFromCatalog(data, selectedMusicProvider, ['models', 'items', 'data', 'provider_models', 'music_models']);
    },
  });
  const musicProviderOptions = Array.isArray(musicProvidersQuery.data) ? musicProvidersQuery.data : [];
  const musicModelOptions = Array.isArray(musicModelsQuery.data) ? musicModelsQuery.data : [];

  const wantToolsDropdown = Boolean(isOpen && formInputPins.some((p) => p.type === 'tools'));
  const toolsQuery = useTools(wantToolsDropdown);
  const toolSpecs = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];
  const toolOptions = useMemo(() => {
    const out = toolSpecs
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({ value: t.name.trim(), label: t.name.trim() }));
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [toolSpecs]);

  const executionWorkspaceQuery = useExecutionWorkspace(isOpen);
  const workspacePolicy = useMemo(() => {
    const policy = executionWorkspaceQuery.data?.policy;
    return policy && typeof policy === 'object' ? (policy as Record<string, unknown>) : null;
  }, [executionWorkspaceQuery.data]);
  const workspacePolicyTarget =
    typeof workspacePolicy?.target === 'string' && workspacePolicy?.target.trim()
      ? workspacePolicy.target.trim()
      : 'server';
  const workspaceOverridesAllowed = workspacePolicy?.client_workspace_scope_overrides === true;
  const workspacePolicyLoading = executionWorkspaceQuery.isLoading;
  const workspaceInputEnabled = workspacePolicyLoading
    ? true
    : workspacePolicyTarget !== 'server' || workspaceOverridesAllowed;
  const workspaceRootRequired = workspacePolicyLoading ? false : workspacePolicyTarget !== 'server';
  const ignoredPathsCount = useMemo(() => {
    return String(workspaceIgnoredPathsText || '')
      .split('\n')
      .filter((line) => line.trim()).length;
  }, [workspaceIgnoredPathsText]);
  const allowedAccessModes = useMemo(() => {
    const raw = workspacePolicy?.allowed_access_modes;
    let modes: string[] | null = null;
    if (Array.isArray(raw)) {
      const cleaned = raw.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
      if (cleaned.length > 0) {
        modes = cleaned;
      } else {
        console.warn('#FALLBACK: workspace policy allowed_access_modes is empty; using defaults');
      }
    } else if (raw !== undefined) {
      console.warn('#FALLBACK: workspace policy allowed_access_modes is invalid; using defaults');
    }
    if (!modes) {
      modes = workspaceOverridesAllowed
        ? ['workspace_only', 'workspace_or_allowed', 'all_except_ignored']
        : ['workspace_only', 'workspace_or_allowed'];
    }
    return modes;
  }, [workspaceOverridesAllowed, workspacePolicy]);
  const workspaceAccessModeOptions = useMemo(() => {
    const labels: Record<string, string> = {
      workspace_only: 'workspace_only (restrict to workspace_root)',
      workspace_or_allowed: 'workspace_or_allowed (allow server-approved mounts)',
      all_except_ignored: 'all_except_ignored (allow absolute paths outside workspace_root)',
    };
    return allowedAccessModes.map((mode) => ({
      value: mode,
      label: labels[mode] || mode,
    }));
  }, [allowedAccessModes]);

  useEffect(() => {
    if (allowedAccessModes.includes(workspaceAccessMode)) return;
    const next = (allowedAccessModes[0] || 'workspace_only') as WorkspaceAccessMode;
    console.warn(`#FALLBACK: workspace_access_mode not allowed; resetting to '${next}'`);
    setWorkspaceAccessMode(next);
  }, [allowedAccessModes, workspaceAccessMode]);

  useEffect(() => {
    if (workspaceInputEnabled) return;
    // Even when client overrides are disabled, the gateway uses a per-run workspace by default.
    // Keep the UI in "Random" mode so it matches the actual behavior (and avoids confusion).
    if (!workspaceRandom) setWorkspaceRandom(true);
    if (workspaceRoot.trim()) {
      console.warn('#FALLBACK: workspace_root ignored because gateway policy disallows client overrides');
      setWorkspaceRoot('');
    }
  }, [workspaceInputEnabled, workspaceRandom, workspaceRoot]);

  // When the modal is opened, start expanded (predictable UX).
  useEffect(() => {
    if (isOpen) setIsMinimized(false);
  }, [isOpen]);

  useEffect(() => {
    setPromptCacheResult(null);
    setPromptCacheError(null);
    setPromptCacheRuntimeHint(null);
  }, [flowId, promptCacheModel, promptCacheProvider, promptCacheSessionId]);

  useEffect(() => {
    setDurableBlocResult(null);
    setDurableBlocError(null);
  }, [durableBlocId, durableBlocSha256, promptCacheModel, promptCacheProvider]);

  // When "Random" is enabled, the gateway will generate a workspace on run start.

  // Initialize form values when modal opens
  useEffect(() => {
    if (isOpen && formInputPins.length > 0) {
      const initialValues: Record<string, string> = {};
      const initialTools: Record<string, string[]> = {};
      const defaults =
        entryNode && entryNode.data && typeof (entryNode.data as any).pinDefaults === 'object'
          ? ((entryNode.data as any).pinDefaults as Record<string, unknown>)
          : null;
      formInputPins.forEach(pin => {
        if (pin.type === 'tools') {
          const raw = defaults && pin.id in defaults ? defaults[pin.id] : undefined;
          if (Array.isArray(raw)) {
            initialTools[pin.id] = raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
          } else if (typeof raw === 'string' && raw.trim()) {
            // Convenience: allow comma-separated lists.
            initialTools[pin.id] = raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
          } else {
            initialTools[pin.id] = [];
          }
          // Tools are driven by toolsValues, not formValues.
          return;
        }
        const raw = defaults && pin.id in defaults ? defaults[pin.id] : undefined;
        if (raw === undefined) {
          initialValues[pin.id] = '';
          return;
        }
        if (typeof raw === 'boolean') {
          initialValues[pin.id] = raw ? 'true' : 'false';
          return;
        }
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          initialValues[pin.id] = String(raw);
          return;
        }
        // Strings (provider/model/workspace_root/etc.)
        if (typeof raw === 'string') {
          initialValues[pin.id] = raw;
          return;
        }
        // Objects/arrays/assertions/memory (render as JSON in textarea pins).
        if (
          pin.type === 'object' ||
          pin.type === 'memory' ||
          pin.type === 'array' ||
          pin.type === 'assertion' ||
          pin.type === 'assertions'
        ) {
          try {
            initialValues[pin.id] = JSON.stringify(raw, null, 2);
            return;
          } catch {
            initialValues[pin.id] = '';
            return;
          }
        }
        // Fallback: preserve existing behavior (empty).
        initialValues[pin.id] = '';
      });
      setFormValues(initialValues);
      setToolsValues(initialTools);
    }
  }, [isOpen, formInputPins, entryNode]);

  useEffect(() => {
    if (!isOpen || !derivedSessionId) return;
    if (sessionPinId) {
      const current = formValues[sessionPinId];
      if (!current || !String(current).trim()) {
        setFormValues((prev) => ({ ...prev, [sessionPinId]: derivedSessionId }));
      }
      return;
    }
    if (!sessionIdOverride.trim()) {
      setSessionIdOverride(derivedSessionId);
    }
  }, [derivedSessionId, formValues, isOpen, sessionIdOverride, sessionPinId]);

  // Clear resume draft when leaving waiting state
  useEffect(() => {
    if (!isWaiting) setResumeDraft('');
  }, [isWaiting]);

  // Update a form field
  const handleFieldChange = useCallback((pinId: string, value: string) => {
    setFormValues(prev => ({ ...prev, [pinId]: value }));
  }, []);

  const handleWorkspaceRootChange = useCallback(
    (next: string) => {
      setWorkspaceRoot(next);
      if (!workspaceRandom) setManualWorkspaceRoot(next);
    },
    [workspaceRandom]
  );

  const handleWorkspaceRandomChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setWorkspaceRandom(true);
        // Default behavior: server allocates a per-run workspace when workspace_root is unset.
        setWorkspaceRoot('');
        return;
      }
      setWorkspaceRandom(false);
      if (manualWorkspaceRoot.trim()) setWorkspaceRoot(manualWorkspaceRoot);
    },
    [manualWorkspaceRoot]
  );

  const buildPromptCachePayload = useCallback(() => {
    return {
      provider: promptCacheProvider,
      model: promptCacheModel,
      flow_id: flowId || undefined,
      template_id: flowName || flowId || undefined,
      make_default: false,
      version: 1,
    };
  }, [flowId, flowName, promptCacheModel, promptCacheProvider]);

  const runPromptCacheOperation = useCallback(
    async (operation: 'status' | 'prepare' | 'clear' | 'rebuild') => {
      if (!promptCacheEnabled) return;
      const sessionId = promptCacheSessionId.trim();
      const endpoint =
        operation === 'status'
          ? promptCacheSessionEndpoints.status || '/api/gateway/sessions/{session_id}/prompt_cache/status'
          : operation === 'prepare'
            ? promptCacheSessionEndpoints.prepare || '/api/gateway/sessions/{session_id}/prompt_cache/prepare'
            : operation === 'clear'
              ? promptCacheSessionEndpoints.clear || '/api/gateway/sessions/{session_id}/prompt_cache/clear'
              : promptCacheSessionEndpoints.rebuild || '/api/gateway/sessions/{session_id}/prompt_cache/rebuild';
      const payload = buildPromptCachePayload();
      setPromptCacheBusy(true);
      setPromptCacheError(null);
      try {
        const data =
          operation === 'status'
            ? await gatewayJson<Record<string, unknown>>(
                gatewayPath(endpoint, { session_id: sessionId }, {
                  provider: payload.provider,
                  model: payload.model,
                  flow_id: payload.flow_id,
                  template_id: payload.template_id,
                  version: payload.version,
                })
              )
            : await gatewayJson<Record<string, unknown>>(
                gatewayPath(endpoint, { session_id: sessionId }),
                jsonRequest(payload, { method: 'POST' })
              );
        setPromptCacheResult(data);
        const hint = data.runtime_hint && typeof data.runtime_hint === 'object' && !Array.isArray(data.runtime_hint)
          ? (data.runtime_hint as Record<string, unknown>)
          : null;
        if (operation === 'clear') {
          setPromptCacheRuntimeHint(null);
        } else if (hint) {
          setPromptCacheRuntimeHint(hint);
        }
      } catch (e) {
        setPromptCacheError(e instanceof Error ? e.message : 'Prompt cache request failed');
      } finally {
        setPromptCacheBusy(false);
      }
    },
    [buildPromptCachePayload, promptCacheEnabled, promptCacheSessionEndpoints, promptCacheSessionId]
  );

  const buildDurableBlocPayload = useCallback(() => {
    const payload: Record<string, unknown> = {};
    const rawBlocId = durableBlocId.trim();
    if (rawBlocId) {
      const parsed = Number.parseInt(rawBlocId, 10);
      payload.bloc_id = Number.isFinite(parsed) ? parsed : rawBlocId;
    }
    if (durableBlocSha256.trim()) payload.sha256 = durableBlocSha256.trim();
    if (promptCacheProvider) payload.provider = promptCacheProvider;
    if (promptCacheModel) payload.model = promptCacheModel;
    if (durableBlocArtifactPath.trim()) payload.artifact_path = durableBlocArtifactPath.trim();
    if (durableBlocCacheKey.trim()) payload.key = durableBlocCacheKey.trim();
    return payload;
  }, [durableBlocArtifactPath, durableBlocCacheKey, durableBlocId, durableBlocSha256, promptCacheModel, promptCacheProvider]);

  const runDurableBlocOperation = useCallback(
    async (operation: DurableBlocOperation) => {
      if (!durableBlocAvailable && operation !== 'list') return;
      const payload = buildDurableBlocPayload();
      if (!payload.bloc_id && !payload.sha256) {
        setDurableBlocError('Enter a bloc_id or sha256 first.');
        return;
      }

      setDurableBlocBusy(true);
      setDurableBlocError(null);
      try {
        const query = {
          bloc_id: payload.bloc_id as string | number | undefined,
          sha256: payload.sha256 as string | undefined,
          provider: payload.provider as string | undefined,
          model: payload.model as string | undefined,
          artifact_path: payload.artifact_path as string | undefined,
        };
        const data =
          operation === 'record' || operation === 'list' || operation === 'kv_manifest' || operation === 'kv_list'
            ? await gatewayJson<Record<string, unknown>>(
                gatewayPath(
                  durableBlocEndpoint(
                    durableBlocPromptCacheContract,
                    operation,
                    operation === 'record'
                      ? '/api/gateway/blocs/record'
                      : operation === 'list'
                        ? '/api/gateway/blocs'
                        : operation === 'kv_manifest'
                          ? '/api/gateway/blocs/kv/manifest'
                          : '/api/gateway/blocs/kv/list'
                  ),
                  {},
                  query
                )
              )
            : await gatewayJson<Record<string, unknown>>(
                gatewayPath(
                  durableBlocEndpoint(
                    durableBlocPromptCacheContract,
                    operation,
                    operation === 'kv_ensure' ? '/api/gateway/blocs/kv/ensure' : '/api/gateway/blocs/kv/load'
                  )
                ),
                jsonRequest(
                  operation === 'kv_load'
                    ? { ...payload, make_default: false, force_rebuild: false }
                    : { ...payload, force_rebuild: false },
                  { method: 'POST' }
                )
              );
        setDurableBlocResult(data);
        const binding = extractPromptCacheBinding(data);
        if (binding) {
          setDurablePromptCacheBindingInput(typeof binding === 'string' ? binding : stringifyJson(binding));
        }
      } catch (e) {
        setDurableBlocError(e instanceof Error ? e.message : 'Durable prompt-cache request failed');
      } finally {
        setDurableBlocBusy(false);
      }
    },
    [buildDurableBlocPayload, durableBlocAvailable, durableBlocPromptCacheContract]
  );

  // Submit the form
  const handleSubmit = useCallback(() => {
    // Build input data from form values
    const inputData: Record<string, unknown> = {};

    formInputPins.forEach(pin => {
      if (pin.type === 'tools') {
        inputData[pin.id] = Array.isArray(toolsValues[pin.id]) ? toolsValues[pin.id] : [];
        return;
      }
      const value = formValues[pin.id] || '';

      // Parse based on type
      switch (pin.type) {
        case 'number':
          inputData[pin.id] = parseFloat(value) || 0;
          break;
        case 'boolean':
          inputData[pin.id] = value === 'true' || value === '1';
          break;
        case 'object':
        case 'memory':
        case 'array':
        case 'assertion':
        case 'assertions':
          try {
            const defaultJson =
              pin.type === 'array' || pin.type === 'assertions'
                ? '[]'
                : '{}';
            inputData[pin.id] = JSON.parse(value || defaultJson);
          } catch {
            inputData[pin.id] = pin.type === 'array' || pin.type === 'assertions' ? [] : {};
          }
          break;
        default:
          inputData[pin.id] = value;
      }
    });

    const workspaceValue = String(workspaceRoot || '').trim();
    if (workspaceValue) {
      if (workspaceInputEnabled) {
        inputData.workspace_root = workspaceValue;
      } else {
        console.warn('#FALLBACK: workspace_root ignored because gateway policy disallows client overrides');
      }
    }
    inputData.workspace_access_mode = workspaceAccessMode;
    const ignored = String(workspaceIgnoredPathsText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ignored.length > 0) {
      inputData.workspace_ignored_paths = ignored;
    }

    const sessionValue = sessionPinId ? formValues[sessionPinId] : sessionIdOverride;
    const sessionIdRaw = typeof sessionValue === 'string' ? sessionValue.trim() : '';
    const sessionId = sessionIdRaw || derivedSessionId;
    if (sessionId) {
      inputData.sessionId = sessionId;
    }

    if (promptCacheRuntimeHint) {
      Object.assign(inputData, promptCacheRuntimeHint);
    }

    if (durablePromptCacheBindingInput.trim()) {
      const binding = durablePromptCacheBindingParsed;
      if (binding) {
        inputData.prompt_cache_binding = binding;
      } else {
        console.warn('#FALLBACK: prompt_cache_binding ignored because it is not valid JSON or a binding id string');
      }
    }

    if (followUpContext?.messages?.length) {
      const existingContextRaw = inputData.context;
      const existingContext =
        existingContextRaw && typeof existingContextRaw === 'object' && !Array.isArray(existingContextRaw)
          ? { ...(existingContextRaw as Record<string, unknown>) }
          : {};
      const existingMessages = Array.isArray(existingContext.messages) ? existingContext.messages : [];
      existingContext.messages = [...followUpContext.messages, ...existingMessages];
      inputData.context = existingContext;
    }

    onRun(inputData);
    if (followUpContext) setFollowUpContext(null);
  }, [
    formInputPins,
    formValues,
    onRun,
    toolsValues,
    workspaceAccessMode,
    workspaceIgnoredPathsText,
    workspaceInputEnabled,
    workspaceRoot,
    followUpContext,
    sessionIdOverride,
    sessionPinId,
    derivedSessionId,
    promptCacheRuntimeHint,
    durablePromptCacheBindingInput,
    durablePromptCacheBindingParsed,
  ]);

  type StepStatus = 'running' | 'completed' | 'waiting' | 'failed';
  type Step = {
    id: string;
    status: StepStatus;
    runId?: string;
    runtimeStepId?: string;
    nodeId?: string;
    nodeLabel?: string;
    nodeType?: string;
    nodeIcon?: string;
    nodeColor?: string;
    provider?: string;
    model?: string;
    summary?: string;
    output?: unknown;
    error?: string;
    metrics?: ExecutionMetrics;
    startedAt?: string;
    endedAt?: string;
    waiting?: {
      prompt: string;
      choices: string[];
      allowFreeText: boolean;
      waitKey?: string;
      reason?: string;
      runId?: string;
      details?: Record<string, unknown>;
    };
  };

  const formatStepTime = useCallback((ts?: string) => {
    const raw = typeof ts === 'string' ? ts.trim() : '';
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    // Discreet, local time with seconds.
    // Prefer a compact HH:MM:SS (avoid locale AM/PM width churn).
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }, []);

  const formatDuration = (rawMs: unknown): string => {
    const ms = typeof rawMs === 'number' ? rawMs : rawMs == null ? NaN : Number(rawMs);
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 950) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(0)}s`;
  };

  const formatTokenBadge = (m?: ExecutionMetrics | null): string => {
    if (!m) return '';
    const input = typeof m.input_tokens === 'number' ? m.input_tokens : null;
    const output = typeof m.output_tokens === 'number' ? m.output_tokens : null;
    if (input == null && output == null) return '';
    if (input != null && output != null) return `${input}→${output} tk`;
    if (input != null) return `${input} in`;
    return `${output} out`;
  };

  const formatTpsBadge = (m?: ExecutionMetrics | null): string => {
    if (!m) return '';
    const tps = typeof m.tokens_per_s === 'number' ? m.tokens_per_s : null;
    if (tps == null || !Number.isFinite(tps) || tps <= 0) return '';
    return `${tps.toFixed(tps < 10 ? 2 : 1)} tk/s`;
  };

  type UsageBadge = { label: string; value: number };

  const getUsageBadges = (usage: unknown): UsageBadge[] => {
    if (!usage || typeof usage !== 'object') return [];
    const u = usage as Record<string, unknown>;
    const num = (key: string): number | null => {
      const v = u[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    const inputTokens = num('input_tokens');
    const outputTokens = num('output_tokens');
    const promptTokens = num('prompt_tokens');
    const completionTokens = num('completion_tokens');
    const totalTokens = num('total_tokens');

    const inVal = inputTokens ?? promptTokens;
    const outVal = outputTokens ?? completionTokens;

    const badges: UsageBadge[] = [];
    if (inVal != null) badges.push({ label: 'in', value: inVal });
    if (outVal != null) badges.push({ label: 'out', value: outVal });
    if (totalTokens != null) badges.push({ label: 'total', value: totalTokens });

    // Only show prompt/completion if they differ from the chosen in/out values.
    if (promptTokens != null && inVal != null && promptTokens !== inVal) badges.push({ label: 'prompt', value: promptTokens });
    if (completionTokens != null && outVal != null && completionTokens !== outVal)
      badges.push({ label: 'completion', value: completionTokens });

    const cached = num('cache_read_tokens') ?? num('cached_tokens');
    if (cached != null && cached > 0) badges.push({ label: 'cached', value: cached });

    return badges;
  };

  const getActualRunId = (ev: ExecutionEvent): string => (typeof ev.runId === 'string' ? ev.runId.trim() : '');
  const getThreadRunId = (ev: ExecutionEvent): string =>
    typeof ev.threadRunId === 'string' ? ev.threadRunId.trim() : '';

  const runSteps = useMemo(() => {
    const openByNode = new Map<string, number>();
    const terminalIndexByNode = new Map<string, number>();
    const all: Step[] = [];

    const forcedThreadId = typeof threadRootRunId === 'string' ? threadRootRunId.trim() : '';
    let threadId: string | null = forcedThreadId || null;
    const rootRunIds: string[] = [];
    const seenRootRunIds = new Set<string>();

    for (const ev of events) {
      if (ev.type !== 'flow_start') continue;
      const rid = getActualRunId(ev);
      if (rid && !seenRootRunIds.has(rid)) {
        seenRootRunIds.add(rid);
        rootRunIds.push(rid);
      }
      if (!threadId) {
        const tid = getThreadRunId(ev);
        threadId = tid || rid || null;
      }
    }

    if (!threadId) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const tid = getThreadRunId(ev);
        const rid = getActualRunId(ev);
        if (tid || rid) {
          threadId = tid || rid;
          break;
        }
      }
    }

    const rootRunId = rootRunIds.length ? rootRunIds[rootRunIds.length - 1] : threadId;
    const displayRootRunIds = rootRunIds.length ? rootRunIds : rootRunId ? [rootRunId] : [];

    const safeString = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

    const extractSubRunId = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null;
      const obj = value as Record<string, unknown>;
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

      // Common shapes:
      // - { sub_run_id: "..." }
      // - { result: { sub_run_id: "..." } }
      // - { scratchpad: { sub_run_id: "..." } }
      // - { scratchpad: { sub_run_id: "..." }, result: {...} } (Agent node output)
      const direct =
        pick(obj['sub_run_id']) ?? pick(obj['sub_runId']) ?? pick(obj['subRunId']);
      if (direct) return direct;

      const nestedResult = obj['result'];
      if (nestedResult && typeof nestedResult === 'object') {
        const r = nestedResult as Record<string, unknown>;
        const fromResult = pick(r['sub_run_id']) ?? pick(r['sub_runId']) ?? pick(r['subRunId']);
        if (fromResult) return fromResult;
      }

      const scratchpad = obj['scratchpad'];
      if (scratchpad && typeof scratchpad === 'object') {
        const sp = scratchpad as Record<string, unknown>;
        const fromScratch = pick(sp['sub_run_id']) ?? pick(sp['sub_runId']) ?? pick(sp['subRunId']);
        if (fromScratch) return fromScratch;
      }

      return null;
    };

    const mergeMetricsPreferLonger = (
      prior?: ExecutionMetrics | null,
      next?: ExecutionMetrics | null
    ): ExecutionMetrics | undefined => {
      if (!prior) return next ?? undefined;
      if (!next) return prior ?? undefined;

      const num = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const priorDur = num(prior.duration_ms);
      const nextDur = num(next.duration_ms);
      const preferNext = nextDur != null && (priorDur == null || nextDur > priorDur);
      const primary = preferNext ? next : prior;
      const secondary = preferNext ? prior : next;

      const merged: ExecutionMetrics = {
        duration_ms: num(primary.duration_ms) ?? num(secondary.duration_ms) ?? undefined,
        input_tokens:
          typeof primary.input_tokens === 'number'
            ? primary.input_tokens
            : typeof secondary.input_tokens === 'number'
              ? secondary.input_tokens
              : undefined,
        output_tokens:
          typeof primary.output_tokens === 'number'
            ? primary.output_tokens
            : typeof secondary.output_tokens === 'number'
              ? secondary.output_tokens
              : undefined,
        tokens_per_s:
          typeof primary.tokens_per_s === 'number'
            ? primary.tokens_per_s
            : typeof secondary.tokens_per_s === 'number'
              ? secondary.tokens_per_s
              : undefined,
      };

      // Avoid returning an object with all fields undefined.
      if (
        merged.duration_ms == null &&
        merged.input_tokens == null &&
        merged.output_tokens == null &&
        merged.tokens_per_s == null
      ) {
        return undefined;
      }
      return merged;
    };

	    const extractModelInfo = (value: unknown): { provider?: string; model?: string } => {
	      const { provider, model } = extractPreferredModelInfo(value);

	      // Agent nodes may not expose provider/model directly; try to infer from the last llm_call
	      // step inside the scratchpad trace.
	      const obj = value as Record<string, unknown>;
	      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
	      let providerValue = provider;
	      let modelValue = model;
	      const scratchpad = obj.scratchpad;
	      if ((!providerValue || !modelValue) && scratchpad && typeof scratchpad === 'object') {
	        const sp = scratchpad as Record<string, unknown>;
	        const steps = Array.isArray(sp.steps) ? sp.steps : [];
	        for (let i = steps.length - 1; i >= 0; i--) {
	          const st = steps[i];
          if (!st || typeof st !== 'object') continue;
          const stepObj = st as Record<string, unknown>;
          const effect = stepObj.effect && typeof stepObj.effect === 'object' ? (stepObj.effect as Record<string, unknown>) : null;
          const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
          if (effectType !== 'llm_call') continue;

	          const payload =
	            effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
	          providerValue = providerValue ?? pick(payload?.provider);
	          modelValue = modelValue ?? pick(payload?.model);

	          const result = stepObj.result && typeof stepObj.result === 'object' ? (stepObj.result as Record<string, unknown>) : null;
	          providerValue = providerValue ?? pick(result?.provider);
	          modelValue = modelValue ?? pick(result?.model);

	          if (providerValue || modelValue) break;
	        }
	      }

	      return { provider: providerValue, model: modelValue };
	    };

    const pickSummary = (value: unknown): string => {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value !== 'object') return String(value);

      const obj = value as Record<string, unknown>;
      const direct =
        (typeof obj.content === 'string' && obj.content) ||
        (typeof obj.text === 'string' && obj.text) ||
        (typeof obj.message === 'string' && obj.message) ||
        (typeof obj.response === 'string' && obj.response) ||
        '';
      if (direct) return direct;

      const nested = obj.result;
      if (nested && typeof nested === 'object') {
        const nestedObj = nested as Record<string, unknown>;
        if (typeof nestedObj.content === 'string' && nestedObj.content) return nestedObj.content;
        if (typeof nestedObj.text === 'string' && nestedObj.text) return nestedObj.text;
        if (typeof nestedObj.result === 'string' && nestedObj.result) return nestedObj.result;
        if (typeof nestedObj.message === 'string' && nestedObj.message) return nestedObj.message;
        if (typeof nestedObj.response === 'string' && nestedObj.response) return nestedObj.response;
      }

      const nestedOutput = obj.output;
      if (nestedOutput && typeof nestedOutput === 'object') {
        const outObj = nestedOutput as Record<string, unknown>;
        if (typeof outObj.content === 'string' && outObj.content) return outObj.content;
        if (typeof outObj.text === 'string' && outObj.text) return outObj.text;
        if (typeof outObj.output === 'string' && outObj.output) return outObj.output;
        if (typeof outObj.result === 'string' && outObj.result) return outObj.result;
        if (typeof outObj.message === 'string' && outObj.message) return outObj.message;
        if (typeof outObj.response === 'string' && outObj.response) return outObj.response;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const summarize = (value: unknown): string => {
      const text = safeString(pickSummary(value)).replace(/\s+/g, ' ').trim();
      return text;
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const evRunId = getActualRunId(ev);
      const evStepId = typeof ev.stepId === 'string' && ev.stepId.trim() ? ev.stepId.trim() : undefined;
      // We show only node steps in the left timeline; flow-level status is surfaced in the header / final result.
      if (ev.type === 'flow_start') continue;
      if (ev.type === 'flow_complete') {
        const runKey = evRunId || ev.runId || '';
        let terminalIdx = -1;
        for (let j = all.length - 1; j >= 0; j--) {
          const s = all[j];
          if (s.nodeType !== 'on_flow_end') continue;
          if ((s.runId || '') !== runKey) continue;
          terminalIdx = j;
          break;
        }

        const completedAt = typeof ev.ts === 'string' ? ev.ts : undefined;
        const terminalSummary = summarize(ev.result) || 'Workflow completed';
        if (terminalIdx >= 0) {
          const prior = all[terminalIdx];
          all[terminalIdx] = {
            ...prior,
            status: 'completed',
            waiting: undefined,
            output: prior.output ?? ev.result,
            summary: prior.summary || terminalSummary,
            metrics: mergeMetricsPreferLonger(prior.metrics ?? null, ev.meta ?? null),
            runtimeStepId: prior.runtimeStepId ?? evStepId,
            endedAt: completedAt || prior.endedAt,
          };
        } else {
          const implicitId = '__implicit_flow_end__';
          const meta = resolveNodeMeta(implicitId);
          all.push({
            id: `flow_complete:${runKey || 'root'}:${i}`,
            status: 'completed',
            runId: evRunId || ev.runId,
            runtimeStepId: evStepId,
            nodeId: implicitId,
            nodeLabel: meta?.label,
            nodeType: meta?.type,
            nodeIcon: meta?.icon,
            nodeColor: meta?.color,
            output: ev.result,
            summary: terminalSummary,
            metrics: ev.meta,
            startedAt: completedAt,
            endedAt: completedAt,
          });
        }
        continue;
      }

      if (ev.type === 'node_start') {
        const key = `${evRunId || ''}:${ev.nodeId || ''}`;
        const meta = resolveNodeMeta(ev.nodeId);
        const step: Step = {
          id: `node_start:${ev.nodeId || 'unknown'}:${i}`,
          status: 'running',
          runId: evRunId || ev.runId,
          runtimeStepId: evStepId,
          nodeId: ev.nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          startedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
        };
        all.push(step);
        if (ev.nodeId) openByNode.set(key, all.length - 1);
        continue;
      }

      if (ev.type === 'node_complete') {
        const nodeId = ev.nodeId;
        const key = `${evRunId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;
        const mi = extractModelInfo(ev.result);
        const meta = resolveNodeMeta(nodeId);
        const terminalKey = meta?.type === 'on_flow_end' && nodeId ? `${evRunId || ''}:${nodeId}` : '';
        const existingTerminalIdx = terminalKey ? terminalIndexByNode.get(terminalKey) : undefined;
        if (typeof existingTerminalIdx === 'number' && typeof idx !== 'number') {
          const prior = all[existingTerminalIdx];
          const incomingSummary = summarize(ev.result);
          const preferIncoming =
            Boolean(incomingSummary) && (!prior?.summary || incomingSummary.length > (prior.summary || '').length);
          if (preferIncoming) {
            all[existingTerminalIdx] = {
              ...prior,
              output: ev.result ?? prior.output,
              summary: incomingSummary || prior.summary,
              metrics: mergeMetricsPreferLonger(prior.metrics ?? null, ev.meta ?? null),
              provider: mi.provider ?? prior.provider,
              model: mi.model ?? prior.model,
              runtimeStepId: prior.runtimeStepId ?? evStepId,
              endedAt: typeof ev.ts === 'string' ? ev.ts : prior.endedAt,
            };
          }
          continue;
        }
        if (typeof idx === 'number') {
          all[idx] = {
            ...all[idx],
            status: 'completed',
            waiting: undefined,
            output: ev.result,
            summary: summarize(ev.result),
            metrics: ev.meta,
            provider: mi.provider,
            model: mi.model,
            runtimeStepId: all[idx].runtimeStepId ?? evStepId,
            endedAt: typeof ev.ts === 'string' ? ev.ts : all[idx].endedAt,
          };
          openByNode.delete(key);
          if (terminalKey) terminalIndexByNode.set(terminalKey, idx);
          continue;
        }

        // Dedupe: some runs can emit a duplicate `node_complete` for an Agent node
        // (same node + same sub_run_id) due to start_subworkflow/wait/resume edge cases.
        // Prefer to merge into the most recent completed step rather than rendering two.
        if (meta?.type === 'agent' && nodeId && evRunId) {
          const subRunId = extractSubRunId(ev.result);
          if (subRunId) {
            const rid = evRunId;
            let deduped = false;
            for (let j = all.length - 1; j >= 0; j--) {
              const prior = all[j];
              if (prior.status !== 'completed') continue;
              if (prior.runId !== rid) continue;
              if (prior.nodeId !== nodeId) continue;
              const priorSub = extractSubRunId(prior.output);
              if (!priorSub || priorSub !== subRunId) continue;

              all[j] = {
                ...prior,
                output: ev.result ?? prior.output,
                summary: summarize(ev.result ?? prior.output),
                metrics: mergeMetricsPreferLonger(prior.metrics ?? null, ev.meta ?? null),
                provider: mi.provider ?? prior.provider,
                model: mi.model ?? prior.model,
                endedAt: typeof ev.ts === 'string' ? ev.ts : prior.endedAt,
              };
              // Do not append a duplicate step.
              deduped = true;
              break;
            }
            if (deduped) continue;
          }
        }

        all.push({
          id: `node_complete:${nodeId || 'unknown'}:${i}`,
          status: 'completed',
          runId: evRunId || ev.runId,
          runtimeStepId: evStepId,
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          provider: mi.provider,
          model: mi.model,
          output: ev.result,
          summary: summarize(ev.result),
          metrics: ev.meta,
          startedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
          endedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
        });
        if (terminalKey) terminalIndexByNode.set(terminalKey, all.length - 1);
        continue;
      }

      if (ev.type === 'flow_waiting') {
        const nodeId = ev.nodeId;
        const key = `${evRunId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;

        const reason = typeof ev.reason === 'string' ? ev.reason : undefined;
        const isSubworkflowWait = reason?.toLowerCase() === 'subworkflow';
        const status: StepStatus = isSubworkflowWait ? 'running' : 'waiting';
        // Subworkflow waits do not include user prompts; avoid default prompt text.
        const waiting = {
          prompt: isSubworkflowWait ? '' : ev.prompt || 'Please respond:',
          choices: Array.isArray(ev.choices) ? ev.choices : [],
          allowFreeText: isSubworkflowWait ? false : ev.allow_free_text !== false,
          waitKey: ev.wait_key,
          reason,
          runId: evRunId || ev.runId,
          details: ev.details && typeof ev.details === 'object' ? (ev.details as Record<string, unknown>) : undefined,
        };

        if (typeof idx === 'number') {
          all[idx] = { ...all[idx], status, waiting, runtimeStepId: all[idx].runtimeStepId ?? evStepId };
          continue;
        }

        const meta = resolveNodeMeta(nodeId);
        all.push({
          id: `flow_waiting:${nodeId || 'unknown'}:${i}`,
          status,
          runId: evRunId || ev.runId,
          runtimeStepId: evStepId,
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          waiting,
        });
        if (nodeId) openByNode.set(key, all.length - 1);
        continue;
      }

      if (ev.type === 'flow_error') {
        const nodeId = ev.nodeId;
        const key = `${evRunId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;
        if (typeof idx === 'number') {
          all[idx] = {
            ...all[idx],
            status: 'failed',
            error: ev.error || 'Unknown error',
            runtimeStepId: all[idx].runtimeStepId ?? evStepId,
          };
          openByNode.delete(key);
          continue;
        }
        // Best-effort: attach to the most recent step if we can't map to a node.
        if (all.length > 0) {
          const lastIdx = all.length - 1;
          all[lastIdx] = {
            ...all[lastIdx],
            status: 'failed',
            error: ev.error || 'Unknown error',
            runtimeStepId: all[lastIdx].runtimeStepId ?? evStepId,
          };
        }
      }
    }

    if (
      startInputData &&
      entryNode &&
      entryNode.data?.nodeType === 'on_flow_start' &&
      !all.some((s) => s.nodeId === entryNode.id || s.nodeType === 'on_flow_start')
    ) {
      const meta = resolveNodeMeta(entryNode.id);
      const createdAt =
        typeof runSummary?.created_at === 'string' && (!runSummary.run_id || runSummary.run_id === rootRunId)
          ? runSummary.created_at
          : undefined;
      all.unshift({
        id: `flow_start:${entryNode.id}:synthetic`,
        status: 'completed',
        runId: rootRunId || undefined,
        nodeId: entryNode.id,
        nodeLabel: meta?.label,
        nodeType: meta?.type,
        nodeIcon: meta?.icon,
        nodeColor: meta?.color,
        output: startInputData,
        summary: summarize(startInputData),
        startedAt: createdAt,
        endedAt: createdAt,
      });
    }

    const stepById = new Map<string, Step>();
    const stepsByRunId = new Map<string, Step[]>();
    for (const s of all) {
      stepById.set(s.id, s);
      const rid = typeof s.runId === 'string' ? s.runId.trim() : '';
      if (!rid) continue;
      const bucket = stepsByRunId.get(rid);
      if (bucket) bucket.push(s);
      else stepsByRunId.set(rid, [s]);
    }

    const rootSteps: Step[] = [];
    for (const rid of displayRootRunIds) {
      const bucket = stepsByRunId.get(rid);
      if (bucket && bucket.length > 0) rootSteps.push(...bucket);
    }

    return { threadId, rootRunId, rootRunIds: displayRootRunIds, rootSteps, stepById, stepsByRunId };
  }, [entryNode, events, nodeById, resolveNodeMeta, runSummary?.created_at, runSummary?.run_id, startInputData, threadRootRunId]);
  const threadId = runSteps.threadId;
  const rootRunIds = runSteps.rootRunIds;
  const rootRunId = runSteps.rootRunId;
  const steps = runSteps.rootSteps;
  const stepById = runSteps.stepById;
  const stepsByRunId = runSteps.stepsByRunId;

  const failureSummary = useMemo(() => {
    const out: Array<{ step: Step; snippet: string; shortRunId: string }> = [];
    stepById.forEach((s) => {
      if (s.status !== 'failed') return;
      const err = typeof s.error === 'string' ? s.error.trim() : '';
      const firstLine = err.split('\n').find((l) => l.trim()) || err || 'Unknown error';
      const snippet = firstLine.length > 180 ? `${firstLine.slice(0, 179)}…` : firstLine;
      const shortRunId = typeof s.runId === 'string' ? s.runId.slice(0, 8) : '';
      out.push({ step: s, snippet, shortRunId });
    });
    out.sort((a, b) => {
      const ta = a.step.endedAt || a.step.startedAt || '';
      const tb = b.step.endedAt || b.step.startedAt || '';
      return ta.localeCompare(tb);
    });
    return out;
  }, [stepById]);

  const flowWarnings = useMemo(() => {
    const raw = runSummary?.flow_warnings;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const w of raw) {
      if (typeof w !== 'string') continue;
      const s = w.trim();
      if (!s) continue;
      out.push(s);
    }
    return out;
  }, [runSummary?.flow_warnings]);

  const approvalSessionId = useMemo(() => {
    if (derivedSessionId && derivedSessionId.trim()) return derivedSessionId.trim();
    const fallback = (runSummary as any)?.session_id;
    return typeof fallback === 'string' ? fallback.trim() : '';
  }, [derivedSessionId, runSummary]);

  useEffect(() => {
    if (!isOpen || !rootRunId) {
      setStartInputData(null);
      setStartInputDefaults(null);
      return;
    }
    let cancelled = false;
    const hasInputDataDescriptor = descriptorEndpointAvailable(runInputDataDescriptor);
    const inputDataEndpoint = (() => {
      if (hasInputDataDescriptor) {
        return endpointFromDescriptor(runInputDataDescriptor, '/api/gateway/runs/{run_id}/input_data', { run_id: rootRunId });
      }
      if (strictGatewayContract) {
        console.warn('Gateway contract requires runs.input_data for run rehydration; endpoint is not advertised.');
        return '';
      }
      console.warn(
        '#FALLBACK: runs.input_data descriptor missing in discovery; using legacy canonical route for run detail rehydration compatibility.'
      );
      return gatewayPath('/api/gateway/runs/{run_id}/input_data', { run_id: rootRunId });
    })();
    (async () => {
      if (!inputDataEndpoint) {
        if (!cancelled) {
          setStartInputData(null);
          setStartInputDefaults(null);
        }
        return;
      }
      try {
        const payload = await gatewayJson<Record<string, unknown>>(inputDataEndpoint);
        let inputData: Record<string, unknown> | null = null;
        let workspace: Record<string, unknown> | null = null;
        if (payload && typeof payload === 'object') {
          const raw = payload.input_data;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            inputData = raw as Record<string, unknown>;
          } else {
            inputData = payload as Record<string, unknown>;
          }
          const wsRaw = (payload as any).workspace;
          if (wsRaw && typeof wsRaw === 'object' && !Array.isArray(wsRaw)) {
            workspace = wsRaw as Record<string, unknown>;
          }
        }
        if (cancelled) return;
        setStartInputData(inputData);
        if (workspace && Object.keys(workspace).length > 0) {
          setStartInputDefaults({ ...(inputData || {}), ...workspace });
        } else {
          setStartInputDefaults(inputData);
        }
      } catch {
        if (!cancelled) {
          setStartInputData(null);
          setStartInputDefaults(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, rootRunId, runInputDataDescriptor, strictGatewayContract]);

  // Map (parentRunId:nodeId[:stepId]) -> sub_run_id for subworkflow waits, so the UI can show
  // child run steps even before the parent subflow node completes.
  const subworkflowLinks = useMemo(() => {
    const out = new Map<string, string>();
    const keyFor = (runId: string, nodeId: string, stepId?: string) =>
      stepId ? `${runId}:${nodeId}:${stepId}` : `${runId}:${nodeId}`;
    for (const ev of events) {
      if (ev.type !== 'subworkflow_update') continue;
      const parentRunId = getActualRunId(ev);
      const parentNodeId = typeof ev.nodeId === 'string' ? ev.nodeId.trim() : '';
      const childRunId = typeof ev.sub_run_id === 'string' ? ev.sub_run_id.trim() : '';
      const parentStepId = typeof ev.stepId === 'string' ? ev.stepId.trim() : '';
      if (!parentRunId || !parentNodeId || !childRunId) continue;
      if (parentStepId) out.set(keyFor(parentRunId, parentNodeId, parentStepId), childRunId);
      // Back-compat fallback: older events may not carry a stepId.
      out.set(keyFor(parentRunId, parentNodeId), childRunId);
    }
    return out;
  }, [events]);

  // New run => collapse all nested subflow sections (predictable UX).
  useEffect(() => {
    if (!isOpen) return;
    setExpandedSubflows({});
  }, [isOpen, rootRunId]);

  const flowSummary = useMemo<ExecutionMetrics | null>(() => {
    if (!events || events.length === 0) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === 'flow_complete' && ev.meta) return ev.meta;
    }
    return null;
  }, [events]);

  const benchmarkProgress = useMemo(() => {
    const isBenchmark = flowId === 'be0a6c01' || flowName === 'benchmark-agentic';
    if (!isBenchmark) return null;

    const asRecord = (v: unknown): Record<string, unknown> | null => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return v as Record<string, unknown>;
    };

    const isBenchmarkRecord = (v: unknown): v is Record<string, unknown> => {
      const rec = asRecord(v);
      if (!rec) return false;
      const mode = typeof rec.mode === 'string' ? rec.mode.trim() : '';
      const promptId = typeof rec.prompt_id === 'string' ? rec.prompt_id.trim() : '';
      if (!mode || !promptId) return false;
      return 'metrics' in rec || 'correct' in rec || 'signature' in rec;
    };

    const parseArray = (pinId: string): unknown[] => {
      const raw = typeof formValues[pinId] === 'string' ? formValues[pinId] : '';
      const parsed = raw.trim() ? parseJson<unknown>(raw) : ({ ok: true, value: [] } as const);
      return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
    };

    const parseClampedInt = (pinId: string, fallback: number, min: number, max: number): number => {
      const raw = typeof formValues[pinId] === 'string' ? formValues[pinId] : '';
      const n = Number.parseInt(raw.trim(), 10);
      const out = Number.isFinite(n) ? n : fallback;
      return Math.max(min, Math.min(max, out));
    };

    const runsPinId = inputPins.find((p) => p.id === 'runs')?.id ?? 'runs';
    const promptsPinId = inputPins.find((p) => p.id === 'prompts')?.id ?? 'prompts';
    const repeatsPinId = inputPins.find((p) => p.id === 'repeats')?.id ?? 'repeats';

    const runsRaw = parseArray(runsPinId);
    const runsCount = runsRaw.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).length || 1;

    const promptsRaw = parseArray(promptsPinId);
    const prompts = promptsRaw.filter((p) => p && typeof p === 'object' && !Array.isArray(p)) as Array<Record<string, unknown>>;
    const promptsCount = prompts.length || 0;

    // Mirror `Build repeats_array` behavior (clamped to 1..20).
    const repeatsCount = parseClampedInt(repeatsPinId, 3, 1, 20);

    const totalRecords = runsCount * promptsCount * repeatsCount * 2;

    const findLoopNodeId = (needle: RegExp): string | null => {
      const n = nodes.find((n) => n.data?.nodeType === 'loop' && needle.test(String(n.data?.label || '')));
      return n?.id || null;
    };

    const runsLoopId = findLoopNodeId(/runs/i);
    const promptsLoopId = findLoopNodeId(/prompts/i);
    const repeatsLoopId = findLoopNodeId(/repeats/i);

    const runsLoop = runsLoopId ? loopProgressByNodeId[runsLoopId] : null;
    const promptsLoop = promptsLoopId ? loopProgressByNodeId[promptsLoopId] : null;
    const repeatsLoop = repeatsLoopId ? loopProgressByNodeId[repeatsLoopId] : null;

    const promptIndex = promptsLoop && typeof promptsLoop.index === 'number' ? promptsLoop.index : null;
    const promptObj = promptIndex != null && promptIndex >= 0 && promptIndex < prompts.length ? prompts[promptIndex] : null;
    const promptId = typeof promptObj?.id === 'string' ? promptObj.id : null;
    const promptLabel = typeof promptObj?.label === 'string' ? promptObj.label : null;

    let completedRecords = 0;
    if (rootRunId) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type !== 'node_complete') continue;
        const evRunId = getActualRunId(ev);
        if (evRunId && evRunId !== rootRunId) continue;

        const r = ev.result as unknown;
        const obj = asRecord(r);

        const candidate =
          (obj && Array.isArray(obj.value) ? obj.value : null) ||
          (obj && Array.isArray(obj.run_results) ? obj.run_results : null) ||
          (Array.isArray(r) ? r : null);

        if (!candidate || !Array.isArray(candidate)) continue;
        if (!candidate.some(isBenchmarkRecord)) continue;
        completedRecords = candidate.length;
        break;
      }
    }

    const findSubflowNodeId = (needle: RegExp): string | null => {
      const n = nodes.find((n) => n.data?.nodeType === 'subflow' && needle.test(String(n.data?.label || '')));
      return n?.id || null;
    };

    const reactSubflowId = findSubflowNodeId(/react\s*run/i);
    const codeactSubflowId = findSubflowNodeId(/codeact\s*run/i);

    const durations: number[] = [];
    if (rootRunId && (reactSubflowId || codeactSubflowId)) {
      for (const ev of events) {
        if (ev.type !== 'node_complete') continue;
        const evRunId = getActualRunId(ev);
        if (evRunId && evRunId !== rootRunId) continue;
        if (!ev.nodeId) continue;
        if (ev.nodeId !== reactSubflowId && ev.nodeId !== codeactSubflowId) continue;
        const ms = ev.meta && typeof ev.meta.duration_ms === 'number' ? ev.meta.duration_ms : null;
        if (ms != null && Number.isFinite(ms) && ms > 0) durations.push(ms);
      }
    }

    const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const remaining = totalRecords > 0 ? Math.max(0, totalRecords - completedRecords) : 0;
    const etaMs = avgMs != null && remaining > 0 ? avgMs * remaining : null;

    return {
      totalRecords,
      completedRecords,
      runsLoop,
      promptsLoop,
      repeatsLoop,
      promptId,
      promptLabel,
      etaMs,
    };
  }, [events, flowId, flowName, formValues, inputPins, loopProgressByNodeId, nodes, rootRunId]);

  const toggleSubflowExpansion = useCallback((stepId: string) => {
    const id = String(stepId || '').trim();
    if (!id) return;
    setExpandedSubflows((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  type SequenceBranchGroup = { key: string; label: string; nodes: StepTreeNode[] };
  type StepTreeNode = {
    stepId: string;
    depth: number;
    children: StepTreeNode[];
    childRunId?: string;
    sequenceBranches?: SequenceBranchGroup[];
    synthetic?: boolean;
  };
  const MAX_STEP_TREE_DEPTH = 3;

  const stepTree = useMemo<StepTreeNode[]>(() => {
    const roots = (Array.isArray(rootRunIds) ? rootRunIds : []).map((r) => String(r || '').trim()).filter(Boolean);
    const rid0 = typeof rootRunId === 'string' ? rootRunId.trim() : '';
    const rootIds = roots.length > 0 ? roots : rid0 ? [rid0] : [];
    if (rootIds.length === 0) return [];

    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const keyFor = (runId: string, nodeId: string, stepId?: string | null) =>
      stepId ? `${runId}:${nodeId}:${stepId}` : `${runId}:${nodeId}`;

    const childRunIdFromOutput = (out: unknown): string | null => {
      if (!out || typeof out !== 'object') return null;
      const o = out as Record<string, unknown>;
      const sr = pick(o.sub_run_id);
      if (!sr) return null;
      // Heuristic: only treat this as a subworkflow-like output when it looks like the
      // visual START_SUBWORKFLOW mapping (compiler populates child_output/output fields).
      if (!('child_output' in o) && !('output' in o)) return null;
      return sr;
    };

    const childRunIdFromStep = (s: Step): string | null => {
      // Agent nodes have their own dedicated live trace panel; expanding the internal
      // ReAct sub-run nodes (init/reason/act/...) in the execution list is noisy and
      // not actionable (they are not VisualFlow nodes and typically have no details).
      if (s.nodeType === 'agent') return null;
      const fromOutput = childRunIdFromOutput(s.output);
      if (fromOutput) return fromOutput;
      const parentRunId = pick(s.runId);
      const parentNodeId = pick(s.nodeId);
      const parentStepId = pick(s.runtimeStepId);
      if (!parentRunId || !parentNodeId) return null;
      if (parentStepId) {
        const scoped = subworkflowLinks.get(keyFor(parentRunId, parentNodeId, parentStepId));
        if (scoped) return scoped;
      }
      return subworkflowLinks.get(keyFor(parentRunId, parentNodeId)) || null;
    };

    const seen = new Set<string>();
    const buildForRun = (rid: string, depth: number): StepTreeNode[] => {
      const rid2 = String(rid || '').trim();
      if (!rid2) return [];
      if (seen.has(rid2)) return [];
      seen.add(rid2);

      const bucket = stepsByRunId.get(rid2);
      if (!bucket || bucket.length === 0) return [];

      const nodes: StepTreeNode[] = [];
      for (const s of bucket) {
        const childRunId = childRunIdFromStep(s);
        const children =
          depth < MAX_STEP_TREE_DEPTH &&
          childRunId &&
          stepsByRunId.get(childRunId) &&
          (stepsByRunId.get(childRunId) as Step[]).length > 0
            ? buildForRun(childRunId, depth + 1)
            : [];
        nodes.push({ stepId: s.id, depth, children, childRunId: childRunId || undefined });
      }
      return nodes;
    };

    const out: StepTreeNode[] = [];
    for (const rid of rootIds) {
      out.push(...buildForRun(rid, 0));
    }
    return out;
  }, [rootRunId, rootRunIds, stepsByRunId, subworkflowLinks]);

  const sequenceDisplay = useMemo(() => {
    const displayStepById = new Map(stepById);
    if (stepTree.length === 0 || sequenceLayouts.size === 0) {
      return { stepTree, stepById: displayStepById };
    }

    const findIndexFrom = (items: StepTreeNode[], start: number, predicate: (node: StepTreeNode) => boolean): number => {
      for (let i = Math.max(0, start); i < items.length; i++) {
        if (predicate(items[i])) return i;
      }
      return -1;
    };

    const stepForNode = (node: StepTreeNode): Step | null => displayStepById.get(node.stepId) || stepById.get(node.stepId) || null;

    const collectSteps = (items: StepTreeNode[]): Step[] => {
      const out: Step[] = [];
      const seen = new Set<string>();
      const visit = (nodes: StepTreeNode[]) => {
        for (const item of nodes) {
          const step = stepForNode(item);
          if (step && !seen.has(step.id)) {
            seen.add(step.id);
            out.push(step);
          }
          if (item.sequenceBranches?.length) {
            for (const branch of item.sequenceBranches) visit(branch.nodes);
          }
          if (item.children?.length) visit(item.children);
        }
      };
      visit(items);
      return out;
    };

    const earliestStartedAt = (items: Step[]): string | undefined => {
      let best: string | undefined;
      for (const step of items) {
        const ts = typeof step.startedAt === 'string' ? step.startedAt : undefined;
        if (!ts) continue;
        if (!best || ts.localeCompare(best) < 0) best = ts;
      }
      return best;
    };

    const buildDisplaySequenceStep = ({
      sequenceNodeId,
      anchorNode,
      realStep,
      branches,
      syntheticId,
    }: {
      sequenceNodeId: string;
      anchorNode: StepTreeNode;
      realStep: Step | null;
      branches: SequenceBranchGroup[];
      syntheticId: string;
    }): Step => {
      const meta = resolveNodeMeta(sequenceNodeId);
      const branchSteps = collectSteps(branches.flatMap((branch) => branch.nodes));
      const failed = branchSteps.find((step) => step.status === 'failed');
      const hasRunningish = branchSteps.some((step) => step.status === 'running' || step.status === 'waiting');
      const baseStep = realStep || stepForNode(anchorNode);
      const fallbackSummary = branches.length > 0 ? branches.map((branch) => branch.label).join(' → ') : 'Sequence';
      const status: StepStatus = realStep
        ? realStep.status
        : failed
          ? 'failed'
          : hasRunningish || branchSteps.length > 0
            ? 'running'
            : 'running';

      return {
        id: realStep?.id || syntheticId,
        status,
        runId: realStep?.runId || baseStep?.runId,
        runtimeStepId: realStep?.runtimeStepId,
        nodeId: sequenceNodeId,
        nodeLabel: meta?.label || realStep?.nodeLabel || sequenceNodeId,
        nodeType: meta?.type || realStep?.nodeType || 'sequence',
        nodeIcon: meta?.icon || realStep?.nodeIcon,
        nodeColor: meta?.color || realStep?.nodeColor,
        summary: realStep?.summary || fallbackSummary,
        output: realStep?.output,
        error: realStep?.error || failed?.error,
        metrics: realStep?.metrics,
        startedAt: realStep?.startedAt || earliestStartedAt(branchSteps) || baseStep?.startedAt,
        endedAt: realStep?.endedAt,
        waiting: realStep?.waiting,
      };
    };

    const groupSequenceNodes = (items: StepTreeNode[], excludedSequenceIds: Set<string> = new Set()): StepTreeNode[] => {
      if (items.length === 0) return items;

      type Candidate = {
        anchor: number;
        endExclusive: number;
        node: StepTreeNode;
      };

      const candidates: Candidate[] = [];

      for (const [sequenceNodeId, branches] of sequenceLayouts.entries()) {
        if (excludedSequenceIds.has(sequenceNodeId)) continue;

        const realIndex = findIndexFrom(items, 0, (item) => stepForNode(item)?.nodeId === sequenceNodeId);
        const hits: Array<{ branch: (typeof branches)[number]; index: number }> = [];
        let searchFrom = 0;
        for (const branch of branches) {
          const hitIndex = findIndexFrom(items, searchFrom, (item) => stepForNode(item)?.nodeId === branch.targetNodeId);
          if (hitIndex < 0) continue;
          hits.push({ branch, index: hitIndex });
          searchFrom = hitIndex + 1;
        }

        if (hits.length === 0 && realIndex < 0) continue;

        const firstBranchIndex = hits.length > 0 ? hits[0].index : Number.MAX_SAFE_INTEGER;
        const anchor = Math.min(realIndex >= 0 ? realIndex : Number.MAX_SAFE_INTEGER, firstBranchIndex);
        if (!Number.isFinite(anchor)) continue;

        const anchorNode = items[anchor];
        if (!anchorNode) continue;

        const nextHitIndexByPosition = new Map<number, number>();
        for (let i = 0; i < hits.length; i++) {
          const current = hits[i];
          const next = hits[i + 1];
          nextHitIndexByPosition.set(current.index, next ? next.index : -1);
        }

        let lastConsumed = realIndex >= 0 ? realIndex + 1 : anchor + 1;
        const branchGroups: SequenceBranchGroup[] = branches.map((branch) => {
          const hit = hits.find((entry) => entry.branch.handleId === branch.handleId);
          if (!hit) {
            return {
              key: `${sequenceNodeId}:${branch.handleId}:${anchor}:empty`,
              label: branch.label,
              nodes: [],
            };
          }

          const nextHit = nextHitIndexByPosition.get(hit.index) ?? -1;
          const segmentEnd =
            nextHit > hit.index
              ? nextHit
              : realIndex > hit.index
                ? realIndex
                : hit.index + 1;
          const rawSegment = items.slice(hit.index, Math.max(hit.index + 1, segmentEnd));
          const nextExcluded = new Set(excludedSequenceIds);
          nextExcluded.add(sequenceNodeId);
          const nodes = groupSequenceNodes(rawSegment, nextExcluded);
          lastConsumed = Math.max(lastConsumed, Math.max(hit.index + 1, segmentEnd));
          return {
            key: `${sequenceNodeId}:${branch.handleId}:${hit.index}`,
            label: branch.label,
            nodes,
          };
        });

        const syntheticId = `synthetic:sequence:${sequenceNodeId}:${anchor}:${anchorNode.stepId}`;
        const realStep = realIndex >= 0 ? stepById.get(items[realIndex].stepId) || null : null;
        const displayStep = buildDisplaySequenceStep({
          sequenceNodeId,
          anchorNode,
          realStep,
          branches: branchGroups,
          syntheticId,
        });
        displayStepById.set(displayStep.id, displayStep);

        candidates.push({
          anchor,
          endExclusive: Math.max(lastConsumed, realIndex >= 0 ? realIndex + 1 : anchor + 1),
          node: {
            stepId: displayStep.id,
            depth: anchorNode.depth,
            children: [],
            sequenceBranches: branchGroups,
            synthetic: !realStep,
          },
        });
      }

      if (candidates.length === 0) return items;

      candidates.sort((a, b) => a.anchor - b.anchor || b.endExclusive - a.endExclusive);
      const selected = new Map<number, Candidate>();
      let cursor = -1;
      for (const candidate of candidates) {
        if (candidate.anchor < cursor) continue;
        selected.set(candidate.anchor, candidate);
        cursor = candidate.endExclusive;
      }

      const out: StepTreeNode[] = [];
      for (let i = 0; i < items.length;) {
        const candidate = selected.get(i);
        if (candidate) {
          out.push(candidate.node);
          i = candidate.endExclusive;
          continue;
        }
        out.push(items[i]);
        i += 1;
      }
      return out;
    };

    return {
      stepTree: groupSequenceNodes(stepTree),
      stepById: displayStepById,
    };
  }, [resolveNodeMeta, sequenceLayouts, stepById, stepTree]);
  const displayStepTree = sequenceDisplay.stepTree;
  const displayStepById = sequenceDisplay.stepById;

  // Auto-expand running subflows so long-running nested runs are observable by default.
  // If the user explicitly collapses (sets false), do not override.
  useEffect(() => {
    if (!isOpen) return;
    if (displayStepTree.length === 0) return;
    setExpandedSubflows((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };

      const visit = (nodes: StepTreeNode[]) => {
        for (const n of nodes) {
          const nestedSequenceNodes = n.sequenceBranches?.flatMap((branch) => branch.nodes) || [];
          const hasNestedContent = (n.children && n.children.length > 0) || nestedSequenceNodes.length > 0;
          if (!hasNestedContent) continue;
          // Keep the execution list readable: only auto-expand direct root-flow groups.
          if (n.depth > 0) {
            visit(n.children || []);
            if (nestedSequenceNodes.length > 0) visit(nestedSequenceNodes);
            continue;
          }
          const s = displayStepById.get(n.stepId);
          if (!s) continue;

          const isRunningish = s.status === 'running' || s.status === 'waiting';
          const isSequence = s.nodeType === 'sequence';
          if ((isRunningish || isSequence) && !(n.stepId in prev)) {
            next[n.stepId] = true;
            changed = true;
          }

          visit(n.children || []);
          if (nestedSequenceNodes.length > 0) visit(nestedSequenceNodes);
        }
      };
      visit(displayStepTree);

      return changed ? next : prev;
    });
  }, [displayStepById, displayStepTree, isOpen]);

  const completedTerminalStep = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.nodeType === 'on_flow_end' && step.status === 'completed') return step;
    }
    return null;
  }, [steps]);

  // Keep selection valid; default to last step.
  useEffect(() => {
    if (!isOpen) return;
    if (steps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && displayStepById.has(selectedStepId)) return;
    setSelectedStepId(steps[steps.length - 1].id);
  }, [displayStepById, isOpen, selectedStepId, steps]);

  useEffect(() => {
    lastAutoTerminalStepIdRef.current = null;
  }, [rootRunId]);

  // When a run finishes, land the details pane on the terminal On Flow End step.
  // This is separate from live following so a user can inspect another completed
  // step after the automatic terminal selection has happened once.
  useEffect(() => {
    if (!isOpen) return;
    if (isRunning || isWaiting) return;
    if (!completedTerminalStep) return;
    if (!displayStepById.has(completedTerminalStep.id)) return;
    if (lastAutoTerminalStepIdRef.current === completedTerminalStep.id) return;
    lastAutoTerminalStepIdRef.current = completedTerminalStep.id;
    setSelectedStepId(completedTerminalStep.id);
  }, [completedTerminalStep, displayStepById, isOpen, isRunning, isWaiting]);

  // Follow the live execution: when new steps arrive during a run (or waiting),
  // auto-select the latest step so the user always sees what's happening.
  useEffect(() => {
    if (!isOpen) return;
    if (!(isRunning || isWaiting)) return;
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    if (!last) return;
    setSelectedStepId(last.id);
  }, [isOpen, isRunning, isWaiting, steps]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    return displayStepById.get(selectedStepId) || null;
  }, [displayStepById, selectedStepId]);
  const waitingInfoDetails =
    waitingInfo?.details && typeof waitingInfo.details === 'object'
      ? (waitingInfo.details as Record<string, unknown>)
      : null;
  const isApprovalDetails = useCallback((details: Record<string, unknown> | null): boolean => {
    if (!details) return false;
    const modeRaw = details.mode;
    const kindRaw = details.kind;
    const mode = typeof modeRaw === 'string' ? modeRaw.toLowerCase() : '';
    const kind = typeof kindRaw === 'string' ? kindRaw.toLowerCase() : '';
    return mode === 'approval_required' || kind === 'tool_approval';
  }, []);
  const approvalWait = useMemo(() => {
    if (isApprovalDetails(waitingInfoDetails)) {
      return { details: waitingInfoDetails, waitKey: waitingInfo?.waitKey, runId: waitingInfo?.runId };
    }
    const allSteps = Array.from(stepById.values());
    for (let i = allSteps.length - 1; i >= 0; i--) {
      const step = allSteps[i];
      const waiting = step.waiting;
      const details =
        waiting?.details && typeof waiting.details === 'object' ? (waiting.details as Record<string, unknown>) : null;
      if (!isApprovalDetails(details)) continue;
      return { details, waitKey: waiting?.waitKey, runId: waiting?.runId || step.runId };
    }
    return null;
  }, [isApprovalDetails, stepById, waitingInfo?.runId, waitingInfo?.waitKey, waitingInfoDetails]);
  const approvalDetails = approvalWait ? approvalWait.details : null;
  const approvalToolCalls = approvalDetails && Array.isArray(approvalDetails.tool_calls) ? approvalDetails.tool_calls : [];
  const approvalRunId = approvalWait?.runId || waitingInfo?.runId;

  const waitingPayload = selectedStep?.waiting || null;
  const waitingReasonRaw = typeof waitingPayload?.reason === 'string' ? waitingPayload.reason : '';
  const waitingDetails =
    waitingPayload?.details && typeof waitingPayload.details === 'object'
      ? (waitingPayload.details as Record<string, unknown>)
      : null;
  const approvalModeRaw = waitingDetails ? waitingDetails.mode : undefined;
  const approvalMode = typeof approvalModeRaw === 'string' ? approvalModeRaw.toLowerCase() : '';
  const approvalKindRaw = waitingDetails ? waitingDetails.kind : undefined;
  const approvalKind = typeof approvalKindRaw === 'string' ? approvalKindRaw.toLowerCase() : '';
  const isToolApprovalWait = approvalMode === 'approval_required' || approvalKind === 'tool_approval';
  const showWaitingPanel = Boolean(waitingPayload) && selectedStep?.status === 'waiting';
  const isSubworkflowWait = waitingReasonRaw.trim().toLowerCase() === 'subworkflow';
  const selectedResidencyResultStatus =
    selectedStep?.nodeType === 'model_residency' ? residencyResultStatusInfo(selectedStep.output) : null;
  const selectedDurationLabel =
    selectedStep?.metrics && selectedStep.metrics.duration_ms != null
      ? formatDuration(selectedStep.metrics.duration_ms)
      : '';
  const detailsBodyClass =
    selectedStep?.nodeType === 'agent' ? 'run-details-body run-details-body--agent' : 'run-details-body';
  const tokenBadge = selectedStep?.metrics ? formatTokenBadge(selectedStep.metrics) : '';
  const tpsBadge = selectedStep?.metrics ? formatTpsBadge(selectedStep.metrics) : '';
  const showMetricsBlock =
    Boolean(selectedStep?.metrics) && selectedStep?.nodeType !== 'agent' && Boolean(tokenBadge || tpsBadge);
  const runningTitle = isSubworkflowWait
    ? selectedStep?.nodeType === 'agent'
      ? 'Agent running (subworkflow)'
      : 'Subflow running'
    : 'Working…';
  const runningNote = isSubworkflowWait
    ? 'This node executes as a durable sub-run so its internal steps can stream in real time.'
    : 'This node is still processing. The output will appear when it completes.';

  // Keep raw JSON available for debugging without making it the default view.
  useEffect(() => {
    if (!isOpen) return;
    if (!selectedStepId) return;
    setRawJsonOpen(false);
  }, [isOpen, selectedStepId]);

  const parentRunId = useMemo(() => {
    const raw = runSummary?.parent_run_id;
    const pid = typeof raw === 'string' ? raw.trim() : '';
    return pid || null;
  }, [runSummary?.parent_run_id]);

  const selectedAgentSubRunId = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    const out = selectedStep.output;
    if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>;
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const direct = pick(o.sub_run_id);
      if (direct) return direct;
      const scratchpad = o.scratchpad;
      if (scratchpad && typeof scratchpad === 'object') {
        const sp = scratchpad as Record<string, unknown>;
        const sr = pick(sp.sub_run_id);
        if (sr) return sr;
      }
      const resultObj = o.result;
      if (resultObj && typeof resultObj === 'object') {
        const ro = resultObj as Record<string, unknown>;
        const sr = pick(ro.sub_run_id);
        if (sr) return sr;
      }
    }
    // Running agents may not have output yet. Prefer the explicit subworkflow link (per invocation)
    // before falling back to heuristics.
    {
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const parentRunId = pick(selectedStep.runId);
      const parentNodeId = pick(selectedStep.nodeId);
      const parentStepId = pick(selectedStep.runtimeStepId);
      if (parentRunId && parentNodeId) {
        if (parentStepId) {
          const scoped = subworkflowLinks.get(`${parentRunId}:${parentNodeId}:${parentStepId}`);
          if (scoped) return scoped;
        }
        const fallback = subworkflowLinks.get(`${parentRunId}:${parentNodeId}`);
        if (fallback) return fallback;
      }
    }
    // Running agents don't have final output yet. Best-effort: use the latest sub-run trace_update runId.
    for (let i = traceEvents.length - 1; i >= 0; i--) {
      const ev = traceEvents[i];
      if (ev.type !== 'trace_update') continue;
      if (typeof ev.runId === 'string' && ev.runId.trim() && ev.runId !== rootRunId) return ev.runId.trim();
    }
    return null;
  }, [rootRunId, selectedStep, subworkflowLinks, traceEvents]);

  const selectedSubflowRunId = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'subflow') return null;
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const out = selectedStep.output;
    if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>;
      const direct = pick(o.sub_run_id);
      if (direct) return direct;
      const childOut = o.child_output;
      if (childOut && typeof childOut === 'object') {
        const co = childOut as Record<string, unknown>;
        const sr = pick(co.sub_run_id);
        if (sr) return sr;
      }
    }

    const parentRunId = pick(selectedStep.runId);
    const parentNodeId = pick(selectedStep.nodeId);
    const parentStepId = pick(selectedStep.runtimeStepId);
    if (!parentRunId || !parentNodeId) return null;
    if (parentStepId) {
      const scoped = subworkflowLinks.get(`${parentRunId}:${parentNodeId}:${parentStepId}`);
      if (scoped) return scoped;
    }
    return subworkflowLinks.get(`${parentRunId}:${parentNodeId}`) || null;
  }, [selectedStep, subworkflowLinks]);

  const agentTracePanel = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    return <AgentSubrunTracePanel rootRunId={rootRunId} events={traceEvents} subRunId={selectedAgentSubRunId} />;
  }, [rootRunId, selectedAgentSubRunId, selectedStep, traceEvents]);

  const subflowTracePanel = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'subflow') return null;
    if (selectedSubflowRunId) {
      return (
        <AgentSubrunTracePanel
          rootRunId={rootRunId}
          events={traceEvents}
          subRunId={selectedSubflowRunId}
          title="Subflow calls"
          subtitle="Live per-effect trace (LLM/tool calls)."
          onOpenSubRun={onSelectRunId ? () => onSelectRunId(selectedSubflowRunId) : undefined}
        />
      );
    }
    return (
      <div className="agent-trace-panel">
        <div className="agent-trace-header">
          <div className="agent-trace-title">Subflow calls</div>
          <div className="agent-trace-subtitle">Waiting for sub_run_id…</div>
        </div>
        <div className="agent-trace-empty">No trace entries yet.</div>
      </div>
    );
  }, [onSelectRunId, rootRunId, selectedStep, selectedSubflowRunId, traceEvents]);

  const derivedAgentOutput = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    if (!selectedAgentSubRunId) return null;
    for (let i = traceEvents.length - 1; i >= 0; i--) {
      const ev = traceEvents[i];
      if (ev.type !== 'trace_update') continue;
      if (ev.runId !== selectedAgentSubRunId) continue;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      for (let j = steps.length - 1; j >= 0; j--) {
        const step = steps[j] as Record<string, unknown>;
        const res = step?.result;
        if (!res || typeof res !== 'object') continue;
        const resObj = res as Record<string, unknown>;
        if ('output' in resObj && resObj.output != null) return resObj.output as unknown;
        if ('result' in resObj && resObj.result != null) return resObj.result as unknown;
      }
    }
    return null;
  }, [selectedAgentSubRunId, selectedStep, traceEvents]);

  const resolvedStepOutput = useMemo(() => {
    if (!selectedStep) return null;
    if (selectedStep.output != null) return selectedStep.output;
    if (selectedStep.nodeType === 'agent') return derivedAgentOutput;
    return null;
  }, [derivedAgentOutput, selectedStep]);

  const generatedImagePreview = useMemo(
    () => extractGeneratedImagePreview(resolvedStepOutput, [selectedStep?.runId, rootRunId], artifactContentDescriptor),
    [artifactContentDescriptor, resolvedStepOutput, rootRunId, selectedStep?.runId]
  );
  const generatedAudioPreview = useMemo(
    () => extractGeneratedAudioPreview(resolvedStepOutput, [selectedStep?.runId, rootRunId], artifactContentDescriptor),
    [artifactContentDescriptor, resolvedStepOutput, rootRunId, selectedStep?.runId]
  );

  const stepArtifactPreviewById = useMemo(() => {
    const map = new Map<string, { kind: 'image' | 'audio' | 'text'; artifactId: string }>();
    for (const step of steps) {
      const output = step.output;
      if (output == null) continue;
      const image = extractGeneratedImagePreview(output, [step.runId, rootRunId], artifactContentDescriptor);
      if (image) {
        map.set(step.id, { kind: 'image', artifactId: image.artifactId });
        continue;
      }
      const audio = extractGeneratedAudioPreview(output, [step.runId, rootRunId], artifactContentDescriptor);
      if (audio) map.set(step.id, { kind: 'audio', artifactId: audio.artifactId });
      const text = extractGeneratedTextPreview(output, step);
      if (text) map.set(step.id, { kind: 'text', artifactId: text.artifactId });
    }
    return map;
  }, [artifactContentDescriptor, rootRunId, steps]);

  const runArtifactSummary = useMemo<RunGeneratedArtifact[]>(() => {
    const out: RunGeneratedArtifact[] = [];
    const seen = new Set<string>();
    for (const step of steps) {
      const output = step.output;
      if (output == null) continue;
      const stepLabel = step.nodeLabel || step.nodeId || step.nodeType || step.id;
      const image = extractGeneratedImagePreview(output, [step.runId, rootRunId], artifactContentDescriptor);
      if (image) {
        const key = `image:${image.artifactId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ kind: 'image', preview: image, stepLabel });
        }
      }
      const audio = extractGeneratedAudioPreview(output, [step.runId, rootRunId], artifactContentDescriptor);
      if (audio) {
        const key = `audio:${audio.artifactId}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ kind: 'audio', preview: audio, stepLabel });
        }
      }
      const text = extractGeneratedTextPreview(output, step);
      if (text) {
        const key = `text:${step.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ kind: 'text', preview: text, stepLabel });
        }
      }
    }
    return out;
  }, [artifactContentDescriptor, rootRunId, steps]);

  const computedFinalResult = useMemo(() => {
    if (steps.length === 0) return null;
    const lastTerminal = [...steps].reverse().find((s) => s.nodeType === 'on_flow_end' && s.output != null);
    const fallback = [...steps].reverse().find((s) => s.status === 'completed' && s.output != null);
    const picked = lastTerminal || fallback;
    if (!picked || picked.output == null) return null;
    return { success: true, result: picked.output } as FlowRunResult;
  }, [steps]);

  const effectiveResult = useMemo(() => {
    if (!result) return computedFinalResult;
    if (result.error) return result;
    if (result.result === undefined && computedFinalResult) return computedFinalResult;
    return result;
  }, [computedFinalResult, result]);

  const hasRunData = isRunning || effectiveResult != null || events.length > 0;

  const showFinalResult = useMemo(() => {
    if (!effectiveResult || isRunning) return false;
    if (effectiveResult.success && runArtifactSummary.length > 0) return false;
    if (steps.length === 0) return true;
    const last = steps[steps.length - 1];
    if (!last || selectedStepId !== last.id) return false;
    if (selectedStep?.output != null && effectiveResult.result != null) {
      return stringifyJson(selectedStep.output) !== stringifyJson(effectiveResult.result);
    }
    return true;
  }, [effectiveResult, isRunning, runArtifactSummary.length, selectedStep?.output, selectedStepId, steps]);

  const showRunArtifactSummary = useMemo(() => {
    if (runArtifactSummary.length === 0) return false;
    if (generatedImagePreview || generatedAudioPreview) return false;
    if (!selectedStep) return true;
    const last = steps[steps.length - 1];
    return selectedStep.nodeType === 'on_flow_end' || selectedStep.id === last?.id;
  }, [generatedAudioPreview, generatedImagePreview, runArtifactSummary.length, selectedStep, steps]);

  const runStatusLabel = useMemo(() => {
    if (isPaused) return 'PAUSED';
    if (approvalDetails || isWaiting) return 'WAITING';
    if (isRunning) return 'RUNNING';
    if (effectiveResult) return effectiveResult.success ? 'SUCCESS' : 'FAILED';
    return '';
  }, [approvalDetails, effectiveResult, isPaused, isRunning, isWaiting]);

  // Minimized view (run minibar): show current step + status and keep the canvas visible.
  // This uses only local state (isMinimized) so it never affects run execution itself.
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const currentStepLabel = (lastStep?.nodeLabel || lastStep?.nodeId || 'Starting…') as string;
  const currentStepStatus = runStatusLabel || (lastStep?.status ? String(lastStep.status).toUpperCase() : 'READY');

  const minibarAgentMeta = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    if (!selectedAgentSubRunId) return null;

    // Find the latest trace step for this Agent execution instance.
    let lastTraceStep: Record<string, unknown> | null = null;
    for (let i = traceEvents.length - 1; i >= 0; i--) {
      const ev = traceEvents[i];
      if (ev.type !== 'trace_update') continue;
      if (!ev.runId || ev.runId !== selectedAgentSubRunId) continue;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      for (let j = steps.length - 1; j >= 0; j--) {
        const st = steps[j];
        if (st && typeof st === 'object') {
          lastTraceStep = st as Record<string, unknown>;
          break;
        }
      }
      if (lastTraceStep) break;
    }
    if (!lastTraceStep) return null;

    const effect = lastTraceStep.effect && typeof lastTraceStep.effect === 'object' ? (lastTraceStep.effect as Record<string, unknown>) : null;
    const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
    const effectLabel = effectType ? effectType.toUpperCase() : 'EFFECT';

    // Token badges (LLM_CALL)
    const res = lastTraceStep.result && typeof lastTraceStep.result === 'object' ? (lastTraceStep.result as Record<string, unknown>) : null;
    const raw = res && res.raw && typeof res.raw === 'object' ? (res.raw as Record<string, unknown>) : null;
    const usage =
      (res && res.usage && typeof res.usage === 'object' ? (res.usage as Record<string, unknown>) : null) ||
      (raw && raw.usage && typeof raw.usage === 'object' ? (raw.usage as Record<string, unknown>) : null) ||
      (raw && raw.usage_metadata && typeof raw.usage_metadata === 'object' ? (raw.usage_metadata as Record<string, unknown>) : null) ||
      null;

    const toNum = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const inTokens = toNum(usage?.input_tokens) ?? toNum(usage?.prompt_tokens) ?? toNum(res?.input_tokens) ?? toNum(res?.prompt_tokens);
    const outTokens = toNum(usage?.output_tokens) ?? toNum(usage?.completion_tokens) ?? toNum(res?.output_tokens) ?? toNum(res?.completion_tokens);
    const totalTokens = toNum(usage?.total_tokens) ?? toNum(res?.total_tokens);

    const tokenBadges: Array<{ label: string; value: number }> = [];
    if (inTokens != null) tokenBadges.push({ label: 'in', value: inTokens });
    if (outTokens != null) tokenBadges.push({ label: 'out', value: outTokens });
    if (totalTokens != null) tokenBadges.push({ label: 'total', value: totalTokens });

    // Tool badges (TOOL_CALLS)
    const payload = effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
    const toolCalls =
      (payload && Array.isArray(payload.tool_calls) ? payload.tool_calls : null) ||
      (payload && Array.isArray(payload.tool_calls_raw) ? payload.tool_calls_raw : null) ||
      (payload && Array.isArray(payload.calls) ? payload.calls : null) ||
      null;
    const toolNames: string[] = [];
    if (toolCalls) {
      for (const c of toolCalls) {
        if (!c || typeof c !== 'object') continue;
        const name = typeof (c as any).name === 'string' ? String((c as any).name).trim() : '';
        if (name) toolNames.push(name);
      }
    }
    const uniqueToolNames = Array.from(new Set(toolNames));

    return { effectLabel, tokenBadges, toolNames: uniqueToolNames };
  }, [selectedStep, selectedAgentSubRunId, traceEvents]);

  const minibar = (
    <div className="run-minibar" role="region" aria-label="Run Flow mini bar">
      <button type="button" className="run-minibar-main" onClick={() => setIsMinimized(false)}>
        <span className="run-minibar-title">Run</span>
        <span
          className={[
            'run-minibar-status',
            isRunning ? 'running' : '',
            isPaused ? 'paused' : '',
            isWaiting ? 'waiting' : '',
            result ? (result.success ? 'success' : 'failed') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {currentStepStatus}
        </span>
        <span className="run-minibar-step" title={currentStepLabel}>
          {currentStepLabel}
        </span>
          {lastLoopProgress ? (
            <span className="run-minibar-loop" title={`Loop progress (${lastLoopProgress.nodeId})`}>
              {Math.min(lastLoopProgress.index + 1, lastLoopProgress.total)}/{lastLoopProgress.total}
            </span>
          ) : null}
          {lastStep?.nodeType === 'agent' && minibarAgentMeta ? (
            <span className="run-minibar-agent-meta" title={minibarAgentMeta.effectLabel}>
              <span className="run-minibar-effect">{minibarAgentMeta.effectLabel}</span>
              {minibarAgentMeta.tokenBadges.map((b) => (
                <span key={b.label} className="run-metric-badge metric-tokens">
                  {b.label}: {b.value}
                </span>
              ))}
              {minibarAgentMeta.toolNames.slice(0, 3).map((n) => (
                <span key={n} className="run-metric-badge metric-tool">
                  {n}
                </span>
              ))}
              {minibarAgentMeta.toolNames.length > 3 ? (
                <span className="run-metric-badge metric-tool">+{minibarAgentMeta.toolNames.length - 3}</span>
              ) : null}
            </span>
          ) : null}
        <span className="run-minibar-flow" title={flowName || 'Untitled Flow'}>
          {flowName || 'Untitled Flow'}
        </span>
      </button>

      <div className="run-minibar-actions">
        {onCancelRun ? (
          <button
            type="button"
            className="run-minibar-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              onCancelRun();
            }}
            disabled={!(isRunning || isPaused || isWaiting)}
            title="Cancel"
            aria-label="Cancel run"
          >
            ⏹
          </button>
        ) : null}

        {(onPause || onResumeRun) ? (
          <button
            type="button"
            className="run-minibar-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (isPaused) onResumeRun?.();
              else onPause?.();
            }}
            disabled={isPaused ? !isPaused : !(isRunning && !isWaiting)}
            title={isPaused ? 'Resume' : 'Pause'}
            aria-label={isPaused ? 'Resume run' : 'Pause run'}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
        ) : null}

        <button
          type="button"
          className="run-minibar-btn"
          onClick={() => setIsMinimized(false)}
          title="Expand"
          aria-label="Expand run modal"
        >
          <ChevronUpIcon />
        </button>
      </div>
    </div>
  );

  const shouldRenderMarkdown = useCallback(
    (nodeType?: string | null) => {
      const t = typeof nodeType === 'string' ? nodeType.trim() : '';
      if (!t) return false;
      return (
        t === 'ask_user' ||
        t === 'answer_user' ||
        t === 'llm_call' ||
        t === 'code' ||
        t === 'agent' ||
        t === 'on_flow_end' ||
        // Subflows often contain markdown-ish artifacts (e.g. raw LLM answers with code fences).
        t === 'subflow'
      );
    },
    []
  );

  const hexToRgba = (hex: string, alpha: number) => {
    const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return `rgba(255,255,255,${alpha})`;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const formatValue = useCallback((value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  const beautifyJsonText = useCallback((raw: string): { text: string; isJson: boolean } => {
    const text = typeof raw === 'string' ? raw : String(raw ?? '');
    const trimmed = text.trim();
    if (!trimmed) return { text, isJson: false };
    const looksJson =
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'));
    if (!looksJson) return { text, isJson: false };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { text, isJson: false };
    }
  }, []);

  const extractFollowUpPrompt = useCallback((input: Record<string, unknown> | null): string => {
    if (!input) return '';
    const candidates = ['prompt', 'message', 'task', 'query', 'question'];
    for (const key of candidates) {
      const v = input[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }, []);

  const extractFollowUpAnswer = useCallback((value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value !== 'object') return String(value);
    if (Array.isArray(value)) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    const obj = value as Record<string, unknown>;
    const keys = ['output', 'result', 'response', 'message', 'text', 'answer'];
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const nested = v as Record<string, unknown>;
        for (const nk of keys) {
          const nv = nested[nk];
          if (typeof nv === 'string' && nv.trim()) return nv.trim();
        }
      }
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  const followUpSeed = useMemo(() => {
    if (!followUpWorkflowKey) return null;
    const baseMessages: FollowUpMessage[] = [];
    const ctxRaw = startInputData?.context;
    if (ctxRaw && typeof ctxRaw === 'object' && !Array.isArray(ctxRaw)) {
      const ctx = ctxRaw as Record<string, unknown>;
      const msgs = ctx.messages;
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
          const rec = m as Record<string, unknown>;
          const role = rec.role === 'assistant' ? 'assistant' : rec.role === 'user' ? 'user' : null;
          const content = typeof rec.content === 'string' ? rec.content.trim() : '';
          if (role && content) baseMessages.push({ role, content });
        }
      }
    }

    const prompt = extractFollowUpPrompt(startInputData);
    if (prompt) {
      const last = baseMessages[baseMessages.length - 1];
      if (!last || last.role !== 'user' || last.content !== prompt) {
        baseMessages.push({ role: 'user', content: prompt });
      }
    }

    const answerSource = effectiveResult?.result ?? effectiveResult;
    const answer = extractFollowUpAnswer(answerSource);
    if (answer) {
      const last = baseMessages[baseMessages.length - 1];
      if (!last || last.role !== 'assistant' || last.content !== answer) {
        baseMessages.push({ role: 'assistant', content: answer });
      }
    }

    return baseMessages.length > 0 ? { messages: baseMessages, workflowKey: followUpWorkflowKey, rootRunId } : null;
  }, [effectiveResult, extractFollowUpAnswer, extractFollowUpPrompt, followUpWorkflowKey, rootRunId, startInputData]);

  useEffect(() => {
    setFollowUpContext((prev) => (!prev || prev.workflowKey === currentWorkflowKey ? prev : null));
    setLastRunSeed((prev) => (!prev || prev.workflowKey === currentWorkflowKey ? prev : null));
    setShowFollowUpModal(false);
    setFollowUpError(null);
    setFollowUpDraft('');
    setFollowUpAttachments([]);
  }, [currentWorkflowKey]);

  useEffect(() => {
    if (!followUpSeed) return;
    if (!followUpSeed.workflowKey || followUpSeed.workflowKey !== followUpWorkflowKey) return;
    if (isRunning || isPaused || isWaiting) return;
    setLastRunSeed(followUpSeed);
  }, [followUpSeed, followUpWorkflowKey, isPaused, isRunning, isWaiting]);

  const activeFollowUpSeed = useMemo(() => {
    if (!currentWorkflowKey || !followUpWorkflowKey || currentWorkflowKey !== followUpWorkflowKey) return null;
    if (lastRunSeed?.workflowKey === followUpWorkflowKey) return lastRunSeed;
    if (followUpSeed?.workflowKey === followUpWorkflowKey) return followUpSeed;
    return null;
  }, [currentWorkflowKey, followUpSeed, followUpWorkflowKey, lastRunSeed]);

  const addFollowUpFiles = useCallback((incoming: FileList | File[]) => {
    const files = Array.from(incoming || []);
    if (!files.length) return;
    setFollowUpAttachments((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      const next = [...prev];
      for (const f of files) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(f);
      }
      return next;
    });
  }, []);

  const handleFollowUpDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setFollowUpDragActive(true);
  }, []);

  const handleFollowUpDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setFollowUpDragActive(false);
  }, []);

  const handleFollowUpDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setFollowUpDragActive(false);
      if (e.dataTransfer?.files?.length) addFollowUpFiles(e.dataTransfer.files);
    },
    [addFollowUpFiles]
  );

  const handleFollowUpSubmit = useCallback(async () => {
    if (!onFollowUpSubmit) return;
    const message = followUpDraft.trim();
    if (!message) {
      setFollowUpError('Please enter a follow up message.');
      return;
    }
    const seed = activeFollowUpSeed;
    if (!seed) {
      setFollowUpError('Follow Up is only available for the workflow/run that produced this result.');
      return;
    }
    setFollowUpSubmitting(true);
    setFollowUpError(null);
    try {
      await onFollowUpSubmit({
        message,
        attachments: followUpAttachments,
        contextMessages: seed?.messages,
        sessionId: derivedSessionId || undefined,
        threadRootRunId: threadId || rootRunId || undefined,
        inputDataDefaults: startInputDefaults,
      });
      setShowFollowUpModal(false);
      setFollowUpDraft('');
      setFollowUpAttachments([]);
    } catch (e) {
      setFollowUpError(e instanceof Error ? e.message : 'Failed to submit follow up.');
    } finally {
      setFollowUpSubmitting(false);
    }
  }, [
    derivedSessionId,
    activeFollowUpSeed,
    followUpAttachments,
    followUpDraft,
    onFollowUpSubmit,
    rootRunId,
    threadId,
    startInputDefaults,
  ]);

  const copyToClipboard = async (value: unknown) => {
    const text = formatValue(value);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: best-effort legacy copy
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  const outputPreview = useMemo(() => {
    if (resolvedStepOutput == null) return null;
    const value = resolvedStepOutput;

    if (typeof value === 'string') {
      const beautified = beautifyJsonText(value);
      const text = beautified.text.trim();
      return text
        ? {
            previewText: beautified.text,
            previewIsJson: beautified.isJson,
            task: null,
            scratchpad: null,
            raw: value,
            cleaned: value,
          }
        : null;
    }

    if (!value || typeof value !== 'object') {
      const beautified = beautifyJsonText(String(value));
      return {
        previewText: beautified.text,
        previewIsJson: beautified.isJson,
        task: null,
        scratchpad: null,
        raw: value,
        cleaned: value,
      };
    }

	    const obj = value as Record<string, unknown>;

		    let task: string | null = null;
		    let previewText: string | null = null;
		    let previewIsJson = false;
		    let scratchpad: unknown = null;
		    const preferredModelInfo = extractPreferredModelInfo(obj);
		    let provider: string | null = preferredModelInfo.provider || null;
		    let model: string | null = preferredModelInfo.model || null;
		    let usage: unknown = null;
		    let benchmark: Record<string, unknown> | null = null;
		    let subRunId: string | null = null;

    const asRecord = (v: unknown): Record<string, unknown> | null => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return v as Record<string, unknown>;
    };

    const isBenchmarkRecord = (v: unknown): v is Record<string, unknown> => {
      const rec = asRecord(v);
      if (!rec) return false;
      const mode = typeof rec.mode === 'string' ? rec.mode.trim() : '';
      const promptId = typeof rec.prompt_id === 'string' ? rec.prompt_id.trim() : '';
      if (!mode || !promptId) return false;
      return 'metrics' in rec || 'correct' in rec || 'signature' in rec;
    };

    // Many nodes return wrappers (e.g. subflow: { output: { record }, record }).
    // Detect our benchmark record shape so we can show a richer preview.
    benchmark =
      (isBenchmarkRecord(obj) ? obj : null) ||
      (isBenchmarkRecord(obj.record) ? (obj.record as Record<string, unknown>) : null) ||
      (() => {
        const out = asRecord(obj.output);
        const nested = out ? out.record : null;
        return isBenchmarkRecord(nested) ? (nested as Record<string, unknown>) : null;
      })();

    // Agent output shape: { result: { task, result, ... }, scratchpad: ... }
    if (obj.result && typeof obj.result === 'object') {
      const res = obj.result as Record<string, unknown>;
      if (typeof res.task === 'string' && res.task.trim()) task = res.task.trim();
      if (typeof res.content === 'string' && res.content.trim()) previewText = res.content.trim();
      if (!previewText && typeof res.text === 'string' && res.text.trim()) previewText = res.text.trim();
      if (!previewText && typeof res.result === 'string' && res.result.trim()) previewText = res.result.trim();
      if (!previewText && typeof res.message === 'string' && res.message.trim()) previewText = res.message.trim();
      if (!previewText && typeof res.response === 'string' && res.response.trim()) previewText = res.response.trim();
	      if (!provider && typeof res.media_provider === 'string' && res.media_provider.trim()) provider = res.media_provider.trim();
	      if (!model && typeof res.media_model === 'string' && res.media_model.trim()) model = res.media_model.trim();
	      if (!provider && typeof res.provider === 'string' && res.provider.trim()) provider = res.provider.trim();
	      if (!model && typeof res.model === 'string' && res.model.trim()) model = res.model.trim();
	      if ('usage' in res) usage = res.usage;
	    }

    if (!previewText && typeof obj.content === 'string' && obj.content.trim()) previewText = obj.content.trim();
    if (!previewText && typeof obj.text === 'string' && obj.text.trim()) previewText = obj.text.trim();
    if (!previewText && typeof obj.message === 'string' && obj.message.trim()) previewText = obj.message.trim();
    if (!previewText && typeof obj.response === 'string' && obj.response.trim()) previewText = obj.response.trim();
	    if (!previewText && typeof obj.result === 'string' && obj.result.trim()) previewText = obj.result.trim();
    if (!previewText && typeof obj.output === 'string' && obj.output.trim()) previewText = obj.output.trim();
    if (!previewText && obj.output && typeof obj.output === 'object') {
      const outObj = obj.output as Record<string, unknown>;
      if (typeof outObj.content === 'string' && outObj.content.trim()) previewText = outObj.content.trim();
      if (!previewText && typeof outObj.text === 'string' && outObj.text.trim()) previewText = outObj.text.trim();
      if (typeof outObj.output === 'string' && outObj.output.trim()) previewText = outObj.output.trim();
      if (!previewText && typeof outObj.result === 'string' && outObj.result.trim()) previewText = outObj.result.trim();
      if (!previewText && typeof outObj.message === 'string' && outObj.message.trim()) previewText = outObj.message.trim();
      if (!previewText && typeof outObj.response === 'string' && outObj.response.trim()) previewText = outObj.response.trim();
    }
		    if (!provider && typeof obj.media_provider === 'string' && obj.media_provider.trim()) provider = obj.media_provider.trim();
		    if (!model && typeof obj.media_model === 'string' && obj.media_model.trim()) model = obj.media_model.trim();
		    if (!provider && typeof obj.provider === 'string' && obj.provider.trim()) provider = obj.provider.trim();
		    if (!model && typeof obj.model === 'string' && obj.model.trim()) model = obj.model.trim();
	    if (!usage && 'usage' in obj) usage = obj.usage;
	    if (!subRunId && typeof obj.sub_run_id === 'string' && obj.sub_run_id.trim()) subRunId = obj.sub_run_id.trim();

    // Benchmark records store provider/model under `config`.
    if ((!provider || !model) && benchmark) {
      const cfg = asRecord(benchmark.config);
      if (!provider && typeof cfg?.provider === 'string' && cfg.provider.trim()) provider = cfg.provider.trim();
      if (!model && typeof cfg?.model === 'string' && cfg.model.trim()) model = cfg.model.trim();
    }

    // llm_call output shape stores provider/model/usage under `raw`.
    if ((!provider || !model || !usage) && obj.raw && typeof obj.raw === 'object') {
      const raw = obj.raw as Record<string, unknown>;
      if (!provider && typeof raw.provider === 'string' && raw.provider.trim()) provider = raw.provider.trim();
      if (!model && typeof raw.model === 'string' && raw.model.trim()) model = raw.model.trim();
      if (!usage && 'usage' in raw) usage = raw.usage;
    }

    if ('scratchpad' in obj) scratchpad = obj.scratchpad;

    // Agent nodes: infer provider/model from the last llm_call inside scratchpad steps if needed.
    if ((!provider || !model) && scratchpad && typeof scratchpad === 'object') {
      const sp = scratchpad as Record<string, unknown>;
      const steps = Array.isArray(sp.steps) ? sp.steps : [];
      for (let i = steps.length - 1; i >= 0; i--) {
        const st = steps[i];
        if (!st || typeof st !== 'object') continue;
        const stepObj = st as Record<string, unknown>;
        const effect = stepObj.effect && typeof stepObj.effect === 'object' ? (stepObj.effect as Record<string, unknown>) : null;
        const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
        if (effectType !== 'llm_call') continue;

        const payload =
          effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
        if (!provider && typeof payload?.provider === 'string' && payload.provider.trim()) provider = payload.provider.trim();
        if (!model && typeof payload?.model === 'string' && payload.model.trim()) model = payload.model.trim();

        const result = stepObj.result && typeof stepObj.result === 'object' ? (stepObj.result as Record<string, unknown>) : null;
        if (!provider && typeof result?.provider === 'string' && result.provider.trim()) provider = result.provider.trim();
        if (!model && typeof result?.model === 'string' && result.model.trim()) model = result.model.trim();

        if (provider || model) break;
      }
    }

	    // If no previewText yet, fall back to the benchmark raw answer (often contains code fences).
	    if (!previewText && benchmark) {
	      const dbg = asRecord(benchmark.debug);
	      const rawAnswer = dbg && typeof dbg.raw_answer === 'string' ? dbg.raw_answer.trim() : '';
	      if (rawAnswer) previewText = rawAnswer;
	    }

    let cleaned: unknown = value;
    if (obj && typeof obj === 'object') {
      const copy = { ...obj };
      delete (copy as Record<string, unknown>)._pending_effect;
      cleaned = copy;
    }

	    if (previewText) {
	      const beautified = beautifyJsonText(previewText);
	      previewText = beautified.text;
	      previewIsJson = beautified.isJson;
	    } else {
	      // Ensure we always show the received output in a pretty form.
	      try {
	        previewText = JSON.stringify(cleaned, null, 2);
	        previewIsJson = true;
	      } catch {
	        previewText = String(cleaned ?? '');
	        previewIsJson = false;
	      }
	    }

	    if (!task && !previewText && scratchpad == null && !provider && !model && !usage && !benchmark && !subRunId) return null;
	    return { task, previewText, previewIsJson, scratchpad, provider, model, usage, benchmark, subRunId, raw: value, cleaned };
	  }, [beautifyJsonText, resolvedStepOutput, selectedStep]);

  const showGenericOutputPreview = Boolean(outputPreview?.previewText) && !(
    Boolean(generatedImagePreview || generatedAudioPreview) && Boolean(outputPreview?.previewIsJson)
  );
  const isImplicitFlowEndStep = selectedStep?.nodeId === '__implicit_flow_end__';

  const selectedEventIndex = useMemo(() => {
    if (!selectedStep?.id) return null;
    const parts = selectedStep.id.split(':');
    const raw = parts.length > 0 ? parts[parts.length - 1] : '';
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }, [selectedStep?.id]);

  const memorizeContentPreview = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_note') return null;
    if (!selectedStep.nodeId) return null;

    // Prefer the *actual* content wired into the node (full fidelity).
    // The runtime meta `note_preview` is intentionally shortened for observability,
    // so we only use it as a fallback.
    let fallbackPreview: string | null = null;
    const out = selectedStep.output;
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      const obj = out as Record<string, unknown>;
      const raw = obj.raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const rawObj = raw as Record<string, unknown>;
        const results = rawObj.results;
        if (Array.isArray(results) && results.length > 0) {
          const first = results[0];
          if (first && typeof first === 'object') {
            const meta = (first as Record<string, unknown>).meta;
            if (meta && typeof meta === 'object') {
              const notePreview = (meta as Record<string, unknown>).note_preview;
              if (typeof notePreview === 'string' && notePreview.trim()) fallbackPreview = notePreview.trim();
            }
          }
        }
      }
    }

    const targetNodeId = selectedStep.nodeId;
    const edge = edges.find((e) => e.target === targetNodeId && e.targetHandle === 'content');
    if (!edge || !edge.source) return null;

    const sourceNodeId = edge.source;
    const sourceHandle = edge.sourceHandle || '';

    const startAt = Math.max(0, (typeof selectedEventIndex === 'number' ? selectedEventIndex : events.length) - 1);
    for (let i = startAt; i >= 0; i--) {
      const ev = events[i];
      if (ev.type !== 'node_complete') continue;
      const evRunId = getActualRunId(ev);
      if (rootRunId && evRunId && evRunId !== rootRunId) continue;
      if (ev.nodeId !== sourceNodeId) continue;

      const r = ev.result as unknown;
      let value: unknown = r;
      if (sourceHandle && r && typeof r === 'object' && !Array.isArray(r)) {
        value = (r as Record<string, unknown>)[sourceHandle];
      }
      if (value == null) return null;
      const text = typeof value === 'string' ? value : formatValue(value);
      const trimmed = text.trim();
      return trimmed ? trimmed : null;
    }

    // Fallback for pure/literal nodes: no node_complete event exists.
    const srcNode = nodes.find((n) => n.id === sourceNodeId);
    const lv = srcNode?.data?.literalValue;
    if (lv != null) {
      const text = typeof lv === 'string' ? lv : formatValue(lv);
      const trimmed = text.trim();
      return trimmed ? trimmed : null;
    }

    return fallbackPreview;
  }, [edges, events, formatValue, nodes, rootRunId, selectedEventIndex, selectedStep]);

  const recallIntoContextArtifacts = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate') return [];
    const out = selectedStep.output;
    if (!out || typeof out !== 'object' || Array.isArray(out)) return [];
    const obj = out as Record<string, unknown>;
    const artifactsRaw = obj.artifacts;
    const artifacts = Array.isArray(artifactsRaw) ? artifactsRaw : [];
    if (!artifacts.length) return [];

    const entries: Array<{ artifact_id: string; inserted?: number; skipped?: number; preview?: string; error?: string }> = [];
    for (const a of artifacts) {
      if (!a || typeof a !== 'object') continue;
      const ao = a as Record<string, unknown>;
      const artifact_id = typeof ao.artifact_id === 'string' ? ao.artifact_id.trim() : '';
      if (!artifact_id) continue;
      const inserted = typeof ao.inserted === 'number' ? ao.inserted : undefined;
      const skipped = typeof ao.skipped === 'number' ? ao.skipped : undefined;
      const preview = typeof ao.preview === 'string' ? ao.preview : undefined;
      const error = typeof ao.error === 'string' ? ao.error : undefined;
      entries.push({ artifact_id, inserted, skipped, preview, error });
    }
    return entries;
  }, [beautifyJsonText, resolvedStepOutput, selectedStep]);

  const recallIntoContextPreview = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate') return null;
    if (!recallIntoContextArtifacts.length) return null;

    const blocks: string[] = [];
    for (const a of recallIntoContextArtifacts) {
      const preview = typeof a.preview === 'string' ? a.preview.trim() : '';
      if (!preview) continue;
      const title = `**artifact** \`${a.artifact_id}\``;
      blocks.push(`${title}\n${preview}`);
    }
    const text = blocks.join('\n\n').trim();
    return text ? text : null;
  }, [recallIntoContextArtifacts, selectedStep]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate' || !rootRunId) {
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(null);
      setRehydrateArtifactLoading(false);
      return;
    }
    if (!recallIntoContextArtifacts.length) {
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(null);
      setRehydrateArtifactLoading(false);
      return;
    }

    let cancelled = false;
    const artifactIds = recallIntoContextArtifacts.map((a) => a.artifact_id);

    setRehydrateArtifactLoading(true);
    setRehydrateArtifactError(null);
    setRehydrateArtifactMarkdown(null);

    (async () => {
      const fetched = await Promise.all(
        artifactIds.map(async (aid) => {
          return gatewayJson<{ artifact_id: string; payload: unknown }>(
            endpointFromDescriptor(
              artifactMetadataDescriptor,
              '/api/gateway/runs/{run_id}/artifacts/{artifact_id}',
              { run_id: rootRunId, artifact_id: aid }
            )
          );
        })
      );

      const blocks: string[] = [];
      for (const entry of recallIntoContextArtifacts) {
        const found = fetched.find((x) => x && x.artifact_id === entry.artifact_id);
        const payload = found ? found.payload : null;

        const metaLines: string[] = [];
        if (typeof entry.inserted === 'number') metaLines.push(`- inserted: ${entry.inserted}`);
        if (typeof entry.skipped === 'number') metaLines.push(`- skipped: ${entry.skipped}`);
        if (typeof entry.error === 'string' && entry.error.trim()) metaLines.push(`- error: ${entry.error.trim()}`);

        let body = '';
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const obj = payload as Record<string, unknown>;
          const note = typeof obj.note === 'string' ? obj.note : '';
          const messages = Array.isArray(obj.messages) ? obj.messages : null;
          if (note && note.trim()) {
            body = note.trim();
          } else if (messages) {
            const lines: string[] = [];
            for (const m of messages) {
              if (!m || typeof m !== 'object') continue;
              const mo = m as Record<string, unknown>;
              const role = typeof mo.role === 'string' ? mo.role : 'unknown';
              const ts = typeof mo.timestamp === 'string' ? mo.timestamp : '';
              const content = typeof mo.content === 'string' ? mo.content : '';
              const prefix = ts ? `${ts} ${role}: ` : `${role}: `;
              lines.push(prefix + content);
            }
            body = `\`\`\`text\n${lines.join('\n\n')}\n\`\`\``;
          } else {
            body = `\`\`\`json\n${formatValue(payload)}\n\`\`\``;
          }
        } else if (payload != null) {
          body = `\`\`\`json\n${formatValue(payload)}\n\`\`\``;
        }

        const header = `**artifact** \`${entry.artifact_id}\``;
        const block = [header, metaLines.join('\n'), body].filter((s) => s && s.trim()).join('\n\n');
        blocks.push(block);
      }

      const markdown = blocks.join('\n\n---\n\n').trim();
      if (!cancelled) {
        setRehydrateArtifactMarkdown(markdown || null);
        setRehydrateArtifactLoading(false);
      }
    })().catch((e) => {
      if (cancelled) return;
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(e instanceof Error ? e.message : 'Failed to fetch artifacts');
      setRehydrateArtifactLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [artifactMetadataDescriptor, formatValue, isOpen, recallIntoContextArtifacts, rootRunId, selectedStep]);

  const recallIntoContextDisplay = rehydrateArtifactMarkdown || recallIntoContextPreview;

  const onFlowStartParams = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'on_flow_start') return null;
    const out = selectedStep.output;
    if (!out || typeof out !== 'object') return null;
    if (Array.isArray(out)) return null;

    const obj = out as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([k]) => k && k !== 'exec-out' && !k.startsWith('_'));
    if (entries.length === 0) return null;

    const weight = (k: string) => {
      if (k === 'prompt') return 0;
      if (k === 'provider') return 1;
      if (k === 'model') return 2;
      return 10;
    };

    entries.sort((a, b) => {
      const wa = weight(a[0]);
      const wb = weight(b[0]);
      if (wa !== wb) return wa - wb;
      return a[0].localeCompare(b[0]);
    });

    return entries;
  }, [selectedStep]);

  const shouldDefaultRawJsonOpen = useMemo(() => {
    if (!selectedStep || resolvedStepOutput == null) return false;
    const hasPreviewBlocks =
      Boolean(memorizeContentPreview) ||
      Boolean(recallIntoContextDisplay) ||
      Boolean(generatedImagePreview) ||
      Boolean(generatedAudioPreview) ||
      (selectedStep.nodeType === 'on_flow_start' && Boolean(onFlowStartParams)) ||
      Boolean(outputPreview?.task) ||
      Boolean(outputPreview?.benchmark) ||
      Boolean(outputPreview?.previewText) ||
      Boolean(outputPreview?.usage) ||
      Boolean(outputPreview?.provider) ||
      Boolean(outputPreview?.model) ||
      outputPreview?.scratchpad != null;
    return !hasPreviewBlocks;
  }, [generatedAudioPreview, generatedImagePreview, memorizeContentPreview, onFlowStartParams, outputPreview, recallIntoContextDisplay, resolvedStepOutput, selectedStep]);

  const lastRawJsonStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedStep?.id || null;
    if (!id) {
      lastRawJsonStepIdRef.current = null;
      return;
    }
    if (lastRawJsonStepIdRef.current === id) return;
    lastRawJsonStepIdRef.current = id;
    setRawJsonOpen(shouldDefaultRawJsonOpen);
  }, [selectedStep?.id, shouldDefaultRawJsonOpen]);

  const usageBadges = useMemo(() => getUsageBadges(outputPreview?.usage), [outputPreview?.usage]);

  const traceSteps = useMemo(() => {
    const scratchpad = outputPreview?.scratchpad;
    if (!scratchpad || typeof scratchpad !== 'object') return null;
    const stepsRaw = (scratchpad as Record<string, unknown>).steps;
    if (!Array.isArray(stepsRaw)) return null;
    return stepsRaw.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object');
  }, [outputPreview?.scratchpad]);

  const formatTraceTime = (raw: unknown) => {
    const ts = typeof raw === 'string' ? raw : '';
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString();
  };

  const traceStatusLabel = (raw: unknown) => {
    const s = typeof raw === 'string' ? raw : '';
    if (s === 'completed') return 'OK';
    if (s === 'failed') return 'FAILED';
    if (s === 'waiting') return 'WAITING';
    return s ? s.toUpperCase() : 'UNKNOWN';
  };

  const traceStatusInfo = (step: Record<string, unknown>) => {
    const status = typeof step.status === 'string' ? step.status : 'unknown';
    const effect = step.effect && typeof step.effect === 'object' ? (step.effect as Record<string, unknown>) : null;
    const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
    const result = step.result && typeof step.result === 'object' ? (step.result as Record<string, unknown>) : null;
    if (status === 'completed' && effectType === 'model_residency') {
      const residencyStatus = residencyResultStatusInfo(result);
      if (residencyStatus) return residencyStatus;
    }
    return { label: traceStatusLabel(status), className: status };
  };

  const traceEffectSummary = (step: Record<string, unknown>) => {
    const effect = step.effect && typeof step.effect === 'object' ? (step.effect as Record<string, unknown>) : null;
    const effectType = effect && typeof effect.type === 'string' ? effect.type : 'effect';
    const payload = effect && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
    const result = step.result && typeof step.result === 'object' ? (step.result as Record<string, unknown>) : null;
    const wait = step.wait && typeof step.wait === 'object' ? (step.wait as Record<string, unknown>) : null;
    const durationMs = typeof step.duration_ms === 'number' ? step.duration_ms : null;

    if (effectType === 'llm_call') {
      const provider =
        (payload && typeof payload.provider === 'string' ? payload.provider : '') ||
        (result && typeof result.provider === 'string' ? result.provider : '') ||
        '';
      const model =
        (payload && typeof payload.model === 'string' ? payload.model : '') ||
        (result && typeof result.model === 'string' ? result.model : '') ||
        '';

      const usageRaw = result ? result.usage : null;
      const usage = usageRaw && typeof usageRaw === 'object' ? (usageRaw as Record<string, unknown>) : null;
      const inTokens =
        usage && typeof usage.prompt_tokens === 'number'
          ? usage.prompt_tokens
          : usage && typeof usage.input_tokens === 'number'
            ? usage.input_tokens
            : null;
      const outTokens =
        usage && typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : usage && typeof usage.output_tokens === 'number'
            ? usage.output_tokens
            : null;
      const totalTokens = usage && typeof usage.total_tokens === 'number' ? usage.total_tokens : null;

      const toolCallsRaw = result ? result.tool_calls : null;
      const toolCalls = Array.isArray(toolCallsRaw) ? toolCallsRaw.length : null;

      const contentRaw = result ? result.content : null;
      const content = typeof contentRaw === 'string' ? contentRaw.trim() : '';
      const preview = content;

      const tps =
        typeof outTokens === 'number' && outTokens > 0 && typeof durationMs === 'number' && durationMs > 0
          ? outTokens / (durationMs / 1000)
          : null;

      const meta = [
        provider && model ? `${provider}/${model}` : provider || model,
        durationMs != null ? formatDuration(durationMs) : null,
        inTokens != null || outTokens != null ? `${inTokens ?? 0}→${outTokens ?? 0} tk` : null,
        tps != null ? `${tps.toFixed(tps < 10 ? 2 : 1)} tk/s` : null,
        totalTokens != null ? `${totalTokens} total` : null,
        toolCalls != null ? `${toolCalls} tool_calls` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { title: 'LLM_CALL', meta, preview };
    }

    if (effectType === 'tool_calls') {
      const callsRaw = payload ? payload.tool_calls : null;
      const calls = Array.isArray(callsRaw) ? callsRaw : [];
      const names = calls
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).name : null))
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n) => n.trim());
      const uniqueNames = Array.from(new Set(names));

      const resultsRaw = result ? result.results : null;
      const results = Array.isArray(resultsRaw) ? resultsRaw : [];
      const okCount = results.filter((r) => r && typeof r === 'object' && (r as Record<string, unknown>).success === true).length;
      const failCount = results.filter((r) => r && typeof r === 'object' && (r as Record<string, unknown>).success === false).length;

      let preview = '';
      const first = results.find((r) => r && typeof r === 'object') as Record<string, unknown> | undefined;
      if (first) {
        const success = first.success === true;
        const rawOut = success ? first.output : (first.error ?? first.output);
        if (rawOut != null) {
          const text = typeof rawOut === 'string' ? rawOut : (() => {
            try {
              return JSON.stringify(rawOut);
            } catch {
              return String(rawOut);
            }
          })();
          preview = text;
        }
      }

      const meta = [
        durationMs != null ? formatDuration(durationMs) : null,
        uniqueNames.length ? uniqueNames.join(', ') : null,
        results.length ? `${okCount} ok${failCount ? ` · ${failCount} failed` : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { title: 'TOOL_CALLS', meta, preview };
    }

    if (effectType === 'model_residency') {
      const operation =
        (payload && typeof payload.operation === 'string' ? payload.operation : '') ||
        (result && typeof result.operation === 'string' ? result.operation : '') ||
        'model_residency';
      const task =
        (payload && typeof payload.task === 'string' ? payload.task : '') ||
        (result && typeof result.task === 'string' ? result.task : '') ||
        '';
      const provider =
        (payload && typeof payload.provider === 'string' ? payload.provider : '') ||
        (result && typeof result.provider === 'string' ? result.provider : '') ||
        '';
      const model =
        (payload && typeof payload.model === 'string' ? payload.model : '') ||
        (result && typeof result.model === 'string' ? result.model : '') ||
        '';
      const modelsRaw = result ? result.models : null;
      const modelCount = Array.isArray(modelsRaw) ? modelsRaw.length : null;
      const loadedNew = result && typeof result.loaded_new === 'boolean' ? result.loaded_new : null;
      const unloaded = result && typeof result.unloaded === 'boolean' ? result.unloaded : null;
      const error = result && typeof result.error === 'string' ? result.error : '';
      const warningsRaw = result ? result.warnings : null;
      const warnings = Array.isArray(warningsRaw) ? warningsRaw.filter((x): x is string => typeof x === 'string') : [];
      const meta = [
        operation,
        task,
        provider && model ? `${provider}/${model}` : provider || model,
        modelCount != null ? `${modelCount} loaded` : null,
        loadedNew != null ? (loadedNew ? 'loaded new' : 'already loaded') : null,
        unloaded != null ? (unloaded ? 'unloaded' : 'not resident') : null,
        durationMs != null ? formatDuration(durationMs) : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { title: 'MODEL_RESIDENCY', meta, preview: error || warnings[0] || '' };
    }

    if (effectType === 'ask_user') {
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt : typeof wait?.prompt === 'string' ? wait.prompt : '';
      const text = prompt.trim();
      const preview = text;
      return { title: 'ASK_USER', meta: '', preview };
    }

    return { title: String(effectType).toUpperCase(), meta: '', preview: '' };
  };

  const submitResume = () => {
    const response = resumeDraft.trim();
    if (!response) return;
    onResume?.(response);
  };

  if (!isOpen) return null;

  return isMinimized ? minibar : (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal run-modal${isMaximized ? ' run-modal-maximized' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="run-modal-header">
          <div className="run-modal-header-left">
            <h3>▶ Run Flow</h3>
            <span className="run-modal-flow-name">{flowName || 'Untitled Flow'}</span>
          </div>
          <div className="run-modal-header-right">
            {flowId && onSelectRunId ? (
              <RunSwitcherDropdown
                workflowId={flowId}
                currentRunId={rootRunId}
                gatewayContracts={gatewayContracts}
                onSelectRun={onSelectRunId}
              />
            ) : null}
            <button
              type="button"
              className="run-minimize-btn"
              onClick={() => setIsMinimized(true)}
              title="Minimize"
              aria-label="Minimize run modal"
            >
              <MinimizeWindowIcon />
            </button>
            <button
              type="button"
              className="run-maximize-btn"
              onClick={() => setIsMaximized((v) => !v)}
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore run modal size' : 'Maximize run modal'}
            >
              {isMaximized ? <RestoreWindowIcon /> : <MaximizeWindowIcon />}
            </button>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div className="run-modal-body">
          {/* Execution (Steps + Details) */}
          {hasRunData && (
            <div className="run-modal-execution">
            <div className="run-steps">
              <div className="run-steps-header">
                <div className="run-steps-title">Execution</div>
                <div className="run-steps-subtitle">
                  {isRunning ? <span className="run-spinner" aria-label="running" /> : null}
                  {runStatusLabel}
                  {flowSummary ? (
                    <span className="run-metrics-inline">
                      {formatDuration(flowSummary.duration_ms) ? (
                        <span className="run-metric-badge metric-duration">{formatDuration(flowSummary.duration_ms)}</span>
                      ) : null}
                      {formatTokenBadge(flowSummary) ? (
                        <span className="run-metric-badge metric-tokens">{formatTokenBadge(flowSummary)}</span>
                      ) : null}
                      {formatTpsBadge(flowSummary) ? (
                        <span className="run-metric-badge metric-throughput">{formatTpsBadge(flowSummary)}</span>
                      ) : null}
                    </span>
                  ) : null}
                  {benchmarkProgress && benchmarkProgress.totalRecords > 0 ? (
                    <span className="run-metrics-inline">
                      <span className="run-metric-badge metric-benchmark" title="Completed benchmark sub-runs">
                        Bench {benchmarkProgress.completedRecords}/{benchmarkProgress.totalRecords}
                      </span>
                      {benchmarkProgress.runsLoop ? (
                        <span className="run-metric-badge metric-benchmark" title="Run preset">
                          run {Math.min(benchmarkProgress.runsLoop.index + 1, benchmarkProgress.runsLoop.total)}/{benchmarkProgress.runsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.promptsLoop ? (
                        <span
                          className="run-metric-badge metric-benchmark"
                          title={
                            benchmarkProgress.promptLabel
                              ? `${benchmarkProgress.promptId || 'prompt'} — ${benchmarkProgress.promptLabel}`
                              : (benchmarkProgress.promptId || 'System prompt')
                          }
                        >
                          {(benchmarkProgress.promptId || 'prompt')}{' '}
                          {Math.min(benchmarkProgress.promptsLoop.index + 1, benchmarkProgress.promptsLoop.total)}/{benchmarkProgress.promptsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.repeatsLoop ? (
                        <span className="run-metric-badge metric-benchmark" title="Repeat">
                          rep {Math.min(benchmarkProgress.repeatsLoop.index + 1, benchmarkProgress.repeatsLoop.total)}/{benchmarkProgress.repeatsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.etaMs != null ? (
                        <span className="run-metric-badge metric-duration" title="ETA (rough; based on average sub-run duration)">
                          ETA {formatDuration(benchmarkProgress.etaMs)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>

              {flowWarnings.length > 0 ? (
                <div className="run-warnings-panel">
                  <div className="run-warnings-title">Warnings</div>
                  <div className="run-warnings-list">
                    {flowWarnings.slice(0, 5).map((w, idx) => (
                      <div key={w || idx} className="run-warnings-item" title={w}>
                        {w}
                      </div>
                    ))}
                    {flowWarnings.length > 5 ? (
                      <div className="run-warnings-more">+{flowWarnings.length - 5} more warnings</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {failureSummary.length > 0 ? (
                <div className="run-failures-panel">
                  <div className="run-failures-title">Failures detected</div>
                  <div className="run-failures-list">
                    {failureSummary.slice(0, 5).map(({ step, snippet, shortRunId }) => (
                      <button
                        key={step.id}
                        type="button"
                        className="run-failures-item"
                        onClick={() => setSelectedStepId(step.id)}
                        title={step.error || snippet}
                      >
                        <span className="run-failures-node">{step.nodeLabel || step.nodeId || 'node'}</span>
                        {shortRunId ? <span className="run-failures-run">run:{shortRunId}</span> : null}
                        <span className="run-failures-error">{snippet}</span>
                      </button>
                    ))}
                    {failureSummary.length > 5 ? (
                      <div className="run-failures-more">+{failureSummary.length - 5} more failures</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="run-steps-list">
                {displayStepTree.length === 0 ? (
                  <div className="run-steps-empty">No execution events yet.</div>
                ) : (
                  (() => {
                    const renderNodes = (nodes: StepTreeNode[]): Array<JSX.Element | null> => {
                      return nodes.map((n, idx) => {
                        const s = displayStepById.get(n.stepId);
                        if (!s) return null;

                        const selected = s.id === selectedStepId;
                        const color = s.nodeColor || '#888888';
                        const bg = hexToRgba(color, 0.12);
                        const waitReason = typeof s.waiting?.reason === 'string' ? s.waiting.reason.toLowerCase() : '';
                        const isSubworkflowWait = waitReason === 'subworkflow';
                        const statusInfo =
                          s.status === 'running'
                            ? { label: 'RUNNING', className: 'running' }
                            : s.status === 'completed'
                              ? s.nodeType === 'model_residency'
                                ? residencyResultStatusInfo(s.output) || { label: 'OK', className: 'completed' }
                                : { label: 'OK', className: 'completed' }
                              : s.status === 'waiting'
                                ? isSubworkflowWait
                                  ? { label: 'RUNNING', className: 'running' }
                                  : { label: 'WAITING', className: 'waiting' }
                                : { label: 'FAILED', className: 'failed' };
                        const startedAtLabel = formatStepTime(s.startedAt);
                        const durationLabel =
                          s.status === 'completed' && s.metrics && s.metrics.duration_ms != null
                            ? formatDuration(s.metrics.duration_ms)
                            : '';

                        const hasChildren = Array.isArray(n.children) && n.children.length > 0;
                        const hasSequenceBranches = Array.isArray(n.sequenceBranches) && n.sequenceBranches.length > 0;
                        const hasNestedContent = hasChildren || hasSequenceBranches;
                        const expanded = hasNestedContent && expandedSubflows[s.id] === true;
                        const depth = typeof n.depth === 'number' && n.depth > 0 ? n.depth : 0;

                        return (
                          <div key={s.id} className="run-step-tree-item">
                            <button
                              type="button"
                              className={selected ? 'run-step selected' : 'run-step'}
                              onClick={() => setSelectedStepId(s.id)}
                            >
                              <div className="run-step-border" style={{ background: color }} />
                              <div className="run-step-main">
                                <div className="run-step-top">
                                  <div className="run-step-left">
                                    {hasNestedContent ? (
                                      <span
                                        className="run-step-toggle"
                                        title={
                                          hasSequenceBranches
                                            ? expanded
                                              ? 'Collapse sequence paths'
                                              : 'Expand sequence paths'
                                            : expanded
                                              ? 'Collapse subflow steps'
                                              : 'Expand subflow steps'
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSubflowExpansion(s.id);
                                        }}
                                      >
                                        {expanded ? '▾' : '▸'}
                                      </span>
                                    ) : null}
                                    <span className="run-step-index">#{idx + 1}</span>
                                    {s.nodeIcon ? (
                                      <span
                                        className="run-step-icon"
                                        style={{ color }}
                                        dangerouslySetInnerHTML={{ __html: s.nodeIcon }}
                                      />
                                    ) : null}
                                    <span className="run-step-label">{s.nodeLabel || s.nodeId || 'node'}</span>
                                  </div>
                                  <span className="run-step-right">
                                    <span className={`run-step-status ${statusInfo.className}`}>
                                      {s.status === 'running' ? <span className="run-spinner" aria-label="running" /> : null}
                                      {statusInfo.label}
                                    </span>
                                    {durationLabel ? (
                                      <span className="run-metric-badge metric-duration" title="Duration">
                                        {durationLabel}
                                      </span>
                                    ) : null}
                                    {startedAtLabel ? (
                                      <span className="run-step-time" title={`Started at ${startedAtLabel}`}>
                                        {startedAtLabel}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                                <div className="run-step-meta">
                                  <span className="run-step-type" style={{ background: bg, borderColor: color }}>
                                    {s.nodeType || 'node'}
                                  </span>
                                  {depth > 0 ? <span className="run-metric-badge metric-depth">d{depth}</span> : null}
                                  {s.provider ? <span className="run-metric-badge metric-provider">{s.provider}</span> : null}
                                  {s.model ? <span className="run-metric-badge metric-model">{s.model}</span> : null}
                                  {stepArtifactPreviewById.get(s.id) ? (
                                    <span
                                      className="run-metric-badge metric-artifact"
                                      title={`Artifact ${stepArtifactPreviewById.get(s.id)?.artifactId}`}
                                    >
                                      {stepArtifactPreviewById.get(s.id)?.kind}
                                    </span>
                                  ) : null}
                                  {s.nodeId ? <span className="run-step-id">{s.nodeId}</span> : null}
                                  {s.status === 'completed' && s.metrics ? (
                                    <span className="run-step-metrics">
                                      {formatTokenBadge(s.metrics) ? (
                                        <span className="run-metric-badge metric-tokens">{formatTokenBadge(s.metrics)}</span>
                                      ) : null}
                                      {formatTpsBadge(s.metrics) ? (
                                        <span className="run-metric-badge metric-throughput">{formatTpsBadge(s.metrics)}</span>
                                      ) : null}
                                    </span>
                                  ) : null}
                                </div>
                                {s.status === 'failed' && s.error ? (
                                  <div className="run-step-error">{s.error}</div>
                                ) : s.waiting && isSubworkflowWait ? (
                                  <div className="run-step-waiting">
                                    {s.nodeType === 'agent' ? 'agent running · subworkflow' : 'subflow running'}
                                  </div>
                                ) : s.status === 'waiting' && s.waiting ? (
                                  <div className="run-step-waiting">
                                    {s.waiting.reason ? `waiting · ${s.waiting.reason}` : 'waiting'}
                                    {s.waiting.prompt ? ` · ${s.waiting.prompt}` : ''}
                                  </div>
                                ) : s.status === 'completed' && s.summary ? (
                                  <div className="run-step-summary">{s.summary}</div>
                                ) : null}
                              </div>
                            </button>

                            {hasSequenceBranches && expanded ? (
                              <div className="run-sequence-branches">
                                {(n.sequenceBranches || []).map((branch) => (
                                  <div key={branch.key} className="run-sequence-branch">
                                    {branch.nodes.length > 0 ? (
                                      <div className="run-sequence-branch-body">{renderNodes(branch.nodes)}</div>
                                    ) : (
                                      <div className="run-sequence-branch-empty">Pending…</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {hasChildren && expanded ? (
                              <div className="run-step-children">{renderNodes(n.children)}</div>
                            ) : null}
                          </div>
                        );
                      });
                    };

                    return renderNodes(displayStepTree);
                  })()
                )}
              </div>
            </div>

            <div className="run-details">
              <div className="run-details-header">
                <div className="run-details-title">
                  {selectedStep ? selectedStep.nodeLabel || selectedStep.nodeId || 'Step' : 'Details'}
                </div>
                {selectedStep?.nodeType ? (
                  <div className="run-details-header-badges">
                    {selectedStep.provider ? <span className="run-metric-badge metric-provider">{selectedStep.provider}</span> : null}
                    {selectedStep.model ? <span className="run-metric-badge metric-model">{selectedStep.model}</span> : null}
                    {selectedDurationLabel ? (
                      <span className="run-metric-badge metric-duration" title="Duration">
                        {selectedDurationLabel}
                      </span>
                    ) : null}
                    {selectedResidencyResultStatus ? (
                      <span className="run-metric-badge metric-status" title={selectedResidencyResultStatus.title}>
                        {selectedResidencyResultStatus.label}
                      </span>
                    ) : null}
                    {parentRunId && onSelectRunId ? (
                      <button
                        type="button"
                        className="run-details-parent-link"
                        onClick={() => onSelectRunId(parentRunId)}
                        title={`Back to parent run: ${parentRunId}`}
                      >
                        Main flow
                      </button>
                    ) : null}
                    <span
                      className="run-details-type"
                      style={{
                        borderColor: selectedStep.nodeColor || '#888888',
                        background: hexToRgba(selectedStep.nodeColor || '#888888', 0.12),
                      }}
                    >
                      {selectedStep.nodeType}
                    </span>
                  </div>
                ) : null}
              </div>

		              {selectedStep ? (
		                <div className={detailsBodyClass}>
                      {selectedResidencyResultStatus ? (
                        <div className="run-waiting">
                          <div className="run-waiting-prompt">
                            {selectedResidencyResultStatus.message}
                          </div>
                        </div>
                      ) : null}
		                  {selectedStep.status === 'running' ? (
		                    <>
		                      <div className="run-working">
	                        <span className="run-spinner" aria-label="working" />
	                        <div>
	                          <div className="run-working-title">{runningTitle}</div>
	                          <div className="run-working-note">{runningNote}</div>
	                        </div>
	                      </div>
	                      {subflowTracePanel}
	                      {agentTracePanel}
	                    </>
                  ) : showWaitingPanel ? (
                    isSubworkflowWait ? (
                      <div className="run-waiting">
                        <div className="run-waiting-prompt">
                          Waiting on subworkflow... No input required.
                        </div>
                      </div>
                    ) : isToolApprovalWait ? (
                      <div className="run-waiting">
                        <div className="run-waiting-prompt">
                          Tool approval pending. Review details in the footer.
                        </div>
                      </div>
                    ) : (
                      <div className="run-waiting">
                        <div className="run-waiting-prompt">
                          <MarkdownRenderer
                            markdown={(waitingPayload?.prompt || 'Please respond:').trim()}
                          />
                        </div>

                        {waitingPayload?.choices?.length ? (
                          <div className="run-waiting-choices">
                            {(waitingPayload?.choices || []).map((c) => (
                              <button
                                key={c}
                                type="button"
                                className="run-waiting-choice"
                                onClick={() => onResume?.(c)}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {(waitingPayload?.allowFreeText ?? true) && (
                          <div className="run-waiting-input">
                            <textarea
                              className="run-waiting-textarea"
                              value={resumeDraft}
                              onChange={(e) => setResumeDraft(e.target.value)}
                              placeholder="Type your response…"
                              rows={3}
                            />
                            <div className="run-waiting-actions">
                              <button
                                type="button"
                                className="modal-button primary"
                                onClick={submitResume}
                                disabled={!resumeDraft.trim()}
                              >
                                Continue
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  ) : selectedStep.status === 'failed' && selectedStep.error ? (
                    <div className="run-details-error">{selectedStep.error}</div>
                  ) : resolvedStepOutput != null ? (
                    <>
                      {subflowTracePanel}
                      {agentTracePanel}
                      {showMetricsBlock ? (
                        <div className="run-details-metrics">
                          {tokenBadge ? (
                            <div className="run-details-metrics-row">
                              <span className="run-details-metrics-label">Tokens</span>
                              <span className="run-details-metrics-value">{tokenBadge}</span>
                            </div>
                          ) : null}
                          {tpsBadge ? (
                            <div className="run-details-metrics-row">
                              <span className="run-details-metrics-label">Throughput</span>
                              <span className="run-details-metrics-value">{tpsBadge}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
	                      <div className="run-details-actions">
	                        <button type="button" className="modal-button" onClick={() => copyToClipboard(resolvedStepOutput)}>
	                          Copy raw
	                        </button>
	                        {outputPreview?.subRunId && onSelectRunId ? (
	                          <button
	                            type="button"
	                            className="modal-button"
	                            onClick={() => onSelectRunId(outputPreview.subRunId ?? '')}
	                            title="Open the subflow run in the run switcher"
	                          >
	                            Open sub-run
	                          </button>
	                        ) : null}
	                        {memorizeContentPreview ? (
	                          <button type="button" className="modal-button" onClick={() => copyToClipboard(memorizeContentPreview)}>
	                            Copy content
	                          </button>
	                        ) : null}
                        {showGenericOutputPreview && outputPreview?.previewText ? (
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(outputPreview.previewText)}>
                            Copy preview
                          </button>
                        ) : null}
                        {outputPreview?.scratchpad != null ? (
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(outputPreview.scratchpad)}>
                            Copy trace
                          </button>
                        ) : null}
                      </div>

                      {(outputPreview ||
                        memorizeContentPreview ||
                        recallIntoContextDisplay ||
                        generatedImagePreview ||
                        generatedAudioPreview ||
                        (selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams) ||
                        (selectedStep?.nodeType === 'memory_kg_query' && selectedStep.output != null)) ? (
                        <div className="run-output-preview">
                          {selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Run parameters</div>
                              <div className="run-param-grid">
                                {onFlowStartParams.map(([k, v]) => {
                                  const isProvider = k === 'provider' && typeof v === 'string' && v.trim();
                                  const isModel = k === 'model' && typeof v === 'string' && v.trim();
                                  const isPrompt = k === 'prompt' && typeof v === 'string' && v.trim();
                                  const isSessionId = k === 'sessionId' && typeof v === 'string' && v.trim();
                                  const isWorkspaceRoot = k === 'workspace_root' && typeof v === 'string' && v.trim();

                                  return (
                                    <div key={k} className="run-param-row">
                                      <div className="run-param-key">{k}</div>
                                      <div className="run-param-val">
                                        {isProvider ? (
                                          <span className="run-metric-badge metric-provider">{String(v).trim()}</span>
                                        ) : isModel ? (
                                          <span className="run-metric-badge metric-model">{String(v).trim()}</span>
                                        ) : isSessionId ? (
                                          <div className="run-param-inline">
                                            <span className="run-param-text">{String(v)}</span>
                                            <button
                                              type="button"
                                              className="run-param-copy"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void copyToClipboard(v);
                                              }}
                                              title="Copy session id"
                                              aria-label="Copy session id"
                                            >
                                              ⧉
                                            </button>
                                          </div>
                                        ) : isWorkspaceRoot ? (
                                          <div className="run-param-inline">
                                            <button
                                              type="button"
                                              className="run-param-link"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void copyToClipboard(v);
                                              }}
                                              title="Copy workspace path (server-side)"
                                              aria-label="Copy workspace path"
                                            >
                                              {String(v)}
                                            </button>
                                            <button
                                              type="button"
                                              className="run-param-copy"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void copyToClipboard(v);
                                              }}
                                              title="Copy workspace path"
                                              aria-label="Copy workspace path"
                                            >
                                              ⧉
                                            </button>
                                          </div>
                                        ) : typeof v === 'boolean' ? (
                                          <span className="run-metric-badge metric-bool">{v ? 'true' : 'false'}</span>
                                        ) : typeof v === 'number' ? (
                                          <span className="run-metric-badge metric-number">{String(v)}</span>
                                        ) : isPrompt ? (
                                          <div className="run-details-markdown run-param-markdown">
                                            <MarkdownRenderer markdown={String(v).trim()} />
                                          </div>
                                        ) : typeof v === 'string' ? (
                                          <span className="run-param-text">{v}</span>
                                        ) : (
                                          <JsonViewer value={v} className="run-param-json" />
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_note' ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Memorized content</div>
                              {memorizeContentPreview ? (
                                <div className="run-details-markdown run-param-markdown">
                                  <MarkdownRenderer markdown={memorizeContentPreview} />
                                </div>
                              ) : (
                                <div className="run-details-empty">No preview available.</div>
                              )}
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_rehydrate' ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Recalled content</div>
                              {rehydrateArtifactLoading ? (
                                <div className="run-details-empty">Loading recalled content…</div>
                              ) : rehydrateArtifactError ? (
                                <div className="run-details-error">{rehydrateArtifactError}</div>
                              ) : recallIntoContextDisplay ? (
                                <div className="run-details-markdown run-param-markdown">
                                  <MarkdownRenderer markdown={recallIntoContextDisplay} />
                                </div>
                              ) : (
                                <div className="run-details-empty">No preview available.</div>
                              )}
                            </div>
                          ) : null}

                          {generatedImagePreview ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Generated image</div>
                              <GeneratedImageCard preview={generatedImagePreview} />
                            </div>
                          ) : null}

                          {generatedAudioPreview ? (
                            <div className="run-output-section">
                              <div className="run-output-title">
                                {selectedStep?.nodeType === 'generate_music' ? 'Generated music' : 'Generated audio'}
                              </div>
                              <GeneratedAudioCard preview={generatedAudioPreview} autoPlay />
                            </div>
                          ) : null}

                          {outputPreview?.task ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Task</div>
                              <pre className="run-details-output">{outputPreview.task}</pre>
                            </div>
                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            <div className="run-output-section">
	                              <div className="run-output-title">Benchmark</div>
	                              <div className="run-output-meta">
                                <div>
                                  <span className="run-output-meta-key">Mode</span>
                                  <span className="run-output-meta-val">{String(outputPreview.benchmark.mode ?? '')}</span>
                                </div>
                                <div>
                                  <span className="run-output-meta-key">Prompt</span>
                                  <span className="run-output-meta-val">
                                    {String(outputPreview.benchmark.prompt_id ?? '')}
                                    {outputPreview.benchmark.prompt_label ? ` — ${String(outputPreview.benchmark.prompt_label)}` : ''}
                                  </span>
                                </div>
	                                {outputPreview.benchmark.repeat != null ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Repeat</span>
	                                    <span className="run-output-meta-val">{String(outputPreview.benchmark.repeat)}</span>
	                                  </div>
	                                ) : null}
	                                {outputPreview.subRunId ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Sub-run</span>
	                                    <span className="run-output-meta-val">{outputPreview.subRunId}</span>
	                                  </div>
	                                ) : null}
	                                {typeof outputPreview.benchmark.correct === 'boolean' ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Correct</span>
	                                    <span className="run-output-meta-val">{outputPreview.benchmark.correct ? 'true' : 'false'}</span>
	                                  </div>
	                                ) : null}
                                {Array.isArray(outputPreview.benchmark.issues) && outputPreview.benchmark.issues.length ? (
                                  <div>
                                    <span className="run-output-meta-key">Issues</span>
                                    <span className="run-output-meta-val">{outputPreview.benchmark.issues.join(', ')}</span>
                                  </div>
                                ) : null}
                                {typeof outputPreview.benchmark.signature === 'string' && outputPreview.benchmark.signature.trim() ? (
                                  <div>
                                    <span className="run-output-meta-key">Signature</span>
                                    <span className="run-output-meta-val">{outputPreview.benchmark.signature}</span>
                                  </div>
                                ) : null}
                                {(() => {
                                  const metrics =
                                    outputPreview.benchmark && typeof outputPreview.benchmark.metrics === 'object'
                                      ? (outputPreview.benchmark.metrics as Record<string, unknown>)
                                      : null;
                                  const stopReason = metrics && typeof metrics.stop_reason === 'string' ? metrics.stop_reason : null;
                                  return stopReason ? (
                                    <div>
                                      <span className="run-output-meta-key">Stop</span>
                                      <span className="run-output-meta-val">{stopReason}</span>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            (() => {
	                              const modelOutput = outputPreview.benchmark.model_output ?? outputPreview.benchmark.output;
	                              if (modelOutput == null) return null;
	                              return (
	                                <div className="run-output-section">
	                                  <div className="run-output-title">Model output</div>
	                                  <JsonViewer value={modelOutput} />
	                                </div>
	                              );
	                            })()
	                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            (() => {
	                              const dbg =
	                                outputPreview.benchmark.debug && typeof outputPreview.benchmark.debug === 'object' && !Array.isArray(outputPreview.benchmark.debug)
	                                  ? (outputPreview.benchmark.debug as Record<string, unknown>)
	                                  : null;
	                              const rawAnswer = dbg && typeof dbg.raw_answer === 'string' ? dbg.raw_answer.trim() : '';
	                              if (!rawAnswer) return null;
	                              return (
	                                <div className="run-output-section">
	                                  <div className="run-output-title">Raw answer</div>
	                                  <div className="run-details-markdown">
	                                    <MarkdownRenderer markdown={rawAnswer} />
	                                  </div>
	                                </div>
	                              );
	                            })()
	                          ) : null}

	                          {outputPreview?.benchmark && outputPreview.benchmark.expected != null ? (
	                            <details className="run-raw-details">
	                              <summary>Expected</summary>
	                              <JsonViewer value={outputPreview.benchmark.expected} />
	                            </details>
	                          ) : null}

                          {outputPreview?.benchmark && outputPreview.benchmark.metrics != null ? (
                            <details className="run-raw-details">
                              <summary>Metrics</summary>
                              <JsonViewer value={outputPreview.benchmark.metrics} />
                            </details>
                          ) : null}

                          {outputPreview?.benchmark && outputPreview.benchmark.debug != null ? (
                            <details className="run-raw-details">
                              <summary>Debug</summary>
                              <JsonViewer value={outputPreview.benchmark.debug} />
                            </details>
                          ) : null}

                          {(outputPreview?.provider || outputPreview?.model || outputPreview?.usage) ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Meta</div>
                              <div className="run-output-meta">
                                {(outputPreview?.provider || outputPreview?.model) ? (
                                  <div>
                                    <span className="run-output-meta-key">Model</span>
                                    <span className="run-output-meta-val">
                                      <span className="run-output-meta-badges">
                                        {outputPreview?.provider ? (
                                          <span className="run-metric-badge metric-provider">{outputPreview.provider}</span>
                                        ) : null}
                                        {outputPreview?.model ? (
                                          <span className="run-metric-badge metric-model">{outputPreview.model}</span>
                                        ) : null}
                                      </span>
                                    </span>
                                  </div>
                                ) : null}
                                {outputPreview?.usage ? (
                                  <div>
                                    <span className="run-output-meta-key">Usage</span>
                                    <div className="run-output-meta-val">
                                      {usageBadges.length ? (
                                        <span className="run-output-meta-badges">
                                          {usageBadges.map((b) => (
                                            <span key={b.label} className="run-metric-badge metric-tokens">
                                              {b.label}: {b.value}
                                            </span>
                                          ))}
                                        </span>
                                      ) : (
                                        <JsonViewer value={outputPreview.usage} className="run-output-meta-json" />
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {showGenericOutputPreview && outputPreview?.previewText ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Preview</div>
                              {outputPreview.previewIsJson ? (
                                <JsonViewer value={outputPreview.previewText} collapseAfterDepth={6} />
                              ) : shouldRenderMarkdown(selectedStep?.nodeType) ? (
                                <div className="run-details-markdown">
                                  <MarkdownRenderer markdown={outputPreview.previewText} />
                                </div>
                              ) : (
                                <pre className="run-details-output">{outputPreview.previewText}</pre>
                              )}
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_kg_query' && selectedStep.output != null && kgMemoryAvailable ? (
                            <div className="run-output-section">
                              <div className="run-output-title">KG / Active Memory Explorer</div>
                              <KgActiveMemoryPanel
                                runId={rootRunId || null}
                                title={selectedStep.nodeLabel || selectedStep.nodeId || 'KG'}
                                output={selectedStep.output}
                                queryEndpoint={kgMemoryDescriptor}
                              />
                            </div>
                          ) : null}

                          {/* Agent nodes have a dedicated live trace panel (AgentSubrunTracePanel) fed by trace_update events.
                              The legacy Trace/Scratchpad section is redundant for agents and can be confusing. */}
                          {selectedStep?.nodeType !== 'agent' && traceSteps ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Trace</div>
                              <div className="run-trace">
                                {traceSteps.map((t, idx) => {
                                  const statusInfo = traceStatusInfo(t);
                                  const summary = traceEffectSummary(t);
                                  return (
                                    <div key={idx} className={`run-trace-step ${statusInfo.className}`}>
                                      <div className="run-trace-top">
                                        <span className={`run-trace-status ${statusInfo.className}`}>{statusInfo.label}</span>
                                        <span className="run-trace-effect">{summary.title}</span>
                                        {summary.meta ? <span className="run-trace-meta">{summary.meta}</span> : null}
                                        <span className="run-trace-time">{formatTraceTime(t.ts)}</span>
                                      </div>
                                      {summary.preview ? <div className="run-trace-preview">{summary.preview}</div> : null}
                                    </div>
                                  );
                                })}
                              </div>

                              <details className="run-raw-details">
                                <summary>Trace JSON</summary>
                                <JsonViewer value={outputPreview?.scratchpad} />
                              </details>
                            </div>
                          ) : selectedStep?.nodeType !== 'agent' && outputPreview?.scratchpad != null ? (
                            <details className="run-raw-details">
                              <summary>Scratchpad</summary>
                              <JsonViewer value={outputPreview?.scratchpad} />
                            </details>
                          ) : null}
                        </div>
                      ) : null}

                      <details
                        className="run-raw-details"
                        open={rawJsonOpen}
                        onToggle={(e) => setRawJsonOpen((e.currentTarget as HTMLDetailsElement).open)}
                      >
                        <summary>Debug JSON</summary>
                        {rawJsonOpen ? (
                          <JsonViewer key={selectedStep.id} value={resolvedStepOutput} collapseAfterDepth={99} />
                        ) : null}
                      </details>
                    </>
                  ) : isImplicitFlowEndStep ? (
                    <>
                      {subflowTracePanel}
                      {agentTracePanel}
                      {runArtifactSummary.length === 0 ? (
                        <div className="run-details-empty">Workflow completed. No artifacts were produced.</div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {subflowTracePanel}
                      {agentTracePanel}
                      <div className="run-details-empty">No output for this step.</div>
                    </>
                  )}

                  {showRunArtifactSummary ? (
                    <div className="run-output-section">
                      <div className="run-output-title">Artifacts created</div>
                      <div className="run-generated-artifact-grid">
                        {runArtifactSummary.map((item) => (
                          <div className="run-generated-artifact-item" key={`${item.kind}:${item.preview.artifactId}`}>
                            <div className="run-output-meta-badges">
                              <span className="run-metric-badge">{item.kind}</span>
                              <span className="run-metric-badge metric-provider">{item.stepLabel}</span>
                              {item.kind === 'text' ? (
                                <button
                                  type="button"
                                  className="run-artifact-copy"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyToClipboard(item.preview.text);
                                  }}
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                            {item.kind === 'image' ? (
                              <GeneratedImageCard preview={item.preview} compact />
                            ) : item.kind === 'audio' ? (
                              <GeneratedAudioCard preview={item.preview} compact />
                            ) : (
                              <GeneratedTextCard preview={item.preview} compact />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {showFinalResult && effectiveResult ? (
                    <div className="run-final">
                      <div className={`run-final-header ${effectiveResult.success ? 'success' : 'error'}`}>
                        <span className="run-final-title">
                          {effectiveResult.success ? 'Final Result (SUCCESS)' : 'Final Result (FAILED)'}
                        </span>
                        <div className="run-details-actions">
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => copyToClipboard(effectiveResult.error ?? effectiveResult.result)}
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      {effectiveResult.error ? (
                        <div className="run-details-error">{effectiveResult.error}</div>
                      ) : (
                        <JsonViewer value={effectiveResult.result} />
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="run-details-body">
                  <div className="run-details-empty">Select a step to inspect outputs.</div>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Input form */}
          {!hasRunData && !result && (
            <>
              {entryNode ? (
                <div className="run-form">
                  <div className="run-form-fields">

                    {/* Card 1: File System Access (collapsible) */}
                    <details className="run-form-section run-form-filesystem">
                      <summary className="run-form-section-summary">
                        <span className="run-form-section-title">File System Access</span>
                        <span className="run-form-section-meta">
                          {workspaceAccessMode}
                          {ignoredPathsCount > 0 ? ` · ${ignoredPathsCount} ignored` : ''}
                        </span>
                      </summary>
                      <div className="run-form-section-body">
                        <div className="run-form-field">
                          <label className="run-form-label">
                            Access mode
                            <span className="run-form-type">(workspace_access_mode)</span>
                          </label>
                          <AfSelect
                            value={workspaceAccessMode}
                            placeholder="workspace_only"
                            options={workspaceAccessModeOptions}
                            searchable={false}
                            disabled={isRunning}
                            onChange={(v) => {
                              const next = typeof v === 'string' ? v.trim() : '';
                              if (allowedAccessModes.includes(next)) {
                                setWorkspaceAccessMode(next as WorkspaceAccessMode);
                              } else if (allowedAccessModes.length > 0) {
                                const fallback = allowedAccessModes[0] as WorkspaceAccessMode;
                                console.warn(`#FALLBACK: workspace_access_mode not allowed; resetting to '${fallback}'`);
                                setWorkspaceAccessMode(fallback);
                              }
                            }}
                          />
                          <p className="run-form-note run-form-note-compact">
                            Relative paths resolve under workspace root. This only affects absolute paths.
                          </p>
                        </div>

                        <div className="run-form-field">
                          <label className="run-form-label">
                            Workspace folder
                            <span className="run-form-type">(workspace_root)</span>
                            {workspaceRootRequired ? (
                              <span className="run-form-required">required</span>
                            ) : (
                              <span className="run-form-note">optional</span>
                            )}
                          </label>

                          <div className="run-form-inline">
                            <input
                              type="text"
                              className="run-form-input"
                              value={workspaceRoot}
                              onChange={(e) => handleWorkspaceRootChange(e.target.value)}
                              placeholder={
                                !workspaceInputEnabled
                                  ? 'Server-managed (client overrides disabled)'
                                  : workspaceRandom && !workspaceRoot.trim()
                                    ? executionWorkspaceQuery.isLoading
                                      ? 'Generating…'
                                      : 'Will be generated on Run'
                                    : 'Folder path…'
                              }
                              readOnly={!workspaceInputEnabled || workspaceRandom}
                              disabled={isRunning || !workspaceInputEnabled}
                            />

                            <label className="run-form-checkbox run-form-inline-checkbox">
                              <input
                                type="checkbox"
                                checked={workspaceRandom}
                                onChange={(e) => handleWorkspaceRandomChange(e.target.checked)}
                                disabled={isRunning || !workspaceInputEnabled}
                              />
                              <span>Random (default)</span>
                              <span
                                className="run-form-tooltip"
                                title="When enabled, workspace_root is left unset and the gateway allocates a fresh per-run folder. Uncheck to run in a specific folder."
                                aria-label="Workspace folder randomization help"
                              >
                                i
                              </span>
                            </label>
                          </div>

                          {!workspaceInputEnabled ? (
                            <p className="run-form-note">
                              Workspace is managed by the gateway (a new per-run folder is created by default). Client overrides are disabled by policy.
                            </p>
                          ) : executionWorkspaceQuery.isError ? (
                            <p className="run-form-note">
                              Could not fetch defaults; the server will generate a folder on Run.
                            </p>
                          ) : null}
                        </div>

                        <div className="run-form-field">
                          <div className="run-form-label-row">
                            <label className="run-form-label">
                              Ignored folders
                              <span className="run-form-type">(workspace_ignored_paths)</span>
                            </label>
                            <button
                              type="button"
                              className="run-form-action"
                              onClick={() => setShowIgnoredPaths((prev) => !prev)}
                              disabled={isRunning}
                              aria-expanded={showIgnoredPaths}
                            >
                              {showIgnoredPaths ? 'Hide' : `Edit${ignoredPathsCount > 0 ? ` (${ignoredPathsCount})` : ''}`}
                            </button>
                          </div>

                          {showIgnoredPaths ? (
                            <>
                              <textarea
                                className="run-form-input run-form-textarea"
                                value={workspaceIgnoredPathsText}
                                onChange={(e) => setWorkspaceIgnoredPathsText(e.target.value)}
                                placeholder={'.git\nnode_modules\n.venv\n~/Library\n/Users/albou/.ssh'}
                                rows={4}
                                disabled={isRunning}
                              />
                              <p className="run-form-note">
                                One path per line. Relative entries are resolved under workspace root.
                              </p>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </details>

                    {/* Card 2: Workflow Parameters */}
                    <div className="run-form-section">
                      <div className="run-form-section-header">
                        <div className="run-form-section-title">Workflow Parameters</div>
                      </div>
                      <div className="run-form-section-body">
                        {!sessionPinId ? (
                          <div className="run-form-field">
                            <label className="run-form-label">
                              Session ID
                              <span className="run-form-type">(session_id)</span>
                              <span className="run-form-note">optional</span>
                            </label>
                            <input
                              type="text"
                              className="run-form-input"
                              value={sessionIdOverride}
                              onChange={(e) => setSessionIdOverride(e.target.value)}
                              placeholder={derivedSessionId || 'Reuse a session id for follow-ups'}
                              disabled={isRunning}
                            />
                            <p className="run-form-note">
                              Reuse the same session id to continue context on Follow Up. Leave blank to use the default tab session.
                            </p>
                          </div>
                        ) : null}
                        {formInputPins.length === 0 ? (
                          <p className="run-form-note">
                            This flow has no input parameters. Click Run to execute.
                          </p>
                        ) : null}

                        {formInputPins.map(pin => {
                          const inputType = getInputTypeForPin(pin.type);
                          const value = formValues[pin.id] || '';

                          if (isImageProviderInputPin(pin)) {
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder={imageProvidersQuery.isLoading ? 'Loading…' : 'Select…'}
                                  options={imageProviderOptions}
                                  disabled={imageProvidersQuery.isLoading}
                                  loading={imageProvidersQuery.isLoading}
                                  searchable
                                  searchPlaceholder="Search image providers…"
                                  onChange={(v) =>
                                    setFormValues((prev) => {
                                      const next = { ...prev, [pin.id]: v };
                                      for (const candidate of formInputPins) {
                                        if (isModelInputPin(candidate) && modelScopeForPin(candidate, formInputPins) === 'image') next[candidate.id] = '';
                                      }
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            );
                          }

                          if (isVoiceProviderInputPin(pin)) {
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder={voiceProvidersQuery.isLoading ? 'Loading…' : 'Select…'}
                                  options={voiceProviderOptions}
                                  disabled={voiceProvidersQuery.isLoading}
                                  loading={voiceProvidersQuery.isLoading}
                                  searchable
                                  searchPlaceholder={voiceModelMode === 'stt' ? 'Search STT providers…' : 'Search TTS providers…'}
                                  onChange={(v) =>
                                    setFormValues((prev) => {
                                      const next = { ...prev, [pin.id]: v };
                                      for (const candidate of formInputPins) {
                                        if (isModelInputPin(candidate) && modelScopeForPin(candidate, formInputPins) === 'voice') next[candidate.id] = '';
                                      }
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            );
                          }

                          if (isMusicProviderInputPin(pin)) {
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder={musicProvidersQuery.isLoading ? 'Loading…' : 'Select…'}
                                  options={musicProviderOptions}
                                  disabled={musicProvidersQuery.isLoading}
                                  loading={musicProvidersQuery.isLoading}
                                  searchable
                                  searchPlaceholder="Search music providers…"
                                  onChange={(v) =>
                                    setFormValues((prev) => {
                                      const next = { ...prev, [pin.id]: v };
                                      for (const candidate of formInputPins) {
                                        if (isModelInputPin(candidate) && modelScopeForPin(candidate, formInputPins) === 'music') next[candidate.id] = '';
                                      }
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            );
                          }

                          if (isTextProviderInputPin(pin)) {
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder={providersQuery.isLoading ? 'Loading…' : 'Select…'}
                                  options={providers.map((p) => ({ value: p.name, label: p.display_name || p.name }))}
                                  disabled={providersQuery.isLoading}
                                  loading={providersQuery.isLoading}
                                  searchable
                                  searchPlaceholder="Search providers…"
                                  onChange={(v) =>
                                    setFormValues((prev) => {
                                      const next = { ...prev, [pin.id]: v };
                                      for (const candidate of formInputPins) {
                                        if (isModelInputPin(candidate) && modelScopeForPin(candidate, formInputPins) === 'text') next[candidate.id] = '';
                                      }
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            );
                          }

                          if (isModelInputPin(pin)) {
                            const scope = modelScopeForPin(pin, formInputPins);
                            const scopeProvider =
                              scope === 'image'
                                ? selectedImageProvider
                                : scope === 'voice'
                                  ? selectedVoiceProvider
                                  : scope === 'music'
                                    ? selectedMusicProvider
                                    : selectedProvider;
                            const scopeLoading =
                              scope === 'image'
                                ? imageModelsQuery.isLoading
                                : scope === 'voice'
                                  ? voiceModelsQuery.isLoading
                                  : scope === 'music'
                                    ? musicModelsQuery.isLoading
                                  : modelsQuery.isLoading;
                            const scopeOptions =
                              scope === 'image'
                                ? imageModelOptions
                                : scope === 'voice'
                                  ? voiceModelOptions
                                  : scope === 'music'
                                    ? musicModelOptions
                                  : models.map((m) => ({ value: m, label: m }));
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder={
                                    !scopeProvider ? 'Pick provider…' : scopeLoading ? 'Loading…' : 'Select…'
                                  }
                                  options={scopeOptions}
                                  disabled={!scopeProvider}
                                  loading={scopeLoading}
                                  allowCustom
                                  searchable
                                  searchPlaceholder={
                                    scope === 'image'
                                      ? 'Search image models…'
                                      : scope === 'voice'
                                        ? voiceModelMode === 'stt'
                                          ? 'Search STT models…'
                                          : 'Search TTS models…'
                                        : scope === 'music'
                                          ? 'Search music models…'
                                        : 'Search models…'
                                  }
                                  onChange={(v) => {
                                    handleFieldChange(pin.id, v);
                                  }}
                                />
                              </div>
                            );
                          }

                          if (pin.type === 'tools') {
                            const values = Array.isArray(toolsValues[pin.id]) ? toolsValues[pin.id] : [];
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfMultiSelect
                                  values={values}
                                  placeholder={toolsQuery.isLoading ? 'Loading…' : 'Select…'}
                                  options={toolOptions}
                                  disabled={isRunning || toolsQuery.isLoading}
                                  loading={toolsQuery.isLoading}
                                  searchable
                                  searchPlaceholder="Search tools…"
                                  clearable
                                  minPopoverWidth={340}
                                  onChange={(next) => setToolsValues((prev) => ({ ...prev, [pin.id]: next }))}
                                />
                              </div>
                            );
                          }

                          if (pin.id === 'scope') {
                            const options = memoryScopeOptions.map((v) => ({ value: v, label: v }));
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder="run"
                                  options={options}
                                  searchable={false}
                                  disabled={isRunning}
                                  onChange={(v) => handleFieldChange(pin.id, v || 'run')}
                                />
                              </div>
                            );
                          }

                          if (pin.id === 'recall_level') {
                            const options = RECALL_LEVEL_OPTIONS.map((v) => ({ value: v, label: v }));
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <AfSelect
                                  value={value}
                                  placeholder="standard"
                                  options={options}
                                  searchable={false}
                                  disabled={isRunning}
                                  onChange={(v) => handleFieldChange(pin.id, v || 'standard')}
                                />
                              </div>
                            );
                          }

                          if (pin.type === 'array') {
                            return (
                              <div key={pin.id} className="run-form-field">
                                <label className="run-form-label">
                                  {pin.label}
                                  <span className="run-form-type">({pin.type})</span>
                                </label>
                                <ArrayParamEditor
                                  value={value}
                                  disabled={isRunning}
                                  onChange={(next) => handleFieldChange(pin.id, next)}
                                />
                              </div>
                            );
                          }

                          return (
                            <div key={pin.id} className="run-form-field">
                              <label className="run-form-label">
                                {pin.label}
                                <span className="run-form-type">({pin.type})</span>
                              </label>

                              {inputType === 'textarea' ? (
                                <textarea
                                  className="run-form-input"
                                  value={value}
                                  onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                                  placeholder={getPlaceholderForPin(pin)}
                                  rows={pin.type === 'string' ? 3 : 5}
                                  disabled={isRunning}
                                />
                              ) : inputType === 'checkbox' ? (
                                <label className="run-form-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={value === 'true'}
                                    onChange={(e) => handleFieldChange(pin.id, e.target.checked ? 'true' : 'false')}
                                    disabled={isRunning}
                                  />
                                  <span>{pin.label}</span>
                                </label>
                              ) : (
                                <input
                                  type={inputType}
                                  className="run-form-input"
                                  value={value}
                                  onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                                  placeholder={getPlaceholderForPin(pin)}
                                  disabled={isRunning}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {promptCacheSessionLifecycle ? (
                      <details className="run-form-section">
                        <summary className="run-form-section-summary">
                          <span className="run-form-section-title">Session prompt cache (volatile)</span>
                          <span className="run-form-section-meta">
                            {promptCacheHeaderStatus}
                          </span>
                        </summary>
                        <div className="run-form-section-body">
                          <p className="run-form-note">
                            Session cache is a volatile convenience for this Gateway session. It is separate from durable exact reuse.
                          </p>
                          <div className="run-form-inline run-prompt-cache-actions">
                            <button
                              type="button"
                              className="modal-button"
                              onClick={() => void runPromptCacheOperation('status')}
                              disabled={!promptCacheEnabled || promptCacheBusy}
                            >
                              Status
                            </button>
                            <button
                              type="button"
                              className="modal-button"
                              onClick={() => void runPromptCacheOperation('prepare')}
                              disabled={!promptCacheEnabled || promptCacheBusy}
                            >
                              Prepare
                            </button>
                            <button
                              type="button"
                              className="modal-button cancel"
                              onClick={() => void runPromptCacheOperation('clear')}
                              disabled={!promptCacheEnabled || promptCacheBusy}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className="modal-button"
                              onClick={() => void runPromptCacheOperation('rebuild')}
                              disabled={!promptCacheEnabled || promptCacheBusy}
                            >
                              Rebuild
                            </button>
                          </div>
                          {promptCacheSelectionNote ? <p className="run-form-note">{promptCacheSelectionNote}</p> : null}
                          {promptCacheError ? <div className="run-details-error">{promptCacheError}</div> : null}
                          {promptCacheResult ? (
                            <div className="run-output-meta run-prompt-cache-meta">
                              <div>
                                <span className="run-output-meta-key">Mode</span>
                                <span className="run-output-meta-val">{String(promptCacheResult.mode || 'unknown')}</span>
                              </div>
                              {typeof promptCacheResult.prompt_cache_key === 'string' ? (
                                <div>
                                  <span className="run-output-meta-key">Key</span>
                                  <span className="run-output-meta-val">{promptCacheResult.prompt_cache_key}</span>
                                </div>
                              ) : null}
                              {typeof promptCacheResult.code === 'string' ? (
                                <div>
                                  <span className="run-output-meta-key">Code</span>
                                  <span className="run-output-meta-val">{promptCacheResult.code}</span>
                                </div>
                              ) : null}
                              {promptCacheResultMessage ? (
                                <div>
                                  <span className="run-output-meta-key">Info</span>
                                  <span className="run-output-meta-val">{promptCacheResultMessage}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}

                    <details className="run-form-section">
                      <summary className="run-form-section-summary">
                        <span className="run-form-section-title">Durable prompt cache (exact reuse)</span>
                        <span className="run-form-section-meta">
                          {durableBlocStatus}
                        </span>
                      </summary>
                      <div className="run-form-section-body">
                        <p className="run-form-note">
                          Durable blocs are operator controls for exact reusable prompt prefixes. Loading a KV artifact returns a
                          <code> prompt_cache_binding</code>; the run uses it only when you wire or submit that binding explicitly.
                        </p>
                        <div className="run-form-inline">
                          <input
                            type="text"
                            className="run-form-input"
                            value={durableBlocId}
                            onChange={(e) => setDurableBlocId(e.target.value)}
                            placeholder="bloc_id"
                            disabled={isRunning || durableBlocBusy || !durableBlocPromptCacheContract}
                          />
                          <input
                            type="text"
                            className="run-form-input"
                            value={durableBlocSha256}
                            onChange={(e) => setDurableBlocSha256(e.target.value)}
                            placeholder="sha256"
                            disabled={isRunning || durableBlocBusy || !durableBlocPromptCacheContract}
                          />
                        </div>
                        <div className="run-form-inline">
                          <input
                            type="text"
                            className="run-form-input"
                            value={promptCacheProvider}
                            readOnly
                            placeholder="provider inferred from graph or run input"
                            title="Provider is inferred from the run form or graph."
                          />
                          <input
                            type="text"
                            className="run-form-input"
                            value={promptCacheModel}
                            readOnly
                            placeholder="model inferred from graph or run input"
                            title="Model is inferred from the run form or graph."
                          />
                        </div>
                        <div className="run-form-inline">
                          <input
                            type="text"
                            className="run-form-input"
                            value={durableBlocArtifactPath}
                            onChange={(e) => setDurableBlocArtifactPath(e.target.value)}
                            placeholder="artifact_path (optional)"
                            disabled={isRunning || durableBlocBusy || !durableBlocAvailable}
                          />
                          <input
                            type="text"
                            className="run-form-input"
                            value={durableBlocCacheKey}
                            onChange={(e) => setDurableBlocCacheKey(e.target.value)}
                            placeholder="cache key for kv_load (optional)"
                            disabled={isRunning || durableBlocBusy || !durableBlocAvailable}
                          />
                        </div>
                        <div className="run-form-inline run-prompt-cache-actions">
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => void runDurableBlocOperation('record')}
                            disabled={!durableBlocAvailable || durableBlocBusy || isRunning}
                          >
                            Record
                          </button>
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => void runDurableBlocOperation('kv_manifest')}
                            disabled={!durableBlocAvailable || durableBlocBusy || isRunning}
                          >
                            Manifest
                          </button>
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => void runDurableBlocOperation('kv_list')}
                            disabled={!durableBlocAvailable || durableBlocBusy || isRunning}
                          >
                            KV list
                          </button>
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => void runDurableBlocOperation('kv_ensure')}
                            disabled={!durableBlocAvailable || durableBlocBusy || isRunning}
                          >
                            Ensure
                          </button>
                          <button
                            type="button"
                            className="modal-button"
                            onClick={() => void runDurableBlocOperation('kv_load')}
                            disabled={!durableBlocAvailable || durableBlocBusy || isRunning}
                          >
                            Load binding
                          </button>
                        </div>
                        {durableBlocSelectionNote ? <p className="run-form-note">{durableBlocSelectionNote}</p> : null}
                        {durableBlocError ? <div className="run-details-error">{durableBlocError}</div> : null}
                        {durableBlocResult ? (
                          <div className="run-output-meta run-prompt-cache-meta">
                            {Object.entries(durableBlocSummary).map(([key, value]) => (
                              <div key={key}>
                                <span className="run-output-meta-key">{key}</span>
                                <span className="run-output-meta-val">{value}</span>
                              </div>
                            ))}
                            {durableBlocLoadedBinding ? (
                              <div className="run-form-inline">
                                <button
                                  type="button"
                                  className="modal-button"
                                  onClick={() =>
                                    void copyTextToClipboard(
                                      typeof durableBlocLoadedBinding === 'string'
                                        ? durableBlocLoadedBinding
                                        : stringifyJson(durableBlocLoadedBinding)
                                    )
                                  }
                                >
                                  Copy binding
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="run-form-field">
                          <label className="run-form-label" htmlFor="durable-prompt-cache-binding">
                            Run input prompt_cache_binding
                            <span className="run-form-type">(binding object or binding_id)</span>
                          </label>
                          <textarea
                            id="durable-prompt-cache-binding"
                            className="run-form-input"
                            value={durablePromptCacheBindingInput}
                            onChange={(e) => setDurablePromptCacheBindingInput(e.target.value)}
                            placeholder='{"binding_id":"...","key":"..."}'
                            rows={4}
                            disabled={isRunning}
                          />
                          <p className="run-form-note">
                            This visible run input is submitted as <code>prompt_cache_binding</code>. Wire an entry
                            <code> prompt_cache_binding</code> output to an LLM Call or Agent pin to consume it in the graph.
                          </p>
                        </div>
                      </div>
                    </details>

                  </div>
                </div>
              ) : (
                <p className="run-form-note">
                  No nodes in this flow. Add an entry node to run.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="run-modal-footer">
          {approvalDetails ? (
            <div className="run-approval-panel">
              <div className="run-approval-header">
                <div className="run-approval-title">Pending tool approval</div>
                {approvalRunId ? (
                  <div className="run-approval-meta">Run {approvalRunId}</div>
                ) : null}
              </div>
              {approvalToolCalls.length > 0 ? (
                <div className="run-approval-tools">
                  {approvalToolCalls.map((call, idx) => {
                    const callObj = call && typeof call === 'object' ? (call as Record<string, unknown>) : {};
                    const name = typeof callObj.name === 'string' ? callObj.name : `tool_${idx + 1}`;
                    const args =
                      callObj.arguments && typeof callObj.arguments === 'object'
                        ? callObj.arguments
                        : callObj.args && typeof callObj.args === 'object'
                          ? callObj.args
                          : callObj;
                    const callId = typeof callObj.call_id === 'string' ? callObj.call_id : '';
                    return (
                      <div key={`${name}-${idx}`} className="run-approval-tool">
                        <div className="run-approval-tool-title">
                          {name}
                          {callId ? <span className="run-approval-tool-id">{callId}</span> : null}
                        </div>
                        <JsonViewer value={args} collapseAfterDepth={6} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="run-approval-empty">No tool call details were provided.</div>
              )}
            </div>
          ) : null}

          <div className="run-modal-footer-actions">
            <div className="run-modal-footer-left">
              {approvalDetails ? (
                <>
                  <button
                    type="button"
                    className="modal-button primary"
                    onClick={() => {
                      onApproveAll?.({
                        rootRunId: rootRunId || undefined,
                        sessionId: approvalSessionId || undefined,
                      });
                      onResume?.({
                        approved: true,
                        runId: approvalWait?.runId,
                        waitKey: approvalWait?.waitKey,
                      });
                    }}
                  >
                    Approve All
                  </button>
                  <button
                    type="button"
                    className="modal-button"
                    onClick={() =>
                      onResume?.({
                        approved: true,
                        runId: approvalWait?.runId,
                        waitKey: approvalWait?.waitKey,
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="modal-button cancel"
                    onClick={() =>
                      onResume?.({
                        approved: false,
                        runId: approvalWait?.runId,
                        waitKey: approvalWait?.waitKey,
                      })
                    }
                  >
                    Deny
                  </button>
                </>
              ) : null}
            </div>

            <div className="run-modal-footer-right">
              {onCancelRun && (
                <button
                  className="modal-button cancel"
                  onClick={onCancelRun}
                  disabled={!(isRunning || isPaused || isWaiting)}
                >
                  Cancel Run
                </button>
              )}

              {(onPause || onResumeRun) && (
                <button
                  className={isPaused ? 'modal-button primary' : 'modal-button cancel'}
                  onClick={() => {
                    if (isPaused) onResumeRun?.();
                    else onPause?.();
                  }}
                  disabled={isPaused ? !isPaused : !(isRunning && !isWaiting)}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
              )}

              <button
                className="modal-button cancel"
                onClick={onClose}
              >
                {(isRunning || isPaused || isWaiting) ? 'Hide' : (hasRunData || result ? 'Close' : 'Cancel')}
              </button>

              {!hasRunData && !result && (
                <button
                  className="modal-button primary"
                  onClick={handleSubmit}
                  disabled={
                    isRunning ||
                    !entryNode ||
                    (workspaceRootRequired && !workspaceRoot.trim() && !(workspaceRandom && executionWorkspaceQuery.isError))
                  }
                >
                  {isRunning ? 'Running...' : 'Run'}
                </button>
              )}

              {(hasRunData || result) && !isRunning && !isPaused && !isWaiting && onFollowUpSubmit && activeFollowUpSeed && (
                <button
                  className="modal-button cancel"
                  onClick={() => {
                    setFollowUpError(null);
                    setShowFollowUpModal(true);
                  }}
                >
                  Follow Up
                </button>
              )}

              {(hasRunData || result) && onNewRun && (
                <button
                  className="modal-button primary"
                  onClick={() => {
                    if (workspaceRandom) {
                      setWorkspaceRoot('');
                    }
                    setFollowUpContext(null);
                    setLastRunSeed(null);
                    if (sessionPinId) {
                      setFormValues((prev) => ({ ...prev, [sessionPinId]: '' }));
                    } else {
                      setSessionIdOverride('');
                    }
                    onNewRun();
                  }}
                  disabled={isRunning || Boolean(isPaused) || Boolean(isWaiting)}
                >
                  New Run
                </button>
              )}
            </div>
          </div>
          {showFollowUpModal && (
            <div className="run-followup-overlay">
              <div className="run-followup-modal">
                <div className="run-followup-header">Follow Up</div>
                <div className="run-followup-body">
                  <label className="run-followup-label" htmlFor="run-followup-textarea">
                    Message
                  </label>
                  <textarea
                    id="run-followup-textarea"
                    className="run-followup-textarea"
                    rows={4}
                    value={followUpDraft}
                    onChange={(e) => setFollowUpDraft(e.target.value)}
                    placeholder="Add your follow up request…"
                    disabled={followUpSubmitting}
                  />
                  <div
                    className={`run-followup-drop ${followUpDragActive ? 'is-active' : ''}`}
                    onDragEnter={handleFollowUpDragOver}
                    onDragOver={handleFollowUpDragOver}
                    onDragLeave={handleFollowUpDragLeave}
                    onDrop={handleFollowUpDrop}
                  >
                    <div className="run-followup-drop-title">Drag & drop attachments here</div>
                    <div className="run-followup-drop-subtitle">or</div>
                    <label className="run-followup-attach">
                      <input
                        type="file"
                        multiple
                        onChange={(e) => {
                          if (e.target.files) addFollowUpFiles(e.target.files);
                          e.currentTarget.value = '';
                        }}
                        disabled={followUpSubmitting}
                      />
                      Choose files
                    </label>
                  </div>
                  {followUpAttachments.length > 0 ? (
                    <div className="run-followup-files">
                      {followUpAttachments.map((f, idx) => (
                        <div className="run-followup-file" key={`${f.name}-${f.size}-${f.lastModified}-${idx}`}>
                          <div className="run-followup-file-name">{f.name}</div>
                          <div className="run-followup-file-meta">{Math.max(1, Math.ceil(f.size / 1024))} KB</div>
                          <button
                            type="button"
                            className="run-followup-file-remove"
                            onClick={() =>
                              setFollowUpAttachments((prev) => prev.filter((_, pIdx) => pIdx !== idx))
                            }
                            disabled={followUpSubmitting}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {followUpError ? <div className="run-followup-error">{followUpError}</div> : null}
                </div>
                <div className="run-followup-footer">
                  <button
                    type="button"
                    className="modal-button cancel"
                    onClick={() => {
                      if (followUpSubmitting) return;
                      setFollowUpDraft('');
                      setFollowUpAttachments([]);
                      setFollowUpError(null);
                      setShowFollowUpModal(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="modal-button primary"
                    onClick={handleFollowUpSubmit}
                    disabled={followUpSubmitting}
                  >
                    {followUpSubmitting ? 'Sending...' : 'Follow Up'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RunFlowModal;
