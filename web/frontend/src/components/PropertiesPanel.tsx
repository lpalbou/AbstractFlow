/**
 * Properties panel for editing selected node configuration.
 */

import React, { useCallback, useEffect, useState } from 'react';
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

  // Fetch available providers on mount
  useEffect(() => {
    setLoadingProviders(true);
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => setProviders(data))
      .catch((err) => console.error('Failed to fetch providers:', err))
      .finally(() => setLoadingProviders(false));
  }, []);

  // Fetch models when provider changes
  const selectedProvider = node?.data.agentConfig?.provider;
  useEffect(() => {
    if (selectedProvider) {
      setLoadingModels(true);
      setModels([]);
      fetch(`/api/providers/${selectedProvider}/models`)
        .then((res) => res.json())
        .then((data) => setModels(data))
        .catch((err) => console.error('Failed to fetch models:', err))
        .finally(() => setLoadingModels(false));
    } else {
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
                  {p.display_name} ({p.model_count} models)
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
