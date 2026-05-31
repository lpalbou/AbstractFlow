# Visual editor (Gateway-first)

This repository includes a reference visual editor:
- React frontend: `web/frontend/`
- Gateway proxy/static server: `@abstractframework/flow`
- Legacy/dev FastAPI host: `web/backend/`

The primary runtime host is now AbstractGateway. The editor saves VisualFlow JSON through Gateway, publishes `.flow` bundles there, starts runs through Gateway, and renders Gateway ledger/artifact/history streams.
Install base `abstractgateway` for the remote-light HTTP/SSE host. Use
`abstractflow[apple]` or `abstractflow[gpu]` only when you also need the local
Python compatibility host/profile.

See also: [../README.md](../README.md), [getting-started.md](getting-started.md), [faq.md](faq.md), [visualflow.md](visualflow.md), [architecture.md](architecture.md).

## Run (recommended: AbstractGateway + npx)

Terminal 1 (Gateway):

```bash
python -m venv .venv
source .venv/bin/activate
pip install abstractgateway abstractflow

export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
export ABSTRACTGATEWAY_USER_AUTH=1
abstractgateway serve --port 8080
```

Create a Gateway user for browser sign-in and use the returned token in the
Flow connection modal:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/gateway/admin/users \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"admin","roles":["admin","user"],"runtime_id":"default"}'
```

Terminal 2 (UI):

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Notes:
- The browser signs in with a Gateway user id and that user's token. Flow
  exchanges the token for a Gateway browser session, stores only the opaque
  session id in an HTTP-only Flow cookie, and proxies `/api/*` to Gateway with
  that session. The Flow connection response does not return the Gateway
  session id or CSRF token to browser JavaScript.
- Use `ABSTRACTGATEWAY_URL` or `ABSTRACTFLOW_GATEWAY_URL` (or `--gateway-url`) to point at a non-default Gateway.

Open:
- UI: http://localhost:3003
- Gateway capabilities: http://localhost:8080/api/gateway/discovery/capabilities

## Media nodes

The editor surfaces Gateway media capabilities as native graph nodes:
- `Generate Image`
- `Edit Image` (`Image-to-Image` is a legacy alias for old saved flows)
- `Generate Video`
- `Image-to-Video`
- `Generate Voice`
- `Generate Music`
- `Transcribe Audio`
- `Listen Voice`

Provider/model selectors are populated from Gateway catalog endpoints. Current
Gateway catalog responses may use the `gateway_catalog_v1` envelope (`catalog`
metadata plus canonical `items`) or older legacy arrays/maps; the editor accepts
both. Leave provider/model as `Auto` for the simple path, or choose explicit
provider/model/backend values for reproducible runs. Video nodes use the same
Gateway vision catalog route as image nodes but request task-specific catalogs:
`text_to_video` for prompt-only generation and `image_to_video` for source-image
generation.

If Gateway advertises `common.readiness.contract = gateway_surface_readiness_v1`,
the editor uses that surface summary to hide or disable optional media/model
controls that Gateway says are not route/config ready. The editor still uses the
endpoint descriptors for concrete request paths.

Generated image, video, voice, and music results are Gateway artifacts. The Run
modal renders images, videos, and audio/music players from artifact content and
keeps child run, artifact metadata, ledger, and raw JSON details available for
debugging. The `artifact content` link opens or downloads the payload; writing
artifacts to workspace files belongs in graph-level file/artifact IO nodes, not
in the Run modal. Gateway `abstract.progress` events are surfaced as progress on
the running step so long video generations remain observable.

Model residency controls are also Gateway-driven. If the Gateway advertises
the model-residency routes, text, image, video, voice, transcription, and music
warmup/list/unload authoring remains available through Gateway. Gateway/Runtime
still owns the final support decision and returns skipped/unsupported results
when a connected deployment cannot honor a specific residency operation.

KG memory nodes are gated by Gateway's `common.memory` contract. A correctly
installed Gateway with AbstractMemory and a resolvable backend should expose
those nodes even before the persistent store has been created; empty KG queries
return empty results until a flow asserts triples.

## Run (from source / dev mode)

Terminal 1 (Gateway):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
pip install -e ../abstractgateway

export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
export ABSTRACTGATEWAY_USER_AUTH=1
abstractgateway serve --port 8080
```

Create the browser sign-in user with `/api/gateway/admin/users` as shown in the
recommended run path before opening the dev UI.

Terminal 2 (frontend):

```bash
cd web/frontend
npm install
npm run dev
```

Open:
- Frontend: http://localhost:3003 or Vite's printed port
- Gateway: http://localhost:8080/api/gateway/discovery/capabilities

## Run (FastAPI Gateway proxy host)

The Python host serves the built UI and proxies `/api/gateway/*` to
AbstractGateway with browser-session auth injection:

```bash
cd web/frontend
npm install
npm run build

cd ../
python -m backend --port 3003 --gateway-url http://127.0.0.1:8080
```

By default, this host mounts only the Gateway proxy, connection/config, UI config, and host metrics routes. To expose the old local `/api/flows`, `/api/ws`, `/api/runs`, `/api/providers`, `/api/tools`, `/api/semantics`, and `/api/memory/kg` compatibility routes, set:

```bash
export ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1
```

Evidence: [../web/backend/main.py](../web/backend/main.py) serves `web/frontend/dist` when it exists, proxies Gateway API calls, and gates legacy local runtime routes behind `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME`.

## Where data is stored

- Gateway stores VisualFlows, bundles, runs, ledgers, workspaces, attachments, and artifacts in its configured data directories.
- The FastAPI compatibility routes still have local storage knobs (`ABSTRACTFLOW_FLOWS_DIR`, `ABSTRACTFLOW_RUNTIME_DIR`), but those routes are opt-in with `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`.

## Gateway connectivity and auth

Gateway connectivity is required for the modern editor path.

Common env vars / flags:
- `ABSTRACTGATEWAY_URL` (default `http://127.0.0.1:8080`)
- UI CLI flags: `npx @abstractframework/flow --gateway-url ...`
- Python host flags: `abstractflow serve --gateway-url ...` (or `python -m backend ...`)

For the modern editor path, the Flow server starts with only a Gateway URL.
Each browser signs in with a Gateway URL, Gateway user id, and that user's
Gateway token. Flow validates the token through Gateway `/me`, exchanges it for
a Gateway browser session through `/api/gateway/session/login`, and rejects the
connection if the token resolves to another user or to an admin/server token.
Gateway owns the user's tenant/runtime mapping and returns it as read-only
principal metadata. Flow keeps only the opaque Gateway session id in an
HTTP-only cookie and keeps the CSRF token in a separate browser cookie for
mutating proxy calls. Flow reads those values from Gateway `Set-Cookie` headers
server-side and removes them from the response body; a second browser must sign
in separately. Remote browsers may provide a token for the server-configured
Gateway URL, but may not change the Gateway URL unless
`ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is set after adding your
own access control. Flow uses the request `Host` header for that check by
default; set `ABSTRACTFLOW_TRUST_PROXY_HEADERS=1` only behind a reverse proxy
that strips client-supplied forwarded headers.

Evidence:
- UI modal: [../web/frontend/src/components/GatewayConnectionModal.tsx](../web/frontend/src/components/GatewayConnectionModal.tsx)
- Backend URL persistence + browser session resolution: [../web/backend/services/gateway_connection.py](../web/backend/services/gateway_connection.py)
- Embeddings config check + KG embedder wiring: [../web/backend/routes/connection.py](../web/backend/routes/connection.py), [../web/backend/routes/memory_kg.py](../web/backend/routes/memory_kg.py)
- Gateway proxy auth injection: [../web/frontend/bin/cli.js](../web/frontend/bin/cli.js), [../web/frontend/vite.config.ts](../web/frontend/vite.config.ts), [../web/backend/main.py](../web/backend/main.py)

## Tools (AbstractCore)

Tool lists shown in the editor come from Gateway discovery:
- HTTP endpoint: `GET /api/gateway/discovery/tools`
- Execution: tool calls are run by the Gateway/Runtime host tool executor.

The old local `GET /api/tools` route is available only in the opt-in FastAPI compatibility host. To add or customize tools for the normal editor path, update Gateway's discovery and runtime tool executor.

Evidence: [../web/backend/routes/tools.py](../web/backend/routes/tools.py), [../abstractflow/visual/workspace_scoped_tools.py](../abstractflow/visual/workspace_scoped_tools.py).

## Run execution

The Run UI uses Gateway's replay-first HTTP/SSE contract:
- publish: `POST /api/gateway/visualflows/{flow_id}/publish`
- input schema: `GET /api/gateway/bundles/{bundle_id}/flows/{flow_id}/input_schema`
- start: `POST /api/gateway/runs/start`
- commands: `POST /api/gateway/commands`
- stream: `GET /api/gateway/runs/{run_id}/ledger/stream`
- artifact content: `GET /api/gateway/runs/{run_id}/artifacts/{artifact_id}/content`
- session artifacts: `GET /api/gateway/sessions/{session_id}/artifacts`
- artifact search: `GET /api/gateway/artifacts/search`
- artifact import: `POST /api/gateway/artifacts/import`
- artifact export: `POST /api/gateway/runs/{run_id}/artifacts/{artifact_id}/export`

When a start pin is typed as `artifact`, `artifact_image`, `artifact_audio`,
`artifact_text`, or `artifact_video`, the Run modal submits a structured artifact
ref. Browser files are uploaded through Gateway; server workspace files are
imported through Gateway's workspace policy; existing choices come from Gateway
artifact search when advertised, with a session-list fallback for older
gateways. The search UI can scope to all artifacts or the current session,
filters by the pin's modality, and accepts simple metadata filters.

The legacy WebSocket host still exists in [../web/backend/routes/ws.py](../web/backend/routes/ws.py) for development/reference use and is mounted only when `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`.
