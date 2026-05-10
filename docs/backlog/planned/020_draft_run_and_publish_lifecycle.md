# Planned: Draft Run And Publish Lifecycle

## Metadata
- Created: 2026-05-09
- Status: Planned
- Completed: N/A

## Context

AbstractFlow users will run many low-value test executions while authoring workflows. Those runs
are useful for live feedback but should not pollute durable Gateway history, production workflow
versions, semantic memory, or long-term Runtime ledgers by default.

The current Flow client already uses a draft-ish publish path:

- `web/frontend/src/hooks/useWebSocket.ts` publishes the current VisualFlow with
  `{ bundle_version: "dev", overwrite: true, reload_gateway: true }`.
- It then starts `/api/gateway/runs/start` with the returned `bundle_id`, `bundle_version`, and
  `flow_id`.

This proves the right direction, but the lifecycle is not yet explicit enough. Gateway stores the
VisualFlow and dev bundle like normal Gateway data, and Runtime persists the run like any other
durable execution.

## Current code reality

Files and symbols inspected:

- `web/frontend/src/hooks/useWebSocket.ts`: draft publish/start behavior.
- `web/frontend/src/components/RunFlowModal.tsx`: workspace, session, provider/model, prompt-cache,
  and run controls.
- `web/frontend/src/components/Toolbar.tsx`: publish, run, history, follow-up, attachments.
- `abstractgateway/src/abstractgateway/routes/gateway.py`: `PublishVisualFlowRequest`,
  `StartRunRequest`, `/visualflows/{flow_id}/publish`, `/runs/start`.
- `abstractgateway/src/abstractgateway/routes/gateway.py`: run listing/history defaults do not yet
  expose a first-class draft/private retention contract.
- `abstractruntime/src/abstractruntime/storage/base.py`: `RunStore`/`LedgerStore` have save/load/list
  capabilities but no reusable purge/delete/retention protocol.

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
  - `retention: { mode: "ttl", ttl_s: ... }` or a Gateway-supported equivalent.
- Draft runs should be hidden from default run history unless the user toggles "show draft tests."
- Draft runs should use per-run workspaces by default and should not inherit production memory
  scopes unless explicitly configured.
- Flow should keep enough draft run history for the current editor session to debug failures.
- Publishing a workflow should produce a clear durable version and not silently reuse the `dev`
  bundle channel as if it were production.

## Suggested implementation

- Start with client semantics and API payload shape, even if Gateway initially ignores unknown
  metadata.
- Once Gateway supports it, send `run_mode`/`visibility`/`retention` fields on `/runs/start`.
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
- Proposed Runtime item:
  `abstractruntime/docs/backlog/proposed/2026-05-09_runtime_retention_and_purge_contract.md`.
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

- [ ] Define Flow-side draft/published UX terms.
- [ ] Extract publish/start payload construction into testable helpers.
- [ ] Send draft run metadata.
- [ ] Add history filtering for draft/private runs.
- [ ] Update docs and screenshots/text if applicable.

## Guidance for the implementing agent

Keep the UI explicit. Do not hide durable publish behind the same action as a draft test run. Re-check
Gateway's latest request models before deciding whether unknown metadata can be sent immediately or
must wait for Gateway support.
