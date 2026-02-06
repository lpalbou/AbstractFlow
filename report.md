#!/usr/bin/env markdown

# Report — AbstractFlow editor vs AbstractGateway (critical assessment)

Date: 2026-02-06  
Scope: explain the current state, why “gateway + `npx @abstractframework/flow`” isn’t sufficient, what commands exist today, and what it would take to run the editor **solely** against AbstractGateway.

---

## 1) Executive summary

- The Visual Editor UI expects an **Editor Backend** at same-origin `/api/*` for:
  - flow CRUD (`/api/flows`)
  - execution streaming (`/api/ws/:flowId`)
  - run history + artifacts (`/api/runs/*`)
  - gateway connection configuration (`/api/connection/gateway`)
  - provider/tool discovery (`/api/providers`, `/api/tools`)
  - Evidence (UI): `web/frontend/src/components/Toolbar.tsx`, `web/frontend/src/hooks/useWebSocket.ts`, plus other `/api/...` calls in `web/frontend/src/components/*`.
  - Evidence (backend): `web/backend/main.py` includes routers implemented in `web/backend/routes/*`.
- The “Connect” modal is a **save/test configuration** screen; it does not establish a persistent transport connection.
  - Evidence: `web/frontend/src/components/GatewayConnectionModal.tsx` calls `/api/connection/gateway`; backend persists in `web/backend/services/gateway_connection.py`.
- Your save error (`JSON.parse: unexpected character at line 1 column 1`) is consistent with the UI calling `/api/flows` and receiving **HTML** (usually `index.html`) instead of JSON.
  - Root cause: serving the UI without routing `/api/*` to the editor backend will cause SPA fallbacks to return HTML for `/api/*`.
  - Fix (implemented in this repo): `@abstractframework/flow` CLI now proxies `/api/*` (HTTP + WebSocket) to a configurable backend URL.
  - Evidence (UI expects JSON): `web/frontend/src/components/Toolbar.tsx` calls `response.json()` on `/api/flows`.
  - Evidence (proxy fix): `web/frontend/bin/cli.js`.
- AbstractGateway is not currently a drop-in replacement for the editor backend. It is a durable run gateway with bundle/runs APIs under `/api/gateway/*` and SSE ledger streaming.
  - Evidence: `/Users/albou/abstractframework/abstractgateway/src/abstractgateway/routes/gateway.py`.

---

## 2) What you ran, what broke, and why

### 2.1 Your commands (as described)

1) `abstractgateway serve --port 8080`  
2) `npx @abstractframework/flow`

### 2.2 What the UI does on “Save”

The editor frontend saves flows via same-origin endpoints:
- `POST /api/flows` (create)
- `PUT /api/flows/:id` (update)

Evidence: `web/frontend/src/components/Toolbar.tsx` (`saveFlow()`).

### 2.3 Why it fails with `JSON.parse ...`

If there is no real backend at `/api/flows`, a static SPA server will commonly return `index.html` (HTTP 200) as a fallback. The frontend then calls `response.json()`, and JSON parsing fails at the first character (`<` from HTML).

That failure mode matches your toast.

If you route `/api/*` to the backend (Vite dev proxy, or the `@abstractframework/flow` CLI proxy), the UI receives JSON and the error disappears.

### 2.4 Why “gateway + UI” isn’t sufficient

Even with AbstractGateway running, the UI is still calling:
- `/api/flows` (CRUD + publish)
- `/api/ws/:flowId` (WebSocket execution protocol)
- `/api/runs/*` (run history, artifacts, workspace actions)

Gateway’s APIs are different and namespaced (`/api/gateway/*`), so the UI does not reach them without an adapter/proxy or a UI refactor.

---

## 3) Current architecture (as implemented in this repo)

```mermaid
flowchart LR
  UI[Visual Editor UI<br/>web/frontend] -->|/api/*| BE[Editor Backend<br/>web/backend (FastAPI)]
  BE --> AF[abstractflow.visual<br/>create_visual_runner]
  AF --> RT[AbstractRuntime Runtime]
  BE --> FLOWS[(./flows/*.json)]
  BE --> RUNTIME[(runtime dir)]

  BE -->|optional: embeddings config + bundle upload| GW[AbstractGateway<br/>/api/gateway/*]
```

Editor backend responsibilities:
- Flow CRUD and persistence
  - Evidence: `web/backend/routes/flows.py` (`FLOWS_DIR`, `ABSTRACTFLOW_FLOWS_DIR`).
- Execution streaming UX (node_start/node_complete/flow_waiting) over WebSocket
  - Evidence: `web/backend/routes/ws.py` emits `ExecutionEvent(type="node_start"|...)`.
