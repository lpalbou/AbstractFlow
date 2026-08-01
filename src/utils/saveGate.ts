/**
 * When the Save button is disabled, and what it says.
 *
 * The rule this file exists to enforce: a flow with unsaved changes NEVER gets
 * a dead Save button. The toolbar shows an orange dirty dot the moment the
 * graph diverges from the last saved signature; if the button is also disabled
 * at that moment, the user is told "you have unsaved work" and then given a
 * control that swallows every click in silence. That is exactly how a whole
 * authored workflow looked unsaveable while the gateway session was expired —
 * the explaining toasts live inside the click handler a disabled button never
 * calls, and the button healed on its own once capability discovery recovered.
 *
 * So: block the click only for the two states where a click has nothing to do
 * (nothing changed, or a save is already in flight). Everything else — gateway
 * unavailable, read-only bundled family — stays clickable and is explained by
 * the handler.
 */

export interface SaveGateInput {
  /** A save request is already in flight. */
  savePending: boolean;
  /** The canvas has no nodes and no edges. */
  isEmptyFlow: boolean;
  /** The graph differs from the last saved signature (drives the dirty dot). */
  hasUnsavedChanges: boolean;
  /** Gateway VisualFlow CRUD is not currently usable. */
  crudUnavailable: boolean;
  /** Why CRUD is unusable (shown to the user, so it must be specific). */
  crudUnavailableReason: string;
  /** The editor holds a read-only bundled workflow family. */
  bundledReadOnly: boolean;
}

/**
 * True only when clicking Save could not possibly do or explain anything.
 *
 * Deliberately independent of `crudUnavailable` and `bundledReadOnly`: those
 * are reasons the save will FAIL, not reasons to refuse the click, and the
 * click is the only thing that surfaces them.
 */
export function saveButtonDisabled(input: SaveGateInput): boolean {
  return input.savePending || input.isEmptyFlow || !input.hasUnsavedChanges;
}

/** Tooltip / accessible hint for the Save button, most specific reason first. */
export function saveGateTooltip(input: SaveGateInput): string {
  if (input.crudUnavailable) {
    return input.crudUnavailableReason || 'Gateway VisualFlow storage is unavailable';
  }
  if (input.bundledReadOnly) {
    return 'Bundled workflow families are read-only; run the shipped bundle or create an editable family copy separately';
  }
  if (input.isEmptyFlow) return 'Add at least one node before saving';
  if (!input.hasUnsavedChanges) return 'No unsaved changes';
  return 'Save Flow (Ctrl/⌘+S)';
}

/**
 * The invariant, as a predicate: unsaved work must always have a live button.
 * Exported so the regression test states the rule rather than the branches.
 */
export function dirtyFlowHasClickableSave(input: SaveGateInput): boolean {
  if (!input.hasUnsavedChanges || input.savePending) return true;
  return !saveButtonDisabled(input);
}
