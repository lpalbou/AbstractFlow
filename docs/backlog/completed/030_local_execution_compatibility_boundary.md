# Completed: Local Execution Compatibility Boundary

## Metadata
- Created: 2026-05-09
- Status: Completed
- Completed: 2026-05-25

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
  `abstractflow[apple]`; `apple` / `gpu` add FastAPI + compatibility host dependencies,
  and Agent-node dependencies. `agent` remains available for Agent nodes without a host profile. Gateway stays a separate server package to avoid
  a circular Flow/Gateway release dependency.
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
  - `apple`, `gpu`: FastAPI + compatibility host dependencies + local execution stack + Agent nodes,
  - Gateway server: install `abstractgateway[apple]` or `abstractgateway[gpu]` separately,
  - `agent`: Agent-node support without a host profile,

## Suggested implementation

- Keep and tighten startup mode docs and health-mode visibility.
- Keep the explicit env-gate for compatibility routes.
- Ensure generated/auxiliary docs reflect the new profile shape (`apple`/`gpu` + `agent`, not `local-runtime`).
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
- [x] Plan and implement additional dependency split with no standalone aggregate profile (`apple` / `gpu` + base/runtimes split).

## Completion report

### Date

2026-05-25

### Summary

This item was closed after a code-first audit showed the compatibility boundary is already
implemented and tested:

- the default AbstractFlow backend exposes the Gateway proxy surface only;
- local runtime routes are available only when `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`;
- frontend source avoids local runtime route paths in the default editor transport;
- package dependency profiles keep local compatibility/runtime dependencies out of the thin default
  client profile.

### Evidence

- `web/backend/main.py`: local runtime route registration is env-gated and emits local-mode startup
  warnings.
- `pyproject.toml`: `apple` / `gpu` profiles carry compatibility host dependencies while the base
  package stays thin.
- `tests/test_frontend_gateway_contract.py`: default route registry and frontend source checks prove
  no default `/api/flows`, `/api/ws`, `/api/runs`, or `/api/providers` path.
- `tests/test_frontend_gateway_contract.py`: local runtime routes are present only under explicit
  opt-in.

### Validation

- `PYTHONPATH=.:../abstractruntime/src pytest -q tests/test_frontend_gateway_contract.py`
- `npm run build` from `web/frontend`

### ADR impact

None. This item enforces the existing Gateway-first boundary captured by completed Flow backlog
items and related Gateway architecture docs; it does not introduce a new durable architecture rule.

### Residual risk

The local compatibility stack remains intentionally available for tests and embedded development.
Future work should continue to guard the default editor path through
`completed/050_gateway_execution_regression_suite.md`.
