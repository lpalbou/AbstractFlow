# Planned: Artifact Reference Visibility and Runtime Handoff

## Metadata
- Created: 2026-05-28
- Status: Completed
- Completed: 2026-05-28
- Owner: AbstractRuntime / AbstractGateway / AbstractFlow
- Depends On: `completed/0091_gateway_artifact_import_export_contract.md`, `completed/0092_run_modal_artifact_input_picker.md`

## Context

Generated media, uploaded files, and imported workspace files should all enter runs as artifact refs. Existing run-scoped artifact routes require artifact ownership by `run_id`, while user-selected input artifacts may be session-visible or owned by a prior run.

## Current Code Reality

- Gateway run artifact metadata/content routes currently enforce run ownership.
- Gateway and Runtime already have paths for session attachment ownership and artifact visibility checks.
- Runtime accepts `vars` at run start; it should continue receiving JSON-safe values.
- AbstractCore media integrations already resolve artifact-backed media for model calls in several paths.

## Problem

Artifact refs can move between runs, sessions, and flow inputs, but the visibility model is not advertised clearly enough for Flow to safely list and select prior artifacts. Without a canonical handoff rule, Flow may either under-list useful artifacts or overexpose artifacts by guessing run ids.

## What We Want

Define and implement a consistent artifact reference and visibility contract:

- artifact refs are the only cross-boundary representation for media/file payloads
- Gateway validates whether a run may read an artifact before start/resume
- Runtime receives refs as JSON and resolves/materializes them only through existing artifact-aware paths
- Flow can list current-run and session-visible artifacts through advertised Gateway routes

## Requirements

- Add or standardize a session-visible artifact listing route, for example `GET /api/gateway/sessions/{session_id}/artifacts`.
- Apply the same visibility decision to list, metadata, content, import-produced refs, and run-start validation.
- Avoid leaking absolute server paths in artifact refs or list responses.
- Preserve artifact modality via content type and tags: image, audio, video, text, document, music, voice.
- Treat voice/music as audio artifacts with semantic tags, not separate storage systems.
- Keep stale/missing artifacts actionable: the run modal should reject invalid refs before starting where Gateway can validate them.

## Suggested Implementation

- Factor Gateway visibility checks into a reusable helper shared by list, metadata, content, run-start validation, and artifact picker support.
- Add a session artifact listing descriptor to Gateway discovery.
- Normalize artifact refs on run start so downstream Runtime nodes receive one shape.
- Add a small Runtime-side helper for artifact-ref shape validation and materialization hints, without granting Runtime arbitrary path read/write authority.
- Document the durable rule: filesystem paths are local workspace inputs/outputs; artifacts are the cross-package payload representation.

## Non-Goals

- No global artifact search across unrelated sessions.
- No artifact retention policy changes.
- No direct Flow access to Runtime stores.

## Validation

- Gateway tests cover current-run artifacts, session-visible artifacts, denied cross-session artifacts, missing artifacts, and stale refs.
- Runtime tests cover JSON-safe artifact refs entering run vars unchanged and media nodes resolving refs through existing artifact paths.
- Flow tests cover artifact picker lists from the advertised session artifact route and rejects invalid selections.
- End-to-end smoke: upload/import an image as a run input, edit it, export the edited artifact to a workspace file.

## Progress Checklist

- [x] Define canonical artifact ref fields.
- [x] Add session-visible artifact listing contract.
- [x] Share Gateway artifact visibility helper.
- [x] Validate run-start artifact refs.
- [x] Add Runtime artifact-ref validation helper if needed.
- [x] Update Flow docs and FAQ with artifact vs filesystem path rules.

## Completion Report

- Completed: 2026-05-28
- Summary: Standardized artifact refs at the Gateway/Flow boundary, added session-visible artifact listing, allowed run artifact metadata/content access for same-session artifacts, and validated run-start artifact refs before Runtime handoff. Runtime continues to receive JSON-safe refs unchanged; filesystem IO stays in Gateway.
- Code touched:
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractflow/web/frontend/src/components/ArtifactInputField.tsx`
  - `abstractflow/web/frontend/src/components/RunFlowModal.tsx`
  - `abstractflow/web/frontend/src/utils/artifactInputs.ts`
  - `abstractruntime/src/abstractruntime/storage/artifacts.py`
- Tests:
  - `abstractgateway/tests/test_gateway_artifacts_endpoint.py`
  - `abstractflow/tests/test_frontend_gateway_contract.py`
  - `abstractruntime/tests/test_artifacts.py`
- Docs:
  - `abstractflow/docs/faq.md`
  - `abstractflow/docs/api.md`
  - `abstractflow/docs/web-editor.md`
  - `abstractgateway/docs/api.md`
- Validation:
  - `PYTHONPATH=/Users/albou/tmp/abstractframework/abstractruntime/src:/Users/albou/tmp/abstractframework/abstractcore/src:$PYTHONPATH python -m pytest tests/test_gateway_artifacts_endpoint.py tests/test_capabilities_endpoint_contract.py -q` in `abstractgateway` passed.
  - `python -m pytest tests/test_frontend_gateway_contract.py -q` in `abstractflow` passed.
  - `npm run build` in `abstractflow/web/frontend` passed.
  - `python -m pytest tests/test_artifacts.py::TestFileArtifactStore::test_content_path_is_public_for_file_backed_store -q` in `abstractruntime` passed.
- ADR impact: None. The completed work follows the existing artifact-first handoff rule rather than changing it.
- Residual risks: Resume-time artifact ref validation remains a possible future hardening pass if new wait/resume payloads start carrying user-selected artifact refs.
