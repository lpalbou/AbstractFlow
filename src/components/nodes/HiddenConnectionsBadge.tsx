import { useFlowStore, hiddenConnectionsLabel } from '../../hooks/useFlow';

/**
 * Persistent marker on a node that has connections the canvas cannot draw
 * (a pin the node does not declare — a code node's returned key, a subflow's
 * `child_output` — or a pair the editor's connection rules refuse). They are
 * kept and saved as stored; the tooltip lists them.
 */
export function HiddenConnectionsBadge({ nodeId }: { nodeId: string }) {
  const label = useFlowStore((s) => hiddenConnectionsLabel(s, nodeId));
  return <HiddenConnectionsBadgeView label={label} />;
}

/** Presentational part: `label` is hiddenConnectionsLabel() for the node. */
export function HiddenConnectionsBadgeView({ label }: { label: string }) {
  if (!label) return null;
  const count = label.split('\n').length;
  const title = `${count} hidden connection${count === 1 ? '' : 's'} (kept and saved, not drawn):\n${label}`;
  return (
    <span className="node-hidden-edges-badge nodrag" title={title} aria-label={title}>
      {count} hidden
    </span>
  );
}
