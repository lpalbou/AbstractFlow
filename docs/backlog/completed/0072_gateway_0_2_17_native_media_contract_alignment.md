# Completed: Gateway 0.2.17 Native Media Contract Alignment

## Metadata
- Created: 2026-05-22
- Status: Completed
- Completed: 2026-05-22

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context

Gateway `0.2.17` and Runtime `0.4.21` changed the integration boundary materially:

- Gateway now exposes music catalogs and generated media contracts through versioned discovery.
- Gateway catalog endpoints can return the canonical `gateway_catalog_v1` envelope with `items`.
- Gateway now advertises `common.discovery.catalog_contract.primary_items_field = "items"` and a `common.readiness` surface summary (`gateway_surface_readiness_v1`).
- Runtime now accepts native `generate_music`, `edit_image`, and `image_to_image` VisualFlow node types.
- Flow still had temporary browser-side Generate Music lowering and partial media/residency typing.

The product goal is to keep AbstractFlow Gateway-first, avoid direct AbstractRuntime/AbstractCore dependencies in the normal editor path, and expose generated media with a better simple-user and expert-user experience.

## Four-agent perspectives

### Naive user perspective

- Media capabilities must be visible without search. A first-class `Media` palette category is needed.
- Generate Music should work as `prompt -> music artifact` with `Auto (Gateway default)` provider/model.
- Expert knobs should not clutter the node by default; expose them as advanced pins/properties.
- Edit Image must explain how a normal user supplies the source image artifact.
- Run results should privilege previews and players over raw artifact/debug identifiers.

### Guru user perspective

- Persist native media nodes and let Gateway/Runtime own execution semantics.
- Remove browser-side Generate Music lowering except as an import migration path for old saved flows.
- Keep explicit provider/model/backend and advanced music controls available.
- Add `music_generation` to residency surfaces.
- Fail generated-media readiness closed when Gateway advertises a route but the backend is unavailable or unconfigured.

### Gateway contract perspective

- Flow should use `/api/gateway/discovery/capabilities` and endpoint descriptors as the authority.
- Catalog parsing should prefer `catalog.contract = gateway_catalog_v1`, `version = 1`, and canonical `items`.
- `common.readiness` is a useful summary, but it is surface-level contract truth only; Flow should use it as an overlay, not as a replacement for endpoint descriptors.
- Legacy catalog arrays/maps must remain supported during rollout.
- Gateway extras should be bumped to `abstractgateway[apple|gpu]>=0.2.17`.

### Runtime/Flow architecture perspective

- Runtime `0.4.21` has native `generate_music`; Flow's compatibility lowering is obsolete.
- Flow should normalize old lowered music flows back to native nodes on load/save.
- Python VisualFlow models should accept the new native node types without importing Runtime/Core at package import time.
- Local Runtime/Core compatibility remains optional and should not define normal editor behavior.

## Implementation summary

- Added Gateway catalog helpers for canonical `gateway_catalog_v1` plus legacy fallbacks.
- Added native `generate_music` persistence and deleted the browser-side runtime music lowering module.
- Added legacy import normalization for old lowered music flows, including output edge and dynamic output-spec edge rewrites.
- Added native `edit_image` and `image_to_image` node templates, TS node types, properties, and inline media controls.
- Added full music provider/model/backend controls, music catalog loading, `music_generation` residency targeting, and advanced music pins.
- Added a first-class expanded `Media` palette category.
- Hid advanced music pins on-node unless wired, while preserving expert access through saved pins/properties.
- Tightened generated media readiness to require `available=true`, route not false, configured not false, and an endpoint descriptor.
- Scoped edit-image model catalogs to Gateway's `image_to_image` task.
- Added typed support for Gateway's `common.readiness` contract and use it as a conservative media/model-residency readiness overlay while keeping endpoint descriptors as the call authority.
- Updated Python VisualFlow models and optional local runner detection for native media node types.
- Bumped AbstractFlow to `0.3.13` and Gateway profile floor to `>=0.2.17`.

## Refinement cycles

### Cycle 1 feedback applied

- Fixed legacy music load to build editor edges from normalized edges rather than stale original edges.
- Fixed edit-image catalog requests to use `image_to_image` instead of `text_to_image`.
- Tightened generated-media readiness negative cases.
- Filled Generate Music load normalization from the full template input list.
- Made `structure_prompt` boolean in Flow to match Gateway's public request contract.
- Added a native `edit_image` Runtime contract guard.
- Added a concrete Generate Music happy path to docs.

### Cycle 2 feedback result

Second-pass review found several Flow-owned release hardening fixes and one upstream provider-truth issue:

