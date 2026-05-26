# Completed: Draft Run And Publish Lifecycle

## Metadata
- Created: 2026-05-09
- Status: Completed
- Completed: 2026-05-25

## Context

AbstractFlow users will run many low-value test executions while authoring workflows. Those runs
are useful for live feedback but should not pollute durable Gateway history, production workflow
versions, semantic memory, or long-term Runtime ledgers by default.

The Flow client now uses an explicit draft-test publish/start path:

- `web/frontend/src/hooks/useWebSocket.ts` publishes the current VisualFlow with
  a scoped `draft.<session>` bundle version.
- It then starts `/api/gateway/runs/start` with the returned `bundle_id`, `bundle_version`,
  `flow_id`, and top-level `run_lifecycle` metadata.

Gateway now returns sanitized `run_lifecycle` and `is_draft` summaries, omits draft tests from the
default `/runs` list, resolves published runs to exact non-draft bundle versions, and exposes an
operational purge endpoint for expired ephemeral draft-test run trees.

## Current code reality

Files and symbols inspected:

- `web/frontend/src/hooks/useWebSocket.ts`: `Test Draft` publish/start behavior sends top-level
  `run_lifecycle`.
- `web/frontend/src/components/RunFlowModal.tsx`: workspace, session, provider/model, prompt-cache,
  and run controls.
- `web/frontend/src/components/Toolbar.tsx`: publish, run, history, follow-up, attachments.
- `web/frontend/src/components/RunHistoryModal.tsx`: requests `include_drafts=true` for authoring
  visibility, then hides draft tests locally unless the user toggles them.
- `web/frontend/src/components/RunSwitcherDropdown.tsx`: requests `include_drafts=true` and labels
  draft tests so active authoring sessions remain debuggable.
- `web/frontend/src/utils/gatewayRuns.ts`: maps Gateway `run_lifecycle`/`is_draft` summaries
  without parsing workflow-id strings as lifecycle truth.
- `abstractgateway/src/abstractgateway/routes/gateway.py`: `PublishVisualFlowRequest`,
  `StartRunRequest`, `/visualflows/{flow_id}/publish`, `/runs/start`, `/runs`,
  `/runs/purge_drafts`.
- `abstractgateway/src/abstractgateway/run_retention.py`: Gateway-owned retention policy for
  terminal ephemeral draft-test run tree cleanup, including command, ledger, artifact, run
  checkpoint, and Gateway-owned workspace deletion.
- `abstractgateway/src/abstractgateway/service.py`: run summaries expose sanitized lifecycle
  metadata only; full run vars stay private.
- `abstractruntime/src/abstractruntime/core/run_lifecycle.py`: Runtime stores/indexes sanitized
  generic lifecycle metadata but does not own Gateway/Flow draft taxonomy.
- `abstractruntime/src/abstractruntime/storage/base.py`,
  `abstractruntime/src/abstractruntime/storage/commands.py`, and concrete store backends now expose
  optional deletion protocols used by Gateway purge.
- Recent completed Flow work now covers Code editor stability, model residency, media pin
  disclosure, artifact validation, live connection feedback, and Gateway-aware palette/preflight.
  Lifecycle clarity is the next broad authoring UX gap.

## Problem

Flow's "Run" button currently creates durable Gateway/Runtime state as if every authoring test were
valuable production history. That is wrong for workflow design:

- transient failures and prompt experiments create noise;
- dev bundle version `dev` can collide with real lifecycle semantics;
- history and run pickers can become cluttered;
- memory/semantic writes may leak from tests into long-lived scopes unless the flow author is
  careful;
- there is no clear user choice between "test this draft" and "publish/reuse this workflow."

## What we want to do

Add a first-class Flow authoring lifecycle:

- **Draft save**: editable VisualFlow JSON stored in Gateway.
- **Test run**: temporary/private Gateway run, isolated workspace, explicit retention, hidden from
  normal history by default.
- **Promote/publish**: durable `.flow` bundle version installed into Gateway for reuse by apps.
- **Production run**: normal Gateway run against a published bundle, visible in history by default.

