/**
 * Base node component with Blueprint-style pins.
 * Follows UE4 Blueprint visual patterns:
 * - Execution pins at top of node (in/out)
 * - Data pins below with labels
 * - Empty shapes = not connected, Filled = connected
 */

import { Fragment, memo, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow, useUpdateNodeInternals } from 'reactflow';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import type { FlowNodeData, JsonValue, PinType } from '../../types/flow';
import { PIN_COLORS, isEntryNodeType } from '../../types/flow';
import { PinShape } from '../pins/PinShape';
import { useFlowStore } from '../../hooks/useFlow';
import { useModels, useProviders } from '../../hooks/useProviders';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../../hooks/useGatewayCapabilities';
import { useTools } from '../../hooks/useTools';
import { collectCustomEventNames } from '../../utils/events';
import { extractFunctionBody, generatePythonTransformCode } from '../../utils/codegen';
import { upsertPythonAvailableVariablesComments } from '../../utils/codegen';
import AfSelect from '../inputs/AfSelect';
import AfMultiSelect from '../inputs/AfMultiSelect';
import { gatewayJson, gatewayPath } from '../../utils/gatewayClient';
import { insertModelResidencyStep, type ModelResidencyOperation } from '../../utils/modelResidencyGraph';
import {
  applyImagePinDefaultPatch,
  extractImageModelParameterMetadata,
  type MediaModelParameterMetadata,
} from '../../utils/mediaModelParams';
import { getNodeTemplate } from '../../types/nodes';
import { AfTooltip } from '../AfTooltip';
import { CodeEditorModal } from '../CodeEditorModal';
import {
  AGENT_META_SCHEMA,
  AGENT_RESULT_SCHEMA,
  AGENT_SCRATCHPAD_SCHEMA,
  CONTEXT_EXTRA_SCHEMA,
  CONTEXT_SCHEMA,
  EVENT_ENVELOPE_SCHEMA,
  LLM_META_SCHEMA,
  LLM_RESULT_SCHEMA,
  type JsonSchema,
} from '../../schemas/known_json_schemas';

type SelectOption = { value: string; label: string };
type MediaModelOption = { provider: string; model: string; label: string; scopeModel?: string } & MediaModelParameterMetadata;
type ProviderOptionMap = Record<string, SelectOption[]>;
type MediaCatalogScope = 'image' | 'tts' | 'stt';
type MediaCatalogRequest = {
  seq: number;
  scope: MediaCatalogScope;
  provider?: string;
  model?: string;
  providersOnly?: boolean;
  includeProviders?: boolean;
};