- Naive-user review: model selectors looked mandatory when Gateway defaults were valid, Edit Image needed a clearer source-artifact path, and preflight did not catch missing media inputs.
- Expert-user review: child-run/projected media artifacts could be fetched with the wrong run id, Gateway proxy timeouts were too short for long media/warmup requests, and the residency table mislabeled a timestamp as provider-loaded state.
- Code review: generic `artifact_ref` preview detection could misclassify image/audio artifacts, legacy music compatibility could leave missing output handles, artifact palette entries had duplicate React keys, media readiness was too strict for older endpoint descriptors, and local compatibility runner detection ignored scoped media provider/model fields.
- Integration review: music provider lists are Flow-consumed from Gateway/Runtime/AbstractMusic, not hardcoded in Flow; provider availability truth for planned/non-runnable music backends belongs upstream and is tracked separately.

Applied Flow fixes:

- inline and properties model selectors now clearly show `Auto (Gateway default)` when provider/model are optional;
- run preflight catches missing media prompts and missing Edit Image/Transcribe artifact inputs before run start;
- artifact previews are modality/content-type aware and avoid treating arbitrary generic `artifact_ref` values as both image and audio;
- artifact preview fetches try artifact-owner/projected-run candidates plus selected/root run ids, preventing valid child-run artifacts from 404ing in the UI;
- browser artifact fetches and model load/unload mutations disable the 30-second frontend abort, and the Python Gateway proxy default timeout was raised to 900 seconds with a 3600-second cap;
- legacy lowered music imports now restore canonical `generate_music` output pins before remapping edges;
- model-residency rows show provider-loaded state instead of the `loaded_at` timestamp;
- media readiness accepts legacy direct endpoint descriptors with omitted `available` when the endpoint is otherwise advertised;
- local compatibility runner detection reads scoped media provider/model fields (`music_provider`, `image_provider`, `tts_provider`, `stt_provider`, etc.);
- artifact literal palette entries use distinct React keys.

Post-update verification on 2026-05-22 confirmed the local Runtime fix for music `structure_prompt` boolean forwarding and the local Gateway contract polish for readiness/catalog compatibility. Remaining non-blocking Flow items are tracked as proposed backlog:

- progressive disclosure and preview-first media UX
- browser-level Gateway media E2E coverage

## Current code reality

- `web/frontend/src/utils/gatewayCatalog.ts`: Gateway catalog normalization helpers.
- `web/frontend/src/utils/visualFlowCompat.ts`: legacy music compatibility importer only.
- `web/frontend/src/utils/serialization.ts` and `web/frontend/src/hooks/useFlow.ts`: native save/load plus legacy compatibility normalization.
- `web/frontend/src/types/flow.ts` and `web/frontend/src/types/nodes.ts`: native media node types and pins.
- `web/frontend/src/components/PropertiesPanel.tsx`, `web/frontend/src/components/nodes/BaseNode.tsx`, `web/frontend/src/components/ModelResidencyPanel.tsx`: media catalogs, residency, and UX controls.
- `web/frontend/src/utils/gatewayClient.ts`: typed `edited_image`, catalog contract metadata, Gateway surface readiness overlay, and strict media readiness.
- `abstractflow/visual/models.py` and `abstractflow/visual/executor.py`: native media node parsing and optional local compatibility detection.
- `README.md`, `docs/*.md`, `CHANGELOG.md`, `llms.txt`: Gateway-first media docs and release notes.

## Validation

- `pytest -q tests/test_frontend_gateway_contract.py tests/test_web_gateway_proxy_auth.py tests/test_visual_generate_music_native_runtime.py tests/test_visual_model_residency_node.py`
- `pytest -q tests/test_visual_model_residency_node.py tests/test_visual_generate_music_native_runtime.py`
- `npm run build` from `web/frontend`
- `git diff --check`

Known validation limitation: no live end-to-end media generation was run from AbstractFlow in this pass. The live Gateway process on `127.0.0.1:8080` reported older installed package versions while the local repositories contain Gateway `0.2.17` and Runtime `0.4.21`.

## Residual risks

- Runtime's local, unreleased fix for music `structure_prompt` boolean forwarding passed targeted tests; published Flow users still need the corresponding Runtime/Gateway releases installed together.
- Preview-first output UX is improved by existing artifact players but still not a full gallery-first redesign.
- Browser-level E2E tests for generated music/edit image require a live Gateway/media backend fixture and are tracked separately.
- Music provider availability truth is upstream-owned. Flow consumes Gateway music catalogs and does not hardcode provider allowlists; AbstractMusic/Gateway must distinguish known providers from runnable providers.

## Follow-ups

- `../proposed/0073_media_progressive_disclosure_preview_first_ux.md`
- `../proposed/0074_gateway_media_browser_e2e_regression_suite.md`
- Runtime completed backlog: `../../../../abstractruntime/docs/backlog/completed/0039_runtime_music_structure_prompt_bool_contract.md`
- AbstractMusic proposed backlog: `../../../../abstractmusic/docs/backlog/proposed/0087_truthful_music_provider_runtime_availability.md`
