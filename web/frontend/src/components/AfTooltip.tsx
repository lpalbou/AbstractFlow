import type { ReactNode } from 'react';

export type AfTooltipPlacement = 'top';

export function AfTooltip({
  content,
  delayMs = 1000,
  maxWidthPx = 520,
  placement = 'top',
  block = false,
  children,
}: {
  content?: string;
  delayMs?: number;
  maxWidthPx?: number;
  placement?: AfTooltipPlacement;
  block?: boolean;
  children: ReactNode;
}) {
  const text = typeof content === 'string' ? content.trim() : '';
  const show = Boolean(text);

  // Keep wrapper always present so layout/drag behavior is stable.
  return (
    <div
      className={block ? 'af-tooltip-wrap af-tooltip-block' : 'af-tooltip-wrap'}
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--af-tooltip-delay' as any]: `${Math.max(0, delayMs)}ms`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--af-tooltip-max-width' as any]: `${Math.max(120, maxWidthPx)}px`,
      }}
      data-placement={placement}
    >
      {children}
      {show ? <div className="af-tooltip-bubble">{text}</div> : null}
    </div>
  );
}

export default AfTooltip;


