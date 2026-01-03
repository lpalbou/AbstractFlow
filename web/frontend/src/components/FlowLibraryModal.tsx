import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VisualFlow } from '../types/flow';

type SortMode = 'recent' | 'name_asc' | 'name_desc';

export interface FlowLibraryModalProps {
  isOpen: boolean;
  currentFlowId: string | null;
  flows?: VisualFlow[];
  isLoading?: boolean;
  error?: unknown;
  onClose: () => void;
  onRefresh?: () => void;
  onLoadFlow: (flowId: string) => void;
  onRenameFlow: (flowId: string, nextName: string) => Promise<void> | void;
  onUpdateDescription: (flowId: string, nextDescription: string) => Promise<void> | void;
  onDuplicateFlow: (flowId: string) => Promise<void> | void;
  onDeleteFlow: (flowId: string) => Promise<void> | void;
}

function safeLower(value: unknown): string {
  return (typeof value === 'string' ? value : String(value ?? '')).toLowerCase();
}

function parseIsoMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
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
      <path
        d="M12 20h9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  isLoading,
  error,
  onClose,
  onRefresh,
  onLoadFlow,
  onRenameFlow,
  onUpdateDescription,
  onDuplicateFlow,
  onDeleteFlow,
}: FlowLibraryModalProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);

  const normalizedFlows = useMemo(() => {
    const all = Array.isArray(flows) ? flows : [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((f) => {
          const hay = `${f.name ?? ''}\n${f.description ?? ''}\n${f.id ?? ''}`.toLowerCase();
          return hay.includes(q);
        })
      : all;

    const sorted = [...filtered];
    if (sortMode === 'name_asc') {
      sorted.sort((a, b) => safeLower(a.name).localeCompare(safeLower(b.name)));
    } else if (sortMode === 'name_desc') {
      sorted.sort((a, b) => safeLower(b.name).localeCompare(safeLower(a.name)));
    } else {
      // recent (fallback): updated_at desc, then created_at desc, then name asc
      sorted.sort((a, b) => {
        const au = parseIsoMs(a.updated_at) || parseIsoMs(a.created_at);
        const bu = parseIsoMs(b.updated_at) || parseIsoMs(b.created_at);
        if (bu !== au) return bu - au;
        return safeLower(a.name).localeCompare(safeLower(b.name));
      });
    }

    return sorted;
  }, [flows, query, sortMode]);

  const selectedFlow = useMemo(() => {
    if (!selectedFlowId) return null;
    return (flows || []).find((f) => f.id === selectedFlowId) || null;
  }, [flows, selectedFlowId]);

  // Initialize selection on open / data changes
  useEffect(() => {
    if (!isOpen) return;
    if (!normalizedFlows.length) {
      setSelectedFlowId(null);
      return;
    }
    setSelectedFlowId((prev) => {
      if (prev && normalizedFlows.some((f) => f.id === prev)) return prev;
      if (currentFlowId && normalizedFlows.some((f) => f.id === currentFlowId)) return currentFlowId;
      return normalizedFlows[0].id;
    });
  }, [isOpen, normalizedFlows, currentFlowId]);

  // Focus search on open
  useEffect(() => {
    if (!isOpen) return;
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [isOpen]);

  // Keyboard navigation (SOTA: fast library-like navigation)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // "/" focuses search (common UX in command palettes / libs)
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

      if (isRenaming || isEditingDescription) return; // do not hijack keys while editing
      if (!normalizedFlows.length) return;

      const idx = normalizedFlows.findIndex((f) => f.id === selectedFlowId);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.min(normalizedFlows.length - 1, idx + 1);
        setSelectedFlowId(normalizedFlows[next]?.id || null);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.max(0, idx - 1);
        setSelectedFlowId(normalizedFlows[next]?.id || null);
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
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
  }, [isOpen, isRenaming, isEditingDescription, normalizedFlows, onClose, onLoadFlow, selectedFlowId]);

  // Reset destructive UI when selection changes
  useEffect(() => {
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setRenameDraft('');
    setIsEditingDescription(false);
    setDescriptionDraft('');
  }, [selectedFlowId]);

  const beginRename = useCallback(() => {
    if (!selectedFlow) return;
    setIsRenaming(true);
    setRenameDraft(selectedFlow.name || '');
    setIsDeleteConfirm(false);
    setIsEditingDescription(false);
    setDescriptionDraft('');
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
    if (!selectedFlow) return;
    setIsEditingDescription(true);
    setDescriptionDraft(selectedFlow.description || '');
    setIsDeleteConfirm(false);
    setIsRenaming(false);
    setRenameDraft('');
    window.setTimeout(() => searchRef.current?.blur(), 0);
  }, [selectedFlow]);

  const commitDescription = useCallback(async () => {
    if (!selectedFlow) return;
    const next = descriptionDraft.trim();
    const current = (selectedFlow.description || '').trim();
    if (next === current) {
      setIsEditingDescription(false);
      return;
    }
    await onUpdateDescription(selectedFlow.id, descriptionDraft);
    setIsEditingDescription(false);
  }, [descriptionDraft, onUpdateDescription, selectedFlow]);

  const handleDelete = useCallback(async () => {
    if (!selectedFlow) return;
    if (!isDeleteConfirm) {
      setIsDeleteConfirm(true);
      return;
    }
    await onDeleteFlow(selectedFlow.id);
  }, [isDeleteConfirm, onDeleteFlow, selectedFlow]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedFlow) return;
    await onDuplicateFlow(selectedFlow.id);
  }, [onDuplicateFlow, selectedFlow]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal flow-library-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-library-header">
          <div className="flow-library-title">
            <h3>Flow Library</h3>
            <div className="flow-library-subtitle">
              <span className="flow-library-count">
                {normalizedFlows.length} flow{normalizedFlows.length === 1 ? '' : 's'}
              </span>
              {onRefresh ? (
                <button type="button" className="flow-library-link" onClick={onRefresh}>
                  Refresh
                </button>
              ) : null}
            </div>
          </div>

          <div className="flow-library-controls">
            <input
              ref={searchRef}
              className="flow-library-search"
              placeholder="Search flows…  (press / to focus)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="flow-library-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="recent">Recent</option>
              <option value="name_asc">Name (A–Z)</option>
              <option value="name_desc">Name (Z–A)</option>
            </select>
          </div>
        </div>

        <div className="flow-library-body">
          <div className="flow-library-list">
            {isLoading ? (
              <div className="flow-library-empty">Loading flows…</div>
            ) : error ? (
              <div className="flow-library-empty error-text">Failed to load flows</div>
            ) : normalizedFlows.length === 0 ? (
              <div className="flow-library-empty">
                <div className="flow-library-empty-title">No flows found</div>
                <div className="flow-library-empty-sub">Try a different search query.</div>
              </div>
            ) : (
              normalizedFlows.map((flow) => {
                const isSelected = flow.id === selectedFlowId;
                const isCurrent = Boolean(currentFlowId && flow.id === currentFlowId);
                const metaUpdated = formatDateTime(flow.updated_at) || formatDateTime(flow.created_at);

                return (
                  <button
                    key={flow.id}
                    type="button"
                    className={`flow-library-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedFlowId(flow.id)}
                    onDoubleClick={() => onLoadFlow(flow.id)}
                    title="Double click to load"
                  >
                    <div className="flow-library-item-top">
                      <div className="flow-library-item-name">{flow.name || flow.id}</div>
                      <div className="flow-library-item-badges">
                        {isCurrent ? <span className="flow-library-badge current">current</span> : null}
                        <span className="flow-library-badge">{flow.nodes.length}n</span>
                        <span className="flow-library-badge">{flow.edges.length}e</span>
                      </div>
                    </div>
                    <div className="flow-library-item-sub">
                      <span className="flow-library-item-desc">
                        {flow.description?.trim() ? flow.description.trim() : '—'}
                      </span>
                      {metaUpdated ? <span className="flow-library-item-updated">{metaUpdated}</span> : null}
                    </div>
                  </button>
                );
              })
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
                        <button
                          type="button"
                          className="flow-library-edit-icon"
                          onClick={beginRename}
                          aria-label="Edit flow name"
                          title="Edit name"
                        >
                          <EditIcon />
                        </button>
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
                </div>

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
                        // Ctrl/Cmd+Enter to save (common editor shortcut)
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          commitDescription();
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flow-library-edit-icon desc"
                        onClick={beginEditDescription}
                        aria-label="Edit flow description"
                        title="Edit description"
                      >
                        <EditIcon />
                      </button>
                      <div className="flow-library-preview-desc-text">
                        {selectedFlow.description?.trim() ? selectedFlow.description.trim() : 'No description.'}
                      </div>
                    </>
                  )}
                </div>

                <div className="flow-library-preview-actions">
                  {isRenaming || isEditingDescription ? (
                    <>
                      {isRenaming ? (
                        <button type="button" className="modal-button primary" onClick={commitRename}>
                          Save Name
                        </button>
                      ) : (
                        <button type="button" className="modal-button primary" onClick={commitDescription}>
                          Save Description
                        </button>
                      )}
                      <button
                        type="button"
                        className="modal-button cancel"
                        onClick={() => {
                          setIsRenaming(false);
                          setRenameDraft('');
                          setIsEditingDescription(false);
                          setDescriptionDraft('');
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="modal-button primary"
                        onClick={() => onLoadFlow(selectedFlow.id)}
                      >
                        Load
                      </button>
                      <button type="button" className="modal-button" onClick={handleDuplicate}>
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className={`modal-button ${isDeleteConfirm ? 'danger' : ''}`}
                        onClick={handleDelete}
                        title={isDeleteConfirm ? 'Click again to confirm delete' : 'Delete flow'}
                      >
                        {isDeleteConfirm ? 'Confirm Delete' : 'Delete'}
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flow-library-empty">Select a flow to preview.</div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default FlowLibraryModal;


