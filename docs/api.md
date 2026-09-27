# API And Contracts

AbstractFlow's public package surface is the npm package `@abstractframework/flow`.

## CLI

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

The installed command is `abstractflow-editor`. See [CLI](cli.md).

Options:

- `--host <host>`: host for the Flow static/proxy server (default `0.0.0.0`).
- `--port <port>`: port for the Flow static/proxy server (default `3003`).
- `--gateway-url <url>`: Gateway target used by the proxy (default `http://127.0.0.1:8080`).
- `--help`, `-h`: print usage.

Environment:

- `HOST`, `PORT`: defaults for `--host` and `--port`.
- `ABSTRACTGATEWAY_URL` or `ABSTRACTFLOW_GATEWAY_URL`: default Gateway target. When neither is set, the server reads `gateway_url` from `~/.abstractflow/gateway_connection.json` if that file exists, then falls back to `http://127.0.0.1:8080`. `--gateway-url` overrides all of these.
- `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1`: let browsers that do not run on the Flow server's machine sign in to another Gateway URL than the configured one. Only enable it behind your own access control.
- `ABSTRACTFLOW_ALLOW_BROWSER_GATEWAY_URL_COOKIE=1`: honor the Gateway URL stored in a browser's session cookie for every browser, not only local ones.
- `ABSTRACTFLOW_TRUST_PROXY_HEADERS=1` (or `ABSTRACTGATEWAY_TRUST_PROXY_HEADERS=1`): name the host from `X-Forwarded-Host` in the message shown when a Gateway URL change is refused. Access decisions never use forwarded headers; they use the connection's own address.

Session cookies are marked `Secure` when the request carries `X-Forwarded-Proto: https`.

## Proxy Contract

The Flow server answers these routes itself:

- `GET /api/health` and `GET /health`: Flow server readiness (`status`, `service`, `mode`, `gateway_url`). No sign-in required.
- `/api/connection/gateway`: browser sign-in (`POST` with `gateway_url`, `gateway_user_id`, `gateway_token`), connection status (`GET`), and sign-out (`DELETE`).

Every other `/api/*` request, including WebSocket upgrades, is proxied to the Gateway of the browser's session. It requires a signed-in browser session (HTTP 401 otherwise) and, for mutating methods, the session's CSRF token (HTTP 403 otherwise). The server replaces browser cookies and `Authorization` with the Gateway session headers.

Forwarding headers on every Gateway-bound request (proxied calls, sign-in, sign-out, the signed-in check, streams, and WebSocket connections):

- `X-Forwarded-For`: the address of the browser's connection to the Flow server.
- `X-AbstractFramework-App-Proxy: abstractflow`.

Browser-supplied `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, `Forwarded`, and `X-AbstractFramework-App-Proxy` headers are dropped, in any letter case. A connection whose address cannot be determined is refused with HTTP 400. The Gateway uses these headers to decide whether a browser runs on its own machine.

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

- `src/utils/gatewayClient.ts`: Gateway HTTP/SSE client helpers.
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
- `src/hooks/useAboutAction.ts`: the About dialog action (app version from `package.json` at build time, Gateway rows from `GET /api/gateway/about` through the ui-kit `gatewayVersionRows` helper).
- `bin/gateway_forwarding.js`: the forwarding headers the Flow server sets on Gateway-bound requests.

Schema pin defaults are stored under `node.data.pinDefaults`, for example
`pinDefaults.resp_schema` on LLM Call and Agent nodes. Gateway persists and
publishes that JSON as part of the VisualFlow document; Runtime decides whether
the pin default is used or overridden by a connected input.

Structured LLM Call and Agent results have two outputs: `response` remains a
string, while `data` is the object that conforms to `resp_schema`. Editors and
clients should wire `data` into Break Object, Switch, or other object-aware
nodes when schema fields are needed.
