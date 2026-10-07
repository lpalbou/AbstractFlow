/**
 * Run status glyph on a canvas card header (R14-W8): the status colour (the
 * kit's --success / --info / --warning / --error on the card frame) is never
 * the only signal — the header also draws a kit icon with the status name as
 * its accessible label and tooltip.
 */
import { AfTooltip, Icon, type IconName } from '@abstractframework/ui-kit';

export type NodeRunStatus = 'running' | 'waiting' | 'failed' | 'done';

export const NODE_STATUS_GLYPH: Readonly<Record<NodeRunStatus, { icon: IconName; label: string }>> = {
  running: { icon: 'loader', label: 'Running' },
  waiting: { icon: 'pause', label: 'Waiting' },
  failed: { icon: 'warning', label: 'Failed' },
  done: { icon: 'check', label: 'Done' },
};

export function NodeStatusGlyph({ status }: { status?: NodeRunStatus | string }) {
  const glyph = status ? NODE_STATUS_GLYPH[status as NodeRunStatus] : undefined;
  if (!glyph) return null;
  return (
    <AfTooltip content={glyph.label}>
      <span className={`node-status-glyph node-status-glyph--${status}`} role="img" aria-label={glyph.label}>
        <Icon name={glyph.icon} size={14} aria-hidden="true" />
      </span>
    </AfTooltip>
  );
}
