/**
 * Node palette: searchable, sectioned, draggable node chips.
 *
 * Presentation layer only — NODE_CATEGORIES stays the semantic source of
 * truth (tests + assistant catalog read it). The palette regroups those
 * categories into ordered DISPLAY SECTIONS tuned for how workflows are
 * actually built: an always-visible Essentials strip (the ~8 nodes nearly
 * every flow uses), the high-frequency sections first, and the long tail
 * (text/math utilities) last. Chips render in a two-column grid so the full
 * catalog scans without a wall of scrolling; section expansion persists per
 * user in localStorage.
 */

import { useState, useCallback, useMemo, DragEvent } from 'react';
import { NODE_CATEGORIES, getNodeTemplate, NodeTemplate } from '../types/nodes';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../hooks/useGatewayCapabilities';
import {
  gatewayAuthoringCapabilityStatus,
  getGatewayFlowEditorReadiness,
  type GatewayAuthoringCapabilityStatus,
} from '../utils/gatewayClient';
import { AfTooltip } from './AfTooltip';

/** Ordered display sections; each pulls one or more semantic categories. */
const PALETTE_SECTIONS: { key: string; label: string; icon: string; categories: string[] }[] = [
  { key: 'core', label: 'Core', icon: '&#x26A1;', categories: ['core'] },
  { key: 'control', label: 'Control Flow', icon: '&#x1F500;', categories: ['control'] },
  { key: 'events', label: 'Events & Time', icon: '&#x1F514;', categories: ['events'] },
  { key: 'variables', label: 'Variables', icon: '&#x1F4E6;', categories: ['variables'] },
  { key: 'data', label: 'Data & Text', icon: '&#x1F6E0;', categories: ['data'] },
  { key: 'values', label: 'Values & Schema', icon: '&#x270F;', categories: ['literals', 'schema'] },
  { key: 'files', label: 'Files & Artifacts', icon: '&#x1F4C1;', categories: ['files', 'artifacts'] },
  { key: 'media', label: 'Media', icon: '&#x1F3A8;', categories: ['media'] },
  { key: 'memory', label: 'Memory', icon: '&#x1F4BE;', categories: ['memory'] },
  { key: 'entity', label: 'Entity Mind', icon: '&#x1F9E0;', categories: ['entity'] },
  { key: 'math', label: 'Math', icon: '&#x1F522;', categories: ['math'] },
];

/**
 * Every semantic category must be reachable from the palette: any category
 * key not claimed by a section above gets its own trailing section (a newly
 * added category shows up instead of silently vanishing).
 */
function sectionsCoveringAllCategories() {
  const claimed = new Set(PALETTE_SECTIONS.flatMap((s) => s.categories));
  const extras = Object.entries(NODE_CATEGORIES)
    .filter(([key]) => !claimed.has(key))
    .map(([key, category]) => ({ key, label: category.label, icon: category.icon, categories: [key] }));
  return [...PALETTE_SECTIONS, ...extras];
}

/** Curated quick-access strip: the nodes nearly every workflow reaches for. */
const ESSENTIAL_NODE_TYPES: Parameters<typeof getNodeTemplate>[0][] = [
  'on_flow_start',
  'on_flow_end',
  'agent',
  'llm_call',
  'code',
  'if',
  'for',
  'string_template',
];

const EXPANSION_STORAGE_KEY = 'abstractflow_palette_sections_v1';
const DEFAULT_EXPANDED: Record<string, boolean> = { core: true };

function loadExpansion(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANSION_STORAGE_KEY);
    if (!raw) return DEFAULT_EXPANDED;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : DEFAULT_EXPANDED;
  } catch {
    return DEFAULT_EXPANDED;
  }
}

function saveExpansion(state: Record<string, boolean>) {
  try {
    localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Persistence is a convenience; never break the palette over storage.
  }
}

