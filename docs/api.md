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
- `/api/gateway/visualflows`
- `/api/gateway/visualflows/{flow_id}/publish`
- `/api/gateway/runs/start`
- `/api/gateway/runs/{run_id}/ledger`
- `/api/gateway/runs/{run_id}/ledger/stream`
- `/api/gateway/runs/{run_id}/artifacts`
- Gateway media catalog and artifact content routes

Flow treats Gateway as the source of truth. Any local fallback must be visible in UI state and should be limited to degraded editor display, not execution.

## VisualFlow JSON

The editor imports and exports VisualFlow JSON. See [visualflow.md](visualflow.md).

Execution semantics are not implemented in this package. Gateway/Runtime execute the workflow after publish/start.

## Frontend Modules

High-value source modules:

- `src/utils/gatewayClient.ts`: Gateway HTTP/SSE client helpers.
- `src/utils/gatewayCatalog.ts`: provider/model/media catalog normalization.
- `src/utils/ledgerEvents.ts`: Gateway ledger to UI execution-event mapping.
- `src/utils/artifactInputs.ts`: artifact references and modality-aware UI helpers.
- `src/components/GatewayConnectionModal.tsx`: browser sign-in UX.
- `src/components/RunFlowModal.tsx`: run start, replay, stream, artifact, progress, and Gateway wait/resume UX, including browser-captured `Listen Voice` audio upload before run resume.
- `src/components/nodes/BaseNode.tsx`: node rendering, connection feedback, and unconnected artifact-input upload affordances.
- `src/types/nodes.ts`: editor node templates and pins.
