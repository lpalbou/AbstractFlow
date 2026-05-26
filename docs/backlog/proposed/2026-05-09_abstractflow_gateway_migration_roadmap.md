# Proposed: AbstractFlow Gateway Migration Roadmap

## Metadata
- Created: 2026-05-09
- Status: Proposed
- Completed: N/A

## Context

AbstractFlow is migrating from a standalone workflow editor/executor into a Gateway-first workflow
authoring client. The current code already has a real Gateway-first frontend path, but local
execution compatibility paths remain and can make the architecture look ambiguous.

Code inspected during this pass:

- `web/frontend/src/hooks/useWebSocket.ts`: publishes VisualFlows to Gateway, starts Gateway runs,
  and streams Gateway ledgers.
- `web/frontend/bin/cli.js`: serves the UI and proxies `/api/*` to a configured Gateway, injecting
  bearer auth.
- `web/backend/routes/flows.py` and `web/backend/routes/ws.py`: legacy local execution routes.
- `abstractflow/visual/executor.py`: portable local runner factory used by tests, embedding, and
  Gateway's VisualFlow compatibility host.
- `abstractgateway/src/abstractgateway/routes/gateway.py`: VisualFlow CRUD/publish and run start.
- `abstractgateway/src/abstractgateway/hosts/visualflow_host.py` and `hosts/bundle_host.py`:
  Gateway-side execution wiring.

## Current status (2026-05-10)

### Completed (this pass)

- Gateway now advertises helper descriptors in discovery:
  - `capabilities.contracts.common.runs.input_data`
  - `capabilities.contracts.common.runs.history_bundle`
  (`abstractgateway/src/abstractgateway/routes/gateway.py`, tests in
  `abstractgateway/tests/test_capabilities_endpoint_contract.py`).
- AbstractFlow now enforces helper-endpoint strictness when `contracts.version >= 1`:
  - `RunFlowModal` and `Toolbar` use descriptor-based URLs for
    `runs/{run_id}/input_data` and `runs/{run_id}/history_bundle`.
  - Missing `input_data`/`history_bundle` descriptors block operation readiness in
    those paths.
  - The explicit test fixture in
    `abstractflow/tests/test_frontend_gateway_contract.py` asserts readiness failures
    for either missing descriptor.
- Plan artifact hygiene:
  - `docs/backlog/completed/010_gateway_only_remote_editor_transport.md`
  - `docs/backlog/completed/040_gateway_capability_schema_and_connection_contract.md`
  - `docs/backlog/completed/060_gateway_contract_helper_endpoint_strictness.md`

### Open work after this blocker

- [x] Finish explicit local-execution compatibility boundary for default editor mode
  (`docs/backlog/completed/030_local_execution_compatibility_boundary.md`).
- [x] Add first-class draft/private authoring lifecycle for run retention and visibility
  (`docs/backlog/completed/020_draft_run_and_publish_lifecycle.md`).
- [x] Add a stable Gateway regression suite to prove no default-path local-run fallback
  (`docs/backlog/completed/050_gateway_execution_regression_suite.md`).
- [ ] If 020 is implemented, close the remaining cross-package retention/purge follow-ups:
  - `abstractgateway/docs/backlog/proposed/2026-05-09_abstractflow_draft_spaces_and_ephemeral_runs.md`
  - `abstractruntime/docs/backlog/planned/025_runtime_retention_and_purge_contract.md`.

### Recommended sequencing

- 020, 030, and 050 are complete. Promote new Flow UX work from `proposed/` only after a
  code-first audit.

## Findings

The report that LLM/Agent calls "go local" is only partly accurate:

- In the default React client path, Flow publishes to Gateway and starts a Gateway run. Execution is
  not happening inside the browser or Flow static server.
- Gateway executes workflows in its own process via AbstractRuntime and AbstractCore integration.
  That is expected: Gateway is the deployment composition root.
- The local Flow Python backend can still execute workflows locally; this must become explicit
  local development compatibility, not the default editor path.

## Planned work created from this roadmap

- `docs/backlog/completed/010_gateway_only_remote_editor_transport.md`
- `docs/backlog/completed/020_draft_run_and_publish_lifecycle.md`
- `docs/backlog/completed/030_local_execution_compatibility_boundary.md`
- `docs/backlog/completed/040_gateway_capability_schema_and_connection_contract.md`
- `docs/backlog/completed/050_gateway_execution_regression_suite.md`

Related cross-package proposed work:

- `abstractgateway/docs/backlog/proposed/2026-05-09_abstractflow_draft_spaces_and_ephemeral_runs.md`
- `abstractruntime/docs/backlog/planned/025_runtime_retention_and_purge_contract.md`

## Promotion criteria

Keep this item as an orientation note. The original planned implementation items are complete; this
roadmap can be deprecated once the Flow docs clearly define Gateway-first execution as the default
in the release documentation set.

## Release Gate

### Validated this pass

- Gateway discovery advertises `capabilities.contracts.common.runs.input_data` and `capabilities.contracts.common.runs.history_bundle`.
- Run rehydration and run history replay in the frontend are descriptor-gated for versioned contracts.
- `test_frontend_gateway_contract.py` now asserts readiness failures when either helper descriptor is missing.
- `test_capabilities_endpoint_contract.py` and gateway editor contract tests validate helper route presence and path correctness.

### Next actions

- Keep `docs/backlog/completed/030_local_execution_compatibility_boundary.md` as the completed local-compatibility reference.
- Keep `docs/backlog/completed/020_draft_run_and_publish_lifecycle.md` as the completed draft/publish lifecycle reference.
- Keep `docs/backlog/completed/050_gateway_execution_regression_suite.md` as the completed no-local-fallback regression reference.
- Gateway run-tree purge for draft-test runs is implemented; broader Gateway draft-bundle cleanup,
  memory-scope isolation, and the Runtime host-facing purge helper remain tracked separately.

### Ordering

- The original 020/030/050 ordering constraints are complete.
