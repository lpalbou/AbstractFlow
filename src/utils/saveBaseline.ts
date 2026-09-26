/**
 * What counts as "saved" — the baseline the dirty flag is measured against.
 *
 * `hasUnsavedChanges` is `flowSignatureFor(getFlow()) !== savedFlowSignature`.
 * Only `getFlow()` produces the left-hand side, so the baseline on the right
 * MUST be something `getFlow()` can reproduce. Two ways that has been violated,
 * both of which silently lie to the user about whether their work is safe:
 *
 *  - Building the baseline from the server's response. The gateway echoes the
 *    stored `description`; the editor store has no description field, so
 *    `getFlow()` always emits none. Every flow with a description came back
 *    from a *successful* save still showing the amber dirty dot, and Run
 *    refused it with "Save the flow before running current changes" — forever.
 *
 *  - Re-baselining to the CURRENT graph when `flowId` transitions after a
 *    create. Edits made while the POST was in flight (by the user, or by the
 *    authoring assistant's loop) get declared already-saved: dot clears, Save
 *    disables, the unload guard unregisters, the local draft is dropped. That
 *    delta is then unrecoverable, and it fires precisely once per document —
 *    on the first save, at the end of a long authoring session.
 */

import type { VisualFlow } from '../types/flow';

/**
 * The document to sign as "saved": exactly the bytes that were sent, with only
 * the gateway-assigned id adopted. Never the server's echo of other fields.
 */
export function savedBaselineSnapshot(sentFlow: VisualFlow, savedId: string | null): VisualFlow {
  return {
    ...sentFlow,
    id: savedId || sentFlow.id,
  };
}

export interface RebaselineInput {
  /** The flowId the editor is transitioning to (null = unsaved document). */
  nextFlowId: string | null;
  /** The canvas has no nodes and no edges. */
  isEmptyFlow: boolean;
  /** A create just published its own baseline; this transition is its echo. */
  saveJustSucceeded: boolean;
  /**
   * The flow id a load just published its own baseline for (the document AS
   * STORED), or null. When it is this transition's flow, the load's baseline
   * stands: re-baselining to the current graph would hide the pins the load
   * added for the flow's interfaces (the flow must open with unsaved changes).
   */
  loadBaselineFlowId?: string | null;
}

/**
 * May the identity-change effect overwrite the saved baseline?
 *
 * Yes for identity changes the effect actually owns — import, new, delete.
 * No when a save or a load already published the authoritative baseline.
 */
export function shouldRebaselineOnIdentityChange(input: RebaselineInput): boolean {
  if (input.saveJustSucceeded) return false;
  if (input.loadBaselineFlowId != null && input.loadBaselineFlowId === input.nextFlowId) return false;
  return Boolean(input.nextFlowId) || input.isEmptyFlow;
}