- Durable runtime stores (runs/ledger/artifacts)
  - Evidence: `web/backend/services/runtime_stores.py`, `web/backend/services/paths.py` (default varies by source checkout vs installed package; override via `ABSTRACTFLOW_RUNTIME_DIR`).
- Safe per-run workspace creation and tool scoping
  - Evidence: `web/backend/services/execution_workspace.py`, `abstractflow/visual/workspace_scoped_tools.py`.
- Persisting gateway URL/token server-side for embeddings-backed features
  - Evidence: `web/backend/services/gateway_connection.py`, `web/backend/routes/connection.py`.

What gateway is currently used for (from the editor backend):
- Embeddings config check (for KG semantic search):
  - Evidence: `web/backend/services/gateway_connection.py` calls `GET {gateway}/api/gateway/embeddings/config`.
- Publishing bundles (.flow) and uploading/reloading in gateway:
  - Evidence: `web/backend/routes/flows.py` calls gateway `/api/gateway/bundles/upload` and `/api/gateway/bundles/reload`.

---

## 4) What the “Connect” modal is (and isn’t)

### What it is

- A way to set/test gateway connection details **on the editor backend** (URL + token).
- Token is not returned to the browser; it is stored server-side.

Evidence:
- Frontend: `web/frontend/src/components/GatewayConnectionModal.tsx`
- Backend: `web/backend/routes/connection.py`, `web/backend/services/gateway_connection.py`

### What it isn’t

- It is not a switch that makes the UI “use the gateway instead of the backend”.
- It does not affect where flows are saved (still `/api/flows`).

Evidence: `web/frontend/src/components/Toolbar.tsx` always uses `/api/flows`.

---

## 5) How to run the editor today (known-good)

### Recommended ports (avoid collisions)

- Editor backend: `8080`
- Gateway: `8081` (matches UI default)
- UI dev server: `3003`

Evidence:
- Backend default port: `web/backend/cli.py` (`PORT` default 8080)
- UI dev port: `web/frontend/package.json` (`vite --port 3003`)
- UI default gateway URL: `web/frontend/src/components/GatewayConnectionModal.tsx` (`http://127.0.0.1:8081`)

### Run (repo source)

Backend:
- `pip install -e ".[server,agent]"`
- `cd web && python -m backend --reload --port 8080`

Evidence: `web/backend/__main__.py`, `web/backend/cli.py`.

Frontend (dev):
- `cd web/frontend && npm install && npm run dev`

Frontend (single-process “production-ish”):
- `cd web/frontend && npm install && npm run build`
- `cd web && python -m backend --port 8080`

Evidence: `web/backend/main.py` serves `web/frontend/dist` when it exists.

### Run (PyPI + npx)

Backend:
- `pip install "abstractflow[server,agent]"`
- `abstractflow serve --reload --port 8080` (or `python -m backend --reload --port 8080`)

UI:
- `npx @abstractframework/flow` (serves UI on `:3003` and proxies `/api/*` → backend)

Evidence: `pyproject.toml` (`project.scripts`, `server` extra), `abstractflow/cli.py`, `web/frontend/bin/cli.js`.

---

## 6) Is there a “simple command” to launch the backend? Is it a JS package?

### Backend

- The editor backend is Python (FastAPI + Uvicorn), not JS.
- It has a simple entrypoint when run from source: `cd web && python -m backend ...`.
  - Evidence: `web/backend/__main__.py`, `web/backend/cli.py`.

Packaged entrypoints:
- `pip install "abstractflow[server]"` ships the backend code and provides:
  - `abstractflow serve ...` (recommended)
  - `python -m backend ...` (module runner)
  - Evidence: `pyproject.toml` (`project.scripts`), `abstractflow/cli.py`, `web/backend/__main__.py`.

### Frontend

- The frontend is a JS/TS React/Vite app under `web/frontend/`.
  - Evidence: `web/frontend/package.json`.
- The published `@abstractframework/flow` npm package is a frontend-only static server for the built UI; it does not ship the Python backend.
  - Implication: it must be run alongside the backend (it proxies `/api/*` to the backend; see `web/frontend/bin/cli.js`).

---

## 7) Can the editor work “solely with the gateway”? (gap analysis + effort)

### 7.1 What the UI expects (hardcoded contract)

The UI uses same-origin endpoints:
- `/api/flows*` (CRUD + publish + lifecycle)
- `/api/ws/:flowId` (execution WebSocket)
- `/api/runs*` (history, artifacts, workspace)
- `/api/providers`, `/api/tools`, `/api/semantics`
- `/api/connection/gateway`

Evidence: search for `/api/` usage in `web/frontend/src/*`.

### 7.2 What the gateway provides today (relevant pieces)

