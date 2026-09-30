/**
 * Tap-to-add from the node palette.
 *
 * HTML5 drag-and-drop does not exist on touch screens, so on a coarse pointer
 * or a narrow layout (where the palette is a drawer covering the canvas) a tap
 * on a palette chip adds the node at the centre of the visible canvas instead.
 * The palette dispatches the event; the canvas owns placement; the app shell
 * closes the palette drawer.
 */
import type { NodeTemplate } from '../types/nodes';

export const PALETTE_ADD_NODE_EVENT = 'abstractflow:palette-add-node';

/** Layouts where a palette tap adds a node (desktop keeps drag-only). */
export const PALETTE_TAP_ADD_QUERY = '(pointer: coarse), (max-width: 1023.98px)';

export function paletteTapAddsNode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(PALETTE_TAP_ADD_QUERY).matches;
}

export function requestPaletteAdd(template: NodeTemplate): void {
  window.dispatchEvent(new CustomEvent<NodeTemplate>(PALETTE_ADD_NODE_EVENT, { detail: template }));
}
