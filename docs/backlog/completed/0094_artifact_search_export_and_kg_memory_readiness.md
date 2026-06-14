# Planned: Artifact Search, Export UX, And KG Memory Readiness

## Metadata
- Created: 2026-05-28
- Status: Completed
- Completed: 2026-05-28

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Recent artifact work added Gateway import/export routes and Flow run-modal artifact inputs, but the product surface is still incomplete:

- Flow can import/upload/select artifact inputs, but does not expose artifact export from run outputs.
- Existing artifact selection is session-list only and does not provide useful type or metadata search.
- KG memory nodes are shown as unavailable when the default Gateway KG store has not been created yet, even though the route can answer empty-store queries.

## Current code reality
- `abstractgateway/src/abstractgateway/routes/gateway.py` advertises artifact import/export/session-list routes and implements `POST /runs/{run_id}/artifacts/{artifact_id}/export`.
- `abstractflow/web/frontend/src/components/ArtifactInputField.tsx` only uses `session_list` for the Existing tab.
- `abstractflow/web/frontend/src/components/RunFlowModal.tsx` renders generated artifact cards with only open/download links.
- `abstractgateway/src/abstractgateway/routes/gateway.py::_memory_contract_descriptor` requires `memory_store_exists(cfg)` for `common.memory.available`, so an installed empty default LanceDB memory store appears unavailable.
- `abstractruntime` already declares `AbstractMemory>=0.2.6`; Gateway declares `AbstractMemory[lancedb]>=0.2.6`.

## Problem
Users cannot export run artifacts from Flow, cannot search artifacts broadly enough to reuse prior outputs, and see KG memory nodes blocked on a fresh Gateway before any assertions exist.

## What we want to do
Expose Gateway artifact search/export cleanly through advertised contracts and make KG memory authoring availability reflect installed route/backend readiness, not whether the store already contains data.

## Why
Artifact import/export must be a practical round trip: file system to artifact, artifact to flow, and artifact back to file system. KG memory should be usable by default in a fresh Gateway and only report unavailable for real missing dependencies or backend failures.

## Requirements
- Add a Gateway artifact search endpoint that can search all artifacts or session/run-scoped artifacts.
- Support modality/type filtering and simple metadata/tag filtering.
- Advertise the search endpoint in Gateway client capabilities.
- Flow artifact inputs should use Gateway search when available and fall back to session listing.
- Flow run output artifact cards should expose export-to-workspace without native prompts.
- KG memory should remain available on a fresh installed Gateway even if no persisted KG store exists yet.
- Keep Runtime as artifact storage/handoff; Gateway owns workspace policy and filesystem import/export.

## Suggested implementation
- Add `GET /api/gateway/artifacts/search` returning `ArtifactListResponse`.
- Add `common.artifacts.search` to Gateway capability contracts and Flow types/readiness checks.
- Extend `ArtifactInputField` with query, scope, and metadata filter controls.
- Add a small export control to generated image/audio/video artifact cards. This was later withdrawn after product review; graph-level file/artifact IO is tracked separately.
- Adjust `_memory_contract_descriptor` availability to installed backend readiness.

## Scope
- AbstractGateway artifact contract and KG readiness.
- AbstractFlow run-modal artifact picker and output export UX.
- Focused tests and docs.

## Non-goals
- Semantic artifact search or embeddings.
- New artifact storage backends.
- Broad auth/multi-tenant redesign.
- Changing AbstractMemory store semantics.

## Dependencies and related tasks
- Completed: `completed/0091_gateway_artifact_import_export_contract.md`
- Completed: `completed/0092_run_modal_artifact_input_picker.md`
- Completed: `completed/0093_artifact_reference_visibility_and_runtime_handoff.md`

## Expected outcomes
- Flow can export generated image/audio/video artifacts to a server workspace path.
- Flow artifact input selection can search all/session/run artifacts by type and simple metadata.
- KG memory nodes are available on a correctly installed fresh Gateway.

## Validation
- Gateway artifact and capability contract tests.
- Flow frontend contract/helper tests.
- Flow frontend build.

## Progress checklist
- [x] Patch Gateway artifact search and KG readiness.
- [x] Patch Flow artifact search controls; the initial Run modal export control was removed after review.
- [x] Update docs and backlog completion report.
- [x] Run focused tests and frontend build.

## Guidance for the implementing agent
Prefer small Gateway-owned contracts over UI-only path handling. Do not introduce native browser prompts or filesystem access in the browser; all file handoff must go through Gateway descriptors.

## Completion report
- Summary: Added an advertised Gateway artifact search endpoint with all/session/run scope, modality/content-type filtering, text matching, and simple tag metadata filters; surfaced it in Flow artifact inputs with a session-list fallback; initially added, then withdrew, run-output artifact export controls in favor of graph-level file/artifact IO; and made KG memory authoring readiness depend on installed/resolved backend readiness instead of pre-existing store files.
- Changed packages:
  - `abstractgateway`
  - `abstractflow`
- Key files:
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractgateway/src/abstractgateway/hosts/bundle_host.py`
  - `abstractflow/web/frontend/src/components/ArtifactInputField.tsx`
  - `abstractflow/web/frontend/src/components/RunFlowModal.tsx`

## Follow-up amendment
- Date: 2026-05-28
- The Run modal export control was removed after product review. The `artifact content` link remains the Run modal open/download affordance, while artifact-to-filesystem writes should be represented as explicit graph-level file/artifact IO nodes. The resulting file/artifact boundary work later shipped in `../completed/0095_file_nodes_artifact_io_boundary_resolution.md`.
  - `abstractflow/web/frontend/src/utils/gatewayClient.ts`
  - `abstractflow/web/frontend/src/styles/index.css`
- Tests:
  - `PYTHONPATH=/Users/albou/tmp/abstractframework/abstractruntime/src:/Users/albou/tmp/abstractframework/abstractcore/src:$PYTHONPATH python -m pytest tests/test_gateway_artifacts_endpoint.py tests/test_capabilities_endpoint_contract.py tests/test_gateway_bundle_default_scan.py -q` in `abstractgateway` passed.
  - `python -m pytest tests/test_frontend_gateway_contract.py -q` in `abstractflow` passed.
  - `npm run build` in `abstractflow/web/frontend` passed.
- ADR impact: None. This follows the existing artifact-first and Gateway-owned filesystem boundary.
- Residual risks: Artifact search is metadata/text filtering over the artifact store, not semantic search; a future item should cover indexed or vector artifact search if scale demands it.