Gateway provides:
- Bundles install/discovery: `/api/gateway/bundles/*`
- Run start/control and ledger streaming: `/api/gateway/runs/*` and `/api/gateway/runs/{run_id}/ledger/stream` (SSE)
- Provider/tool discovery: `/api/gateway/discovery/providers`, `/api/gateway/discovery/tools`

Evidence: `/Users/albou/abstractframework/abstractgateway/src/abstractgateway/routes/gateway.py`.

Gateway does **not** currently provide the editor’s `/api/flows` CRUD and `/api/ws` protocol.

### 7.3 Options to get to “gateway-only”

#### Option A (fastest unblock, but not gateway-only): proxy UI `/api/*` to the existing editor backend

Goal: keep the UI unchanged; run the backend separately.

Approaches:
- Run a reverse proxy (nginx/caddy/traefik) routing:
  - `/` → UI static server
  - `/api/*` and `/api/ws/*` → editor backend
- Or use the `@abstractframework/flow` CLI proxy mode (implemented in this repo; `/api/*` is proxied by default).

Pros:
- Quick fix for “Save failed”.
- No gateway changes.

Cons:
- Still requires the editor backend.

#### Option B (gateway-only, keep UI mostly unchanged): add “editor API” to the gateway

Work items:
1) Add a flow CRUD API to gateway that matches `/api/flows` (or add a UI adapter layer).
   - A strong implementation primitive already exists in gateway: persistent “dynamic VisualFlow” JSON in the bundle host:
     - `register_dynamic_visualflow`, `upsert_dynamic_visualflow`, `load_dynamic_visualflow`
     - Evidence: `/Users/albou/abstractframework/abstractgateway/src/abstractgateway/hosts/bundle_host.py`.
2) Implement a WebSocket endpoint compatible with the UI (`/api/ws/:flowId`).
   - Either:
     - tick runs and emit node_start/node_complete like `web/backend/routes/ws.py`, or
     - translate gateway ledger records into the UI’s `ExecutionEvent` format.
   - Evidence (UI event shape): `abstractflow/visual/models.py` (`ExecutionEvent`); current implementation: `web/backend/routes/ws.py`.
3) Provide the run history/artifact/workspace endpoints (or de-scope features).

Pros:
- True “gateway-only” single service.
- Better installation story (gateway is already a runnable package/service).

Cons / risks:
- Meaningful engineering effort (you’re moving a large part of `web/backend/routes/*` into gateway).
- Security/auth must be re-thought (tokens, workspace access, tool execution).

Order-of-magnitude effort:
- Flow CRUD: 1–2 days
- WS compatibility layer: 3–7 days
- Runs/history/workspace parity: 3–10 days

#### Option C (gateway-only, align with gateway model): refactor UI to use gateway-native APIs (runs + SSE ledger stream)

Work items:
- Replace `/api/ws` with:
  - `POST /api/gateway/runs/start`
  - `GET /api/gateway/runs/{run_id}/ledger/stream` (SSE)
- Interpret ledger stream and map it to node highlighting and UX cues.

Pros:
- Aligns with gateway’s “replay-first” contract and SSE streaming.
- Avoids duplicating a WS execution stack.

Cons:
- Significant UI rewrite + careful UX parity work (the current editor backend adds lots of UX glue).

---

## 8) Recommendations

### Immediate (unblock your workflow)

Run the editor with its backend:
- Gateway on `8081` (optional; required for embeddings-backed KG and “publish to gateway”)
- Editor backend on `8080` (`abstractflow serve --port 8080`)
- UI on `3003` (`npx @abstractframework/flow`)

### Product direction

If “gateway-only editor” is the goal:
- Start by adding **flow CRUD** primitives to gateway backed by `dynamic_flows_dir` (smallest valuable step).
- Then choose:
  - WS compatibility layer (preserves UI), or
  - UI refactor to SSE ledger streaming (aligns with gateway).

---

## Appendix — key code pointers (source of truth)

- Editor UI:
  - Flow CRUD calls: `web/frontend/src/components/Toolbar.tsx`
  - WebSocket transport: `web/frontend/src/hooks/useWebSocket.ts`
  - Gateway connection UI: `web/frontend/src/components/GatewayConnectionModal.tsx`
  - Bundle publish UI: `web/frontend/src/components/PublishFlowModal.tsx`
- Editor backend:
  - app wiring: `web/backend/main.py`
  - flow storage + publish: `web/backend/routes/flows.py`
  - execution streaming: `web/backend/routes/ws.py`
  - gateway connection persistence: `web/backend/services/gateway_connection.py`
- Gateway (external repo):
  - API surface: `/Users/albou/abstractframework/abstractgateway/src/abstractgateway/routes/gateway.py`
  - dynamic VisualFlow persistence primitive: `/Users/albou/abstractframework/abstractgateway/src/abstractgateway/hosts/bundle_host.py`