## Why

This preserves Gateway/Runtime durability where it matters while keeping the authoring loop fast
and clean. It also gives apps like Assistant, Observer, Code, and future thin clients a clean
distinction between reusable workflows and editor test noise.

## Requirements

- Flow's Run modal must distinguish at least:
  - `Test Draft` for temporary/private authoring runs;
  - `Run Published` or `Publish` for durable reusable workflows.
- Test runs should send explicit metadata to Gateway, for example:
  - `source: "abstractflow.editor"`;
  - `purpose: "draft_test"`;
  - `visibility: "private"`;
  - `retention: { mode: "ephemeral" }` or a Gateway-supported equivalent.
- Draft runs should be hidden from default run history unless the user toggles "show draft tests."
- Draft runs should use per-run workspaces by default and should not inherit production memory
  scopes unless explicitly configured.
- Flow should keep enough draft run history for the current editor session to debug failures.
- Publishing a workflow should produce a clear durable version and not silently reuse the `dev`
  bundle channel as if it were production.

## Suggested implementation

- Send `run_lifecycle` as a top-level `/runs/start` field, not hidden in user `input_data`.
- Replace hard-coded `bundle_version: "dev"` with a Gateway draft-publish contract or a scoped draft
  version such as `draft.<client_session>`.
- Add UI filters for draft/private runs in history.
- Add tests that:
  - draft test runs are started with draft metadata;
  - production publish uses stable semver or explicit user version;
  - default history excludes draft tests;
  - draft run cleanup does not remove published bundles.

## Scope

- AbstractFlow UI run/publish workflow.
- Flow-side API payloads and history filtering.
- Documentation of the authoring lifecycle.

## Non-goals

- Do not implement Runtime storage deletion in AbstractFlow.
- Do not decide Gateway's exact database retention implementation here.
- Do not write test runs into semantic memory by default unless the flow explicitly does so with a
  test namespace/scope.

## Dependencies and related tasks

- Proposed Gateway item:
  `abstractgateway/docs/backlog/proposed/2026-05-09_abstractflow_draft_spaces_and_ephemeral_runs.md`.
- Planned Runtime item:
  `abstractruntime/docs/backlog/planned/025_runtime_retention_and_purge_contract.md`.
- Completed Flow item: `../completed/010_gateway_only_remote_editor_transport.md`.

## Expected outcomes

- Workflow design can be iterative without polluting long-term runtime history.
- Published workflows remain versioned, reusable, and replayable.
- Draft tests remain inspectable during authoring but become easy to hide and clean up.

## Validation

- Unit tests around `useWebSocket.runFlow(...)` or its extracted API helper confirm draft metadata.
- UI test/manual smoke verifies separate "test draft" and "publish" behavior.
- Gateway run history default view omits draft tests once Gateway support exists.
- Documentation build passes.

## Progress checklist

- [x] Define Flow-side draft/published UX terms.
- [x] Extract publish/start payload construction into testable helpers.
- [x] Send draft run metadata.
- [x] Add history filtering for draft/private runs.
- [x] Expose first-class Gateway run lifecycle summaries.
- [x] Add exact-version `Run Published` path distinct from `Test Draft`.
- [x] Make `retention.mode = ephemeral` operational for expired draft-test runs.
- [x] Update docs and screenshots/text if applicable.

## Implementation notes

### 2026-05-25 phase 1

The first slice is Flow-side and compatible with the current Gateway request model:

- Use `Test Draft` for the editor authoring execution path.
- Keep `Publish WorkflowBundle` as the durable reusable workflow action.
- Replace the hard-coded `dev` publish version with a scoped `draft.<session>` bundle version.
- Put safe lifecycle intent under `input_data._abstractflow` because current Gateway
  `StartRunRequest` only advertises `bundle_id`, `bundle_version`, `flow_id`, `input_data`, and
  `session_id`.
- Infer draft runs in Flow history from namespaced workflow ids containing `@draft.` until Gateway
  exposes first-class run intent in summaries.
