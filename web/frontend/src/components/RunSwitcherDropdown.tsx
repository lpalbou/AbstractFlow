/**
 * In-modal run switcher (per workflow).
 *
 * Goal: rapidly switch between runs without leaving the Run modal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunSummary } from '../types/flow';

async function fetchRuns(workflowId: string): Promise<RunSummary[]> {
  const qs = new URLSearchParams({ workflow_id: workflowId, limit: '50' });
  const res = await fetch(`/api/runs?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to list runs (HTTP ${res.status})`);
  return res.json();
}

function shortRunId(runId: string): string {
  const s = (runId || '').trim();
  if (!s) return '';
  // Prefer showing the most informative prefix; full id is available via title.
  return s.length > 8 ? s.slice(0, 8) : s;
}

function formatRunTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

async function copyText(text: string): Promise<void> {
  const value = String(text || '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

export function RunSwitcherDropdown({
  workflowId,
  currentRunId,
  onSelectRun,
}: {
  workflowId: string;
  currentRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRuns(workflowId);
      setRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      setRuns([]);
      setError(e instanceof Error ? e.message : 'Failed to list runs');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) return;
    // Preload so opening the menu is instant.
    void load();
  }, [workflowId, load]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current && ref.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return runs;
    return runs.filter((r) => {
      const rid = (r.run_id || '').toLowerCase();
      const st = (r.paused ? 'paused' : r.status || '').toLowerCase();
      const wr = (r.wait_reason || '').toLowerCase();
      return rid.includes(term) || st.includes(term) || wr.includes(term);
    });
  }, [runs, search]);

  const currentLabel = useMemo(() => {
    if (currentRunId && currentRunId.trim()) return `run:${shortRunId(currentRunId)}`;
    return 'Runs';
  }, [currentRunId]);

  return (
    <div className="run-switcher" ref={ref}>
      <button
        type="button"
        className="run-modal-runid run-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        title={currentRunId ? `Switch runs (current: ${currentRunId})` : 'Switch runs'}
        aria-label="Switch runs"
        disabled={!workflowId}
      >
        <span className="run-switcher-label">{currentLabel}</span>
        <span className="run-switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="run-switcher-menu" role="menu" aria-label="Runs">
          <div className="run-switcher-search">
            <input
              type="text"
              placeholder="Search runs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="modal-button cancel" onClick={load} disabled={loading}>
              Refresh
            </button>
          </div>

          {error ? <div className="run-switcher-error">{error}</div> : null}

          <ul className="run-switcher-list">
            {filtered.map((r) => {
              const status = r.paused ? 'paused' : r.status || 'unknown';
              const status2 = status === 'waiting' && r.wait_reason ? `waiting:${r.wait_reason}` : status;
              const updatedLabel = formatRunTime(r.updated_at || r.created_at);
              const selected = Boolean(currentRunId && r.run_id === currentRunId);
              return (
                <li key={r.run_id} className={selected ? 'run-switcher-item selected' : 'run-switcher-item'}>
                  <button
                    type="button"
                    className="run-switcher-item-button"
                    onClick={() => {
                      setOpen(false);
                      onSelectRun(r.run_id);
                    }}
                    title="Open this run"
                  >
                    <div className="run-history-row">
                      <span className={`run-history-status status-${status}`}>{status2}</span>
                      <span className="run-history-runid" title={r.run_id}>
                        run:{shortRunId(r.run_id)}
                      </span>
                    </div>
                    <div className="run-history-row subtle">
                      <span className="run-history-time">{updatedLabel}</span>
                      {r.current_node ? (
                        <span className="run-history-node" title={`Current node: ${r.current_node}`}>
                          {r.current_node}
                        </span>
                      ) : null}
                    </div>
                  </button>

                  <button
                    type="button"
                    className="run-switcher-copy"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyText(r.run_id);
                    }}
                    title="Copy run id"
                    aria-label="Copy run id"
                  >
                    ⧉
                  </button>
                </li>
              );
            })}
          </ul>

          {!loading && filtered.length === 0 ? (
            <div className="run-switcher-empty">No runs found.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default RunSwitcherDropdown;




