/**
 * Tap vs drag on a canvas node (R15.2).
 *
 * Rule: a pointer interaction that moves beyond the drag threshold is a DRAG
 * and never a select-and-open; a tap / click without movement selects the
 * node and opens its properties — every time, also on a node that is already
 * selected (a selection that did not change used to leave a closed panel
 * closed). Same rule for touch, pen and mouse; only the threshold differs
 * (a finger jitters more than a mouse).
 *
 * Pure: Canvas feeds it the capture-phase pointer events of the canvas
 * wrapper. The tap is DECIDED AT POINTERUP (`up()` returns the tapped node):
 * React Flow's d3-drag drops the browser click after any movement at all, so
 * a 1-3 px trackpad click would never reach onNodeClick. The click that ends
 * a drag is swallowed (`isTap()` false), and while a press is in progress the
 * canvas ignores React Flow's drag-start deselection (`pressing`), so a drag
 * leaves the selection and the panel as they were.
 */

/** Movement (CSS px, screen space) beyond which a press is a drag. */
export const DRAG_THRESHOLD_PX: Readonly<Record<string, number>> = Object.freeze({
  mouse: 4,
  pen: 6,
  touch: 10,
});

export interface GesturePointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

interface Press {
  pointerId: number;
  nodeId: string;
  x: number;
  y: number;
  threshold: number;
  dragged: boolean;
}

export function dragThreshold(pointerType: string): number {
  return DRAG_THRESHOLD_PX[pointerType] ?? DRAG_THRESHOLD_PX.mouse;
}

export class NodeTapTracker {
  private press: Press | null = null;
  /** The node the last finished press was on, and whether it was a drag. */
  private last: { nodeId: string; dragged: boolean } | null = null;

  /** Pointer down on a node (nodeId) or elsewhere (null: forgets any press). */
  down(e: GesturePointer, nodeId: string | null): void {
    this.last = null;
    this.press = nodeId
      ? { pointerId: e.pointerId, nodeId, x: e.clientX, y: e.clientY, threshold: dragThreshold(e.pointerType), dragged: false }
      : null;
  }

  move(e: GesturePointer): void {
    const p = this.press;
    if (!p || p.pointerId !== e.pointerId || p.dragged) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > p.threshold) p.dragged = true;
  }

  /** Pointer up: returns the node id when this press was a TAP on a node, else null. */
  up(e: GesturePointer): string | null {
    const p = this.press;
    if (!p || p.pointerId !== e.pointerId) return null;
    this.move(e);
    this.last = { nodeId: p.nodeId, dragged: p.dragged };
    this.press = null;
    return p.dragged ? null : p.nodeId;
  }

  /** A cancelled press (scroll/pinch took over) is never a tap. */
  cancel(e: GesturePointer): void {
    const p = this.press;
    if (!p || p.pointerId !== e.pointerId) return;
    this.last = { nodeId: p.nodeId, dragged: true };
    this.press = null;
  }

  /** The click on `nodeId` that follows a press: true = tap (select + open), false = it ended a drag. */
  isTap(nodeId: string): boolean {
    const l = this.last ?? (this.press ? { nodeId: this.press.nodeId, dragged: this.press.dragged } : null);
    // A click with no recorded press (keyboard, synthetic) is a tap.
    if (!l) return true;
    return l.nodeId === nodeId && !l.dragged;
  }

  /** Whether the press in progress has become a drag. */
  get dragging(): boolean {
    return Boolean(this.press?.dragged);
  }

  /** A press on a node is in progress (pointer down, not yet up). */
  get pressing(): boolean {
    return this.press !== null;
  }
}
