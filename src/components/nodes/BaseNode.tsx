/**
 * Base node component with Blueprint-style pins.
 * Follows UE4 Blueprint visual patterns:
 * - Execution pins at top of node (in/out)
 * - Data pins below with labels
 * - Empty shapes = not connected, Filled = connected
 */

import { Fragment, memo, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import type { FlowNodeData, JsonValue, Pin, PinType, VisualFlow } from '../../types/flow';
import { PIN_COLORS, isEntryNodeType } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';
import { useModels, useProviders } from '../../hooks/useProviders';
import { TEXT_OUTPUT_CAPABILITY_ROUTE } from '../../utils/capabilityRoutes';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../../hooks/useGatewayCapabilities';
import { useTools } from '../../hooks/useTools';
import { collectCustomEventNames } from '../../utils/events';
import {
  extractFunctionBody,
  generatePythonTransformCode,
  getPythonCodeUserPins,
  upsertPythonAvailableVariablesComments,
} from '../../utils/codegen';
import AfSelect from '../inputs/AfSelect';
import AfMultiSelect from '../inputs/AfMultiSelect';
import {
  codePermissionOptions,
  codePermissionUnavailableReason,
  descriptorEndpointAvailable,
  endpointFromDescriptor,
  gatewayFetch,
  gatewayJson,
  gatewayPath,
  getGatewayFlowEditorReadiness,
} from '../../utils/gatewayClient';
import {
  artifactAcceptForPin,
  artifactIdFromRef,
  artifactRefFromUploadResponse,
  isArtifactPinType,
} from '../../utils/artifactInputs';
import {
  insertModelResidencyStep,
  modelResidencyTaskUnsupportedReason,
  type ModelResidencyOperation,
} from '../../utils/modelResidencyGraph';
import { getNodePinDisclosure, isMediaPresentationNode } from '../../utils/nodePinDisclosure';
import { hasJsonSchemaPinDefault, isJsonSchemaInputPin } from '../../utils/jsonSchemaPins';
import {
  applyImagePinDefaultPatch,
  extractImageModelParameterMetadata,
  type MediaModelParameterMetadata,
} from '../../utils/mediaModelParams';
import { inferSchemaForNodeOutput } from '../../utils/outputSchemaInference';
import {
  isModelPin,
  modelCatalogScopeForPin,
  providerCatalogScopeForPin,
  providerPinIdForModelPin,
  type PinCatalogScope,
} from '../../utils/pinCatalog';
import { normalizeVariableName, validateVariableName, variableNameCustomOptionLabel } from '../../utils/variableNames';
import {
  defaultSubflowPinPatch,
  savedFlowSummariesFromResponse,
  subflowPinPatchForSelectedFlow,
} from '../../utils/subflowPins';
import { createNodeData, getNodeTemplate, mergePinDocsFromTemplate } from '../../types/nodes';
import { AfTooltip } from '../AfTooltip';
import { CodeEditorModal } from '../CodeEditorModal';
import { JsonLiteralNodeEditorModal } from '../JsonLiteralNodeEditorModal';
import { JsonSchemaPinEditorModal } from '../JsonSchemaPinEditorModal';
import { type JsonSchema } from '../../schemas/known_json_schemas';

type SelectOption = { value: string; label: string };
type MediaModelOption = {
  provider: string;
  model: string;
  label: string;
  scopeModel?: string;
  catalogTask?: string;
} & MediaModelParameterMetadata;
type ProviderOptionMap = Record<string, SelectOption[]>;
type MediaCatalogScope = 'image' | 'tts' | 'stt' | 'music';
type MediaCatalogKind = 'providers' | 'models' | 'voices' | 'profiles';
type MediaCatalogRequest = {
  seq: number;
  scope: MediaCatalogScope;
  provider?: string;
  model?: string;
  task?: string;
  providersOnly?: boolean;
  includeProviders?: boolean;
  includeModels?: boolean;
  includeVoices?: boolean;
};
const GATEWAY_DEFAULT_SELECT_OPTION: SelectOption = { value: '', label: 'Auto (Gateway default)' };

function safeNodeArtifactSessionId(flowId: string | null | undefined, nodeId: string): string {
  const base = String(flowId || '').trim() || 'draft';
  const raw = `abstractflow_node_artifacts_${base}_${nodeId}`;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 96) || 'abstractflow_node_artifacts';
}

const DEFAULT_IMAGE_FORMATS = ['png', 'jpeg', 'webp'];
const DEFAULT_VIDEO_FORMATS = ['mp4', 'mov', 'gif'];
const DEFAULT_TTS_FORMATS = ['wav'];
const DEFAULT_TTS_QUALITY_PRESETS: SelectOption[] = [
  { value: 'low', label: 'low / fast' },
  { value: 'standard', label: 'standard' },
  { value: 'high', label: 'high quality' },
];
const OPENAI_TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const DEFAULT_STT_FORMATS = ['json', 'text', 'verbose_json', 'srt', 'vtt'];
const DEFAULT_MUSIC_FORMATS = ['wav', 'mp3', 'flac'];
const DEFAULT_THINKING_OPTIONS: SelectOption[] = [
  { value: '', label: 'Auto (Gateway default)' },
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
];
const ANSWER_USER_LEVEL_OPTIONS: SelectOption[] = [
  { value: 'message', label: 'message' },
  { value: 'warning', label: 'warning' },
  { value: 'error', label: 'error' },
];

function formatOptionsFrom(values: unknown, fallback: string[]): SelectOption[] {
  const raw = Array.isArray(values) ? values : fallback;
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: value });
  }
  if (out.length > 0) return out;
  return fallback.map((value) => ({ value, label: value }));
}

function normalizeMediaProvider(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function normalizeMediaCatalogTask(value: string | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function mediaCatalogLoadedKey(
  scope: MediaCatalogScope,
  kind: MediaCatalogKind,
  provider = '',
  model = '',
  task = ''
): string {
  return [
    scope,
    kind,
    normalizeMediaCatalogTask(task),
    normalizeMediaProvider(provider),
    String(model || '').trim().toLowerCase(),
  ].join(':');
}

function mediaCatalogRequestKey(scope: MediaCatalogScope, request: Partial<MediaCatalogRequest>): string {
  return [
    scope,
    normalizeMediaProvider(request.provider || ''),
    String(request.model || '').trim().toLowerCase(),
    String(request.task || '').trim().toLowerCase(),
    request.providersOnly === true ? 'providers-only' : 'full',
    request.includeProviders === true ? 'include-providers' : '',
    request.includeModels === false ? 'no-models' : request.includeModels === true ? 'include-models' : 'default-models',
    request.includeVoices === false ? 'no-voices' : request.includeVoices === true ? 'include-voices' : 'default-voices',
  ].join('|');
}

function isMediaCatalogRequestKey(request: MediaCatalogRequest | null, key: string): boolean {
  return Boolean(request && mediaCatalogRequestKey(request.scope, request) === key);
}

function firstConfigString(...values: unknown[]): string {
  for (const value of values) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (raw) return raw;
  }
  return '';
}

function providerOptionMapValues(map: ProviderOptionMap, provider: string, fallback: SelectOption[]): SelectOption[] {
  const normalized = normalizeMediaProvider(provider);
  if (!normalized) return fallback;
  return map[normalized] || map[provider] || [];
}

function withCurrentOption(options: SelectOption[], current: string): SelectOption[] {
  const clean = typeof current === 'string' ? current.trim() : '';
  if (!clean) return options;
  if (options.some((option) => option.value === clean)) return options;
  return [...options, { value: clean, label: clean }];
}

function withGatewayDefaultOption(options: SelectOption[]): SelectOption[] {
  return [
    GATEWAY_DEFAULT_SELECT_OPTION,
    ...options.filter((option) => option.value.trim() !== ''),
  ];
}

function stringListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function modelNameLooksThinkingCapable(modelName: string): boolean {
  const clean = String(modelName || '').trim();
  if (!clean) return false;
  return [
    /\bo[134](?:[-.]|$)/i,
    /\bgpt[-_.]?5/i,
    /\bgpt[-_.]?oss/i,
    /\bclaude.*(?:4|opus|sonnet|haiku)/i,
    /\bdeepseek.*(?:r1|v4)/i,
    /\bqwen3\b/i,
    /\bqwen3[.-]/i,
    /\bthinking\b/i,
    /\breasoning\b/i,
    /\bseed[-_.]?oss\b/i,
  ].some((pattern) => pattern.test(clean));
}

function thinkingOptionsFromModelCapabilities(payload: unknown, modelName: string): SelectOption[] {
  const response = recordFrom(payload);
  const caps = recordFrom(response?.capabilities) || response;
  const levels = stringListFrom(caps?.reasoning_levels || caps?.thinking_levels);
  const support =
    caps?.thinking_support === true ||
    caps?.thinking_budget === true ||
    typeof caps?.thinking_control_mode === 'string' ||
    levels.length > 0;

  if (levels.length > 0) {
    return [
      { value: '', label: 'Auto (Gateway default)' },
      ...levels.map((value) => ({ value, label: value })),
    ];
  }

  if (support || modelNameLooksThinkingCapable(modelName)) return DEFAULT_THINKING_OPTIONS;
  return [];
}

function mergeSelectOptions(current: SelectOption[], incoming: SelectOption[]): SelectOption[] {
  if (incoming.length === 0) return current;
  const byValue = new Map<string, SelectOption>();
  for (const option of current) {
    const key = option.value.trim();
    if (key) byValue.set(key, option);
  }
  for (const option of incoming) {
    const key = option.value.trim();
    if (!key) continue;
    byValue.set(key, option);
  }
  return Array.from(byValue.values());
}

function replaceMediaOptionsForProvider(
  current: MediaModelOption[],
  incoming: MediaModelOption[],
  provider: string,
  task = ''
): MediaModelOption[] {
  const providerKey = normalizeMediaProvider(provider);
  const taskKey = normalizeMediaCatalogTask(task);
  if (!providerKey) return incoming;
  return [
    ...current.filter((option) => {
      if (normalizeMediaProvider(option.provider) !== providerKey) return true;
      if (!taskKey) return false;
      const optionTask = normalizeMediaCatalogTask(option.catalogTask);
      return optionTask && optionTask !== taskKey;
    }),
    ...incoming,
  ];
}

function catalogScopeLabel(scope: PinCatalogScope): string {
  if (scope === 'tts') return 'TTS';
  if (scope === 'stt') return 'STT';
  if (scope === 'image') return 'image';
  if (scope === 'music') return 'music';
  return 'text';
}

function ttsFormatFallback(provider: string): string[] {
  const p = normalizeMediaProvider(provider);
  if (p === 'openai' || p === 'openai-compatible' || p === 'remote') return OPENAI_TTS_FORMATS;
  return DEFAULT_TTS_FORMATS;
}

function canonicalImageModelForProvider(provider: string, model: string): string {
  const normalizedProvider = normalizeMediaProvider(provider);
  let clean = String(model || '').trim();
  if (!clean) return '';
  const lowered = clean.toLowerCase();
  if ((normalizedProvider === 'huggingface' || normalizedProvider === 'hf') && lowered.startsWith('diffusers/')) {
    clean = clean.slice('diffusers/'.length).trim();
  }
  if ((normalizedProvider === 'openai' || normalizedProvider === 'openai-compatible') && lowered.startsWith('openai-compatible/')) {
    clean = clean.slice('openai-compatible/'.length).trim();
  }
  return clean;
}

function imageDefaultsForProvider(provider: string): Record<string, JsonValue | undefined> {
  const normalized = normalizeMediaProvider(provider);
  if (normalized === 'openai' || normalized === 'openai-compatible') {
    return {
      width: undefined,
      height: undefined,
      steps: undefined,
      guidance_scale: undefined,
    };
  }
  return {
    width: undefined,
    height: undefined,
    steps: 20,
    guidance_scale: undefined,
  };
}

function pinListSignature(pins: readonly Pin[]): string {
  return pins.map((pin) => `${pin.id}:${pin.label}:${pin.type}:${pin.description || ''}`).join('\n');
}

const OnEventNameInline = memo(function OnEventNameInline({
  nodeId,
  value,
  eventConfig,
  updateNodeData,
}: {
  nodeId: string;
  value: string;
  eventConfig: FlowNodeData['eventConfig'] | undefined;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
}) {
  const nodes = useFlowStore((s) => s.nodes);
  const options = useMemo(() => collectCustomEventNames(nodes), [nodes]);
  const listId = `af-on-event-names-${nodeId}`;

  return (
    <div className="node-inline-config nodrag">
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <input
          className="af-pin-input nodrag"
          type="text"
          value={value}
          list={options.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            updateNodeData(nodeId, {
              eventConfig: { ...(eventConfig || {}), name: e.target.value },
            })
          }
          placeholder={options.length > 0 ? 'Pick…' : 'e.g., my_event'}
        />
      </div>
    </div>
  );
});

const ToolsAllowlistInline = memo(function ToolsAllowlistInline({
  tools,
  toolOptions,
  loading,
  onChange,
}: {
  tools: string[];
  toolOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="node-inline-config nodrag">
      <div className="node-config-row">
        <span className="node-config-label">tools</span>
        <AfMultiSelect
          variant="pin"
          values={tools}
          placeholder={loading ? 'Loading…' : 'Select…'}
          options={toolOptions}
          disabled={loading}
          loading={loading}
          searchable
          searchPlaceholder="Search tools…"
          clearable
          minPopoverWidth={340}
          onChange={onChange}
        />
      </div>
    </div>
  );
});

const ToolParametersInline = memo(function ToolParametersInline({
  tool,
  toolOptions,
  loading,
  onChange,
}: {
  tool: string;
  toolOptions: Array<{ value: string; label: string }>;
  loading: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="node-inline-config nodrag">
      <div className="node-config-row">
        <span className="node-config-label">tool</span>
        <AfSelect
          variant="pin"
          value={tool}
          placeholder={loading ? 'Loading…' : 'Select…'}
          options={toolOptions}
          disabled={loading}
          loading={loading}
          searchable
          searchPlaceholder="Search tools…"
          clearable
          minPopoverWidth={340}
          onChange={(v) => onChange(v || '')}
        />
      </div>
    </div>
  );
});

const BoolVarInline = memo(function BoolVarInline({
  name,
  defaultValue,
  options,
  onChange,
}: {
  name: string;
  defaultValue: boolean;
  options: string[];
  onChange: (next: { name: string; default: boolean }) => void;
}) {
  const nameOptions = useMemo(() => options.map((value) => ({ value, label: value })), [options]);
  return (
    <div className="node-inline-config nodrag">
      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <AfSelect
          variant="pin"
          value={name}
          placeholder="Select…"
          options={nameOptions}
          searchable
          allowCustom
          clearable
          searchPlaceholder="Search or type variable…"
          customOptionLabel={variableNameCustomOptionLabel}
          validateCustomValue={(v) => validateVariableName(v)}
          minPopoverWidth={260}
          onChange={(v) => onChange({ name: normalizeVariableName(v), default: defaultValue })}
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">default</span>
        <label
          className="af-pin-checkbox nodrag"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="af-pin-checkbox-input"
            type="checkbox"
            checked={defaultValue}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ name, default: e.target.checked })}
          />
          <span className="af-pin-checkbox-box" aria-hidden="true" />
        </label>
      </div>
    </div>
  );
});

