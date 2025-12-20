/**
 * Properties panel for editing selected node configuration.
 */

import React, { useCallback, useEffect, useState, useRef } from 'react';
import type { Node } from 'reactflow';
import type { FlowNodeData, ProviderInfo } from '../types/flow';
import { useFlowStore } from '../hooks/useFlow';

interface PropertiesPanelProps {
  node: Node<FlowNodeData> | null;
}

export function PropertiesPanel({ node }: PropertiesPanelProps) {
  const { updateNodeData, deleteNode, flowId, nodes, edges } = useFlowStore();

  // Provider/model state for agent nodes
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  // Saved flows list (for subflow nodes)
  const [savedFlows, setSavedFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingFlows, setLoadingFlows] = useState(false);

  // Track last fetched provider to prevent duplicate fetches
  const lastFetchedProvider = useRef<string | null>(null);

  // Fetch available providers on mount
  useEffect(() => {
    setLoadingProviders(true);
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => setProviders(data))
      .catch((err) => console.error('Failed to fetch providers:', err))
      .finally(() => setLoadingProviders(false));
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

            if (sourceNode?.data.nodeType === 'literal_json') {
              sample = sourceNode.data.literalValue;
            } else if (sourceNode?.data.nodeType === 'literal_array') {
              sample = sourceNode.data.literalValue;
            } else if (sourceNode?.data.nodeType === 'agent') {
              // Best-effort schema for Agent result payload.
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

            const available = sample ? flattenPaths(sample).sort() : [];
            const selected = data.breakConfig?.selectedPaths || [];

            const togglePath = (path: string) => {
              const nextSelected = selected.includes(path)
                ? selected.filter((p) => p !== path)
                : [...selected, path];

              const nextOutputs = nextSelected.map((p) => ({
                id: p,
                label: p.split('.').slice(-1)[0] || p,
                type: inferPinType(getByPath(sample, p)),
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
        </div>
      )}

      {/* Code-specific properties */}
      {data.nodeType === 'code' && (
        <div className="property-section">
          <label className="property-label">Function Name</label>
          <input
            type="text"
            className="property-input"
            value={data.functionName || 'transform'}
            onChange={(e) =>
              updateNodeData(node.id, { functionName: e.target.value })
            }
          />
          <span className="property-hint">
            Name of the function to call in your code
          </span>
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
