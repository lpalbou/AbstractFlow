# FAQ

See also: `docs/getting-started.md`, `docs/api.md`, `docs/architecture.md`.

## What is AbstractFlow?

AbstractFlow is a Python library for defining and executing **durable** AI workflows:
- Programmatic graphs (`Flow` + `FlowRunner`)
- Portable visual workflows (`VisualFlow` JSON) that can run outside the editor

Evidence: `abstractflow/runner.py`, `abstractflow/visual/models.py`, `abstractflow/visual/executor.py`.

## Is AbstractFlow production-ready?

Not yet. The package is marked **Pre-alpha** and may introduce breaking changes.

Evidence: `pyproject.toml` (`Development Status :: 2 - Pre-Alpha`).

## What’s the difference between `Flow` and `VisualFlow`?

- `Flow`: programmatic flow IR (re-exported from AbstractRuntime) used by `FlowRunner`.
- `VisualFlow`: portable JSON authoring format (Pydantic models) produced by the web editor and runnable from any host.

Evidence: `abstractflow/core/flow.py`, `abstractflow/visual/models.py`, `abstractflow/runner.py`.

## Can I execute a VisualFlow JSON without running the web editor?

Yes. Load the JSON into `VisualFlow` and run it with `abstractflow.visual.execute_visual_flow(...)` (or build a runner with `create_visual_runner(...)` if you need access to the runtime/run state).

Evidence: `abstractflow/visual/executor.py`.

## How do subflows work?

Subflows are VisualFlows referenced by id from nodes of type `subflow`:
- `node.data["subflowId"]` (legacy: `flowId`)

When executing, you must provide a mapping of all flows by id: `flows={flow_id: VisualFlow, ...}`.

Evidence: `abstractflow/visual/executor.py`, `docs/visualflow.md`.

## How do “waiting” runs work? How do I resume?

Some nodes intentionally block on external input (e.g. user/event/schedule waits).
- `FlowRunner.run()` returns `{"waiting": True, ...}` when blocked.
- The web editor resumes blocked runs over WebSocket (`type:"resume"`).

Evidence: `abstractflow/runner.py`, `web/backend/routes/ws.py`, `docs/web-editor.md`.

## How do custom events work in VisualFlow?

For VisualFlows, `VisualSessionRunner` starts `on_event` listeners as **child runs** in the same session and ticks them so `emit_event` branches progress.

Evidence: `abstractflow/visual/session_runner.py`, wiring in `abstractflow/visual/executor.py`.

## Does `pip install abstractflow` include the web editor UI?

Not the UI. The visual editor has two parts:
- Backend (FastAPI): included when you install `abstractflow[server]` and runnable via `abstractflow serve`.
- UI (React): published as the npm package `@abstractframework/flow` (run via `npx`).

Evidence: `pyproject.toml` (`server` extra + `project.scripts`), `abstractflow/cli.py`, `web/frontend/bin/cli.js`.

## Where does the web editor store flows and run data?

Defaults:
- Flows: `./flows/*.json` relative to the backend working directory (override with `ABSTRACTFLOW_FLOWS_DIR`).
- Runtime persistence (runs/ledger/artifacts):
  - source checkout: `web/runtime/`
  - installed package: `~/.abstractflow/runtime`
  - override with `ABSTRACTFLOW_RUNTIME_DIR`.

Evidence: `web/backend/routes/flows.py` (`FLOWS_DIR`, `ABSTRACTFLOW_FLOWS_DIR`), `web/backend/services/paths.py`.

## How does tool / file access work (security)?

The web backend creates a per-run workspace directory and wraps tool execution with workspace scoping:
- Workspace base: `ABSTRACTFLOW_BASE_EXECUTION` (or `/tmp` / OS temp)
- Workspace root is injected into `input_data` (`workspace_root`) and used to scope tools

Evidence: `web/backend/services/execution_workspace.py`, `abstractflow/visual/workspace_scoped_tools.py`, `web/backend/routes/ws.py`, `web/backend/routes/flows.py`.

## How do I package and share workflows?

Use WorkflowBundle (`.flow`):
- CLI: `abstractflow bundle pack|inspect|unpack`
- The bundle format and packer are owned by AbstractRuntime; AbstractFlow provides a thin wrapper.

Evidence: `abstractflow/cli.py`, `abstractflow/workflow_bundle.py`, tests in `tests/test_workflow_bundle_pack.py`.

## Do I need an AbstractGateway?

Not necessarily. VisualFlow execution is runtime-based and can run locally with AbstractCore integration. The web editor can optionally connect to a gateway (URL/token) for catalogs and bundle upload/reload.

Evidence: `abstractflow/visual/executor.py` (gateway token resolution), `web/backend/services/gateway_connection.py`, `web/backend/routes/flows.py` (publish/upload/reload).

## Why do I see pins in `node.data.inputs/outputs` instead of `node.inputs/outputs`?

Saved flows from the editor store pin metadata under `node.data.inputs` / `node.data.outputs`. The top-level `inputs` / `outputs` fields may exist but are often empty.

Evidence: `abstractflow/visual/interfaces.py` (`_pin_types` reads `node.data.*`), sample flows in `web/flows/*.json`.

## Where is the “compiler” implemented?

Compilation semantics live in AbstractRuntime’s VisualFlow compiler. This package delegates and re-exports:
- `abstractflow/compiler.py` (compile functions)
- `abstractflow/adapters/*` and `abstractflow/visual/builtins.py` (node adapters/builtins)

Evidence: `abstractflow/compiler.py`, `abstractflow/adapters/*`, `abstractflow/visual/builtins.py`.
