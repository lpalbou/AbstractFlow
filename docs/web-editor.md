# Visual editor (reference app in `web/`)

This repository includes a reference visual editor:
- FastAPI backend: `web/backend/`
- React frontend: `web/frontend/`

It is intended for development and as a reference host for executing VisualFlows. For convenience, the backend is also shipped as an **optional** part of the Python package (`abstractflow[editor]` / `abstractflow[server]`).

See also: `docs/getting-started.md`, `docs/faq.md`, `docs/visualflow.md`, `docs/architecture.md`.

## Run (recommended: PyPI + npx)

Terminal 1 (backend):

```bash
python -m venv .venv
source .venv/bin/activate
pip install "abstractflow[editor]"

abstractflow serve --reload --port 8080
```

Alternative entrypoint (equivalent):

```bash
abstractflow-backend --reload --port 8080
```

Terminal 2 (UI):

```bash
npx @abstractframework/flow
```

Notes:
- The UI expects `/api/*` on the same origin; the `npx` server proxies `/api/*` (HTTP + WebSocket) to the backend (default: `http://127.0.0.1:8080`).
- Override the backend target with `--backend-url ...` (or env `ABSTRACTFLOW_BACKEND_URL`).
- `abstractflow[editor]` is equivalent to installing `abstractflow[server]` + `abstractflow[agent]` together.

Open:
- UI: http://localhost:3003
- Backend health: http://localhost:8080/api/health

## Run (from source / dev mode)

Terminal 1 (backend):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[server,agent]"

cd web
python -m backend --reload --port 8080
```

Terminal 2 (frontend):

```bash
cd web/frontend
npm install
npm run dev
```

Open:
- Frontend: http://localhost:3003 (Vite dev server; see `web/frontend/package.json`)
- Backend: http://localhost:8080/api/health (FastAPI; see `web/backend/main.py`)

## Run (single-process “production” mode)

Build the frontend and let the backend serve it:

```bash
cd web/frontend
npm install
npm run build

cd ../
python -m backend --port 8080
```

Evidence: `web/backend/main.py` serves `web/frontend/dist` when it exists.

## Where data is stored

- Flows: `./flows/*.json` relative to the backend working directory.
  - Override with `ABSTRACTFLOW_FLOWS_DIR` (recommended when using the packaged backend).
  - Evidence: `FLOWS_DIR` in `web/backend/routes/flows.py`.
- Runtime persistence (runs/ledger/artifacts): defaults to:
  - source checkout: `web/runtime/`
  - installed package: `~/.abstractflow/runtime`
  - Override with `ABSTRACTFLOW_RUNTIME_DIR`.
  - Evidence: `web/backend/services/paths.py`, `web/backend/services/runtime_stores.py`.

## Gateway connectivity (optional)

The backend can talk to an AbstractGateway for embeddings-backed memory KG operations and bundle publishing/reload.

Common env vars / flags:
- `ABSTRACTFLOW_GATEWAY_URL` (or `ABSTRACTGATEWAY_URL`)
- `ABSTRACTGATEWAY_AUTH_TOKEN` (legacy: `ABSTRACTFLOW_GATEWAY_AUTH_TOKEN`)
- CLI flags: `abstractflow serve --gateway-url ... --gateway-token ...` (or `python -m backend ...`) (see `web/backend/cli.py`)

Evidence:
- UI modal: `web/frontend/src/components/GatewayConnectionModal.tsx`
- Backend persistence + env bootstrap: `web/backend/services/gateway_connection.py`
- Embeddings config check + KG embedder wiring: `web/backend/routes/connection.py`, `web/backend/routes/memory_kg.py`
- Bundle upload/reload on publish: `web/backend/routes/flows.py`

## Tools (AbstractCore)

Tool lists shown in the editor come from the backend:
- HTTP endpoint: `GET /api/tools` (`web/backend/routes/tools.py`)
- Execution: tool calls are run by the host tool executor (`abstractflow/visual/workspace_scoped_tools.py`)

By default, the backend exposes a safe set of “common tools” (files/web/system) from `abstractcore[tools]`.

### Comms tools (opt-in)

Email/WhatsApp/Telegram tools are **disabled by default**. Enable explicitly on the backend:

```bash
ABSTRACT_ENABLE_COMMS_TOOLS=1 abstractflow serve --port 8080
```

Or enable specific subsets:
- `ABSTRACT_ENABLE_EMAIL_TOOLS=1`
- `ABSTRACT_ENABLE_WHATSAPP_TOOLS=1`
- `ABSTRACT_ENABLE_TELEGRAM_TOOLS=1`

Notes:
- These tools require additional AbstractCore configuration (credentials, accounts). See `abstractcore/tools/comms_tools.py` and `abstractcore/tools/telegram_tools.py` in the AbstractCore repo.
- You must restart the backend after changing env vars so `/api/tools` reflects the new toolsets.

## WebSocket execution

The Run UI uses WebSocket messages:
- `{ "type": "run", "input_data": {…} }`
- `{ "type": "resume", "response": "…" }`
- `{ "type": "control", "action": "pause|resume|cancel", "run_id": "…" }`

Evidence: `web/backend/routes/ws.py`.