- Keep this item open past phase 1 until Gateway-owned draft-run purge is operational, or until any
  remaining Runtime retention helper scope is explicitly tracked outside Flow. The residual
  host-facing Runtime purge helper remains tracked in
  `abstractruntime/docs/backlog/planned/025_runtime_retention_and_purge_contract.md`.

#### Phase 1 completion evidence

- Flow editor execution is labeled `Test Draft`, while `Publish WorkflowBundle` remains the durable
  reusable workflow action.
- Draft publish/start payload construction is centralized in `web/frontend/src/utils/runLifecycle.ts`.
- Test draft runs publish to `draft.<session>` bundle versions and send lifecycle intent under
  `input_data._abstractflow`.
- Run history hides draft tests by default and exposes a `Show draft tests` toggle. The in-run
  switcher keeps draft tests visible and labels them.
- Validation:
  - `pytest tests/test_frontend_gateway_contract.py::test_frontend_draft_run_lifecycle_is_explicit_and_testable -q`
  - `pytest tests/test_frontend_gateway_contract.py -q`
  - `npm run build` from `web/frontend`
  - `git diff --check`

### 2026-05-25 phase 2

The second slice moves draft classification out of Flow heuristics and into the Gateway summary
contract:

- `/api/gateway/runs/start` accepts top-level `run_lifecycle` metadata and normalizes it into
  private run vars as `_run_lifecycle`.
- Gateway `GET /runs/{run_id}` and `GET /runs` return sanitized `run_lifecycle` plus `is_draft`;
  arbitrary lifecycle payload keys are not exposed.
- Gateway `/runs` hides draft tests by default. Flow's history and in-run switcher explicitly ask
  for `include_drafts=true` because authoring surfaces need those rows.
- Runtime storage index helpers expose only sanitized generic lifecycle metadata; Gateway owns the
  `purpose: draft_test` interpretation.
- Flow no longer sends `_abstractflow` lifecycle data or infers draft state from `@draft.` workflow
  ids.

#### Phase 2 completion evidence

- Validation:
  - `PYTHONPATH=abstractruntime/src pytest -q abstractruntime/tests/test_queryable_run_store.py::test_run_index_includes_sanitized_lifecycle`
  - `PYTHONPATH=abstractgateway/src:abstractruntime/src pytest -q abstractgateway/tests/test_gateway_runs_list_endpoint.py::test_list_runs_includes_recent_runs_and_filters abstractgateway/tests/test_gateway_runs_list_endpoint.py::test_list_runs_with_sqlite_backend`
  - `PYTHONPATH=abstractflow:abstractruntime/src pytest -q abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_draft_run_lifecycle_is_explicit_and_testable`
  - `PYTHONPATH=abstractgateway/src:abstractruntime/src pytest -q abstractgateway/tests/test_gateway_runs_list_endpoint.py`
  - `PYTHONPATH=abstractruntime/src pytest -q abstractruntime/tests/test_queryable_run_store.py`
  - `PYTHONPATH=abstractflow:abstractruntime/src pytest -q abstractflow/tests/test_frontend_gateway_contract.py`
  - `npm run build` from `web/frontend`
  - `git diff --check`

### 2026-05-25 phase 3

The third slice adds first-class published execution while preserving draft execution as a separate
authoring path:

- Two design reviews converged on the same invariant: published runs must resolve an explicit
  non-draft `bundle_id@bundle_version`; omitted `bundle_version` can silently select a newer
  `draft.*` bundle.
- Gateway publish auto-bump now ignores `draft.*` versions and writes bundle metadata with
  `metadata.lifecycle.channel = "draft" | "published"`.
- Gateway `/bundles` hides drafts by default, exposes `include_drafts`, and returns exact
  `version_channel`, `is_draft`, `is_published`, `latest_published_version`,
  `latest_any_version`, source metadata, and entrypoint `workflow_id` values.
- Gateway host default version resolution prefers published bundle versions over draft versions.
- Gateway `/runs/start` rejects explicit draft bundle versions unless
  `run_lifecycle.purpose == "draft_test"`.
