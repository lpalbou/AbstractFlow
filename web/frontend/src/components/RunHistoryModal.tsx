/**
 * Run history modal (per workflow).
 *
 * Goal: let users re-open the Run modal for a past run, and control it (pause/resume/cancel)
 * even if the original WebSocket session was interrupted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunSummary } from '../types/flow';

interface RunHistoryModalProps {
  isOpen: boolean;
  workflowId: string;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
}

async function fetchRuns(workflowId: string): Promise<RunSummary[]> {
  const qs = new URLSearchParams({ workflow_id: workflowId, limit: '50' });
  const res = await fetch(`/api/runs?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to list runs (HTTP ${res.status})`);
  return res.json();
}

function formatRunTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function RunHistoryModal({ isOpen, workflowId, onClose, onSelectRun }: RunHistoryModalProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

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
    if (!isOpen) return;
    void load();
  }, [isOpen, load]);

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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="modal run-history-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Run history"
      >
        <div className="run-history-header">
          <h3>🕘 Run History</h3>
          <button type="button" className="modal-button cancel" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="run-history-subtitle">
          Workflow: <span className="run-history-workflow-id">{workflowId}</span>
        </p>

        <div className="run-history-search">
          <input
            type="text"
            placeholder="Search by run id / status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="modal-button cancel" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>

        {error ? <p className="run-history-error">{error}</p> : null}

        <ul className="run-history-list">
          {filtered.map((r) => {
            const status = r.paused ? 'paused' : r.status || 'unknown';
            const status2 =
              status === 'waiting' && r.wait_reason ? `waiting:${r.wait_reason}` : status;
            const updatedLabel = formatRunTime(r.updated_at || r.created_at);
            const shortId = r.run_id ? r.run_id.slice(0, 8) : '';
            return (
              <li key={r.run_id} className="run-history-item">
                <button
                  type="button"
                  className="run-history-button"
                  onClick={() => onSelectRun(r.run_id)}
                  title="Open this run"
                >
                  <div className="run-history-row">
                    <span className={`run-history-status status-${status}`}>
                      {status2}
                    </span>
                    <span className="run-history-runid" title={r.run_id}>
                      run:{shortId}
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
              </li>
            );
          })}
        </ul>

        {!loading && filtered.length === 0 ? (
          <p className="run-history-empty">No runs found for this workflow.</p>
        ) : null}
      </div>
    </div>
  );
}

export default RunHistoryModal;


