/**
 * Metadata PUTs (name, interfaces, automation defaults) against a flow that may be open in the
 * editor. The request is async: by the time it returns the user may have
 * opened another flow, re-opened this one, or started a new document. The
 * result is applied to the editor ONLY when the same document instance is
 * still open (same flow id AND same `draftInstanceId`, which every load and
 * clear renews) — otherwise flow A's interfaces and pins would land in flow B.
 */
import type { AutomationDefaults, VisualFlow } from '../types/flow';
import { normalizeInterfaces } from '../utils/flowFamilies';
import { useFlowStore } from './useFlow';

export interface OpenFlowMetadataPatch {
  name?: string;
  interfaces?: string[];
  /** Null clears the defaults. */
  automation_defaults?: AutomationDefaults | null;
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
  if (patch.automation_defaults !== undefined) now.setFlowAutomationDefaults(patch.automation_defaults);
  return {
    updated,
    applied: true,
    baseline: ticket.cleanBefore ? baselineWith(ticket.cleanBefore, patch) : null,
  };
}

/** The interfaces a PUT stored — the server's list, never a local guess. */
export function interfacesFromPutResponse(updated: VisualFlow): string[] {
  if (!updated || !Array.isArray(updated.interfaces)) {
    throw new Error('Gateway answered the interfaces update without an interfaces list');
  }
  return normalizeInterfaces(updated.interfaces);
}

function baselineWith(flow: VisualFlow, patch: OpenFlowMetadataPatch): VisualFlow {
  const { automation_defaults, ...rest } = patch;
  const next: VisualFlow = { ...flow, ...rest };
  if (automation_defaults === null) delete next.automation_defaults;
  else if (automation_defaults !== undefined) next.automation_defaults = automation_defaults;
  return next;
}

/**
 * PUT a flow's automation defaults and check the answer EVERY time — whether
 * or not the flow is open in the editor (a gateway that drops the field must
 * never read as "saved") — then patch the open document if it is this flow.
 */
export async function putAutomationDefaults(options: {
  id: string;
  next: AutomationDefaults | null;
  hasUnsavedChanges: boolean;
  put: () => Promise<VisualFlow>;
}): Promise<OpenFlowMetadataResult> {
  return updateOpenFlowMetadata({
    id: options.id,
    hasUnsavedChanges: options.hasUnsavedChanges,
    request: async () => {
      const updated = await options.put();
      automationDefaultsFromPutResponse(updated, options.next);
      return updated;
    },
    patchFrom: (updated) => ({ automation_defaults: automationDefaultsFromPutResponse(updated, options.next) }),
  });
}

/**
 * The automation defaults a PUT stored — the server's value, never a local
 * guess. A gateway that answers without echoing the field did not store it
 * (it predates Automations v1): fail loudly instead of showing a save that
 * did not happen.
 */
export function automationDefaultsFromPutResponse(
  updated: VisualFlow,
  sent: AutomationDefaults | null
): AutomationDefaults | null {
  const stored = updated ? (updated as { automation_defaults?: AutomationDefaults | null }).automation_defaults : undefined;
  if (sent === null) {
    if (stored) throw new Error('Gateway kept the automation defaults it was asked to clear');
    return null;
  }
  if (!stored) throw new Error('Gateway answered the automation defaults update without storing them');
  return stored;
}
