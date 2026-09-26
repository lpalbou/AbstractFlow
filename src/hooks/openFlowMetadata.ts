/**
 * Metadata PUTs (name, interfaces) against a flow that may be open in the
 * editor. The request is async: by the time it returns the user may have
 * opened another flow, re-opened this one, or started a new document. The
 * result is applied to the editor ONLY when the same document instance is
 * still open (same flow id AND same `draftInstanceId`, which every load and
 * clear renews) — otherwise flow A's interfaces and pins would land in flow B.
 */
import type { VisualFlow } from '../types/flow';
import { normalizeInterfaces } from '../utils/flowFamilies';
import { useFlowStore } from './useFlow';

export interface OpenFlowMetadataPatch {
  name?: string;
  interfaces?: string[];
}

export interface OpenFlowMetadataResult {
  /** The gateway's answer. */
  updated: VisualFlow;
  /** The patch reached the open document. */
  applied: boolean;
  /**
   * New saved baseline when the editor had no unsaved changes before the
   * request: the pre-request document with the patch (what the gateway now
   * holds). Null = keep the current baseline.
   */
  baseline: VisualFlow | null;
}

/**
 * Run `request` for flow `id`; if that flow was open when the request started
 * and is STILL the open document when it returns, apply `patchFrom(updated)`
 * to the store. `hasUnsavedChanges` is the editor's state at request time.
 */
export async function updateOpenFlowMetadata(options: {
  id: string;
  hasUnsavedChanges: boolean;
  request: () => Promise<VisualFlow>;
  patchFrom: (updated: VisualFlow) => OpenFlowMetadataPatch;
}): Promise<OpenFlowMetadataResult> {
  const before = useFlowStore.getState();
  const ticket =
    before.flowId && before.flowId === options.id
      ? {
          flowId: before.flowId,
          draftInstanceId: before.draftInstanceId,
          // Snapshot BEFORE the request: edits made while it is in flight
          // must stay unsaved (see utils/saveBaseline.ts).
          cleanBefore: options.hasUnsavedChanges ? null : before.getFlow(),
        }
      : null;

  const updated = await options.request();
  if (!ticket) return { updated, applied: false, baseline: null };

  const now = useFlowStore.getState();
  if (now.flowId !== ticket.flowId || now.draftInstanceId !== ticket.draftInstanceId) {
    return { updated, applied: false, baseline: null };
  }
  const patch = options.patchFrom(updated);
  if (patch.name !== undefined) now.setFlowName(patch.name);
  if (patch.interfaces !== undefined) now.setFlowInterfaces(patch.interfaces);
  return {
    updated,
    applied: true,
    baseline: ticket.cleanBefore ? { ...ticket.cleanBefore, ...patch } : null,
  };
}

/** The interfaces a PUT stored — the server's list, never a local guess. */
export function interfacesFromPutResponse(updated: VisualFlow): string[] {
  if (!updated || !Array.isArray(updated.interfaces)) {
    throw new Error('Gateway answered the interfaces update without an interfaces list');
  }
  return normalizeInterfaces(updated.interfaces);
}