- Flow has a separate `Run Published` toolbar action. It resolves the latest published bundle for
  the current VisualFlow from Gateway bundle metadata, does not call the publish endpoint, fetches
  input schema for that exact version, and starts the run with `purpose: "published_run"` plus
  durable retention metadata.
- The run modal is mode-aware (`Test Draft` vs `Run Published`) and shows the exact published
  bundle ref when applicable.

#### Phase 3 completion evidence

- Validation:
  - `PYTHONPATH=src:../abstractruntime/src pytest -q tests/test_gateway_runs_list_endpoint.py::test_default_bundle_resolution_prefers_published_versions_over_drafts tests/test_abstractflow_editor_gateway_contract.py::test_abstractflow_gateway_first_editor_contract_path`
  - `PYTHONPATH=src:../abstractruntime/src pytest -q tests/test_gateway_runs_list_endpoint.py`
  - `PYTHONPATH=src:../abstractruntime/src pytest -q tests/test_abstractflow_editor_gateway_contract.py`
  - `PYTHONPATH=.:../abstractruntime/src pytest -q tests/test_frontend_gateway_contract.py::test_frontend_draft_run_lifecycle_is_explicit_and_testable`
  - `PYTHONPATH=.:../abstractruntime/src pytest -q tests/test_frontend_gateway_contract.py`
  - `npm run build` from `web/frontend`

### 2026-05-25 phase 4

The fourth slice makes draft-test retention operational without pushing Flow-specific taxonomy into
Runtime:

- Runtime store backends expose small optional deletion protocols:
  - run checkpoints: in-memory, JSON-file, SQLite, and offloading wrappers;
  - ledgers: in-memory, JSONL, SQLite, observable, offloading, and hash-chain wrappers;
  - command inboxes: in-memory, JSONL, and SQLite.
- Gateway owns the draft-test purge policy in `abstractgateway.run_retention`.
- `/api/gateway/runs/purge_drafts` deletes only terminal root runs where
  `run_lifecycle.purpose == "draft_test"` and `run_lifecycle.retention.mode == "ephemeral"`.
- Expiration is determined by explicit `retention.expires_at`, explicit `retention.ttl_s`, or the
  Gateway default TTL (`ABSTRACTGATEWAY_DRAFT_RUN_RETENTION_TTL_S` /
  `ABSTRACTGATEWAY_DRAFT_RUN_TTL_S`, default seven days).
- Gateway purge deletes the full run tree's command records, ledgers, run-associated artifacts,
  run checkpoints, and only Gateway-owned default workspaces under `data_dir/workspaces`.
- New Gateway-created default workspaces carry a `.abstractgateway-workspace.json` ownership marker;
  legacy UUID-named workspace directories under `data_dir/workspaces` remain purgeable.
- Published runs, non-draft runs, unexpired draft runs, and active/waiting draft runs are skipped by
  default.
- The thin-client capability contract now advertises `common.runs.purge_drafts`.

#### Phase 4 completion evidence

- Validation:
  - `PYTHONPATH=src pytest -q tests/test_storage_deletion.py tests/test_queryable_run_store.py tests/test_command_store.py` from `abstractruntime`
  - `PYTHONPATH=src:../abstractruntime/src pytest -q tests/test_gateway_draft_run_retention.py tests/test_gateway_runs_list_endpoint.py tests/test_capabilities_endpoint_contract.py::test_discovery_capabilities_requires_auth` from `abstractgateway`
  - `PYTHONPATH=src:../abstractruntime/src pytest -q tests/test_abstractflow_editor_gateway_contract.py` from `abstractgateway`
  - `PYTHONPATH=.:../abstractruntime/src pytest -q tests/test_frontend_gateway_contract.py::test_frontend_draft_run_lifecycle_is_explicit_and_testable` from `abstractflow`

## Guidance for the implementing agent

Keep the UI explicit. Do not hide durable publish behind the same action as a draft test run. Re-check
Gateway's latest request models before deciding whether unknown metadata can be sent immediately or
must wait for Gateway support.
