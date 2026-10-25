import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import type { RunPreflightIssue } from '../utils/preflight';

type PreflightIssue = RunPreflightIssue;

export function RunPreflightPanel({
  onFocusNode,
}: {
  onFocusNode: (nodeId: string) => void;
}) {
  const issues = useFlowStore((s) => s.preflightIssues) as PreflightIssue[];
  const clear = useFlowStore((s) => s.clearPreflightIssues);
  const setExecutingNodeId = useFlowStore((s) => s.setExecutingNodeId);
  const setIssues = useFlowStore((s) => s.setPreflightIssues);
  const fixLoopEnd = useFlowStore((s) => s.fixLoopEnd);

  // Avoid accumulating timeouts when the user clicks multiple issues quickly.
  const clearTimer = useRef<number | null>(null);

  const flashNode = useCallback(
    (nodeId: string) => {
      if (clearTimer.current != null) window.clearTimeout(clearTimer.current);
      setExecutingNodeId(nodeId);
      clearTimer.current = window.setTimeout(() => {
        setExecutingNodeId(null);
        clearTimer.current = null;
      }, 2000);
    },
    [setExecutingNodeId]
  );

  const onClickIssue = useCallback(
    (issue: PreflightIssue) => {
      onFocusNode(issue.nodeId);
      flashNode(issue.nodeId);
    },
    [flashNode, onFocusNode]
  );

  if (!issues || issues.length === 0) return null;

  return (
    <div className="preflight-panel" role="dialog" aria-label="Fix issues before running">
      <div className="preflight-panel-header">
        <div className="preflight-panel-title">Fix before running</div>
        <button type="button" className="preflight-panel-close" onClick={clear} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="preflight-panel-subtitle">
        {issues.length === 1 ? '1 issue' : `${issues.length} issues`}
      </div>

      <div className="preflight-panel-list" role="list">
        {issues.map((it) => (
          <div key={it.id} className="preflight-panel-row" role="listitem">
            <button
              type="button"
              className="preflight-panel-item"
              onClick={() => onClickIssue(it)}
              title="Click to locate this node"
            >
              <div className="preflight-panel-item-top">
                <span className="preflight-panel-item-node">{it.nodeLabel}</span>
              </div>
              <div className="preflight-panel-item-msg">{it.message}</div>
            </button>
            {it.fix?.kind === 'loop_end' ? (
              <button
                type="button"
                className="preflight-panel-fix"
                onClick={() => {
                  const { loopId, endId } = it.fix!;
                  if (fixLoopEnd(loopId, endId)) setIssues(issues.filter((x) => x.id !== it.id));
                  else toast.error('The loop could not be fixed: it changed since this check.');
                }}
              >
                Fix the loop
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RunPreflightPanel;




