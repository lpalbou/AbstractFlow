import { create } from 'zustand';

/**
 * The flow being opened (round 8, R8.3): ONE loading state for every way a
 * flow opens from the gateway — a `?bundle=` deep link and Open (the flow
 * library). `begin(name)` returns the AbortSignal the loader threads into its
 * gateway requests; Cancel aborts them and the editor keeps the flow it had.
 * A newer `begin` cancels the older load (only the last request wins).
 */
interface FlowLoadingState {
  name: string | null;
  controller: AbortController | null;
  begin: (name: string) => AbortSignal;
  /** Clears the screen when `signal` is still the current load. */
  finish: (signal: AbortSignal) => void;
  cancel: () => void;
}

export const useFlowLoading = create<FlowLoadingState>((set, get) => ({
  name: null,
  controller: null,
  begin: (name) => {
    get().controller?.abort();
    const controller = new AbortController();
    set({ name: String(name || '').trim() || 'flow', controller });
    return controller.signal;
  },
  finish: (signal) => {
    if (get().controller?.signal === signal) set({ name: null, controller: null });
  },
  cancel: () => {
    get().controller?.abort();
    set({ name: null, controller: null });
  },
}));

/** True for the rejection an aborted load produces (fetch AbortError). */
export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

/** What the screen calls a deep-linked flow before its manifest is read. */
export function deepLinkLoadingName(link: { bundleId: string; version: string; flowId: string }): string {
  const ref = link.version ? `${link.bundleId}@${link.version}` : link.bundleId;
  return link.flowId ? `${link.flowId} · ${ref}` : ref;
}
