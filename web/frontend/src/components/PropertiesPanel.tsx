/**
 * Properties panel for editing selected node configuration.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import type { Node } from 'reactflow';
import type { FlowNodeData, ProviderInfo, VisualFlow, Pin } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import { useFlowStore } from '../hooks/useFlow';
import { CodeEditorModal } from './CodeEditorModal';
import { extractFunctionBody, generatePythonTransformCode, sanitizePythonIdentifier } from '../utils/codegen';

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
  'array',
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
  const { updateNodeData, deleteNode, setEdges, flowId, nodes, edges } = useFlowStore();
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

  const [agentSchemaEnabled, setAgentSchemaEnabled] = useState(false);
  const [agentSchemaMode, setAgentSchemaMode] = useState<'fields' | 'json'>('fields');
  const [agentSchemaFields, setAgentSchemaFields] = useState<AgentSchemaField[]>([]);
  const [agentSchemaJsonDraft, setAgentSchemaJsonDraft] = useState('');
  const [agentSchemaJsonDirty, setAgentSchemaJsonDirty] = useState(false);
  const [agentSchemaJsonError, setAgentSchemaJsonError] = useState<string | null>(null);

  // Track last fetched provider to prevent duplicate fetches
  const lastFetchedProvider = useRef<string | null>(null);

  useEffect(() => {
    setShowCodeEditor(false);
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

  // Fetch models when provider changes (for both agent and llm_call nodes)
  const selectedProvider = node?.data.agentConfig?.provider || node?.data.effectConfig?.provider;
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
    if (!subflowId || (flowId && subflowId === flowId)) return;

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

  const updateAgentConfig = (patch: Partial<NonNullable<FlowNodeData['agentConfig']>>) => {
    updateNodeData(node.id, {
      agentConfig: {
        ...(data.agentConfig || {}),
        ...patch,
      },
    });
  };

  const selectedTools = Array.isArray(data.agentConfig?.tools)
    ? data.agentConfig?.tools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];

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

            if (sourceNode?.data.nodeType === 'literal_json') {
              sample = sourceNode.data.literalValue;
            } else if (sourceNode?.data.nodeType === 'literal_array') {
              sample = sourceNode.data.literalValue;
            } else if (sourceNode?.data.nodeType === 'agent') {
              const outputSchema = sourceNode.data.agentConfig?.outputSchema;
              if (outputSchema?.enabled && outputSchema.jsonSchema && typeof outputSchema.jsonSchema === 'object') {
                schema = outputSchema.jsonSchema;
              } else {
                // Best-effort schema for legacy Agent result payload.
                sample = {
                  result: '',
                  task: '',
                  context: {},
                  success: true,
                  provider: '',
                  model: '',
                  usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                  },
                };
              }
            }

            const available = schema
              ? flattenSchemaPaths(schema).sort()
              : sample
                ? flattenPaths(sample).sort()
                : [];
            const selected = data.breakConfig?.selectedPaths || [];

            const togglePath = (path: string) => {
              const nextSelected = selected.includes(path)
                ? selected.filter((p) => p !== path)
                : [...selected, path];

              const nextOutputs = nextSelected.map((p) => ({
                id: p,
                label: p.split('.').slice(-1)[0] || p,
                type: schema
                  ? inferPinTypeFromSchema(getSchemaByPath(schema, p))
                  : inferPinType(getByPath(sample, p)),
              }));

              updateNodeData(node.id, {
                breakConfig: { ...data.breakConfig, selectedPaths: nextSelected },
                outputs: nextOutputs,
              });
            };

            if (!inputEdge) {
              return (
                <span className="property-hint">
                  Connect an object to the <code>object</code> input to discover fields.
                </span>
              );
            }

            if (available.length === 0) {
              return (
                <span className="property-hint">
                  No fields discovered for this input.
                </span>
              );
            }

            return (
              <div className="property-group">
                <div className="checkbox-list">
                  {available.map((path) => (
                    <label key={path} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selected.includes(path)}
                        onChange={() => togglePath(path)}
                      />
                      <span className="checkbox-label">{path}</span>
                    </label>
                  ))}
                </div>
                <span className="property-hint">
                  Select fields to expose as output pins.
                </span>
              </div>
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
          </div>
          <div className="property-group">
            <label className="property-sublabel">Model</label>
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
                  When enabled, the Agent&apos;s <code>result</code> output is a JSON object matching this schema.
                </span>
              </>
            )}

            {!agentSchemaEnabled && (
              <span className="property-hint">
                Disabled: the Agent returns a free-form result object (still on the <code>result</code> pin).
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
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: currentBody,
                code: generatePythonTransformCode(nextPins, currentBody),
                functionName: 'transform',
              });

              setIoPinNameDrafts((prev) => {
                const { [pinId]: _removed, ...rest } = prev;
                return nextId === pinId ? rest : { ...rest, [nextId]: nextId };
              });
            };

            const updateParam = (pinId: string, patch: Partial<typeof params[number]>) => {
              const nextPins = data.inputs.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: currentBody,
                code: generatePythonTransformCode(nextPins, currentBody),
                functionName: 'transform',
              });
            };

            const addParam = () => {
              let n = 1;
              while (used.has(`param${n}`)) n++;
              const id = `param${n}`;
              const nextPins = [...data.inputs, { id, label: id, type: 'string' as DataPinType }];
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: currentBody,
                code: generatePythonTransformCode(nextPins, currentBody),
                functionName: 'transform',
              });
            };

            const removeParam = (pinId: string) => {
              const nextPins = data.inputs.filter((p) => p.id !== pinId);
              updateNodeData(node.id, {
                inputs: nextPins,
                codeBody: currentBody,
                code: generatePythonTransformCode(nextPins, currentBody),
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
                  params={params.map((p) => p.id)}
                  onClose={() => setShowCodeEditor(false)}
                  onSave={(nextBody) => {
                    updateNodeData(node.id, {
                      codeBody: nextBody,
                      code: generatePythonTransformCode(data.inputs, nextBody),
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
              {savedFlows
                .filter((f) => !flowId || f.id !== flowId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.id})
                  </option>
                ))}
            </select>
            <span className="property-hint">
              Select an existing saved flow to execute as a subworkflow
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
              placeholder="e.g., */5 * * * * (every 5 min)"
            />
            <span className="property-hint">
              Cron expression or interval (e.g., "30s", "5m", "1h")
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
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        placeholder="name"
                      />
                      <select
                        className="property-select io-pin-type"
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
                <div className="array-editor">
                  {outs.map((pin) => (
                    <div key={pin.id} className="array-item">
                      <input
                        type="text"
                        className="property-input array-item-input io-pin-name"
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
                        placeholder="name"
                      />
                      <select
                        className="property-select io-pin-type"
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
                      <button
                        className="array-item-remove"
                        onClick={() => removeOut(pin.id)}
                        title="Remove output"
                      >
                        &times;
                      </button>
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
        <div className="property-section">
          <label className="property-label">Fields (Object)</label>

          {(() => {
            const current = data.literalValue;
            const isObject =
              current !== null &&
              typeof current === 'object' &&
              !Array.isArray(current);

            const obj: Record<string, unknown> = isObject
              ? (current as Record<string, unknown>)
              : {};

            const valueType = (value: unknown) => {
              if (Array.isArray(value)) return 'array';
              if (value === null) return 'null';
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
                  return 'string';
              }
            };

            const setKey = (oldKey: string, newKeyRaw: string): boolean => {
              const newKey = newKeyRaw.trim();
              if (!newKey || newKey === oldKey) return false;
              if (Object.prototype.hasOwnProperty.call(obj, newKey)) return false;
              const next: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(obj)) {
                next[k === oldKey ? newKey : k] = v;
              }
              updateNodeData(node.id, { literalValue: next });
              return true;
            };

            const setValue = (key: string, value: unknown) => {
              updateNodeData(node.id, { literalValue: { ...obj, [key]: value } });
            };

            const removeKey = (key: string) => {
              const next: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(obj)) {
                if (k !== key) next[k] = v;
              }
              updateNodeData(node.id, { literalValue: next });
            };

            const addKey = () => {
              let i = 1;
              let key = `field_${i}`;
              while (Object.prototype.hasOwnProperty.call(obj, key)) {
                i += 1;
                key = `field_${i}`;
              }
              updateNodeData(node.id, { literalValue: { ...obj, [key]: '' } });
            };

            const setType = (key: string, t: string) => {
              if (t === 'string') return setValue(key, '');
              if (t === 'number') return setValue(key, 0);
              if (t === 'boolean') return setValue(key, false);
              if (t === 'null') return setValue(key, null);
              if (t === 'array') return setValue(key, []);
              if (t === 'object') return setValue(key, {});
            };

            return (
              <>
                {!isObject && (
                  <span className="property-hint">
                    Visual editing supports JSON objects. Use Raw JSON below for arrays or advanced values.
                  </span>
                )}

                <div className="object-editor">
                  {Object.entries(obj).map(([key, value]) => {
                    const t = valueType(value);
                    return (
                      <div key={key} className="object-field">
                        <input
                          type="text"
                          className="property-input object-key"
                          defaultValue={key}
                          onBlur={(e) => {
                            const ok = setKey(key, e.target.value);
                            if (!ok) {
                              e.currentTarget.value = key;
                            }
                          }}
                          placeholder="key"
                        />
                        <select
                          className="property-select object-type"
                          value={t}
                          onChange={(e) => setType(key, e.target.value)}
                        >
                          <option value="string">string</option>
                          <option value="number">number</option>
                          <option value="boolean">boolean</option>
                          <option value="null">null</option>
                          <option value="object">object</option>
                          <option value="array">array</option>
                        </select>

                        {t === 'string' && (
                          <input
                            type="text"
                            className="property-input object-value"
                            value={String(value ?? '')}
                            onChange={(e) => setValue(key, e.target.value)}
                            placeholder="value"
                          />
                        )}

                        {t === 'number' && (
                          <input
                            type="number"
                            className="property-input object-value"
                            value={typeof value === 'number' ? value : Number(value ?? 0)}
                            onChange={(e) => setValue(key, Number(e.target.value))}
                            step="any"
                          />
                        )}

                        {t === 'boolean' && (
                          <label className="toggle-container object-value">
                            <input
                              type="checkbox"
                              className="toggle-checkbox"
                              checked={Boolean(value)}
                              onChange={(e) => setValue(key, e.target.checked)}
                            />
                            <span className="toggle-label">{value ? 'True' : 'False'}</span>
                          </label>
                        )}

                        {t === 'null' && (
                          <div className="object-null object-value">null</div>
                        )}

                        {(t === 'object' || t === 'array') && (
                          <textarea
                            className="property-input property-textarea code object-value"
                            value={JSON.stringify(value, null, 2)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value);
                                setValue(key, parsed);
                              } catch {
                                // keep editing; don't update until valid
                              }
                            }}
                            rows={3}
                          />
                        )}

                        <button
                          className="array-item-remove"
                          onClick={() => removeKey(key)}
                          title="Remove field"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}

                  <button className="array-add-button" onClick={addKey}>
                    + Add Field
                  </button>
                </div>

                <details className="raw-json-details">
                  <summary>Raw JSON (advanced)</summary>
                  <textarea
                    className="property-input property-textarea code"
                    value={
                      typeof data.literalValue === 'object'
                        ? JSON.stringify(data.literalValue, null, 2)
                        : String(data.literalValue ?? '{}')
                    }
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        updateNodeData(node.id, { literalValue: parsed });
                      } catch {
                        // Keep invalid JSON in the textarea but don't update state.
                      }
                    }}
                    placeholder="{}"
                    rows={6}
                  />
                </details>
              </>
            );
          })()}
        </div>
      )}

      {/* Array literal value - item-based editor */}
      {data.nodeType === 'literal_array' && (
        <div className="property-section">
          <label className="property-label">Items</label>
          <div className="array-editor">
            {(Array.isArray(data.literalValue) ? data.literalValue : []).map(
              (item: string, index: number) => (
                <div key={index} className="array-item">
                  <input
                    type="text"
                    className="property-input array-item-input"
                    value={String(item)}
                    onChange={(e) => {
                      const newArray = [...(data.literalValue as string[])];
                      newArray[index] = e.target.value;
                      updateNodeData(node.id, { literalValue: newArray });
                    }}
                    placeholder={`Item ${index + 1}`}
                  />
                  <button
                    className="array-item-remove"
                    onClick={() => {
                      const newArray = (data.literalValue as string[]).filter(
                        (_, i) => i !== index
                      );
                      updateNodeData(node.id, { literalValue: newArray });
                    }}
                    title="Remove item"
                  >
                    &times;
                  </button>
                </div>
              )
            )}
            <button
              className="array-add-button"
              onClick={() => {
                const currentArray = Array.isArray(data.literalValue)
                  ? data.literalValue
                  : [];
                updateNodeData(node.id, {
                  literalValue: [...currentArray, ''],
                });
              }}
            >
              + Add Item
            </button>
          </div>
          <span className="property-hint">
            {(Array.isArray(data.literalValue) ? data.literalValue : []).length} items
          </span>
        </div>
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
          </div>
          <div className="property-group">
            <label className="property-sublabel">Model</label>
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
          </div>
          <div className="property-group">
            <label className="property-sublabel">Temperature</label>
            <input
              type="number"
              className="property-input"
              value={data.effectConfig?.temperature ?? 0.7}
              onChange={(e) =>
                updateNodeData(node.id, {
                  effectConfig: {
                    ...data.effectConfig,
                    temperature: parseFloat(e.target.value) || 0.7,
                  },
                })
              }
              min={0}
              max={2}
              step={0.1}
            />
            <span className="property-hint">0 = deterministic, 2 = creative</span>
          </div>
        </div>
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
