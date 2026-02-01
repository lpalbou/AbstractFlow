import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type AfTooltipPlacement = 'top';

// Global hover arbitration so only one tooltip is visible at a time.
// Pins should take precedence over node-level tooltips.
let _nextTooltipId = 0;
let _hoverSeq = 0;
const _hovered = new Map<string, { priority: number; seq: number }>();
let _topHoveredId: string | null = null;
const _subscribers = new Set<(topId: string | null) => void>();

function _recomputeTopHovered() {
  let bestId: string | null = null;
  let bestPriority = -Infinity;
  let bestSeq = -Infinity;

  for (const [id, meta] of _hovered.entries()) {
    if (meta.priority > bestPriority || (meta.priority === bestPriority && meta.seq > bestSeq)) {
      bestId = id;
      bestPriority = meta.priority;
      bestSeq = meta.seq;
    }
  }

  if (bestId === _topHoveredId) return;
  _topHoveredId = bestId;
  for (const cb of _subscribers) cb(_topHoveredId);
}

function _hoverEnter(id: string, priority: number) {
  _hovered.set(id, { priority, seq: ++_hoverSeq });
  _recomputeTopHovered();
}

function _hoverLeave(id: string) {
  _hovered.delete(id);
  _recomputeTopHovered();
}

function _subscribeTopHovered(cb: (topId: string | null) => void) {
  _subscribers.add(cb);
  // Fire immediately so late subscribers sync.
  cb(_topHoveredId);
  return () => {
    _subscribers.delete(cb);
  };
}

export function AfTooltip({
  content,
  delayMs = 2000,
  maxWidthPx = 520,
  placement = 'top',
  priority = 0,
  block = false,
  children,
}: {
  content?: string;
  delayMs?: number;
  maxWidthPx?: number;
  placement?: AfTooltipPlacement;
  priority?: number;
  block?: boolean;
  children: ReactNode;
}) {
  const text = typeof content === 'string' ? content.trim() : '';
  const show = Boolean(text);

  // Keep wrapper always present so layout/drag behavior is stable.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = `af-tooltip-${++_nextTooltipId}`;
  const tooltipId = idRef.current;

  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    placement: 'top' | 'bottom';
    arrowLeftPct: number;
  } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, [clearTimer]);

  const scheduleOpen = useCallback(() => {
    if (!show) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      // Only the currently hovered "top" tooltip may open.
      if (!hovering) return;
      if (_topHoveredId !== tooltipId) return;
      setOpen(true);
    }, Math.max(0, delayMs));
  }, [clearTimer, delayMs, hovering, show, tooltipId]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    // Ensure global hover state is cleaned up if the component unmounts mid-hover.
    return () => {
      if (show) _hoverLeave(tooltipId);
    };
  }, [show, tooltipId]);

  const computePosition = useCallback(() => {
    const wrap = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!wrap || !bubble) return;

    const rect = wrap.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();

    const viewportW = window.innerWidth || 0;
    const viewportH = window.innerHeight || 0;
    const padding = 10;

    const centerX = rect.left + rect.width / 2;

    const canTop = rect.top >= bubbleRect.height + 14;
    const resolvedPlacement: 'top' | 'bottom' = placement === 'top' ? (canTop ? 'top' : 'bottom') : 'top';

    const minCenter = padding + bubbleRect.width / 2;
    const maxCenter = viewportW - padding - bubbleRect.width / 2;
    const clampedCenterX = Math.min(maxCenter, Math.max(minCenter, centerX));

    // Compute arrow offset so the pointer aligns with the hovered element even when clamped.
    const bubbleLeft = clampedCenterX - bubbleRect.width / 2;
    const arrowLeftPctRaw = bubbleRect.width > 0 ? ((centerX - bubbleLeft) / bubbleRect.width) * 100 : 50;
    const arrowLeftPct = Math.min(92, Math.max(8, arrowLeftPctRaw));

    let top = resolvedPlacement === 'top' ? rect.top - 12 : rect.bottom + 12;
    // Avoid going off-screen vertically in extreme cases (very tall tooltip).
    if (resolvedPlacement === 'top') {
      top = Math.max(padding + bubbleRect.height, top);
    } else {
      top = Math.min(viewportH - padding - bubbleRect.height, top);
      top = Math.max(padding, top);
    }

    setPos({
      left: clampedCenterX,
      top,
      placement: resolvedPlacement,
      arrowLeftPct,
    });
  }, [placement]);

  // When opening, render the bubble first, then measure/reposition.
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
  }, [open, computePosition, text, maxWidthPx]);

  // Keep tooltip positioned correctly while scrolling/resizing.
  useEffect(() => {
    if (!open) return;
    const onReflow = () => computePosition();
    window.addEventListener('resize', onReflow);
    // Capture phase so we catch scrolls from nested containers.
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, computePosition]);

  const bubble = useMemo(() => {
    if (!show || !open) return null;
    if (typeof document === 'undefined') return null;

    const style: CSSProperties = {
      left: pos?.left ?? 0,
      top: pos?.top ?? 0,
      maxWidth: Math.max(120, maxWidthPx),
      ['--af-tooltip-arrow-left' as any]: `${pos?.arrowLeftPct ?? 50}%`,
    };

    // Render in a portal so it cannot be clipped by scroll/overflow containers.
    return createPortal(
      <div
        ref={bubbleRef}
        className="af-tooltip-bubble"
        data-placement={pos?.placement ?? 'top'}
        style={style}
      >
        {text}
      </div>,
      document.body
    );
  }, [maxWidthPx, open, pos, show, text]);

  // Track global hover precedence: when another tooltip becomes "top hovered",
  // close this tooltip and cancel pending timers.
  useEffect(() => {
    if (!show) return;
    return _subscribeTopHovered((topId) => {
      if (!topId) {
        // No active hover target.
        close();
        return;
      }
      if (topId !== tooltipId) {
        close();
        return;
      }
      // We are the top hovered tooltip.
      if (hovering && !open) {
        scheduleOpen();
      }
    });
  }, [close, hovering, open, scheduleOpen, show, tooltipId]);

  return (
    <div
      className={block ? 'af-tooltip-wrap af-tooltip-block' : 'af-tooltip-wrap'}
      ref={wrapRef}
      onMouseEnter={() => {
        if (!show) return;
        setHovering(true);
        _hoverEnter(tooltipId, priority);
        // If we're already the top hovered tooltip, start the timer.
        if (_topHoveredId === tooltipId) scheduleOpen();
      }}
      onMouseLeave={() => {
        if (!show) return;
        setHovering(false);
        _hoverLeave(tooltipId);
        close();
      }}
      onMouseDown={() => {
        if (!show) return;
        close();
      }}
    >
      {children}
      {bubble}
    </div>
  );
}

export default AfTooltip;

