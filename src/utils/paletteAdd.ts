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

export interface PaletteAddDeps {
  /** Screen rect of the canvas wrapper (null while the canvas is not mounted). */
  getBounds: () => { left: number; top: number; width: number; height: number } | null;
  /** React Flow's screenToFlowPosition (null before the instance exists). */
  project: ((point: { x: number; y: number }) => { x: number; y: number }) | null;
  addNode: (template: NodeTemplate, position: { x: number; y: number }) => void;
  isExecView: () => boolean;
  notify: (message: string, kind: 'success' | 'info') => void;
}

/**
 * Add a tapped palette node at the centre of the visible canvas. Returns
 * whether a node was added.
 */
export function addPaletteNodeAtCentre(template: NodeTemplate | null | undefined, deps: PaletteAddDeps): boolean {
  if (!template) return false;
  const bounds = deps.getBounds();
  if (!bounds || !deps.project) return false;
  if (deps.isExecView()) {
    deps.notify('Switch back to the full view to add nodes', 'info');
    return false;
  }
  const position = deps.project({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
  deps.addNode(template, position);
  deps.notify(`Added ${template.label} node`, 'success');
  return true;
}
