/**
 * Forwarding identity for every request the AbstractFlow server sends to the
 * gateway on a browser's behalf — the same rules as the shared
 * `@abstractframework/app-server` proxy (abstractuic, gateway_session_proxy.js):
 *
 *  - `X-Forwarded-For` is the browser connection's real socket peer
 *    (req.socket.remoteAddress, IPv4-mapped IPv6 unwrapped). It OVERWRITES any
 *    client-supplied value: never appended, never passed through. The gateway
 *    trusts that header only from its loopback proxy and uses it to decide
 *    whether the browser runs on the gateway's machine (contract A-2). A
 *    connection whose peer is unknown is refused (400) rather than forwarded
 *    without the header — the gateway would otherwise see only this loopback
 *    proxy and call the browser "this machine".
 *  - `X-AbstractFramework-App-Proxy: abstractflow` marks the request as coming
 *    through an app proxy (the gateway's same-machine fail-safe keys on it,
 *    REVIEW/09). Any client-supplied value is dropped.
 *  - Client-supplied `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP` and
 *    RFC 7239 `Forwarded` never reach the gateway, in any letter case.
 */

export const APP_PROXY_HEADER = 'X-AbstractFramework-App-Proxy';
export const APP_PROXY_NAME = 'abstractflow';
export const UNKNOWN_PEER_DETAIL = 'Cannot determine the client address of this connection';

const CLIENT_FORWARDING_HEADERS = new Set([
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'x-abstractframework-app-proxy',
]);

/**
 * The browser connection's real transport peer, IPv4-mapped IPv6 unwrapped,
 * or '' when unknown. Headers are never read: a client-supplied
 * X-Forwarded-For must not reach the gateway.
 */
export function socketPeerAddress(req) {
  let addr = String(req?.socket?.remoteAddress || '').trim().toLowerCase();
  if (addr.startsWith('::ffff:') && addr.includes('.')) addr = addr.slice(7);
  return addr;
}

/** Headers to add to a request this server builds itself (probe, sign-in, sign-out). */
export function gatewayForwardingHeaders(peer) {
  return { 'X-Forwarded-For': peer, [APP_PROXY_HEADER]: APP_PROXY_NAME };
}

/**
 * For a proxied request whose headers are copied from the browser: drop every
 * client-supplied forwarding header and app-proxy marker (any case), then set
 * X-Forwarded-For to the socket peer and the marker to `abstractflow`.
 * Mutates and returns `headers`.
 */
export function applyGatewayForwarding(headers, peer) {
  for (const key of Object.keys(headers)) {
    if (CLIENT_FORWARDING_HEADERS.has(key.toLowerCase())) delete headers[key];
  }
  headers['x-forwarded-for'] = peer;
  headers['x-abstractframework-app-proxy'] = APP_PROXY_NAME;
  return headers;
}
