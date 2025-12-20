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
  const { updateNodeData, deleteNode } = useFlowStore();

  // Provider/model state for agent nodes
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

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
          <label className="property-label">Value (JSON)</label>
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
                // Keep invalid JSON in the textarea but don't update state
                // User will see validation error naturally (parse fails silently)
              }
            }}
            placeholder="{}"
            rows={6}
          />
          <span className="property-hint">Enter valid JSON object or array</span>
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
