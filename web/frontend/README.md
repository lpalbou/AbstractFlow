# @abstractframework/flow (AbstractFlow Visual Editor UI)

This package ships the **browser UI** for the AbstractFlow visual editor (React + ReactFlow).

It is designed to run alongside the **editor backend** (FastAPI), which provides `/api/*` endpoints for:
- saving/loading flows
- running flows (WebSocket streaming)
- configuring the optional AbstractGateway connection

## Quick start

Terminal 1 (backend):

```bash
pip install "abstractflow[server,agent]"
abstractflow serve --reload --port 8080
```

Terminal 2 (UI):

```bash
npx @abstractframework/flow
```

Open: http://localhost:3003

## CLI options

```bash
npx @abstractframework/flow --port 3003 --host 0.0.0.0 --backend-url http://127.0.0.1:8080
```

Environment variables:
- `PORT`, `HOST`
- `ABSTRACTFLOW_BACKEND_URL` (or `BACKEND_URL`)

## AbstractGateway (optional)

If you run an AbstractGateway (default: http://127.0.0.1:8081), configure it from the UI “Connect” modal.

Gateway is required for embeddings-backed memory/KG features and “publish to gateway” flows.
