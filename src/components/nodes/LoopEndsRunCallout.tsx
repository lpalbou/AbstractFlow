import toast from 'react-hot-toast';
import type { Edge, Node } from 'reactflow';
import { useFlowStore } from '../../hooks/useFlow';
import type { FlowNodeData } from '../../types/flow';
import {
  LOOP_BODY_NODE_TYPES,
  LOOP_DONE_TAKEN_HINT,
  loopEndsRunIssues,
  loopEndsRunMessage,
  type LoopEndsRunIssue,
} from '../../utils/loopEndsRun';

/** One computation per graph change, shared by every loop / On Flow End card on the canvas. */
let cache: { nodes: Node<FlowNodeData>[]; edges: Edge[]; issues: LoopEndsRunIssue[] } | null = null;
function issuesFor(nodes: Node<FlowNodeData>[], edges: Edge[]): LoopEndsRunIssue[] {
  if (!cache || cache.nodes !== nodes || cache.edges !== edges) cache = { nodes, edges, issues: loopEndsRunIssues(nodes, edges) };
  return cache.issues;
}

/** Whether a node type can carry the loop-ends-run warning (a loop, or the On Flow End it reaches). */
export function canWarnLoopEndsRun(nodeType: string | undefined): boolean {
  return nodeType === 'on_flow_end' || LOOP_BODY_NODE_TYPES.has(nodeType as FlowNodeData['nodeType']);
}

/**
 * The warning on a loop whose body ends at On Flow End, shown on the loop and
 * on that On Flow End (utils/loopEndsRun.ts), with "Fix the loop".
 */
export function LoopEndsRunCallout({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const fixLoopEnd = useFlowStore((s) => s.fixLoopEnd);
  const mine = issuesFor(nodes, edges).filter((i) => i.loopId === nodeId || i.endId === nodeId);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((issue) => (
        <LoopEndsRunCalloutView
          key={`${issue.loopId}:${issue.endId}`}
          message={loopEndsRunMessage(nodes.find((n) => n.id === issue.loopId)?.data.nodeType)}
          fixable={issue.fixable}
          onFix={() => {
            if (!fixLoopEnd(issue.loopId, issue.endId)) toast.error('The loop could not be fixed: it changed since this check.');
          }}
        />
      ))}
    </>
  );
}

/** Presentational part. */
export function LoopEndsRunCalloutView({ message, fixable, onFix }: { message: string; fixable: boolean; onFix: () => void }) {
  return (
    <div className="node-loop-warning nodrag" role="alert">
      <span className="node-loop-warning-text">{message}</span>
      {fixable ? (
        <button
          type="button"
          className="node-loop-warning-fix"
          onClick={(e) => {
            e.stopPropagation();
            onFix();
          }}
        >
          Fix the loop
        </button>
      ) : (
        <span className="node-loop-warning-hint">{LOOP_DONE_TAKEN_HINT}</span>
      )}
    </div>
  );
}
