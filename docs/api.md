# API And Contracts

AbstractFlow's public package surface is the npm package `@abstractframework/flow`.

## CLI

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

The installed command is `abstractflow-editor`. See [CLI](cli.md).

Options:

- `--gateway-url <url>` (aliases `--gateway`, `--url`): the Gateway the server talks to.
- `--port <n>`: the port to listen on (default `3003`).
- `--host <addr>`: the address to listen on (default `127.0.0.1`).
- `--help`, `-h`: print usage.

An unknown flag or a missing value exits with code 2.

Gateway URL, first match wins:

1. `--gateway-url` (or an alias);
2. `ABSTRACTFLOW_GATEWAY_URL`, then `ABSTRACTGATEWAY_URL` (legacy aliases);
3. `gateway_url` in `~/.abstractflow/gateway_connection.json`, except `http://127.0.0.1:8080`;
4. the local Gateway pointer `~/.abstractframework/gateway.json`;
5. `http://127.0.0.1:8080`.

A URL from 3, 4 or 5 is re-resolved when the Gateway refuses a connection; a flag or environment choice never changes.

Environment (legacy aliases, below the flags):

- `HOST`, `PORT`: defaults for `--host` and `--port`.
- `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1`: let browsers that are not on the Flow server's computer sign in to another Gateway URL than the configured one. Only enable it behind your own access control.
- `ABSTRACTFLOW_ALLOW_BROWSER_GATEWAY_URL_COOKIE=1`: honor the Gateway URL stored in a browser's session cookie for every browser, not only local ones.
- `ABSTRACTFLOW_TRUST_PROXY_HEADERS=1` (or `ABSTRACTGATEWAY_TRUST_PROXY_HEADERS=1`): declare that the server runs behind a reverse proxy you control; a browser-chosen Gateway URL then requires the remote-config switch above.

Session cookies are marked `Secure` when the request came over HTTPS (`X-Forwarded-Proto: https` from a local proxy).

## Serving Under A Base Path

The server is built on `@abstractframework/app-server` and serves the same editor at `/` and under the Gateway at `/apps/flow/`:

