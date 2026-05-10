# Planned: Local Execution Compatibility Boundary

## Metadata
- Created: 2026-05-09
- Status: Planned
- Completed: N/A

## Context

AbstractFlow still contains a capable local execution stack:

- `abstractflow.visual.executor.create_visual_runner(...)`
- `abstractflow.visual.executor.execute_visual_flow(...)`
- `web/backend/routes/flows.py` local `/flows/{flow_id}/run`
- `web/backend/routes/ws.py` local WebSocket execution loop

This stack is useful for tests, embedding, and isolated development. It is not the default
product path for the editor UI.

For authoring/running in production, Gateways should be authoritative for:
VisualFlow persistence, publish/run orchestration, provider/model/tool catalogs, ledger, artifacts,
memory, and execution.

## Current code reality

Files and symbols inspected:

- `abstractflow/visual/executor.py`: detects LLM nodes and calls
  `abstractruntime.integrations.abstractcore.factory.create_local_runtime(...)` when runtime wiring is requested.
- `web/backend/routes/flows.py`: builds a local runner and calls `runner.run(...)`.
- `web/backend/routes/ws.py`: builds a local runner and drives `runner.step()`/Gateway-style
  events over a local WebSocket.
- `web/backend/services/executor.py`: thin wrapper around portable local execution helpers.
- `pyproject.toml`: base package is thin and framework-only; local execution stack is now in
  `abstractflow[runtime]`; `all-apple` / `all-gpu` add Gateway + FastAPI + compatibility host dependencies,
  `agent` adds optional Agent-node dependencies.
- `abstractflow/cli.py` / `web/backend/cli.py`: guard default host startup behind gateway URL/token check.

## Problem

Local execution is currently easy to confuse with the main product path, and it can be pulled
into environments that should stay thin.

The goal is not to remove local APIs but to make it explicit when they are in use.

## What we want to do

Define and enforce a compatibility boundary:

- Default browser/editor runtime: Gateway-only.
- Local execution: explicit opt-in only (`ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`) for compatibility.
- Package shape: clear split between public, default-thin usage and local host compatibility.

## Why

There should be two clean entry points:

- Direct Flow/runtime hosts: local compiler, runner, and optional local execution APIs.
- AbstractGateway host: authoritative for authoring execution and run persistence for the editor.

## Requirements

- Keep local execution route surface clearly labeled as compatibility-only.
  - `/api/flows/{flow_id}/run`
  - `/api/ws/{flow_id}`
  - provider/runtime routes in local compatibility mode.
- Preserve startup warnings when the host is running local-runtime compatibility mode.
- Keep tests that exercise `create_visual_runner(...)` as compiler/runtime unit tests.
- Keep default install path thin for editor-only Gateway clients.
- Clarify dependency guidance:
  - base: gateway-client library only (no runtime stack by default),
  - `runtime`: local programmatic/VisualFlow execution stack (`Flow`, `FlowRunner`, local execution helpers),
- `all-apple`, `all-gpu`: Gateway + FastAPI + compatibility host dependencies + local runtime stack for compatibility mode,
  - `agent`: optional local compatibility support for Agent nodes,
  - `dev`: tests/docs.

## Suggested implementation

- Keep and tighten startup mode docs and health-mode visibility.
- Keep the explicit env-gate for compatibility routes.
- Ensure generated/auxiliary docs reflect the new profile shape (`all-apple`/`all-gpu` + `agent`, not `local-runtime`).
- Add smoke-level check in docs or manual test plan confirming no local route path is used by default UI.

## Scope

- AbstractFlow package metadata, docs, warnings, route labels, tests, and import boundaries.
- No changes to Gateway execution semantics.

## Non-goals

- Do not delete local execution APIs without a deprecation window.
- Do not break Gateway, Runtime, or Agent tests that import `create_visual_runner(...)`.
- Do not force all library users to run a Gateway just to compile/validate VisualFlow JSON.

## Dependencies and related tasks

- Completed Flow item: `../completed/010_gateway_only_remote_editor_transport.md`.
- Completed Flow item: `../completed/040_gateway_capability_schema_and_connection_contract.md`.
- Proposed guidance: `../proposed/2026-05-09_abstractflow_gateway_migration_roadmap.md`.

## Expected outcomes

- A new engineer can tell exactly when AbstractFlow is acting as a client vs embedded local host.
- Reports about local LLM/execution are easy to classify as compatibility mode.
- Thin install shape is documented and enforceable.

## Validation

- Import smoke tests for pure client/proxy path.
- Static endpoint audits confirm default UI does not call local runtime routes.
- Docs build passes.
- Existing local execution tests continue to pass.

## Progress checklist

- [x] Document the local execution boundary.
- [x] Add startup warnings or feature flags for local runtime mode.
- [x] Keep local execution routes explicit and opt-in by environment gate.
- [x] Audit package dependency side effects for truly thin proxy installs.
- [x] Add tests for default Gateway-only behavior.
- [x] Plan and implement additional dependency split with no standalone aggregate profile (`all-apple` / `all-gpu` + base/runtimes split).
