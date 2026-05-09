# AbstractFlow — Architecture (Current)

> Updated: 2026-02-09  
> Scope: describes **implemented behavior** in this repository (no roadmap claims).

AbstractFlow is a workflow authoring + orchestration layer in the [AbstractFramework ecosystem](https://github.com/lpalbou/AbstractFramework), built on:
- **AbstractRuntime**: durable runs, waits, subworkflows, stores (`RunStore`/`LedgerStore`/`ArtifactStore`)
- **AbstractCore** (via runtime integration): LLM + tool effects
- **AbstractAgent** (optional): Agent node subworkflows (ReAct)
- **AbstractMemory** (optional): memory/KG nodes

See also: [../README.md](../README.md), [getting-started.md](getting-started.md), [api.md](api.md), [faq.md](faq.md), [visualflow.md](visualflow.md), [web-editor.md](web-editor.md), [cli.md](cli.md).

## Repository layout (what ships where)

```
abstractflow/                  # Published Python package
  __init__.py                  # Public API exports
  core/flow.py                 # Flow IR re-export (from AbstractRuntime)
  runner.py                    # FlowRunner (runtime-backed)
  compiler.py                  # Compiler shim (delegates to AbstractRuntime)
  visual/                      # VisualFlow models + portable execution wiring
  adapters/                    # Adapter re-exports (delegates to AbstractRuntime)
  cli.py                       # `abstractflow` CLI
  workflow_bundle.py           # Bundle helpers (delegates to AbstractRuntime)
docs/                          # Human docs (this folder)
web/                           # Reference visual editor app
  backend/                     # Legacy/dev FastAPI host + Gateway proxy
  frontend/                    # React editor + Gateway-first run UI
  flows/                       # Default flow storage when running backend from `web/`
  runtime/                     # Default runtime persistence in a source checkout (installed: ~/.abstractflow/runtime)
tests/                         # Test suite
```

## High-level data and execution flow

```mermaid
flowchart LR
  subgraph Authoring
    FE[web/frontend<br/>React editor] -->|/api/gateway/*| GW[AbstractGateway<br/>VisualFlows + bundles]
    GW -->|persists| GWDATA[(Gateway data dirs)]
  end

  subgraph Execution
    HOST[Host process<br/>(Gateway / CLI / 3rd party)] -->|validate| VF[VisualFlow models<br/>abstractflow/visual/models.py]
    HOST -->|create_visual_runner| WIRE[Runtime wiring<br/>abstractflow/visual/executor.py]
    WIRE --> RT[AbstractRuntime Runtime<br/>tick/resume]
    RT --> STORES[(RunStore / LedgerStore / ArtifactStore)]
    RT -->|LLM_CALL, TOOL_CALLS| AC[AbstractCore integration]
    RT -->|START_SUBWORKFLOW| REG[WorkflowRegistry]
  end

  FE -->|HTTP/SSE: start/commands/ledger| GW
```

## Portable data model: VisualFlow JSON

The portable authoring format is `VisualFlow` (Pydantic models):
- `VisualFlow`, `VisualNode`, `VisualEdge`, `NodeType`, `PinType`, …

Evidence: [../abstractflow/visual/models.py](../abstractflow/visual/models.py).

Key portability rule (enforced by design): the JSON must contain enough configuration to execute outside the web backend. Hosts may add storage, auth, and UI around it, but execution should remain host-independent.

## Compilation and execution (portable)

### VisualFlow → Flow IR

AbstractFlow delegates “VisualFlow → Flow IR” semantics to AbstractRuntime:
- `abstractflow.visual.executor.visual_to_flow()` calls `abstractruntime.visualflow_compiler.visual_to_flow(...)`.

Evidence: [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py).

### Flow IR → WorkflowSpec

AbstractFlow delegates compilation to AbstractRuntime:
- `abstractflow.compiler.compile_flow` is re-exported from `abstractruntime.visualflow_compiler.compiler`.

Evidence: [../abstractflow/compiler.py](../abstractflow/compiler.py).

### Running (FlowRunner)

`FlowRunner` owns host-friendly execution convenience:
- creates a default in-memory runtime when you don’t provide one
- normalizes outputs to `{"success": bool, "result": ...}` for callers
- can auto-drive nested `SUBWORKFLOW` waits in non-interactive contexts

Evidence: [../abstractflow/runner.py](../abstractflow/runner.py), tests in [../tests/test_runner.py](../tests/test_runner.py).

## VisualFlow execution wiring (host responsibilities)

The key host entrypoint is:
- `abstractflow.visual.executor.create_visual_runner(...)`

It wires the runtime based on **what is present in the flow tree**:
- registers subflows/agent workflows when needed (workflow registry)
- enables artifact storage when memory nodes are present
- wires AbstractCore effect handlers when LLM/tool nodes are present
- optionally installs AbstractMemory KG effect handlers when `memory_kg_*` nodes are present

Evidence: [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py).

## Session-scoped events (VisualSessionRunner)

VisualFlows that include custom events (`on_event` / `emit_event`) are executed with a session-aware runner:
- `VisualSessionRunner` starts derived event-listener workflows as **child runs** in the same session.
- During `run()`, it also ticks those child runs so `EMIT_EVENT` branches make progress without a separate host loop.

Evidence: [../abstractflow/visual/session_runner.py](../abstractflow/visual/session_runner.py), wiring in [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py), tests in [../tests/test_visual_custom_events.py](../tests/test_visual_custom_events.py).

## Web editor host (Gateway-first)

The modern editor is a thin Gateway client:
- VisualFlow CRUD: `GET/POST/PUT/DELETE /api/gateway/visualflows`
- Publish: `POST /api/gateway/visualflows/{flow_id}/publish`
- Run input schema: `GET /api/gateway/bundles/{bundle_id}/flows/{flow_id}/input_schema`
- Runs/commands: `POST /api/gateway/runs/start`, `POST /api/gateway/commands`
- Replay/stream: `GET /api/gateway/runs/{run_id}/ledger`, `GET /api/gateway/runs/{run_id}/ledger/stream`
- Artifacts: `GET /api/gateway/runs/{run_id}/artifacts/...`

The static `@abstractframework/flow` server, Vite dev proxy, and Python FastAPI host all proxy `/api/gateway/*` and inject the configured Gateway bearer token server-side. This is required because browser `EventSource` cannot send custom auth headers.

## Legacy/dev FastAPI host

The reference host in `web/` provides:
- Flow CRUD (`web/backend/routes/flows.py`) storing `./flows/*.json` relative to its working dir
- Durable stores for runs/ledger/artifacts (`web/backend/services/runtime_stores.py`)
- WebSocket execution (`web/backend/routes/ws.py`) with message types:
  - `{ "type": "run", "input_data": {…} }`
  - `{ "type": "resume", "response": "…" }`
  - `{ "type": "control", "action": "pause|resume|cancel", "run_id": "…" }`

These local routes remain for development/reference compatibility. See [web-editor.md](web-editor.md) for current run instructions.

## Workflow bundles (`.flow`)

WorkflowBundles package a root VisualFlow JSON plus any referenced subflows into a single `.flow` (zip) file (manifest + flow JSON files).

- CLI: `abstractflow bundle pack|inspect|unpack` (`abstractflow/cli.py`)
- Implementation delegates to AbstractRuntime: `abstractflow/workflow_bundle.py`
- Format/packing semantics are owned by AbstractRuntime; AbstractFlow is a thin wrapper.

Evidence: [../tests/test_workflow_bundle_pack.py](../tests/test_workflow_bundle_pack.py), [../abstractflow/workflow_bundle.py](../abstractflow/workflow_bundle.py).

## What AbstractFlow owns vs delegates

**Owns in this repo**
- VisualFlow schema (`abstractflow/visual/models.py`)
- Host wiring helpers (`abstractflow/visual/executor.py`, `abstractflow/visual/session_runner.py`)
- Public runner conveniences (`abstractflow/runner.py`)
- Reference web editor app (`web/`)
- CLI wrapper (`abstractflow/cli.py`)

**Delegates to AbstractRuntime**
- Compilation semantics and builtins (`abstractflow/compiler.py`, `abstractflow/visual/builtins.py`)
- Adapter implementations (`abstractflow/adapters/*`)
- WorkflowBundle format and IO (`abstractflow/workflow_bundle.py`)
