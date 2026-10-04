# Troubleshooting

This page maps common AbstractFlow symptoms to their cause and fix. For setup
steps, see [Getting started](getting-started.md); for the server options and
environment variables, see [API and contracts](api.md) and [CLI](cli.md); for
recurring conceptual questions, see the [FAQ](faq.md).

Two quick checks help with most problems:

```bash
# Is the Flow server up, and which Gateway does it proxy to?
curl -s http://127.0.0.1:3003/api/health

# Is the Gateway reachable?
curl -s http://127.0.0.1:8080/api/health
```

The Flow health payload reports `status: "healthy"` and the `gateway_url` the
server uses by default.

## Sign-In And Connection

### "Gateway sign-in required" (HTTP 401) on every editor call

- **Cause:** the browser has no Flow session yet, or its session cookie expired
  or was cleared.
- **Fix:** open the connection pill in the top bar and sign in with the Gateway
  URL, your Gateway user id and that user's token. On a first local install the
  user is `admin` and the token is the `agw_...` value stored in
  `$ABSTRACTGATEWAY_DATA_DIR/auth/bootstrap-admin-token`.
- **Verify:** the connection pill shows the signed-in user and the Flow Library
  lists workflows.

See [Web editor > Browser Auth](web-editor.md#browser-auth).

### Sign-in is refused ("Only Gateway user tokens can be used for browser sign-in", "Gateway token resolved to user ...")

- **Cause:** the token is not a Gateway *user* token, or it belongs to another
  user than the user id you entered. Server/operator bearer
  tokens such as `ABSTRACTGATEWAY_AUTH_TOKEN` are not browser sign-in tokens.
  The Gateway must also run with `ABSTRACTGATEWAY_USER_AUTH=1`.
- **Fix:** use the user token for the user id you entered, and start the
  Gateway with user auth enabled as shown in
  [Getting started](getting-started.md#1-start-gateway).

### "Browser-supplied Gateway URL changes are disabled for this non-local Flow connection" (HTTP 403)

- **Cause:** a browser that does not run on the Flow server's machine asked to
  connect to a Gateway URL other than the one the server was started with. The
  Flow server decides this from the connection's own address, so a hosted Flow
  instance proxies only to its configured Gateway.
- **Fix:** keep the server-configured Gateway URL in the connection form, or
  restart the server with the right `--gateway-url`. Operators who deliberately
  want remote browsers to choose a Gateway can set
  `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` behind their own access
  control.

### "Cannot determine the client address of this connection" (HTTP 400)

- **Cause:** the Flow server could not read the address of the browser
  connection, so it cannot tell the Gateway where the browser runs and refuses
  the request instead of forwarding it without that information.
- **Fix:** connect to the Flow server directly or through a reverse proxy that
  opens a normal TCP connection to it. See
  [API and contracts > Proxy Contract](api.md#proxy-contract) for the forwarding
  headers the server sends.

### "Flow browser session CSRF token missing or invalid" (HTTP 403)

- **Cause:** a mutating request (save, publish, run) arrived without the
  session's CSRF cookie, typically after cookies were partially cleared or when
  the page is served from another origin than the Flow server.
- **Fix:** sign out and sign in again from the same origin you use to open the
  editor.

### The Gateway says the Flow Editor "cannot be served at /apps/flow/"

- **Cause:** the running Flow server does not announce
  `X-AbstractFramework-App: flow; mount=1`, which an older
  `@abstractframework/flow` version does not send. The Gateway serves only a
  server that follows the base-path rules.
- **Fix:** update the Flow Editor from the Gateway console (**Apps**), or run a
  current `npx @abstractframework/flow`.

### The editor loads under /apps/flow/ but asks to sign in again

- **Cause:** the editor's session cookies are scoped to `/apps/flow/`; a
  session created at the editor's own port (`http://127.0.0.1:3003/`) is a
  separate session.
- **Fix:** open the editor from the Gateway console (**Apps > Flow Editor >
  Open**), which signs the browser in at `/apps/flow/`.

## Editor Behavior

### A workflow opens with unsaved changes and "Interface pins were added to On Flow Start/End; save to store them"

- **Cause:** the workflow declares an interface (for example
  `abstractcode.agent.v1`) and its `On Flow Start` or `On Flow End` node lacked
  one of the pins that interface requires. The editor adds the missing pins
  when it opens the workflow.
- **Fix:** review the added pins, wire them, and **Save**. After saving, the
  workflow opens without changes.

See [VisualFlow JSON > Interfaces](visualflow.md#interfaces).

### A node shows an "N hidden" badge, or a notice says connections are "kept and saved but not drawn"

- **Cause:** the stored workflow has connections the canvas cannot draw: pins
  resolved by name at run time (a code node's returned keys, a subflow's
  `child_output`) or pairs the editor's connection rules refuse.
- **Fix:** nothing is required. These connections run as stored and are saved
  back unchanged. Hover the badge to list them (`source.pin -> target.pin`).
  They are removed only when you delete one of their nodes.
- **When the notice says connections "were dropped":** the connection points to
  a node that does not exist in the document. Restore the missing node from the
  original file if the connection mattered.

See [Web editor > Hidden Connections](web-editor.md#hidden-connections).

### Run preflight warns about interface pins

| Warning | Meaning | Fix |
|---|---|---|
| `'<pin>' (<type>) is required by <interface>: hosts send/read it` | The boundary node lacks a pin the declared interface requires. | Add the pin (re-declaring the interface adds it) or remove the interface. |
| `'<pin>' is not connected; hosts will read null` | A required `On Flow End` pin has no connection, pin default or pin expression. | Wire the pin to the value the host should receive. |
| `'<pin>' is typed <type>, the interface expects <type>` | The pin exists with another type. | Change the pin type to the one listed in [VisualFlow JSON > Interfaces](visualflow.md#interfaces). |

These warnings are advisory: the workflow still runs, but a host that starts
it through the interface receives missing or mistyped values.

### The About dialog shows "AbstractGateway: unavailable (...)"

- **Cause:** the request to `GET /api/gateway/about` failed. The text in
  parentheses gives the HTTP status or network error. A Gateway release that
  does not serve that route, a signed-out session, or an unreachable Gateway
  all produce this line.
- **Fix:** sign in, check that the Gateway is reachable, and update the Gateway
  if the route returns HTTP 404. The AbstractFlow version shown in the dialog is
  independent of the Gateway.

### Discovery, save, publish or run fail while the editor itself loads

- **Cause:** the Gateway is stopped or unreachable from the Flow server. The
  editor's static UI does not need the Gateway, but every data feature does.
- **Fix:** start the Gateway and confirm the Flow server targets it (the
  `gateway_url` in `/api/health`).

### The Automation dialog cannot save automation defaults

| Message | Cause | Fix |
| --- | --- | --- |
| Trigger sources are unavailable on this gateway / Automations are not available on this gateway | The Gateway does not serve `/api/gateway/trigger-sources` (HTTP 404) or reports automations as unavailable in its capabilities. | Connect to a Gateway with automations enabled, then press **Refresh sources**. |
| Trigger-source discovery failed: ... | The request failed for another reason, or the answer does not match the trigger-source contract. | Check that the Gateway is reachable; the message names the failing field. |
| This source cannot be bound in the editor: its settings schema uses JSON Schema keywords the editor cannot check (...) | The source's `config_schema` uses a keyword or format outside the subset the editor validates. | Choose another source; the listed paths name each unsupported keyword. See [Web editor > Settings Validation](web-editor.md#settings-validation). |
| trigger source "..." is not served / is unavailable / version ... is not served | The stored defaults name a source or version the connected Gateway does not offer. | Pick a served source and save again. |
| Gateway answered the automation defaults update without storing them | The Gateway accepted the update but does not store `automation_defaults`. | Update the Gateway to a release with automations. |

### Edited example flows do not appear in the Flow Library

- **Cause:** the example flows under `examples/flows/` are bundled into the
  editor at build time.
- **Fix:** run `npm run build` again and reload the editor tab.

### Voice is unavailable, or Copy says "Copy failed — select and copy"

- **Cause:** the editor is open over plain `http://` from another machine (a
  LAN or Tailscale address such as `http://100.x.y.z:8080/apps/flow/`).
  Browsers offer the microphone, the camera and the clipboard only on https
  pages or on `localhost`. Over plain http, a voice wait in the run window
  disables **Record** and says why, and **Copy** falls back to a
  text-selection copy that the browser may refuse.
- **Fix:** open the editor over https, or on the gateway's own computer. With
  Tailscale, run `tailscale serve --bg http://127.0.0.1:<port>` on the gateway
  machine and open `https://<host>.<tailnet>.ts.net/apps/flow/`; the gateway
  console's Network page explains the steps. Everything else in the editor
  works over plain http.

## Local Development

### The build cannot resolve `@abstractframework/ui-kit` or a monitor package

- **Cause:** `@abstractframework/ui-kit` installs from npm, so `npm install`
  has not run yet; or the monitor widgets, which a local checkout builds from
  a sibling AbstractUIC checkout at `../abstractuic`, are missing.
- **Fix:**

```bash
git clone https://github.com/lpalbou/AbstractUIC.git ../abstractuic
npm install
npm run build
```

### `npm test` fails to start

- **Cause:** the test runner (Vitest 4) requires Node.js 20 or later.
- **Fix:** use Node.js 20, 22 or 24 (the CI uses 24), then run `npm test`
  again.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contributor workflow.
