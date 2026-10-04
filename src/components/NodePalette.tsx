/**
 * Node palette (R13.3): ONE column of full node names (wrapped, never
 * truncated), a monochrome kit icon per node, collapsible sections with a
 * count (Essentials open, the rest closed until the viewer opens them;
 * remembered per browser), search across every section with the match
 * highlighted, a kit tooltip with each node's one-line description, keyboard
 * navigation (arrows / Home / End move, Right/Left open/close a section,
 * Enter adds the node at the centre of the canvas), and a resizable width on
 * wide layouts. Drag-and-drop onto the canvas is unchanged.
 *
 * Presentation only — the model (sections, search, storage) lives in
 * utils/paletteModel.ts; NODE_CATEGORIES stays the semantic source of truth.
 */

import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AfTooltip, Icon } from '@abstractframework/ui-kit';
import type { NodeTemplate } from '../types/nodes';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../hooks/useGatewayCapabilities';
import {
  gatewayAuthoringCapabilityStatus,
  getGatewayFlowEditorReadiness,
  type GatewayAuthoringCapabilityStatus,
} from '../utils/gatewayClient';
import { paletteTapAddsNode, requestPaletteAdd } from '../utils/paletteAdd';
import { nodeIconName } from '../utils/nodeIcons';
import {
  buildPaletteSections,
  clampPaletteWidth,
  filterPaletteSections,
  highlightSegments,
  isSectionExpanded,
  loadExpansion,
  loadPaletteWidth,
  paletteKeyAction,
  type PaletteKeyItem,
  oneLineDescription,
  PALETTE_MAX_WIDTH,
  PALETTE_MIN_WIDTH,
  saveExpansion,
  savePaletteWidth,
} from '../utils/paletteModel';

const ITEM_SELECTOR = '[data-palette-item]';

