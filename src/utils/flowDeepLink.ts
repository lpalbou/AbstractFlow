/**
 * Open one flow of the Flow library from a link (the gateway console's
 * Triggers page: the name of a flow that handles a trigger opens it here).
 *
 *   <flow>/?flow=<visualflow id>
 *
 * Standalone (http://127.0.0.1:3005/?flow=…) and through the gateway
 * (/apps/flow/?flow=…) alike. The id is the library flow's id: the gateway
 * keeps it in a published bundle's manifest (`metadata.source.root_flow_id`).
 * Once the gateway connection is up, the toolbar removes the parameter from
 * the address (a reload does not reopen it) and opens that flow through the
 * library's own load path. A flow that is not in the library says so in a
 * toast.
 *
 * `?bundle=<id>&version=<v>&flow=<flow id>` is the bundle link
 * (utils/bundleDeepLink.ts): there `flow` names a flow inside the bundle, so
 * a link with `bundle` is never read as a library link.
 */

export const FLOW_PARAM = 'flow';

export const FLOW_LINK_MISSING_ID = 'This link does not name a flow: it needs ?flow=<flow id>.';

export interface FlowLink {
  flowId: string;
}

/** `null` when the page was opened without `?flow=` (or with a bundle link, which owns `flow`). */
export function parseFlowLink(search: string): FlowLink | { error: string } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return null;
  }
  if (params.has('bundle') || !params.has(FLOW_PARAM)) return null;
  const flowId = String(params.get(FLOW_PARAM) || '').trim();
  return flowId ? { flowId } : { error: FLOW_LINK_MISSING_ID };
}

/** The same address without `?flow=` (other parameters and the hash kept), relative to the origin. */
export function withoutFlowParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FLOW_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The toast when the library has no flow with that id (HTTP 404). */
export function flowLinkNotFound(flowId: string): string {
  return `The flow ${flowId} is not in your Flow library any more.`;
}
