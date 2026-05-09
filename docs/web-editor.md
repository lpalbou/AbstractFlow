# Visual editor (Gateway-first)

This repository includes a reference visual editor:
- React frontend: `web/frontend/`
- Gateway proxy/static server: `@abstractframework/flow`
- Legacy/dev FastAPI host: `web/backend/`

The primary runtime host is now AbstractGateway. The editor saves VisualFlow JSON through Gateway, publishes `.flow` bundles there, starts runs through Gateway, and renders Gateway ledger/artifact/history streams.

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
- Use `ABSTRACTGATEWAY_URL` / `ABSTRACTFLOW_GATEWAY_URL` or `--gateway-url` to point at a non-default Gateway.
- `--backend-url` and `ABSTRACTFLOW_BACKEND_URL` remain legacy fallbacks.

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

## Run (legacy/dev FastAPI host)

The Python host still serves the built UI and now proxies `/api/gateway/*` to AbstractGateway with server-side auth injection:

```bash
cd web/frontend
npm install
npm run build

cd ../
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
python -m backend --port 3003 --gateway-url http://127.0.0.1:8080
```

Evidence: [../web/backend/main.py](../web/backend/main.py) serves `web/frontend/dist` when it exists and proxies Gateway API calls.

## Where data is stored

- Gateway stores VisualFlows, bundles, runs, ledgers, workspaces, attachments, and artifacts in its configured data directories.
- The legacy FastAPI host still has local storage knobs (`ABSTRACTFLOW_FLOWS_DIR`, `ABSTRACTFLOW_RUNTIME_DIR`) for old `/api/flows` and WebSocket paths.

## Gateway connectivity and auth

Gateway connectivity is required for the modern editor path.

Common env vars / flags:
- `ABSTRACTGATEWAY_URL` (default `http://127.0.0.1:8080`)
- `ABSTRACTGATEWAY_AUTH_TOKEN`
- UI CLI flags: `npx @abstractframework/flow --gateway-url ... --gateway-token ...`
- Python host flags: `abstractflow serve --gateway-url ... --gateway-token ...` (or `python -m backend ...`)

If no gateway token is available, the static Flow server and Python host fail fast with a clear error telling you to export `ABSTRACTGATEWAY_AUTH_TOKEN` or pass `--gateway-token`.

Evidence:
- UI modal: [../web/frontend/src/components/GatewayConnectionModal.tsx](../web/frontend/src/components/GatewayConnectionModal.tsx)
- Backend persistence + env bootstrap: [../web/backend/services/gateway_connection.py](../web/backend/services/gateway_connection.py)
- Embeddings config check + KG embedder wiring: [../web/backend/routes/connection.py](../web/backend/routes/connection.py), [../web/backend/routes/memory_kg.py](../web/backend/routes/memory_kg.py)
- Gateway proxy auth injection: [../web/frontend/bin/cli.js](../web/frontend/bin/cli.js), [../web/frontend/vite.config.ts](../web/frontend/vite.config.ts), [../web/backend/main.py](../web/backend/main.py)

## Tools (AbstractCore)

Tool lists shown in the editor come from Gateway:
- HTTP endpoint: `GET /api/gateway/discovery/tools`
- Execution: tool calls are run by the Gateway/Runtime host tool executor.

By default, the backend exposes a conservative tool set derived from AbstractRuntime’s “default tools” list, plus a small number of extra safe web helpers.

To add or customize tools, update the host:
- Tool discovery (`GET /api/tools`): `web/backend/routes/tools.py`
- Tool execution (workspace scoping + mapping executor): `abstractflow/visual/workspace_scoped_tools.py`

Evidence: [../web/backend/routes/tools.py](../web/backend/routes/tools.py), [../abstractflow/visual/workspace_scoped_tools.py](../abstractflow/visual/workspace_scoped_tools.py).

## Run execution

The Run UI uses Gateway's replay-first HTTP/SSE contract:
- publish: `POST /api/gateway/visualflows/{flow_id}/publish`
- input schema: `GET /api/gateway/bundles/{bundle_id}/flows/{flow_id}/input_schema`
- start: `POST /api/gateway/runs/start`
- commands: `POST /api/gateway/commands`
- stream: `GET /api/gateway/runs/{run_id}/ledger/stream`
- artifacts: `GET /api/gateway/runs/{run_id}/artifacts/{artifact_id}/content`

The legacy WebSocket host still exists in [../web/backend/routes/ws.py](../web/backend/routes/ws.py) for development/reference use.
