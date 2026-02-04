# Visual editor (reference app in `web/`)

This repository includes a reference visual editor:
- FastAPI backend: `web/backend/`
- React frontend: `web/frontend/`

It is intended for development and as a reference host for executing VisualFlows. It is not packaged as an installable Python module on PyPI.

See also: `docs/getting-started.md`, `docs/faq.md`, `docs/visualflow.md`, `docs/architecture.md`.

## Run (dev mode)

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
  - If you run the backend from `web/`, that becomes `web/flows/`.
  - Evidence: `FLOWS_DIR = Path("./flows")` in `web/backend/routes/flows.py`.
- Runtime persistence (runs/ledger/artifacts): defaults to `web/runtime/`.
  - Override with `ABSTRACTFLOW_RUNTIME_DIR`.
  - Evidence: `web/backend/services/runtime_stores.py`.

## Gateway connectivity (optional)

The backend can talk to an AbstractGateway for provider/model catalogs and remote execution.

Common env vars / flags:
- `ABSTRACTFLOW_GATEWAY_URL` (or `ABSTRACTGATEWAY_URL`)
- `ABSTRACTGATEWAY_AUTH_TOKEN` (legacy: `ABSTRACTFLOW_GATEWAY_AUTH_TOKEN`)
- CLI flags: `python -m backend --gateway-url ... --gateway-token ...` (see `web/backend/cli.py`)

Evidence: `web/backend/services/gateway_connection.py`, `abstractflow/visual/executor.py`.

## WebSocket execution

The Run UI uses WebSocket messages:
- `{ "type": "run", "input_data": {…} }`
- `{ "type": "resume", "response": "…" }`
- `{ "type": "control", "action": "pause|resume|cancel", "run_id": "…" }`

Evidence: `web/backend/routes/ws.py`.
