/**
 * Properties panel for editing selected node configuration.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import type { Node } from 'reactflow';
import toast from 'react-hot-toast';
import type { FlowNodeData, ProviderInfo, VisualFlow, Pin } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import { useFlowStore } from '../hooks/useFlow';
import { useSemanticsRegistry } from '../hooks/useSemantics';
import { CodeEditorModal } from './CodeEditorModal';
import ProviderModelsPanel from './ProviderModelsPanel';
import { JsonSchemaNodeEditor } from './JsonSchemaNodeEditor';
import { JsonValueEditor } from './JsonValueEditor';
import { AfTooltip } from './AfTooltip';
import AfSelect from './inputs/AfSelect';
import AfMultiSelect from './inputs/AfMultiSelect';
import {
  extractFunctionBody,
  generatePythonTransformCode,
  sanitizePythonIdentifier,
  upsertPythonAvailableVariablesComments,
} from '../utils/codegen';
import { collectCustomEventNames } from '../utils/events';
import {
  AGENT_META_SCHEMA,
  AGENT_RESULT_SCHEMA,
  AGENT_SCRATCHPAD_SCHEMA,
  CONTEXT_EXTRA_SCHEMA,
  CONTEXT_SCHEMA,
  EVENT_ENVELOPE_SCHEMA,
  LLM_META_SCHEMA,
  LLM_RESULT_SCHEMA,
} from '../schemas/known_json_schemas';

interface PropertiesPanelProps {
  node: Node<FlowNodeData> | null;
}

interface ToolSpec {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  toolset?: string;
  tags?: string[];
  when_to_use?: string;
  examples?: unknown[];
}

type AgentSchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'any';

interface AgentSchemaField {
  id: string;
  name: string;
  type: AgentSchemaFieldType;
  required: boolean;
  itemsType?: Exclude<AgentSchemaFieldType, 'any'>;
}

type DataPinType = Exclude<FlowNodeData['inputs'][number]['type'], 'execution'>;

const DATA_PIN_TYPES: DataPinType[] = [
  'string',
  'number',
  'boolean',
  'object',
  'assertion',
  'assertions',
  'array',
  'tools',
  'provider',
  'model',
  'agent',
  'any',
];

function normalizePinId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '_');
}

function uniquePinId(base: string, used: Set<string>): string {
  const normalized = normalizePinId(base);
  const candidateBase = normalized || 'param';
  if (!used.has(candidateBase)) return candidateBase;
  let idx = 2;
  while (used.has(`${candidateBase}_${idx}`)) idx++;
  return `${candidateBase}_${idx}`;
}

function newOpaqueId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`;
}

function schemaFieldsFromJsonSchema(schema: unknown): AgentSchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const root = schema as Record<string, any>;
  if (root.type !== 'object') return [];
  const props = root.properties;
  if (!props || typeof props !== 'object') return [];

  const required = new Set<string>(
    Array.isArray(root.required) ? root.required.filter((x): x is string => typeof x === 'string') : []
  );

  const out: AgentSchemaField[] = [];
  for (const [name, spec] of Object.entries(props as Record<string, any>)) {
    if (!name) continue;
    const specObj = spec && typeof spec === 'object' ? (spec as Record<string, any>) : {};
    const rawType = typeof specObj.type === 'string' ? specObj.type : undefined;
    const type: AgentSchemaFieldType =
      rawType === 'string' || rawType === 'number' || rawType === 'integer' || rawType === 'boolean' || rawType === 'object' || rawType === 'array'
        ? rawType
        : 'any';

    let itemsType: Exclude<AgentSchemaFieldType, 'any'> | undefined = undefined;
    if (type === 'array') {
      const items = specObj.items;
      if (items && typeof items === 'object') {
        const itemsTypeRaw = (items as Record<string, any>).type;
        if (
          itemsTypeRaw === 'string' ||
          itemsTypeRaw === 'number' ||
          itemsTypeRaw === 'integer' ||
          itemsTypeRaw === 'boolean' ||
          itemsTypeRaw === 'object' ||
          itemsTypeRaw === 'array'
        ) {
          itemsType = itemsTypeRaw;
        }
      }
    }

    out.push({
      id: newOpaqueId('field'),
      name,
      type,
      required: required.has(name),
      itemsType,
    });
  }
  return out;
}

function jsonSchemaFromAgentFields(fields: AgentSchemaField[]): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;

    const t = field.type;
    if (t === 'any') {
      properties[name] = {};
    } else if (t === 'array') {
      const itemsType = field.itemsType;
      properties[name] = {
        type: 'array',
        items: itemsType ? { type: itemsType } : {},
      };
    } else {
      properties[name] = { type: t };
    }

    if (field.required) required.push(name);
  }

  const schema: Record<string, any> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

export function PropertiesPanel({ node }: PropertiesPanelProps) {
  const {
    updateNodeData,
    deleteNode,
    setEdges,
    flowId,
    nodes,
    edges,
    copySelectionToClipboard,
    duplicateSelection,
  } = useFlowStore();
  const [showCodeEditor, setShowCodeEditor] = useState(false);

  // Provider/model state for agent nodes
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // Tool discovery for agent nodes
  const [toolSpecs, setToolSpecs] = useState<ToolSpec[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState('');

  // Saved flows list (for subflow nodes)
  const [savedFlows, setSavedFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const lastSyncedSubflowPins = useRef<string | null>(null);

  const [ioPinNameDrafts, setIoPinNameDrafts] = useState<Record<string, string>>({});
  const [ioPinDefaultDrafts, setIoPinDefaultDrafts] = useState<Record<string, string>>({});

  const [agentSchemaEnabled, setAgentSchemaEnabled] = useState(false);
  const [agentSchemaMode, setAgentSchemaMode] = useState<'fields' | 'json'>('fields');
  const [agentSchemaFields, setAgentSchemaFields] = useState<AgentSchemaField[]>([]);
  const [agentSchemaJsonDraft, setAgentSchemaJsonDraft] = useState('');
  const [agentSchemaJsonDirty, setAgentSchemaJsonDirty] = useState(false);
  const [agentSchemaJsonError, setAgentSchemaJsonError] = useState<string | null>(null);

  // Track last fetched provider to prevent duplicate fetches
  const lastFetchedProvider = useRef<string | null>(null);

  const wantsSemanticsRegistry =
    Boolean(
      node &&
        node.data &&
        node.data.nodeType === 'literal_json' &&
        Array.isArray(node.data.outputs) &&
        node.data.outputs.some((p) => p.type === 'assertion')
    );
  const semanticsQuery = useSemanticsRegistry(wantsSemanticsRegistry);

  useEffect(() => {
    setShowCodeEditor(false);
    setIoPinDefaultDrafts({});
  }, [node?.id]);

  useEffect(() => {
    if (!node || node.data.nodeType !== 'agent') return;

    const outputSchema = node.data.agentConfig?.outputSchema;
    const enabled = Boolean(outputSchema?.enabled);
    const schema = outputSchema?.jsonSchema;
    const mode = outputSchema?.mode === 'json' ? 'json' : 'fields';

    setAgentSchemaEnabled(enabled);
    setAgentSchemaMode(mode);

    const parsed = schemaFieldsFromJsonSchema(schema);
    const nextFields =
      parsed.length > 0
        ? parsed
        : [
            {
              id: newOpaqueId('field'),
              name: 'output',
              type: 'string' as const,
              required: true,
            },
          ];
    setAgentSchemaFields(nextFields);

    const effectiveSchema =
      schema && typeof schema === 'object' ? (schema as Record<string, any>) : jsonSchemaFromAgentFields(nextFields);
    setAgentSchemaJsonDraft(JSON.stringify(effectiveSchema, null, 2));
    setAgentSchemaJsonDirty(false);
    setAgentSchemaJsonError(null);
  }, [node?.id]);

  // Fetch available providers on mount
  useEffect(() => {
    setLoadingProviders(true);
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => setProviders(data))
      .catch((err) => console.error('Failed to fetch providers:', err))
      .finally(() => setLoadingProviders(false));
  }, []);

  // Fetch available tools for Agent nodes
  useEffect(() => {
    setLoadingTools(true);
    setToolsError(null);
    fetch('/api/tools')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const normalized: ToolSpec[] = data
            .filter((t) => t && typeof t.name === 'string' && t.name.trim())
            .map((t) => ({
              name: String(t.name),
              description: typeof t.description === 'string' ? t.description : undefined,
              parameters: t.parameters && typeof t.parameters === 'object' ? t.parameters : undefined,
              toolset: typeof t.toolset === 'string' ? t.toolset : undefined,
              tags: Array.isArray(t.tags) ? t.tags.filter((x: unknown): x is string => typeof x === 'string') : undefined,
              when_to_use: typeof t.when_to_use === 'string' ? t.when_to_use : undefined,
              examples: Array.isArray(t.examples) ? t.examples : undefined,
            }));
          setToolSpecs(normalized);
        } else {
          setToolSpecs([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch tools:', err);
        setToolsError(String(err));
        setToolSpecs([]);
      })
      .finally(() => setLoadingTools(false));
  }, []);

  // Fetch models when provider changes (agent/llm_call nodes + IO defaults on start/end nodes).
  const selectedProvider = (() => {
    const n = node?.data;
    const fromAgent = n?.agentConfig?.provider;
    const fromEffect = (n?.effectConfig as any)?.provider;
    if (typeof fromAgent === 'string' && fromAgent.trim()) return fromAgent;
    if (typeof fromEffect === 'string' && fromEffect.trim()) return fromEffect;

    if (n && (n.nodeType === 'on_flow_start' || n.nodeType === 'on_flow_end')) {
      const pins = n.nodeType === 'on_flow_start' ? n.outputs : n.inputs;
      const providerPin = pins.find((p) => p.type === 'provider' || p.id === 'provider');
      const raw = providerPin && n.pinDefaults ? (n.pinDefaults as any)[providerPin.id] : undefined;
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
    }
    return '';
  })();
  useEffect(() => {
    // Skip if already fetched for this provider
    if (selectedProvider === lastFetchedProvider.current) {
      return;
    }

    if (selectedProvider) {
      lastFetchedProvider.current = selectedProvider;
      setLoadingModels(true);
      setModels([]);
      fetch(`/api/providers/${selectedProvider}/models`)
        .then((res) => res.json())
        .then((data) => setModels(data))
        .catch((err) => console.error('Failed to fetch models:', err))
        .finally(() => setLoadingModels(false));
    } else {
      lastFetchedProvider.current = null;
      setModels([]);
    }
  }, [selectedProvider]);

  // Fetch saved flows when editing a subflow node
  useEffect(() => {
    if (!node || node.data.nodeType !== 'subflow') return;
    setLoadingFlows(true);
    fetch('/api/flows')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSavedFlows(
            data
              .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
              .map((f) => ({ id: f.id, name: f.name }))
          );
        } else {
          setSavedFlows([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch flows:', err);
        setSavedFlows([]);
      })
      .finally(() => setLoadingFlows(false));
  }, [node]);

  // Sync Subflow pins to match the selected child workflow IO
  useEffect(() => {
    if (!node || node.data.nodeType !== 'subflow') return;
    const subflowId = node.data.subflowId;
    if (!subflowId) return;

    const syncKey = `${node.id}:${subflowId}`;
    if (lastSyncedSubflowPins.current === syncKey) return;

    const findEntryNode = (flow: VisualFlow) => {
      const entryId = flow.entryNode;
      if (entryId) {
        const direct = flow.nodes.find((n) => n.id === entryId);
        if (direct) return direct;
      }

      const execTargets = new Set(
        flow.edges
          .filter((e) => e.targetHandle === 'exec-in')
          .map((e) => e.target)
      );

      const candidate =
        flow.nodes.find((n) => isEntryNodeType(n.type) && !execTargets.has(n.id)) ||
        flow.nodes.find((n) => isEntryNodeType(n.type)) ||
        flow.nodes[0];

      return candidate;
    };

    const findFlowStartNode = (flow: VisualFlow) =>
      flow.nodes.find((n) => n.type === 'on_flow_start') ?? findEntryNode(flow);

    const findFlowEndNode = (flow: VisualFlow) => flow.nodes.find((n) => n.type === 'on_flow_end');

    fetch(`/api/flows/${subflowId}`)
      .then((res) => res.json())
      .then((flow: VisualFlow) => {
        const start = findFlowStartNode(flow);
        const end = findFlowEndNode(flow);

        const entryPins = start?.data?.outputs?.filter((p) => p.type !== 'execution') ?? [];
        const endPins = end?.data?.inputs?.filter((p) => p.type !== 'execution') ?? [];

        const desiredInputs: Pin[] = entryPins.map((p) => ({ ...p }));
        const desiredOutputs: Pin[] = endPins.map((p) => ({ ...p }));

        const execIn =
          node.data.inputs.find((p) => p.type === 'execution') ?? { id: 'exec-in', label: '', type: 'execution' };
        const execOut =
          node.data.outputs.find((p) => p.type === 'execution') ?? { id: 'exec-out', label: '', type: 'execution' };

        const filterData = (pins: Pin[]) =>
          pins.filter((p) => p.type !== 'execution' && p.id !== 'exec-in' && p.id !== 'exec-out');

        const nextInputs: Pin[] = [execIn, ...filterData(desiredInputs)];
        const nextOutputs: Pin[] = [execOut, ...filterData(desiredOutputs)];

        const samePins = (a: Pin[], b: Pin[]) =>
          a.length === b.length &&
          a.every((p, idx) => p.id === b[idx]?.id && p.label === b[idx]?.label && p.type === b[idx]?.type);

        if (!samePins(node.data.inputs, nextInputs) || !samePins(node.data.outputs, nextOutputs)) {
          updateNodeData(node.id, { inputs: nextInputs, outputs: nextOutputs });
        }

        lastSyncedSubflowPins.current = syncKey;
      })
      .catch((err) => {
        console.error('Failed to sync subflow pins:', err);
      });
  }, [node?.id, node?.data.subflowId, flowId, updateNodeData]);

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (node) {
        updateNodeData(node.id, {
          agentConfig: {
            ...node.data.agentConfig,
            provider: e.target.value || undefined,
            model: undefined, // Reset model when provider changes
          },
        });
      }
    },
    [node, updateNodeData]
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (node) {
        updateNodeData(node.id, {
          agentConfig: {
            ...node.data.agentConfig,
            model: e.target.value || undefined,
          },
        });
      }
    },
    [node, updateNodeData]
  );

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (node) {
        updateNodeData(node.id, { label: e.target.value });
      }
    },
    [node, updateNodeData]
  );

  const handleInputKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (node) {
        updateNodeData(node.id, { inputKey: e.target.value || undefined });
      }
    },
    [node, updateNodeData]
  );

  const handleOutputKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (node) {
        updateNodeData(node.id, { outputKey: e.target.value || undefined });
      }
    },
    [node, updateNodeData]
  );

  const handleDelete = useCallback(() => {
    if (node) {
      deleteNode(node.id);
    }
  }, [node, deleteNode]);

  const handleCopyNode = useCallback(() => {
    const n = copySelectionToClipboard();
    if (n > 0) toast.success(n === 1 ? 'Copied node' : `Copied ${n} nodes`);
  }, [copySelectionToClipboard]);

  const handleDuplicateNode = useCallback(() => {
    const n = duplicateSelection();
    if (n > 0) toast.success(n === 1 ? 'Duplicated node' : `Duplicated ${n} nodes`);
  }, [duplicateSelection]);

  const handleSubflowChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!node) return;
      updateNodeData(node.id, { subflowId: e.target.value || undefined });
    },
    [node, updateNodeData]
  );

  const inferPinType = useCallback((value: unknown): FlowNodeData['inputs'][number]['type'] => {
    if (Array.isArray(value)) return 'array';
    if (value === null || value === undefined) return 'any';
    switch (typeof value) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      default:
        return 'any';
    }
  }, []);

  const getByPath = useCallback((value: unknown, path: string): unknown => {
    if (!path) return undefined;
    const parts = path.split('.');
    let current: unknown = value;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        if (!/^\d+$/.test(part)) return undefined;
        const idx = Number(part);
        current = idx >= 0 && idx < current.length ? current[idx] : undefined;
        continue;
      }
      if (typeof current === 'object') {
        const obj = current as Record<string, unknown>;
        current = obj[part];
        continue;
      }
      return undefined;
    }
    return current;
  }, []);

  const flattenPaths = useCallback((value: unknown): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const maxDepth = 5;
    const maxPaths = 200;

    const walk = (cur: unknown, prefix: string, depth: number) => {
      if (out.length >= maxPaths) return;
      if (depth > maxDepth) return;
      if (!cur || typeof cur !== 'object') return;
      if (Array.isArray(cur)) return;

      const obj = cur as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (out.length >= maxPaths) return;
        const path = prefix ? `${prefix}.${key}` : key;
        if (!seen.has(path)) {
          seen.add(path);
          out.push(path);
        }
        const next = obj[key];
        if (next && typeof next === 'object' && !Array.isArray(next)) {
          walk(next, path, depth + 1);
        }
      }
    };

    walk(value, '', 0);
    return out;
  }, []);

  const inferPinTypeFromSchema = useCallback(
    (schema: unknown): FlowNodeData['inputs'][number]['type'] => {
      if (!schema || typeof schema !== 'object') return 'any';
      const t = (schema as Record<string, unknown>).type;
      switch (t) {
        case 'string':
          return 'string';
        case 'integer':
        case 'number':
          return 'number';
        case 'boolean':
          return 'boolean';
        case 'object':
          return 'object';
        case 'array':
          return 'array';
        default:
          return 'any';
      }
    },
    []
  );

  const getSchemaByPath = useCallback((schema: unknown, path: string): unknown => {
    if (!path || !schema || typeof schema !== 'object') return undefined;
    const parts = path.split('.');

    let current: unknown = schema;
    for (const part of parts) {
      if (!current || typeof current !== 'object') return undefined;
      const cur = current as Record<string, unknown>;
      const type = cur.type;

      if (type === 'object') {
        const props = cur.properties;
        if (!props || typeof props !== 'object') return undefined;
        current = (props as Record<string, unknown>)[part];
        continue;
      }

      if (type === 'array') {
        if (!/^\d+$/.test(part)) return undefined;
        current = cur.items;
        continue;
      }

      return undefined;
    }
    return current;
  }, []);

  const flattenSchemaPaths = useCallback((schema: unknown): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const maxDepth = 5;
    const maxPaths = 250;

    const walk = (cur: unknown, prefix: string, depth: number) => {
      if (out.length >= maxPaths) return;
      if (depth > maxDepth) return;
      if (!cur || typeof cur !== 'object') return;

      const obj = cur as Record<string, unknown>;
      const type = obj.type;

      if (type === 'object') {
        const props = obj.properties;
        if (!props || typeof props !== 'object') return;
        for (const key of Object.keys(props as Record<string, unknown>)) {
          if (out.length >= maxPaths) return;
          const path = prefix ? `${prefix}.${key}` : key;
          if (!seen.has(path)) {
            seen.add(path);
            out.push(path);
          }
          walk((props as Record<string, unknown>)[key], path, depth + 1);
        }
        return;
      }

      if (type === 'array') {
        const idxPath = prefix ? `${prefix}.0` : '0';
        if (!seen.has(idxPath)) {
          seen.add(idxPath);
          out.push(idxPath);
        }
        walk(obj.items, idxPath, depth + 1);
      }
    };

    walk(schema, '', 0);
    return out;
  }, []);


  if (!node) {
    return (
      <div className="properties-panel empty">
        <h3>Properties</h3>
        <p className="empty-message">
          Select a node to view and edit its properties.
        </p>
      </div>
    );
  }

  const { data } = node;
  const providerPinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'provider');
  const modelPinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'model');
  const toolsPinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'tools');
  const temperaturePinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'temperature');
  const seedPinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'seed');
  const emitEventNamePinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'name');
  const scopePinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'scope');
  const emitEventScopePinConnected = scopePinConnected && data.nodeType === 'emit_event';
  const emitEventSessionPinConnected = edges.some((e) => e.target === node.id && e.targetHandle === 'session_id');
  const onEventScopePinConnected = scopePinConnected && data.nodeType === 'on_event';

  const availableEventNames = collectCustomEventNames(nodes);

  // Pin default values are the single source of truth for unconnected *data pins*.
  // This is important for programmatic workflows: users can drive pins via edges, or
  // set pin defaults (via the inline pin editor on nodes, or here in the right panel).
  const isInputPinConnected = (pinId: string) =>
    edges.some((e) => e.target === node.id && e.targetHandle === pinId);

  const setPinDefault = (pinId: string, value: unknown) => {
    const prevDefaults = data.pinDefaults || {};
    const nextDefaults = { ...(prevDefaults as any) } as Record<string, unknown>;

    // `undefined` removes the default (pin treated as unset).
    if (value === undefined) {
      delete nextDefaults[pinId];
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    // Keep booleans explicit (false is a meaningful default that should be visible).
    if (typeof value === 'boolean') {
      nextDefaults[pinId] = value;
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    if (typeof value === 'number') {
      if (Number.isFinite(value)) nextDefaults[pinId] = value;
      else delete nextDefaults[pinId];
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    if (typeof value === 'string') {
      // Empty string clears (keeps previous UX).
      if (!value) delete nextDefaults[pinId];
      else nextDefaults[pinId] = value;
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    if (value === null) {
      nextDefaults[pinId] = null;
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    // JSON objects/arrays (used for object/array/tools defaults).
    if (Array.isArray(value) || typeof value === 'object') {
      nextDefaults[pinId] = value;
      updateNodeData(node.id, { pinDefaults: nextDefaults as any });
      return;
    }

    delete nextDefaults[pinId];
    updateNodeData(node.id, { pinDefaults: nextDefaults as any });
  };

  const updateAgentConfig = (patch: Partial<NonNullable<FlowNodeData['agentConfig']>>) => {
    updateNodeData(node.id, {
      agentConfig: {
        ...(data.agentConfig || {}),
        ...patch,
      },
    });
  };

  const updateLlmCallEffectConfig = (patch: Record<string, unknown>) => {
    updateNodeData(node.id, {
      effectConfig: {
        ...(data.effectConfig || {}),
        ...patch,
      },
    });
  };

  const selectedTools = (() => {
    if (data.nodeType === 'agent') {
      return Array.isArray(data.agentConfig?.tools)
        ? data.agentConfig?.tools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
    }
    if (data.nodeType === 'llm_call') {
      return Array.isArray((data.effectConfig as any)?.tools)
        ? ((data.effectConfig as any).tools as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
    }
    if (data.nodeType === 'tool_calls') {
      return Array.isArray((data.effectConfig as any)?.allowed_tools)
        ? ((data.effectConfig as any).allowed_tools as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0
          )
        : [];
    }
    return [];
  })();

  const filteredToolSpecs = (() => {
    const q = toolSearch.trim().toLowerCase();
    const matches = (t: ToolSpec) => {
      if (!q) return true;
      const hay = `${t.name} ${t.description || ''} ${(t.toolset || '')}`.toLowerCase();
      return hay.includes(q);
    };
    return toolSpecs.filter(matches);
  })();

  const toolSpecsByToolset = (() => {
    const out: Record<string, ToolSpec[]> = {};
    for (const t of filteredToolSpecs) {
      const key = t.toolset || 'other';
      if (!out[key]) out[key] = [];
      out[key].push(t);
    }
    return out;
  })();

  const commitAgentSchema = (
    nextEnabled: boolean,
    nextFields: AgentSchemaField[],
    nextMode: 'fields' | 'json' = agentSchemaMode
  ) => {
    const schema = jsonSchemaFromAgentFields(nextFields);
    updateAgentConfig({
      outputSchema: {
        ...(data.agentConfig?.outputSchema || {}),
        enabled: nextEnabled,
        mode: nextMode,
        jsonSchema: schema,
      },
    });

    if (nextMode === 'fields' && !agentSchemaJsonDirty) {
      setAgentSchemaJsonDraft(JSON.stringify(schema, null, 2));
      setAgentSchemaJsonError(null);
    }
  };

  return (
    <div className="properties-panel">
      <h3>Properties</h3>

      <div className="property-section">
        <div className="property-header">
          <span
            className="node-icon"
            style={{ color: data.headerColor }}
            dangerouslySetInnerHTML={{ __html: data.icon }}
          />
          <span className="node-type">{data.nodeType}</span>
        </div>
      </div>

      <div className="property-section">
        <label className="property-label">Label</label>
        <input
          type="text"
          className="property-input"
          value={data.label}
          onChange={handleLabelChange}
        />
      </div>

      <div className="property-section">
        <label className="property-label">Node ID</label>
        <input
          type="text"
          className="property-input"
          value={node.id}
          disabled
        />
      </div>

      <div className="property-section">
        <label className="property-label">Input Key (optional)</label>
        <input
          type="text"
          className="property-input"
          value={data.inputKey || ''}
          onChange={handleInputKeyChange}
          placeholder="e.g., data.input"
        />
        <span className="property-hint">
          Key in flow vars to read input from
        </span>
      </div>

      <div className="property-section">
        <label className="property-label">Output Key (optional)</label>
        <input
          type="text"
          className="property-input"
          value={data.outputKey || ''}
          onChange={handleOutputKeyChange}
          placeholder="e.g., data.output"
        />
        <span className="property-hint">
          Key in flow vars to write output to
        </span>
      </div>

      {/* Pins info */}
      <div className="property-section">
        <label className="property-label">Inputs</label>
        <ul className="pins-list">
          {data.inputs
            .filter((p) => p.type !== 'execution')
            .map((pin) => (
              <li key={pin.id} className="pin-info">
                <span className="pin-name">{pin.label}</span>
                <span className="pin-type">{pin.type}</span>
              </li>
            ))}
        </ul>
      </div>

      <div className="property-section">
        <label className="property-label">Outputs</label>
        <ul className="pins-list">
          {data.outputs
            .filter((p) => p.type !== 'execution')
            .map((pin) => (
              <li key={pin.id} className="pin-info">
                <span className="pin-name">{pin.label}</span>
                <span className="pin-type">{pin.type}</span>
              </li>
            ))}
        </ul>
      </div>

      {/* Pin default values (unconnected primitive pins).
          This keeps the right panel consistent with inline pin editors on nodes. */}
      {(() => {
        const skipIds = new Set(['provider', 'model', 'tools']); // shown in dedicated sections (agent/llm_call) for better UX
        const inputPins = data.inputs.filter((p) => p.type !== 'execution' && !skipIds.has(p.id));

        const editable = inputPins.filter((p) => {
          if (p.type === 'boolean' || p.type === 'number' || p.type === 'string') return true;
          // Known "string-select" pins that have inline dropdowns in the node UI.
          if (
            p.id === 'scope' &&
            (data.nodeType === 'memory_note' ||
              data.nodeType === 'memory_query' ||
              data.nodeType === 'memory_tag' ||
              data.nodeType === 'memory_kg_assert' ||
              data.nodeType === 'memory_kg_query')
          )
            return true;
          if (p.id === 'tags_mode' && data.nodeType === 'memory_query') return true;
          if (p.id === 'placement' && data.nodeType === 'memory_rehydrate') return true;
          return false;
        });

        if (editable.length === 0) return null;

        return (
          <div className="property-section">
            <label className="property-label">Input values</label>
            <span className="property-hint">
              These are <code>pinDefaults</code> for unconnected pins. Connected pins always override.
            </span>

            {editable.map((pin) => {
              const connected = isInputPinConnected(pin.id);
              const raw = data.pinDefaults ? (data.pinDefaults as any)[pin.id] : undefined;

              const rowLabel = pin.label || pin.id;

              if (connected) {
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <span className="property-hint">Provided by connected pin.</span>
                  </div>
                );
              }

              // Special dropdown pins (match node inline controls).
              if (
                pin.id === 'scope' &&
                (data.nodeType === 'memory_note' ||
                  data.nodeType === 'memory_query' ||
                  data.nodeType === 'memory_tag' ||
                  data.nodeType === 'memory_kg_assert' ||
                  data.nodeType === 'memory_kg_query' ||
                  data.nodeType === 'subflow')
              ) {
                const current = typeof raw === 'string' && raw.trim() ? raw.trim() : 'run';
                const allowAll =
                  data.nodeType === 'memory_query' ||
                  data.nodeType === 'memory_tag' ||
                  data.nodeType === 'memory_kg_query' ||
                  (data.nodeType === 'subflow' &&
                    data.inputs.some((p) => p.id === 'query_text' || p.id === 'query'));
                const options = allowAll ? ['run', 'session', 'global', 'all'] : ['run', 'session', 'global'];
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <select
                      className="property-select"
                      value={options.includes(current) ? current : 'run'}
                      onChange={(e) => setPinDefault(pin.id, e.target.value)}
                    >
                      {options.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (pin.id === 'tags_mode' && data.nodeType === 'memory_query') {
                const current = typeof raw === 'string' && raw.trim() ? raw.trim() : 'all';
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <select
                      className="property-select"
                      value={current === 'any' ? 'any' : 'all'}
                      onChange={(e) => setPinDefault(pin.id, e.target.value)}
                    >
                      <option value="all">all (AND)</option>
                      <option value="any">any (OR)</option>
                    </select>
                  </div>
                );
              }

              if (pin.id === 'placement' && data.nodeType === 'memory_rehydrate') {
                const current = typeof raw === 'string' && raw.trim() ? raw.trim() : 'after_summary';
                const options = ['after_summary', 'after_system', 'end'];
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <select
                      className="property-select"
                      value={options.includes(current) ? current : 'after_summary'}
                      onChange={(e) => setPinDefault(pin.id, e.target.value)}
                    >
                      {options.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }

              if (pin.id === 'level' && data.nodeType === 'answer_user') {
                const rawLevel = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
                const current =
                  rawLevel === 'error'
                    ? 'error'
                    : rawLevel === 'warn' || rawLevel === 'warning'
                      ? 'warning'
                      : rawLevel === 'info'
                        ? 'message'
                        : rawLevel === 'message'
                          ? 'message'
                          : 'message';
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <select className="property-select" value={current} onChange={(e) => setPinDefault(pin.id, e.target.value)}>
                      <option value="message">message</option>
                      <option value="warning">warning</option>
                      <option value="error">error</option>
                    </select>
                    <span className="property-hint">Controls host styling when rendering this message.</span>
                  </div>
                );
              }

              if (pin.type === 'boolean') {
                const checked = typeof raw === 'boolean' ? raw : false;
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <label className="toggle-container">
                      <input
                        type="checkbox"
                        className="toggle-checkbox"
                        checked={checked}
                        onChange={(e) => setPinDefault(pin.id, e.target.checked)}
                      />
                      <span className="toggle-label">{checked ? 'True' : 'False'}</span>
                    </label>
                  </div>
                );
              }

              if (pin.type === 'number') {
                const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : '';
                return (
                  <div key={pin.id} className="property-group">
                    <label className="property-sublabel">{rowLabel}</label>
                    <input
                      type="number"
                      className="property-input"
                      value={value}
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
                      step="any"
                    />
                  </div>
                );
              }

              // Default: string (use textarea for better visibility).
              const text = typeof raw === 'string' ? raw : '';
              return (
                <div key={pin.id} className="property-group">
                  <label className="property-sublabel">{rowLabel}</label>
                  <textarea
                    className="property-input property-textarea"
                    value={text}
                    onChange={(e) => setPinDefault(pin.id, e.target.value)}
                    rows={Math.min(6, Math.max(2, text.split('\n').length || 2))}
                  />
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Concat node properties */}
      {data.nodeType === 'concat' && (
        <div className="property-section">
          <label className="property-label">Concat</label>

          <div className="property-group">
            <label className="property-sublabel">Separator</label>
            <input
              type="text"
              className="property-input"
              value={data.concatConfig?.separator ?? ' '}
              onChange={(e) =>
                updateNodeData(node.id, {
                  concatConfig: { ...data.concatConfig, separator: e.target.value },
                })
              }
              placeholder="e.g., space, \\n, , "
            />
            <span className="property-hint">
              Use <code>\n</code> for newline and <code>\t</code> for tabs.
            </span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Inputs</label>
            {(() => {
              const pins = data.inputs.filter((p) => p.type !== 'execution');
              const addInput = () => {
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

                updateNodeData(node.id, {
                  inputs: [...data.inputs, { id: nextId, label: nextId, type: 'string' }],
                });
              };

              const removeInput = (pinId: string) => {
                if (pins.length <= 2) return;
                updateNodeData(node.id, {
                  inputs: data.inputs.filter((p) => p.id !== pinId),
                });
              };

              return (
                <div className="array-editor">
                  {pins.map((pin, idx) => (
                    <div key={pin.id} className="array-item">
                      <input className="array-item-input" value={pin.label} disabled />
                      {idx >= 2 && (
                        <button
                          type="button"
                          className="array-item-remove"
                          title="Remove input"
                          onClick={() => removeInput(pin.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                  <button type="button" className="array-add-button" onClick={addInput}>
                    + Add Input
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Array Concat node properties */}
      {data.nodeType === 'array_concat' && (
        <div className="property-section">
          <label className="property-label">Array Concat</label>

          <div className="property-group">
            <label className="property-sublabel">Inputs</label>
            {(() => {
              const pins = data.inputs.filter((p) => p.type !== 'execution');
              const addInput = () => {
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

                updateNodeData(node.id, {
                  inputs: [...data.inputs, { id: nextId, label: nextId, type: 'array' }],
                });
              };

              const removeInput = (pinId: string) => {
                if (pins.length <= 2) return;
                updateNodeData(node.id, {
                  inputs: data.inputs.filter((p) => p.id !== pinId),
                });
              };

              return (
                <div className="array-editor">
                  {pins.map((pin, idx) => (
                    <div key={pin.id} className="array-item">
                      <input className="array-item-input" value={pin.label} disabled />
                      {idx >= 2 && (
                        <button
                          type="button"
                          className="array-item-remove"
                          title="Remove input"
                          onClick={() => removeInput(pin.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                  <button type="button" className="array-add-button" onClick={addInput}>
                    + Add Input
                  </button>
                </div>
              );
            })()}
            <span className="property-hint">
              Concatenates arrays in input-pin order.
            </span>
          </div>
        </div>
      )}

      {/* Switch node properties */}
      {data.nodeType === 'switch' && (
        <div className="property-section">
          <label className="property-label">Switch</label>

          <div className="property-group">
            <label className="property-sublabel">Cases</label>
            {(() => {
              const cases = data.switchConfig?.cases ?? [];

              const buildOutputs = (nextCases: { id: string; value: string }[]) => {
                const execPins = [
                  ...nextCases.map((c) => ({
                    id: `case:${c.id}`,
                    label: c.value || 'case',
                    type: 'execution' as const,
                  })),
                  { id: 'default', label: 'default', type: 'execution' as const },
                ];
                return execPins;
              };

              const addCase = () => {
                const id =
                  typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? (crypto.randomUUID() as string).slice(0, 8)
                    : `c${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`;

                const nextCases = [...cases, { id, value: '' }];
                updateNodeData(node.id, {
                  switchConfig: { cases: nextCases },
                  outputs: buildOutputs(nextCases),
                });
              };

              const updateCaseValue = (caseId: string, value: string) => {
                const nextCases = cases.map((c) => (c.id === caseId ? { ...c, value } : c));
                updateNodeData(node.id, {
                  switchConfig: { cases: nextCases },
                  outputs: buildOutputs(nextCases),
                });
              };

              const removeCase = (caseId: string) => {
                const nextCases = cases.filter((c) => c.id !== caseId);
                updateNodeData(node.id, {
                  switchConfig: { cases: nextCases },
                  outputs: buildOutputs(nextCases),
                });
              };

              return (
                <div className="array-editor">
                  {cases.map((c) => (
                    <div key={c.id} className="array-item">
                      <input
                        className="array-item-input"
                        value={c.value}
                        onChange={(e) => updateCaseValue(c.id, e.target.value)}
                        placeholder="match value (string)"
                      />
                      <button
                        type="button"
                        className="array-item-remove"
                        title="Remove case"
                        onClick={() => removeCase(c.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <button type="button" className="array-add-button" onClick={addCase}>
                    + Add Case
                  </button>
                </div>
              );
            })()}
            <span className="property-hint">
              Each case adds an execution output pin; values are matched as strings. The <code>default</code> output is
              used when no case matches.
            </span>
          </div>
        </div>
      )}

      {/* Break Object node properties */}
      {data.nodeType === 'break_object' && (
        <div className="property-section">
          <label className="property-label">Break Object</label>

          {(() => {
            const inputEdge = edges.find(
              (e) => e.target === node.id && e.targetHandle === 'object'
            );
		            const sourceNode = inputEdge
		              ? nodes.find((n) => n.id === inputEdge.source)
		              : undefined;
		            let sample: unknown = undefined;
		            let schema: unknown = undefined;
		            const sourceHandle = typeof inputEdge?.sourceHandle === 'string' ? inputEdge.sourceHandle : '';

			            const inferSchemaForOutput = (n: any, handle: string, depth: number): unknown => {
			              if (!n || depth > 6) return undefined;
			              const nodeType = n?.data?.nodeType;
			              if (handle === 'context') return CONTEXT_SCHEMA;
			              if (handle === 'context_extra') return CONTEXT_EXTRA_SCHEMA;
			              if (nodeType === 'make_context' && handle === 'context') return CONTEXT_SCHEMA;
			              if (nodeType === 'make_scratchpad' && handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA;
			              if (nodeType === 'make_meta' && handle === 'meta') return AGENT_META_SCHEMA;
			              if (nodeType === 'on_event' && handle === 'event') return EVENT_ENVELOPE_SCHEMA;
		              if (nodeType === 'agent') {
		                if (handle === 'scratchpad') return AGENT_SCRATCHPAD_SCHEMA;
		                if (handle === 'meta') return AGENT_META_SCHEMA;
		                const outputSchema = n.data.agentConfig?.outputSchema;
		                if (outputSchema?.enabled && outputSchema.jsonSchema && typeof outputSchema.jsonSchema === 'object') {
		                  return outputSchema.jsonSchema;
		                }
		                return AGENT_RESULT_SCHEMA;
		              }
		              if (nodeType === 'llm_call') {
		                return handle === 'meta' ? LLM_META_SCHEMA : LLM_RESULT_SCHEMA;
		              }
		              if (nodeType === 'break_object') {
		                const inputEdge2 = edges.find((e) => e.target === n.id && e.targetHandle === 'object');
		                if (!inputEdge2) return undefined;
		                const srcNode2 = nodes.find((nn) => nn.id === inputEdge2.source);
		                const srcHandle2 = typeof inputEdge2.sourceHandle === 'string' ? inputEdge2.sourceHandle : '';
		                const base = inferSchemaForOutput(srcNode2, srcHandle2, depth + 1);
		                if (!base) return undefined;
		                return getSchemaByPath(base, handle);
		              }
		              return undefined;
		            };

	            if (sourceNode?.data.nodeType === 'literal_json') {
	              sample = sourceNode.data.literalValue;
	            } else if (sourceNode?.data.nodeType === 'literal_array') {
	              sample = sourceNode.data.literalValue;
            } else if (sourceNode?.data.nodeType === 'parse_json') {
              // Best-effort: if Parse JSON is fed by a pinned literal string, parse it so users
              // can discover fields and expose them as Break Object output pins.
              //
              // When Parse JSON is fed by an LLM output at runtime, we cannot know the shape
              // ahead of time; in that case this section stays empty by design.
              const parseNode = sourceNode;
              let candidateText: string | undefined;

              const textEdge = edges.find((e) => e.target === parseNode.id && e.targetHandle === 'text');
              const textSource = textEdge ? nodes.find((n) => n.id === textEdge.source) : undefined;

              if (textSource?.data.nodeType === 'literal_string') {
                const v = textSource.data.literalValue;
                if (typeof v === 'string') candidateText = v;
              } else {
                const pinned = parseNode.data.pinDefaults?.text;
                if (typeof pinned === 'string') candidateText = pinned;
              }

              const stripFence = (raw: string): string => {
                const s = raw.trim();
                if (!s.startsWith('```')) return s;
                const nl = s.indexOf('\n');
                if (nl === -1) return s.replace(/```/g, '').trim();
                const body = s.slice(nl + 1);
                const end = body.lastIndexOf('```');
                return (end >= 0 ? body.slice(0, end) : body).trim();
              };

              const tryParse = (raw: string): unknown | undefined => {
                const s = stripFence(raw);
                if (!s) return undefined;
                try {
                  return JSON.parse(s);
                } catch {
                  // Extract a likely JSON substring: first {/[ ... last }/]
                  const startObj = s.indexOf('{');
                  const startArr = s.indexOf('[');
                  const start =
                    startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startObj, startArr);
                  if (start === -1) return undefined;
                  const endObj = s.lastIndexOf('}');
                  const endArr = s.lastIndexOf(']');
                  const end = Math.max(endObj, endArr);
                  if (end <= start) return undefined;
                  try {
                    return JSON.parse(s.slice(start, end + 1));
                  } catch {
                    return undefined;
                  }
                }
              };

	              if (typeof candidateText === 'string' && candidateText.trim()) {
	                const parsed = tryParse(candidateText);
	                if (parsed !== undefined) sample = parsed;
	              }
		            } else if (sourceHandle === 'context') {
		              schema = CONTEXT_SCHEMA;
		            } else if (sourceHandle === 'context_extra') {
		              schema = CONTEXT_EXTRA_SCHEMA;
		            } else if (sourceNode?.data.nodeType === 'make_meta') {
		              schema = AGENT_META_SCHEMA;
		            } else if (sourceNode?.data.nodeType === 'make_scratchpad') {
		              schema = AGENT_SCRATCHPAD_SCHEMA;
		            } else if (sourceNode?.data.nodeType === 'on_event' && inputEdge?.sourceHandle === 'event') {
		              schema = EVENT_ENVELOPE_SCHEMA;
		            } else if (sourceNode?.data.nodeType === 'on_event' && inputEdge?.sourceHandle === 'payload') {
              // Payload is always a JSON object in our event envelope; for non-object payloads we wrap them as `{ value: ... }`.
              // When possible, infer a payload sample from a matching Emit Event node in the current graph.
              const eventName = (sourceNode.data.eventConfig?.name || '').trim();
              let inferred: unknown = undefined;

              if (eventName) {
                const emitters = nodes.filter((n) => n.data.nodeType === 'emit_event');

                const effectiveEmitName = (n: typeof emitters[number]) => {
                  const pinned = n.data.pinDefaults?.name;
                  if (typeof pinned === 'string' && pinned.trim()) return pinned.trim();
                  const cfg = n.data.effectConfig?.name;
                  if (typeof cfg === 'string' && cfg.trim()) return cfg.trim();
                  return '';
                };

                for (const emitter of emitters) {
                  if (effectiveEmitName(emitter) !== eventName) continue;
                  const payloadEdge = edges.find((e) => e.target === emitter.id && e.targetHandle === 'payload');
                  if (!payloadEdge) continue;
                  const payloadSrc = nodes.find((n) => n.id === payloadEdge.source);
                  if (!payloadSrc) continue;
                  if (payloadSrc.data.nodeType === 'literal_json' || payloadSrc.data.nodeType === 'literal_array') {
                    inferred = payloadSrc.data.literalValue;
                    break;
                  }
                }
              }

	              if (inferred && typeof inferred === 'object') {
	                sample = inferred;
	              } else {
	                // Minimal, still useful: exposes the stable `{ value }` wrapper field.
	                sample = { value: inferred ?? '' };
	              }
			            } else if (sourceNode?.data.nodeType === 'agent') {
			              if (sourceHandle === 'scratchpad') {
			                schema = AGENT_SCRATCHPAD_SCHEMA;
			              } else if (sourceHandle === 'meta') {
			                schema = AGENT_META_SCHEMA;
			              } else {
		                // Legacy: assume the Agent `result` output (deprecated pin).
		                const outputSchema = sourceNode.data.agentConfig?.outputSchema;
		                if (outputSchema?.enabled && outputSchema.jsonSchema && typeof outputSchema.jsonSchema === 'object') {
		                  schema = outputSchema.jsonSchema;
		                } else {
		                  schema = AGENT_RESULT_SCHEMA;
		                }
		              }
			            } else if (sourceNode?.data.nodeType === 'llm_call') {
			              schema = sourceHandle === 'meta' ? LLM_META_SCHEMA : LLM_RESULT_SCHEMA;
			            } else if (sourceNode?.data.nodeType === 'break_object') {
			              schema = inferSchemaForOutput(sourceNode, sourceHandle, 0);
			            }

            const available = schema
              ? flattenSchemaPaths(schema).sort()
              : sample
                ? flattenPaths(sample).sort()
                : [];
            const selectedPaths = data.breakConfig?.selectedPaths || [];
            const existing = data.outputs.filter((p) => p.type !== 'execution');
            const existingPins: Pin[] =
              existing.length > 0
                ? existing
                : selectedPaths.map((p) => ({
                    id: p,
                    label: p.split('.').slice(-1)[0] || p,
                    type: 'any' as const,
                  }));

            const syncPins = (nextPins: Pin[]) => {
              updateNodeData(node.id, {
                breakConfig: { ...data.breakConfig, selectedPaths: nextPins.map((p) => p.id) },
                outputs: nextPins,
              });
            };

            const removeField = (pinId: string) => {
              // Remove outgoing edges that referenced this output handle.
              const nextEdges = edges.filter((e) => !(e.source === node.id && e.sourceHandle === pinId));
              if (nextEdges.length !== edges.length) setEdges(nextEdges);
              syncPins(existingPins.filter((p) => p.id !== pinId));
            };

            const updateField = (pinId: string, patch: Partial<Pin>) => {
              const nextPins = existingPins.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              syncPins(nextPins);
            };

            const commitRenameField = (pinId: string) => {
              const draft = ioPinNameDrafts[pinId];
              if (draft === undefined) return;
              const nextPath = draft.trim();
              if (!nextPath) {
                setIoPinNameDrafts((prev) => {
                  const { [pinId]: _removed, ...rest } = prev;
                  return rest;
                });
                return;
              }

              const usedWithoutSelf = new Set(existingPins.filter((p) => p.id !== pinId).map((p) => p.id));
              const nextId = uniquePinId(nextPath, usedWithoutSelf);

              const nextEdges = edges.map((e) => {
                if (e.source === node.id && e.sourceHandle === pinId) {
                  return { ...e, sourceHandle: nextId };
                }
                return e;
              });
              setEdges(nextEdges);

              const nextPins = existingPins.map((p) =>
                p.id === pinId
                  ? { ...p, id: nextId, label: nextId.split('.').slice(-1)[0] || nextId }
                  : p
              );
              syncPins(nextPins);

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            const addField = () => {
              const used = new Set(existingPins.map((p) => p.id));
              let n = 1;
              while (used.has(`field${n}`)) n++;
              const id = `field${n}`;
              const nextPins: Pin[] = [...existingPins, { id, label: id, type: 'any' as const }];
              syncPins(nextPins);
              setIoPinNameDrafts((prev) => ({ ...prev, [id]: id }));
            };

	            const togglePath = (path: string) => {
	              if (existingPins.some((p) => p.id === path)) {
	                removeField(path);
	                return;
	              }
              const inferredType = (schema
                ? inferPinTypeFromSchema(getSchemaByPath(schema, path))
                : inferPinType(getByPath(sample, path))) as DataPinType;
              const nextPins = [
                ...existingPins,
                { id: path, label: path.split('.').slice(-1)[0] || path, type: inferredType },
              ];
	              syncPins(nextPins);
	            };

	            const tooltipForPath = (path: string): string => {
	              if (!schema) return '';
	              const leaf = getSchemaByPath(schema, path);
	              if (!leaf || typeof leaf !== 'object') return '';
	              const s = leaf as Record<string, unknown>;
	              const t = typeof s.type === 'string' ? s.type.trim() : '';
	              const fmt = typeof s.format === 'string' ? s.format.trim() : '';
	              const title = typeof s.title === 'string' ? s.title.trim() : '';
	              const desc = typeof s.description === 'string' ? s.description.trim() : '';
	              const enumVals = Array.isArray(s.enum)
	                ? s.enum
	                    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
	                    .map((v) => v.trim())
	                    .slice(0, 12)
	                : [];

	              let typeLabel = t;
	              if (t === 'array') {
	                const items = (s as any).items;
	                const itemTitle =
	                  items && typeof items === 'object' && typeof (items as any).title === 'string' ? String((items as any).title) : '';
	                const itemType =
	                  items && typeof items === 'object' && typeof (items as any).type === 'string' ? String((items as any).type) : '';
	                const inner = (itemTitle || itemType || '').trim();
	                typeLabel = inner ? `array<${inner}>` : 'array';
	              } else if (t === 'object' && title) {
	                typeLabel = `object (${title})`;
	              }

	              const lines: string[] = [];
	              lines.push(path);
	              if (typeLabel) lines.push(`Type: ${typeLabel}${fmt ? ` (${fmt})` : ''}`);
	              if (enumVals.length) {
	                lines.push(
	                  `Enum: ${enumVals.join(' | ')}${Array.isArray(s.enum) && s.enum.length > enumVals.length ? ' …' : ''}`
	                );
	              }
	              if (desc) lines.push(desc);
	              return lines.join('\n');
	            };

	            return (
	              <>
                {!inputEdge && (
                  <span className="property-hint">
                    Connect an object to the <code>object</code> input to auto-discover fields, or add fields manually below.
                  </span>
                )}

                {inputEdge && available.length === 0 && (
                  <span className="property-hint">
                    No fields discovered for this input. You can still add fields manually.
                  </span>
                )}

	                {inputEdge && available.length > 0 && (
	                  <div className="property-group">
	                    <div className="checkbox-list">
	                      {available.map((path) => (
	                        <AfTooltip key={path} content={tooltipForPath(path) || undefined} delayMs={700} priority={1} block>
	                          <label className="checkbox-item">
	                            <input
	                              type="checkbox"
	                              checked={existingPins.some((p) => p.id === path)}
	                              onChange={() => togglePath(path)}
	                            />
	                            <span className="checkbox-label">{path}</span>
	                          </label>
	                        </AfTooltip>
	                      ))}
	                    </div>
	                    <span className="property-hint">
	                      Select fields to expose as output pins.
	                    </span>
	                  </div>
                )}

                <div className="property-group">
                  <label className="property-sublabel">Fields</label>
                  <div className="array-editor">
                    {existingPins.map((pin) => (
                      <div key={pin.id} className="array-item">
                        <input
                          type="text"
                          className="property-input array-item-input io-pin-name"
                          value={ioPinNameDrafts[pin.id] ?? pin.id}
                          onChange={(e) => setIoPinNameDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))}
                          onBlur={() => commitRenameField(pin.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          placeholder="path (e.g. data.enriched_request)"
                        />
                        <select
                          className="property-select io-pin-type"
                          value={pin.type}
                          onChange={(e) => updateField(pin.id, { type: e.target.value as DataPinType })}
                        >
                          {DATA_PIN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          className="array-item-remove"
                          onClick={() => removeField(pin.id)}
                          title="Remove field"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button className="array-add-button" onClick={addField}>
                      + Add Field
                    </button>
                  </div>
                  <span className="property-hint">
                    These paths are extracted from the input object at runtime and exposed as output pins.
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Create JSON (Make Object) node properties */}
      {data.nodeType === 'make_object' && (
        <div className="property-section">
          <label className="property-label">Create JSON</label>
          {(() => {
            const existingPins: Pin[] = (data.inputs || []).filter((p) => p.type !== 'execution');

            const syncPins = (nextPins: Pin[]) => {
              // Preserve output pins (result) and other node metadata; only mutate dynamic inputs.
              updateNodeData(node.id, {
                inputs: nextPins,
              });
            };

            const removeField = (pinId: string) => {
              // Remove incoming edges that referenced this input handle.
              const nextEdges = edges.filter((e) => !(e.target === node.id && e.targetHandle === pinId));
              if (nextEdges.length !== edges.length) setEdges(nextEdges);

              // Remove pinned defaults for the deleted field.
              const prevDefaults = data.pinDefaults || {};
              if (pinId in prevDefaults) {
                const { [pinId]: _removed, ...rest } = prevDefaults as Record<string, any>;
                updateNodeData(node.id, { pinDefaults: rest });
              }

              syncPins(existingPins.filter((p) => p.id !== pinId));
            };

            const updateField = (pinId: string, patch: Partial<Pin>) => {
              const nextPins = existingPins.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              syncPins(nextPins);
            };

            const commitRenameField = (pinId: string) => {
              const draft = ioPinNameDrafts[pinId];
              if (draft === undefined) return;
              const nextName = draft.trim();
              if (!nextName) {
                setIoPinNameDrafts((prev) => {
                  const { [pinId]: _removed, ...rest } = prev;
                  return rest;
                });
                return;
              }

              const usedWithoutSelf = new Set(existingPins.filter((p) => p.id !== pinId).map((p) => p.id));
              const nextId = uniquePinId(nextName, usedWithoutSelf);

              // Update incoming edges to this input handle.
              const nextEdges = edges.map((e) => {
                if (e.target === node.id && e.targetHandle === pinId) {
                  return { ...e, targetHandle: nextId };
                }
                return e;
              });
              setEdges(nextEdges);

              // Move pinned defaults under the new key when present.
              const prevDefaults = data.pinDefaults || {};
              if (pinId in prevDefaults && nextId !== pinId) {
                const { [pinId]: moved, ...rest } = prevDefaults as Record<string, any>;
                updateNodeData(node.id, { pinDefaults: { ...rest, [nextId]: moved } });
              }

              const nextPins = existingPins.map((p) =>
                p.id === pinId
                  ? { ...p, id: nextId, label: nextId }
                  : p
              );
              syncPins(nextPins);

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            const addField = () => {
              const used = new Set(existingPins.map((p) => p.id));
              let n = 1;
              while (used.has(`field${n}`)) n++;
              const id = `field${n}`;
              const nextPins: Pin[] = [...existingPins, { id, label: id, type: 'any' as const }];
              syncPins(nextPins);
              setIoPinNameDrafts((prev) => ({ ...prev, [id]: id }));
            };

            return (
              <>
                <span className="property-hint">
                  Define flat fields for the output object. Each field becomes an input pin; if unconnected, the node uses its default value.
                </span>

                <div className="property-group">
                  <label className="property-sublabel">Fields</label>
                  <div className="array-editor">
                    {existingPins.map((pin) => (
                      <div key={pin.id} className="array-item">
                        <input
                          type="text"
                          className="property-input array-item-input io-pin-name"
                          value={ioPinNameDrafts[pin.id] ?? pin.id}
                          onChange={(e) => setIoPinNameDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))}
                          onBlur={() => commitRenameField(pin.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          placeholder="field name (e.g. my_var1)"
                        />
                        <select
                          className="property-select io-pin-type"
                          value={pin.type}
                          onChange={(e) => updateField(pin.id, { type: e.target.value as DataPinType })}
                        >
                          {DATA_PIN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          className="array-item-remove"
                          onClick={() => removeField(pin.id)}
                          title="Remove field"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button className="array-add-button" onClick={addField}>
                      + Add Field
                    </button>
                  </div>
                  <span className="property-hint">
                    Output object keys are the field names above (flat only; use <code>Set Property</code> for nested paths).
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Agent-specific properties */}
      {data.nodeType === 'agent' && (
        <div className="property-section">
          <label className="property-label">Agent Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Provider</label>
            {providerPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.agentConfig?.provider || ''}
                onChange={handleProviderChange}
                disabled={loadingProviders}
              >
                <option value="">
                  {loadingProviders ? 'Loading...' : 'Select provider...'}
                </option>
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="property-group">
            <label className="property-sublabel">Model</label>
            {modelPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.agentConfig?.model || ''}
                onChange={handleModelChange}
                disabled={!data.agentConfig?.provider || loadingModels}
              >
                <option value="">
                  {loadingModels ? 'Loading...' : 'Select model...'}
                </option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="property-group">
            <label className="property-sublabel">Temperature</label>
            {temperaturePinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <input
                type="number"
                className="property-input"
                value={data.agentConfig?.temperature ?? 0.7}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  updateAgentConfig({ temperature: Number.isFinite(parsed) ? parsed : 0.7 });
                }}
                min={0}
                max={2}
                step={0.1}
              />
            )}
            <span className="property-hint">0 = deterministic, 2 = creative</span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Seed</label>
            {seedPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <input
                type="number"
                className="property-input"
                value={data.agentConfig?.seed ?? -1}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  updateAgentConfig({ seed: Number.isFinite(parsed) ? parsed : -1 });
                }}
                step={1}
              />
            )}
            <span className="property-hint">-1 = random/unset; {'>=0'} = deterministic (provider permitting)</span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Tools (optional)</label>
            <input
              className="property-input"
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder={loadingTools ? 'Loading tools…' : 'Search tools…'}
              disabled={loadingTools}
            />

            {selectedTools.length > 0 && (
              <div className="tool-chips">
                {selectedTools.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="tool-chip"
                    onClick={() => {
                      const next = selectedTools.filter((t) => t !== name);
                      updateAgentConfig({ tools: next.length > 0 ? next : undefined });
                    }}
                    title="Remove tool"
                  >
                    {name}
                    <span className="tool-chip-x">×</span>
                  </button>
                ))}
              </div>
            )}

            {toolsError && (
              <span className="property-error">
                Failed to load tools: {toolsError}
              </span>
            )}

            {!loadingTools && !toolsError && toolSpecs.length === 0 && (
              <span className="property-hint">
                No tools available from the runtime.
              </span>
            )}

            {!loadingTools && toolSpecs.length > 0 && (
              <div className="toolset-list">
                {Object.entries(toolSpecsByToolset).map(([toolset, tools]) => {
                  const names = tools.map((t) => t.name);
                  const allSelected = names.length > 0 && names.every((n) => selectedTools.includes(n));

                  const toggleAll = () => {
                    const next = new Set(selectedTools);
                    if (!allSelected) {
                      for (const n of names) next.add(n);
                    } else {
                      for (const n of names) next.delete(n);
                    }
                    const asList = Array.from(next);
                    updateAgentConfig({ tools: asList.length > 0 ? asList : undefined });
                  };

                  return (
                    <div key={toolset} className="toolset-group">
                      <div className="toolset-header">
                        <span className="toolset-title">{toolset}</span>
                        <button
                          type="button"
                          className="toolset-toggle"
                          onClick={toggleAll}
                          disabled={names.length === 0}
                          title={allSelected ? 'Deselect all' : 'Select all'}
                        >
                          {allSelected ? 'None' : 'All'}
                        </button>
                      </div>
                      <div className="checkbox-list tool-checkboxes">
                        {tools.map((t) => (
                          <label key={t.name} className="checkbox-item tool-item">
                            <input
                              type="checkbox"
                              checked={selectedTools.includes(t.name)}
                              onChange={() => {
                                const next = selectedTools.includes(t.name)
                                  ? selectedTools.filter((x) => x !== t.name)
                                  : [...selectedTools, t.name];
                                updateAgentConfig({ tools: next.length > 0 ? next : undefined });
                              }}
                            />
                            <span className="checkbox-label">{t.name}</span>
                            {t.description && <span className="tool-desc">{t.description}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <span className="property-hint">
              Selected tools are the only tools this node may execute at runtime.
            </span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Structured Output</label>
            <label className="toggle-container">
              <input
                type="checkbox"
                className="toggle-checkbox"
                checked={agentSchemaEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAgentSchemaEnabled(enabled);
                  if (agentSchemaMode === 'fields') {
                    commitAgentSchema(enabled, agentSchemaFields, 'fields');
                    return;
                  }

                  let schema: unknown = data.agentConfig?.outputSchema?.jsonSchema;
                  if (!schema && agentSchemaJsonDraft.trim()) {
                    try {
                      const parsed = JSON.parse(agentSchemaJsonDraft);
                      if (parsed && typeof parsed === 'object') schema = parsed;
                    } catch {
                      // Ignore parse errors here; user can fix in JSON editor.
                    }
                  }

                  updateAgentConfig({
                    outputSchema: {
                      ...(data.agentConfig?.outputSchema || {}),
                      enabled,
                      mode: 'json',
                      jsonSchema:
                        schema && typeof schema === 'object'
                          ? (schema as Record<string, any>)
                          : jsonSchemaFromAgentFields(agentSchemaFields),
                    },
                  });
                }}
              />
              <span className="toggle-label">
                Return JSON result
              </span>
            </label>

            {agentSchemaEnabled && (
              <>
                <div className="property-group schema-mode">
                  <label className="property-sublabel">Schema Editor</label>
                  <select
                    className="property-select"
                    value={agentSchemaMode}
                    onChange={(e) => {
                      const mode = e.target.value === 'json' ? 'json' : 'fields';
                      const existingSchema =
                        data.agentConfig?.outputSchema?.jsonSchema ?? jsonSchemaFromAgentFields(agentSchemaFields);

                      setAgentSchemaMode(mode);
                      updateAgentConfig({
                        outputSchema: {
                          ...(data.agentConfig?.outputSchema || {}),
                          enabled: agentSchemaEnabled,
                          mode,
                          jsonSchema: existingSchema,
                        },
                      });

                      if (mode === 'json') {
                        setAgentSchemaJsonDraft(JSON.stringify(existingSchema, null, 2));
                        setAgentSchemaJsonDirty(false);
                        setAgentSchemaJsonError(null);
                      } else {
                        const parsedFields = schemaFieldsFromJsonSchema(existingSchema);
                        if (parsedFields.length > 0) setAgentSchemaFields(parsedFields);
                        setAgentSchemaJsonDirty(false);
                        setAgentSchemaJsonError(null);
                      }
                    }}
                  >
                    <option value="fields">Fields (recommended)</option>
                    <option value="json">JSON Schema (advanced)</option>
                  </select>
                </div>

                {agentSchemaMode === 'fields' && (
                  <div className="schema-fields">
                    {agentSchemaFields.map((field) => (
                      <div key={field.id} className="schema-field-row">
                        <div className="schema-field-top">
                          <input
                            className="property-input schema-field-name"
                            value={field.name}
                            placeholder="field_name"
                            onChange={(e) => {
                              const next = agentSchemaFields.map((f) =>
                                f.id === field.id ? { ...f, name: e.target.value } : f
                              );
                              setAgentSchemaFields(next);
                              commitAgentSchema(agentSchemaEnabled, next, 'fields');
                            }}
                            onBlur={() => {
                              const used = new Set(agentSchemaFields.filter((f) => f.id !== field.id).map((f) => f.name));
                              const sanitized = uniquePinId(sanitizePythonIdentifier(field.name), used);
                              if (sanitized === field.name) return;
                              const next = agentSchemaFields.map((f) =>
                                f.id === field.id ? { ...f, name: sanitized } : f
                              );
                              setAgentSchemaFields(next);
                              commitAgentSchema(agentSchemaEnabled, next, 'fields');
                            }}
                          />

                          <button
                            type="button"
                            className="array-item-remove"
                            onClick={() => {
                              const next = agentSchemaFields.filter((f) => f.id !== field.id);
                              setAgentSchemaFields(next);
                              commitAgentSchema(agentSchemaEnabled, next, 'fields');
                            }}
                            title="Remove field"
                          >
                            ×
                          </button>
                        </div>

                        <div className="schema-field-bottom">
                          <select
                            className="property-select schema-field-type"
                            value={field.type}
                            onChange={(e) => {
                              const nextType = (e.target.value || 'string') as AgentSchemaFieldType;
                              const next = agentSchemaFields.map((f) => {
                                if (f.id !== field.id) return f;
                                if (nextType === 'array') {
                                  return { ...f, type: 'array', itemsType: f.itemsType ?? 'string' } as AgentSchemaField;
                                }
                                return { ...f, type: nextType, itemsType: undefined } as AgentSchemaField;
                              });
                              setAgentSchemaFields(next);
                              setAgentSchemaMode('fields');
                              commitAgentSchema(agentSchemaEnabled, next, 'fields');
                            }}
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="integer">integer</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                            <option value="any">any</option>
                          </select>

                          {field.type === 'array' && (
                            <select
                              className="property-select schema-field-items"
                              value={field.itemsType ?? 'string'}
                              onChange={(e) => {
                                const itemsType = (e.target.value || 'string') as Exclude<AgentSchemaFieldType, 'any'>;
                                const next = agentSchemaFields.map((f) =>
                                  f.id === field.id ? { ...f, itemsType } : f
                                );
                                setAgentSchemaFields(next);
                                commitAgentSchema(agentSchemaEnabled, next, 'fields');
                              }}
                            >
                              <option value="string">items: string</option>
                              <option value="number">items: number</option>
                              <option value="integer">items: integer</option>
                              <option value="boolean">items: boolean</option>
                              <option value="object">items: object</option>
                              <option value="array">items: array</option>
                            </select>
                          )}

                          <label className="schema-optional" title="When enabled, this field may be omitted from the result.">
                            <input
                              type="checkbox"
                              checked={!field.required}
                              onChange={(e) => {
                                const optional = e.target.checked;
                                const next = agentSchemaFields.map((f) =>
                                  f.id === field.id ? { ...f, required: !optional } : f
                                );
                                setAgentSchemaFields(next);
                                commitAgentSchema(agentSchemaEnabled, next, 'fields');
                              }}
                            />
                            <span>optional</span>
                          </label>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      className="array-add-button"
                      onClick={() => {
                        const used = new Set(agentSchemaFields.map((f) => f.name));
                        const nextName = uniquePinId('field', used);
                        const next = [
                          ...agentSchemaFields,
                          {
                            id: newOpaqueId('field'),
                            name: nextName,
                            type: 'string' as const,
                            required: true,
                          },
                        ];
                        setAgentSchemaFields(next);
                        setAgentSchemaMode('fields');
                        commitAgentSchema(agentSchemaEnabled, next, 'fields');
                      }}
                    >
                      + Add field
                    </button>
                  </div>
                )}

                {agentSchemaMode === 'json' && (
                  <div className="schema-json">
                    <textarea
                      className="property-input property-textarea code"
                      value={agentSchemaJsonDraft}
                      onChange={(e) => {
                        setAgentSchemaJsonDraft(e.target.value);
                        setAgentSchemaJsonDirty(true);
                      }}
                      rows={10}
                      placeholder='{"type":"object","properties":{...}}'
                    />

                    {agentSchemaJsonError && <span className="property-error">{agentSchemaJsonError}</span>}

                    <div className="schema-actions">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(agentSchemaJsonDraft);
                            if (!parsed || typeof parsed !== 'object') {
                              setAgentSchemaJsonError('Schema must be a JSON object.');
                              return;
                            }
                            updateAgentConfig({
                              outputSchema: {
                                ...(data.agentConfig?.outputSchema || {}),
                                enabled: agentSchemaEnabled,
                                mode: 'json',
                                jsonSchema: parsed,
                              },
                            });
                            setAgentSchemaJsonError(null);
                            setAgentSchemaJsonDirty(false);
                            setAgentSchemaFields(schemaFieldsFromJsonSchema(parsed));
                          } catch (e) {
                            setAgentSchemaJsonError(String(e));
                          }
                        }}
                        disabled={!agentSchemaJsonDirty}
                      >
                        Apply JSON Schema
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const schema = data.agentConfig?.outputSchema?.jsonSchema ?? jsonSchemaFromAgentFields(agentSchemaFields);
                          setAgentSchemaJsonDraft(JSON.stringify(schema, null, 2));
                          setAgentSchemaJsonDirty(false);
                          setAgentSchemaJsonError(null);
                        }}
                      >
                        Reset
                      </button>
                    </div>

                    <span className="property-hint">
                      Property names must be identifier-style (<code>snake_case</code>) for structured output validation.
                    </span>
                  </div>
                )}

	                <span className="property-hint">
	                  When enabled, the Agent&apos;s <code>response</code> output is a JSON string matching this schema.
	                </span>
              </>
            )}

	            {!agentSchemaEnabled && (
	              <span className="property-hint">
	                Disabled: the Agent returns a free-form response string.
	              </span>
	            )}
          </div>
        </div>
      )}

      {/* Code-specific properties */}
      {data.nodeType === 'code' && (
        <div className="property-section">
          <label className="property-label">Python Code</label>

          {(() => {
            const params = data.inputs.filter((p) => p.type !== 'execution');
            const used = new Set(data.inputs.map((p) => p.id));

            const currentBody =
              data.codeBody ??
              (typeof data.code === 'string'
                ? extractFunctionBody(data.code, data.functionName || 'transform') ?? ''
                : '');

            const commitRenameParam = (pinId: string) => {
              const draft = ioPinNameDrafts[pinId];
              if (draft === undefined) return;
              const nextLabel = draft.trim();
              if (!nextLabel) {
                setIoPinNameDrafts((prev) => {
                  const { [pinId]: _removed, ...rest } = prev;
                  return rest;
                });
                return;
              }

              const usedWithoutSelf = new Set(data.inputs.filter((p) => p.id !== pinId).map((p) => p.id));
              const nextId = uniquePinId(sanitizePythonIdentifier(nextLabel), usedWithoutSelf);

              // Update edges first so store doesn't interpret this as a removal.
              const nextEdges = edges.map((e) => {
                if (e.target === node.id && e.targetHandle === pinId) {
                  return { ...e, targetHandle: nextId };
                }
                return e;
              });
              setEdges(nextEdges);

              const nextPins = data.inputs.map((p) =>
                p.id === pinId ? { ...p, id: nextId, label: nextId } : p
              );
              const nextBody = upsertPythonAvailableVariablesComments(
                currentBody,
                nextPins.filter((p) => p.type !== 'execution')
              );
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: nextBody,
                code: generatePythonTransformCode(nextPins, nextBody),
                functionName: 'transform',
              });

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            const updateParam = (pinId: string, patch: Partial<typeof params[number]>) => {
              const nextPins = data.inputs.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              const nextBody = upsertPythonAvailableVariablesComments(
                currentBody,
                nextPins.filter((p) => p.type !== 'execution')
              );
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: nextBody,
                code: generatePythonTransformCode(nextPins, nextBody),
                functionName: 'transform',
              });
            };

            const addParam = () => {
              let n = 1;
              while (used.has(`param${n}`)) n++;
              const id = `param${n}`;
              const nextPins = [...data.inputs, { id, label: id, type: 'string' as DataPinType }];
              const nextBody = upsertPythonAvailableVariablesComments(
                currentBody,
                nextPins.filter((p) => p.type !== 'execution')
              );
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: nextBody,
                code: generatePythonTransformCode(nextPins, nextBody),
                functionName: 'transform',
              });
            };

            const removeParam = (pinId: string) => {
              const nextPins = data.inputs.filter((p) => p.id !== pinId);
              const nextBody = upsertPythonAvailableVariablesComments(
                currentBody,
                nextPins.filter((p) => p.type !== 'execution')
              );
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: nextBody,
                code: generatePythonTransformCode(nextPins, nextBody),
                functionName: 'transform',
              });
            };

            return (
              <>
                <div className="property-group">
                  <label className="property-sublabel">Parameters</label>
                  <div className="array-editor">
                    {params.map((pin) => (
                      <div key={pin.id} className="array-item">
                        <input
                          type="text"
                          className="property-input array-item-input io-pin-name"
                          value={ioPinNameDrafts[pin.id] ?? pin.id}
                          onChange={(e) =>
                            setIoPinNameDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))
                          }
                          onBlur={() => commitRenameParam(pin.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          placeholder="name"
                        />
                        <select
                          className="property-select io-pin-type"
                          value={pin.type}
                          onChange={(e) => updateParam(pin.id, { type: e.target.value as DataPinType })}
                        >
                          {DATA_PIN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          className="array-item-remove"
                          onClick={() => removeParam(pin.id)}
                          title="Remove parameter"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    <button className="array-add-button" onClick={addParam}>
                      + Add Parameter
                    </button>
                  </div>
                </div>

                <div className="property-group">
                  <label className="property-sublabel">Code</label>
                  <button type="button" className="toolbar-button" onClick={() => setShowCodeEditor(true)}>
                    ✍️ Edit Code
                  </button>
                  <span className="property-hint">
                    Edit the body of <code>transform(_input)</code>. Generated code is executed in a sandbox (no imports).
                  </span>
                </div>

                <CodeEditorModal
                  isOpen={showCodeEditor}
                  title="Python Code"
                  body={currentBody}
                  params={params}
                  onClose={() => setShowCodeEditor(false)}
                  onSave={(nextBody) => {
                    const nextWithHeader = upsertPythonAvailableVariablesComments(nextBody, params);
                    updateNodeData(node.id, {
                      codeBody: nextWithHeader,
                      code: generatePythonTransformCode(data.inputs, nextWithHeader),
                      functionName: 'transform',
                    });
                    setShowCodeEditor(false);
                  }}
                />
              </>
            );
          })()}
        </div>
      )}

      {/* Subflow-specific properties */}
      {data.nodeType === 'subflow' && (
        <div className="property-section">
          <label className="property-label">Subflow Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Saved Flow</label>
            <select
              className="property-select"
              value={data.subflowId || ''}
              onChange={handleSubflowChange}
              disabled={loadingFlows}
            >
              <option value="">
                {loadingFlows ? 'Loading...' : 'Select flow...'}
              </option>
              {savedFlows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.id}){flowId && f.id === flowId ? ' — this flow (recursive)' : ''}
                </option>
              ))}
            </select>
            <span className="property-hint">
              Select a saved flow to execute as a subworkflow. Choosing this flow creates recursion; ensure a base case.
            </span>
          </div>
        </div>
      )}

      {/* Event node properties - On User Request */}
      {data.nodeType === 'on_user_request' && (
        <div className="property-section">
          <label className="property-label">Event Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Description</label>
            <input
              type="text"
              className="property-input"
              value={data.eventConfig?.description || ''}
              onChange={(e) =>
                updateNodeData(node.id, {
                  eventConfig: {
                    ...data.eventConfig,
                    description: e.target.value,
                  },
                })
              }
              placeholder="e.g., User sends a chat message"
            />
            <span className="property-hint">
              Describes what triggers this event
            </span>
          </div>
        </div>
      )}

      {/* Event node properties - On Agent Message */}
      {data.nodeType === 'on_agent_message' && (
        <div className="property-section">
          <label className="property-label">Event Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Channel</label>
            <input
              type="text"
              className="property-input"
              value={data.eventConfig?.channel || ''}
              onChange={(e) =>
                updateNodeData(node.id, {
                  eventConfig: {
                    ...data.eventConfig,
                    channel: e.target.value,
                  },
                })
              }
              placeholder="e.g., broadcast, private"
            />
            <span className="property-hint">
              Channel to listen for messages (empty = all)
            </span>
          </div>
          <div className="property-group">
            <label className="property-sublabel">Agent Filter</label>
            <input
              type="text"
              className="property-input"
              value={data.eventConfig?.agentFilter || ''}
              onChange={(e) =>
                updateNodeData(node.id, {
                  eventConfig: {
                    ...data.eventConfig,
                    agentFilter: e.target.value,
                  },
                })
              }
              placeholder="e.g., agent-123"
            />
            <span className="property-hint">
              Only receive from specific agent (empty = any)
            </span>
          </div>
        </div>
      )}

      {/* Event node properties - On Schedule */}
      {data.nodeType === 'on_schedule' && (
        <div className="property-section">
          <label className="property-label">Event Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Schedule</label>
            <input
              type="text"
              className="property-input"
              value={data.eventConfig?.schedule || ''}
              onChange={(e) =>
                updateNodeData(node.id, {
                  eventConfig: {
                    ...data.eventConfig,
                    schedule: e.target.value,
                  },
                })
              }
              placeholder='e.g., "30s", "5m", "2025-01-01T12:00:00Z"'
            />
            <span className="property-hint">
              Interval (e.g., "30s", "5m", "1h") or an ISO timestamp
            </span>
          </div>
          <div className="property-group">
            <label className="property-sublabel">Recurrent</label>
            <label className="toggle-container">
              <input
                type="checkbox"
                className="toggle-checkbox"
                checked={data.eventConfig?.recurrent ?? true}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    eventConfig: {
                      ...data.eventConfig,
                      recurrent: e.target.checked,
                    },
                  })
                }
              />
              <span className="toggle-label">
                {(data.eventConfig?.recurrent ?? true) ? 'Enabled' : 'Disabled'}
              </span>
            </label>
            <span className="property-hint">
              When enabled, the schedule re-arms after the branch completes.
            </span>
          </div>
        </div>
      )}

      {/* Event node properties - On Event (custom durable event) */}
      {data.nodeType === 'on_event' && (
        <div className="property-section">
          <label className="property-label">Event Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Name</label>
            {availableEventNames.length > 0 ? (
              <datalist id="af-custom-event-names">
                {availableEventNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            ) : null}
            <input
              type="text"
              className="property-input"
              value={data.eventConfig?.name || ''}
              list={availableEventNames.length > 0 ? 'af-custom-event-names' : undefined}
              onChange={(e) =>
                updateNodeData(node.id, {
                  eventConfig: {
                    ...data.eventConfig,
                    name: e.target.value,
                  },
                })
              }
              placeholder={availableEventNames.length > 0 ? 'Type or pick a name…' : 'e.g., my_event'}
            />
            <span className="property-hint">
              Durable event name (session-scoped by default)
            </span>
          </div>
          <div className="property-group">
            <label className="property-sublabel">Scope</label>
            {onEventScopePinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.eventConfig?.scope ?? 'session'}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    eventConfig: {
                      ...data.eventConfig,
                      scope: e.target.value as 'session' | 'workflow' | 'run' | 'global',
                    },
                  })
                }
              >
                <option value="session">Session (recommended)</option>
                <option value="workflow">Workflow</option>
                <option value="run">Run</option>
                <option value="global">Global</option>
              </select>
            )}
            <span className="property-hint">
              Session scope targets one workflow instance (root run id).
            </span>
          </div>
        </div>
      )}

      {/* On Flow Start dynamic parameters (output pins) */}
      {data.nodeType === 'on_flow_start' && (
        <div className="property-section">
          <label className="property-label">Flow Start Parameters</label>

          {(() => {
            const params = data.outputs.filter((p) => p.type !== 'execution');

            const used = new Set(data.outputs.map((p) => p.id));

            const providerOptions = providers
              .filter((p) => p && typeof p.name === 'string' && p.name.trim())
              .map((p) => ({ value: p.name, label: (p as any).display_name || p.name }));
            providerOptions.sort((a, b) => a.label.localeCompare(b.label));

            const modelOptions = (models || [])
              .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
              .map((m) => ({ value: m, label: m }));

            const toolOptions = toolSpecs
              .filter((t) => t && typeof t.name === 'string' && t.name.trim())
              .map((t) => ({ value: t.name.trim(), label: t.name.trim() }))
              .sort((a, b) => a.label.localeCompare(b.label));

            const providerParam = params.find((p) => p.type === 'provider' || p.id === 'provider');
            const providerDefault =
              providerParam && data.pinDefaults && typeof (data.pinDefaults as any)[providerParam.id] === 'string'
                ? String((data.pinDefaults as any)[providerParam.id] || '')
                : '';

            const renderDefaultEditor = (pin: Pin) => {
              const raw = data.pinDefaults ? (data.pinDefaults as any)[pin.id] : undefined;
              const defaultHint = `Default value for ${pin.id}`;

              if (pin.type === 'provider') {
                const value = typeof raw === 'string' ? raw : '';
                return (
                  <AfSelect
                    value={value}
                    options={providerOptions}
                    placeholder={defaultHint}
                    loading={loadingProviders}
                    clearable
                    onChange={(v) => setPinDefault(pin.id, v)}
                  />
                );
              }

              if (pin.type === 'model') {
                const value = typeof raw === 'string' ? raw : '';
                const disabled = !providerDefault;
                return (
                  <AfSelect
                    value={value}
                    options={modelOptions}
                    placeholder={providerDefault ? defaultHint : `${defaultHint} (set provider first)`}
                    loading={loadingModels}
                    disabled={disabled}
                    clearable
                    onChange={(v) => setPinDefault(pin.id, v)}
                  />
                );
              }

              if (pin.type === 'tools') {
                const values = Array.isArray(raw)
                  ? raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                  : [];
                return (
                  <AfMultiSelect
                    values={values}
                    options={toolOptions}
                    placeholder={defaultHint}
                    loading={loadingTools}
                    clearable
                    onChange={(vals) => setPinDefault(pin.id, vals.length > 0 ? vals : undefined)}
                  />
                );
              }

              if (pin.id === 'scope') {
                const allowAll = nodes.some((n) => {
                  const t = n?.data?.nodeType;
                  if (t === 'memory_query' || t === 'memory_tag' || t === 'memory_kg_query') return true;
                  if (t === 'subflow') {
                    const ins = Array.isArray(n?.data?.inputs) ? n.data.inputs : [];
                    return ins.some((p: any) => p && (p.id === 'query_text' || p.id === 'query'));
                  }
                  return false;
                });
                const options = allowAll ? ['run', 'session', 'global', 'all'] : ['run', 'session', 'global'];
                const current = typeof raw === 'string' && raw.trim() ? raw.trim() : 'run';
                return (
                  <select
                    className="property-select"
                    value={options.includes(current) ? current : 'run'}
                    onChange={(e) => setPinDefault(pin.id, e.target.value)}
                  >
                    {options.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                );
              }

              if (pin.type === 'boolean') {
                const value = typeof raw === 'boolean' ? (raw ? 'true' : 'false') : '';
                return (
                  <AfSelect
                    value={value}
                    options={[
                      { value: 'true', label: 'true' },
                      { value: 'false', label: 'false' },
                    ]}
                    placeholder={defaultHint}
                    clearable
                    onChange={(v) => {
                      if (!v) setPinDefault(pin.id, undefined);
                      else setPinDefault(pin.id, v === 'true');
                    }}
                  />
                );
              }

              if (pin.type === 'number') {
                const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
                return (
                  <input
                    type="number"
                    className="property-input"
                    value={value}
                    placeholder={defaultHint}
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
                    step="any"
                  />
                );
              }

              if (pin.type === 'object' || pin.type === 'array' || pin.type === 'assertion' || pin.type === 'assertions') {
                const fallback =
                  raw === undefined
                    ? ''
                    : typeof raw === 'string'
                      ? raw
                      : (() => {
                          try {
                            return JSON.stringify(raw, null, 2);
                          } catch {
                            return '';
                          }
                        })();
                const text = ioPinDefaultDrafts[pin.id] ?? fallback;
                return (
                  <textarea
                    className="property-input property-textarea"
                    value={text}
                    onChange={(e) => setIoPinDefaultDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))}
                    onBlur={() => {
                      const v = (ioPinDefaultDrafts[pin.id] ?? fallback).trim();
                      if (!v) {
                        setPinDefault(pin.id, undefined);
                        setIoPinDefaultDrafts((prev) => {
                          const { [pin.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                        return;
                      }
                      try {
                        const parsed = JSON.parse(v);
                        if (
                          (pin.type === 'object' || pin.type === 'assertion') &&
                          (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')
                        ) {
                          toast.error(`Default for ${pin.id} must be a JSON object`);
                          return;
                        }
                        if ((pin.type === 'array' || pin.type === 'assertions') && !Array.isArray(parsed)) {
                          toast.error(`Default for ${pin.id} must be a JSON array`);
                          return;
                        }
                        setPinDefault(pin.id, parsed);
                        setIoPinDefaultDrafts((prev) => {
                          const { [pin.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                      } catch {
                        toast.error(`Invalid JSON default for ${pin.id}`);
                      }
                    }}
                    rows={4}
                    placeholder={
                      pin.type === 'array' || pin.type === 'assertions'
                        ? `${defaultHint}\n[\n  \"item\"\n]`
                        : `${defaultHint}\n{\n  \"key\": \"value\"\n}`
                    }
                  />
                );
              }

              // Default: string-like pins
              const value = typeof raw === 'string' ? raw : '';
              return (
                <input
                  type="text"
                  className="property-input"
                  value={value}
                  onChange={(e) => setPinDefault(pin.id, e.target.value)}
                  placeholder={defaultHint}
                />
              );
            };

            const addParam = () => {
              let n = 1;
              while (used.has(`param${n}`)) n++;
              const id = `param${n}`;
              updateNodeData(node.id, {
                outputs: [...data.outputs, { id, label: id, type: 'string' }],
              });
            };

            const removeParam = (pinId: string) => {
              updateNodeData(node.id, {
                outputs: data.outputs.filter((p) => p.id !== pinId),
              });
            };

            const updateParam = (pinId: string, patch: Partial<typeof params[number]>) => {
              const next = data.outputs.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              updateNodeData(node.id, { outputs: next });
            };

            const commitRenameParam = (pinId: string) => {
              const draft = ioPinNameDrafts[pinId];
              if (draft === undefined) return;
              const nextLabel = draft.trim();
              if (!nextLabel) {
                setIoPinNameDrafts((prev) => {
                  const { [pinId]: _removed, ...rest } = prev;
                  return rest;
                });
                return;
              }

              const usedWithoutSelf = new Set(data.outputs.filter((p) => p.id !== pinId).map((p) => p.id));
              const nextId = uniquePinId(nextLabel, usedWithoutSelf);

              // Update edges first so store doesn't interpret this as a removal.
              const nextEdges = edges.map((e) => {
                if (e.source === node.id && e.sourceHandle === pinId) {
                  return { ...e, sourceHandle: nextId };
                }
                return e;
              });
              setEdges(nextEdges);

              const nextPins = data.outputs.map((p) =>
                p.id === pinId ? { ...p, id: nextId, label: nextId } : p
              );
              updateNodeData(node.id, { outputs: nextPins });

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            return (
              <>
                <div className="schema-fields">
                  {params.map((pin) => (
                    <div key={pin.id} className="schema-field-row">
                      <div className="schema-field-top">
                        <input
                          type="text"
                          className="property-input schema-field-name"
                          value={ioPinNameDrafts[pin.id] ?? pin.id}
                          onChange={(e) =>
                            setIoPinNameDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))
                          }
                          onBlur={() => commitRenameParam(pin.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder="param_name"
                        />
                        <button
                          className="array-item-remove"
                          onClick={() => removeParam(pin.id)}
                          title="Remove parameter"
                        >
                          &times;
                        </button>
                      </div>
                      <div className="schema-field-bottom">
                        <select
                          className="property-select schema-field-type"
                          value={pin.type}
                          onChange={(e) =>
                            updateParam(pin.id, { type: e.target.value as DataPinType })
                          }
                        >
                          {DATA_PIN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="io-pin-default">
                        {renderDefaultEditor(pin)}
                      </div>
                      <input
                        className="property-input schema-field-desc"
                        value={pin.description ?? ''}
                        placeholder="Description (optional)"
                        onChange={(e) => updateParam(pin.id, { description: e.target.value })}
                      />
                    </div>
                  ))}
                  <button className="array-add-button" onClick={addParam}>
                    + Add Parameter
                  </button>
                </div>
                <span className="property-hint">
                  Parameters become initial vars and show up in the Run Flow form.
                </span>
              </>
            );
          })()}
        </div>
      )}

      {/* On Flow End exposed outputs (input pins) */}
      {data.nodeType === 'on_flow_end' && (
        <div className="property-section">
          <label className="property-label">Flow Outputs</label>

          {(() => {
            const outs = data.inputs.filter((p) => p.type !== 'execution');
            const used = new Set(data.inputs.map((p) => p.id));

            const providerOptions = providers
              .filter((p) => p && typeof p.name === 'string' && p.name.trim())
              .map((p) => ({ value: p.name, label: (p as any).display_name || p.name }));
            providerOptions.sort((a, b) => a.label.localeCompare(b.label));
            const modelOptions = (models || [])
              .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
              .map((m) => ({ value: m, label: m }));
            const toolOptions = toolSpecs
              .filter((t) => t && typeof t.name === 'string' && t.name.trim())
              .map((t) => ({ value: t.name.trim(), label: t.name.trim() }))
              .sort((a, b) => a.label.localeCompare(b.label));

            const providerOut = outs.find((p) => p.type === 'provider' || p.id === 'provider');
            const providerDefault =
              providerOut && data.pinDefaults && typeof (data.pinDefaults as any)[providerOut.id] === 'string'
                ? String((data.pinDefaults as any)[providerOut.id] || '')
                : '';

            const renderDefaultEditor = (pin: Pin) => {
              const raw = data.pinDefaults ? (data.pinDefaults as any)[pin.id] : undefined;
              const defaultHint = `Default value for ${pin.id}`;

              if (pin.type === 'provider') {
                const value = typeof raw === 'string' ? raw : '';
                return (
                  <AfSelect
                    value={value}
                    options={providerOptions}
                    placeholder={defaultHint}
                    loading={loadingProviders}
                    clearable
                    onChange={(v) => setPinDefault(pin.id, v)}
                  />
                );
              }

              if (pin.type === 'model') {
                const value = typeof raw === 'string' ? raw : '';
                const disabled = !providerDefault;
                return (
                  <AfSelect
                    value={value}
                    options={modelOptions}
                    placeholder={providerDefault ? defaultHint : `${defaultHint} (set provider first)`}
                    loading={loadingModels}
                    disabled={disabled}
                    clearable
                    onChange={(v) => setPinDefault(pin.id, v)}
                  />
                );
              }

              if (pin.type === 'tools') {
                const values = Array.isArray(raw)
                  ? raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                  : [];
                return (
                  <AfMultiSelect
                    values={values}
                    options={toolOptions}
                    placeholder={defaultHint}
                    loading={loadingTools}
                    clearable
                    onChange={(vals) => setPinDefault(pin.id, vals.length > 0 ? vals : undefined)}
                  />
                );
              }

              if (pin.type === 'boolean') {
                const value = typeof raw === 'boolean' ? (raw ? 'true' : 'false') : '';
                return (
                  <AfSelect
                    value={value}
                    options={[
                      { value: 'true', label: 'true' },
                      { value: 'false', label: 'false' },
                    ]}
                    placeholder={defaultHint}
                    clearable
                    onChange={(v) => {
                      if (!v) setPinDefault(pin.id, undefined);
                      else setPinDefault(pin.id, v === 'true');
                    }}
                  />
                );
              }

              if (pin.type === 'number') {
                const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
                return (
                  <input
                    type="number"
                    className="property-input"
                    value={value}
                    placeholder={defaultHint}
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
                    step="any"
                  />
                );
              }

              if (pin.type === 'object' || pin.type === 'array' || pin.type === 'assertion' || pin.type === 'assertions') {
                const fallback =
                  raw === undefined
                    ? ''
                    : typeof raw === 'string'
                      ? raw
                      : (() => {
                          try {
                            return JSON.stringify(raw, null, 2);
                          } catch {
                            return '';
                          }
                        })();
                const text = ioPinDefaultDrafts[pin.id] ?? fallback;
                return (
                  <textarea
                    className="property-input property-textarea"
                    value={text}
                    onChange={(e) => setIoPinDefaultDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))}
                    onBlur={() => {
                      const v = (ioPinDefaultDrafts[pin.id] ?? fallback).trim();
                      if (!v) {
                        setPinDefault(pin.id, undefined);
                        setIoPinDefaultDrafts((prev) => {
                          const { [pin.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                        return;
                      }
                      try {
                        const parsed = JSON.parse(v);
                        if (
                          (pin.type === 'object' || pin.type === 'assertion') &&
                          (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')
                        ) {
                          toast.error(`Default for ${pin.id} must be a JSON object`);
                          return;
                        }
                        if ((pin.type === 'array' || pin.type === 'assertions') && !Array.isArray(parsed)) {
                          toast.error(`Default for ${pin.id} must be a JSON array`);
                          return;
                        }
                        setPinDefault(pin.id, parsed);
                        setIoPinDefaultDrafts((prev) => {
                          const { [pin.id]: _removed, ...rest } = prev;
                          return rest;
                        });
                      } catch {
                        toast.error(`Invalid JSON default for ${pin.id}`);
                      }
                    }}
                    rows={4}
                    placeholder={
                      pin.type === 'array' || pin.type === 'assertions'
                        ? `${defaultHint}\n[\n  \"item\"\n]`
                        : `${defaultHint}\n{\n  \"key\": \"value\"\n}`
                    }
                  />
                );
              }

              const value = typeof raw === 'string' ? raw : '';
              return (
                <input
                  type="text"
                  className="property-input"
                  value={value}
                  onChange={(e) => setPinDefault(pin.id, e.target.value)}
                  placeholder={defaultHint}
                />
              );
            };

            const addOut = () => {
              let n = 1;
              while (used.has(`output${n}`)) n++;
              const id = `output${n}`;
              updateNodeData(node.id, {
                inputs: [...data.inputs, { id, label: id, type: 'string' }],
              });
            };

            const removeOut = (pinId: string) => {
              updateNodeData(node.id, {
                inputs: data.inputs.filter((p) => p.id !== pinId),
              });
            };

            const updateOut = (pinId: string, patch: Partial<typeof outs[number]>) => {
              const next = data.inputs.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              updateNodeData(node.id, { inputs: next });
            };

            const commitRenameOut = (pinId: string) => {
              const draft = ioPinNameDrafts[pinId];
              if (draft === undefined) return;
              const nextLabel = draft.trim();
              if (!nextLabel) {
                setIoPinNameDrafts((prev) => {
                  const { [pinId]: _removed, ...rest } = prev;
                  return rest;
                });
                return;
              }

              const usedWithoutSelf = new Set(data.inputs.filter((p) => p.id !== pinId).map((p) => p.id));
              const nextId = uniquePinId(nextLabel, usedWithoutSelf);

              const nextEdges = edges.map((e) => {
                if (e.target === node.id && e.targetHandle === pinId) {
                  return { ...e, targetHandle: nextId };
                }
                return e;
              });
              setEdges(nextEdges);

              const nextPins = data.inputs.map((p) =>
                p.id === pinId ? { ...p, id: nextId, label: nextId } : p
              );
              updateNodeData(node.id, { inputs: nextPins });

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            return (
              <>
                <div className="schema-fields">
                  {outs.map((pin) => (
                    <div key={pin.id} className="schema-field-row">
                      <div className="schema-field-top">
                        <input
                          type="text"
                          className="property-input schema-field-name"
                          value={ioPinNameDrafts[pin.id] ?? pin.id}
                          onChange={(e) =>
                            setIoPinNameDrafts((prev) => ({ ...prev, [pin.id]: e.target.value }))
                          }
                          onBlur={() => commitRenameOut(pin.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder="output_name"
                        />
                        <button
                          className="array-item-remove"
                          onClick={() => removeOut(pin.id)}
                          title="Remove output"
                        >
                          &times;
                        </button>
                      </div>
                      <div className="schema-field-bottom">
                        <select
                          className="property-select schema-field-type"
                          value={pin.type}
                          onChange={(e) =>
                            updateOut(pin.id, { type: e.target.value as DataPinType })
                          }
                        >
                          {DATA_PIN_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="io-pin-default">
                        {isInputPinConnected(pin.id) ? (
                          <span className="property-hint">Provided by connected pin.</span>
                        ) : (
                          renderDefaultEditor(pin)
                        )}
                      </div>
                      <input
                        className="property-input schema-field-desc"
                        value={pin.description ?? ''}
                        placeholder="Description (optional)"
                        onChange={(e) => updateOut(pin.id, { description: e.target.value })}
                      />
                    </div>
                  ))}
                  <button className="array-add-button" onClick={addOut}>
                    + Add Output
                  </button>
                </div>
                <span className="property-hint">
                  These pins are exposed as the workflow result (and to parent subflows).
                </span>
              </>
            );
          })()}
        </div>
      )}

      {/* String literal value */}
      {data.nodeType === 'literal_string' && (
        <div className="property-section">
          <label className="property-label">Value</label>
          <textarea
            className="property-input property-textarea"
            value={String(data.literalValue ?? '')}
            onChange={(e) =>
              updateNodeData(node.id, { literalValue: e.target.value })
            }
            placeholder="Enter text value..."
            rows={4}
          />
        </div>
      )}

      {/* Number literal value */}
      {data.nodeType === 'literal_number' && (
        <div className="property-section">
          <label className="property-label">Value</label>
          <input
            type="number"
            className="property-input"
            value={Number(data.literalValue ?? 0)}
            onChange={(e) =>
              updateNodeData(node.id, {
                literalValue: parseFloat(e.target.value) || 0,
              })
            }
            step="any"
          />
        </div>
      )}

      {/* Boolean literal value */}
      {data.nodeType === 'literal_boolean' && (
        <div className="property-section">
          <label className="property-label">Value</label>
          <label className="toggle-container">
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={Boolean(data.literalValue)}
              onChange={(e) =>
                updateNodeData(node.id, { literalValue: e.target.checked })
              }
            />
            <span className="toggle-label">
              {data.literalValue ? 'True' : 'False'}
            </span>
          </label>
        </div>
      )}

      {/* JSON literal value */}
      {data.nodeType === 'literal_json' && (
        (() => {
          const isAssertionLiteral =
            Array.isArray(data.outputs) && data.outputs.some((p) => p.type === 'assertion');
          if (!isAssertionLiteral) {
            return (
              <JsonValueEditor
                label="Fields (Object)"
                rootKind="object"
                value={data.literalValue ?? {}}
                onChange={(next) => updateNodeData(node.id, { literalValue: next })}
              />
            );
          }

          const raw = data.literalValue;
          const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};
          const subject = typeof obj.subject === 'string' ? obj.subject : '';
          const predicate = typeof obj.predicate === 'string' ? obj.predicate : '';
          const objectValue = typeof obj.object === 'string' ? obj.object : '';

          const predicates = semanticsQuery.data && Array.isArray(semanticsQuery.data.predicates) ? semanticsQuery.data.predicates : [];
          const options = predicates
            .filter((p) => p && typeof p.id === 'string' && p.id.trim())
            .map((p) => ({
              id: p.id.trim(),
              label: typeof p.label === 'string' && p.label.trim() ? `${p.id.trim()} — ${p.label.trim()}` : p.id.trim(),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

          const setField = (key: string, value: unknown) => {
            updateNodeData(node.id, { literalValue: { ...(obj as any), [key]: value } });
          };

          return (
            <div className="property-section">
              <label className="property-label">Assertion</label>
              <div className="property-group">
                <label className="property-sublabel">subject</label>
                <input
                  type="text"
                  className="property-input"
                  value={subject}
                  onChange={(e) => setField('subject', e.target.value)}
                  placeholder="ex:person-john-smith"
                />
                <span className="property-hint">Use CURIEs when possible; mint new entities as ex:{'{kind}-{kebab-case}'}.</span>
              </div>
              <div className="property-group">
                <label className="property-sublabel">predicate</label>
                <select
                  className="property-select"
                  value={predicate}
                  onChange={(e) => setField('predicate', e.target.value)}
                  disabled={semanticsQuery.isLoading || !!semanticsQuery.error}
                >
                  <option value="">
                    {semanticsQuery.isLoading
                      ? 'Loading semantics…'
                      : semanticsQuery.error
                      ? 'Failed to load semantics'
                      : 'Select predicate…'}
                  </option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {semanticsQuery.error && (
                  <span className="property-hint" style={{ color: '#e74c3c' }}>
                    {(semanticsQuery.error as any)?.message || String(semanticsQuery.error)}
                  </span>
                )}
              </div>
              <div className="property-group">
                <label className="property-sublabel">object</label>
                <input
                  type="text"
                  className="property-input"
                  value={objectValue}
                  onChange={(e) => setField('object', e.target.value)}
                  placeholder="schema:Person | literal string | URL"
                />
              </div>
              <JsonValueEditor
                label="Advanced (raw object)"
                rootKind="object"
                value={obj}
                onChange={(next) => updateNodeData(node.id, { literalValue: next })}
              />
            </div>
          );
        })()
      )}

      {/* JSON Schema editor */}
      {data.nodeType === 'json_schema' && (
        <JsonSchemaNodeEditor
          nodeId={node.id}
          schema={data.literalValue}
          onChange={(nextSchema) => updateNodeData(node.id, { literalValue: nextSchema })}
        />
      )}

      {/* Array literal value - item-based editor */}
      {data.nodeType === 'literal_array' && (
        <JsonValueEditor
          label="Items"
          rootKind="array"
          value={data.literalValue ?? []}
          onChange={(next) => updateNodeData(node.id, { literalValue: next })}
        />
      )}

      {/* Ask User effect properties */}
      {data.nodeType === 'ask_user' && (
        <div className="property-section">
          <label className="property-label">User Prompt Settings</label>
          <label className="toggle-container">
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={data.effectConfig?.allowFreeText ?? true}
              onChange={(e) =>
                updateNodeData(node.id, {
                  effectConfig: {
                    ...data.effectConfig,
                    allowFreeText: e.target.checked,
                  },
                })
              }
            />
            <span className="toggle-label">Allow free text response</span>
          </label>
          <span className="property-hint">
            If disabled, user must choose from provided choices
          </span>
        </div>
      )}

      {/* LLM Call effect properties */}
      {data.nodeType === 'llm_call' && (
        <div className="property-section">
          <label className="property-label">LLM Configuration</label>
          <div className="property-group">
            <label className="property-sublabel">Provider</label>
            {providerPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.effectConfig?.provider || ''}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    effectConfig: {
                      ...data.effectConfig,
                      provider: e.target.value || undefined,
                      model: undefined, // Reset model when provider changes
                    },
                  })
                }
                disabled={loadingProviders}
              >
                <option value="">
                  {loadingProviders ? 'Loading...' : 'Select provider...'}
                </option>
                {providers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="property-group">
            <label className="property-sublabel">Model</label>
            {modelPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.effectConfig?.model || ''}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    effectConfig: {
                      ...data.effectConfig,
                      model: e.target.value || undefined,
                    },
                  })
                }
                disabled={!data.effectConfig?.provider || loadingModels}
              >
                <option value="">
                  {loadingModels ? 'Loading...' : 'Select model...'}
                </option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="property-group">
            <label className="property-sublabel">Temperature</label>
            {temperaturePinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <input
                type="number"
                className="property-input"
                value={data.effectConfig?.temperature ?? 0.7}
                onChange={(e) => {
                  const parsed = parseFloat(e.target.value);
                  updateLlmCallEffectConfig({ temperature: Number.isFinite(parsed) ? parsed : 0.7 });
                }}
                min={0}
                max={2}
                step={0.1}
              />
            )}
            <span className="property-hint">0 = deterministic, 2 = creative</span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Seed</label>
            {seedPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <input
                type="number"
                className="property-input"
                value={data.effectConfig?.seed ?? -1}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  updateLlmCallEffectConfig({ seed: Number.isFinite(parsed) ? parsed : -1 });
                }}
                step={1}
              />
            )}
            <span className="property-hint">-1 = random/unset; {'>=0'} = deterministic (provider permitting)</span>
          </div>

          <div className="property-group">
            <label className="property-sublabel">Tools (optional)</label>
            {toolsPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <>
                <input
                  className="property-input"
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  placeholder={loadingTools ? 'Loading tools…' : 'Search tools…'}
                  disabled={loadingTools}
                />

                {selectedTools.length > 0 && (
                  <div className="tool-chips">
                    {selectedTools.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="tool-chip"
                        onClick={() => {
                          const next = selectedTools.filter((t) => t !== name);
                          updateLlmCallEffectConfig({ tools: next.length > 0 ? next : undefined });
                        }}
                        title="Remove tool"
                      >
                        {name}
                        <span className="tool-chip-x">×</span>
                      </button>
                    ))}
                  </div>
                )}

                {toolsError && (
                  <span className="property-error">
                    Failed to load tools: {toolsError}
                  </span>
                )}

                {!loadingTools && !toolsError && toolSpecs.length === 0 && (
                  <span className="property-hint">
                    No tools available from the runtime.
                  </span>
                )}

                {!loadingTools && toolSpecs.length > 0 && (
                  <div className="toolset-list">
                    {Object.entries(toolSpecsByToolset).map(([toolset, tools]) => {
                      const names = tools.map((t) => t.name);
                      const allSelected = names.length > 0 && names.every((n) => selectedTools.includes(n));

                      const toggleAll = () => {
                        const next = new Set(selectedTools);
                        if (!allSelected) {
                          for (const n of names) next.add(n);
                        } else {
                          for (const n of names) next.delete(n);
                        }
                        const asList = Array.from(next);
                        updateLlmCallEffectConfig({ tools: asList.length > 0 ? asList : undefined });
                      };

                      return (
                        <div key={toolset} className="toolset-group">
                          <div className="toolset-header">
                            <span className="toolset-title">{toolset}</span>
                            <button
                              type="button"
                              className="toolset-toggle"
                              onClick={toggleAll}
                              disabled={names.length === 0}
                              title={allSelected ? 'Deselect all' : 'Select all'}
                            >
                              {allSelected ? 'None' : 'All'}
                            </button>
                          </div>
                          <div className="checkbox-list tool-checkboxes">
                            {tools.map((t) => (
                              <label key={t.name} className="checkbox-item tool-item">
                                <input
                                  type="checkbox"
                                  checked={selectedTools.includes(t.name)}
                                  onChange={() => {
                                    const next = selectedTools.includes(t.name)
                                      ? selectedTools.filter((x) => x !== t.name)
                                      : [...selectedTools, t.name];
                                    updateLlmCallEffectConfig({ tools: next.length > 0 ? next : undefined });
                                  }}
                                />
                                <span className="checkbox-label">{t.name}</span>
                                {t.description && <span className="tool-desc">{t.description}</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <span className="property-hint">
                  Selected tools are the only tools the model may request (tool calls are not executed automatically by this node).
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tool Calls effect properties */}
      {data.nodeType === 'tool_calls' && (
        <div className="property-section">
          <label className="property-label">Tool Execution</label>

          <div className="property-group">
            <label className="property-sublabel">Allowed Tools (optional)</label>
            {edges.some((e) => e.target === node.id && e.targetHandle === 'allowed_tools') ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <>
                <input
                  className="property-input"
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  placeholder={loadingTools ? 'Loading tools…' : 'Search tools…'}
                  disabled={loadingTools}
                />

                {selectedTools.length > 0 && (
                  <div className="tool-chips">
                    {selectedTools.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="tool-chip"
                        onClick={() => {
                          const next = selectedTools.filter((t) => t !== name);
                          updateNodeData(node.id, {
                            effectConfig: {
                              ...(data.effectConfig || {}),
                              allowed_tools: next.length > 0 ? next : undefined,
                            },
                          });
                        }}
                        title="Remove tool"
                      >
                        {name}
                        <span className="tool-chip-x">×</span>
                      </button>
                    ))}
                  </div>
                )}

                {!loadingTools && !toolsError && toolSpecs.length > 0 && (
                  <div className="toolset-list">
                    {Object.entries(toolSpecsByToolset).map(([toolset, tools]) => {
                      const names = tools.map((t) => t.name);
                      const allSelected = names.length > 0 && names.every((n) => selectedTools.includes(n));

                      const toggleAll = () => {
                        const next = new Set(selectedTools);
                        if (!allSelected) {
                          for (const n of names) next.add(n);
                        } else {
                          for (const n of names) next.delete(n);
                        }
                        const asList = Array.from(next);
                        updateNodeData(node.id, {
                          effectConfig: {
                            ...(data.effectConfig || {}),
                            allowed_tools: asList.length > 0 ? asList : undefined,
                          },
                        });
                      };

                      return (
                        <div key={toolset} className="toolset-group">
                          <div className="toolset-header">
                            <span className="toolset-title">{toolset}</span>
                            <button
                              type="button"
                              className="toolset-toggle"
                              onClick={toggleAll}
                              disabled={names.length === 0}
                              title={allSelected ? 'Deselect all' : 'Select all'}
                            >
                              {allSelected ? 'None' : 'All'}
                            </button>
                          </div>
                          <div className="checkbox-list tool-checkboxes">
                            {tools.map((t) => (
                              <label key={t.name} className="checkbox-item tool-item">
                                <input
                                  type="checkbox"
                                  checked={selectedTools.includes(t.name)}
                                  onChange={() => {
                                    const next = selectedTools.includes(t.name)
                                      ? selectedTools.filter((x) => x !== t.name)
                                      : [...selectedTools, t.name];
                                    updateNodeData(node.id, {
                                      effectConfig: {
                                        ...(data.effectConfig || {}),
                                        allowed_tools: next.length > 0 ? next : undefined,
                                      },
                                    });
                                  }}
                                />
                                <span className="checkbox-label">{t.name}</span>
                                {t.description && <span className="tool-desc">{t.description}</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <span className="property-hint">
                  If set, only these tools may be executed. If unset, all runtime tools are allowed.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Models Catalog (catalog helper) */}
      {data.nodeType === 'provider_models' && (
        <ProviderModelsPanel node={node} edges={edges} updateNodeData={updateNodeData} />
      )}

      {/* Wait Until (Delay) effect properties */}
      {data.nodeType === 'wait_until' && (
        <div className="property-section">
          <label className="property-label">Duration Type</label>
          <select
            className="property-select"
            value={data.effectConfig?.durationType ?? 'seconds'}
            onChange={(e) =>
              updateNodeData(node.id, {
                effectConfig: {
                  ...data.effectConfig,
                  durationType: e.target.value as 'seconds' | 'minutes' | 'hours' | 'timestamp',
                },
              })
            }
          >
            <option value="seconds">Seconds</option>
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="timestamp">ISO Timestamp</option>
          </select>
          <span className="property-hint">
            How to interpret the duration input
          </span>
        </div>
      )}

      {/* Emit Event effect properties */}
      {data.nodeType === 'emit_event' && (
        <div className="property-section">
          <label className="property-label">Event Emission</label>

          <div className="property-group">
            <label className="property-sublabel">Name</label>
            {emitEventNamePinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <>
                {availableEventNames.length > 0 ? (
                  <datalist id="af-custom-event-names">
                    {availableEventNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                ) : null}
                <input
                  type="text"
                  className="property-input"
                  value={
                    (typeof data.pinDefaults?.name === 'string' && data.pinDefaults.name.trim()
                      ? data.pinDefaults.name
                      : data.effectConfig?.name) || ''
                  }
                  list={availableEventNames.length > 0 ? 'af-custom-event-names' : undefined}
                  onChange={(e) =>
                    updateNodeData(node.id, (() => {
                      const nextRaw = e.target.value;
                      const nextName = nextRaw.trim();

                      const prevDefaults = data.pinDefaults || {};
                      const nextDefaults = { ...prevDefaults };
                      if (!nextName) {
                        delete nextDefaults.name;
                      } else {
                        nextDefaults.name = nextName;
                      }

                      const prevCfg = data.effectConfig || {};
                      const nextCfg = { ...prevCfg, name: nextName || undefined };
                      return {
                        pinDefaults: nextDefaults,
                        effectConfig: nextCfg,
                      };
                    })())
                  }
                  placeholder={availableEventNames.length > 0 ? 'Type or pick a name…' : 'e.g., my_event'}
                />
              </>
            )}
          </div>

          <div className="property-group">
            <label className="property-sublabel">Scope</label>
            {emitEventScopePinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <select
                className="property-select"
                value={data.effectConfig?.scope ?? 'session'}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    effectConfig: {
                      ...data.effectConfig,
                      scope: e.target.value as 'session' | 'workflow' | 'run' | 'global',
                    },
                  })
                }
              >
                <option value="session">Session (recommended)</option>
                <option value="workflow">Workflow</option>
                <option value="run">Run</option>
                <option value="global">Global</option>
              </select>
            )}
          </div>

          <div className="property-group">
            <label className="property-sublabel">Target Session ID (optional)</label>
            {emitEventSessionPinConnected ? (
              <span className="property-hint">Provided by connected pin.</span>
            ) : (
              <input
                type="text"
                className="property-input"
                value={data.effectConfig?.sessionId || ''}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    effectConfig: {
                      ...data.effectConfig,
                      sessionId: e.target.value || undefined,
                    },
                  })
                }
                placeholder="Leave empty for current session"
              />
            )}
            <span className="property-hint">
              Set to the target workflow instance (root run id) to signal another session.
            </span>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="property-section">
        <div className="property-actions">
          <button type="button" onClick={handleDuplicateNode} title="Duplicate selected node(s) (Ctrl/Cmd+Shift+V)">
            Duplicate
          </button>
          <button type="button" onClick={handleCopyNode} title="Copy selected node(s) (Ctrl/Cmd+C)">
            Copy
          </button>
        </div>
        <span className="property-hint">
          Paste on canvas with Ctrl/Cmd+V. Duplicate shortcut: Ctrl/Cmd+Shift+V.
        </span>
      </div>

      {/* Delete button */}
      <div className="property-section danger">
        <button className="delete-button" onClick={handleDelete}>
          Delete Node
        </button>
      </div>
    </div>
  );
}

export default PropertiesPanel;
