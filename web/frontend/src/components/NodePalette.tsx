/**
 * Node palette component with categorized draggable nodes.
 */

import { useState, useCallback, useMemo, DragEvent } from 'react';
import { NODE_CATEGORIES, NodeTemplate } from '../types/nodes';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../hooks/useGatewayCapabilities';
import {
  gatewayAuthoringCapabilityStatus,
  getGatewayFlowEditorReadiness,
  type GatewayAuthoringCapabilityStatus,
} from '../utils/gatewayClient';
import { AfTooltip } from './AfTooltip';

export function NodePalette() {
  const gatewayCapabilitiesQuery = useGatewayCapabilities(true);
  const gatewayContracts = gatewayContractsFromCapabilities(gatewayCapabilitiesQuery.data);
  const gatewayReadiness = useMemo(() => getGatewayFlowEditorReadiness(gatewayContracts), [gatewayContracts]);
  const gatewayCapabilityKnown = Boolean(gatewayContracts && !gatewayCapabilitiesQuery.isError);
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    events: true,
    core: true,
    media: true,
  });

  const [searchTerm, setSearchTerm] = useState('');

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, template: NodeTemplate, status: GatewayAuthoringCapabilityStatus | null) => {
      if (status && !status.available && !status.checking) {
        event.preventDefault();
        event.dataTransfer.effectAllowed = 'none';
        return;
      }
      event.dataTransfer.setData(
        'application/reactflow',
        JSON.stringify(template)
      );
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  // Filter nodes by search term
  const filterNodes = useCallback(
    (nodes: NodeTemplate[]) => {
      const visibleNodes = nodes.filter((n) => !n.hiddenInPalette);
      if (!searchTerm) return visibleNodes;
      const term = searchTerm.toLowerCase();
      return visibleNodes.filter(
        (n) =>
          n.label.toLowerCase().includes(term) ||
          n.type.toLowerCase().includes(term) ||
          n.description.toLowerCase().includes(term)
      );
    },
    [searchTerm]
  );

  return (
    <div className="node-palette">
      <h3 className="palette-title">Nodes</h3>

      {/* Search */}
      <div className="palette-search">
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Categories */}
      <div className="palette-categories">
        {Object.entries(NODE_CATEGORIES).map(([key, category]) => {
          const filteredNodes = filterNodes(category.nodes);
          if (searchTerm && filteredNodes.length === 0) return null;

          return (
            <div key={key} className="palette-category">
              <div
                className="category-header"
                onClick={() => toggleCategory(key)}
              >
                <span
                  className="category-icon"
                  dangerouslySetInnerHTML={{ __html: category.icon }}
                />
                <span className="category-label">{category.label}</span>
                <span className="category-toggle">
                  {expandedCategories[key] || searchTerm ? '▼' : '▶'}
                </span>
              </div>

              {(expandedCategories[key] || searchTerm) && (
                <div className="category-nodes">
                  {filteredNodes.map((template) => {
                    const status = gatewayAuthoringCapabilityStatus(gatewayReadiness, template.gatewayCapability, {
                      loading: gatewayCapabilitiesQuery.isLoading,
                      known: gatewayCapabilityKnown,
                    });
                    const disabled = Boolean(status && !status.available && !status.checking);
                    const tooltip = status && (disabled || status.checking) ? `${template.description}\n${status.reason}` : template.description;
                    return (
                      <AfTooltip key={`${template.type}:${template.label}`} content={tooltip} delayMs={2000} priority={0} block>
                        <div
                          className={`palette-node${disabled ? ' disabled' : ''}${status?.checking ? ' checking' : ''}`}
                          draggable={!disabled}
                          aria-disabled={disabled || undefined}
                          data-gateway-capability={template.gatewayCapability || undefined}
                          data-gateway-capability-status={
                            status ? (status.checking ? 'checking' : status.available ? 'available' : 'unavailable') : undefined
                          }
                          onDragStart={(e) => onDragStart(e, template, status)}
                        >
                          <span
                            className="node-icon"
                            style={{ color: template.headerColor }}
                            dangerouslySetInnerHTML={{ __html: template.icon }}
                          />
                          <span className="node-label">{template.label}</span>
                          {status && (status.checking || disabled) ? (
                            <span className={`palette-node-status ${status.checking ? 'checking' : 'unavailable'}`}>
                              {status.checking ? 'checking' : 'unavailable'}
                            </span>
                          ) : null}
                        </div>
                      </AfTooltip>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Help text */}
      <div className="palette-help">
        <p>Drag nodes to the canvas to add them to your flow.</p>
      </div>
    </div>
  );
}

export default NodePalette;