export function NodePalette() {
  const gatewayCapabilitiesQuery = useGatewayCapabilities(true);
  const gatewayContracts = gatewayContractsFromCapabilities(gatewayCapabilitiesQuery.data);
  const gatewayReadiness = useMemo(() => getGatewayFlowEditorReadiness(gatewayContracts), [gatewayContracts]);
  const gatewayCapabilityKnown = Boolean(gatewayContracts && !gatewayCapabilitiesQuery.isError);
  const [expansion, setExpansion] = useState<Record<string, boolean>>(() => loadExpansion());
  const [searchTerm, setSearchTerm] = useState('');
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(() => loadPaletteWidth());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const sections = useMemo(() => buildPaletteSections(), []);
  const visibleSections = useMemo(() => filterPaletteSections(sections, searchTerm), [sections, searchTerm]);
  const nothingMatches = Boolean(searchTerm.trim()) && visibleSections.length === 0;

  // The palette width lives on the sidebar (wide layouts only; the narrow
  // drawer keeps its own width in responsive.css).
  useEffect(() => {
    const aside = rootRef.current?.closest<HTMLElement>('.sidebar.left');
    aside?.style.setProperty('--palette-width', `${width}px`);
  }, [width]);

  const toggleSection = useCallback((key: string, open?: boolean) => {
    setExpansion((prev) => {
      const nextOpen = open ?? !prev[key];
      if (Boolean(prev[key]) === nextOpen) return prev;
      const next = { ...prev, [key]: nextOpen };
      saveExpansion(next);
      return next;
    });
  }, []);

  const statusFor = useCallback(
    (template: NodeTemplate): GatewayAuthoringCapabilityStatus | null =>
      gatewayAuthoringCapabilityStatus(gatewayReadiness, template.gatewayCapability, {
        loading: gatewayCapabilitiesQuery.isLoading,
        known: gatewayCapabilityKnown,
      }),
    [gatewayCapabilitiesQuery.isLoading, gatewayCapabilityKnown, gatewayReadiness]
  );

  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, template: NodeTemplate, status: GatewayAuthoringCapabilityStatus | null) => {
      if (status && !status.available && !status.checking) {
        event.preventDefault();
        event.dataTransfer.effectAllowed = 'none';
        return;
      }
      event.dataTransfer.setData('application/reactflow', JSON.stringify(template));
      event.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  const focusItemAt = useCallback((index: number) => {
    const items = rootRef.current ? Array.from(rootRef.current.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
    const el = items[index];
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }, []);

  /** Roving focus over the section headers and node rows, in DOM order (decisions: paletteKeyAction). */
  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
      if (!item || !rootRef.current) return;
      const elements = Array.from(rootRef.current.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
      const items: PaletteKeyItem[] = elements.map((el) => ({
        kind: el.dataset.paletteItem === 'header' ? 'header' : 'node',
        section: el.dataset.section || '',
        nodeType: el.dataset.nodeType,
        nodeLabel: el.dataset.nodeLabel,
        disabled: el.getAttribute('aria-disabled') === 'true',
      }));
      const action = paletteKeyAction(event.key, items, elements.indexOf(item), Boolean(searchTerm.trim()));
      if (action.kind === 'none') return;
      event.preventDefault();
      if (action.kind === 'focus') focusItemAt(action.index);
      else if (action.kind === 'focusSearch') searchRef.current?.focus();
      else if (action.kind === 'toggle') toggleSection(action.section, action.open);
      else if (action.kind === 'add') {
        const template = sections
          .flatMap((s) => s.nodes)
          .find((n) => n.type === action.nodeType && n.label === action.nodeLabel);
        if (template) requestPaletteAdd(template);
      }
    },
    [focusItemAt, searchTerm, sections, toggleSection]
  );

  const onSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        // While searching, start on the first matching node (headers are not toggles then).
        const items = rootRef.current ? Array.from(rootRef.current.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
        const first = searchTerm.trim() ? items.findIndex((el) => el.dataset.paletteItem === 'node') : 0;
        focusItemAt(Math.max(0, first));
      } else if (event.key === 'Escape' && searchTerm) {
        event.preventDefault();
        setSearchTerm('');
      }
    },
    [focusItemAt, searchTerm]
  );

  // Resizable width (wide layouts): pointer drag or arrow keys on the separator.
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { x: event.clientX, w: width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [width]
  );
  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setWidth(clampPaletteWidth(d.w + event.clientX - d.x));
  }, []);
  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      savePaletteWidth(width);
    },
    [width]
  );
  const onResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 16;
      let next: number | null = null;
      if (event.key === 'ArrowLeft') next = width - step;
      else if (event.key === 'ArrowRight') next = width + step;
      else if (event.key === 'Home') next = PALETTE_MIN_WIDTH;
      else if (event.key === 'End') next = PALETTE_MAX_WIDTH;
      if (next === null) return;
      event.preventDefault();
      const w = clampPaletteWidth(next);
      setWidth(w);
      savePaletteWidth(w);
    },
    [width]
  );

  const itemId = (sectionKey: string, template?: NodeTemplate) =>
    template ? `${sectionKey}:${template.type}:${template.label}` : `${sectionKey}:header`;
  const firstItem = visibleSections[0] ? itemId(visibleSections[0].key) : null;
  const tabStop = activeItem ?? firstItem;

  const renderNode = (sectionKey: string, template: NodeTemplate) => {
    const status = statusFor(template);
    const disabled = Boolean(status && !status.available && !status.checking);
    const description = oneLineDescription(template.description);
    const tooltip = status && (disabled || status.checking) ? `${description} ${status.reason}` : description;
    const id = itemId(sectionKey, template);
    return (
      <AfTooltip key={id} content={tooltip}>
        <div
          className={`palette-node${disabled ? ' disabled' : ''}${status?.checking ? ' checking' : ''}`}
          role="button"
          tabIndex={tabStop === id ? 0 : -1}
          draggable={!disabled}
          aria-disabled={disabled || undefined}
          aria-label={template.label}
          aria-description={tooltip}
          data-palette-item="node"
          data-section={sectionKey}
          data-node-type={template.type}
          data-node-label={template.label}
          data-gateway-capability={template.gatewayCapability || undefined}
          data-gateway-capability-status={
            status ? (status.checking ? 'checking' : status.available ? 'available' : 'unavailable') : undefined
          }
          onFocus={() => setActiveItem(id)}
          onDragStart={(e) => onDragStart(e, template, status)}
          // Touch screens have no drag-and-drop: a tap adds the node at the
          // centre of the canvas (utils/paletteAdd.ts). Desktop stays drag-only.
          onClick={() => {
            if (!disabled && paletteTapAddsNode()) requestPaletteAdd(template);
          }}
        >
          <Icon
            name={nodeIconName(template.type, template.label, template.category)}
            size={16}
            className="palette-node-icon"
            aria-hidden="true"
          />
          <span className="palette-node-label">
            {highlightSegments(template.label, searchTerm).map((seg, i) =>
              seg.match ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
            )}
          </span>
          {status && (status.checking || disabled) ? (
            <span className={`palette-node-status ${status.checking ? 'checking' : 'unavailable'}`} aria-hidden="true">
              <Icon name={status.checking ? 'loader' : 'warning'} size={14} />
            </span>
          ) : null}
        </div>
      </AfTooltip>
    );
  };

  return (
    <div className="node-palette" ref={rootRef}>
      <h3 className="palette-title" id="node-palette-title">Nodes</h3>

      <div className="palette-search">
        <input
          ref={searchRef}
          type="search"
          placeholder="Search nodes"
          aria-label="Search nodes"
          aria-controls="node-palette-list"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setActiveItem(null);
          }}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <div
        className="palette-categories"
        id="node-palette-list"
        aria-labelledby="node-palette-title"
        onKeyDown={onListKeyDown}
      >
        {nothingMatches ? (
          <div className="palette-empty" role="status">
            <p>
              No nodes match <strong>“{searchTerm.trim()}”</strong>.
            </p>
            <button type="button" className="palette-empty-clear" onClick={() => setSearchTerm('')}>
              Clear search
            </button>
          </div>
        ) : null}

        {visibleSections.map((section) => {
          const expanded = isSectionExpanded(section.key, expansion, searchTerm);
          const headerId = itemId(section.key);
          const listId = `palette-section-${section.key}`;
          return (
            <section key={section.key} className={`palette-category palette-category--${section.key}`}>
              <button
                type="button"
                className="category-header"
                aria-expanded={expanded}
                aria-controls={listId}
                tabIndex={tabStop === headerId ? 0 : -1}
                data-palette-item="header"
                data-section={section.key}
                data-category={section.key}
                onFocus={() => setActiveItem(headerId)}
                onClick={() => {
                  if (!searchTerm.trim()) toggleSection(section.key);
                }}
              >
                <Icon name="chevronRight" size={14} className="category-chevron" aria-hidden="true" />
                <span className="category-label">{section.label}</span>
                <span className="category-count" aria-label={`${section.nodes.length} nodes`}>
                  {section.nodes.length}
                </span>
              </button>
              {expanded ? (
                <div className="category-nodes" id={listId} role="group" aria-label={section.label}>
                  {section.nodes.map((n) => renderNode(section.key, n))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="palette-help">
        <p className="palette-help-drag">Drag a node onto the canvas, or select it and press Enter.</p>
        <p className="palette-help-tap">Tap a node to add it to the centre of the canvas.</p>
      </div>

      <AfTooltip content="Drag to resize the palette">
        <div
          className="palette-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Palette width"
          aria-valuemin={PALETTE_MIN_WIDTH}
          aria-valuemax={PALETTE_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          onKeyDown={onResizeKeyDown}
        />
      </AfTooltip>
    </div>
  );
}

export default NodePalette;
