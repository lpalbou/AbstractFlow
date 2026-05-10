# Visual editor (Gateway-first)

This repository includes a reference visual editor:
- React frontend: `web/frontend/`
- Gateway proxy/static server: `@abstractframework/flow`
- Legacy/dev FastAPI host: `web/backend/`

The primary runtime host is now AbstractGateway. The editor saves VisualFlow JSON through Gateway, publishes `.flow` bundles there, starts runs through Gateway, and renders Gateway ledger/artifact/history streams.
Install a host profile (`abstractflow[all-apple]` or `abstractflow[all-gpu]`)
to run the local Python host/proxy stack.

See also: [../README.md](../README.md), [getting-started.md](getting-started.md), [faq.md](faq.md), [visualflow.md](visualflow.md), [architecture.md](architecture.md).

## Run (recommended: AbstractGateway + npx)

Terminal 1 (Gateway):

```bash
python -m venv .venv
source .venv/bin/activate
pip install "abstractgateway[http]" abstractflow

export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway --port 8080
```

Terminal 2 (UI):

```bash
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Notes:
- The browser never needs the bearer token directly. The Flow static server injects `Authorization: Bearer ...` while proxying `/api/*` to Gateway.
- Use `ABSTRACTGATEWAY_URL` or `ABSTRACTFLOW_GATEWAY_URL` (or `--gateway-url`) to point at a non-default Gateway.

Open:
- UI: http://localhost:3003
- Gateway capabilities: http://localhost:8080/api/gateway/discovery/capabilities

## Run (from source / dev mode)

Terminal 1 (Gateway):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
pip install -e ../abstractgateway

export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway --port 8080
```

Terminal 2 (frontend):

```bash
cd web/frontend
npm install
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
npm run dev
```

Open:
- Frontend: http://localhost:3003 or Vite's printed port
- Gateway: http://localhost:8080/api/gateway/discovery/capabilities

## Run (FastAPI Gateway proxy host)

The Python host still serves the built UI and now proxies `/api/gateway/*` to AbstractGateway with server-side auth injection:

```bash
cd web/frontend
npm install
npm run build

cd ../
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
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
- `ABSTRACTGATEWAY_AUTH_TOKEN`
- UI CLI flags: `npx @abstractframework/flow --gateway-url ... --gateway-token ...`
- Python host flags: `abstractflow serve --gateway-url ... --gateway-token ...` (or `python -m backend ...`)

For the modern editor path, if no gateway token is available the static Flow server and Python host fail fast with a clear error telling you to export `ABSTRACTGATEWAY_AUTH_TOKEN` or pass `--gateway-token`.

Evidence:
- UI modal: [../web/frontend/src/components/GatewayConnectionModal.tsx](../web/frontend/src/components/GatewayConnectionModal.tsx)
- Backend persistence + env bootstrap: [../web/backend/services/gateway_connection.py](../web/backend/services/gateway_connection.py)
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
- artifacts: `GET /api/gateway/runs/{run_id}/artifacts/{artifact_id}/content`

The legacy WebSocket host still exists in [../web/backend/routes/ws.py](../web/backend/routes/ws.py) for development/reference use and is mounted only when `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`.