- Every response carries `X-AbstractFramework-App: flow; mount=1`. The Gateway serves only an app that announces it.
- From a connection on this computer (the Gateway's proxy), `X-Forwarded-Prefix` sets the base path and `X-Forwarded-For` the browser's address. From any other connection those headers are ignored. A malformed forwarded header from a local connection is refused with HTTP 400.
- The page gets `<base href="<base path>/">` and `base_path` in `window.__ABSTRACT_UI_CONFIG__`. The editor names every same-origin URL relatively (`api/gateway/...`, `./assets/...`), so the same build works at both addresses.
- Session cookies use `Path=<base path>/`. When a browser holds two cookies of the same name, the one with the longest path (sent first) wins. Signing out under `/apps/flow/` also clears the `Path=/` cookies.
- Browser storage keys all start with `abstractflow_`: under the Gateway, every app shares one origin.

## Proxy Contract

The Flow server answers these routes itself:

- `GET /api/health` and `GET /health`: Flow server readiness (`status`, `service`, `mode`, `gateway_url`, `base_path`). No sign-in required.
- `/api/connection/gateway`: browser sign-in (`POST` with `gateway_url`, `gateway_user_id`, `gateway_token`, `persist`), connection status (`GET`: `ok`, `gateway_url`, `has_session`, `gateway`), and sign-out (`DELETE`).

Every other `/api/*` request is forwarded to the Gateway of the browser's session. It requires a signed-in browser session (HTTP 401 otherwise) and, for mutating methods, the session's CSRF token in `X-AbstractFlow-CSRF` or `X-Abstract-CSRF` (HTTP 403 otherwise). The server replaces browser cookies and `Authorization` with the Gateway session headers. WebSocket upgrades are refused.

Forwarding headers on every Gateway-bound request (forwarded calls, sign-in, sign-out, the signed-in check and streams):

- `X-Forwarded-For`: the browser's address (the connection's address, or the address the Gateway's `/apps/flow/` proxy forwarded).
- `X-AbstractFramework-App-Proxy: abstractflow`.

Browser-supplied `X-Forwarded-*`, `X-Real-IP`, `Forwarded` and `X-AbstractFramework-App-Proxy` headers never reach the Gateway. A connection whose address cannot be determined is refused with HTTP 400. The Gateway uses these headers to decide whether a browser runs on its own computer.

The important Gateway surfaces are:

- `/api/gateway/session/login`
- `/api/gateway/me`
- `/api/gateway/about` (versions shown in the About dialog)
- `/api/gateway/discovery/capabilities`
- `/api/gateway/providers`
- `/api/gateway/config/capability-defaults`
- `/api/gateway/visualflows`
- `/api/gateway/visualflows/{flow_id}` (`PUT` also stores `automation_defaults`)
- `/api/gateway/visualflows/{flow_id}/publish`
- `/api/gateway/trigger-sources` (automation trigger sources; the path is read from `contracts.common.automations.trigger_sources_endpoint` when the capabilities advertise it)
- `/api/gateway/runs/start`
- `/api/gateway/runs/{run_id}/ledger`
- `/api/gateway/runs/{run_id}/ledger/stream`
- `/api/gateway/runs/{run_id}/artifacts`
- Gateway media catalog and artifact content routes

The Workflow Authoring Assistant uses the normal run and ledger routes to start
Gateway planner runs and read their terminal responses.

Flow treats Gateway as the source of truth. Any local fallback must be visible in UI state and should be limited to degraded editor display, not execution.

For error messages returned by these routes, see [Troubleshooting](troubleshooting.md).

## VisualFlow JSON

The editor imports and exports VisualFlow JSON. See [visualflow.md](visualflow.md), including [Interfaces](visualflow.md#interfaces) for the boundary pins each declared interface requires.

Execution semantics are not implemented in this package. Gateway/Runtime execute the workflow after publish/start.

The optional `automation_defaults` field is described in [VisualFlow JSON > Automation Defaults](visualflow.md#automation-defaults).

## Frontend Modules

High-value source modules:

- `src/utils/gatewayClient.ts`: Gateway HTTP/SSE client helpers; `gatewayRequestPath` turns an advertised `/api/gateway/...` endpoint into the relative `api/gateway/...` request path.
- `src/utils/flowAuthoringCommands.ts`: typed Workflow Authoring Assistant command validation and graph mutation helpers.
- `src/utils/gatewayCatalog.ts`: provider/model/media catalog normalization.
- `src/utils/ledgerEvents.ts`: Gateway ledger to UI execution-event mapping.
- `src/utils/artifactInputs.ts`: artifact references and modality-aware UI helpers.
- `src/utils/jsonSchemaEditor.ts`: shared JSON Schema builder helpers, including Choice/enum round-tripping.
- `src/components/GatewayConnectionModal.tsx`: browser sign-in UX.
- `src/components/AuthoringAssistantDrawer.tsx`: right-drawer conversational workflow authoring assistant.
- `src/components/RunFlowModal.tsx`: run start, replay, stream, artifact, progress, and Gateway wait/resume UX, including browser-captured `Listen Voice` audio upload before run resume.
- `src/components/JsonSchemaEditor.tsx` and `src/components/JsonSchemaPinEditorModal.tsx`: inline schema-pin editing for unconnected JSON Schema inputs.
- `src/components/nodes/BaseNode.tsx`: node rendering, connection feedback, unconnected artifact-input upload affordances, and schema-pin edit buttons.
- `src/types/nodes.ts`: editor node templates and pins.
- `src/utils/flowFamilies.ts`: the known interfaces (`KNOWN_INTERFACES`) with their typed boundary pins, `applyInterfacePins` / `missingInterfacePins`, and the Flow Library family index.
- `src/utils/preflight.ts`: Run preflight checks, including the interface pin warnings.
- `src/hooks/useFlow.ts`: the editor store; `loadFlow` adds missing interface pins and keeps connections the canvas cannot draw (`preservedEdges`, `loadEdgeNotice`).
- `src/hooks/openFlowMetadata.ts`: applies a Flow Library name, description, interface or automation-defaults change to the open document only when that document is still open; `putAutomationDefaults` checks that the Gateway's answer echoes the stored `automation_defaults`.
- `src/utils/triggerSources.ts`: trigger-source discovery (`fetchTriggerSources`, `TriggerSourceCache`), contract parsing, and the `ok` / `unavailable` outcomes.
- `src/utils/triggerBindings.ts`: the `automation_defaults` shape (`parseAutomationDefaults`), the JSON Schema subset validator (`validateTriggerConfig`, `unsupportedSchemaKeywords`), and the schema-driven form conversion.
- `src/components/AutomationDefaultsModal.tsx`: the Flow Library **Automation** dialog.
- `src/hooks/useAboutAction.ts`: the About dialog action (app version from `package.json` at build time; the framework and gateway versions from `GET /api/gateway/about` through the ui-kit `aboutVersionsFromGateway` helper; no package list).
- `bin/server.js`: the Flow server (`createFlowServer`) on `@abstractframework/app-server`: base path, identity header, session proxy, static files.
- `bin/flags.js`: the launch flags and the Gateway URL resolution (`parseFlowFlags`).
- `scripts/check_relative_urls.mjs`: run by `npm run build`; fails on any app-absolute `/api/` or `/assets/` URL in `src/` or `dist/`.

Schema pin defaults are stored under `node.data.pinDefaults`, for example
`pinDefaults.resp_schema` on LLM Call and Agent nodes. Gateway persists and
publishes that JSON as part of the VisualFlow document; Runtime decides whether
the pin default is used or overridden by a connected input.

Structured LLM Call and Agent results have two outputs: `response` remains a
string, while `data` is the object that conforms to `resp_schema`. Editors and
clients should wire `data` into Break Object, Switch, or other object-aware
nodes when schema fields are needed.