const VarDeclInline = memo(function VarDeclInline({
  name,
  varType,
  defaultValue,
  nameOptions,
  toolOptions,
  toolLoading,
  onChange,
}: {
  name: string;
  varType: Exclude<PinType, 'execution'>;
  defaultValue: JsonValue;
  nameOptions: string[];
  toolOptions: Array<{ value: string; label: string }>;
  toolLoading: boolean;
  onChange: (next: { name: string; type: Exclude<PinType, 'execution'>; default: JsonValue }) => void;
}) {
  const variableNameOptions = useMemo(() => nameOptions.map((value) => ({ value, label: value })), [nameOptions]);

  const typeOptions: Array<{ value: string; label: string }> = [
    { value: 'boolean', label: 'boolean' },
    { value: 'number', label: 'number' },
    { value: 'string', label: 'string' },
    { value: 'provider_text', label: 'provider_text' },
    { value: 'provider_image', label: 'provider_image' },
    { value: 'provider_voice', label: 'provider_voice' },
    { value: 'provider_music', label: 'provider_music' },
    { value: 'provider', label: 'provider (legacy)' },
    { value: 'model', label: 'model' },
    { value: 'model_music', label: 'model_music' },
    { value: 'object', label: 'json' },
    { value: 'json_schema', label: 'json schema' },
    { value: 'assertion', label: 'assertion' },
    { value: 'assertions', label: 'assertion[]' },
    { value: 'array', label: 'array' },
    { value: 'tools', label: 'tools' },
    { value: 'any', label: 'any' },
  ];

  const defaultUi = (() => {
    if (varType === 'boolean') {
      return (
        <label
          className="af-pin-checkbox nodrag"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="af-pin-checkbox-input"
            type="checkbox"
            checked={typeof defaultValue === 'boolean' ? defaultValue : false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ name, type: varType, default: e.target.checked })}
          />
          <span className="af-pin-checkbox-box" aria-hidden="true" />
        </label>
      );
    }

    if (varType === 'number') {
      const v = typeof defaultValue === 'number' && Number.isFinite(defaultValue) ? String(defaultValue) : '';
      return (
        <input
          className="af-pin-input nodrag"
          type="number"
          value={v}
          placeholder="0"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) {
              onChange({ name, type: varType, default: 0 });
              return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            onChange({ name, type: varType, default: n });
          }}
        />
      );
    }

    if (
      varType === 'string' ||
      varType === 'provider' ||
      varType === 'model' ||
      varType === 'provider_text' ||
      varType === 'model_text' ||
      varType === 'provider_image' ||
      varType === 'model_image' ||
      varType === 'provider_voice' ||
      varType === 'model_voice' ||
      varType === 'provider_music' ||
      varType === 'model_music'
    ) {
      return (
        <input
          className="af-pin-input nodrag"
          type="text"
          value={typeof defaultValue === 'string' ? defaultValue : ''}
          placeholder=""
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name, type: varType, default: e.target.value })}
        />
      );
    }

    if (varType === 'tools') {
      const raw = Array.isArray(defaultValue) ? defaultValue : [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      const unique = Array.from(new Set(cleaned));
      return (
        <AfMultiSelect
          variant="pin"
          values={unique}
          placeholder={toolLoading ? 'Loading…' : 'Select…'}
          options={toolOptions}
          disabled={toolLoading}
          loading={toolLoading}
          searchable
          searchPlaceholder="Search tools…"
          clearable
          minPopoverWidth={340}
          onChange={(next) => onChange({ name, type: varType, default: Array.from(new Set(next)) })}
        />
      );
    }

    const preview =
      varType === 'array'
        ? '[]'
        : varType === 'object' || varType === 'json_schema'
        ? '{}'
        : varType === 'assertion'
        ? '{assertion}'
        : varType === 'assertions'
        ? '[assertion]'
        : 'null';
    return (
      <input
        className="af-pin-input nodrag"
        type="text"
        value={preview}
        disabled
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        readOnly
      />
    );
  })();

  return (
    <div className="node-inline-config nodrag">
      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <AfSelect
          variant="pin"
          value={name}
          placeholder="Select…"
          options={variableNameOptions}
          searchable
          allowCustom
          clearable
          searchPlaceholder="Search or type variable…"
          customOptionLabel={variableNameCustomOptionLabel}
          validateCustomValue={(v) => validateVariableName(v)}
          minPopoverWidth={260}
          onChange={(v) => onChange({ name: normalizeVariableName(v), type: varType, default: defaultValue })}
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">type</span>
        <AfSelect
          variant="pin"
          value={varType}
          options={typeOptions}
          onChange={(v) => {
            const nextType = (v || 'any') as Exclude<PinType, 'execution'>;
            const nextDefault =
              nextType === 'boolean'
                ? false
                : nextType === 'number'
                  ? 0
                  : nextType === 'string' || nextType === 'provider' || nextType === 'model'
                    ? ''
                    : nextType === 'tools'
                      ? []
                      : nextType === 'assertions'
                        ? []
                    : nextType === 'array'
                      ? []
                      : nextType === 'object' || nextType === 'json_schema'
                        ? {}
                        : null;
            onChange({ name, type: nextType, default: nextDefault });
          }}
        />
      </div>

      <div className="node-config-row">
        <span className="node-config-label">default</span>
        {defaultUi}
      </div>
    </div>
  );
});

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
}: NodeProps<FlowNodeData>) {
  const nodeDescription = useMemo(() => {
    try {
      const t = getNodeTemplate(data.nodeType);
      const raw = t?.description;
      return typeof raw === 'string' ? raw.trim() : '';
    } catch {
      return '';
    }
  }, [data.nodeType]);

  const { executingNodeId, disconnectPin, updateNodeData, setNodes, recentNodeIds, loopProgressByNodeId } = useFlowStore();
  const flowId = useFlowStore((s) => s.flowId);
  const allNodes = useFlowStore((s) => s.nodes);
  const isExecuting = executingNodeId === id;
  const isRecent = Boolean(recentNodeIds && (recentNodeIds as Record<string, true>)[id]);
  const connectionPreview = data.connectionPreview;
  const edges = useEdges();
  const { setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const isTriggerNode = isEntryNodeType(data.nodeType);
  const pinDefaults = data.pinDefaults || {};
  const isLlmNode = data.nodeType === 'llm_call';
  const isAgentNode = data.nodeType === 'agent';
  const isVarNode = data.nodeType === 'get_var' || data.nodeType === 'set_var';
  const isCodeNode = data.nodeType === 'code';
  const [showCodeEditor, setShowCodeEditor] = useState(false);
  const [showJsonLiteralEditor, setShowJsonLiteralEditor] = useState(false);
  const [jsonDefaultEditorPinId, setJsonDefaultEditorPinId] = useState<string | null>(null);
  const [schemaEditorPinId, setSchemaEditorPinId] = useState<string | null>(null);
  const [showAdvancedPins, setShowAdvancedPins] = useState(false);
  const selectedTextModelForThinking = useMemo(() => {
    if (isAgentNode) return firstConfigString(data.agentConfig?.model, pinDefaults.model);
    if (isLlmNode) return firstConfigString(data.effectConfig?.model, pinDefaults.model);
    return '';
  }, [data.agentConfig?.model, data.effectConfig?.model, isAgentNode, isLlmNode, pinDefaults.model]);
  const selectedThinkingValue = useMemo(() => {
    if (isAgentNode) return firstConfigString(data.agentConfig?.thinking, pinDefaults.thinking);
    if (isLlmNode) return firstConfigString(data.effectConfig?.thinking, pinDefaults.thinking);
    return '';
  }, [data.agentConfig?.thinking, data.effectConfig?.thinking, isAgentNode, isLlmNode, pinDefaults.thinking]);
  const thinkingCapabilitiesQueryEnabled = (isAgentNode || isLlmNode) && Boolean(selectedTextModelForThinking);
  const thinkingGatewayCapabilitiesQuery = useGatewayCapabilities(thinkingCapabilitiesQueryEnabled);
  const thinkingGatewayContracts = gatewayContractsFromCapabilities(thinkingGatewayCapabilitiesQuery.data);
  const modelCapabilitiesEndpoint = thinkingGatewayContracts?.common?.discovery?.model_capabilities || '';
  const modelCapabilitiesQuery = useQuery({
    queryKey: ['model-capabilities', modelCapabilitiesEndpoint, selectedTextModelForThinking],
    queryFn: () =>
      gatewayJson<Record<string, unknown>>(
        gatewayPath(modelCapabilitiesEndpoint, {}, { model_name: selectedTextModelForThinking })
      ),
    enabled:
      thinkingCapabilitiesQueryEnabled &&
      Boolean(modelCapabilitiesEndpoint) &&
      !thinkingGatewayCapabilitiesQuery.isLoading &&
      !thinkingGatewayCapabilitiesQuery.isError,
    staleTime: 30_000,
  });
  const thinkingOptions = useMemo(
    () => thinkingOptionsFromModelCapabilities(modelCapabilitiesQuery.data, selectedTextModelForThinking),
    [modelCapabilitiesQuery.data, selectedTextModelForThinking]
  );
  const effectiveThinkingOptions = thinkingOptions.length > 0 ? thinkingOptions : DEFAULT_THINKING_OPTIONS;
  const thinkingSupported = thinkingOptions.length > 0 || Boolean(selectedThinkingValue);
  const artifactUploadInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const [artifactUploadBusyPins, setArtifactUploadBusyPins] = useState<Record<string, true>>({});
  const loopProgress = (data.nodeType === 'loop' || data.nodeType === 'for')
    ? (loopProgressByNodeId ? loopProgressByNodeId[id] : undefined)
    : undefined;
  const loopBadge = loopProgress && typeof loopProgress.total === 'number' && loopProgress.total > 0
    ? `${Math.min(loopProgress.index + 1, loopProgress.total)}/${loopProgress.total}`
    : null;

  const variableMeta = useMemo(() => {
    // Best-effort list of “flow vars” to help users pick names (Blueprint-style).
    // This is deliberately heuristic: users can still type/create new names.
    const vars = new Set<string>();
    const declaredTypes = new Map<string, Exclude<PinType, 'execution'>>();

    for (const n of allNodes) {
      const d = n.data;
      if (!d) continue;

      // On Flow Start parameters are initial vars.
      if (d.nodeType === 'on_flow_start') {
        for (const p of d.outputs || []) {
          if (p.type === 'execution') continue;
          const pid = typeof p.id === 'string' ? p.id.trim() : '';
          if (!pid) continue;
          vars.add(pid);
          // Prefer explicit declarations (var_decl/bool_var) over entrypoint pins.
          if (!declaredTypes.has(pid)) declaredTypes.set(pid, p.type as Exclude<PinType, 'execution'>);
        }
      }

      const ok = typeof d.outputKey === 'string' ? d.outputKey.trim() : '';
      if (ok) vars.add(ok);

      const ik = typeof d.inputKey === 'string' ? d.inputKey.trim() : '';
      if (ik) vars.add(ik);

      if ((d.nodeType === 'get_var' || d.nodeType === 'set_var') && typeof d.pinDefaults?.name === 'string') {
        const vn = d.pinDefaults.name.trim();
        if (vn) vars.add(vn);
      }

      if (d.nodeType === 'bool_var') {
        const raw = d.literalValue;
        let vn = '';
        if (typeof raw === 'string') vn = raw.trim();
        else if (raw && typeof raw === 'object' && typeof (raw as any).name === 'string') vn = String((raw as any).name).trim();
        if (vn) {
          vars.add(vn);
          declaredTypes.set(vn, 'boolean');
        }
      }

      if (d.nodeType === 'var_decl') {
        const raw = d.literalValue;
        if (raw && typeof raw === 'object') {
          const vn = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
          const t = typeof (raw as any).type === 'string' ? String((raw as any).type).trim() : '';
          const vt =
            t === 'boolean' ||
            t === 'number' ||
            t === 'string' ||
            t === 'provider' ||
            t === 'model' ||
            t === 'provider_text' ||
            t === 'model_text' ||
            t === 'provider_image' ||
            t === 'model_image' ||
            t === 'provider_voice' ||
            t === 'model_voice' ||
            t === 'provider_music' ||
            t === 'model_music' ||
            t === 'object' ||
            t === 'json_schema' ||
            t === 'assertion' ||
            t === 'assertions' ||
            t === 'array' ||
            t === 'tools' ||
            t === 'any'
              ? (t as Exclude<PinType, 'execution'>)
              : 'any';
          if (vn) {
            vars.add(vn);
            declaredTypes.set(vn, vt);
          }
        }
      }
    }

    const options = Array.from(vars)
      .filter((v) => v.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => {
        const t = declaredTypes.get(v);
        return { value: v, label: t ? `${v} (${t})` : v };
      });

    return { options, declaredTypes };
  }, [allNodes]);

  const variableOptions = variableMeta.options;
  const declaredVarTypes = variableMeta.declaredTypes;

  // ReactFlow needs an explicit nudge when handles change (dynamic pins),
  // otherwise newly created edges can exist in state but fail to render.
  const handlesKey = useMemo(() => {
    const inputs = data.inputs.map((p) => p.id).join('|');
    const outputs = data.outputs.map((p) => p.id).join('|');
    return `${inputs}__${outputs}`;
  }, [data.inputs, data.outputs]);

  // Node width can change when pin connections toggle inline controls (quick defaults),
  // so nudge ReactFlow to re-measure when connections for this node change.
  const connectedInputPinIds = useMemo(() => {
    const ids = edges
      .filter((e) => e.target === id && typeof e.targetHandle === 'string')
      .map((e) => e.targetHandle as string)
      .sort();
    return new Set(ids);
  }, [edges, id]);
  const connectedOutputPinIds = useMemo(() => {
    const ids = edges
      .filter((e) => e.source === id && typeof e.sourceHandle === 'string')
      .map((e) => e.sourceHandle as string)
      .sort();
    return new Set(ids);
  }, [edges, id]);
  const connectedInputsKey = useMemo(() => Array.from(connectedInputPinIds).join('|'), [connectedInputPinIds]);
  const connectedOutputsKey = useMemo(() => Array.from(connectedOutputPinIds).join('|'), [connectedOutputPinIds]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handlesKey, connectedInputsKey, updateNodeInternals]);

  // Check if a pin is connected
  const isPinConnected = (pinId: string, isInput: boolean): boolean => {
    return isInput ? connectedInputPinIds.has(pinId) : connectedOutputPinIds.has(pinId);
  };

  const handlePinClick = (e: MouseEvent, pinId: string, isInput: boolean) => {
    // React Flow starts connection drags on mousedown. Keep disconnect as a
    // click-only action so connected pins can still start a drag/reconnect.
    if (e.type !== 'click') return;
    if (!isPinConnected(pinId, isInput)) return;
    e.preventDefault();
    e.stopPropagation();
    disconnectPin(id, pinId, isInput);
  };

  const getSchemaByPath = useCallback((schema: JsonSchema, path: string): JsonSchema | undefined => {
    if (!path) return undefined;
    const parts = path.split('.');
    let cur: JsonSchema | undefined = schema;

    for (const part of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      const type = cur.type;

      if (type === 'object') {
        const properties: Record<string, JsonSchema> | undefined = cur.properties;
        if (!properties) return undefined;
        cur = properties[part];
        continue;
      }

      if (type === 'array') {
        if (!/^\d+$/.test(part)) return undefined;
        cur = cur.items;
        continue;
      }

      return undefined;
    }

    return cur;
  }, []);

  const schemaTooltipForPath = useCallback(
    (schema: JsonSchema, path: string): string => {
      const leaf = getSchemaByPath(schema, path);
      if (!leaf) return '';

      const type = typeof leaf.type === 'string' ? leaf.type.trim() : '';
      const format = typeof leaf.format === 'string' ? leaf.format.trim() : '';
      const title = typeof leaf.title === 'string' ? leaf.title.trim() : '';
      const desc = typeof leaf.description === 'string' ? leaf.description.trim() : '';

      let typeLabel = type;
      if (type === 'array') {
        const itemTitle =
          leaf.items && typeof leaf.items === 'object' && typeof leaf.items.title === 'string' ? String(leaf.items.title) : '';
        const itemType =
          leaf.items && typeof leaf.items === 'object' && typeof leaf.items.type === 'string' ? String(leaf.items.type) : '';
        const inner = (itemTitle || itemType || '').trim();
        typeLabel = inner ? `array<${inner}>` : 'array';
      } else if (type === 'object' && title) {
        typeLabel = `object (${title})`;
      }

      const lines: string[] = [];
      lines.push(path);
      if (typeLabel) lines.push(`Type: ${typeLabel}${format ? ` (${format})` : ''}`);
      if (desc) lines.push(desc);
      return lines.join('\n');
    },
    [getSchemaByPath]
  );

  const breakObjectSchema = useMemo((): JsonSchema | null => {
    if (data.nodeType !== 'break_object') return null;
    const inputEdge = edges.find((e) => e.target === id && e.targetHandle === 'object');
    if (!inputEdge) return null;
    const sourceHandle = typeof inputEdge.sourceHandle === 'string' ? inputEdge.sourceHandle : '';
    const sourceNode = allNodes.find((n) => n.id === inputEdge.source);
    if (!sourceNode) return null;

    return (inferSchemaForNodeOutput(sourceNode, sourceHandle, allNodes, edges) as JsonSchema | undefined) ?? null;
  }, [allNodes, data.nodeType, edges, id]);

  const isEmitEventNode = data.nodeType === 'emit_event';
  const mediaPresentationNode = isMediaPresentationNode(data.nodeType);

  const normalizedMediaPins = useMemo(() => {
    if (!mediaPresentationNode) return null;
    const template = getNodeTemplate(data.nodeType);
    if (!template) return null;
    const normalized = mergePinDocsFromTemplate(createNodeData(template), data);
    return {
      inputs: normalized.inputs,
      outputs: normalized.outputs,
    };
  }, [data, mediaPresentationNode]);

  useEffect(() => {
    if (!normalizedMediaPins) return;
    const currentInputs = Array.isArray(data.inputs) ? data.inputs : [];
    const currentOutputs = Array.isArray(data.outputs) ? data.outputs : [];
    if (
      pinListSignature(currentInputs) === pinListSignature(normalizedMediaPins.inputs) &&
      pinListSignature(currentOutputs) === pinListSignature(normalizedMediaPins.outputs)
    ) {
      return;
    }
    updateNodeData(id, { inputs: normalizedMediaPins.inputs, outputs: normalizedMediaPins.outputs });
    updateNodeInternals(id);
  }, [data.inputs, data.outputs, id, normalizedMediaPins, updateNodeData, updateNodeInternals]);

  const nodeInputs = normalizedMediaPins?.inputs || data.inputs;
  const nodeOutputs = normalizedMediaPins?.outputs || data.outputs;

  // Separate execution pins from data pins
  const inputExec = isTriggerNode ? undefined : nodeInputs.find((p) => p.type === 'execution');
  const outputExecs = nodeOutputs.filter((p) => p.type === 'execution');
  const pinDisclosure = useMemo(
    () =>
	      getNodePinDisclosure({
	        data,
	        inputs: nodeInputs,
	        outputs: nodeOutputs,
	        connectedInputPinIds,
	        connectedOutputPinIds,
        thinkingSupport: { supported: thinkingSupported },
	        expanded: showAdvancedPins,
	      }),
	    [connectedInputPinIds, connectedOutputPinIds, data, nodeInputs, nodeOutputs, showAdvancedPins, thinkingSupported]
  );
  const inputData = useMemo(() => pinDisclosure.inputPins.filter((p) => p.type !== 'execution'), [pinDisclosure.inputPins]);
  const outputData = useMemo(() => pinDisclosure.outputPins.filter((p) => p.type !== 'execution'), [pinDisclosure.outputPins]);
  const isPlainJsonLiteralNode =
    data.nodeType === 'literal_json' &&
    outputData.some((pin) => pin.id === 'value' && pin.type === 'object');
  const isJsonSchemaNode = data.nodeType === 'json_schema';
  const isEditJsonSchemaNode = data.nodeType === 'edit_json_schema';
  const canEditJsonLiteralOnNode = isPlainJsonLiteralNode || isJsonSchemaNode || isEditJsonSchemaNode;
  const schemaEditorPin = useMemo(
    () => inputData.find((pin) => pin.id === schemaEditorPinId) || null,
    [inputData, schemaEditorPinId]
  );
  const jsonDefaultEditorPin = useMemo(
    () => inputData.find((pin) => pin.id === jsonDefaultEditorPinId) || null,
    [inputData, jsonDefaultEditorPinId]
  );
  const showPinDisclosure = pinDisclosure.expandable;
  const pinDisclosureLabel = showAdvancedPins
    ? 'Hide optional pins'
    : 'Show optional pins';
  const renderedPinKey = useMemo(
    () => `${inputData.map((p) => p.id).join('|')}::${outputData.map((p) => p.id).join('|')}`,
    [inputData, outputData]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [connectedOutputsKey, id, renderedPinKey, showAdvancedPins, updateNodeInternals]);

  const toggleAdvancedPins = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setShowAdvancedPins((value) => !value);
      updateNodeInternals(id);
    },
    [id, updateNodeInternals]
  );

  const codeParams = useMemo(() => getPythonCodeUserPins(data.inputs), [data.inputs]);
  const codePermissions = useMemo(() => {
    const raw = data.pinDefaults?.permissions;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : 'sandbox';
  }, [data.pinDefaults?.permissions]);
  const currentCodeBody = useMemo(() => {
    if (typeof data.codeBody === 'string') return data.codeBody;
    if (typeof data.code === 'string') return extractFunctionBody(data.code, data.functionName || 'transform') ?? '';
    return '';
  }, [data.code, data.codeBody, data.functionName]);

  const isToolsAllowlistNode = data.nodeType === 'tools_allowlist';
  const isToolParametersNode = data.nodeType === 'tool_parameters';
  const isBoolVarNode = data.nodeType === 'bool_var';
  const isVarDeclNode = data.nodeType === 'var_decl';
  const isProviderModelsNode = data.nodeType === 'provider_models';
  const isModelResidencyNode = data.nodeType === 'model_residency';
  const isGenerateImageNode = data.nodeType === 'generate_image';
  const isEditImageNode = data.nodeType === 'edit_image' || data.nodeType === 'image_to_image';
  const isUpscaleImageNode = data.nodeType === 'upscale_image';
  const isGenerateVideoNode = data.nodeType === 'generate_video' || data.nodeType === 'text_to_video';
  const isImageToVideoNode = data.nodeType === 'image_to_video';
  const isVideoNode = isGenerateVideoNode || isImageToVideoNode;
  const isGenerateVoiceNode = data.nodeType === 'generate_voice';
  const isGenerateMusicNode = data.nodeType === 'generate_music';
  const isTranscribeAudioNode = data.nodeType === 'transcribe_audio';
  const isListenVoiceNode = data.nodeType === 'listen_voice';
  const isMediaNode = isGenerateImageNode || isEditImageNode || isUpscaleImageNode || isVideoNode || isGenerateVoiceNode || isGenerateMusicNode || isTranscribeAudioNode || isListenVoiceNode;
  const imageProviderPinConnected = connectedInputPinIds.has('image_provider');
  const isDelayNode = data.nodeType === 'wait_until';
  const isOnEventNode = data.nodeType === 'on_event';
  const isOnScheduleNode = data.nodeType === 'on_schedule';
  const isAnswerUserNode = data.nodeType === 'answer_user';
  const isSubflowNode = data.nodeType === 'subflow';
  const isWriteFileNode = data.nodeType === 'write_file';
  const isMemoryNoteNode = data.nodeType === 'memory_note';
  const isMemoryQueryNode = data.nodeType === 'memory_query';
  const isMemoryTagNode = data.nodeType === 'memory_tag';
  const isMemoryRehydrateNode = data.nodeType === 'memory_rehydrate';
  const isMemoryKgAssertNode = data.nodeType === 'memory_kg_assert';
  const isMemoryKgQueryNode = data.nodeType === 'memory_kg_query';
  const isMemoryKgResolveNode = data.nodeType === 'memory_kg_resolve';
  // NOTE: Subflow control pins (inherit_context) are configured via pin defaults on the pin row.
  // We intentionally avoid a separate non-pin checkbox to keep the UI single-source-of-truth.

  const subflowHasProviderPin =
    isSubflowNode && data.inputs.some((p) => p.id === 'provider' || p.type === 'provider' || p.type === 'provider_text');
  const subflowHasModelPin =
    isSubflowNode && data.inputs.some((p) => p.id === 'model' || p.type === 'model' || p.type === 'model_text');
  const subflowHasToolsPin = isSubflowNode && data.inputs.some((p) => p.id === 'tools' || p.type === 'tools');

  const hasModelControls = isLlmNode || isAgentNode || subflowHasModelPin;
  const hasProviderDropdown = hasModelControls || isProviderModelsNode || subflowHasProviderPin;

  const providerConnected = hasProviderDropdown ? isPinConnected('provider', true) : false;
  const modelConnected = hasModelControls ? isPinConnected('model', true) : false;
  const toolsConnected = (isAgentNode || isLlmNode || subflowHasToolsPin) ? isPinConnected('tools', true) : false;

  const pinnedProvider = typeof pinDefaults.provider === 'string' ? pinDefaults.provider.trim() : '';
  const pinnedModel = typeof pinDefaults.model === 'string' ? pinDefaults.model.trim() : '';
  const selectedProvider = isAgentNode
    ? data.agentConfig?.provider
    : isLlmNode
      ? data.effectConfig?.provider
      : isProviderModelsNode
        ? data.providerModelsConfig?.provider
        : subflowHasProviderPin
          ? pinnedProvider
          : '';
  const selectedModel = isAgentNode
    ? data.agentConfig?.model
    : isLlmNode
      ? data.effectConfig?.model
      : subflowHasModelPin
        ? pinnedModel
        : '';
  const wantsTextProviderCatalog = useMemo(
    () =>
      inputData.some(
        (pin) =>
          providerCatalogScopeForPin(pin, data.nodeType) === 'text' &&
          !connectedInputPinIds.has(pin.id) &&
          !(hasProviderDropdown && pin.id === 'provider') &&
          !(isModelResidencyNode && pin.id === 'provider')
      ),
    [connectedInputPinIds, data.nodeType, hasProviderDropdown, inputData, isModelResidencyNode]
  );
  const wantsTextModelCatalog = useMemo(
    () =>
      inputData.some(
        (pin) =>
          modelCatalogScopeForPin(pin, inputData, data.nodeType) === 'text' &&
          !connectedInputPinIds.has(pin.id) &&
          !(hasModelControls && pin.id === 'model') &&
          !(isModelResidencyNode && pin.id === 'model')
      ),
    [connectedInputPinIds, data.nodeType, hasModelControls, inputData, isModelResidencyNode]
  );
  const selectedTextCatalogProvider = useMemo(() => {
    const configuredProvider = firstConfigString(selectedProvider, pinDefaults.provider);
    if (configuredProvider) return configuredProvider;

    for (const pin of inputData) {
      if (providerCatalogScopeForPin(pin, data.nodeType) !== 'text') continue;
      const value = firstConfigString(pinDefaults[pin.id]);
      if (value) return value;
    }

    for (const pin of inputData) {
      if (modelCatalogScopeForPin(pin, inputData, data.nodeType) !== 'text') continue;
      const providerPinId = providerPinIdForModelPin(pin, inputData, data.nodeType);
      if (!providerPinId) continue;
      const value = firstConfigString(pinDefaults[providerPinId]);
      if (value) return value;
    }

    return '';
  }, [data.nodeType, inputData, pinDefaults, selectedProvider]);
  const wantsMediaCatalogCapabilities = useMemo(
    () =>
      inputData.some((pin) => {
        const providerScope = providerCatalogScopeForPin(pin, data.nodeType);
        if (providerScope && providerScope !== 'text') return true;
        const modelScope = modelCatalogScopeForPin(pin, inputData, data.nodeType);
        return Boolean(modelScope && modelScope !== 'text');
      }),
    [data.nodeType, inputData]
  );
  const wantsResidencyCapabilities =
    isLlmNode ||
    isAgentNode ||
    isSubflowNode ||
    isMediaNode ||
    isModelResidencyNode ||
    isCodeNode ||
    wantsMediaCatalogCapabilities;
  const mediaCapabilitiesQuery = useGatewayCapabilities(wantsResidencyCapabilities);
  const gatewayContracts = gatewayContractsFromCapabilities(mediaCapabilitiesQuery.data);
  const gatewayReadiness = getGatewayFlowEditorReadiness(gatewayContracts);
  const visualflowCollectionEndpoint = gatewayContracts?.flow_editor?.visualflows?.crud?.collection_endpoint || '';
  const visualflowItemEndpoint = gatewayContracts?.flow_editor?.visualflows?.crud?.item_endpoint || '';
  const subflowPinsSyncedRef = useRef<string | null>(null);
  const subflowFlowListQuery = useQuery({
    queryKey: ['visualflows', visualflowCollectionEndpoint],
    queryFn: () => gatewayJson<VisualFlow[]>(gatewayPath(visualflowCollectionEndpoint)),
    enabled:
      isSubflowNode &&
      gatewayReadiness.operations.save.ready &&
      Boolean(visualflowCollectionEndpoint),
    staleTime: 30_000,
  });
  const subflowFlowOptions = useMemo(
    () =>
      savedFlowSummariesFromResponse(subflowFlowListQuery.data).map((flow) => ({
        value: flow.id,
        label: `${flow.name}${flowId && flow.id === flowId ? ' (recursive)' : ''}`,
      })),
    [flowId, subflowFlowListQuery.data]
  );
  const subflowSelectorLoading =
    mediaCapabilitiesQuery.isLoading || (isSubflowNode && subflowFlowListQuery.isLoading);
  const subflowSelectorDisabled =
    mediaCapabilitiesQuery.isLoading ||
    !gatewayReadiness.operations.save.ready ||
    !visualflowCollectionEndpoint;

  useEffect(() => {
    if (!isSubflowNode) return;
    const subflowId = typeof data.subflowId === 'string' ? data.subflowId.trim() : '';
    if (!subflowId) return;
    if (!gatewayReadiness.operations.save.ready || !visualflowItemEndpoint) return;

    const syncKey = `${id}:${subflowId}`;
    if (subflowPinsSyncedRef.current === syncKey) return;

    let cancelled = false;
    gatewayJson<VisualFlow>(gatewayPath(visualflowItemEndpoint, { flow_id: subflowId }))
      .then((flow) => {
        if (cancelled) return;
        const patch = subflowPinPatchForSelectedFlow(data, flow);
        if (patch) updateNodeData(id, patch);
        subflowPinsSyncedRef.current = syncKey;
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to sync subflow pins:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [
    data,
    data.subflowId,
    gatewayReadiness.operations.save.ready,
    id,
    isSubflowNode,
    updateNodeData,
    visualflowItemEndpoint,
  ]);
  const codePermissionSelectOptions = useMemo(
    () => codePermissionOptions(gatewayContracts, codePermissions),
    [codePermissions, gatewayContracts]
  );
  const codePermissionsUnavailableReason = useMemo(
    () => codePermissionUnavailableReason(gatewayContracts, codePermissions),
    [codePermissions, gatewayContracts]
  );
  const codePermissionsConnected = isCodeNode && isPinConnected('permissions', true);
  const codeTestUnavailableReason = codePermissionsConnected
    ? 'Code permissions are wired from a runtime input. Disconnect the permissions pin or set a static default to run an editor test.'
    : codePermissionsUnavailableReason;
  const residencyAuthoringTarget = useMemo(() => {
    if (isLlmNode) {
      const blocked = providerConnected || modelConnected;
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, 'text_generation');
      return {
        task: 'text_generation',
        provider: blocked ? '' : firstConfigString(data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isAgentNode) {
      const blocked = providerConnected || modelConnected;
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, 'text_generation');
      return {
        task: 'text_generation',
        provider: blocked ? '' : firstConfigString(data.agentConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.agentConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isGenerateImageNode || isEditImageNode || isUpscaleImageNode) {
      const providerBlocked = isPinConnected('image_provider', true);
      const modelBlocked = isPinConnected('image_model', true);
      const blocked = providerBlocked || modelBlocked;
      const task = isUpscaleImageNode ? 'image_upscale' : isEditImageNode ? 'image_to_image' : 'image_generation';
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, task);
      return {
        task,
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.image_provider, pinDefaults.image_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.image_model, pinDefaults.image_model),
        blockedReason: blocked ? 'Dynamic image provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isVideoNode) {
      const providerBlocked = isPinConnected('video_provider', true);
      const modelBlocked = isPinConnected('video_model', true);
      const blocked = providerBlocked || modelBlocked;
      const task = isImageToVideoNode ? 'image_to_video' : 'text_to_video';
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, task);
      return {
        task,
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.video_provider, pinDefaults.video_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.video_model, pinDefaults.video_model),
        blockedReason: blocked ? 'Dynamic video provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isGenerateVoiceNode) {
      const providerBlocked = isPinConnected('tts_provider', true);
      const modelBlocked = isPinConnected('tts_model', true);
      const blocked = providerBlocked || modelBlocked;
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, 'tts');
      return {
        task: 'tts',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.tts_provider, pinDefaults.tts_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.tts_model, pinDefaults.tts_model),
        blockedReason: blocked ? 'Dynamic voice provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isGenerateMusicNode) {
      const providerBlocked = isPinConnected('music_provider', true);
      const modelBlocked = isPinConnected('music_model', true);
      const blocked = providerBlocked || modelBlocked;
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, 'music_generation');
      return {
        task: 'music_generation',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.music_provider, pinDefaults.music_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.music_model, pinDefaults.music_model),
        blockedReason: blocked ? 'Dynamic music provider/model is wired from pins.' : unsupportedReason,
      };
    }
    if (isTranscribeAudioNode || isListenVoiceNode) {
      const providerBlocked = isPinConnected('stt_provider', true);
      const modelBlocked = isPinConnected('stt_model', true);
      const blocked = providerBlocked || modelBlocked;
      const unsupportedReason = modelResidencyTaskUnsupportedReason(gatewayContracts, 'stt');
      return {
        task: 'stt',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.stt_provider, pinDefaults.stt_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.stt_model, pinDefaults.stt_model),
        blockedReason: blocked ? 'Dynamic transcription provider/model is wired from pins.' : unsupportedReason,
      };
    }
    return null;
  }, [
    data.agentConfig?.model,
    data.agentConfig?.provider,
    data.effectConfig?.image_model,
    data.effectConfig?.image_provider,
    data.effectConfig?.model,
    data.effectConfig?.music_model,
    data.effectConfig?.music_provider,
    data.effectConfig?.provider,
    data.effectConfig?.stt_model,
    data.effectConfig?.stt_provider,
    data.effectConfig?.tts_model,
    data.effectConfig?.tts_provider,
    data.effectConfig?.video_model,
    data.effectConfig?.video_provider,
    gatewayContracts,
    isAgentNode,
    isEditImageNode,
    isGenerateImageNode,
    isUpscaleImageNode,
    isImageToVideoNode,
    isGenerateMusicNode,
    isVideoNode,
    isGenerateVoiceNode,
    isListenVoiceNode,
    isLlmNode,
    isTranscribeAudioNode,
    modelConnected,
    pinDefaults.image_model,
    pinDefaults.image_provider,
    pinDefaults.model,
    pinDefaults.music_model,
    pinDefaults.music_provider,
    pinDefaults.provider,
    pinDefaults.video_model,
    pinDefaults.video_provider,
    pinDefaults.stt_model,
    pinDefaults.stt_provider,
    pinDefaults.tts_model,
    pinDefaults.tts_provider,
    providerConnected,
    edges,
    id,
  ]);

  const handleAddModelResidencyStep = useCallback(
    (operation: ModelResidencyOperation) => {
      const target = residencyAuthoringTarget;
      if (!target) return;
      if (target.blockedReason) {
        const dynamicReason = target.blockedReason.startsWith('Dynamic ');
        toast.error(
          dynamicReason
            ? `${target.blockedReason} Add a dedicated Model Residency node for explicit control.`
            : target.blockedReason
        );
        return;
      }
      const selectedNode = allNodes.find((n) => n.id === id);
      if (!selectedNode) {
        toast.error('Selected node was not found in the current graph.');
        return;
      }
      try {
        const result = insertModelResidencyStep({
          nodes: allNodes,
          edges,
          selectedNode,
          operation,
          target: {
            task: target.task,
            provider: target.provider,
            model: target.model,
          },
        });
        setNodes(result.nodes);
        setEdges(result.edges);
        toast.success(operation === 'load' ? 'Load step added before this node' : 'Unload step added after this node');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not add model residency step.');
      }
    },
    [allNodes, edges, id, residencyAuthoringTarget, setEdges, setNodes]
  );

  const selectedImageProvider = firstConfigString(data.effectConfig?.image_provider, pinDefaults.image_provider, pinDefaults.provider_image);
  const selectedImageModel = firstConfigString(data.effectConfig?.image_model, pinDefaults.image_model, pinDefaults.model_image);
  const selectedVideoProvider = firstConfigString(data.effectConfig?.video_provider, pinDefaults.video_provider, pinDefaults.provider_video);
  const selectedVideoModel = firstConfigString(data.effectConfig?.video_model, pinDefaults.video_model, pinDefaults.model_video);
  const selectedTtsProvider = firstConfigString(data.effectConfig?.tts_provider, pinDefaults.tts_provider, pinDefaults.provider_voice);
  const selectedTtsModel = firstConfigString(data.effectConfig?.tts_model, pinDefaults.tts_model, pinDefaults.model_voice);
  const selectedVoice = firstConfigString(data.effectConfig?.voice, pinDefaults.voice);
  const selectedProfile = firstConfigString(data.effectConfig?.profile, pinDefaults.profile);
  const selectedTtsQualityPreset =
    typeof data.effectConfig?.quality_preset === 'string'
      ? data.effectConfig.quality_preset
      : typeof data.pinDefaults?.quality_preset === 'string'
        ? data.pinDefaults.quality_preset
        : 'standard';
  const selectedSttProvider = firstConfigString(data.effectConfig?.stt_provider, pinDefaults.stt_provider, pinDefaults.provider_voice);
  const selectedSttModel = firstConfigString(data.effectConfig?.stt_model, pinDefaults.stt_model, pinDefaults.model_voice);
  const selectedMusicProvider = firstConfigString(data.effectConfig?.music_provider, pinDefaults.music_provider, pinDefaults.provider_music);
  const selectedMusicModel = firstConfigString(data.effectConfig?.music_model, pinDefaults.music_model, pinDefaults.model_music);
  const selectedResidencyOperation = firstConfigString(data.effectConfig?.operation, pinDefaults.operation) || 'load';
  const selectedResidencyTask = firstConfigString(data.effectConfig?.task, pinDefaults.task) || 'text_generation';
  const selectedResidencyProvider = firstConfigString(data.effectConfig?.provider, pinDefaults.provider);
  const selectedResidencyModel = firstConfigString(data.effectConfig?.model, pinDefaults.model);

  const generatedImageContract =
    gatewayContracts?.flow_editor?.media?.generated_image || gatewayContracts?.assistant?.media?.generated_image;
  const editedImageContract =
    gatewayContracts?.flow_editor?.media?.edited_image || gatewayContracts?.assistant?.media?.edited_image;
  const upscaledImageContract =
    gatewayContracts?.flow_editor?.media?.upscaled_image || gatewayContracts?.assistant?.media?.upscaled_image;
  const generatedVideoContract =
    gatewayContracts?.flow_editor?.media?.generated_video || gatewayContracts?.assistant?.media?.generated_video;
  const imageToVideoContract =
    gatewayContracts?.flow_editor?.media?.image_to_video || gatewayContracts?.assistant?.media?.image_to_video;
  const generatedVoiceContract =
    gatewayContracts?.flow_editor?.media?.generated_voice || gatewayContracts?.assistant?.media?.generated_voice;
  const generatedMusicContract =
    gatewayContracts?.flow_editor?.media?.generated_music || gatewayContracts?.assistant?.media?.generated_music;
  const mediaDiscovery = gatewayContracts?.common?.discovery || {};
  const voiceCatalogEndpoint = mediaDiscovery.voice_voices || '';
  const ttsModelsEndpoint = mediaDiscovery.audio_speech_models || '';
  const sttModelsEndpoint = mediaDiscovery.audio_transcription_models || '';
  const musicProvidersEndpoint =
    mediaDiscovery.audio_music_providers ||
    (typeof generatedMusicContract?.direct_endpoint?.providers_endpoint === 'string' ? generatedMusicContract.direct_endpoint.providers_endpoint : '');
  const musicModelsEndpoint =
    mediaDiscovery.audio_music_models ||
    (typeof generatedMusicContract?.direct_endpoint?.provider_models_endpoint === 'string' ? generatedMusicContract.direct_endpoint.provider_models_endpoint : '');
  const musicProviderModelsTask =
    typeof generatedMusicContract?.direct_endpoint?.provider_models_task === 'string' && generatedMusicContract.direct_endpoint.provider_models_task.trim()
      ? generatedMusicContract.direct_endpoint.provider_models_task.trim()
      : 'text_to_music';
  const generatedImageProviderModelsTask =
    typeof generatedImageContract?.direct_endpoint?.provider_models_task === 'string' && generatedImageContract.direct_endpoint.provider_models_task.trim()
      ? generatedImageContract.direct_endpoint.provider_models_task.trim()
      : 'text_to_image';
  const editedImageProviderModelsTask =
    typeof editedImageContract?.direct_endpoint?.provider_models_task === 'string' && editedImageContract.direct_endpoint.provider_models_task.trim()
      ? editedImageContract.direct_endpoint.provider_models_task.trim()
      : 'image_to_image';
  const upscaledImageProviderModelsTask =
    typeof upscaledImageContract?.direct_endpoint?.provider_models_task === 'string' && upscaledImageContract.direct_endpoint.provider_models_task.trim()
      ? upscaledImageContract.direct_endpoint.provider_models_task.trim()
      : 'image_upscale';
  const currentImageProviderModelsTask = isUpscaleImageNode
    ? upscaledImageProviderModelsTask
    : isEditImageNode
      ? editedImageProviderModelsTask
      : generatedImageProviderModelsTask;
  const generatedVideoProviderModelsTask =
    typeof generatedVideoContract?.direct_endpoint?.provider_models_task === 'string' && generatedVideoContract.direct_endpoint.provider_models_task.trim()
      ? generatedVideoContract.direct_endpoint.provider_models_task.trim()
      : 'text_to_video';
  const imageToVideoProviderModelsTask =
    typeof imageToVideoContract?.direct_endpoint?.provider_models_task === 'string' && imageToVideoContract.direct_endpoint.provider_models_task.trim()
      ? imageToVideoContract.direct_endpoint.provider_models_task.trim()
      : 'image_to_video';
  const currentVideoProviderModelsTask = isImageToVideoNode ? imageToVideoProviderModelsTask : generatedVideoProviderModelsTask;
  const currentVisionProviderModelsTask = isVideoNode ? currentVideoProviderModelsTask : currentImageProviderModelsTask;
  const visionProviderModelsEndpoint = mediaDiscovery.vision_provider_models || '';
  const visionModelsEndpoint = mediaDiscovery.vision_models || '';

  const [mediaCatalogQueue, setMediaCatalogQueue] = useState<MediaCatalogRequest[]>([]);
  const [activeMediaCatalogRequest, setActiveMediaCatalogRequest] = useState<MediaCatalogRequest | null>(null);
  const [imageProviderCatalogOptions, setImageProviderCatalogOptions] = useState<SelectOption[]>([]);
  const [imageModelOptions, setImageModelOptions] = useState<MediaModelOption[]>([]);
  const [ttsProviderOptions, setTtsProviderOptions] = useState<SelectOption[]>([]);
  const [ttsModelOptions, setTtsModelOptions] = useState<MediaModelOption[]>([]);
  const [sttProviderOptions, setSttProviderOptions] = useState<SelectOption[]>([]);
  const [sttModelOptions, setSttModelOptions] = useState<MediaModelOption[]>([]);
  const [musicProviderOptions, setMusicProviderOptions] = useState<SelectOption[]>([]);
  const [musicModelOptions, setMusicModelOptions] = useState<MediaModelOption[]>([]);
  const [voiceOptions, setVoiceOptions] = useState<MediaModelOption[]>([]);
  const [profileOptions, setProfileOptions] = useState<MediaModelOption[]>([]);
  const [ttsFormatsByProvider, setTtsFormatsByProvider] = useState<ProviderOptionMap>({});
  const [loadedMediaCatalogKeys, setLoadedMediaCatalogKeys] = useState<Set<string>>(() => new Set());
  const mediaCatalogSeqRef = useRef(0);
  const queuedMediaCatalogRequestKeysRef = useRef<Set<string>>(new Set());
  const activeMediaCatalogRequestKeysRef = useRef<Set<string>>(new Set());
  const mediaLoading = activeMediaCatalogRequest !== null;

  const residencyTextCatalogEnabled = isModelResidencyNode && selectedResidencyTask === 'text_generation';
  const providersQuery = useProviders(
    (hasProviderDropdown && (!providerConnected || !modelConnected)) ||
      wantsTextProviderCatalog ||
      wantsTextModelCatalog ||
      (residencyTextCatalogEnabled && (!isPinConnected('provider', true) || !isPinConnected('model', true)))
  );
  const modelsQuery = useModels(
    isModelResidencyNode ? selectedResidencyProvider : selectedProvider || selectedTextCatalogProvider,
    (hasModelControls && !modelConnected) ||
      wantsTextModelCatalog ||
      (isProviderModelsNode && !providerConnected) ||
      (residencyTextCatalogEnabled && Boolean(selectedResidencyProvider) && !isPinConnected('model', true)),
    isProviderModelsNode ? data.providerModelsConfig?.capabilityRoute || TEXT_OUTPUT_CAPABILITY_ROUTE : TEXT_OUTPUT_CAPABILITY_ROUTE
  );
  const toolsQuery = useTools((isAgentNode || isLlmNode || isToolsAllowlistNode || isVarDeclNode || isToolParametersNode || subflowHasToolsPin) && !toolsConnected);

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const tools = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];

  const modelOptions = useMemo(() => models.map((m) => ({ value: m, label: m })), [models]);
  const hasLoadedMediaCatalog = useCallback(
    (scope: MediaCatalogScope, kind: MediaCatalogKind, provider = '', model = '', task = '') =>
      loadedMediaCatalogKeys.has(mediaCatalogLoadedKey(scope, kind, provider, model, task)),
    [loadedMediaCatalogKeys]
  );
  const markMediaCatalogLoaded = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setLoadedMediaCatalogKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const key of keys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);
  const requestMediaCatalog = useCallback((scope: MediaCatalogScope, options: Omit<MediaCatalogRequest, 'seq' | 'scope'> = {}) => {
    const requestKey = mediaCatalogRequestKey(scope, options);
    if (queuedMediaCatalogRequestKeysRef.current.has(requestKey) || activeMediaCatalogRequestKeysRef.current.has(requestKey)) return;
    queuedMediaCatalogRequestKeysRef.current.add(requestKey);
    mediaCatalogSeqRef.current += 1;
    const request: MediaCatalogRequest = {
      seq: mediaCatalogSeqRef.current,
      scope,
      ...options,
    };
    setMediaCatalogQueue((prev) => [...prev, request]);
  }, []);
  const visibleMediaProviderCatalogScopes = useMemo(() => {
    const scopes = new Set<MediaCatalogScope>();
    for (const pin of inputData) {
      if (connectedInputPinIds.has(pin.id)) continue;
      const scope = providerCatalogScopeForPin(pin, data.nodeType);
      if (scope && scope !== 'text') scopes.add(scope);
    }
    return Array.from(scopes).sort();
  }, [connectedInputPinIds, data.nodeType, inputData]);

  useEffect(() => {
    if (!selected || mediaLoading || mediaCapabilitiesQuery.isLoading) return;
    if (
      visibleMediaProviderCatalogScopes.includes('image') &&
      imageProviderCatalogOptions.length === 0 &&
      !hasLoadedMediaCatalog('image', 'providers', '', '', currentVisionProviderModelsTask) &&
      visionProviderModelsEndpoint
    ) {
      requestMediaCatalog('image', { providersOnly: true, task: currentVisionProviderModelsTask });
      return;
    }
    if (
      isGenerateVoiceNode &&
      ttsProviderOptions.length === 0 &&
      !hasLoadedMediaCatalog('tts', 'providers') &&
      (voiceCatalogEndpoint || ttsModelsEndpoint)
    ) {
      requestMediaCatalog('tts', { providersOnly: true });
      return;
    }
    if (
      isModelResidencyNode &&
      selectedResidencyTask === 'tts' &&
      ttsProviderOptions.length === 0 &&
      !hasLoadedMediaCatalog('tts', 'providers') &&
      (voiceCatalogEndpoint || ttsModelsEndpoint)
    ) {
      requestMediaCatalog('tts', { providersOnly: true });
      return;
    }
    if (
      visibleMediaProviderCatalogScopes.includes('tts') &&
      ttsProviderOptions.length === 0 &&
      !hasLoadedMediaCatalog('tts', 'providers') &&
      (voiceCatalogEndpoint || ttsModelsEndpoint)
    ) {
      requestMediaCatalog('tts', { providersOnly: true });
      return;
    }
    if (
      visibleMediaProviderCatalogScopes.includes('stt') &&
      sttProviderOptions.length === 0 &&
      !hasLoadedMediaCatalog('stt', 'providers') &&
      sttModelsEndpoint
    ) {
      requestMediaCatalog('stt', { providersOnly: true });
      return;
    }
    if (
      visibleMediaProviderCatalogScopes.includes('music') &&
      musicProviderOptions.length === 0 &&
      !hasLoadedMediaCatalog('music', 'providers') &&
      musicProvidersEndpoint
    ) {
      requestMediaCatalog('music', { providersOnly: true });
    }
  }, [
    currentVisionProviderModelsTask,
    hasLoadedMediaCatalog,
    imageProviderCatalogOptions.length,
    isGenerateVoiceNode,
    isModelResidencyNode,
    mediaCapabilitiesQuery.isLoading,
    mediaLoading,
    musicProvidersEndpoint,
    musicProviderOptions.length,
    requestMediaCatalog,
    selected,
    selectedResidencyTask,
    sttModelsEndpoint,
    sttProviderOptions.length,
    ttsModelsEndpoint,
    ttsProviderOptions.length,
    visibleMediaProviderCatalogScopes,
    visionProviderModelsEndpoint,
    voiceCatalogEndpoint,
  ]);

  const imageProviderOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: SelectOption[] = [];
    const task = normalizeMediaCatalogTask(currentImageProviderModelsTask);
    const add = (provider: string, label?: string) => {
      const clean = normalizeMediaProvider(provider);
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    for (const option of imageProviderCatalogOptions) add(option.value, option.label);
    for (const option of imageModelOptions) {
      if (task && normalizeMediaCatalogTask(option.catalogTask) !== task) continue;
      add(option.provider);
    }
    if (selectedImageProvider) add(selectedImageProvider);
    if (selectedVideoProvider) add(selectedVideoProvider);
    return out;
  }, [currentImageProviderModelsTask, imageModelOptions, imageProviderCatalogOptions, selectedImageProvider, selectedVideoProvider]);
  const visibleImageModelOptions = useMemo(() => {
    const task = normalizeMediaCatalogTask(currentImageProviderModelsTask);
    const taskOptions = imageModelOptions.filter((option) => !task || normalizeMediaCatalogTask(option.catalogTask) === task);
    if (!selectedImageProvider) return taskOptions.map((option) => ({ value: option.model, label: option.label }));
    return imageModelOptions
      .filter(
        (option) =>
          (!task || normalizeMediaCatalogTask(option.catalogTask) === task) &&
          normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedImageProvider)
      )
      .map((option) => ({ value: option.model, label: option.label }));
  }, [currentImageProviderModelsTask, imageModelOptions, selectedImageProvider]);
  const visibleVideoModelOptions = useMemo(() => {
    const task = normalizeMediaCatalogTask(currentVideoProviderModelsTask);
    const taskOptions = imageModelOptions.filter((option) => !task || normalizeMediaCatalogTask(option.catalogTask) === task);
    if (!selectedVideoProvider) return taskOptions.map((option) => ({ value: option.model, label: option.label }));
    return imageModelOptions
      .filter(
        (option) =>
          (!task || normalizeMediaCatalogTask(option.catalogTask) === task) &&
          normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedVideoProvider)
      )
      .map((option) => ({ value: option.model, label: option.label }));
  }, [currentVideoProviderModelsTask, imageModelOptions, selectedVideoProvider]);
  const selectedResidencyVisionProviderModelsTask = useMemo(() => {
    if (selectedResidencyTask === 'image_generation') return generatedImageProviderModelsTask;
    if (selectedResidencyTask === 'image_to_image') return editedImageProviderModelsTask;
    if (selectedResidencyTask === 'image_upscale') return upscaledImageProviderModelsTask;
    if (selectedResidencyTask === 'text_to_video') return generatedVideoProviderModelsTask;
    if (selectedResidencyTask === 'image_to_video') return imageToVideoProviderModelsTask;
    return '';
  }, [
    editedImageProviderModelsTask,
    generatedImageProviderModelsTask,
    generatedVideoProviderModelsTask,
    imageToVideoProviderModelsTask,
    selectedResidencyTask,
    upscaledImageProviderModelsTask,
  ]);
  const residencyProviderOptions = useMemo(() => {
    if (
      selectedResidencyTask === 'image_generation' ||
      selectedResidencyTask === 'image_to_image' ||
      selectedResidencyTask === 'image_upscale' ||
      selectedResidencyTask === 'text_to_video' ||
      selectedResidencyTask === 'image_to_video'
    ) {
      const seen = new Set<string>();
      const out: SelectOption[] = [];
      const add = (value: string, label?: string) => {
        const clean = value.trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        out.push({ value: clean, label: label || clean });
      };
      for (const option of imageProviderOptions) add(option.value, option.label);
      if (selectedResidencyProvider) add(selectedResidencyProvider);
      return out;
    }
    if (selectedResidencyTask === 'tts') {
      return ttsProviderOptions.map((option) => ({ value: option.value, label: option.label }));
    }
    if (selectedResidencyTask === 'stt') {
      return sttProviderOptions.map((option) => ({ value: option.value, label: option.label }));
    }
    if (selectedResidencyTask === 'music_generation') {
      const seen = new Set<string>();
      const out: SelectOption[] = [];
      const add = (value: string, label?: string) => {
        const clean = normalizeMediaProvider(value);
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        out.push({ value: clean, label: label || clean });
      };
      for (const option of musicProviderOptions) add(option.value, option.label);
      if (selectedMusicProvider) add(selectedMusicProvider);
      if (selectedResidencyProvider) add(selectedResidencyProvider);
      return out;
    }
    if (selectedResidencyTask === 'text_generation') {
      return providers.map((p) => ({ value: p.name, label: p.display_name || p.name }));
    }
    return selectedResidencyProvider ? [{ value: selectedResidencyProvider, label: selectedResidencyProvider }] : [];
  }, [imageProviderOptions, musicProviderOptions, providers, selectedMusicProvider, selectedResidencyProvider, selectedResidencyTask, sttProviderOptions, ttsProviderOptions]);
  const visibleTtsModelOptions = useMemo(() => {
    const baseOptions = selectedTtsProvider
      ? ttsModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : ttsModelOptions;
    return withCurrentOption(
      baseOptions.map((option) => ({ value: option.model, label: option.label })),
      selectedTtsModel
    );
  }, [selectedTtsModel, selectedTtsProvider, ttsModelOptions]);
  const hasLoadedTtsModelsForProvider = useMemo(() => {
    const providerKey = normalizeMediaProvider(selectedTtsProvider);
    if (!providerKey) return ttsModelOptions.length > 0 || hasLoadedMediaCatalog('tts', 'models');
    return (
      hasLoadedMediaCatalog('tts', 'models', providerKey) ||
      ttsModelOptions.some((option) => normalizeMediaProvider(option.provider) === providerKey)
    );
  }, [hasLoadedMediaCatalog, selectedTtsProvider, ttsModelOptions]);
  const visibleVoiceOptions = useMemo(() => {
    const selectedScope = selectedTtsModel.trim().toLowerCase();
    const providerOptions = selectedTtsProvider
      ? voiceOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : voiceOptions;
    const scopedOptions = providerOptions.filter((option) => {
      const scope = (option.scopeModel || '').trim().toLowerCase();
      return !selectedScope || !scope || scope === selectedScope;
    });
    return withCurrentOption(
      (scopedOptions.length > 0 ? scopedOptions : providerOptions).map((option) => ({
        value: option.model,
        label: option.label,
      })),
      selectedVoice
    );
  }, [selectedTtsModel, selectedTtsProvider, selectedVoice, voiceOptions]);
  const visibleProfileOptions = useMemo(() => {
    const selectedScope = selectedTtsModel.trim().toLowerCase();
    const providerOptions = selectedTtsProvider
      ? profileOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : profileOptions;
    const scopedOptions = providerOptions.filter((option) => {
      const scope = (option.scopeModel || '').trim().toLowerCase();
      return !selectedScope || !scope || scope === selectedScope;
    });
    return withCurrentOption(
      (scopedOptions.length > 0 ? scopedOptions : providerOptions).map((option) => ({
        value: option.model,
        label: option.label,
      })),
      selectedProfile
    );
  }, [profileOptions, selectedProfile, selectedTtsModel, selectedTtsProvider]);
  const hasLoadedVoiceOptionsForSelection = useMemo(() => {
    const providerKey = normalizeMediaProvider(selectedTtsProvider);
    if (!providerKey) return false;
    const modelKey = selectedTtsModel.trim().toLowerCase();
    if (hasLoadedMediaCatalog('tts', 'voices', providerKey, modelKey)) return true;
    const matchesSelection = (option: MediaModelOption) => {
      if (normalizeMediaProvider(option.provider) !== providerKey) return false;
      const scopeModel = (option.scopeModel || '').trim().toLowerCase();
      return !modelKey || !scopeModel || scopeModel === modelKey;
    };
    return voiceOptions.some(matchesSelection) || profileOptions.some(matchesSelection);
  }, [hasLoadedMediaCatalog, profileOptions, selectedTtsModel, selectedTtsProvider, voiceOptions]);
  const visibleSttModelOptions = useMemo(() => {
    const options = selectedSttProvider
      ? sttModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedSttProvider))
      : sttModelOptions;
    return options.map((option) => ({ value: option.model, label: option.label }));
  }, [selectedSttProvider, sttModelOptions]);
  const visibleMusicModelOptions = useMemo(() => {
    const options = selectedMusicProvider
      ? musicModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedMusicProvider))
      : musicModelOptions;
    return options.map((option) => ({ value: option.model, label: option.label }));
  }, [musicModelOptions, selectedMusicProvider]);
  const visibleMusicProviderOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: SelectOption[] = [];
    const add = (value: string, label?: string) => {
      const clean = normalizeMediaProvider(value);
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    for (const option of musicProviderOptions) add(option.value, option.label);
    if (selectedMusicProvider) add(selectedMusicProvider);
    return out;
  }, [musicProviderOptions, selectedMusicProvider]);
  const residencyModelOptions = useMemo(() => {
    if (
      selectedResidencyTask === 'image_generation' ||
      selectedResidencyTask === 'image_to_image' ||
      selectedResidencyTask === 'image_upscale' ||
      selectedResidencyTask === 'text_to_video' ||
      selectedResidencyTask === 'image_to_video'
    ) {
      const task = normalizeMediaCatalogTask(selectedResidencyVisionProviderModelsTask);
      const options = !selectedResidencyProvider
        ? imageModelOptions.filter((option) => !task || normalizeMediaCatalogTask(option.catalogTask) === task)
        : imageModelOptions.filter(
            (option) =>
              (!task || normalizeMediaCatalogTask(option.catalogTask) === task) &&
              normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedResidencyProvider)
          );
      const seen = new Set<string>();
      const out: SelectOption[] = [];
      const add = (value: string, label?: string) => {
        const clean = value.trim();
        if (!clean || seen.has(clean)) return;
        seen.add(clean);
        out.push({ value: clean, label: label || clean });
      };
      for (const option of options) add(option.model, option.label);
      if (selectedResidencyModel) add(selectedResidencyModel);
      return out;
    }
    if (selectedResidencyTask === 'tts') {
      return visibleTtsModelOptions;
    }
    if (selectedResidencyTask === 'stt') {
      return visibleSttModelOptions;
    }
    if (selectedResidencyTask === 'music_generation') {
      return visibleMusicModelOptions;
    }
    if (selectedResidencyTask === 'text_generation') {
      return models.map((m) => ({ value: m, label: m }));
    }
    return selectedResidencyModel ? [{ value: selectedResidencyModel, label: selectedResidencyModel }] : [];
  }, [
    imageModelOptions,
    models,
    selectedResidencyModel,
    selectedResidencyProvider,
    selectedResidencyTask,
    selectedResidencyVisionProviderModelsTask,
    visibleMusicModelOptions,
    visibleSttModelOptions,
    visibleTtsModelOptions,
  ]);
  const imageFormatOptions = useMemo(
    () => formatOptionsFrom(upscaledImageContract?.direct_endpoint?.formats || generatedImageContract?.direct_endpoint?.formats, DEFAULT_IMAGE_FORMATS),
    [generatedImageContract?.direct_endpoint?.formats, upscaledImageContract?.direct_endpoint?.formats]
  );
  const ttsFormatOptions = useMemo(
    () => {
      const providerSpecific = providerOptionMapValues(ttsFormatsByProvider, selectedTtsProvider, []);
      if (providerSpecific.length > 0) return providerSpecific;
      const fallback = ttsFormatFallback(selectedTtsProvider);
      if (normalizeMediaProvider(selectedTtsProvider) === 'piper') {
        return formatOptionsFrom(undefined, fallback);
      }
      return formatOptionsFrom(generatedVoiceContract?.direct_endpoint?.formats, fallback);
    },
    [generatedVoiceContract?.direct_endpoint?.formats, selectedTtsProvider, ttsFormatsByProvider]
  );
  const sttFormatOptions = useMemo(() => formatOptionsFrom(undefined, DEFAULT_STT_FORMATS), []);
  const musicFormatOptions = useMemo(
    () => formatOptionsFrom(generatedMusicContract?.direct_endpoint?.formats, DEFAULT_MUSIC_FORMATS),
    [generatedMusicContract?.direct_endpoint?.formats]
  );
  const videoFormatOptions = useMemo(
    () => formatOptionsFrom(generatedVideoContract?.direct_endpoint?.formats, DEFAULT_VIDEO_FORMATS),
    [generatedVideoContract?.direct_endpoint?.formats]
  );

  const providerOptionsForCatalogScope = useCallback(
    (scope: PinCatalogScope, current: string): SelectOption[] => {
      const options =
        scope === 'text'
          ? providers.map((p) => ({ value: p.name, label: p.display_name || p.name }))
          : scope === 'image'
            ? imageProviderOptions
            : scope === 'tts'
              ? ttsProviderOptions
              : scope === 'stt'
                ? sttProviderOptions
                : visibleMusicProviderOptions;
      return withGatewayDefaultOption(withCurrentOption(options, current));
    },
    [imageProviderOptions, providers, sttProviderOptions, ttsProviderOptions, visibleMusicProviderOptions]
  );

  const modelOptionsForCatalogScope = useCallback(
    (scope: PinCatalogScope, provider: string, current: string): SelectOption[] => {
      const normalizedProvider = normalizeMediaProvider(provider);
      const options =
        scope === 'text'
          ? modelOptions
          : scope === 'image'
            ? imageModelOptions
                .filter(
                  (option) =>
                    normalizeMediaCatalogTask(option.catalogTask) === normalizeMediaCatalogTask(currentVisionProviderModelsTask) &&
                    (!normalizedProvider || normalizeMediaProvider(option.provider) === normalizedProvider)
                )
                .map((option) => ({ value: option.model, label: option.label }))
            : scope === 'tts'
              ? ttsModelOptions
                  .filter((option) => !normalizedProvider || normalizeMediaProvider(option.provider) === normalizedProvider)
                  .map((option) => ({ value: option.model, label: option.label }))
              : scope === 'stt'
                ? sttModelOptions
                    .filter((option) => !normalizedProvider || normalizeMediaProvider(option.provider) === normalizedProvider)
                    .map((option) => ({ value: option.model, label: option.label }))
                : musicModelOptions
                    .filter((option) => !normalizedProvider || normalizeMediaProvider(option.provider) === normalizedProvider)
                    .map((option) => ({ value: option.model, label: option.label }));
      return withCurrentOption(options, current);
    },
    [currentVisionProviderModelsTask, imageModelOptions, modelOptions, musicModelOptions, sttModelOptions, ttsModelOptions]
  );

  const mediaCatalogLoading = useCallback(
    (scope: MediaCatalogScope, kind: 'providers' | 'models' | 'voices' | 'profiles' = 'models', provider = '', model = '') => {
      const activeRequests = activeMediaCatalogRequest ? [activeMediaCatalogRequest] : [];
      return activeRequests.some((request) => {
        if (!request || request.scope !== scope) return false;
        const providerKey = normalizeMediaProvider(provider);
        const requestProviderKey = normalizeMediaProvider(request.provider || '');
        if (kind !== 'providers' && providerKey && requestProviderKey && requestProviderKey !== providerKey) return false;
        if (kind === 'providers') return Boolean(request.providersOnly || request.includeProviders || !request.provider);
        if (scope === 'tts' && (kind === 'voices' || kind === 'profiles')) {
          const modelKey = String(model || '').trim().toLowerCase();
          const requestModelKey = String(request.model || '').trim().toLowerCase();
          if (modelKey && requestModelKey && requestModelKey !== modelKey) return false;
          return !request.providersOnly && request.includeVoices !== false;
        }
        return !request.providersOnly && request.includeModels !== false;
      });
    },
    [activeMediaCatalogRequest]
  );

  const providerCatalogLoading = useCallback(
    (scope: PinCatalogScope) => {
      if (scope === 'text') return providersQuery.isLoading;
      return mediaCapabilitiesQuery.isLoading || mediaCatalogLoading(scope, 'providers');
    },
    [mediaCapabilitiesQuery.isLoading, mediaCatalogLoading, providersQuery.isLoading]
  );

  const modelCatalogLoading = useCallback(
    (scope: PinCatalogScope) => {
      if (scope === 'text') return modelsQuery.isLoading;
      return mediaCapabilitiesQuery.isLoading || mediaCatalogLoading(scope, 'models');
    },
    [mediaCapabilitiesQuery.isLoading, mediaCatalogLoading, modelsQuery.isLoading]
  );

  const requestProviderCatalogForScope = useCallback(
    (scope: PinCatalogScope) => {
      if (scope === 'image') requestMediaCatalog('image', { providersOnly: true, task: currentVisionProviderModelsTask });
      if (scope === 'tts') requestMediaCatalog('tts', { providersOnly: true });
      if (scope === 'stt') requestMediaCatalog('stt', { providersOnly: true });
      if (scope === 'music') requestMediaCatalog('music', { providersOnly: true });
    },
    [currentVisionProviderModelsTask, requestMediaCatalog]
  );

  const requestModelCatalogForScope = useCallback(
    (scope: PinCatalogScope, provider: string) => {
      const clean = provider.trim();
      if (!clean) return;
      if (scope === 'image') requestMediaCatalog('image', { provider: clean, task: currentVisionProviderModelsTask });
      if (scope === 'tts') requestMediaCatalog('tts', { provider: clean, includeVoices: false });
      if (scope === 'stt') requestMediaCatalog('stt', { provider: clean });
      if (scope === 'music') requestMediaCatalog('music', { provider: clean });
    },
    [currentVisionProviderModelsTask, requestMediaCatalog]
  );

  useEffect(() => {
    if (activeMediaCatalogRequest || mediaCatalogQueue.length === 0) return;
    const request = mediaCatalogQueue[0];
    const requestKey = mediaCatalogRequestKey(request.scope, request);
    setMediaCatalogQueue((prev) => prev.slice(1));
    queuedMediaCatalogRequestKeysRef.current.delete(requestKey);
    activeMediaCatalogRequestKeysRef.current.add(requestKey);
    setActiveMediaCatalogRequest(request);
  }, [activeMediaCatalogRequest, mediaCatalogQueue]);

  useEffect(() => {
    if (!activeMediaCatalogRequest) return;

    let cancelled = false;
    const request = activeMediaCatalogRequest;
    const requestKey = mediaCatalogRequestKey(request.scope, request);

    const asRecord = (value: unknown): Record<string, unknown> | null =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
    const text = (...values: unknown[]) => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };
    const addOption = (list: SelectOption[], seen: Set<string>, value: string, label?: string) => {
      const clean = value.trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      list.push({ value: clean, label: label?.trim() || clean });
    };
    const addProvider = (list: SelectOption[], seen: Set<string>, value: string, label?: string) => {
      const clean = normalizeMediaProvider(value);
      if (!clean || clean === 'cloned') return;
      addOption(list, seen, clean, label || clean);
    };
    const addProvidersFromArray = (list: SelectOption[], seen: Set<string>, values: unknown[]) => {
      for (const item of values) {
        if (typeof item === 'string') {
          addProvider(list, seen, item);
          continue;
        }
        const record = asRecord(item);
        if (record) {
          addProvider(list, seen, text(record.id, record.name, record.provider, record.engine_id), text(record.label, record.display_name, record.name));
        }
      }
    };
    const addMediaOption = (
      list: MediaModelOption[],
      seen: Set<string>,
      provider: string,
      model: string,
      label?: string,
      scopeModel?: string,
      metadata?: MediaModelParameterMetadata
    ) => {
      const cleanModel = model.trim();
      const cleanProvider = normalizeMediaProvider(provider);
      const cleanScopeModel = typeof scopeModel === 'string' ? scopeModel.trim() : '';
      if (!cleanModel) return;
      const key = `${cleanProvider}:${cleanModel.toLowerCase()}`;
      if (seen.has(key)) {
        const cleanLabel = label?.trim();
        const existing = list.find((option) => option.provider === cleanProvider && option.model.toLowerCase() === cleanModel.toLowerCase());
        if (existing) {
          if (cleanScopeModel && !existing.scopeModel) existing.scopeModel = cleanScopeModel;
          if (metadata?.parameterDefaults && !existing.parameterDefaults) existing.parameterDefaults = metadata.parameterDefaults;
          if (metadata?.parameterConstraints && !existing.parameterConstraints) existing.parameterConstraints = metadata.parameterConstraints;
          if (cleanLabel) {
            const defaultLabel = cleanProvider ? `${cleanProvider} / ${cleanModel}` : cleanModel;
            if (!existing.label || existing.label === defaultLabel || existing.label === cleanModel || existing.label.endsWith(` / ${cleanModel}`)) {
              existing.label = cleanLabel;
            }
          }
        }
        return;
      }
      seen.add(key);
      list.push({
        provider: cleanProvider,
        model: cleanModel,
        label: label?.trim() || (cleanProvider ? `${cleanProvider} / ${cleanModel}` : cleanModel),
        scopeModel: cleanScopeModel || undefined,
        parameterDefaults: metadata?.parameterDefaults,
        parameterConstraints: metadata?.parameterConstraints,
      });
    };
    const appendImageModels = (list: MediaModelOption[], seen: Set<string>, values: unknown[], provider: string) => {
      for (const item of values) {
        if (typeof item === 'string') {
          addMediaOption(list, seen, provider, item);
          continue;
        }
        const record = asRecord(item);
        if (!record) continue;
        const itemProvider = text(record.provider, record.engine_id, record.backend, provider);
        const model = canonicalImageModelForProvider(itemProvider, text(record.model, record.model_id, record.id, record.name));
        const label = text(record.label, record.display_name, record.name);
        addMediaOption(list, seen, itemProvider, model, label || undefined, undefined, extractImageModelParameterMetadata(record));
      }
    };
    const appendProviderValueMap = (list: MediaModelOption[], seen: Set<string>, payload: unknown, labelPrefix = '') => {
      const record = asRecord(payload);
      if (!record) return;
      for (const [provider, values] of Object.entries(record)) {
        for (const item of asArray(values)) {
            if (typeof item === 'string') addMediaOption(list, seen, provider, item, labelPrefix ? `${labelPrefix} ${item}` : undefined);
            else {
              const itemRecord = asRecord(item);
              if (!itemRecord) continue;
              const model = canonicalImageModelForProvider(provider, text(itemRecord.model, itemRecord.model_id, itemRecord.id, itemRecord.name));
              addMediaOption(
                list,
                seen,
                provider,
                model,
                text(itemRecord.label, itemRecord.display_name, itemRecord.name) || undefined,
                undefined,
                extractImageModelParameterMetadata(itemRecord)
              );
            }
          }
        }
    };
    const addImageProvidersFromCatalog = (providersList: SelectOption[], seenProviders: Set<string>, record: Record<string, unknown>) => {
      const catalog = asRecord(record.catalog);
      const isProviderCatalog = catalog?.kind === 'providers' || record.providers_only === true;
      let addedRunnableProvider = false;
      const addRunnableProvider = (provider: string, label?: string) => {
        const before = seenProviders.size;
        addProvider(providersList, seenProviders, provider, label);
        if (seenProviders.size > before) addedRunnableProvider = true;
      };

      const byProvider = asRecord(record.models_by_provider);
      if (byProvider) {
        for (const [provider, modelsForProvider] of Object.entries(byProvider)) {
          if (asArray(modelsForProvider).length > 0) addRunnableProvider(provider);
        }
      }
      for (const item of asArray(record.provider_models)) {
        const itemRecord = asRecord(item);
        if (!itemRecord) continue;
        addRunnableProvider(text(itemRecord.provider, itemRecord.provider_id, itemRecord.owned_by));
      }
      if (isProviderCatalog) {
        for (const item of asArray(record.items)) {
          const itemRecord = asRecord(item);
          if (!itemRecord) continue;
          addRunnableProvider(text(itemRecord.provider, itemRecord.provider_id, itemRecord.id, itemRecord.name), text(itemRecord.label, itemRecord.display_name, itemRecord.name) || undefined);
        }
      }

      const details = asRecord(record.details);
      for (const item of asArray(record.available_providers)) {
        const provider = typeof item === 'string' ? item.trim() : text(asRecord(item)?.id, asRecord(item)?.provider, asRecord(item)?.name);
        const normalized = normalizeMediaProvider(provider);
        const detail = asRecord(details?.[normalized]) || asRecord(details?.[provider]);
        const isRemote = normalized === 'openai' || normalized === 'openai-compatible' || detail?.remote === true;
        if (isProviderCatalog || isRemote) addRunnableProvider(provider);
      }

      if (!addedRunnableProvider && !isProviderCatalog) {
        addProvidersFromArray(providersList, seenProviders, asArray(record.providers));
      }
    };
    const formatMapFrom = (payload: unknown): ProviderOptionMap => {
      const record = asRecord(payload);
      const out: ProviderOptionMap = {};
      if (!record) return out;
      for (const [provider, values] of Object.entries(record)) {
        const key = normalizeMediaProvider(provider);
        const options = formatOptionsFrom(values, []);
        if (key && options.length > 0) out[key] = options;
      }
      return out;
    };
    const scanImagePayload = (list: MediaModelOption[], seen: Set<string>, providersList: SelectOption[], seenProviders: Set<string>, payload: unknown) => {
      if (Array.isArray(payload)) {
        appendImageModels(list, seen, payload, '');
        return;
      }
      const record = asRecord(payload);
      if (!record) return;
      addImageProvidersFromCatalog(providersList, seenProviders, record);
      const rootProvider = text(record.provider, record.engine_id, record.backend, record.active_provider);
      appendImageModels(list, seen, asArray(record.models), rootProvider);
      if (asRecord(record.catalog)?.kind !== 'providers') {
        appendImageModels(list, seen, asArray(record.items), rootProvider);
      }
      appendImageModels(list, seen, asArray(record.available_models), rootProvider);
      appendImageModels(list, seen, asArray(record.local_models), rootProvider);
      for (const key of ['provider_models', 'models_by_provider', 'providers']) {
        const byProvider = asRecord(record[key]);
        if (!byProvider) continue;
        for (const [provider, modelsForProvider] of Object.entries(byProvider)) {
          appendImageModels(list, seen, asArray(modelsForProvider), provider);
        }
      }
    };

    const loadMediaOptions = async () => {
      try {
        const queryFor = (provider?: string, model?: string, providersOnly?: boolean) => {
          const query: Record<string, string | boolean> = {};
          if (provider) query.provider = provider;
          if (model) query.model = model;
          if (providersOnly) query.providers_only = true;
          return query;
        };
        const imageTask = request.task || generatedImageProviderModelsTask;
        const imageProviderListQuery = {
          task: imageTask,
          ...queryFor(undefined, undefined, true),
        };
        const imageModelQuery = {
          task: imageTask,
          ...queryFor(request.provider, undefined, false),
        };
        const ttsQuery = queryFor(request.provider, request.model, request.providersOnly);
        const ttsVoiceQuery = { ...ttsQuery, compact: true };
        const ttsProviderListQuery = queryFor(undefined, undefined, true);
        const sttQuery = queryFor(request.provider, undefined, request.providersOnly);
        const sttProviderListQuery = queryFor(undefined, undefined, true);
        const musicProviderListQuery = {
          task: musicProviderModelsTask,
          ...queryFor(undefined, undefined, true),
        };
        const musicModelQuery = {
          task: musicProviderModelsTask,
          ...queryFor(request.provider, undefined, request.providersOnly),
        };
        const optionalCatalog = <T,>(promise: Promise<T>): Promise<T | null> =>
          promise.catch((err) => {
            console.warn('[BaseNode] optional media catalog request failed', err);
            return null;
          });
        const shouldFetchTtsProviders =
          request.scope === 'tts' &&
          Boolean(voiceCatalogEndpoint) &&
          !ttsModelsEndpoint &&
          (request.providersOnly || request.includeProviders);
        const shouldFetchTtsCatalog =
          request.scope === 'tts' &&
          !request.providersOnly &&
          request.includeVoices !== false &&
          voiceCatalogEndpoint;
        const shouldFetchSttProviders =
          request.scope === 'stt' && Boolean(sttModelsEndpoint) && (request.providersOnly || request.includeProviders);
        const shouldFetchMusicProviders =
          request.scope === 'music' && musicProvidersEndpoint && (request.providersOnly || request.includeProviders || !request.provider);
        const shouldFetchMusicModels = request.scope === 'music' && !request.providersOnly && musicModelsEndpoint;
        const shouldFetchImageProviders =
          request.scope === 'image' && visionProviderModelsEndpoint && (request.providersOnly || request.includeProviders || !request.provider);
        const shouldFetchImageModels = request.scope === 'image' && !request.providersOnly && request.provider && visionProviderModelsEndpoint;
        const [
          voiceProvidersCatalog,
          voiceCatalog,
          speechCatalog,
          sttProvidersCatalog,
          transcriptionCatalog,
          musicProvidersCatalog,
          musicModelsCatalog,
          visionProvidersCatalog,
          visionProviderCatalog,
          visionModelCatalog,
        ] = await Promise.all([
          shouldFetchTtsProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(voiceCatalogEndpoint, {}, ttsProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          shouldFetchTtsCatalog
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(voiceCatalogEndpoint, {}, ttsVoiceQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          request.scope === 'tts' && request.includeModels !== false && ttsModelsEndpoint
            ? optionalCatalog(
                gatewayJson<Record<string, unknown>>(
                  gatewayPath(ttsModelsEndpoint, {}, request.providersOnly ? ttsProviderListQuery : ttsQuery),
                  { timeoutMs: request.providersOnly ? 5_000 : 30_000 }
                )
              )
            : Promise.resolve(null),
          shouldFetchSttProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(sttModelsEndpoint, {}, sttProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          request.scope === 'stt' && !request.providersOnly && sttModelsEndpoint
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(sttModelsEndpoint, {}, sttQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          shouldFetchMusicProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(musicProvidersEndpoint, {}, musicProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          shouldFetchMusicModels
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(musicModelsEndpoint, {}, musicModelQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          shouldFetchImageProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(visionProviderModelsEndpoint, {}, imageProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          shouldFetchImageModels
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(visionProviderModelsEndpoint, {}, imageModelQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          request.scope === 'image' && !request.provider && !request.providersOnly && visionModelsEndpoint
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(visionModelsEndpoint), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
        ]);

        const nextVoiceOptions: MediaModelOption[] = [];
        const nextProfileOptions: MediaModelOption[] = [];
        const nextTtsProviders: SelectOption[] = [];
        const nextSttProviders: SelectOption[] = [];
        const nextMusicProviders: SelectOption[] = [];
        const nextTtsModels: MediaModelOption[] = [];
        const nextSttModels: MediaModelOption[] = [];
        const nextMusicModels: MediaModelOption[] = [];
        const nextImageModels: MediaModelOption[] = [];
        const nextImageProviders: SelectOption[] = [];
        const seenVoices = new Set<string>();
        const seenProfiles = new Set<string>();
        const seenTtsProviders = new Set<string>();
        const seenSttProviders = new Set<string>();
        const seenMusicProviders = new Set<string>();
        const seenTtsModels = new Set<string>();
        const seenSttModels = new Set<string>();
        const seenMusicModels = new Set<string>();
        const seenImageModels = new Set<string>();
        const seenImageProviders = new Set<string>();

        const voiceProvidersRecord = asRecord(voiceProvidersCatalog);
        if (voiceProvidersRecord) {
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceProvidersRecord.providers));
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceProvidersRecord.tts_providers));
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(voiceProvidersRecord.stt_providers));
        }

        const sttProvidersRecord = asRecord(sttProvidersCatalog);
        if (sttProvidersRecord) {
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(sttProvidersRecord.providers));
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(sttProvidersRecord.stt_providers));
        }

        const voiceRecord = asRecord(voiceCatalog);
        let nextTtsFormatsByProvider: ProviderOptionMap | null = null;
        if (voiceRecord) {
          nextTtsFormatsByProvider = formatMapFrom(voiceRecord.tts_formats_by_provider);
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceRecord.providers));
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceRecord.tts_providers));
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(voiceRecord.stt_providers));
          addProvider(nextTtsProviders, seenTtsProviders, text(voiceRecord.active_tts_provider, voiceRecord.engine_id));
          addProvider(nextSttProviders, seenSttProviders, text(voiceRecord.active_stt_provider));
          appendProviderValueMap(nextTtsModels, seenTtsModels, voiceRecord.tts_models_by_provider);
          appendProviderValueMap(nextSttModels, seenSttModels, voiceRecord.stt_models_by_provider);
          for (const item of asArray(voiceRecord.items)) {
            const record = asRecord(item);
            if (!record) continue;
            const tags = asRecord(record.tags);
            const params = asRecord(record.params);
            const provider = normalizeMediaProvider(
              text(record.provider, tags?.provider, params?.provider, record.engine_id, tags?.engine_id, params?.engine_id)
            );
            const modelId = text(record.model, record.model_id, params?.model, params?.model_id, params?.model_filename);
            const profileId = text(record.profile_id, record.id, record.name);
            const voiceId = text(record.voice_id, params?.voice, record.voice, record.id, profileId);
            const label = text(record.label, record.display_name, record.name, record.voice, profileId, voiceId);
            const kinds = new Set(
              [
                text(record.voice_kind),
                text(record.kind),
                ...asArray(record.voice_kinds).map((kind) => (typeof kind === 'string' ? kind : '')),
              ]
                .map((kind) => kind.trim().toLowerCase())
                .filter(Boolean)
            );
            addProvider(nextTtsProviders, seenTtsProviders, provider);
            if (kinds.has('profile') || (!kinds.has('clone') && profileId && !text(record.voice_id))) {
              addMediaOption(nextProfileOptions, seenProfiles, provider, profileId, label || undefined, modelId);
            }
            addMediaOption(nextVoiceOptions, seenVoices, provider, voiceId, label || undefined, modelId);
            addMediaOption(nextTtsModels, seenTtsModels, provider, modelId);
          }
          for (const profile of asArray(voiceRecord.profiles)) {
            const record = asRecord(profile);
            if (!record) continue;
            const tags = asRecord(record.tags);
            const params = asRecord(record.params);
            const provider = text(record.provider, tags?.provider, params?.provider, record.engine_id, tags?.engine_id, params?.engine_id);
            const profileId = text(record.profile_id, record.id, record.name);
            const modelId = text(params?.model, params?.model_id, params?.model_filename, record.model, record.model_id);
            const voiceId = text(record.voice_id, params?.voice, record.voice, profileId);
            addProvider(nextTtsProviders, seenTtsProviders, provider);
            addMediaOption(nextProfileOptions, seenProfiles, provider, profileId, text(record.label, record.display_name, record.name), modelId);
            addMediaOption(nextVoiceOptions, seenVoices, provider, voiceId, text(record.label, record.display_name, record.name, params?.voice, record.voice), modelId);
            addMediaOption(nextTtsModels, seenTtsModels, provider, modelId);
          }
          for (const key of ['voices', 'cloned_voices']) {
            for (const voice of asArray(voiceRecord[key])) {
              const record = asRecord(voice);
              if (typeof voice === 'string') {
                addMediaOption(nextVoiceOptions, seenVoices, '', voice);
                continue;
              }
              if (!record) continue;
              const tags = asRecord(record.tags);
              const params = asRecord(record.params);
              const kind = text(record.kind).toLowerCase();
              const rawEngine = text(record.engine, params?.engine, tags?.engine, record.engine_id, tags?.engine_id, params?.engine_id);
              const rawProvider = text(record.provider, tags?.provider, params?.provider, rawEngine);
              const provider = normalizeMediaProvider(rawProvider === 'cloned' ? rawEngine : rawProvider);
              if (provider && provider !== 'cloned') {
                addProvider(nextTtsProviders, seenTtsProviders, provider);
              }
              const voiceId = text(record.voice_id, params?.voice, record.voice, record.profile_id, record.id, record.name);
              const scopeModel = text(params?.model, params?.model_id, params?.model_filename, record.model, record.model_id);
              const displayName = text(record.display_name, record.label, record.name);
              const label =
                kind === 'clone' && displayName && displayName !== voiceId
                  ? `${displayName} / ${voiceId.slice(0, 10)}...`
                  : text(record.label, record.display_name, record.name, record.voice);
              addMediaOption(
                nextVoiceOptions,
                seenVoices,
                provider,
                voiceId,
                label,
                scopeModel
              );
            }
          }
          const appendNonCloneMap = (list: MediaModelOption[], seen: Set<string>, payload: unknown) => {
            const record = asRecord(payload);
            if (!record) return;
            for (const [provider, values] of Object.entries(record)) {
              if (normalizeMediaProvider(provider) === 'cloned') continue;
              for (const item of asArray(values)) {
                if (typeof item === 'string') addMediaOption(list, seen, provider, item);
                else {
                  const itemRecord = asRecord(item);
                  if (!itemRecord) continue;
                  const model = text(itemRecord.model, itemRecord.model_id, itemRecord.id, itemRecord.name);
                  addMediaOption(list, seen, provider, model, text(itemRecord.label, itemRecord.display_name, itemRecord.name) || undefined);
                }
              }
            }
          };
          appendNonCloneMap(nextVoiceOptions, seenVoices, voiceRecord.tts_voices_by_provider);
          appendNonCloneMap(nextProfileOptions, seenProfiles, voiceRecord.tts_profiles_by_provider);
        }
        const speechRecord = asRecord(speechCatalog);
        if (speechRecord) {
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(speechRecord.providers));
          addProvider(nextTtsProviders, seenTtsProviders, text(speechRecord.provider, speechRecord.engine_id, speechRecord.active_provider));
          appendProviderValueMap(nextTtsModels, seenTtsModels, speechRecord.models_by_provider || speechRecord.tts_models_by_provider);
        }

        const transcriptionRecord = asRecord(transcriptionCatalog);
        if (transcriptionRecord) {
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(transcriptionRecord.providers));
          addProvider(nextSttProviders, seenSttProviders, text(transcriptionRecord.provider, transcriptionRecord.engine_id, transcriptionRecord.active_provider));
          appendProviderValueMap(nextSttModels, seenSttModels, transcriptionRecord.models_by_provider || transcriptionRecord.stt_models_by_provider);
        }

        const scanMusicPayload = (payload: unknown) => {
          const record = asRecord(payload);
          if (!record) return;
          addProvidersFromArray(nextMusicProviders, seenMusicProviders, asArray(record.providers));
          addProvidersFromArray(nextMusicProviders, seenMusicProviders, asArray(record.available_providers));
          addProvidersFromArray(nextMusicProviders, seenMusicProviders, asArray(record.music_providers));
          addProvidersFromArray(nextMusicProviders, seenMusicProviders, asArray(record.provider_details));
          const rootProvider = text(record.provider, record.engine_id, record.backend, record.active_provider, record.selected_backend);
          addProvider(nextMusicProviders, seenMusicProviders, rootProvider);
          appendImageModels(nextMusicModels, seenMusicModels, asArray(record.models), rootProvider);
          appendImageModels(nextMusicModels, seenMusicModels, asArray(record.available_models), rootProvider);
          appendImageModels(nextMusicModels, seenMusicModels, asArray(record.provider_models), rootProvider);
          appendProviderValueMap(nextMusicModels, seenMusicModels, record.models_by_provider);
        };
        scanMusicPayload(musicProvidersCatalog);
        scanMusicPayload(musicModelsCatalog);
        for (const option of nextMusicModels) addProvider(nextMusicProviders, seenMusicProviders, option.provider);

        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionProvidersCatalog);
        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionProviderCatalog);
        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionModelCatalog);
        const taskScopedImageModels = nextImageModels.map((option) => ({ ...option, catalogTask: imageTask }));
        for (const option of taskScopedImageModels) addProvider(nextImageProviders, seenImageProviders, option.provider);

        if (!cancelled) {
          const loadedKeys: string[] = [];
          const providerCatalogReturned =
            request.scope === 'tts'
              ? Boolean(voiceProvidersCatalog || speechCatalog || voiceCatalog)
              : request.scope === 'stt'
                ? Boolean(sttProvidersCatalog || transcriptionCatalog)
                : request.scope === 'music'
                  ? Boolean(musicProvidersCatalog || musicModelsCatalog)
                  : Boolean(visionProvidersCatalog || visionProviderCatalog || visionModelCatalog);
          const modelCatalogReturned =
            request.scope === 'tts'
              ? Boolean(speechCatalog || voiceCatalog)
              : request.scope === 'stt'
                ? Boolean(transcriptionCatalog)
                : request.scope === 'music'
                  ? Boolean(musicModelsCatalog)
                  : Boolean(visionProviderCatalog || visionModelCatalog);
          const voiceCatalogReturned = request.scope === 'tts' && Boolean(voiceCatalog);
          if ((request.providersOnly || request.includeProviders || !request.provider) && providerCatalogReturned) {
            loadedKeys.push(mediaCatalogLoadedKey(request.scope, 'providers', '', '', request.scope === 'image' ? imageTask : ''));
          }
          if (!request.providersOnly && request.provider) {
            if (request.includeModels !== false && modelCatalogReturned) {
              loadedKeys.push(mediaCatalogLoadedKey(request.scope, 'models', request.provider, '', request.scope === 'image' ? imageTask : ''));
            }
            if (request.scope === 'tts' && request.includeVoices !== false && voiceCatalogReturned) {
              loadedKeys.push(mediaCatalogLoadedKey('tts', 'voices', request.provider, request.model || ''));
              loadedKeys.push(mediaCatalogLoadedKey('tts', 'profiles', request.provider, request.model || ''));
            }
          }
          markMediaCatalogLoaded(loadedKeys);

          if (request.scope === 'tts') {
            if (request.providersOnly || request.includeProviders || !request.provider || nextTtsProviders.length > 0) {
              setTtsProviderOptions((prev) => mergeSelectOptions(prev, nextTtsProviders));
            }
            if (nextTtsFormatsByProvider !== null) setTtsFormatsByProvider(nextTtsFormatsByProvider);
            if (!request.providersOnly) {
              if (request.includeVoices !== false) {
                setVoiceOptions((prev) => replaceMediaOptionsForProvider(prev, nextVoiceOptions, request.provider || ''));
                setProfileOptions((prev) => replaceMediaOptionsForProvider(prev, nextProfileOptions, request.provider || ''));
              }
              if (request.includeModels !== false) {
                setTtsModelOptions((prev) => replaceMediaOptionsForProvider(prev, nextTtsModels, request.provider || ''));
              }
            }
          }
          if (request.scope === 'stt') {
            if (request.providersOnly || request.includeProviders || !request.provider || nextSttProviders.length > 0) {
              setSttProviderOptions((prev) => mergeSelectOptions(prev, nextSttProviders));
            }
            if (!request.providersOnly) {
              setSttModelOptions((prev) => replaceMediaOptionsForProvider(prev, nextSttModels, request.provider || ''));
            }
          }
          if (request.scope === 'music') {
            if (request.providersOnly || request.includeProviders || !request.provider || nextMusicProviders.length > 0) {
              setMusicProviderOptions((prev) => mergeSelectOptions(prev, nextMusicProviders));
            }
            if (!request.providersOnly) {
              setMusicModelOptions((prev) => replaceMediaOptionsForProvider(prev, nextMusicModels, request.provider || ''));
            }
          }
          if (request.scope === 'image') {
            if (request.providersOnly || request.includeProviders || !request.provider || nextImageProviders.length > 0) {
              setImageProviderCatalogOptions((prev) => mergeSelectOptions(prev, nextImageProviders));
            }
            if (!request.providersOnly) {
              setImageModelOptions((prev) => replaceMediaOptionsForProvider(prev, taskScopedImageModels, request.provider || '', imageTask));
            }
          }
        }
      } catch (err) {
        console.warn('[BaseNode] media catalog discovery failed', err);
        if (!cancelled) {
          if (request.scope === 'tts') {
            setTtsProviderOptions([]);
            if (!request.providersOnly) {
              if (request.includeVoices !== false) {
                setVoiceOptions([]);
                setProfileOptions([]);
                setTtsFormatsByProvider({});
              }
              if (request.includeModels !== false) setTtsModelOptions([]);
            }
          }
          if (request.scope === 'stt') {
            setSttProviderOptions([]);
            if (!request.providersOnly) setSttModelOptions([]);
          }
          if (request.scope === 'music') {
            setMusicProviderOptions([]);
            if (!request.providersOnly) setMusicModelOptions([]);
          }
          if (request.scope === 'image') {
            setImageProviderCatalogOptions([]);
            if (!request.providersOnly) setImageModelOptions([]);
          }
        }
      } finally {
        activeMediaCatalogRequestKeysRef.current.delete(requestKey);
        queuedMediaCatalogRequestKeysRef.current.delete(requestKey);
        if (!cancelled) {
          setActiveMediaCatalogRequest((prev) => (isMediaCatalogRequestKey(prev, requestKey) ? null : prev));
        }
      }
    };

    loadMediaOptions();

    return () => {
      cancelled = true;
      activeMediaCatalogRequestKeysRef.current.delete(requestKey);
    };
  }, [
    activeMediaCatalogRequest,
    markMediaCatalogLoaded,
    voiceCatalogEndpoint,
    ttsModelsEndpoint,
    sttModelsEndpoint,
    musicProvidersEndpoint,
    musicModelsEndpoint,
    musicProviderModelsTask,
    generatedImageProviderModelsTask,
    visionProviderModelsEndpoint,
    visionModelsEndpoint,
  ]);

  const toolOptions = useMemo(() => {
    const out = tools
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({
        value: t.name.trim(),
        label: t.name.trim(),
      }));
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [tools]);

  const toolsByName = useMemo(() => {
    const m = new Map<string, (typeof tools)[number]>();
    for (const t of tools) {
      if (!t || typeof t.name !== 'string') continue;
      const name = t.name.trim();
      if (!name) continue;
      m.set(name, t);
    }
    return m;
  }, [tools]);

  const selectedToolParametersTool = useMemo(() => {
    if (!isToolParametersNode) return '';
    const raw = data.toolParametersConfig?.tool;
    return typeof raw === 'string' ? raw : '';
  }, [data.toolParametersConfig?.tool, isToolParametersNode]);

  const setToolParametersTool = useCallback(
    (nextTool: string) => {
      if (!isToolParametersNode) return;

      const cleaned = (nextTool || '').trim();
      const spec = cleaned ? toolsByName.get(cleaned) : undefined;

      const toolCallPin: FlowNodeData['outputs'][number] = {
        id: 'tool_call',
        label: 'tool_call',
        type: 'object',
        description: 'Single tool call request object: {name, arguments, call_id?}.',
      };

      if (!spec || !spec.parameters || typeof spec.parameters !== 'object') {
        updateNodeData(id, {
          toolParametersConfig: { tool: cleaned },
          inputs: [],
          outputs: [toolCallPin],
          pinDefaults: {},
        });
        return;
      }

      const mapParamType = (raw: unknown): PinType => {
        const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        if (t === 'boolean') return 'boolean';
        if (t === 'integer' || t === 'number') return 'number';
        if (t === 'array') return 'array';
        if (t === 'object') return 'object';
        if (t === 'string') return 'string';
        return 'any';
      };

      const prevTool = typeof data.toolParametersConfig?.tool === 'string' ? data.toolParametersConfig.tool.trim() : '';
      const keepExisting = prevTool === cleaned;
      const prevDefaults = data.pinDefaults || {};

      const nextInputs: FlowNodeData['inputs'] = [];
      const nextOutputs: FlowNodeData['outputs'] = [toolCallPin];
      const nextDefaults: Record<string, JsonValue> = {};

      const entries = Object.entries(spec.parameters as Record<string, any>);
      for (const [rawName, meta] of entries) {
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) continue;

        const pinType = mapParamType(meta && typeof meta === 'object' ? (meta as any).type : undefined);
        const pin: FlowNodeData['inputs'][number] = { id: name, label: name, type: pinType };

        nextInputs.push(pin);
        nextOutputs.push(pin);

        if (keepExisting && name in prevDefaults) {
          nextDefaults[name] = (prevDefaults as any)[name] as JsonValue;
          continue;
        }

        const def = meta && typeof meta === 'object' ? (meta as any).default : undefined;
        if (def === null || def === undefined) continue;
        nextDefaults[name] = def as JsonValue;
      }

      updateNodeData(id, {
        toolParametersConfig: { tool: cleaned },
        inputs: nextInputs,
        outputs: nextOutputs,
        pinDefaults: nextDefaults,
      });
    },
    [data.pinDefaults, data.toolParametersConfig?.tool, id, isToolParametersNode, toolsByName, updateNodeData]
  );

  const toolParametersSyncRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isToolParametersNode) return;
    const tool = selectedToolParametersTool.trim();
    if (!tool) return;

    const syncKey = `${id}:${tool}`;
    if (toolParametersSyncRef.current === syncKey) return;

    const hasPins = (data.inputs || []).some((p) => p && p.type !== 'execution');
    if (hasPins) {
      toolParametersSyncRef.current = syncKey;
      return;
    }

    toolParametersSyncRef.current = syncKey;
    setToolParametersTool(tool);
  }, [data.inputs, id, isToolParametersNode, selectedToolParametersTool, setToolParametersTool]);

  const selectedTools = useMemo(() => {
    if (isAgentNode) {
      const raw = data.agentConfig?.tools;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    if (isLlmNode) {
      const raw = data.effectConfig?.tools;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    if (isToolsAllowlistNode) {
      const raw = data.literalValue;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    if (subflowHasToolsPin) {
      const raw = pinDefaults.tools;
      if (!Array.isArray(raw)) return [];
      const cleaned = raw
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      return Array.from(new Set(cleaned));
    }

    return [];
  }, [data.agentConfig?.tools, data.effectConfig?.tools, data.literalValue, isAgentNode, isLlmNode, isToolsAllowlistNode, pinDefaults.tools, subflowHasToolsPin]);

  const selectedProviderModels = useMemo(() => {
    if (!isProviderModelsNode) return [];
    const raw = data.providerModelsConfig?.allowedModels;
    if (!Array.isArray(raw)) return [];
    const cleaned = raw
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .map((m) => m.trim());
    return Array.from(new Set(cleaned));
  }, [data.providerModelsConfig?.allowedModels, isProviderModelsNode]);

  const setProviderModelsAllowedModels = useCallback(
    (nextModels: string[]) => {
      if (!isProviderModelsNode) return;
      const cleaned = nextModels
        .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
        .map((m) => m.trim());
      const unique = Array.from(new Set(cleaned));
      const prev = data.providerModelsConfig || {};
      updateNodeData(id, { providerModelsConfig: { ...prev, allowedModels: unique } });
    },
    [data.providerModelsConfig, id, isProviderModelsNode, updateNodeData]
  );

  const setEffectConfigPatch = useCallback(
    (patch: Record<string, unknown>) => {
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          ...patch,
        } as FlowNodeData['effectConfig'],
      });
    },
    [data.effectConfig, id, updateNodeData]
  );

  const setImageProviderSelection = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? normalizeMediaProvider(provider) : '';
      const nextDefaults = { ...(data.pinDefaults || {}) };
      for (const [key, value] of Object.entries(imageDefaultsForProvider(clean))) {
        if (value === undefined) delete nextDefaults[key];
        else nextDefaults[key] = value;
      }
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          image_provider: clean || undefined,
          image_model: undefined,
          provider: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: nextDefaults,
      });
      if (clean) requestMediaCatalog('image', { provider: clean, task: currentImageProviderModelsTask });
    },
    [currentImageProviderModelsTask, data.effectConfig, data.nodeType, data.pinDefaults, id, requestMediaCatalog, updateNodeData]
  );

  const setImageModelSelection = useCallback(
    (model: string | null | undefined) => {
      const cleanModel = typeof model === 'string' ? model.trim() : '';
      const match = imageModelOptions.find(
        (option) =>
          option.model === cleanModel &&
          normalizeMediaCatalogTask(option.catalogTask) === normalizeMediaCatalogTask(currentImageProviderModelsTask) &&
          (!selectedImageProvider || option.provider === selectedImageProvider)
      );
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          image_provider: match?.provider || selectedImageProvider || undefined,
          image_model: cleanModel || undefined,
          provider: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: applyImagePinDefaultPatch(data.pinDefaults || {}, match, {
          excludeKeys: isEditImageNode || isUpscaleImageNode ? ['width', 'height'] : undefined,
          includeUpscale: isUpscaleImageNode,
        }),
      });
    },
    [
      currentImageProviderModelsTask,
      data.effectConfig,
      data.pinDefaults,
      id,
      imageModelOptions,
      isEditImageNode,
      isUpscaleImageNode,
      selectedImageProvider,
      updateNodeData,
    ]
  );

  const setVideoProviderSelection = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? normalizeMediaProvider(provider) : '';
      const nextDefaults = { ...(data.pinDefaults || {}) };
      if (clean) nextDefaults.video_provider = clean;
      else delete nextDefaults.video_provider;
      delete nextDefaults.video_model;
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          video_provider: clean || undefined,
          video_model: undefined,
          provider: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: nextDefaults,
      });
      if (clean) requestMediaCatalog('image', { provider: clean, task: currentVideoProviderModelsTask });
    },
    [currentVideoProviderModelsTask, data.effectConfig, data.pinDefaults, id, requestMediaCatalog, updateNodeData]
  );

  const setVideoModelSelection = useCallback(
    (model: string | null | undefined) => {
      const cleanModel = typeof model === 'string' ? model.trim() : '';
      const match = imageModelOptions.find(
        (option) =>
          option.model === cleanModel &&
          normalizeMediaCatalogTask(option.catalogTask) === normalizeMediaCatalogTask(currentVideoProviderModelsTask) &&
          (!selectedVideoProvider || option.provider === selectedVideoProvider)
      );
      const nextDefaults = applyImagePinDefaultPatch(data.pinDefaults || {}, match, { includeGuidanceScale: true });
      if (cleanModel) nextDefaults.video_model = cleanModel;
      else delete nextDefaults.video_model;
      if (match?.provider || selectedVideoProvider) nextDefaults.video_provider = match?.provider || selectedVideoProvider;
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          video_provider: match?.provider || selectedVideoProvider || undefined,
          video_model: cleanModel || undefined,
          provider: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: nextDefaults,
      });
    },
    [currentVideoProviderModelsTask, data.effectConfig, data.pinDefaults, id, imageModelOptions, selectedVideoProvider, updateNodeData]
  );

  const setTtsProviderSelection = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? normalizeMediaProvider(provider) : '';
      const formats = providerOptionMapValues(ttsFormatsByProvider, clean, formatOptionsFrom(undefined, ttsFormatFallback(clean)));
      const nextDefaults = { ...(data.pinDefaults || {}) };
      nextDefaults.format = formats[0]?.value || 'wav';
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          tts_provider: clean || undefined,
          provider: undefined,
          tts_model: undefined,
          model: undefined,
          voice: undefined,
          profile: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: nextDefaults,
      });
      if (clean) requestMediaCatalog('tts', { provider: clean, includeVoices: false });
    },
    [data.effectConfig, data.pinDefaults, id, requestMediaCatalog, ttsFormatsByProvider, updateNodeData]
  );

  const setSttProviderSelection = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? normalizeMediaProvider(provider) : '';
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          stt_provider: clean || undefined,
          provider: undefined,
          stt_model: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
      });
      if (clean) requestMediaCatalog('stt', { provider: clean });
    },
    [data.effectConfig, id, requestMediaCatalog, updateNodeData]
  );

  const setMusicProviderSelection = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? normalizeMediaProvider(provider) : '';
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          music_provider: clean || undefined,
          provider: undefined,
          music_model: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
      });
      if (clean) requestMediaCatalog('music', { provider: clean });
    },
    [data.effectConfig, id, requestMediaCatalog, updateNodeData]
  );

  const setModelResidencyPatch = useCallback(
    (patch: Record<string, JsonValue | undefined>) => {
      const nextEffect = { ...(data.effectConfig || {}) } as Record<string, JsonValue | undefined>;
      const nextDefaults = { ...(data.pinDefaults || {}) } as Record<string, JsonValue | undefined>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null || value === '') {
          delete nextEffect[key];
          delete nextDefaults[key];
        } else {
          nextEffect[key] = value;
          nextDefaults[key] = value;
        }
      }
      updateNodeData(id, {
        effectConfig: nextEffect as FlowNodeData['effectConfig'],
        pinDefaults: nextDefaults as FlowNodeData['pinDefaults'],
      });
    },
    [data.effectConfig, data.pinDefaults, id, updateNodeData]
  );

  const setModelResidencyTask = useCallback(
    (task: string) => {
	      const clean = task || 'text_generation';
	      setModelResidencyPatch({ task: clean, provider: undefined, model: undefined });
	      if (clean === 'image_generation') requestMediaCatalog('image', { providersOnly: true });
	      if (clean === 'image_to_image') requestMediaCatalog('image', { providersOnly: true, task: editedImageProviderModelsTask });
	      if (clean === 'image_upscale') requestMediaCatalog('image', { providersOnly: true, task: upscaledImageProviderModelsTask });
	      if (clean === 'text_to_video') requestMediaCatalog('image', { providersOnly: true, task: generatedVideoProviderModelsTask });
	      if (clean === 'image_to_video') requestMediaCatalog('image', { providersOnly: true, task: imageToVideoProviderModelsTask });
	      if (clean === 'tts') requestMediaCatalog('tts', { providersOnly: true });
      if (clean === 'stt') requestMediaCatalog('stt', { providersOnly: true });
      if (clean === 'music_generation') requestMediaCatalog('music', { providersOnly: true });
    },
	    [editedImageProviderModelsTask, generatedVideoProviderModelsTask, imageToVideoProviderModelsTask, requestMediaCatalog, setModelResidencyPatch, upscaledImageProviderModelsTask]
  );

  const setModelResidencyProvider = useCallback(
    (provider: string | null | undefined) => {
	      const clean = provider ? provider.trim() : '';
	      setModelResidencyPatch({ provider: clean || undefined, model: undefined });
	      if (selectedResidencyTask === 'image_generation' && clean) requestMediaCatalog('image', { provider: clean });
	      if (selectedResidencyTask === 'image_to_image' && clean) requestMediaCatalog('image', { provider: clean, task: editedImageProviderModelsTask });
	      if (selectedResidencyTask === 'image_upscale' && clean) requestMediaCatalog('image', { provider: clean, task: upscaledImageProviderModelsTask });
	      if (selectedResidencyTask === 'text_to_video' && clean) requestMediaCatalog('image', { provider: clean, task: generatedVideoProviderModelsTask });
	      if (selectedResidencyTask === 'image_to_video' && clean) requestMediaCatalog('image', { provider: clean, task: imageToVideoProviderModelsTask });
	      if (selectedResidencyTask === 'tts') requestMediaCatalog('tts', { provider: clean || undefined, includeVoices: false });
      if (selectedResidencyTask === 'stt') requestMediaCatalog('stt', { provider: clean || undefined });
      if (selectedResidencyTask === 'music_generation') requestMediaCatalog('music', { provider: clean || undefined });
    },
	    [editedImageProviderModelsTask, generatedVideoProviderModelsTask, imageToVideoProviderModelsTask, requestMediaCatalog, selectedResidencyTask, setModelResidencyPatch, upscaledImageProviderModelsTask]
  );

  const setModelResidencyModel = useCallback(
    (model: string | null | undefined) => {
      const clean = model ? model.trim() : '';
      setModelResidencyPatch({ model: clean || undefined });
    },
    [setModelResidencyPatch]
  );

  useEffect(() => {
    if ((!isGenerateImageNode && !isEditImageNode) || !selectedImageProvider || imageProviderPinConnected) return;
    const normalized = normalizeMediaProvider(selectedImageProvider);
    const current = data.pinDefaults || {};
    const nextDefaults = { ...current };
    let changed = false;
    if (nextDefaults.size !== undefined) {
      delete nextDefaults.size;
      changed = true;
    }
    if (normalized === 'openai' || normalized === 'openai-compatible') {
      for (const key of ['width', 'height', 'steps', 'guidance_scale'] as const) {
        if (nextDefaults[key] !== undefined) {
          delete nextDefaults[key];
          changed = true;
        }
      }
    } else {
      if (nextDefaults.steps === undefined) {
        nextDefaults.steps = 20;
        changed = true;
      }
    }
    if (nextDefaults.guidance_scale === 7.5) {
      delete nextDefaults.guidance_scale;
      changed = true;
    }
    if (isEditImageNode) {
      for (const key of ['width', 'height'] as const) {
        if (nextDefaults[key] !== undefined) {
          delete nextDefaults[key];
          changed = true;
        }
      }
    }
    if (changed) updateNodeData(id, { pinDefaults: nextDefaults });
  }, [data.pinDefaults, id, imageProviderPinConnected, isEditImageNode, isGenerateImageNode, selectedImageProvider, updateNodeData]);

  useEffect(() => {
    if (mediaLoading || mediaCapabilitiesQuery.isLoading) return;

    if ((isGenerateImageNode || isEditImageNode) && selectedImageProvider && selectedImageModel) {
      const ok = visibleImageModelOptions.some((option) => option.value === selectedImageModel);
      if (visibleImageModelOptions.length > 0 && !ok) setEffectConfigPatch({ image_model: undefined, model: undefined });
    }

    if (isVideoNode && selectedVideoProvider && selectedVideoModel) {
      const ok = visibleVideoModelOptions.some((option) => option.value === selectedVideoModel);
      if (visibleVideoModelOptions.length > 0 && !ok) setEffectConfigPatch({ video_model: undefined, model: undefined });
    }

    if (isGenerateVoiceNode && selectedTtsProvider) {
      const patch: Record<string, unknown> = {};
      if (ttsProviderOptions.length > 0 && !ttsProviderOptions.some((option) => option.value === selectedTtsProvider)) {
        patch.tts_provider = undefined;
        patch.provider = undefined;
        patch.tts_model = undefined;
        patch.model = undefined;
        patch.voice = undefined;
        patch.profile = undefined;
      }
      if (selectedTtsModel && visibleTtsModelOptions.length > 0 && !visibleTtsModelOptions.some((option) => option.value === selectedTtsModel)) {
        patch.tts_model = undefined;
        patch.model = undefined;
        patch.voice = undefined;
        patch.profile = undefined;
      }
      if (selectedVoice && visibleVoiceOptions.length > 0 && !visibleVoiceOptions.some((option) => option.value === selectedVoice)) {
        patch.voice = undefined;
      }
      if (selectedProfile && visibleProfileOptions.length > 0 && !visibleProfileOptions.some((option) => option.value === selectedProfile)) {
        patch.profile = undefined;
      }
      if (Object.keys(patch).length > 0) setEffectConfigPatch(patch);
    }

    if ((isListenVoiceNode || isTranscribeAudioNode) && selectedSttProvider && selectedSttModel) {
      const ok = visibleSttModelOptions.some((option) => option.value === selectedSttModel);
      if (visibleSttModelOptions.length > 0 && !ok) setEffectConfigPatch({ stt_model: undefined, model: undefined });
    }
  }, [
    isEditImageNode,
    isGenerateImageNode,
    isGenerateVoiceNode,
    isVideoNode,
    isListenVoiceNode,
    isTranscribeAudioNode,
    mediaCapabilitiesQuery.isLoading,
    mediaLoading,
    selectedImageModel,
    selectedImageProvider,
    selectedProfile,
    selectedSttModel,
    selectedSttProvider,
    selectedTtsModel,
    selectedTtsProvider,
    selectedVideoModel,
    selectedVideoProvider,
    selectedVoice,
    setEffectConfigPatch,
    visibleImageModelOptions,
    visibleProfileOptions,
    visibleSttModelOptions,
    visibleTtsModelOptions,
    visibleVideoModelOptions,
    visibleVoiceOptions,
  ]);

  const setProviderModel = useCallback(
    (provider: string | undefined, model: string | undefined) => {
      if (isSubflowNode) {
        const prev = data.pinDefaults || {};
        const next: typeof prev = { ...prev };

        if (!provider) delete next.provider;
        else next.provider = provider;

        if (!model) delete next.model;
        else next.model = model;

        updateNodeData(id, { pinDefaults: next });
        return;
      }
      if (isAgentNode) {
        const prev = data.agentConfig || {};
        updateNodeData(id, { agentConfig: { ...prev, provider: provider || undefined, model: model || undefined } });
        return;
      }
      if (isLlmNode) {
        const prev = data.effectConfig || {};
        updateNodeData(id, { effectConfig: { ...prev, provider: provider || undefined, model: model || undefined } });
        return;
      }
      if (isProviderModelsNode) {
        const prev = data.providerModelsConfig || {};
        updateNodeData(id, { providerModelsConfig: { ...prev, provider: provider || undefined, allowedModels: [] } });
      }
    },
    [data.agentConfig, data.effectConfig, data.pinDefaults, data.providerModelsConfig, id, isAgentNode, isLlmNode, isProviderModelsNode, isSubflowNode, updateNodeData]
  );

  const setSubflowFlow = useCallback(
    (value: string) => {
      const subflowId = value.trim() || undefined;
      subflowPinsSyncedRef.current = null;
      updateNodeData(id, {
        subflowId,
        ...(subflowId ? {} : defaultSubflowPinPatch(data)),
      });
    },
    [data, id, updateNodeData]
  );

  const setNodeTools = useCallback(
    (nextTools: string[]) => {
      const cleaned = nextTools
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim());
      const unique = Array.from(new Set(cleaned));

      if (isAgentNode) {
        const prev = data.agentConfig || {};
        updateNodeData(id, { agentConfig: { ...prev, tools: unique.length > 0 ? unique : undefined } });
        return;
      }

      if (isLlmNode) {
        const prev = data.effectConfig || {};
        updateNodeData(id, { effectConfig: { ...prev, tools: unique.length > 0 ? unique : undefined } });
        return;
      }

      if (isToolsAllowlistNode) {
        updateNodeData(id, { literalValue: unique });
        return;
      }

      if (isSubflowNode) {
        const prev = data.pinDefaults || {};
        const next: typeof prev = { ...prev };
        if (unique.length > 0) {
          next.tools = unique;
        } else {
          delete next.tools;
        }
        updateNodeData(id, { pinDefaults: next });
      }
    },
    [data.agentConfig, data.effectConfig, data.pinDefaults, id, isAgentNode, isLlmNode, isSubflowNode, isToolsAllowlistNode, updateNodeData]
  );

  const boolVarConfig = useMemo(() => {
    if (!isBoolVarNode) return { name: '', default: false };
    const raw = data.literalValue;
    if (typeof raw === 'string') return { name: raw.trim(), default: false };
    if (raw && typeof raw === 'object') {
      const name = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
      const def = typeof (raw as any).default === 'boolean' ? Boolean((raw as any).default) : false;
      return { name, default: def };
    }
    return { name: '', default: false };
  }, [data.literalValue, isBoolVarNode]);

  const setBoolVarConfig = useCallback(
    (next: { name: string; default: boolean }) => {
      if (!isBoolVarNode) return;
      updateNodeData(id, { literalValue: { name: next.name, default: next.default } });
    },
    [id, isBoolVarNode, updateNodeData]
  );

  const varDeclConfig = useMemo(() => {
    if (!isVarDeclNode) return { name: '', type: 'any' as const, default: null as JsonValue };
    const raw = data.literalValue;
    if (raw && typeof raw === 'object') {
      const name = typeof (raw as any).name === 'string' ? String((raw as any).name).trim() : '';
      const t = typeof (raw as any).type === 'string' ? String((raw as any).type).trim() : '';
      const type =
        t === 'boolean' ||
        t === 'number' ||
        t === 'string' ||
        t === 'provider' ||
        t === 'model' ||
        t === 'provider_text' ||
        t === 'model_text' ||
        t === 'provider_image' ||
        t === 'model_image' ||
        t === 'provider_voice' ||
        t === 'model_voice' ||
        t === 'provider_music' ||
        t === 'model_music' ||
        t === 'object' ||
        t === 'json_schema' ||
        t === 'assertion' ||
        t === 'assertions' ||
        t === 'array' ||
        t === 'tools' ||
        t === 'any'
          ? (t as Exclude<PinType, 'execution'>)
          : ('any' as const);
      const def = ((raw as any).default as JsonValue | undefined) ?? null;
      return { name, type, default: def };
    }
    return { name: '', type: 'any' as const, default: null as JsonValue };
  }, [data.literalValue, isVarDeclNode]);

  const setVarDeclConfig = useCallback(
    (next: { name: string; type: Exclude<PinType, 'execution'>; default: JsonValue }) => {
      if (!isVarDeclNode) return;
      const nextOutputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: next.type } : p));
      updateNodeData(id, { literalValue: { name: next.name, type: next.type, default: next.default }, outputs: nextOutputs });
    },
    [data.outputs, id, isVarDeclNode, updateNodeData]
  );

  const setPinDefault = useCallback(
    (pinId: string, value: JsonValue | undefined) => {
      const prev = data.pinDefaults || {};
      const next: typeof prev = { ...prev };
      if (value === undefined) {
        delete next[pinId];
      } else {
        next[pinId] = value;
      }
      updateNodeData(id, { pinDefaults: next });
    },
    [data.pinDefaults, id, updateNodeData]
  );

  const handleArtifactPinUpload = useCallback(
    async (pin: Pin, file: File | null) => {
      if (!file || !isArtifactPinType(pin.type)) return;
      const uploadDescriptor = gatewayContracts?.common?.attachments?.upload;
      if (!descriptorEndpointAvailable(uploadDescriptor)) {
        toast.error('Gateway attachment upload is not available.');
        return;
      }
      const sessionId = safeNodeArtifactSessionId(flowId, id);
      setArtifactUploadBusyPins((prev) => ({ ...prev, [pin.id]: true }));
      try {
        const form = new FormData();
        form.append('session_id', sessionId);
        form.append('file', file, file.name);
        form.append('filename', file.name);
        if (file.type) form.append('content_type', file.type);
        const url = endpointFromDescriptor(uploadDescriptor, '/api/gateway/attachments/upload');
        const res = await gatewayFetch(url, { method: 'POST', body: form, timeoutMs: 0 });
        const payload = (await res.json()) as Record<string, unknown>;
        const ref = artifactRefFromUploadResponse(payload);
        if (!ref) throw new Error('Gateway upload did not return an artifact reference.');
        setPinDefault(pin.id, ref as JsonValue);
        toast.success(`${pin.label || pin.id} uploaded`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Artifact upload failed.');
      } finally {
        setArtifactUploadBusyPins((prev) => {
          const next = { ...prev };
          delete next[pin.id];
          return next;
        });
      }
    },
    [flowId, gatewayContracts?.common?.attachments?.upload, id, setPinDefault]
  );

  const setCatalogProviderDefault = useCallback(
    (pinId: string, value: string | null | undefined) => {
      const pin = inputData.find((candidate) => candidate.id === pinId);
      const scope = pin ? providerCatalogScopeForPin(pin, data.nodeType) : null;
      const clean =
        scope && scope !== 'text'
          ? normalizeMediaProvider(value || '')
          : typeof value === 'string'
            ? value.trim()
            : '';
      const prev = data.pinDefaults || {};
      const next: typeof prev = { ...prev };
      if (clean) next[pinId] = clean;
      else delete next[pinId];

      for (const modelPin of inputData) {
        if (!isModelPin(modelPin)) continue;
        if (providerPinIdForModelPin(modelPin, inputData, data.nodeType) === pinId) {
          delete next[modelPin.id];
        }
      }

      updateNodeData(id, { pinDefaults: next });
      if (scope && scope !== 'text' && clean) requestModelCatalogForScope(scope, clean);
    },
    [data.nodeType, data.pinDefaults, id, inputData, requestModelCatalogForScope, updateNodeData]
  );

  const setVariableName = useCallback(
    (raw: string | null | undefined) => {
      if (!isVarNode) return;
      const name = normalizeVariableName(raw);
      const validationError = name ? validateVariableName(name) : null;
      if (validationError) {
        toast.error(validationError);
        return;
      }

      const prevDefaults = data.pinDefaults || {};
      const nextDefaults: typeof prevDefaults = { ...prevDefaults };
      if (!name) {
        delete nextDefaults.name;
      } else {
        nextDefaults.name = name;
      }

      const baseLabel = data.nodeType === 'set_var' ? 'Set Variable' : 'Get Variable';
      const prefix = data.nodeType === 'set_var' ? 'Set ' : 'Get ';

      // Auto-label for readability, but don't stomp explicit user labels.
      const prevLabel = data.label || baseLabel;
      const shouldAuto =
        prevLabel === baseLabel ||
        prevLabel === (prefix + (typeof prevDefaults.name === 'string' ? prevDefaults.name.trim() : '')) ||
        prevLabel.startsWith(prefix);

      const nextLabel = shouldAuto && name ? `${prefix}${name}` : prevLabel;
      const declaredType = name ? declaredVarTypes.get(name) : undefined;
      const nextType = declaredType ?? ('any' as const);

      const nextData: Partial<FlowNodeData> = { pinDefaults: nextDefaults, label: nextLabel };
      if (data.nodeType === 'get_var') {
        nextData.outputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
      } else if (data.nodeType === 'set_var') {
        nextData.inputs = data.inputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
        nextData.outputs = data.outputs.map((p) => (p.id === 'value' ? { ...p, type: nextType } : p));
      }

      updateNodeData(id, nextData);
    },
    [data.inputs, data.label, data.nodeType, data.outputs, data.pinDefaults, declaredVarTypes, id, isVarNode, updateNodeData]
  );

  const setEmitEventName = useCallback(
    (raw: string) => {
      if (!isEmitEventNode) return;
      const nextName = raw.trim();

      const prevDefaults = data.pinDefaults || {};
      const nextDefaults: typeof prevDefaults = { ...prevDefaults };
      if (!nextName) {
        delete nextDefaults.name;
      } else {
        nextDefaults.name = nextName;
      }

      const prevCfg = data.effectConfig || {};
      const nextCfg = { ...prevCfg, name: nextName || undefined };

      updateNodeData(id, { pinDefaults: nextDefaults, effectConfig: nextCfg });
    },
    [data.effectConfig, data.pinDefaults, id, isEmitEventNode, updateNodeData]
  );

  const emitEventScope = (data.effectConfig?.scope ?? 'session') as 'session' | 'workflow' | 'run' | 'global';
  const setEmitEventScope = useCallback(
    (next: string) => {
      if (!isEmitEventNode) return;
      const v = next === 'workflow' || next === 'run' || next === 'global' ? next : 'session';
      const prev = data.effectConfig || {};
      updateNodeData(id, { effectConfig: { ...prev, scope: v } });
    },
    [data.effectConfig, id, isEmitEventNode, updateNodeData]
  );

  const onEventScope = (data.eventConfig?.scope ?? 'session') as 'session' | 'workflow' | 'run' | 'global';
  const setOnEventScope = useCallback(
    (next: string) => {
      if (!isOnEventNode) return;
      const v = next === 'workflow' || next === 'run' || next === 'global' ? next : 'session';
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, scope: v } });
    },
    [data.eventConfig, id, isOnEventNode, updateNodeData]
  );

  const onScheduleSchedule = useMemo(() => {
    const raw = data.eventConfig?.schedule;
    const s = typeof raw === 'string' ? raw : '';
    return s.trim().length > 0 ? s : '15s';
  }, [data.eventConfig?.schedule]);

  const onScheduleRecurrent = data.eventConfig?.recurrent ?? true;

  const setOnScheduleSchedule = useCallback(
    (next: string) => {
      if (!isOnScheduleNode) return;
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, schedule: next } });
    },
    [data.eventConfig, id, isOnScheduleNode, updateNodeData]
  );

  const setOnScheduleRecurrent = useCallback(
    (next: boolean) => {
      if (!isOnScheduleNode) return;
      const prev = data.eventConfig || {};
      updateNodeData(id, { eventConfig: { ...prev, recurrent: next } });
    },
    [data.eventConfig, id, isOnScheduleNode, updateNodeData]
  );

  const isSequenceLike = data.nodeType === 'sequence';
  const isParallelLike = data.nodeType === 'parallel';
  const isSwitchNode = data.nodeType === 'switch';
  const isCompareNode = data.nodeType === 'compare';
  const isStringifyJsonNode = data.nodeType === 'stringify_json';
  const isConcatNode = data.nodeType === 'concat';
  const isArrayConcatNode = data.nodeType === 'array_concat';
  const isMakeArrayNode = data.nodeType === 'make_array';

  const delayDurationType = (data.effectConfig?.durationType ?? 'seconds') as
    | 'seconds'
    | 'minutes'
    | 'hours'
    | 'timestamp';

  const inputLabelWidth = useMemo(() => {
    let maxLen = 0;
    for (const p of inputData) {
      const label = typeof p.label === 'string' ? p.label : '';
      maxLen = Math.max(maxLen, label.length);
    }
    // Keep pin labels close to the pin (Blueprint-style), while aligning inline controls.
    const minCh = 2;
    const maxCh = 12;
    const clamped = Math.min(maxCh, Math.max(minCh, maxLen || 0));
    return `${clamped}ch`;
  }, [inputData]);

  const setDelayDurationType = useCallback(
    (next: string) => {
      const v =
        next === 'minutes' || next === 'hours' || next === 'timestamp' ? next : 'seconds';
      const prev = data.effectConfig || {};
      updateNodeData(id, { effectConfig: { ...prev, durationType: v } });
    },
    [data.effectConfig, id, updateNodeData]
  );

  const parseThenIndex = (raw: string): number | null => {
    const m = /^then:(\d+)$/.exec(raw);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  const parseCaseId = (raw: string): string | null => {
    if (!raw.startsWith('case:')) return null;
    const id = raw.slice('case:'.length);
    return id ? id : null;
  };

  const addThenPin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const existingExec = data.outputs.filter((p) => p.type === 'execution');
      const thenPins = existingExec.filter((p) => parseThenIndex(p.id) !== null);
      const completedPin = isParallelLike ? existingExec.find((p) => p.id === 'completed') : undefined;

      let maxIdx = -1;
      for (const p of thenPins) {
        const idx = parseThenIndex(p.id);
        if (idx !== null) maxIdx = Math.max(maxIdx, idx);
      }
      const nextIdx = maxIdx + 1;

      const newPin = { id: `then:${nextIdx}`, label: `Then ${nextIdx}`, type: 'execution' as const };

      // Preserve existing ordering, but keep `completed` (Parallel) as the last pin.
      const nextOutputs = (() => {
        const nonExec = data.outputs.filter((p) => p.type !== 'execution');
        const nextExec = isParallelLike
          ? [...thenPins, newPin, ...(completedPin ? [completedPin] : [])]
          : [...existingExec, newPin];
        return [...nonExec, ...nextExec];
      })();

      updateNodeData(id, { outputs: nextOutputs });
    },
    [data.outputs, id, isParallelLike, updateNodeData]
  );

  const removeThenPin = useCallback(
    (e: MouseEvent, pinId: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSequenceLike && !isParallelLike) return;

      const removedIdx = parseThenIndex(pinId);
      if (removedIdx === null) return;

      const thenPins = data.outputs.filter((p) => p.type === 'execution' && parseThenIndex(p.id) !== null);
      if (thenPins.length <= 1) return;

      const remappedHandles = new Map<string, string>();
      const nextOutputs = data.outputs
        .filter((p) => !(p.type === 'execution' && p.id === pinId))
        .map((p) => {
          if (p.type !== 'execution') return p;
          const idx = parseThenIndex(p.id);
          if (idx === null || idx < removedIdx) return p;
          const nextIdx = idx - 1;
          const nextId = `then:${nextIdx}`;
          remappedHandles.set(p.id, nextId);
          return { ...p, id: nextId, label: `Then ${nextIdx}` };
        });

      setEdges((currentEdges) =>
        currentEdges
          .filter((edge) => !(edge.source === id && edge.sourceHandle === pinId))
          .map((edge) => {
            if (edge.source !== id || !edge.sourceHandle) return edge;
            const nextHandle = remappedHandles.get(edge.sourceHandle);
            if (!nextHandle) return edge;
            return { ...edge, sourceHandle: nextHandle };
          })
      );
      updateNodeData(id, { outputs: nextOutputs });
    },
    [data.outputs, id, isParallelLike, isSequenceLike, setEdges, updateNodeData]
  );

  const addSwitchCasePin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isSwitchNode) return;

      const existingCases = data.switchConfig?.cases ?? [];

      const newId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto.randomUUID() as string).slice(0, 8)
          : `c${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;

      const nextCases = [...existingCases, { id: newId, value: '' }];

      const existingExec = data.outputs.filter((p) => p.type === 'execution');
      const existingById = new Map(existingExec.map((p) => [p.id, p] as const));

      const nextCasePins = nextCases.map((c) => {
        const pid = `case:${c.id}`;
        const existing = existingById.get(pid);
        return {
          id: pid,
          label: c.value || existing?.label || 'case',
          type: 'execution' as const,
        };
      });

      const defaultExisting = existingById.get('default');
      const defaultPin = { id: 'default', label: defaultExisting?.label || 'default', type: 'execution' as const };

      const reserved = new Set<string>([...nextCasePins.map((p) => p.id), 'default']);
      const extraExecPins = existingExec.filter((p) => !reserved.has(p.id));

      updateNodeData(id, {
        switchConfig: { cases: nextCases },
        outputs: [...nextCasePins, defaultPin, ...extraExecPins],
      });
    },
    [data.outputs, data.switchConfig?.cases, id, isSwitchNode, updateNodeData]
  );

  const addConcatInputPin = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isConcatNode && !isArrayConcatNode && !isMakeArrayNode) return;

      const pins = data.inputs.filter((p) => p.type !== 'execution');
      const ids = new Set(pins.map((p) => p.id));

      let nextId: string | null = null;
      for (let code = 97; code <= 122; code++) {
        const candidate = String.fromCharCode(code);
        if (!ids.has(candidate)) {
          nextId = candidate;
          break;
        }
      }
      if (!nextId) {
        let idx = pins.length + 1;
        while (ids.has(`p${idx}`)) idx++;
        nextId = `p${idx}`;
      }

      const nextPinType = isConcatNode ? ('string' as const) : isArrayConcatNode ? ('array' as const) : ('any' as const);
      updateNodeData(id, {
        inputs: [...data.inputs, { id: nextId, label: nextId, type: nextPinType }],
      });
    },
    [data.inputs, id, isArrayConcatNode, isConcatNode, isMakeArrayNode, updateNodeData]
  );

  const overlayHandleStyle = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    transform: 'none',
  };

  return (
    <AfTooltip content={nodeDescription} delayMs={2000} priority={0}>
      <div
        className={clsx(
          'flow-node',
          `flow-node--${data.nodeType}`,
          selected && 'selected',
          isExecuting && 'executing',
          isRecent && !isExecuting && 'recent',
          connectionPreview?.active && 'connection-preview-active'
        )}
      >
      {/* Header with execution pins */}
      <div
        className="node-header"
        style={{ backgroundColor: data.headerColor }}
      >
        {/* Execution input pin (left side of header) */}
        {inputExec && (
          <div className="exec-pin exec-pin-in nodrag">
            <Handle
              type="target"
              position={Position.Left}
              id={inputExec.id}
              className="exec-handle"
              onClickCapture={(e) => handlePinClick(e, inputExec.id, true)}
            />
            <span
              className="exec-shape"
              style={{ color: PIN_COLORS.execution }}
              onClick={(e) => handlePinClick(e, inputExec.id, true)}
            >
              <PinShape
                type="execution"
                size={12}
                filled={isPinConnected(inputExec.id, true)}
              />
            </span>
          </div>
        )}

        <span
          className="node-icon"
          dangerouslySetInnerHTML={{ __html: data.icon }}
        />
        <span className="node-title">{data.label}</span>
        {loopBadge ? <span className="node-progress-badge" title="Loop progress">{loopBadge}</span> : null}

        {/* Execution output pins (right side of header) */}
        {outputExecs.length === 1 && !isSwitchNode && (
          <div className="exec-pin exec-pin-out nodrag">
            <span
              className="exec-shape"
              style={{ color: PIN_COLORS.execution }}
              onClick={(e) => handlePinClick(e, outputExecs[0].id, false)}
            >
              <PinShape
                type="execution"
                size={12}
                filled={isPinConnected(outputExecs[0].id, false)}
              />
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={outputExecs[0].id}
              className="exec-handle"
              onClickCapture={(e) => handlePinClick(e, outputExecs[0].id, false)}
            />
          </div>
        )}
      </div>

      {/* Body with pins */}
      <div className="node-body">
        {isSubflowNode && (
          <div
            className="pins-left node-subflow-selector"
            style={{ ['--pin-label-width' as any]: inputLabelWidth }}
          >
            <div className="pin-row input subflow-selector-row nodrag">
              <span className="pin-hit">
                <span className="pin-shape pin-shape-placeholder" aria-hidden="true" />
                <span className="pin-label">flow</span>
              </span>
              <div className="pin-inline-controls subflow-selector-controls">
                <AfSelect
                  variant="pin"
                  value={data.subflowId || ''}
                  placeholder={
                    subflowSelectorLoading
                      ? 'Loading...'
                      : subflowSelectorDisabled
                        ? 'Gateway unavailable'
                        : 'Select flow...'
                  }
                  options={subflowFlowOptions}
                  disabled={subflowSelectorDisabled}
                  loading={subflowSelectorLoading}
                  searchable
                  searchPlaceholder="Search flows..."
                  clearable
                  minPopoverWidth={320}
                  onChange={setSubflowFlow}
                />
              </div>
            </div>
          </div>
        )}

        {/* Multiple execution outputs (for branch nodes like If/Else) */}
        {(outputExecs.length > 1 || isSwitchNode) && (
          <div className="pins-right exec-branches">
            {(() => {
              // Special layout:
              // - Sequence: Then pins + "Add pin"
              // - Parallel: Then pins + "Add pin" + Completed (bottom-right)
              if (isSequenceLike || isParallelLike) {
                const thenPins = outputExecs
                  .filter((p) => /^then:\d+$/.test(p.id))
                  .sort((a, b) => (parseThenIndex(a.id) ?? 0) - (parseThenIndex(b.id) ?? 0));
                const completed = isParallelLike ? outputExecs.find((p) => p.id === 'completed') : undefined;

                return (
                  <>
                    {thenPins.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <button
                          type="button"
                          className="exec-remove-pin"
                          title={`Remove ${pin.label}`}
                          aria-label={`Remove ${pin.label}`}
                          disabled={thenPins.length <= 1}
                          onClick={(e) => removeThenPin(e, pin.id)}
                        >
                          -
                        </button>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape
                            type="execution"
                            size={12}
                            filled={isPinConnected(pin.id, false)}
                          />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    <div className="pin-row output exec-add-pin" onClick={addThenPin}>
                      <span className="pin-label">Add pin</span>
                      <span className="exec-add-plus">+</span>
                    </div>

                    {completed ? (
                      <div key={completed.id} className="pin-row output exec-branch exec-completed nodrag">
                        <span className="pin-label">{completed.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, completed.id, false)}
                        >
                          <PinShape
                            type="execution"
                            size={12}
                            filled={isPinConnected(completed.id, false)}
                          />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={completed.id}
                          className="exec-handle"
                          onClickCapture={(e) => handlePinClick(e, completed.id, false)}
                        />
                      </div>
                    ) : null}
                  </>
                );
              }

              // Switch: case pins + "Add pin" + Default (always visible)
              if (isSwitchNode) {
                const casePins = outputExecs.filter((p) => parseCaseId(p.id) !== null);
                const defaultPin = outputExecs.find((p) => p.id === 'default');
                const extras = outputExecs.filter((p) => p.id !== 'default' && parseCaseId(p.id) === null);

                return (
                  <>
                    {casePins.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(pin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    {extras.map((pin) => (
                      <div key={pin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{pin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(pin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className="exec-handle"
                          onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </div>
                    ))}

                    {defaultPin ? (
                      <div key={defaultPin.id} className="pin-row output exec-branch nodrag">
                        <span className="pin-label">{defaultPin.label}</span>
                        <span
                          className="pin-shape"
                          style={{ color: PIN_COLORS.execution }}
                          onClick={(e) => handlePinClick(e, defaultPin.id, false)}
                        >
                          <PinShape type="execution" size={12} filled={isPinConnected(defaultPin.id, false)} />
                        </span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={defaultPin.id}
                          className="exec-handle"
                          onClickCapture={(e) => handlePinClick(e, defaultPin.id, false)}
                        />
                      </div>
                    ) : null}

                    <div className="pin-row output exec-add-pin" onClick={addSwitchCasePin}>
                      <span className="pin-label">Add pin</span>
                      <span className="exec-add-plus">+</span>
                    </div>
                  </>
                );
              }

              // Default: render all execution outputs in order.
              return outputExecs.map((pin) => (
                <div key={pin.id} className="pin-row output exec-branch nodrag">
                  <span className="pin-label">{pin.label}</span>
                  <span
                    className="pin-shape"
                    style={{ color: PIN_COLORS.execution }}
                    onClick={(e) => handlePinClick(e, pin.id, false)}
                  >
                    <PinShape
                      type="execution"
                      size={12}
                      filled={isPinConnected(pin.id, false)}
                    />
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={pin.id}
                    className="exec-handle"
                    onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                  />
                </div>
              ));
            })()}
          </div>
        )}

        {data.nodeType === 'on_event' && (
          <OnEventNameInline
            nodeId={id}
            value={data.eventConfig?.name || ''}
            eventConfig={data.eventConfig}
            updateNodeData={updateNodeData}
          />
        )}

        {data.nodeType === 'tools_allowlist' && (
          <ToolsAllowlistInline
            tools={selectedTools}
            toolOptions={toolOptions}
            loading={toolsQuery.isLoading}
            onChange={setNodeTools}
          />
        )}

        {data.nodeType === 'tool_parameters' && (
          <ToolParametersInline
            tool={selectedToolParametersTool}
            toolOptions={toolOptions}
            loading={toolsQuery.isLoading}
            onChange={setToolParametersTool}
          />
        )}

        {data.nodeType === 'bool_var' && (
          <BoolVarInline
            name={boolVarConfig.name}
            defaultValue={boolVarConfig.default}
            options={variableOptions.map((o) => o.value)}
            onChange={setBoolVarConfig}
          />
        )}

        {data.nodeType === 'var_decl' && (
          <VarDeclInline
            name={varDeclConfig.name}
            varType={varDeclConfig.type}
            defaultValue={varDeclConfig.default}
            nameOptions={variableOptions.map((o) => o.value)}
            toolOptions={toolOptions}
            toolLoading={toolsQuery.isLoading}
            onChange={setVarDeclConfig}
          />
        )}

        {isCodeNode && (
          <div className="node-code-edit-row nodrag">
            <button
              type="button"
              className="node-code-edit-button nodrag"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowCodeEditor(true);
              }}
              title="Edit code"
            >
              ✍️ Edit Code
            </button>
          </div>
        )}

        {selected && residencyAuthoringTarget && (
          <>
            <div className="node-residency-row nodrag">
              <button
                type="button"
                className="node-residency-button nodrag"
                disabled={Boolean(residencyAuthoringTarget.blockedReason)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddModelResidencyStep('load');
                }}
                title="Insert a load step before this node"
              >
                Load before
              </button>
              <button
                type="button"
                className="node-residency-button nodrag"
                disabled={Boolean(residencyAuthoringTarget.blockedReason)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddModelResidencyStep('unload');
                }}
                title="Insert an unload step after this node"
              >
                Unload after
              </button>
            </div>
            <div className="node-residency-target nodrag">
              {residencyAuthoringTarget.blockedReason
                ? residencyAuthoringTarget.blockedReason
                : residencyAuthoringTarget.provider && residencyAuthoringTarget.model
                ? `${residencyAuthoringTarget.provider} / ${residencyAuthoringTarget.model}`
                : `Gateway default ${residencyAuthoringTarget.task.replace(/_/g, ' ')}`}
            </div>
          </>
        )}

        {/* Data input pins */}
        <div className="pins-left" style={{ ['--pin-label-width' as any]: inputLabelWidth }}>
          {inputData.map((pin) => {
            const feedback = connectionPreview?.inputs?.[pin.id];
            return (
            <Fragment key={pin.id}>
              <div
                className={clsx(
                  'pin-row',
                  'input',
                  feedback?.status === 'valid' && 'pin-feedback-valid',
                  feedback?.status === 'invalid' && 'pin-feedback-invalid'
                )}
                aria-invalid={feedback?.status === 'invalid' ? true : undefined}
                data-connection-feedback={feedback?.status}
                title={feedback?.message || undefined}
              >
                <AfTooltip content={pin.description} delayMs={700} priority={2}>
                  <span className="pin-hit">
                    <span
                      className="pin-shape"
                      style={{ color: PIN_COLORS[pin.type] }}
                      onClick={(e) => handlePinClick(e, pin.id, true)}
                    >
                      <PinShape type={pin.type} size={10} filled={isPinConnected(pin.id, true)} />
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={pin.id}
                        className={`pin ${pin.type}`}
                        style={overlayHandleStyle}
                        onClickCapture={(e) => handlePinClick(e, pin.id, true)}
                      />
                    </span>
                    <span className="pin-label">{pin.label}</span>
                  </span>
                </AfTooltip>
                {(() => {
                  const connected = isPinConnected(pin.id, true);
                  const controls: ReactNode[] = [];

                const isPrimitive =
                  pin.type === 'string' ||
                  pin.type === 'number' ||
                  pin.type === 'boolean';
                const isEmitEventName = isEmitEventNode && pin.id === 'name';
                const isEmitEventScopePin = isEmitEventNode && pin.id === 'scope';
                const isOnEventScopePin = isOnEventNode && pin.id === 'scope';
                const isOnScheduleTimestampPin = isOnScheduleNode && pin.id === 'schedule';
                const isOnScheduleRecurrentPin = isOnScheduleNode && pin.id === 'recurrent';
                const isWriteFileContentPin = isWriteFileNode && pin.id === 'content';
                const isCompareOpPin = isCompareNode && pin.id === 'op';
                const isStringifyJsonModePin = isStringifyJsonNode && pin.id === 'mode';
                const isThinkingPin = (isAgentNode || isLlmNode) && pin.id === 'thinking';
                const isAnswerUserLevelPin = isAnswerUserNode && pin.id === 'level';
	                const isMemoryScopePin =
	                  (isMemoryNoteNode ||
	                    isMemoryQueryNode ||
	                    isMemoryTagNode ||
	                    isMemoryKgAssertNode ||
	                    isMemoryKgQueryNode ||
	                    isMemoryKgResolveNode) &&
	                  pin.id === 'scope';
	                const isRecallLevelPin =
	                  pin.id === 'recall_level' &&
	                  (isMemoryQueryNode ||
	                    isMemoryRehydrateNode ||
	                    isMemoryKgQueryNode ||
	                    isMemoryKgResolveNode ||
	                    (isSubflowNode && inputData.some((p) => p.id === 'query_text' || p.id === 'query')));
	                const isSubflowScopePin = isSubflowNode && pin.id === 'scope';
	                const isMemoryTagsModePin = isMemoryQueryNode && pin.id === 'tags_mode';
                const isMemoryPlacementPin = isMemoryRehydrateNode && pin.id === 'placement';
                const isArtifactInputPin = isArtifactPinType(pin.type);
	                  const isImageProviderPin = (isGenerateImageNode || isEditImageNode || isUpscaleImageNode) && pin.id === 'image_provider';
	                  const isImageModelPin = (isGenerateImageNode || isEditImageNode || isUpscaleImageNode) && pin.id === 'image_model';
	                  const isImageFormatPin = (isGenerateImageNode || isEditImageNode || isUpscaleImageNode) && pin.id === 'format';
	                  const isVideoProviderPin = isVideoNode && pin.id === 'video_provider';
	                  const isVideoModelPin = isVideoNode && pin.id === 'video_model';
	                  const isVideoFormatPin = isVideoNode && pin.id === 'format';
	                  const isTtsProviderPin = isGenerateVoiceNode && pin.id === 'tts_provider';
                  const isTtsModelPin = isGenerateVoiceNode && pin.id === 'tts_model';
                  const isTtsFormatPin = isGenerateVoiceNode && pin.id === 'format';
                  const isTtsQualityPresetPin = isGenerateVoiceNode && pin.id === 'quality_preset';
                  const isTtsSpeedPin = isGenerateVoiceNode && pin.id === 'speed';
                  const isVoicePin = isGenerateVoiceNode && pin.id === 'voice';
                  const isVoiceProfilePin = isGenerateVoiceNode && pin.id === 'profile';
                  const isSttProviderPin = (isListenVoiceNode || isTranscribeAudioNode) && pin.id === 'stt_provider';
                  const isSttModelPin = (isListenVoiceNode || isTranscribeAudioNode) && pin.id === 'stt_model';
                  const isSttFormatPin = isTranscribeAudioNode && pin.id === 'format';
                  const isMusicProviderPin = isGenerateMusicNode && pin.id === 'music_provider';
                  const isMusicModelPin = isGenerateMusicNode && pin.id === 'music_model';
                  const isMusicFormatPin = isGenerateMusicNode && pin.id === 'format';
                  const isCodePermissionsPin = isCodeNode && pin.id === 'permissions';
                  const isSchemaPin = isJsonSchemaInputPin(pin);
                  const isJsonDefaultPin = pin.type === 'object' && !isSchemaPin;
                  const isResidencyOperationPin = isModelResidencyNode && pin.id === 'operation';
                  const isResidencyTaskPin = isModelResidencyNode && pin.id === 'task';
                  const isResidencyProviderPin = isModelResidencyNode && pin.id === 'provider';
                  const isResidencyModelPin = isModelResidencyNode && pin.id === 'model';
		                const hasSpecialControl =
		                  (hasProviderDropdown && pin.id === 'provider') ||
		                  (hasModelControls && pin.id === 'model') ||
                      isResidencyOperationPin ||
                      isResidencyTaskPin ||
                      isResidencyProviderPin ||
                      isResidencyModelPin ||
                      isImageProviderPin ||
                      isImageModelPin ||
                      isImageFormatPin ||
                      isVideoProviderPin ||
                      isVideoModelPin ||
                      isVideoFormatPin ||
                      isTtsProviderPin ||
                      isTtsModelPin ||
                      isTtsFormatPin ||
                      isTtsQualityPresetPin ||
                      isTtsSpeedPin ||
                      isVoicePin ||
                      isVoiceProfilePin ||
                      isSttProviderPin ||
                      isSttModelPin ||
                      isSttFormatPin ||
                      isMusicProviderPin ||
                      isMusicModelPin ||
                      isMusicFormatPin ||
                      isCodePermissionsPin ||
                      isSchemaPin ||
                      isJsonDefaultPin ||
                      isThinkingPin ||
                      isAnswerUserLevelPin ||
	                  ((isAgentNode || isLlmNode || subflowHasToolsPin) && pin.id === 'tools') ||
	                  (isVarNode && pin.id === 'name') ||
	                  isCompareOpPin ||
	                  isStringifyJsonModePin ||
                  isEmitEventName ||
                  isEmitEventScopePin ||
                  isOnEventScopePin ||
                  isOnScheduleTimestampPin ||
                  isOnScheduleRecurrentPin ||
	                  isWriteFileContentPin ||
	                  isMemoryScopePin ||
	                  isRecallLevelPin ||
	                  isSubflowScopePin ||
	                  isMemoryTagsModePin ||
	                  isMemoryPlacementPin;

                if (isEmitEventName) {
                  const pinned = pinDefaults.name;
                  const configured = data.effectConfig?.name;
                  const nameValue =
                    (typeof pinned === 'string' ? pinned : undefined) ??
                    (typeof configured === 'string' ? configured : undefined) ??
                    '';

                  if (!connected) {
                    controls.push(
                      <input
                        key="emit-name"
                        className="af-pin-input nodrag"
                        type="text"
                        value={nameValue}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEmitEventName(e.target.value)}
                      />
                    );
                  }
                }

                if ((isEmitEventScopePin || isOnEventScopePin) && !connected) {
                  const value = isEmitEventScopePin ? emitEventScope : onEventScope;
                  const onChange = isEmitEventScopePin ? setEmitEventScope : setOnEventScope;

                  controls.push(
                    <AfSelect
                      key="scope"
                      variant="pin"
                      value={value}
                      placeholder="session"
                      options={[
                        { value: 'session', label: 'session' },
                        { value: 'workflow', label: 'workflow' },
                        { value: 'run', label: 'run' },
                        { value: 'global', label: 'global' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={onChange}
                    />
                  );
                }

                if ((isMemoryScopePin || isSubflowScopePin) && !connected) {
                  const raw = pinDefaults.scope;
                  const currentScope =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'run';

                  const allowAll =
                    isMemoryQueryNode ||
                    isMemoryTagNode ||
                    isMemoryKgQueryNode ||
                    (isSubflowScopePin && inputData.some((p) => p.id === 'query_text' || p.id === 'query'));
                  const options = allowAll
                    ? [
                        { value: 'run', label: 'run' },
                        { value: 'session', label: 'session' },
                        { value: 'global', label: 'global' },
                        { value: 'all', label: 'all' },
                      ]
                    : [
                        { value: 'run', label: 'run' },
                        { value: 'session', label: 'session' },
                        { value: 'global', label: 'global' },
                      ];

                  controls.push(
                    <AfSelect
                      key="memory-scope"
                      variant="pin"
                      value={currentScope}
                      placeholder="run"
                      options={options}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('scope', (v || 'run') as any)}
                    />
                  );
                }

                if (isMemoryTagsModePin && !connected) {
                  const raw = pinDefaults.tags_mode;
                  const current =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'all';
                  controls.push(
                    <AfSelect
                      key="memory-tags-mode"
                      variant="pin"
                      value={current}
                      placeholder="all"
                      options={[
                        { value: 'all', label: 'all (AND)' },
                        { value: 'any', label: 'any (OR)' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('tags_mode', (v || 'all') as any)}
                    />
                  );
                }

	                if (isMemoryPlacementPin && !connected) {
	                  const raw = pinDefaults.placement;
	                  const currentPlacement =
	                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'after_summary';
                  controls.push(
                    <AfSelect
                      key="memory-placement"
                      variant="pin"
                      value={currentPlacement}
                      placeholder="after_summary"
                      options={[
                        { value: 'after_summary', label: 'after_summary' },
                        { value: 'after_system', label: 'after_system' },
                        { value: 'end', label: 'end' },
                      ]}
                      searchable={false}
                      minPopoverWidth={200}
                      onChange={(v) => setPinDefault('placement', (v || 'after_summary') as any)}
                    />
	                  );
	                }

	                if (isRecallLevelPin && !connected) {
	                  const raw = pinDefaults.recall_level;
	                  const current =
	                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().toLowerCase() : 'standard';
	                  const options = [
	                    { value: 'urgent', label: 'urgent' },
	                    { value: 'standard', label: 'standard' },
	                    { value: 'deep', label: 'deep' },
	                  ];
	                  controls.push(
	                    <AfSelect
	                      key="recall-level"
	                      variant="pin"
	                      value={options.some((o) => o.value === current) ? current : 'standard'}
	                      placeholder="standard"
	                      options={options}
	                      searchable={false}
	                      minPopoverWidth={180}
	                      onChange={(v) => setPinDefault('recall_level', (v || 'standard') as any)}
	                    />
	                  );
	                }

	                if (isCompareOpPin && !connected) {
	                  const raw = pinDefaults.op;
	                  const currentOp = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '==';
	                  controls.push(
                    <AfSelect
                      key="compare-op"
                      variant="pin"
                      value={currentOp}
                      placeholder="=="
                      options={[
                        { value: '==', label: '==' },
                        { value: '>=', label: '>=' },
                        { value: '>', label: '>' },
                        { value: '<=', label: '<=' },
                        { value: '<', label: '<' },
                      ]}
                      searchable={false}
                      minPopoverWidth={120}
                      onChange={(v) => setPinDefault('op', (v || '==') as any)}
                    />
                  );
                }

                if (isStringifyJsonModePin && !connected) {
                  const raw = pinDefaults.mode;
                  const current =
                    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'beautify';
                  controls.push(
                    <AfSelect
                      key="stringify-json-mode"
                      variant="pin"
                      value={current}
                      placeholder="beautify"
                      options={[
                        { value: 'none', label: 'none' },
                        { value: 'beautify', label: 'beautify' },
                        { value: 'minified', label: 'minified' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('mode', (v || 'beautify') as any)}
                    />
                  );
                }

                if (isThinkingPin && !connected) {
                  const currentThinking = effectiveThinkingOptions.some((option) => option.value === selectedThinkingValue)
                    ? selectedThinkingValue
                    : '';
                  controls.push(
                    <AfSelect
                      key="thinking"
                      variant="pin"
                      value={currentThinking}
                      placeholder="Auto (Gateway default)"
                      options={effectiveThinkingOptions}
                      searchable={false}
                      clearable={false}
                      minPopoverWidth={220}
                      onChange={(v) => {
                        const clean = v || undefined;
                        if (isAgentNode) {
                          const prev = data.agentConfig || {};
                          updateNodeData(id, { agentConfig: { ...prev, thinking: clean } });
                          return;
                        }
                        if (isLlmNode) {
                          const prev = data.effectConfig || {};
                          updateNodeData(id, { effectConfig: { ...prev, thinking: clean } });
                        }
                      }}
                    />
                  );
                }

                if (isAnswerUserLevelPin && !connected) {
                  const raw = pinDefaults.level;
                  const currentLevel =
                    typeof raw === 'string' && ANSWER_USER_LEVEL_OPTIONS.some((option) => option.value === raw.trim())
                      ? raw.trim()
                      : 'message';
                  controls.push(
                    <AfSelect
                      key="answer-user-level"
                      variant="pin"
                      value={currentLevel}
                      placeholder="message"
                      options={ANSWER_USER_LEVEL_OPTIONS}
                      searchable={false}
                      clearable={false}
                      minPopoverWidth={160}
                      onChange={(v) => setPinDefault('level', v || 'message')}
                    />
                  );
                }

                if (isOnScheduleTimestampPin && !connected) {
                  controls.push(
                    <input
                      key="on-schedule-timestamp"
                      className="af-pin-input nodrag"
                      type="text"
                      value={onScheduleSchedule}
                      placeholder=""
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setOnScheduleSchedule(e.target.value)}
                    />
                  );
                }

                if (isOnScheduleRecurrentPin && !connected) {
                  controls.push(
                    <label
                      key="on-schedule-recurrent"
                      className="af-pin-checkbox nodrag"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        className="af-pin-checkbox-input"
                        type="checkbox"
                        checked={onScheduleRecurrent}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setOnScheduleRecurrent(e.target.checked)}
                      />
                      <span className="af-pin-checkbox-box" aria-hidden="true" />
                    </label>
                  );
                }

                if (isArtifactInputPin && !connected) {
                  const currentArtifactId = artifactIdFromRef(pinDefaults[pin.id]);
                  const busy = Boolean(artifactUploadBusyPins[pin.id]);
                  controls.push(
                    <Fragment key="artifact-upload">
                      <input
                        ref={(el) => {
                          artifactUploadInputsRef.current[pin.id] = el;
                        }}
                        className="node-artifact-upload-input"
                        type="file"
                        accept={artifactAcceptForPin(pin.type)}
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0] || null;
                          e.currentTarget.value = '';
                          void handleArtifactPinUpload(pin, file);
                        }}
                      />
                      <button
                        type="button"
                        className="node-artifact-upload-button nodrag"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          artifactUploadInputsRef.current[pin.id]?.click();
                        }}
                        disabled={busy}
                        title={currentArtifactId ? `Replace artifact ${currentArtifactId}` : `Upload ${pin.label || pin.id}`}
                      >
                        {busy ? '...' : currentArtifactId ? 'Replace' : 'Upload'}
                      </button>
                    </Fragment>
                  );
                }

                if (isSchemaPin && !connected) {
                  const hasSchema = hasJsonSchemaPinDefault(pinDefaults[pin.id]);
                  controls.push(
                    <button
                      key="schema-editor"
                      type="button"
                      className="node-schema-edit-button nodrag"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSchemaEditorPinId(pin.id);
                      }}
                      title={`${hasSchema ? 'Edit' : 'Define'} ${pin.label || pin.id}`}
                    >
                      {hasSchema ? 'Edit' : 'Define'}
                    </button>
                  );
                }

                if (isJsonDefaultPin && !connected) {
                  const raw = pinDefaults[pin.id];
                  const hasJsonDefault = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw));
                  controls.push(
                    <button
                      key="json-default-editor"
                      type="button"
                      className="node-schema-edit-button nodrag"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setJsonDefaultEditorPinId(pin.id);
                      }}
                      title={`${hasJsonDefault ? 'Edit' : 'Define'} ${pin.label || pin.id} JSON`}
                    >
                      {hasJsonDefault ? 'Edit' : 'Define'}
                    </button>
                  );
                }

                if (isWriteFileContentPin && !connected) {
                  const raw = pinDefaults.content;
                  controls.push(
                    <input
                      key="file-content"
                      className="af-pin-input nodrag"
                      type="text"
                      value={typeof raw === 'string' ? raw : ''}
                      placeholder=""
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setPinDefault('content', e.target.value)}
                    />
                  );
                }

                if (isVarNode && pin.id === 'name') {
                  const raw = pinDefaults.name;
                  const current = typeof raw === 'string' ? raw : '';

                  if (!connected) {
                    controls.push(
                      <AfSelect
                        key="var-name"
                        variant="pin"
                        value={current}
                        placeholder="Select…"
                        options={variableOptions}
                        searchable
                        allowCustom
                        searchPlaceholder="Search or type variable…"
                        customOptionLabel={variableNameCustomOptionLabel}
                        validateCustomValue={(v) => validateVariableName(v)}
                        clearable
                        minPopoverWidth={260}
                        onChange={(v) => setVariableName(v || '')}
                      />
                    );
                  }
                }

                if (isResidencyOperationPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="model-residency-operation"
                      variant="pin"
                      value={selectedResidencyOperation}
                      placeholder="load"
                      options={[
                        { value: 'load', label: 'load' },
                        { value: 'list_loaded', label: 'list loaded' },
                        { value: 'unload', label: 'unload' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setModelResidencyPatch({ operation: v || 'load' })}
                    />
                  );
                }

                if (isResidencyTaskPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="model-residency-task"
                      variant="pin"
                      value={selectedResidencyTask}
                      placeholder="text"
                      options={[
                        { value: 'text_generation', label: 'text' },
                        { value: 'image_generation', label: 'image' },
                        { value: 'image_to_image', label: 'image edit' },
                        { value: 'image_upscale', label: 'image upscale' },
                        { value: 'text_to_video', label: 'text to video' },
                        { value: 'image_to_video', label: 'image to video' },
                        { value: 'tts', label: 'speech' },
                        { value: 'stt', label: 'transcription' },
                        { value: 'music_generation', label: 'music' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={setModelResidencyTask}
                    />
                  );
                }

                if (isResidencyProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="model-residency-provider"
                      variant="pin"
                      value={selectedResidencyProvider}
                      placeholder={
                        mediaLoading || providersQuery.isLoading || mediaCapabilitiesQuery.isLoading
                          ? 'Loading…'
                          : 'Select…'
                      }
                      options={residencyProviderOptions}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || providersQuery.isLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      allowCustom
                      searchPlaceholder="Search providers…"
                      clearable
                      minPopoverWidth={300}
	                      onOpen={() => {
	                        if (selectedResidencyTask === 'image_generation') requestMediaCatalog('image', { providersOnly: true });
	                        if (selectedResidencyTask === 'image_to_image') requestMediaCatalog('image', { providersOnly: true, task: editedImageProviderModelsTask });
	                        if (selectedResidencyTask === 'image_upscale') requestMediaCatalog('image', { providersOnly: true, task: upscaledImageProviderModelsTask });
	                        if (selectedResidencyTask === 'text_to_video') requestMediaCatalog('image', { providersOnly: true, task: generatedVideoProviderModelsTask });
	                        if (selectedResidencyTask === 'image_to_video') requestMediaCatalog('image', { providersOnly: true, task: imageToVideoProviderModelsTask });
	                        if (selectedResidencyTask === 'tts') requestMediaCatalog('tts', { providersOnly: true });
                        if (selectedResidencyTask === 'stt') requestMediaCatalog('stt', { providersOnly: true });
                        if (selectedResidencyTask === 'music_generation') requestMediaCatalog('music', { providersOnly: true });
                      }}
                      onChange={setModelResidencyProvider}
                    />
                  );
                }

                if (isResidencyModelPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="model-residency-model"
                      variant="pin"
                      value={selectedResidencyModel}
                      placeholder={
                        !selectedResidencyProvider
                          ? 'Pick provider…'
                          : mediaLoading || modelsQuery.isLoading || mediaCapabilitiesQuery.isLoading
                            ? 'Loading…'
                            : 'Select…'
                      }
                      options={residencyModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedResidencyProvider}
                      loading={mediaLoading || modelsQuery.isLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      allowCustom
                      searchPlaceholder="Search models…"
                      clearable
                      minPopoverWidth={420}
                      onOpen={() => {
	                        if (selectedResidencyTask === 'image_generation' && selectedResidencyProvider) {
	                          requestMediaCatalog('image', { provider: selectedResidencyProvider });
	                        }
	                        if (selectedResidencyTask === 'image_to_image' && selectedResidencyProvider) {
	                          requestMediaCatalog('image', { provider: selectedResidencyProvider, task: editedImageProviderModelsTask });
	                        }
	                        if (selectedResidencyTask === 'image_upscale' && selectedResidencyProvider) {
	                          requestMediaCatalog('image', { provider: selectedResidencyProvider, task: upscaledImageProviderModelsTask });
	                        }
	                        if (selectedResidencyTask === 'text_to_video' && selectedResidencyProvider) {
	                          requestMediaCatalog('image', { provider: selectedResidencyProvider, task: generatedVideoProviderModelsTask });
	                        }
	                        if (selectedResidencyTask === 'image_to_video' && selectedResidencyProvider) {
	                          requestMediaCatalog('image', { provider: selectedResidencyProvider, task: imageToVideoProviderModelsTask });
	                        }
	                        if (selectedResidencyTask === 'tts' && selectedResidencyProvider) {
                          requestMediaCatalog('tts', { provider: selectedResidencyProvider, includeVoices: false });
                        }
                        if (selectedResidencyTask === 'stt' && selectedResidencyProvider) {
                          requestMediaCatalog('stt', { provider: selectedResidencyProvider });
                        }
                        if (selectedResidencyTask === 'music_generation' && selectedResidencyProvider) {
                          requestMediaCatalog('music', { provider: selectedResidencyProvider });
                        }
                      }}
                      onChange={setModelResidencyModel}
                    />
                  );
                }

                if (isImageProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="image-provider"
                      variant="pin"
                      value={selectedImageProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
                      options={withGatewayDefaultOption(imageProviderOptions)}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search image providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestMediaCatalog('image', { providersOnly: true, task: currentImageProviderModelsTask })}
                      onChange={(v) => setImageProviderSelection(v)}
                    />
                  );
                }

	                if (isImageModelPin && !connected) {
	                  controls.push(
                    <AfSelect
                      key="image-model"
                      variant="pin"
                      value={selectedImageModel}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : selectedImageProvider ? 'Select…' : 'Auto (Gateway default)'}
                      options={visibleImageModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedImageProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleImageModelOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search image models…"
                      clearable
                      minPopoverWidth={400}
                      onOpen={() => {
                        if (selectedImageProvider) {
                          requestMediaCatalog('image', { provider: selectedImageProvider, task: currentImageProviderModelsTask });
                        }
                      }}
                      onChange={(v) => setImageModelSelection(v)}
                    />
	                  );
	                }

	                if (isVideoProviderPin && !connected) {
	                  controls.push(
	                    <AfSelect
	                      key="video-provider"
	                      variant="pin"
	                      value={selectedVideoProvider}
	                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
	                      options={withGatewayDefaultOption(imageProviderOptions)}
	                      disabled={mediaCapabilitiesQuery.isLoading}
	                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
	                      searchable
	                      searchPlaceholder="Search video providers…"
	                      clearable
	                      minPopoverWidth={300}
	                      onOpen={() => requestMediaCatalog('image', { providersOnly: true, task: currentVideoProviderModelsTask })}
	                      onChange={(v) => setVideoProviderSelection(v)}
	                    />
	                  );
	                }

	                if (isVideoModelPin && !connected) {
	                  controls.push(
	                    <AfSelect
	                      key="video-model"
	                      variant="pin"
	                      value={selectedVideoModel}
	                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : selectedVideoProvider ? 'Select…' : 'Auto (Gateway default)'}
	                      options={visibleVideoModelOptions}
	                      disabled={mediaCapabilitiesQuery.isLoading || !selectedVideoProvider}
	                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleVideoModelOptions.length === 0)}
	                      searchable
	                      searchPlaceholder="Search video models…"
	                      clearable
	                      minPopoverWidth={400}
	                      onOpen={() => {
	                        if (selectedVideoProvider) {
	                          requestMediaCatalog('image', { provider: selectedVideoProvider, task: currentVideoProviderModelsTask });
	                        }
	                      }}
	                      onChange={(v) => setVideoModelSelection(v)}
	                    />
	                  );
	                }

	                if (isTtsProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="tts-provider"
                      variant="pin"
                      value={selectedTtsProvider}
                      placeholder={mediaCatalogLoading('tts', 'providers') || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
                      options={withGatewayDefaultOption(ttsProviderOptions)}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaCatalogLoading('tts', 'providers') || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search TTS providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => {
                        if (!hasLoadedMediaCatalog('tts', 'providers')) requestMediaCatalog('tts', { providersOnly: true });
                      }}
                      onChange={(v) => setTtsProviderSelection(v)}
                    />
                  );
                }

                if (isTtsModelPin && !connected) {
                  const ttsModelLoading = mediaCatalogLoading('tts', 'models', selectedTtsProvider) || mediaCapabilitiesQuery.isLoading;
                  const ttsModelPlaceholder = ttsModelLoading
                    ? 'Loading…'
                    : selectedTtsProvider && hasLoadedTtsModelsForProvider && visibleTtsModelOptions.length === 0
                      ? 'Provider default'
                      : 'Select…';
                  controls.push(
                    <AfSelect
                      key="tts-model"
                      variant="pin"
                      value={selectedTtsModel}
                      placeholder={ttsModelPlaceholder}
                      options={visibleTtsModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={
                        mediaCapabilitiesQuery.isLoading ||
                        (mediaCatalogLoading('tts', 'models', selectedTtsProvider) && visibleTtsModelOptions.length === 0)
                      }
                      searchable
                      searchPlaceholder="Search TTS models…"
                      clearable
                      minPopoverWidth={380}
                      onOpen={() => {
                        if (selectedTtsProvider && !hasLoadedTtsModelsForProvider) {
                          requestMediaCatalog('tts', { provider: selectedTtsProvider, includeVoices: false });
                        }
                      }}
                      onChange={(v) => setEffectConfigPatch({ tts_model: v || undefined, model: undefined, voice: undefined, profile: undefined })}
                    />
                  );
                }

                if (isVoicePin && !connected) {
                  controls.push(
                    <AfSelect
                      key="voice"
                      variant="pin"
                      value={selectedVoice}
                      placeholder={
                        mediaCatalogLoading('tts', 'voices', selectedTtsProvider, selectedTtsModel) || mediaCapabilitiesQuery.isLoading
                          ? 'Loading…'
                          : 'Select voice…'
                      }
                      options={visibleVoiceOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={
                        mediaCapabilitiesQuery.isLoading ||
                        (mediaCatalogLoading('tts', 'voices', selectedTtsProvider, selectedTtsModel) && visibleVoiceOptions.length === 0)
                      }
                      searchable
                      searchPlaceholder="Search voices…"
                      clearable
                      minPopoverWidth={320}
                      onOpen={() => {
                        if (selectedTtsProvider && !hasLoadedVoiceOptionsForSelection) {
                          requestMediaCatalog('tts', { provider: selectedTtsProvider, model: selectedTtsModel || undefined, includeModels: false });
                        }
                      }}
                      onChange={(v) => setEffectConfigPatch({ voice: v || undefined })}
                    />
                  );
                }

                if (isVoiceProfilePin && !connected) {
                  controls.push(
                    <AfSelect
                      key="voice-profile"
                      variant="pin"
                      value={selectedProfile}
                      placeholder={
                        mediaCatalogLoading('tts', 'profiles', selectedTtsProvider, selectedTtsModel) || mediaCapabilitiesQuery.isLoading
                          ? 'Loading…'
                          : 'Select profile…'
                      }
                      options={visibleProfileOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={
                        mediaCapabilitiesQuery.isLoading ||
                        (mediaCatalogLoading('tts', 'profiles', selectedTtsProvider, selectedTtsModel) && visibleProfileOptions.length === 0)
                      }
                      searchable
                      searchPlaceholder="Search voice profiles…"
                      clearable
                      minPopoverWidth={340}
                      onOpen={() => {
                        if (selectedTtsProvider && !hasLoadedVoiceOptionsForSelection) {
                          requestMediaCatalog('tts', { provider: selectedTtsProvider, model: selectedTtsModel || undefined, includeModels: false });
                        }
                      }}
                      onChange={(v) => setEffectConfigPatch({ profile: v || undefined })}
                    />
                  );
                }

                if (isTtsQualityPresetPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="tts-quality-preset"
                      variant="pin"
                      value={selectedTtsQualityPreset}
                      placeholder="standard"
                      options={DEFAULT_TTS_QUALITY_PRESETS}
                      searchable={false}
                      clearable={false}
                      minPopoverWidth={180}
                      onChange={(v) => {
                        const next = v || 'standard';
                        setPinDefault('quality_preset', next);
                        setEffectConfigPatch({ quality_preset: next });
                      }}
                    />
                  );
                }

                if (isTtsSpeedPin && !connected) {
                  const raw = pinDefaults.speed;
                  controls.push(
                    <input
                      key="tts-speed"
                      className="af-pin-input nodrag"
                      type="number"
                      min="0.5"
                      max="2"
                      step="0.05"
                      value={typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''}
                      placeholder="1.0"
                      title="Speech speed multiplier"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          setPinDefault('speed', undefined);
                          return;
                        }
                        const n = Number(v);
                        if (!Number.isFinite(n)) return;
                        setPinDefault('speed', n);
                      }}
                    />
                  );
                }

                if (isSttProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="stt-provider"
                      variant="pin"
                      value={selectedSttProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
                      options={withGatewayDefaultOption(sttProviderOptions)}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search STT providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestMediaCatalog('stt', { providersOnly: true })}
                      onChange={(v) => setSttProviderSelection(v)}
                    />
                  );
                }

                if (isSttModelPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="stt-model"
                      variant="pin"
                      value={selectedSttModel}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={visibleSttModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedSttProvider}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search STT models…"
                      clearable
                      minPopoverWidth={380}
                      onOpen={() => {
                        if (selectedSttProvider) requestMediaCatalog('stt', { provider: selectedSttProvider });
                      }}
                      onChange={(v) => setEffectConfigPatch({ stt_model: v || undefined, model: undefined })}
                    />
                  );
                }

                if (isMusicProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="music-provider"
                      variant="pin"
                      value={selectedMusicProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
                      options={withGatewayDefaultOption(visibleMusicProviderOptions)}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search music providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestMediaCatalog('music', { providersOnly: true })}
                      onChange={(v) => setMusicProviderSelection(v)}
                    />
                  );
                }

                if (isMusicModelPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="music-model"
                      variant="pin"
                      value={selectedMusicModel}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : selectedMusicProvider ? 'Select…' : 'Auto (Gateway default)'}
                      options={visibleMusicModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedMusicProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleMusicModelOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search music models…"
                      clearable
                      minPopoverWidth={400}
                      onOpen={() => {
                        if (selectedMusicProvider) requestMediaCatalog('music', { provider: selectedMusicProvider });
                      }}
                      onChange={(v) => setEffectConfigPatch({ music_model: v || undefined, model: undefined })}
                    />
                  );
                }

	                if ((isImageFormatPin || isVideoFormatPin || isTtsFormatPin || isSttFormatPin || isMusicFormatPin) && !connected) {
	                  const fallbackFormat = isImageFormatPin ? 'png' : isVideoFormatPin ? 'mp4' : isSttFormatPin ? 'json' : 'wav';
	                  const options = isImageFormatPin
	                    ? imageFormatOptions
	                    : isVideoFormatPin
	                      ? videoFormatOptions
	                    : isTtsFormatPin
                      ? ttsFormatOptions
                      : isMusicFormatPin
                        ? musicFormatOptions
                      : sttFormatOptions;
                  const raw = pinDefaults.format;
                  const currentFormat = typeof raw === 'string' && raw.trim() ? raw.trim() : fallbackFormat;
                  controls.push(
                    <AfSelect
                      key="media-format"
                      variant="pin"
                      value={currentFormat}
                      placeholder={fallbackFormat}
                      options={options}
                      searchable={false}
                      clearable={false}
                      minPopoverWidth={180}
                      onChange={(v) => setPinDefault('format', v || fallbackFormat)}
                    />
                  );
                }

                if (isCodePermissionsPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="code-permissions"
                      variant="pin"
                      value={codePermissions}
                      placeholder="sandbox"
                      options={[...codePermissionSelectOptions]}
                      searchable={false}
                      clearable={false}
                      minPopoverWidth={220}
                      onChange={(v) => setPinDefault('permissions', (v || 'sandbox') as any)}
                    />
                  );
                  if (codePermissionsUnavailableReason) {
                    controls.push(
                      <span key="code-permissions-warning" className="af-pin-warning" title={codePermissionsUnavailableReason}>
                        unavailable
                      </span>
                    );
                  }
                }

                const catalogProviderScope = providerCatalogScopeForPin(pin, data.nodeType);
                if (!connected && catalogProviderScope && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  const current = typeof raw === 'string' ? raw.trim() : '';
                  const scopeLabel = catalogScopeLabel(catalogProviderScope);
                  controls.push(
                    <AfSelect
                      key="catalog-provider"
                      variant="pin"
                      value={current}
                      placeholder={providerCatalogLoading(catalogProviderScope) ? 'Loading…' : 'Select…'}
                      options={providerOptionsForCatalogScope(catalogProviderScope, current)}
                      disabled={providerCatalogLoading(catalogProviderScope)}
                      loading={providerCatalogLoading(catalogProviderScope)}
                      searchable
                      searchPlaceholder={`Search ${scopeLabel} providers…`}
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestProviderCatalogForScope(catalogProviderScope)}
                      onChange={(v) => setCatalogProviderDefault(pin.id, v || undefined)}
                    />
                  );
                }

                const catalogModelScope = modelCatalogScopeForPin(pin, inputData, data.nodeType);
                if (!connected && catalogModelScope && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  const current = typeof raw === 'string' ? raw.trim() : '';
                  const providerPinId = providerPinIdForModelPin(pin, inputData, data.nodeType);
                  const providerConnectedForModel = providerPinId ? connectedInputPinIds.has(providerPinId) : false;
                  const providerValue = providerPinId
                    ? firstConfigString(pinDefaults[providerPinId])
                    : catalogModelScope === 'text'
                      ? selectedTextCatalogProvider
                      : '';
                  const scopeLabel = catalogScopeLabel(catalogModelScope);
                  const loading = modelCatalogLoading(catalogModelScope);
                  controls.push(
                    <AfSelect
                      key="catalog-model"
                      variant="pin"
                      value={current}
                      placeholder={
                        providerConnectedForModel
                          ? 'Provider from pin…'
                          : !providerValue
                            ? 'Pick provider…'
                            : loading
                              ? 'Loading…'
                              : 'Select…'
                      }
                      options={modelOptionsForCatalogScope(catalogModelScope, providerValue, current)}
                      disabled={providerConnectedForModel || !providerValue || loading}
                      loading={loading}
                      searchable
                      searchPlaceholder={`Search ${scopeLabel} models…`}
                      clearable
                      minPopoverWidth={400}
                      onOpen={() => requestModelCatalogForScope(catalogModelScope, providerValue)}
                      onChange={(v) => setPinDefault(pin.id, v || undefined)}
                    />
                  );
                }

                if (!connected && isPrimitive && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  if (pin.type === 'string') {
                    controls.push(
                      <input
                        key="pin-default"
                        className={clsx(
                          'af-pin-input nodrag',
                          isSwitchNode && pin.id === 'value' && 'af-pin-input--switch-value'
                        )}
                        type="text"
                        value={typeof raw === 'string' ? raw : ''}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setPinDefault(pin.id, e.target.value)}
                      />
                    );
                  } else if (pin.type === 'number') {
                    controls.push(
                      <input
                        key="pin-default"
                        className="af-pin-input nodrag"
                        type="number"
                        value={typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''}
                        placeholder=""
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setPinDefault(pin.id, undefined);
                            return;
                          }
                          const n = Number(v);
                          if (!Number.isFinite(n)) return;
                          setPinDefault(pin.id, n);
                        }}
                      />
                    );
                  } else if (pin.type === 'boolean') {
                    controls.push(
                      <label
                        key="pin-default"
                        className="af-pin-checkbox nodrag"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          className="af-pin-checkbox-input"
                          type="checkbox"
                          checked={typeof raw === 'boolean' ? raw : false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPinDefault(pin.id, e.target.checked)}
                        />
                        <span className="af-pin-checkbox-box" aria-hidden="true" />
                      </label>
                    );
                  }
                }

                if (isDelayNode && pin.id === 'duration') {
                  // Always show duration interpretation selector (even when duration pin is connected).
                  controls.push(
                    <AfSelect
                      key="duration-type"
                      variant="pin"
                      value={delayDurationType}
                      placeholder="seconds"
                      options={[
                        { value: 'seconds', label: 'seconds' },
                        { value: 'minutes', label: 'minutes' },
                        { value: 'hours', label: 'hours' },
                        { value: 'timestamp', label: 'timestamp' },
                      ]}
                      searchable={false}
                      minPopoverWidth={180}
                      onChange={setDelayDurationType}
                    />
                  );
                }

                if (hasProviderDropdown && pin.id === 'provider' && !providerConnected) {
                  controls.push(
                    <AfSelect
                      key="provider"
                      variant="pin"
                      value={selectedProvider || ''}
                      placeholder={providersQuery.isLoading ? 'Loading…' : 'Auto (Gateway default)'}
                      options={withGatewayDefaultOption(providers.map((p) => ({ value: p.name, label: p.display_name || p.name })))}
                      disabled={providersQuery.isLoading}
                      loading={providersQuery.isLoading}
                      searchable
                      searchPlaceholder="Search providers…"
                      clearable
                      minPopoverWidth={260}
                      onChange={(v) => setProviderModel(v || undefined, undefined)}
                    />
                  );
                }

                if (hasModelControls && pin.id === 'model' && !modelConnected) {
                  controls.push(
                    <AfSelect
                      key="model"
                      variant="pin"
                      value={selectedModel || ''}
                      placeholder={!selectedProvider ? 'Pick provider…' : modelsQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={modelOptions}
                      disabled={!selectedProvider || modelsQuery.isLoading}
                      loading={modelsQuery.isLoading}
                      searchable
                      searchPlaceholder="Search models…"
                      clearable
                      minPopoverWidth={360}
                      onChange={(v) => setProviderModel(selectedProvider || undefined, v || undefined)}
                    />
                  );
                }

	                if ((isAgentNode || isLlmNode || subflowHasToolsPin) && pin.id === 'tools' && !toolsConnected) {
	                  controls.push(
	                    <AfMultiSelect
	                      key="tools"
                      variant="pin"
                      values={selectedTools}
                      placeholder={toolsQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={toolOptions}
                      disabled={toolsQuery.isLoading}
                      loading={toolsQuery.isLoading}
                      searchable
                      searchPlaceholder="Search tools…"
                      clearable
                      minPopoverWidth={340}
                      onChange={setNodeTools}
                    />
                  );
                }

                if (isToolParametersNode) {
                  controls.push(
                    <span
                      key="tool-parameters-output"
                      className="pin-shape"
                      style={{ color: PIN_COLORS[pin.type] }}
                      onClick={(e) => handlePinClick(e, pin.id, false)}
                    >
                      <PinShape type={pin.type} size={10} filled={isPinConnected(pin.id, false)} />
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={pin.id}
                        className={`pin ${pin.type}`}
                        style={overlayHandleStyle}
                        onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                      />
                    </span>
                  );
                }

                  if (controls.length === 0) return null;
                  return <div className="pin-inline-controls nodrag">{controls}</div>;
                })()}
              </div>

              {/* Models Catalog: provider must be the first pin row; models selection follows. */}
              {isProviderModelsNode && pin.id === 'provider' ? (
                <div className="pin-row input nodrag">
                  <span className="pin-shape" style={{ opacity: 0 }} aria-hidden="true" />
                  <span className="pin-label">models</span>
                  {(() => {
                    const providerValue = typeof selectedProvider === 'string' ? selectedProvider.trim() : '';
                    const placeholder = providerConnected
                      ? 'Provider from pin…'
                      : !providerValue
                        ? 'Pick provider…'
                        : modelsQuery.isLoading
                          ? 'Loading…'
                          : 'Select…';
                    const disabled = providerConnected || !providerValue || modelsQuery.isLoading;
                    return (
                      <div className="pin-inline-controls nodrag">
                        <AfMultiSelect
                          variant="pin"
                          values={selectedProviderModels}
                          placeholder={placeholder}
                          options={modelOptions}
                          disabled={disabled}
                          loading={modelsQuery.isLoading}
                          searchable
                          searchPlaceholder="Search models…"
                          clearable
                          minPopoverWidth={360}
                          onChange={setProviderModelsAllowedModels}
                        />
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </Fragment>
          );
          })}

          {(isConcatNode || isArrayConcatNode || isMakeArrayNode) && (
            <div className="pin-row exec-add-pin nodrag" onClick={addConcatInputPin}>
              <span className="pin-shape" style={{ opacity: 0 }} aria-hidden="true" />
              <span className="pin-label">Add pin</span>
              <span className="exec-add-plus">+</span>
            </div>
          )}
        </div>

        {/* Data output pins */}
        <div className="pins-right">
          {(isToolParametersNode ? outputData.filter((p) => p.id === 'tool_call') : outputData).map((pin) => {
            const feedback = connectionPreview?.outputs?.[pin.id];
            const showJsonOutputEdit =
              canEditJsonLiteralOnNode &&
              (pin.id === 'value' || pin.id === 'schema') &&
              (pin.type === 'object' || pin.type === 'any');
            return (
            <div
              key={pin.id}
              className={clsx(
                'pin-row',
                'output',
                showJsonOutputEdit && 'output-with-action',
                feedback?.status === 'valid' && 'pin-feedback-valid',
                feedback?.status === 'invalid' && 'pin-feedback-invalid'
              )}
              aria-invalid={feedback?.status === 'invalid' ? true : undefined}
              data-connection-feedback={feedback?.status}
              title={feedback?.message || undefined}
            >
              {showJsonOutputEdit && (
                <button
                  type="button"
                  className="node-schema-edit-button node-json-output-edit-button nodrag"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowJsonLiteralEditor(true);
                  }}
                  title={isEditJsonSchemaNode ? 'Add Schema Fields' : isJsonSchemaNode ? 'Edit JSON Schema' : 'Edit JSON'}
                >
                  Edit
                </button>
              )}
              {(() => {
                const tooltip =
                  pin.description ||
                  (data.nodeType === 'break_object' && breakObjectSchema ? schemaTooltipForPath(breakObjectSchema, pin.id) : '');
                return (
                  <AfTooltip content={tooltip} delayMs={700} priority={2}>
                    <span className="pin-hit">
                      <span className="pin-label">{pin.label}</span>
                      <span
                        className="pin-shape"
                        style={{ color: PIN_COLORS[pin.type] }}
                        onClick={(e) => handlePinClick(e, pin.id, false)}
                      >
                        <PinShape
                          type={pin.type}
                          size={10}
                          filled={isPinConnected(pin.id, false)}
                        />
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={pin.id}
                          className={`pin ${pin.type}`}
                          style={overlayHandleStyle}
                          onClickCapture={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </span>
                    </span>
                  </AfTooltip>
                );
              })()}
            </div>
          );
          })}
        </div>

        {showPinDisclosure && (
          <div className="pin-disclosure-row nodrag">
            <button
              type="button"
              className={clsx('pin-disclosure-button nodrag', showAdvancedPins && 'expanded')}
              aria-expanded={showAdvancedPins}
              aria-label={pinDisclosureLabel}
              title={pinDisclosureLabel}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={toggleAdvancedPins}
            >
              <span className="pin-disclosure-chevron" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      </div>

      <JsonSchemaPinEditorModal
        isOpen={Boolean(schemaEditorPin)}
        nodeLabel={data.label || ''}
        pin={schemaEditorPin}
        schema={schemaEditorPin ? pinDefaults[schemaEditorPin.id] : undefined}
        onClose={() => setSchemaEditorPinId(null)}
        onSave={(nextSchema) => {
          if (!schemaEditorPin) return;
          setPinDefault(schemaEditorPin.id, nextSchema as JsonValue);
        }}
        onClear={() => {
          if (!schemaEditorPin) return;
          setPinDefault(schemaEditorPin.id, undefined);
        }}
      />

      {canEditJsonLiteralOnNode && (
        <JsonLiteralNodeEditorModal
          isOpen={showJsonLiteralEditor}
          kind={isJsonSchemaNode || isEditJsonSchemaNode ? 'json_schema' : 'json'}
          nodeId={id}
          nodeLabel={data.label || ''}
          title={isEditJsonSchemaNode ? 'Add Schema Fields' : undefined}
          schemaHint={
            isEditJsonSchemaNode
              ? 'Define only the fields this node should add. Existing upstream fields are preserved when a schema is connected.'
              : undefined
          }
          value={data.literalValue}
          onClose={() => setShowJsonLiteralEditor(false)}
          onSave={(nextValue) => {
            updateNodeData(id, { literalValue: nextValue });
          }}
        />
      )}

      <JsonLiteralNodeEditorModal
        isOpen={Boolean(jsonDefaultEditorPin)}
        kind="json"
        nodeId={id}
        nodeLabel={data.label || ''}
        title={jsonDefaultEditorPin ? `${jsonDefaultEditorPin.label || jsonDefaultEditorPin.id} JSON` : 'JSON'}
        subtitle={jsonDefaultEditorPin ? `${data.label || id} - ${jsonDefaultEditorPin.id}` : id}
        value={jsonDefaultEditorPin ? pinDefaults[jsonDefaultEditorPin.id] : undefined}
        jsonHint="Define the JSON object used when this input pin is not connected."
        onClose={() => setJsonDefaultEditorPinId(null)}
        onSave={(nextValue) => {
          if (!jsonDefaultEditorPin) return;
          setPinDefault(jsonDefaultEditorPin.id, nextValue);
        }}
      />

      {isCodeNode && (
        <CodeEditorModal
          isOpen={showCodeEditor}
          title="Code"
          body={currentCodeBody}
          params={codeParams}
          permissions={codePermissions}
          permissionsUnavailableReason={codeTestUnavailableReason}
          onClose={() => setShowCodeEditor(false)}
          onSave={(nextBody) => {
            const nextWithHeader = upsertPythonAvailableVariablesComments(nextBody, codeParams);
            updateNodeData(id, {
              codeBody: nextWithHeader,
              code: generatePythonTransformCode(data.inputs, nextWithHeader),
              functionName: 'transform',
            });
            setShowCodeEditor(false);
          }}
        />
      )}
    </AfTooltip>
  );
});

export default BaseNode;
