import { useMemo, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types/flow';
import { useModels, useProviders } from '../hooks/useProviders';

export interface ProviderModelsPanelProps {
  node: Node<FlowNodeData>;
  edges: Edge[];
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
}

export function ProviderModelsPanel({ node, edges, updateNodeData }: ProviderModelsPanelProps) {
  const data = node.data;
  const cfg = data.providerModelsConfig || {};
  const provider = (cfg.provider || '').trim();
  const allowedModels = Array.isArray(cfg.allowedModels) ? cfg.allowedModels : [];

  const providerConnected = useMemo(
    () => edges.some((e) => e.target === node.id && e.targetHandle === 'provider'),
    [edges, node.id]
  );

  const providersQuery = useProviders(!providerConnected);
  const modelsQuery = useModels(provider, Boolean(provider) && !providerConnected);

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];

  const [search, setSearch] = useState('');
  const filteredModels = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return models;
    return models.filter((m) => m.toLowerCase().includes(term));
  }, [models, search]);

  const setProvider = (next: string) => {
    updateNodeData(node.id, {
      providerModelsConfig: {
        ...cfg,
        provider: next || undefined,
        // Reset selection when provider changes (avoids stale names from another provider).
        allowedModels: [],
      },
    });
  };

  const setAllowedModels = (next: string[]) => {
    updateNodeData(node.id, {
      providerModelsConfig: {
        ...cfg,
        allowedModels: next,
      },
    });
  };

  const toggleModel = (m: string) => {
    const exists = allowedModels.includes(m);
    const next = exists ? allowedModels.filter((x) => x !== m) : [...allowedModels, m];
    setAllowedModels(next);
  };

  const selectAllVisible = () => {
    // Select all currently visible (respects search).
    const set = new Set<string>(allowedModels);
    for (const m of filteredModels) set.add(m);
    setAllowedModels(Array.from(set));
  };

  const clearAll = () => setAllowedModels([]);

  return (
    <div className="property-section">
      <label className="property-label">Models Catalog</label>

      <div className="property-group">
        <label className="property-sublabel">Provider</label>
        {providerConnected ? (
          <div className="property-hint">Provided by connected pin.</div>
        ) : (
          <select
            className="property-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={providersQuery.isLoading}
          >
            <option value="">{providersQuery.isLoading ? 'Loading…' : 'Select provider…'}</option>
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.display_name || p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="property-group">
        <label className="property-sublabel">Allowed models (optional)</label>
        {providerConnected ? (
          <div className="property-hint">
            Provider is provided by a connected pin. Disconnect it to browse and select models here.
          </div>
        ) : !provider ? (
          <div className="property-hint">Pick a provider to browse models.</div>
        ) : (
          <>
            <input
              type="text"
              className="property-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models…"
            />

            <div className="property-actions-row">
              <button type="button" className="modal-button" onClick={selectAllVisible} disabled={modelsQuery.isLoading || filteredModels.length === 0}>
                Select all
              </button>
              <button type="button" className="modal-button" onClick={clearAll} disabled={allowedModels.length === 0}>
                Clear
              </button>
              <span className="property-hint" style={{ marginLeft: 'auto' }}>
                {allowedModels.length ? `${allowedModels.length} selected` : 'All models allowed'}
              </span>
            </div>

            <div className="property-checkbox-list">
              {modelsQuery.isLoading ? (
                <div className="property-hint">Loading models…</div>
              ) : filteredModels.length === 0 ? (
                <div className="property-hint">No models match.</div>
              ) : (
                filteredModels.map((m) => (
                  <label key={m} className="toggle-container">
                    <input
                      type="checkbox"
                      className="toggle-checkbox"
                      checked={allowedModels.includes(m)}
                      onChange={() => toggleModel(m)}
                    />
                    <span className="toggle-label">{m}</span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ProviderModelsPanel;



