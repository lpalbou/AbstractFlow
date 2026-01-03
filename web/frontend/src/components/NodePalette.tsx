/**
 * Node palette component with categorized draggable nodes.
 */

import { useState, useCallback, DragEvent } from 'react';
import { NODE_CATEGORIES, NodeTemplate } from '../types/nodes';
import { AfTooltip } from './AfTooltip';

export function NodePalette() {
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({
    events: true,
    core: true,
  });

  const [searchTerm, setSearchTerm] = useState('');

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, template: NodeTemplate) => {
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
      if (!searchTerm) return nodes;
      const term = searchTerm.toLowerCase();
      return nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(term) ||
          n.type.toLowerCase().includes(term)
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
                  {filteredNodes.map((template) => (
                    <AfTooltip key={template.type} content={template.description} delayMs={2000} block>
                      <div
                        className="palette-node"
                        draggable
                        onDragStart={(e) => onDragStart(e, template)}
                      >
                        <span
                          className="node-icon"
                          style={{ color: template.headerColor }}
                          dangerouslySetInnerHTML={{ __html: template.icon }}
                        />
                        <span className="node-label">{template.label}</span>
                      </div>
                    </AfTooltip>
                  ))}
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
