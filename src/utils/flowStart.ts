/**
 * The canvas start screen (blank document) offers Create Flow and Open Flow.
 * The canvas dispatches the request; the toolbar owns both dialogs and opens
 * the one asked for (the same rule as its own New Flow / Open Flow buttons).
 */
export const NEW_FLOW_EVENT = 'abstractflow:new-flow';
export const OPEN_FLOW_EVENT = 'abstractflow:open-flow';

export function requestNewFlow(): void {
  window.dispatchEvent(new Event(NEW_FLOW_EVENT));
}

export function requestOpenFlow(): void {
  window.dispatchEvent(new Event(OPEN_FLOW_EVENT));
}
