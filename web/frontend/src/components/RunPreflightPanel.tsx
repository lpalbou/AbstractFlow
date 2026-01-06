import { useCallback, useRef } from 'react';
import { useFlowStore } from '../hooks/useFlow';

type PreflightIssue = { id: string; nodeId: string; nodeLabel: string; message: string };

export function RunPreflightPanel({
  onFocusNode,
}: {
  onFocusNode: (nodeId: string) => void;
}) {
  const issues = useFlowStore((s) => s.preflightIssues) as PreflightIssue[];
  const clear = useFlowStore((s) => s.clearPreflightIssues);
  const setExecutingNodeId = useFlowStore((s) => s.setExecutingNodeId);

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
          <button
            key={it.id}
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
        ))}
      </div>
    </div>
  );
}

export default RunPreflightPanel;