export function NodePalette() {
  const gatewayCapabilitiesQuery = useGatewayCapabilities(true);
  const gatewayContracts = gatewayContractsFromCapabilities(gatewayCapabilitiesQuery.data);
  const gatewayReadiness = useMemo(() => getGatewayFlowEditorReadiness(gatewayContracts), [gatewayContracts]);
  const gatewayCapabilityKnown = Boolean(gatewayContracts && !gatewayCapabilitiesQuery.isError);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(loadExpansion);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveExpansion(next);
      return next;
    });
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

  const sections = useMemo(
    () =>
      sectionsCoveringAllCategories().map((section) => ({
        ...section,
        nodes: section.categories.flatMap((categoryKey) => NODE_CATEGORIES[categoryKey]?.nodes ?? []).filter(
          (n) => !n.hiddenInPalette
        ),
      })),
    []
  );

  const essentials = useMemo(
    () => ESSENTIAL_NODE_TYPES.map((type) => getNodeTemplate(type)).filter((t): t is NodeTemplate => Boolean(t)),
    []
  );

  const filterNodes = useCallback(
    (nodes: NodeTemplate[]) => {
      if (!searchTerm) return nodes;
      const term = searchTerm.toLowerCase();
      return nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(term) ||
          n.type.toLowerCase().includes(term) ||
          n.description.toLowerCase().includes(term)
      );
    },
    [searchTerm]
  );

  const renderChip = useCallback(
    (template: NodeTemplate) => {
      const status = gatewayAuthoringCapabilityStatus(gatewayReadiness, template.gatewayCapability, {
        loading: gatewayCapabilitiesQuery.isLoading,
        known: gatewayCapabilityKnown,
      });
      const disabled = Boolean(status && !status.available && !status.checking);
      const tooltip = status && (disabled || status.checking) ? `${template.description}\n${status.reason}` : template.description;
      return (
        <AfTooltip key={`${template.type}:${template.label}`} content={tooltip} delayMs={1200} priority={0} block>
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
            <span className="node-label" title={template.label}>{template.label}</span>
            {status && (status.checking || disabled) ? (
              <span className={`palette-node-status ${status.checking ? 'checking' : 'unavailable'}`}>
                {status.checking ? '…' : '✕'}
              </span>
            ) : null}
          </div>
        </AfTooltip>
      );
    },
    [gatewayCapabilitiesQuery.isLoading, gatewayCapabilityKnown, gatewayReadiness, onDragStart]
  );

  const nothingMatches =
    Boolean(searchTerm) && sections.every((section) => filterNodes(section.nodes).length === 0);

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

      <div className="palette-categories">
        {nothingMatches ? (
          <div className="palette-empty" role="status">
            <p>
              No nodes match <strong>“{searchTerm}”</strong>.
            </p>
            <button type="button" className="palette-empty-clear" onClick={() => setSearchTerm('')}>
              Clear search
            </button>
          </div>
        ) : null}

        {/* Essentials: always visible, never collapsible, hidden while searching
            (search results already surface whatever matches). */}
        {!searchTerm && essentials.length > 0 ? (
          <div className="palette-category palette-essentials">
            <div className="category-header static">
              <span className="category-icon" dangerouslySetInnerHTML={{ __html: '&#x2605;' }} />
              <span className="category-label">Essentials</span>
            </div>
            <div className="category-nodes grid">{essentials.map(renderChip)}</div>
          </div>
        ) : null}

        {sections.map((section) => {
          const filteredNodes = filterNodes(section.nodes);
          if (searchTerm && filteredNodes.length === 0) return null;
          const expanded = Boolean(expandedSections[section.key]) || Boolean(searchTerm);

          return (
            <div key={section.key} className="palette-category">
              <div
                className="category-header"
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onClick={() => toggleSection(section.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleSection(section.key);
                  }
                }}
              >
                <span className="category-icon" dangerouslySetInnerHTML={{ __html: section.icon }} />
                <span className="category-label">{section.label}</span>
                <span className="category-count">{filteredNodes.length}</span>
                <span className="category-toggle">{expanded ? '▾' : '▸'}</span>
              </div>

              {expanded && <div className="category-nodes grid">{filteredNodes.map(renderChip)}</div>}
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
