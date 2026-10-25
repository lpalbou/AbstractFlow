/**
 * Single-letter file shortcuts: O opens the Flow Library, C opens New flow.
 *
 * Only when focus is on the canvas or on nothing (the page body), never while
 * the person types (an input, a textarea, a select, anything contenteditable)
 * and never while a dialog is open. No modifier: Ctrl/⌘+S (save) and the
 * canvas's Ctrl/⌘+C (copy) keep their meaning.
 */

export type FileShortcut = 'new' | 'open';

/** Where keyboard focus is, as far as the shortcuts care. */
export type FocusPlace = 'body' | 'canvas' | 'editable' | 'other';

/** Anything that reads as a dialog in this app (ours, the kit's, a native one). */
export const DIALOG_SELECTOR =
  '.modal-overlay, [role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], .af-appearance-overlay, .af-connect-overlay';

/** The canvas (components/Canvas.tsx: the React Flow wrapper). */
export const CANVAS_SELECTOR = '.canvas-wrapper';

interface FocusLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

interface DocLike {
  body?: unknown;
  documentElement?: unknown;
  querySelector: (selector: string) => unknown;
}

export function focusPlace(active: FocusLike | null | undefined, doc: Pick<DocLike, 'body' | 'documentElement'>): FocusPlace {
  if (!active || active === doc.body || active === doc.documentElement) return 'body';
  const tag = String(active.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable) return 'editable';
  if (active.closest?.('[contenteditable=""], [contenteditable="true"], [data-no-flow-hotkeys="true"]')) return 'editable';
  if (active.closest?.(CANVAS_SELECTOR)) return 'canvas';
  return 'other';
}

export function dialogOpen(doc: Pick<DocLike, 'querySelector'>): boolean {
  return Boolean(doc.querySelector(DIALOG_SELECTOR));
}

interface KeyLike {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

/** The shortcut this keystroke means, or null (the guard: modifiers, focus, an open dialog). */
export function fileShortcutFor(e: KeyLike, place: FocusPlace, aDialogIsOpen: boolean): FileShortcut | null {
  if (e.defaultPrevented || e.repeat || e.isComposing) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (aDialogIsOpen) return null;
  if (place !== 'body' && place !== 'canvas') return null;
  const key = String(e.key || '').toLowerCase();
  if (key === 'o') return 'open';
  if (key === 'c') return 'new';
  return null;
}

/** The live check, for a window keydown listener. */
export function fileShortcutFromEvent(e: KeyboardEvent, doc: Document = document): FileShortcut | null {
  return fileShortcutFor(e, focusPlace(doc.activeElement as FocusLike | null, doc), dialogOpen(doc));
}
