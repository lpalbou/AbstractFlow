import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AfChip } from '@abstractframework/ui-kit';
import type { VisualFlow } from '../types/flow';
import { BUNDLED_COMPOSED_ONLY_IDS } from '../utils/bundledFlows';
import {
  KNOWN_INTERFACES,
  buildFlowFamilyIndex,
  knownInterface,
  normalizeInterfaces,
} from '../utils/flowFamilies';
import {
  buildLibraryRows,
  type LibrarySortMode,
  type LibraryViewMode,
} from '../utils/flowLibraryRows';
import { FlowLibraryList } from './FlowLibraryList';

export interface FlowLibraryModalProps {
  isOpen: boolean;
  currentFlowId: string | null;
  flows?: VisualFlow[];
  readonlyFlowIds?: string[];
  bundledRunTargetIds?: string[];
  isLoading?: boolean;
  /** Saved-flows query in flight while bundled rows already render: the
   * header must say so or the counts understate the library (live-drive
   * finding: "7 flows" flashed on a 120-flow library). */
  isRefreshing?: boolean;
  error?: unknown;
  onClose: () => void;
  onRefresh?: () => void;
  onLoadFlow: (flowId: string) => void;
  onRenameFlow: (flowId: string, nextName: string) => Promise<void> | void;
  onUpdateDescription: (flowId: string, nextDescription: string) => Promise<void> | void;
  onUpdateInterfaces: (flowId: string, nextInterfaces: string[]) => Promise<void> | void;
  onDuplicateFlow: (flowId: string) => Promise<void> | void;
  onDeleteFlow: (flowId: string) => Promise<void> | void;
}

function renderInterfaces(interfaces: string[]): string {
  if (!interfaces.length) return '—';
  return interfaces.map((iid) => knownInterface(iid)?.label || iid).join(', ');
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString();
  } catch {
    return d.toISOString();
  }
}

function EditIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FlowLibraryModal({
  isOpen,
  currentFlowId,
  flows,
  readonlyFlowIds,
  bundledRunTargetIds,
  isLoading,
  isRefreshing,
  error,
  onClose,
  onRefresh,
  onLoadFlow,
  onRenameFlow,
  onUpdateDescription,
  onUpdateInterfaces,
  onDuplicateFlow,
  onDeleteFlow,
}: FlowLibraryModalProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<LibrarySortMode>('recent');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('all');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  // Instance selection: shared helpers render N rows for one flow; keyboard
  // nav and the selection ring anchor on the clicked INSTANCE, the preview
  // on the flow (adversarial finding: id-anchored nav teleported to the
  // first rendered copy).
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isEditingInterfaces, setIsEditingInterfaces] = useState(false);
  const [interfacesDraft, setInterfacesDraft] = useState<string[]>([]);
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);

  const readonlyFlowIdSet = useMemo(() => new Set(readonlyFlowIds || []), [readonlyFlowIds]);
  const bundledRunTargetIdSet = useMemo(() => new Set(bundledRunTargetIds || []), [bundledRunTargetIds]);

  const allFlows = useMemo(() => (Array.isArray(flows) ? flows : []), [flows]);
  const familyIndex = useMemo(
    () => buildFlowFamilyIndex(allFlows, { composedOnlyIds: BUNDLED_COMPOSED_ONLY_IDS }),
    [allFlows]
  );
  const flowById = useMemo(() => new Map(allFlows.map((flow) => [flow.id, flow])), [allFlows]);
  // Same-name collisions are real in live libraries (saved iteration copies):
  // surface the short id so "three deep-research" is self-explanatory.
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const flow of allFlows) {
      const name = (flow.name || '').trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([name]) => name));
  }, [allFlows]);

  const rowsResult = useMemo(
    () => buildLibraryRows(allFlows, familyIndex, { query, viewMode, sortMode, expandedIds: expandedKeys }),
    [allFlows, familyIndex, query, viewMode, sortMode, expandedKeys]
  );
  const rows = rowsResult.rows;
  /**
   * Rows carrying a real selectable flow, in visible order — the keyboard
   * space. Cycle leaves are excluded: they alias an ANCESTOR's flow id, so
   * navigating onto one snapped the selection back up the list (adversarial
   * finding: ArrowDown oscillated and rows below became unreachable).
   */
  const navigableRows = useMemo(() => rows.filter((row) => row.flow && row.kind !== 'cycle'), [rows]);

  const selectedFlow = useMemo(() => {
    if (!selectedFlowId) return null;
    return flowById.get(selectedFlowId) || null;
  }, [flowById, selectedFlowId]);
  const selectedFlowReadonly = Boolean(selectedFlow && readonlyFlowIdSet.has(selectedFlow.id));
  const selectedFlowBundleTarget = Boolean(selectedFlow && bundledRunTargetIdSet.has(selectedFlow.id));

  /** Family facts of the selection for the preview + delete warning. */
  const selectedUsedBy = useMemo(() => {
    if (!selectedFlow) return [] as VisualFlow[];
    return (familyIndex.inboundBy.get(selectedFlow.id) || [])
      .map((id) => flowById.get(id))
      .filter((flow): flow is VisualFlow => Boolean(flow))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [familyIndex, flowById, selectedFlow]);
  const selectedUses = useMemo(() => {
    if (!selectedFlow) return [] as { flow?: VisualFlow; id: string }[];
    return (familyIndex.refs.get(selectedFlow.id) || [])
      .filter((id) => id !== selectedFlow.id)
      .map((id) => ({ id, flow: flowById.get(id) }))
      .sort((a, b) => (a.flow?.name || a.id).localeCompare(b.flow?.name || b.id));
  }, [familyIndex, flowById, selectedFlow]);

  // Initialize selection on open / data changes. A selection that leaves the
  // VISIBLE set through the view toggle re-initializes (list and preview must
  // agree); during an active query the selection may legitimately be hidden.
  useEffect(() => {
    if (!isOpen) return;
    if (navigableRows.length === 0) {
      setSelectedFlowId(null);
      setSelectedRowKey(null);
      return;
    }
    const visibleIds = new Set(navigableRows.map((row) => row.flow?.id));
    setSelectedFlowId((prev) => {
      if (prev && (visibleIds.has(prev) || (query.trim() && flowById.has(prev)))) return prev;
      const fallback =
        currentFlowId && visibleIds.has(currentFlowId) ? currentFlowId : navigableRows[0].flow?.id || null;
      if (fallback !== prev) setSelectedRowKey(null);
      return fallback;
    });
  }, [isOpen, navigableRows, flowById, currentFlowId, query]);

  // Focus search on open.
  useEffect(() => {
    if (!isOpen) return;
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [isOpen]);

  // Expand the full ANCESTOR PATH down to a flow so a browse-mode list can
  // actually SHOW it (expansion keys are paths — a bare parent id only opens
  // top-level parents, which left depth-2 helpers invisible).
  const revealAncestorPath = useCallback(
    (flowId: string) => {
      if (familyIndex.firstLevelIds.has(flowId)) return;
      // Walk up inboundBy to a first-level ancestor (prefer one; bail on cycles).
      const chain: string[] = [];
      let cursor: string | undefined = flowId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (familyIndex.firstLevelIds.has(cursor)) break;
        const parents: string[] = familyIndex.inboundBy.get(cursor) || [];
        const next = parents.find((id) => familyIndex.firstLevelIds.has(id)) || parents[0];
        if (!next) break;
        chain.unshift(cursor);
        cursor = next;
      }
      if (!cursor || !familyIndex.firstLevelIds.has(cursor)) return;
      // Expand root + every intermediate path key (the selected leaf itself
      // does not need expanding).
      setExpandedKeys((prevKeys) => {
        const next = new Set(prevKeys);
        let pathKey = cursor as string;
        next.add(pathKey);
        for (const id of chain.slice(0, -1)) {
          pathKey = `${pathKey}>${id}`;
          next.add(pathKey);
        }
        return next;
      });
    },
    [familyIndex]
  );

  // Clearing the query reveals the selection.
  const prevQueryRef = useRef(query);
  useEffect(() => {
    const prev = prevQueryRef.current;
    prevQueryRef.current = query;
    if (!prev.trim() || query.trim() || !selectedFlowId) return;
    revealAncestorPath(selectedFlowId);
  }, [query, selectedFlowId, revealAncestorPath]);

  // Keep the selected row visible when the SELECTION changes (not on every
  // rows-identity change — expanding an unrelated family must not snap the
  // scroll back to the selection).
  useEffect(() => {
    if (!isOpen || !selectedFlowId) return;
    const selector = selectedRowKey
      ? `[data-row-key="${CSS.escape(selectedRowKey)}"]`
      : `[data-flow-id="${CSS.escape(selectedFlowId)}"]`;
    const el = listRef.current?.querySelector(selector);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, selectedFlowId, selectedRowKey]);

  const toggleExpand = useCallback((rowKey: string) => {
    let opened = false;
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else {
        next.add(rowKey);
        opened = true;
      }
      return next;
    });
    // When a family OPENS near the bottom of the viewport its children land
    // below the fold — nudge the parent upward so the unfolded family is
    // actually visible (the whole point of expanding).
    if (opened) {
      window.requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-row-key="${CSS.escape(rowKey)}"]`);
        (el as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  }, []);

  // Keyboard navigation over VISIBLE rows: Up/Down move, Right expands,
  // Left collapses (or jumps to the parent), Enter loads, "/" focuses search.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // While an editor is open, Escape cancels THAT edit (the input's own
        // handler); closing the whole modal in the same keypress lost work.
        if (isRenaming || isEditingDescription || isEditingInterfaces) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement as HTMLElement | null;
        const isTyping =
          active?.tagName?.toLowerCase() === 'input' ||
          active?.tagName?.toLowerCase() === 'textarea' ||
          (active as HTMLElement | null)?.isContentEditable;
        if (!isTyping) {
          e.preventDefault();
          searchRef.current?.focus();
          return;
        }
      }
      if (isRenaming || isEditingDescription || isEditingInterfaces) return;
      if (navigableRows.length === 0) return;

      // When focus sits INSIDE the kit tree, the DisclosureList owns
      // navigation (role=tree roving tabindex) — running the window-level
      // handler too would double-move on every arrow press. The kit's
      // onSelect keeps modal state in sync, so skipping here is lossless.
      const target = e.target as HTMLElement | null;
      if (target && typeof target.closest === 'function' && target.closest('.af-disclosure')) return;

      // Anchor on the selected INSTANCE when known; a STALE row key (its
      // parent collapsed) falls back to the flow's first visible row rather
      // than teleporting navigation to the top of the list.
      let idx = selectedRowKey ? navigableRows.findIndex((row) => row.key === selectedRowKey) : -1;
      if (idx < 0) idx = navigableRows.findIndex((row) => row.flow?.id === selectedFlowId);
      const selectedRow = idx >= 0 ? navigableRows[idx] : null;

      const selectRowAt = (next: number) => {
        const row = navigableRows[next];
        if (!row?.flow) return;
        setSelectedFlowId(row.flow.id);
        setSelectedRowKey(row.key);
      };

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectRowAt(idx < 0 ? 0 : Math.min(navigableRows.length - 1, idx + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectRowAt(idx < 0 ? 0 : Math.max(0, idx - 1));
        return;
      }
      if (e.key === 'ArrowRight') {
        if (selectedRow?.expandable && !selectedRow.expanded) {
          e.preventDefault();
          toggleExpand(selectedRow.key);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (selectedRow?.expandable && selectedRow.expanded) {
          e.preventDefault();
          toggleExpand(selectedRow.key);
          return;
        }
        if (selectedRow?.parentId) {
          e.preventDefault();
          setSelectedFlowId(selectedRow.parentId);
          // The parent's row key is this row's path minus the last segment.
          const parentKey = selectedRow.key.includes('>')
            ? selectedRow.key.slice(0, selectedRow.key.lastIndexOf('>'))
            : null;
          setSelectedRowKey(parentKey);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (selectedFlowId) {
          e.preventDefault();
          onLoadFlow(selectedFlowId);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as never);
  }, [
    isOpen,
    isRenaming,
    isEditingDescription,
    isEditingInterfaces,
    navigableRows,
    onClose,
    onLoadFlow,
    selectedFlowId,
    selectedRowKey,
    toggleExpand,
  ]);

  // Destructive/edit state must not survive a close/reopen (a pre-armed
  // "Confirm Delete" firing on the first click after reopen).
  useEffect(() => {
    if (isOpen) return;
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setIsEditingDescription(false);
    setIsEditingInterfaces(false);
  }, [isOpen]);

  // Reset destructive UI when selection changes.
  useEffect(() => {
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setRenameDraft('');
    setIsEditingDescription(false);
    setDescriptionDraft('');
    setIsEditingInterfaces(false);
    setInterfacesDraft([]);
  }, [selectedFlowId]);

  // Renaming a READONLY (bundled) flow is allowed: the host handler creates
  // an editable family copy under the new name (the shipped bundle itself
  // cannot be mutated). Operator ruling 2026-07-20.
  const beginRename = useCallback(() => {
    if (!selectedFlow) return;
    setIsRenaming(true);
    setRenameDraft(selectedFlow.name || '');
    setIsDeleteConfirm(false);
    setIsEditingDescription(false);
    setDescriptionDraft('');
    setIsEditingInterfaces(false);
    setInterfacesDraft([]);
    window.setTimeout(() => searchRef.current?.blur(), 0);
  }, [selectedFlow]);

  const commitRename = useCallback(async () => {
    if (!selectedFlow) return;
    const next = renameDraft.trim();
    if (!next || next === selectedFlow.name) {
      setIsRenaming(false);
      return;
    }
    await onRenameFlow(selectedFlow.id, next);
    setIsRenaming(false);
  }, [onRenameFlow, renameDraft, selectedFlow]);

  const beginEditDescription = useCallback(() => {
    if (!selectedFlow || selectedFlowReadonly) return;
    setIsEditingDescription(true);
    setDescriptionDraft(selectedFlow.description || '');
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setRenameDraft('');
    setIsEditingInterfaces(false);
    setInterfacesDraft([]);
    window.setTimeout(() => searchRef.current?.blur(), 0);
  }, [selectedFlow, selectedFlowReadonly]);

  const commitDescription = useCallback(async () => {
    if (!selectedFlow || selectedFlowReadonly) return;
    const next = descriptionDraft.trim();
    const current = (selectedFlow.description || '').trim();
    if (next === current) {
      setIsEditingDescription(false);
      return;
    }
    await onUpdateDescription(selectedFlow.id, descriptionDraft);
    setIsEditingDescription(false);
  }, [descriptionDraft, onUpdateDescription, selectedFlow, selectedFlowReadonly]);

  const beginEditInterfaces = useCallback(() => {
    if (!selectedFlow || selectedFlowReadonly) return;
    setIsEditingInterfaces(true);
    setInterfacesDraft(normalizeInterfaces(selectedFlow.interfaces));
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setRenameDraft('');
    setIsEditingDescription(false);
    setDescriptionDraft('');
    window.setTimeout(() => searchRef.current?.blur(), 0);
  }, [selectedFlow, selectedFlowReadonly]);

  const commitInterfaces = useCallback(async () => {
    if (!selectedFlow || selectedFlowReadonly) return;
    const next = normalizeInterfaces(interfacesDraft);
    const current = normalizeInterfaces(selectedFlow.interfaces);
    // Set comparison: uncheck+recheck reorders the draft; an order-only
    // "change" must not fire a PUT (it bumped updated_at and resorted Recent).
    const sameSet = next.length === current.length && next.every((id) => current.includes(id));
    if (sameSet) {
      setIsEditingInterfaces(false);
      return;
    }
    await onUpdateInterfaces(selectedFlow.id, next);
    setIsEditingInterfaces(false);
  }, [interfacesDraft, onUpdateInterfaces, selectedFlow, selectedFlowReadonly]);

  const handleDelete = useCallback(async () => {
    if (!selectedFlow || selectedFlowReadonly) return;
    if (!isDeleteConfirm) {
      setIsDeleteConfirm(true);
      return;
    }
    await onDeleteFlow(selectedFlow.id);
  }, [isDeleteConfirm, onDeleteFlow, selectedFlow, selectedFlowReadonly]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedFlow) return;
    await onDuplicateFlow(selectedFlow.id);
  }, [onDuplicateFlow, selectedFlow]);

  /** Any inline editor open (rename / description / interfaces). */
  const isEditing = isRenaming || isEditingDescription || isEditingInterfaces;

  const cancelEdits = useCallback(() => {
    setIsRenaming(false);
    setRenameDraft('');
    setIsEditingDescription(false);
    setDescriptionDraft('');
    setIsEditingInterfaces(false);
    setInterfacesDraft([]);
  }, []);

  const jumpToFlow = useCallback(
    (flowId: string) => {
      setSelectedFlowId(flowId);
      setSelectedRowKey(null);
      // Uses/Used-by links may target a flow buried under collapsed parents:
      // reveal its ancestor path or the jump selects an invisible row
      // (adversary find — the preview updated while the list showed nothing).
      revealAncestorPath(flowId);
    },
    [revealAncestorPath]
  );

  const selectRow = useCallback((flowId: string, rowKey: string) => {
    setSelectedFlowId(flowId);
    setSelectedRowKey(rowKey);
  }, []);

  if (!isOpen) return null;

  const executableToggleTitle =
    'Runnable = declares a framework-executable interface (today: Runnable agent v1). Helpers and drafts stay visible in All.';
  const shownCount = navigableRows.length;
  const filtering = Boolean(query.trim()) || viewMode === 'executable';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal flow-library-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-library-header">
          <div className="flow-library-title">
            <h3>Flow Library</h3>
            <div className="flow-library-subtitle">
              <span className="flow-library-count">
                {isRefreshing ? (
                  <>Loading saved flows…</>
                ) : (
                  <>
                    {rowsResult.totalCount} flow{rowsResult.totalCount === 1 ? '' : 's'} ·{' '}
                    {rowsResult.topLevelCount} top-level · {rowsResult.executableCount} runnable
                    {filtering ? ` · ${shownCount} shown` : ''}
                  </>
                )}
              </span>
              {onRefresh ? (
                <button type="button" className="flow-library-link" onClick={onRefresh}>
                  Refresh
                </button>
              ) : null}
            </div>
          </div>

          <div className="flow-library-controls">
            <div className="flow-library-view-toggle" role="tablist" aria-label="Library view" title={executableToggleTitle}>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'all'}
                className={`flow-library-view-option ${viewMode === 'all' ? 'active' : ''}`}
                onClick={() => setViewMode('all')}
              >
                All
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'executable'}
                className={`flow-library-view-option ${viewMode === 'executable' ? 'active' : ''}`}
                onClick={() => setViewMode('executable')}
              >
                Runnable
              </button>
            </div>
            <input
              ref={searchRef}
              className="flow-library-search"
              placeholder="Search name, description, id…  ( / )"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="flow-library-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as LibrarySortMode)}
              aria-label="Sort flows"
            >
              <option value="recent">Recent</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="name_desc">Name (Z–A)</option>
            </select>
          </div>
        </div>

        <div className="flow-library-body">
          <div className="flow-library-list" ref={listRef}>
            {isLoading ? (
              <div className="flow-library-empty">Loading flows…</div>
            ) : error ? (
              <div className="flow-library-empty error-text">Failed to load flows</div>
            ) : rows.length === 0 ? (
              <div className="flow-library-empty">
                <div className="flow-library-empty-title">No flows found</div>
                <div className="flow-library-empty-sub">
                  {viewMode === 'executable' ? (
                    <>
                      No runnable workflows match.{' '}
                      <button type="button" className="flow-library-link" onClick={() => setViewMode('all')}>
                        Show all flows
                      </button>
                    </>
                  ) : (
                    'Try a different search query.'
                  )}
                </div>
              </div>
            ) : (
              <FlowLibraryList
                rows={rows}
                selectedFlowId={selectedFlowId}
                selectedRowKey={selectedRowKey}
                currentFlowId={currentFlowId}
                readonlyFlowIds={readonlyFlowIdSet}
                bundledRunTargetIds={bundledRunTargetIdSet}
                selfReferencingIds={familyIndex.selfReferencingIds}
                cyclePromotedIds={familyIndex.cyclePromotedIds}
                duplicateNames={duplicateNames}
                hideRunnableBadge={viewMode === 'executable'}
                onSelect={selectRow}
                onLoad={onLoadFlow}
                onToggleExpand={toggleExpand}
              />
            )}
          </div>

          <div className="flow-library-preview">
            {selectedFlow ? (
              <>
                <div className="flow-library-preview-top">
                  <div className="flow-library-preview-title">
                    {isRenaming ? (
                      <input
                        className="flow-library-rename"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') {
                            setIsRenaming(false);
                            setRenameDraft('');
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <div className="flow-library-preview-name-row">
                        <div className="flow-library-preview-name">{selectedFlow.name}</div>
                        {selectedFlowBundleTarget ? (
                          <AfChip tone="info" size="sm" title="Ships as a published bundle target">
                            bundle
                          </AfChip>
                        ) : selectedFlowReadonly ? (
                          <AfChip tone="info" size="sm" title="Bundled example (read-only)">
                            bundled
                          </AfChip>
                        ) : null}
                        {!selectedFlowReadonly ? (
                          <button
                            type="button"
                            className="flow-library-edit-icon"
                            onClick={beginRename}
                            aria-label="Edit flow name"
                            title="Edit name"
                          >
                            <EditIcon />
                          </button>
                        ) : null}
                      </div>
                    )}
                    <div className="flow-library-preview-id">{selectedFlow.id}</div>
                  </div>
                </div>

                <div className="flow-library-preview-meta">
                  <div className="flow-library-preview-row">
                    <span className="flow-library-preview-key">Updated</span>
                    <span className="flow-library-preview-val">{formatDateTime(selectedFlow.updated_at) || '—'}</span>
                  </div>
                  <div className="flow-library-preview-row">
                    <span className="flow-library-preview-key">Created</span>
                    <span className="flow-library-preview-val">{formatDateTime(selectedFlow.created_at) || '—'}</span>
                  </div>
                  <div className="flow-library-preview-row">
                    <span className="flow-library-preview-key">Graph</span>
                    <span className="flow-library-preview-val">
                      {selectedFlow.nodes.length} nodes • {selectedFlow.edges.length} edges
                    </span>
                  </div>
                  <div className="flow-library-preview-row">
                    <span className="flow-library-preview-key">Interfaces</span>
                    <span className="flow-library-preview-val flow-library-preview-inline">
                      <span>{renderInterfaces(normalizeInterfaces(selectedFlow.interfaces))}</span>
                      {!selectedFlowReadonly && !isRenaming && !isEditingDescription && !isEditingInterfaces ? (
                        <button
                          type="button"
                          className="flow-library-edit-icon meta"
                          onClick={beginEditInterfaces}
                          aria-label="Edit workflow interfaces"
                          title="Edit interfaces"
                        >
                          <EditIcon size={13} />
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {isEditingInterfaces ? (
                    <div className="flow-library-interfaces-editor">
                      {KNOWN_INTERFACES.filter((iface) => iface.class !== 'domain' || interfacesDraft.includes(iface.id)).map(
                        (iface) => {
                          const checked = interfacesDraft.includes(iface.id);
                          return (
                            <label key={iface.id} className="flow-library-interface-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setInterfacesDraft((prev) => {
                                    const base = normalizeInterfaces(prev);
                                    if (on) {
                                      if (!base.includes(iface.id)) base.push(iface.id);
                                      return base;
                                    }
                                    return base.filter((x) => x !== iface.id);
                                  });
                                }}
                              />
                              <div className="flow-library-interface-copy">
                                <div className="flow-library-interface-label">{iface.label}</div>
                                <div className="flow-library-interface-desc">{iface.description}</div>
                              </div>
                            </label>
                          );
                        }
                      )}

                      <div className="flow-library-interfaces-hint">
                        <div className="flow-library-interfaces-hint-title">Runnable agent (v1) contract</div>
                        <div className="flow-library-interfaces-hint-body">
                          <div>
                            On Flow Start outputs: <code>provider</code> (provider), <code>model</code> (model),{' '}
                            <code>prompt</code> (string)
                          </div>
                          <div>
                            On Flow End inputs: <code>response</code> (string), <code>success</code> (boolean),{' '}
                            <code>meta</code> (object)
                          </div>
                          <div style={{ marginTop: 6 }}>
                            <em>Note:</em> declaring the interface does NOT add these pins — wire them on the canvas
                            yourself, or hosts that start this workflow will bind inputs to nothing and read empty
                            outputs.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {selectedUses.length > 0 || selectedUsedBy.length > 0 ? (
                  <div className="flow-library-family">
                    <div className="flow-library-family-title">Family</div>
                    {selectedUses.length > 0 ? (
                      <div className="flow-library-family-row">
                        <span className="flow-library-preview-key">Uses</span>
                        <span className="flow-library-family-links">
                          {selectedUses.map((entry) =>
                            entry.flow ? (
                              <button
                                key={entry.id}
                                type="button"
                                className="flow-library-family-link"
                                onClick={() => jumpToFlow(entry.id)}
                                title={`Select ${entry.flow.name || entry.id}`}
                              >
                                {entry.flow.name || entry.id}
                              </button>
                            ) : (
                              <span key={entry.id} className="flow-library-family-missing" title="Referenced workflow not found">
                                {entry.id} (missing)
                              </span>
                            )
                          )}
                        </span>
                      </div>
                    ) : null}
                    {selectedUsedBy.length > 0 ? (
                      <div className="flow-library-family-row">
                        <span className="flow-library-preview-key">Used by</span>
                        <span className="flow-library-family-links">
                          {selectedUsedBy.map((parent) => (
                            <button
                              key={parent.id}
                              type="button"
                              className="flow-library-family-link"
                              onClick={() => jumpToFlow(parent.id)}
                              title={`Select ${parent.name || parent.id}`}
                            >
                              {parent.name || parent.id}
                            </button>
                          ))}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flow-library-preview-desc">
                  {isEditingDescription ? (
                    <textarea
                      className="flow-library-description"
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      placeholder="Add a helpful description for this workflow…"
                      rows={6}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setIsEditingDescription(false);
                          setDescriptionDraft('');
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          commitDescription();
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <>
                      {!selectedFlowReadonly ? (
                        <button
                          type="button"
                          className="flow-library-edit-icon desc"
                          onClick={beginEditDescription}
                          aria-label="Edit flow description"
                          title="Edit description"
                        >
                          <EditIcon />
                        </button>
                      ) : null}
                      <div className="flow-library-preview-desc-text">
                        {selectedFlow.description?.trim() ? selectedFlow.description.trim() : 'No description.'}
                      </div>
                      {selectedFlowReadonly ? (
                        <div className="flow-library-readonly-note">
                          {selectedFlowBundleTarget
                            ? 'Bundled workflow family. Load it to run the shipped bundle, or Duplicate/Rename to copy the whole family (subflows included, references remapped) into editable storage.'
                            : 'Bundled example. Load it as an unsaved draft, or Duplicate/Rename it into Gateway storage to edit.'}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {isEditing ? (
                  <div className="flow-library-preview-actions">
                    {isRenaming ? (
                      <button type="button" className="modal-button primary" onClick={commitRename}>
                        Save Name
                      </button>
                    ) : isEditingDescription ? (
                      <button type="button" className="modal-button primary" onClick={commitDescription}>
                        Save Description
                      </button>
                    ) : (
                      <button type="button" className="modal-button primary" onClick={commitInterfaces}>
                        Save Interfaces
                      </button>
                    )}
                    <button type="button" className="modal-button cancel" onClick={cancelEdits}>
                      Cancel
                    </button>
                  </div>
                ) : !selectedFlowReadonly ? (
                  <div className="flow-library-preview-actions">
                    <button
                      type="button"
                      className={`modal-button ${isDeleteConfirm ? 'danger' : ''}`}
                      onClick={handleDelete}
                      title={
                        isDeleteConfirm
                          ? 'Click again to confirm delete'
                          : selectedUsedBy.length > 0
                            ? `Delete flow — used by ${selectedUsedBy.map((parent) => parent.name || parent.id).join(', ')}`
                            : 'Delete flow'
                      }
                    >
                      {isDeleteConfirm
                        ? selectedUsedBy.length > 0
                          ? `Confirm — breaks ${selectedUsedBy.length} parent${selectedUsedBy.length === 1 ? '' : 's'}`
                          : 'Confirm Delete'
                        : 'Delete'}
                    </button>
                    {isDeleteConfirm && selectedUsedBy.length > 0 ? (
                      <div className="flow-library-delete-warning">
                        Deleting breaks the subflow reference in:{' '}
                        {selectedUsedBy.map((parent) => parent.name || parent.id).join(', ')}. Those workflows will
                        fail to run or publish until re-wired.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flow-library-empty">Select a flow to preview.</div>
            )}
          </div>
        </div>

        {/* Persistent action bar: the primary verbs are ALWAYS visible and
            enable once a workflow is selected (operator ask 2026-07-20 — the
            in-preview actions scrolled below the fold on long descriptions). */}
        <div className="modal-actions flow-library-actions">
          <button type="button" className="modal-button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-button"
            onClick={beginRename}
            disabled={!selectedFlow || isEditing}
            title={
              !selectedFlow
                ? 'Select a workflow first'
                : isEditing
                  ? 'Finish the current edit first'
                  : selectedFlowReadonly
                    ? 'Bundled workflows are read-only — renaming creates an editable copy under the new name'
                    : 'Rename workflow'
            }
          >
            Rename
          </button>
          <button
            type="button"
            className="modal-button"
            onClick={handleDuplicate}
            disabled={!selectedFlow || isEditing}
            title={
              !selectedFlow
                ? 'Select a workflow first'
                : isEditing
                  ? 'Finish the current edit first'
                  : selectedFlowReadonly
                    ? 'Copies the workflow (and its bundled subflows) into editable storage'
                    : selectedUses.length > 0
                      ? 'Duplicate workflow (references shared subflows — they are not copied)'
                      : 'Duplicate workflow'
            }
          >
            Duplicate
          </button>
          <button
            type="button"
            className="modal-button primary"
            onClick={() => selectedFlow && onLoadFlow(selectedFlow.id)}
            disabled={!selectedFlow || isEditing}
            title={
              !selectedFlow
                ? 'Select a workflow first'
                : isEditing
                  ? 'Finish the current edit first'
                  : 'Load workflow into the editor'
            }
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}

export default FlowLibraryModal;
