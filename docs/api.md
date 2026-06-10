# API And Contracts

AbstractFlow's public package surface is the npm package `@abstractframework/flow`.

## CLI

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Options:

- `--host <host>`: host for the Flow static/proxy server.
- `--port <port>`: port for the Flow static/proxy server.
- `--gateway-url <url>`: Gateway target used by the proxy.

Environment:

- `HOST`
- `PORT`
- `ABSTRACTGATEWAY_URL`
- `ABSTRACTFLOW_GATEWAY_URL`
- `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG`
- `ABSTRACTFLOW_TRUST_PROXY_HEADERS`

## Proxy Contract

The Flow server proxies browser calls under `/api/*` to the configured Gateway. The important Gateway surfaces are:

- `/api/gateway/session/login`
- `/api/gateway/me`
- `/api/gateway/discovery/capabilities`
- `/api/gateway/providers`
- `/api/gateway/config/capability-defaults`
- `/api/gateway/visualflows`
- `/api/gateway/visualflows/{flow_id}/publish`
- `/api/gateway/runs/start`
- `/api/gateway/runs/{run_id}/ledger`
- `/api/gateway/runs/{run_id}/ledger/stream`
- `/api/gateway/runs/{run_id}/artifacts`
- Gateway media catalog and artifact content routes

The Workflow Authoring Assistant uses the normal run and ledger routes to start
Gateway planner runs and read their terminal responses.

Flow treats Gateway as the source of truth. Any local fallback must be visible in UI state and should be limited to degraded editor display, not execution.

## VisualFlow JSON

The editor imports and exports VisualFlow JSON. See [visualflow.md](visualflow.md).

Execution semantics are not implemented in this package. Gateway/Runtime execute the workflow after publish/start.

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

Schema pin defaults are stored under `node.data.pinDefaults`, for example
`pinDefaults.resp_schema` on LLM Call and Agent nodes. Gateway persists and
publishes that JSON as part of the VisualFlow document; Runtime decides whether
the pin default is used or overridden by a connected input.

Structured LLM Call and Agent results have two outputs: `response` remains a
string, while `data` is the object that conforms to `resp_schema`. Editors and
clients should wire `data` into Break Object, Switch, or other object-aware
nodes when schema fields are needed.