const DEFAULT_IMAGE_FORMATS = ['png', 'jpeg', 'webp'];
const DEFAULT_TTS_FORMATS = ['wav'];
const DEFAULT_TTS_QUALITY_PRESETS: SelectOption[] = [
  { value: 'low', label: 'low / fast' },
  { value: 'standard', label: 'standard' },
  { value: 'high', label: 'high quality' },
];
const OPENAI_TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const DEFAULT_STT_FORMATS = ['json', 'text', 'verbose_json', 'srt', 'vtt'];

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
      size: 'auto',
      width: undefined,
      height: undefined,
      steps: undefined,
      guidance_scale: undefined,
    };
  }
  return {
    size: undefined,
    width: 512,
    height: 512,
    steps: 20,
    guidance_scale: 7.5,
  };
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
  nodeId,
  name,
  defaultValue,
  options,
  onChange,
}: {
  nodeId: string;
  name: string;
  defaultValue: boolean;
  options: string[];
  onChange: (next: { name: string; default: boolean }) => void;
}) {
  const listId = `af-bool-var-names-${nodeId}`;
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
          value={name}
          list={options.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name: e.target.value, default: defaultValue })}
          placeholder="e.g., is_ready"
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
  nodeId,
  name,
  varType,
  defaultValue,
  nameOptions,
  toolOptions,
  toolLoading,
  onChange,
}: {
  nodeId: string;
  name: string;
  varType: Exclude<PinType, 'execution'>;
  defaultValue: JsonValue;
  nameOptions: string[];
  toolOptions: Array<{ value: string; label: string }>;
  toolLoading: boolean;
  onChange: (next: { name: string; type: Exclude<PinType, 'execution'>; default: JsonValue }) => void;
}) {
  const listId = `af-var-decl-names-${nodeId}`;

  const typeOptions: Array<{ value: string; label: string }> = [
    { value: 'boolean', label: 'boolean' },
    { value: 'number', label: 'number' },
    { value: 'string', label: 'string' },
    { value: 'provider_text', label: 'provider_text' },
    { value: 'provider_image', label: 'provider_image' },
    { value: 'provider_voice', label: 'provider_voice' },
    { value: 'provider', label: 'provider (legacy)' },
    { value: 'model', label: 'model' },
    { value: 'object', label: 'object' },
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
      varType === 'model_voice'
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
        : varType === 'object'
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
      {nameOptions.length > 0 ? (
        <datalist id={listId}>
          {nameOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}

      <div className="node-config-row">
        <span className="node-config-label">name</span>
        <input
          className="af-pin-input nodrag"
          type="text"
          value={name}
          list={nameOptions.length > 0 ? listId : undefined}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ name: e.target.value, type: varType, default: defaultValue })}
          placeholder="e.g., is_ready"
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
                      : nextType === 'object'
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
  const allNodes = useFlowStore((s) => s.nodes);
  const isExecuting = executingNodeId === id;
  const isRecent = Boolean(recentNodeIds && (recentNodeIds as Record<string, true>)[id]);
  const edges = useEdges();
  const { setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const isTriggerNode = isEntryNodeType(data.nodeType);
  const pinDefaults = data.pinDefaults || {};
  const isVarNode = data.nodeType === 'get_var' || data.nodeType === 'set_var';
  const isCodeNode = data.nodeType === 'code';
  const [showCodeEditor, setShowCodeEditor] = useState(false);
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
            t === 'object' ||
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
  const connectedInputsKey = useMemo(() => {
    const connected = edges
      .filter((e) => e.target === id && typeof e.targetHandle === 'string' && e.targetHandle !== 'exec-in')
      .map((e) => e.targetHandle as string)
      .sort()
      .join('|');
    return connected;
  }, [edges, id]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handlesKey, connectedInputsKey, updateNodeInternals]);

  // Check if a pin is connected
  const isPinConnected = (pinId: string, isInput: boolean): boolean => {
    if (isInput) {
      return edges.some((e) => e.target === id && e.targetHandle === pinId);
    }
    return edges.some((e) => e.source === id && e.sourceHandle === pinId);
  };

  const handlePinClick = (e: MouseEvent, pinId: string, isInput: boolean) => {
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

    const inferSchemaForOutput = (n: any, handle: string, depth: number): JsonSchema | null => {
      if (!n || depth > 6) return null;
      const nodeType = n.data?.nodeType;
      if (handle === 'context') return CONTEXT_SCHEMA;
      if (handle === 'context_extra') return CONTEXT_EXTRA_SCHEMA;
      if (nodeType === 'make_context' && handle === 'context') return CONTEXT_SCHEMA;
      if (nodeType === 'make_meta' && handle === 'meta') return AGENT_META_SCHEMA;
      if (nodeType === 'make_scratchpad' && handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA;
      if (nodeType === 'on_event' && handle === 'event') return EVENT_ENVELOPE_SCHEMA;
      if (nodeType === 'agent') {
        if (handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA;
        if (handle === 'meta') return AGENT_META_SCHEMA;
        const outputSchema = n.data?.agentConfig?.outputSchema;
        if (outputSchema?.enabled && outputSchema.jsonSchema && typeof outputSchema.jsonSchema === 'object') {
          return outputSchema.jsonSchema as JsonSchema;
        }
        return AGENT_RESULT_SCHEMA;
      }
      if (nodeType === 'llm_call') {
        if (handle === 'meta') return LLM_META_SCHEMA;
        return LLM_RESULT_SCHEMA;
      }
      if (nodeType === 'break_object') {
        const inputEdge2 = edges.find((e) => e.target === n.id && e.targetHandle === 'object');
        if (!inputEdge2) return null;
        const srcNode2 = allNodes.find((nn) => nn.id === inputEdge2.source);
        if (!srcNode2) return null;
        const srcHandle2 = typeof inputEdge2.sourceHandle === 'string' ? inputEdge2.sourceHandle : '';
        const base = inferSchemaForOutput(srcNode2, srcHandle2, depth + 1);
        if (!base) return null;
        return getSchemaByPath(base, handle) ?? null;
      }
      return null;
    };

    return inferSchemaForOutput(sourceNode, sourceHandle, 0);
  }, [allNodes, data.nodeType, edges, getSchemaByPath, id]);

  // Separate execution pins from data pins
  const inputExec = isTriggerNode ? undefined : data.inputs.find((p) => p.type === 'execution');
  const outputExecs = data.outputs.filter((p) => p.type === 'execution');
  const isEmitEventNode = data.nodeType === 'emit_event';
  const inputData = data.inputs.filter((p) => {
    if (p.type === 'execution') return false;
    // `profile` is still a real override pin, but showing both voice and profile
    // unconnected makes TTS look like it needs two voice selectors. Keep the
    // advanced profile override available only when a wire explicitly targets it.
    if (data.nodeType === 'generate_voice' && p.id === 'profile' && !isPinConnected('profile', true)) {
      return false;
    }
    // Keep emit_event "session_id" as an advanced pin: hide it unless connected.
    if (isEmitEventNode && p.id === 'session_id' && !isPinConnected('session_id', true)) {
      return false;
    }
    return true;
  });
	  const outputData = data.outputs.filter((p) => {
	    if (p.type === 'execution') return false;
	    // Keep legacy Agent pins hidden unless explicitly wired (cleaner UI without breaking old flows).
	    if (
	      data.nodeType === 'agent' &&
	      (p.id === 'tool_calls' || p.id === 'tool_results' || p.id === 'result') &&
	      !isPinConnected(p.id, false)
	    ) {
	      return false;
	    }
	    // Keep legacy LLM Call pins hidden unless explicitly wired.
	    if (
	      data.nodeType === 'llm_call' &&
	      (p.id === 'result' || p.id === 'raw' || p.id === 'gen_time' || p.id === 'ttft_ms') &&
	      !isPinConnected(p.id, false)
	    ) {
	      return false;
	    }
	    return true;
	  });

  const codeParams = useMemo(() => data.inputs.filter((p) => p.type !== 'execution'), [data.inputs]);
  const currentCodeBody = useMemo(() => {
    if (typeof data.codeBody === 'string') return data.codeBody;
    if (typeof data.code === 'string') return extractFunctionBody(data.code, data.functionName || 'transform') ?? '';
    return '';
  }, [data.code, data.codeBody, data.functionName]);

  const isLlmNode = data.nodeType === 'llm_call';
  const isAgentNode = data.nodeType === 'agent';
  const isToolsAllowlistNode = data.nodeType === 'tools_allowlist';
  const isToolParametersNode = data.nodeType === 'tool_parameters';
  const isBoolVarNode = data.nodeType === 'bool_var';
  const isVarDeclNode = data.nodeType === 'var_decl';
  const isProviderModelsNode = data.nodeType === 'provider_models';
  const isModelResidencyNode = data.nodeType === 'model_residency';
  const isGenerateImageNode = data.nodeType === 'generate_image';
  const isGenerateVoiceNode = data.nodeType === 'generate_voice';
  const isTranscribeAudioNode = data.nodeType === 'transcribe_audio';
  const isListenVoiceNode = data.nodeType === 'listen_voice';
  const isMediaNode = isGenerateImageNode || isGenerateVoiceNode || isTranscribeAudioNode || isListenVoiceNode;
  const isDelayNode = data.nodeType === 'wait_until';
  const isOnEventNode = data.nodeType === 'on_event';
  const isOnScheduleNode = data.nodeType === 'on_schedule';
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
  const residencyAuthoringTarget = useMemo(() => {
    if (isLlmNode) {
      const blocked = providerConnected || modelConnected;
      return {
        task: 'text_generation',
        provider: blocked ? '' : firstConfigString(data.effectConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.effectConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic provider/model is wired from pins.' : '',
      };
    }
    if (isAgentNode) {
      const blocked = providerConnected || modelConnected;
      return {
        task: 'text_generation',
        provider: blocked ? '' : firstConfigString(data.agentConfig?.provider, pinDefaults.provider),
        model: blocked ? '' : firstConfigString(data.agentConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic provider/model is wired from pins.' : '',
      };
    }
    if (isGenerateImageNode) {
      const providerBlocked = isPinConnected('image_provider', true);
      const modelBlocked = isPinConnected('image_model', true);
      const blocked = providerBlocked || modelBlocked;
      return {
        task: 'image_generation',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.image_provider, pinDefaults.image_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked
          ? ''
          : firstConfigString(data.effectConfig?.image_model, pinDefaults.image_model, data.effectConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic image provider/model is wired from pins.' : '',
      };
    }
    if (isGenerateVoiceNode) {
      const providerBlocked = isPinConnected('tts_provider', true);
      const modelBlocked = isPinConnected('tts_model', true);
      const blocked = providerBlocked || modelBlocked;
      return {
        task: 'tts',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.tts_provider, pinDefaults.tts_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked
          ? ''
          : firstConfigString(data.effectConfig?.tts_model, pinDefaults.tts_model, data.effectConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic voice provider/model is wired from pins.' : '',
      };
    }
    if (isTranscribeAudioNode || isListenVoiceNode) {
      const providerBlocked = isPinConnected('stt_provider', true);
      const modelBlocked = isPinConnected('stt_model', true);
      const blocked = providerBlocked || modelBlocked;
      return {
        task: 'stt',
        provider: blocked
          ? ''
          : firstConfigString(data.effectConfig?.stt_provider, pinDefaults.stt_provider, data.effectConfig?.provider, pinDefaults.provider),
        model: blocked
          ? ''
          : firstConfigString(data.effectConfig?.stt_model, pinDefaults.stt_model, data.effectConfig?.model, pinDefaults.model),
        blockedReason: blocked ? 'Dynamic transcription provider/model is wired from pins.' : '',
      };
    }
    return null;
  }, [
    data.agentConfig?.model,
    data.agentConfig?.provider,
    data.effectConfig?.image_model,
    data.effectConfig?.image_provider,
    data.effectConfig?.model,
    data.effectConfig?.provider,
    data.effectConfig?.stt_model,
    data.effectConfig?.stt_provider,
    data.effectConfig?.tts_model,
    data.effectConfig?.tts_provider,
    isAgentNode,
    isGenerateImageNode,
    isGenerateVoiceNode,
    isListenVoiceNode,
    isLlmNode,
    isTranscribeAudioNode,
    modelConnected,
    pinDefaults.image_model,
    pinDefaults.image_provider,
    pinDefaults.model,
    pinDefaults.provider,
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
        toast.error(`${target.blockedReason} Add a dedicated Model Residency node for explicit control.`);
        return;
      }
      if (!target.provider || !target.model) {
        toast.error('Select a concrete provider and model before adding a residency step.');
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
        toast.success(operation === 'load' ? 'Warm-up step added before this node' : 'Unload step added after this node');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not add model residency step.');
      }
    },
    [allNodes, edges, id, residencyAuthoringTarget, setEdges, setNodes]
  );

  const selectedImageProvider = firstConfigString(data.effectConfig?.image_provider, pinDefaults.image_provider, pinDefaults.provider_image);
  const selectedImageModel = firstConfigString(data.effectConfig?.image_model, pinDefaults.image_model, pinDefaults.model_image);
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
  const selectedResidencyOperation = firstConfigString(data.effectConfig?.operation, pinDefaults.operation) || 'load';
  const selectedResidencyTask = firstConfigString(data.effectConfig?.task, pinDefaults.task) || 'image_generation';
  const selectedResidencyProvider = firstConfigString(data.effectConfig?.provider, pinDefaults.provider);
  const selectedResidencyModel = firstConfigString(data.effectConfig?.model, pinDefaults.model);
  const selectedResidencyPin =
    typeof data.effectConfig?.pin === 'boolean'
      ? data.effectConfig.pin
      : typeof pinDefaults.pin === 'boolean'
        ? pinDefaults.pin
        : true;
  const selectedResidencyRequired =
    typeof data.effectConfig?.required === 'boolean'
      ? data.effectConfig.required
      : typeof pinDefaults.required === 'boolean'
        ? pinDefaults.required
        : false;

  const mediaCapabilitiesQuery = useGatewayCapabilities(isMediaNode || isModelResidencyNode);
  const gatewayContracts = gatewayContractsFromCapabilities(mediaCapabilitiesQuery.data);
  const generatedImageContract =
    gatewayContracts?.flow_editor?.media?.generated_image || gatewayContracts?.assistant?.media?.generated_image;
  const generatedVoiceContract =
    gatewayContracts?.flow_editor?.media?.generated_voice || gatewayContracts?.assistant?.media?.generated_voice;
  const mediaDiscovery = gatewayContracts?.common?.discovery || {};
  const voiceCatalogEndpoint = mediaDiscovery.voice_voices || '';
  const ttsModelsEndpoint = mediaDiscovery.audio_speech_models || '';
  const sttModelsEndpoint = mediaDiscovery.audio_transcription_models || '';
  const visionProviderModelsEndpoint = mediaDiscovery.vision_provider_models || '';
  const visionModelsEndpoint = mediaDiscovery.vision_models || '';

  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaCatalogRequest, setMediaCatalogRequest] = useState<MediaCatalogRequest | null>(null);
  const [imageProviderCatalogOptions, setImageProviderCatalogOptions] = useState<SelectOption[]>([]);
  const [imageModelOptions, setImageModelOptions] = useState<MediaModelOption[]>([]);
  const [ttsProviderOptions, setTtsProviderOptions] = useState<SelectOption[]>([]);
  const [ttsModelOptions, setTtsModelOptions] = useState<MediaModelOption[]>([]);
  const [sttProviderOptions, setSttProviderOptions] = useState<SelectOption[]>([]);
  const [sttModelOptions, setSttModelOptions] = useState<MediaModelOption[]>([]);
  const [voiceOptions, setVoiceOptions] = useState<MediaModelOption[]>([]);
  const [profileOptions, setProfileOptions] = useState<MediaModelOption[]>([]);
  const [ttsFormatsByProvider, setTtsFormatsByProvider] = useState<ProviderOptionMap>({});

  const residencyTextCatalogEnabled = isModelResidencyNode && selectedResidencyTask === 'text_generation';
  const providersQuery = useProviders(
    (hasProviderDropdown && (!providerConnected || !modelConnected)) ||
    (residencyTextCatalogEnabled && (!isPinConnected('provider', true) || !isPinConnected('model', true)))
  );
  const modelsQuery = useModels(
    isModelResidencyNode ? selectedResidencyProvider : selectedProvider,
    (hasModelControls && !modelConnected) ||
      (isProviderModelsNode && !providerConnected) ||
      (residencyTextCatalogEnabled && Boolean(selectedResidencyProvider) && !isPinConnected('model', true))
  );
  const toolsQuery = useTools((isAgentNode || isLlmNode || isToolsAllowlistNode || isVarDeclNode || isToolParametersNode || subflowHasToolsPin) && !toolsConnected);

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const tools = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];

  const modelOptions = useMemo(() => models.map((m) => ({ value: m, label: m })), [models]);
  const requestMediaCatalog = useCallback((scope: MediaCatalogScope, options: Omit<MediaCatalogRequest, 'seq' | 'scope'> = {}) => {
    setMediaCatalogRequest((prev) => ({
      seq: (prev?.seq || 0) + 1,
      scope,
      ...options,
    }));
  }, []);

  const imageProviderOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: SelectOption[] = [];
    const add = (provider: string, label?: string) => {
      const clean = normalizeMediaProvider(provider);
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push({ value: clean, label: label || clean });
    };
    for (const option of imageProviderCatalogOptions) add(option.value, option.label);
    for (const option of imageModelOptions) add(option.provider);
    if (selectedImageProvider) add(selectedImageProvider);
    return out;
  }, [imageModelOptions, imageProviderCatalogOptions, selectedImageProvider]);
  const visibleImageModelOptions = useMemo(() => {
    if (!selectedImageProvider) return imageModelOptions.map((option) => ({ value: option.model, label: option.label }));
    return imageModelOptions
      .filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedImageProvider))
      .map((option) => ({ value: option.model, label: option.label }));
  }, [imageModelOptions, selectedImageProvider]);
  const residencyProviderOptions = useMemo(() => {
    if (selectedResidencyTask === 'image_generation') {
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
    if (selectedResidencyTask === 'text_generation') {
      return providers.map((p) => ({ value: p.name, label: p.display_name || p.name }));
    }
    return selectedResidencyProvider ? [{ value: selectedResidencyProvider, label: selectedResidencyProvider }] : [];
  }, [imageProviderOptions, providers, selectedResidencyProvider, selectedResidencyTask, sttProviderOptions, ttsProviderOptions]);
  const visibleTtsModelOptions = useMemo(() => {
    const baseOptions = selectedTtsProvider
      ? ttsModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : ttsModelOptions;
    return baseOptions.map((option) => ({ value: option.model, label: option.label }));
  }, [selectedTtsProvider, ttsModelOptions]);
  const visibleVoiceOptions = useMemo(() => {
    const selectedScope = selectedTtsModel.trim().toLowerCase();
    const providerOptions = selectedTtsProvider
      ? voiceOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : voiceOptions;
    const scopedOptions = providerOptions.filter((option) => {
      const scope = (option.scopeModel || '').trim().toLowerCase();
      return !selectedScope || !scope || scope === selectedScope;
    });
    return (scopedOptions.length > 0 ? scopedOptions : providerOptions).map((option) => ({
      value: option.model,
      label: option.label,
    }));
  }, [selectedTtsModel, selectedTtsProvider, voiceOptions]);
  const visibleProfileOptions = useMemo(() => {
    const selectedScope = selectedTtsModel.trim().toLowerCase();
    const providerOptions = selectedTtsProvider
      ? profileOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedTtsProvider))
      : profileOptions;
    const scopedOptions = providerOptions.filter((option) => {
      const scope = (option.scopeModel || '').trim().toLowerCase();
      return !selectedScope || !scope || scope === selectedScope;
    });
    return (scopedOptions.length > 0 ? scopedOptions : providerOptions).map((option) => ({
      value: option.model,
      label: option.label,
    }));
  }, [profileOptions, selectedTtsModel, selectedTtsProvider]);
  const visibleSttModelOptions = useMemo(() => {
    const options = selectedSttProvider
      ? sttModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedSttProvider))
      : sttModelOptions;
    return options.map((option) => ({ value: option.model, label: option.label }));
  }, [selectedSttProvider, sttModelOptions]);
  const residencyModelOptions = useMemo(() => {
    if (selectedResidencyTask === 'image_generation') {
      const options = !selectedResidencyProvider
        ? imageModelOptions
        : imageModelOptions.filter((option) => normalizeMediaProvider(option.provider) === normalizeMediaProvider(selectedResidencyProvider));
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
    if (selectedResidencyTask === 'text_generation') {
      return models.map((m) => ({ value: m, label: m }));
    }
    return selectedResidencyModel ? [{ value: selectedResidencyModel, label: selectedResidencyModel }] : [];
  }, [imageModelOptions, models, selectedResidencyModel, selectedResidencyProvider, selectedResidencyTask, visibleSttModelOptions, visibleTtsModelOptions]);
  const imageFormatOptions = useMemo(
    () => formatOptionsFrom(generatedImageContract?.direct_endpoint?.formats, DEFAULT_IMAGE_FORMATS),
    [generatedImageContract?.direct_endpoint?.formats]
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

  useEffect(() => {
    if ((!isMediaNode && !isModelResidencyNode) || !mediaCatalogRequest) return;

    let cancelled = false;
    const request = mediaCatalogRequest;

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
      addProvidersFromArray(providersList, seenProviders, asArray(record.providers));
      const rootProvider = text(record.provider, record.engine_id, record.backend, record.active_provider);
      appendImageModels(list, seen, asArray(record.models), rootProvider);
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
      setMediaLoading(true);
      try {
        const queryFor = (provider?: string, model?: string, providersOnly?: boolean) => {
          const query: Record<string, string | boolean> = {};
          if (provider) query.provider = provider;
          if (model) query.model = model;
          if (providersOnly) query.providers_only = true;
          return query;
        };
        const imageProviderListQuery = {
          task: 'text_to_image',
          ...queryFor(undefined, undefined, true),
        };
        const imageModelQuery = {
          task: 'text_to_image',
          ...queryFor(request.provider, undefined, false),
        };
        const ttsQuery = queryFor(request.provider, request.model, request.providersOnly);
        const ttsProviderListQuery = queryFor(undefined, undefined, true);
        const sttQuery = queryFor(request.provider, undefined, request.providersOnly);
        const sttProviderListQuery = queryFor(undefined, undefined, true);
        const optionalCatalog = <T,>(promise: Promise<T>): Promise<T | null> =>
          promise.catch((err) => {
            console.warn('[BaseNode] optional media catalog request failed', err);
            return null;
          });
        const shouldFetchTtsProviders = request.scope === 'tts' && voiceCatalogEndpoint && (request.providersOnly || request.includeProviders);
        const shouldFetchTtsCatalog = request.scope === 'tts' && !request.providersOnly && voiceCatalogEndpoint;
        const shouldFetchSttProviders = request.scope === 'stt' && voiceCatalogEndpoint && (request.providersOnly || request.includeProviders);
        const shouldFetchImageProviders =
          request.scope === 'image' && visionProviderModelsEndpoint && (request.providersOnly || request.includeProviders || !request.provider);
        const shouldFetchImageModels = request.scope === 'image' && !request.providersOnly && request.provider && visionProviderModelsEndpoint;
        const [voiceProvidersCatalog, voiceCatalog, speechCatalog, sttProvidersCatalog, transcriptionCatalog, visionProvidersCatalog, visionProviderCatalog, visionModelCatalog] = await Promise.all([
          shouldFetchTtsProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(voiceCatalogEndpoint, {}, ttsProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          shouldFetchTtsCatalog
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(voiceCatalogEndpoint, {}, ttsQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          request.scope === 'tts' && !request.providersOnly && ttsModelsEndpoint
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(ttsModelsEndpoint, {}, ttsQuery), { timeoutMs: 30_000 }))
            : Promise.resolve(null),
          shouldFetchSttProviders
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(voiceCatalogEndpoint, {}, sttProviderListQuery), { timeoutMs: 5_000 }))
            : Promise.resolve(null),
          request.scope === 'stt' && !request.providersOnly && sttModelsEndpoint
            ? optionalCatalog(gatewayJson<Record<string, unknown>>(gatewayPath(sttModelsEndpoint, {}, sttQuery), { timeoutMs: 30_000 }))
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
        const nextTtsModels: MediaModelOption[] = [];
        const nextSttModels: MediaModelOption[] = [];
        const nextImageModels: MediaModelOption[] = [];
        const nextImageProviders: SelectOption[] = [];
        const seenVoices = new Set<string>();
        const seenProfiles = new Set<string>();
        const seenTtsProviders = new Set<string>();
        const seenSttProviders = new Set<string>();
        const seenTtsModels = new Set<string>();
        const seenSttModels = new Set<string>();
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
        let nextTtsFormatsByProvider: ProviderOptionMap = {};
        if (voiceRecord) {
          nextTtsFormatsByProvider = formatMapFrom(voiceRecord.tts_formats_by_provider);
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceRecord.providers));
          addProvidersFromArray(nextTtsProviders, seenTtsProviders, asArray(voiceRecord.tts_providers));
          addProvidersFromArray(nextSttProviders, seenSttProviders, asArray(voiceRecord.stt_providers));
          addProvider(nextTtsProviders, seenTtsProviders, text(voiceRecord.active_tts_provider, voiceRecord.engine_id));
          addProvider(nextSttProviders, seenSttProviders, text(voiceRecord.active_stt_provider));
          appendProviderValueMap(nextTtsModels, seenTtsModels, voiceRecord.tts_models_by_provider);
          appendProviderValueMap(nextSttModels, seenSttModels, voiceRecord.stt_models_by_provider);
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

        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionProvidersCatalog);
        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionProviderCatalog);
        scanImagePayload(nextImageModels, seenImageModels, nextImageProviders, seenImageProviders, visionModelCatalog);
        for (const option of nextImageModels) addProvider(nextImageProviders, seenImageProviders, option.provider);

        if (!cancelled) {
          if (request.scope === 'tts') {
            setTtsProviderOptions(nextTtsProviders);
            setTtsFormatsByProvider(nextTtsFormatsByProvider);
            if (!request.providersOnly) {
              setVoiceOptions(nextVoiceOptions);
              setProfileOptions(nextProfileOptions);
              setTtsModelOptions(nextTtsModels);
            }
          }
          if (request.scope === 'stt') {
            setSttProviderOptions(nextSttProviders);
            if (!request.providersOnly) setSttModelOptions(nextSttModels);
          }
          if (request.scope === 'image') {
            setImageProviderCatalogOptions(nextImageProviders);
            if (!request.providersOnly) setImageModelOptions(nextImageModels);
          }
        }
      } catch (err) {
        console.warn('[BaseNode] media catalog discovery failed', err);
        if (!cancelled) {
          if (request.scope === 'tts') {
            setTtsProviderOptions([]);
            if (!request.providersOnly) {
              setVoiceOptions([]);
              setProfileOptions([]);
              setTtsModelOptions([]);
              setTtsFormatsByProvider({});
            }
          }
          if (request.scope === 'stt') {
            setSttProviderOptions([]);
            if (!request.providersOnly) setSttModelOptions([]);
          }
          if (request.scope === 'image') {
            setImageProviderCatalogOptions([]);
            if (!request.providersOnly) setImageModelOptions([]);
          }
        }
      } finally {
        if (!cancelled) setMediaLoading(false);
      }
    };

    loadMediaOptions();

    return () => {
      cancelled = true;
    };
  }, [
    isModelResidencyNode,
    isMediaNode,
    mediaCatalogRequest,
    voiceCatalogEndpoint,
    ttsModelsEndpoint,
    sttModelsEndpoint,
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
      if (clean) requestMediaCatalog('image', { provider: clean });
    },
    [data.effectConfig, data.pinDefaults, id, requestMediaCatalog, updateNodeData]
  );

  const setImageModelSelection = useCallback(
    (model: string | null | undefined) => {
      const cleanModel = typeof model === 'string' ? model.trim() : '';
      const match = imageModelOptions.find(
        (option) => option.model === cleanModel && (!selectedImageProvider || option.provider === selectedImageProvider)
      );
      updateNodeData(id, {
        effectConfig: {
          ...(data.effectConfig || {}),
          image_provider: match?.provider || selectedImageProvider || undefined,
          image_model: cleanModel || undefined,
          provider: undefined,
          model: undefined,
        } as FlowNodeData['effectConfig'],
        pinDefaults: applyImagePinDefaultPatch(data.pinDefaults || {}, match),
      });
    },
    [data.effectConfig, data.pinDefaults, id, imageModelOptions, selectedImageProvider, updateNodeData]
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
      if (clean) requestMediaCatalog('tts', { provider: clean });
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
      const clean = task || 'image_generation';
      setModelResidencyPatch({ task: clean, provider: undefined, model: undefined });
      if (clean === 'image_generation') requestMediaCatalog('image', { providersOnly: true });
      if (clean === 'tts') requestMediaCatalog('tts', { providersOnly: true });
      if (clean === 'stt') requestMediaCatalog('stt', { providersOnly: true });
    },
    [requestMediaCatalog, setModelResidencyPatch]
  );

  const setModelResidencyProvider = useCallback(
    (provider: string | null | undefined) => {
      const clean = provider ? provider.trim() : '';
      setModelResidencyPatch({ provider: clean || undefined, model: undefined });
      if (selectedResidencyTask === 'image_generation' && clean) requestMediaCatalog('image', { provider: clean });
      if (selectedResidencyTask === 'tts') requestMediaCatalog('tts', { provider: clean || undefined });
      if (selectedResidencyTask === 'stt') requestMediaCatalog('stt', { provider: clean || undefined });
    },
    [requestMediaCatalog, selectedResidencyTask, setModelResidencyPatch]
  );

  const setModelResidencyModel = useCallback(
    (model: string | null | undefined) => {
      const clean = model ? model.trim() : '';
      setModelResidencyPatch({ model: clean || undefined });
    },
    [setModelResidencyPatch]
  );

  useEffect(() => {
    if (!isGenerateImageNode || !selectedImageProvider) return;
    const normalized = normalizeMediaProvider(selectedImageProvider);
    const current = data.pinDefaults || {};
    const nextDefaults = { ...current };
    let changed = false;
    if (normalized === 'openai' || normalized === 'openai-compatible') {
      if (nextDefaults.size !== 'auto') {
        nextDefaults.size = 'auto';
        changed = true;
      }
      for (const key of ['width', 'height', 'steps', 'guidance_scale'] as const) {
        if (nextDefaults[key] !== undefined) {
          delete nextDefaults[key];
          changed = true;
        }
      }
    } else if (nextDefaults.size === 'auto') {
      delete nextDefaults.size;
      if (nextDefaults.width === undefined) nextDefaults.width = 512;
      if (nextDefaults.height === undefined) nextDefaults.height = 512;
      if (nextDefaults.steps === undefined) nextDefaults.steps = 20;
      if (nextDefaults.guidance_scale === undefined) nextDefaults.guidance_scale = 7.5;
      changed = true;
    }
    if (changed) updateNodeData(id, { pinDefaults: nextDefaults });
  }, [data.pinDefaults, id, isGenerateImageNode, selectedImageProvider, updateNodeData]);

  useEffect(() => {
    if (mediaLoading || mediaCapabilitiesQuery.isLoading) return;

    if (isGenerateImageNode && selectedImageProvider && selectedImageModel) {
      const ok = visibleImageModelOptions.some((option) => option.value === selectedImageModel);
      if (visibleImageModelOptions.length > 0 && !ok) setEffectConfigPatch({ image_model: undefined, model: undefined });
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
    isGenerateImageNode,
    isGenerateVoiceNode,
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
    selectedVoice,
    setEffectConfigPatch,
    visibleImageModelOptions,
    visibleProfileOptions,
    visibleSttModelOptions,
    visibleTtsModelOptions,
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
        t === 'object' ||
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

  const setVariableName = useCallback(
    (raw: string | null | undefined) => {
      if (!isVarNode) return;
      const name = (raw || '').trim();

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
          isRecent && !isExecuting && 'recent'
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
              onMouseDownCapture={(e) => handlePinClick(e, inputExec.id, true)}
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
              onMouseDownCapture={(e) => handlePinClick(e, outputExecs[0].id, false)}
            />
          </div>
        )}
      </div>

      {/* Body with pins */}
      <div className="node-body">
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
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
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
                          onMouseDownCapture={(e) => handlePinClick(e, completed.id, false)}
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
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
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
                          onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
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
                          onMouseDownCapture={(e) => handlePinClick(e, defaultPin.id, false)}
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
                    onMouseDownCapture={(e) => handlePinClick(e, pin.id, false)}
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
            nodeId={id}
            name={boolVarConfig.name}
            defaultValue={boolVarConfig.default}
            options={variableOptions.map((o) => o.value)}
            onChange={setBoolVarConfig}
          />
        )}

        {data.nodeType === 'var_decl' && (
          <VarDeclInline
            nodeId={id}
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
              title="Edit Python code"
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
                disabled={!residencyAuthoringTarget.provider || !residencyAuthoringTarget.model || Boolean(residencyAuthoringTarget.blockedReason)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddModelResidencyStep('load');
                }}
                title="Insert a warm-up step before this node"
              >
                Warm before
              </button>
              <button
                type="button"
                className="node-residency-button nodrag"
                disabled={!residencyAuthoringTarget.provider || !residencyAuthoringTarget.model || Boolean(residencyAuthoringTarget.blockedReason)}
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
              {residencyAuthoringTarget.provider && residencyAuthoringTarget.model
                ? `${residencyAuthoringTarget.provider} / ${residencyAuthoringTarget.model}`
                : residencyAuthoringTarget.blockedReason || 'Select a concrete provider and model to preload explicitly.'}
            </div>
          </>
        )}

        {/* Data input pins */}
        <div className="pins-left" style={{ ['--pin-label-width' as any]: inputLabelWidth }}>
          {inputData.map((pin) => (
            <Fragment key={pin.id}>
              <div className="pin-row input">
                <AfTooltip content={pin.description} delayMs={700} priority={2}>
                  <span className="pin-hit">
                    <span
                      className="pin-shape"
                      style={{ color: PIN_COLORS[pin.type] }}
                      onClick={(e) => handlePinClick(e, pin.id, true)}
                      onMouseDownCapture={(e) => handlePinClick(e, pin.id, true)}
                    >
                      <PinShape type={pin.type} size={10} filled={isPinConnected(pin.id, true)} />
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={pin.id}
                        className={`pin ${pin.type}`}
                        style={overlayHandleStyle}
                        onMouseDownCapture={(e) => handlePinClick(e, pin.id, true)}
                        onClick={(e) => handlePinClick(e, pin.id, true)}
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
                  pin.type === 'boolean' ||
                  pin.type === 'provider' ||
                  pin.type === 'model' ||
                  pin.type === 'provider_text' ||
                  pin.type === 'model_text' ||
                  pin.type === 'provider_image' ||
                  pin.type === 'model_image' ||
                  pin.type === 'provider_voice' ||
                  pin.type === 'model_voice';
                const isEmitEventName = isEmitEventNode && pin.id === 'name';
                const isEmitEventScopePin = isEmitEventNode && pin.id === 'scope';
                const isOnEventScopePin = isOnEventNode && pin.id === 'scope';
                const isOnScheduleTimestampPin = isOnScheduleNode && pin.id === 'schedule';
                const isOnScheduleRecurrentPin = isOnScheduleNode && pin.id === 'recurrent';
                const isWriteFileContentPin = isWriteFileNode && pin.id === 'content';
                const isCompareOpPin = isCompareNode && pin.id === 'op';
                const isStringifyJsonModePin = isStringifyJsonNode && pin.id === 'mode';
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
                  const isImageProviderPin = isGenerateImageNode && pin.id === 'image_provider';
                  const isImageModelPin = isGenerateImageNode && pin.id === 'image_model';
                  const isImageFormatPin = isGenerateImageNode && pin.id === 'format';
                  const isTtsProviderPin = isGenerateVoiceNode && pin.id === 'tts_provider';
                  const isTtsModelPin = isGenerateVoiceNode && pin.id === 'tts_model';
                  const isTtsFormatPin = isGenerateVoiceNode && pin.id === 'format';
                  const isTtsQualityPresetPin = isGenerateVoiceNode && pin.id === 'quality_preset';
                  const isVoicePin = isGenerateVoiceNode && pin.id === 'voice';
                  const isVoiceProfilePin = isGenerateVoiceNode && pin.id === 'profile';
                  const isSttProviderPin = (isListenVoiceNode || isTranscribeAudioNode) && pin.id === 'stt_provider';
                  const isSttModelPin = (isListenVoiceNode || isTranscribeAudioNode) && pin.id === 'stt_model';
                  const isSttFormatPin = isTranscribeAudioNode && pin.id === 'format';
                  const isResidencyOperationPin = isModelResidencyNode && pin.id === 'operation';
                  const isResidencyTaskPin = isModelResidencyNode && pin.id === 'task';
                  const isResidencyProviderPin = isModelResidencyNode && pin.id === 'provider';
                  const isResidencyModelPin = isModelResidencyNode && pin.id === 'model';
                  const isResidencyPinPin = isModelResidencyNode && pin.id === 'pin';
                  const isResidencyRequiredPin = isModelResidencyNode && pin.id === 'required';
		                const hasSpecialControl =
		                  (hasProviderDropdown && pin.id === 'provider') ||
		                  (hasModelControls && pin.id === 'model') ||
                      isResidencyOperationPin ||
                      isResidencyTaskPin ||
                      isResidencyProviderPin ||
                      isResidencyModelPin ||
                      isResidencyPinPin ||
                      isResidencyRequiredPin ||
                      isImageProviderPin ||
                      isImageModelPin ||
                      isImageFormatPin ||
                      isTtsProviderPin ||
                      isTtsModelPin ||
                      isTtsFormatPin ||
                      isTtsQualityPresetPin ||
                      isVoicePin ||
                      isVoiceProfilePin ||
                      isSttProviderPin ||
                      isSttModelPin ||
                      isSttFormatPin ||
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
                  const CREATE = '__af_create_var__';

                  const options = [...variableOptions, { value: CREATE, label: 'Create new…' }];

                  if (!connected) {
                    controls.push(
                      <AfSelect
                        key="var-name"
                        variant="pin"
                        value={current}
                        placeholder="Select…"
                        options={options}
                        searchable
                        clearable
                        minPopoverWidth={260}
                        onChange={(v) => {
                          if (v === CREATE) {
                            const next = window.prompt('New variable name (dotted paths allowed):', '');
                            if (typeof next === 'string' && next.trim()) setVariableName(next);
                            return;
                          }
                          setVariableName(v || '');
                        }}
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
                      placeholder="image"
                      options={[
                        { value: 'image_generation', label: 'image' },
                        { value: 'text_generation', label: 'text' },
                        { value: 'tts', label: 'speech' },
                        { value: 'stt', label: 'transcription' },
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
                        if (selectedResidencyTask === 'tts') requestMediaCatalog('tts', { providersOnly: true });
                        if (selectedResidencyTask === 'stt') requestMediaCatalog('stt', { providersOnly: true });
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
                        if (selectedResidencyTask === 'tts' && selectedResidencyProvider) {
                          requestMediaCatalog('tts', { provider: selectedResidencyProvider });
                        }
                        if (selectedResidencyTask === 'stt' && selectedResidencyProvider) {
                          requestMediaCatalog('stt', { provider: selectedResidencyProvider });
                        }
                      }}
                      onChange={setModelResidencyModel}
                    />
                  );
                }

                if ((isResidencyPinPin || isResidencyRequiredPin) && !connected) {
                  const current = isResidencyPinPin ? selectedResidencyPin : selectedResidencyRequired;
                  const key = isResidencyPinPin ? 'pin' : 'required';
                  controls.push(
                    <label
                      key={`model-residency-${key}`}
                      className="af-pin-checkbox nodrag"
                      title={isResidencyPinPin ? 'Keep loaded until explicit unload' : 'Fail step when residency control fails'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        className="af-pin-checkbox-input"
                        type="checkbox"
                        checked={current}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setModelResidencyPatch({ [key]: e.target.checked })}
                      />
                      <span className="af-pin-checkbox-box" aria-hidden="true" />
                    </label>
                  );
                }

                if (isImageProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="image-provider"
                      variant="pin"
                      value={selectedImageProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Gateway default'}
                      options={imageProviderOptions}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search image providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestMediaCatalog('image', { providersOnly: true })}
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
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : selectedImageProvider ? 'Select…' : 'Select model…'}
                      options={visibleImageModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedImageProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleImageModelOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search image models…"
                      clearable
                      minPopoverWidth={400}
                      onChange={(v) => setImageModelSelection(v)}
                    />
                  );
                }

                if (isTtsProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="tts-provider"
                      variant="pin"
                      value={selectedTtsProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Gateway default'}
                      options={ttsProviderOptions}
                      disabled={mediaCapabilitiesQuery.isLoading}
                      loading={mediaLoading || mediaCapabilitiesQuery.isLoading}
                      searchable
                      searchPlaceholder="Search TTS providers…"
                      clearable
                      minPopoverWidth={300}
                      onOpen={() => requestMediaCatalog('tts', { providersOnly: true })}
                      onChange={(v) => setTtsProviderSelection(v)}
                    />
                  );
                }

                if (isTtsModelPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="tts-model"
                      variant="pin"
                      value={selectedTtsModel}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={visibleTtsModelOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleTtsModelOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search TTS models…"
                      clearable
                      minPopoverWidth={380}
                      onOpen={() => {
                        if (selectedTtsProvider) requestMediaCatalog('tts', { provider: selectedTtsProvider });
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
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Select voice…'}
                      options={visibleVoiceOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleVoiceOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search voices…"
                      clearable
                      minPopoverWidth={320}
                      onOpen={() => {
                        if (selectedTtsProvider) {
                          requestMediaCatalog('tts', { provider: selectedTtsProvider, model: selectedTtsModel || undefined });
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
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Select profile…'}
                      options={visibleProfileOptions}
                      disabled={mediaCapabilitiesQuery.isLoading || !selectedTtsProvider}
                      loading={mediaCapabilitiesQuery.isLoading || (mediaLoading && visibleProfileOptions.length === 0)}
                      searchable
                      searchPlaceholder="Search voice profiles…"
                      clearable
                      minPopoverWidth={340}
                      onOpen={() => {
                        if (selectedTtsProvider) {
                          requestMediaCatalog('tts', { provider: selectedTtsProvider, model: selectedTtsModel || undefined });
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

                if (isSttProviderPin && !connected) {
                  controls.push(
                    <AfSelect
                      key="stt-provider"
                      variant="pin"
                      value={selectedSttProvider}
                      placeholder={mediaLoading || mediaCapabilitiesQuery.isLoading ? 'Loading…' : 'Gateway default'}
                      options={sttProviderOptions}
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

                if ((isImageFormatPin || isTtsFormatPin || isSttFormatPin) && !connected) {
                  const fallbackFormat = isImageFormatPin ? 'png' : isTtsFormatPin ? 'wav' : 'json';
                  const options = isImageFormatPin
                    ? imageFormatOptions
                    : isTtsFormatPin
                      ? ttsFormatOptions
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

                if (!connected && isPrimitive && !hasSpecialControl) {
                  const raw = pinDefaults[pin.id];
                  if (
                    pin.type === 'string' ||
                    pin.type === 'provider' ||
                    pin.type === 'model' ||
                    pin.type === 'provider_text' ||
                    pin.type === 'model_text' ||
                    pin.type === 'provider_image' ||
                    pin.type === 'model_image' ||
                    pin.type === 'provider_voice' ||
                    pin.type === 'model_voice'
                  ) {
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
                      placeholder={providersQuery.isLoading ? 'Loading…' : 'Select…'}
                      options={providers.map((p) => ({ value: p.name, label: p.display_name || p.name }))}
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
                        onClick={(e) => handlePinClick(e, pin.id, false)}
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
          ))}

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
          {(isToolParametersNode ? outputData.filter((p) => p.id === 'tool_call') : outputData).map((pin) => (
            <div key={pin.id} className="pin-row output">
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
                          onClick={(e) => handlePinClick(e, pin.id, false)}
                        />
                      </span>
                    </span>
                  </AfTooltip>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
      </div>

      {isCodeNode && (
        <CodeEditorModal
          isOpen={showCodeEditor}
          title="Python Code"
          body={currentCodeBody}
          params={codeParams}
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
