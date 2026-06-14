# AbstractFlow Backlog Overview

## Snapshot
- Updated: 2026-06-11
- Planned: 0
- Proposed: 15
- Completed: 39
- Deprecated: 0

## Current Priorities
- The direct file/folder start-input request is now closed through
  `completed/0107_local_multifile_and_folder_workflow_inputs.md` and
  `completed/0109_local_source_input_authoring_and_folder_selection_clarity.md`:
  users can choose one local file, many local files, or one or more local
  folders from their own computer, and the authoring/run-modal surfaces now
  teach that path without exposing the earlier artifact-array jargon.
- The next file/folder work is optional polish only:
  `proposed/0110_local_folder_staging_preflight_and_recovery.md` covers
  preflight summary, relative-path preview, and better large-folder recovery,
  but it is not required for the core “choose files or folders from this
  computer to start a workflow” requirement.
- The next lifecycle/control-plane pass after that should resolve
  `proposed/0102_artifact_and_session_archive_lifecycle_contract.md` when
  archive becomes an immediate product feature or operator need: archive must
  become a first-class indexed lifecycle contract for artifacts and sessions,
  hidden from ordinary product surfaces by default but still available to
  Observer/operator retrieval, with explicit recovery UX and without reusing
  destructive delete.
- Any future live client-filesystem work must stay outside the hosted
  `ArtifactRef + WorkspacePath` default. `proposed/0108_future_live_clientfs_capability_plane.md`
  is not the next file/folder priority; only reopen it if product evidence
  shows that browser/desktop live local file automation is required beyond
  launch-time file/folder selection from the client.
- The online showcase design pass should resolve
  `proposed/0096_github_hosted_gateway_flow_showcase.md`: GitHub Pages can host
  the Flow UI, but Gateway still needs a live backend or operator-started
  Codespace; provider credentials and Gateway auth must remain separated.

## Planned Ledger
- None at the moment.

## Proposed Ledger
- `proposed/0096_github_hosted_gateway_flow_showcase.md`: captures the travel/demo deployment path for light Gateway + Flow, including GitHub Pages limitations, Codespaces as the simplest GitHub-native temporary option, a static UI plus remote-light Gateway option for stable demos, and the credential/auth constraints for user-supplied OpenAI keys.
- `proposed/0102_artifact_and_session_archive_lifecycle_contract.md`: captures the required archive semantics for artifacts and sessions: first-class indexed lifecycle state, explicit `archive_scope` query behavior, transitive session archive behavior, ordinary-surface hiding for agents and replay, and continued operator/Observer access without destructive delete.
- `proposed/0108_future_live_clientfs_capability_plane.md`: preserves the
  separate future design space for true mid-run live client-device filesystem
  operations, and explicitly records that it is not the answer to the already
  supported “pick local files or folders from the client before run start”
  workflow.
- `proposed/0110_local_folder_staging_preflight_and_recovery.md`: optional
  later polish for larger local folder selections: preflight summary,
  relative-path preview, progress, and partial-failure recovery. This is not
  required to satisfy the direct request to let users choose local files and
  folders to start a workflow.

## Completed Ledger
- `completed/0109_local_source_input_authoring_and_folder_selection_clarity.md`:
  finished the remaining direct user-facing local file/folder workflow gap by
  harmonizing workflow boundaries around `array`, making the array item type
  selector available for more than files, keeping `Local Folder` as a source
  for `array<file>` rather than a fake live folder value, and rewriting the
  picker copy so users can understand “choose files or folders from this
  computer” without confusing it with writable folder paths. Validation:
  targeted Flow frontend tests, frontend build, and `git diff --check`.
- `completed/0107_local_multifile_and_folder_workflow_inputs.md`: added
  explicit multi-artifact workflow inputs so hosted Flow users can provide one
  local file, many local files, or one or more local folders to a run, with
  run-modal local file/folder intake, ordered artifact-ref arrays, and
  preserved client-relative member paths. Follow-up `0110` is only optional
  later polish.
- `completed/0103_coredoc_terminology_alignment_for_artifact_workspace_and_local_sources.md`: aligned Flow, Gateway, Runtime, and Observer coredoc plus generated `llms` outputs on the accepted `Artifact` / `Workspace File` / `Local File` vocabulary, and refreshed the generated Flow node catalog so the shipped file/artifact node family appears in both human docs and agent context.
- `completed/0095_file_nodes_artifact_io_boundary_resolution.md`: shipped the first concrete file/folder automation layer on top of the accepted taxonomy: typed workspace file/folder pins, workspace-path browsing, `List Folder Files`, `Import Server File`, `Read Artifact`, `Export Artifact`, shared file-family filtering, canonical hosted file-node outputs, and the supporting Gateway/Runtime/Flow docs.
- `completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md`: added a shared AbstractCore workspace-path canonicalizer, switched Gateway and Runtime to the same deterministic mounted-path alias contract, proved basename-collision stability, and validated a Gateway search/import/Runtime execution/export round trip plus hosted admin-gating behavior.
- `completed/0104_abstractflow_node_and_authoring_terminology_alignment.md`: renamed the artifact picker to `Artifact` / `Local File` / `Server File`, added consequence/provenance helper text, rewrote file-node and pin-legend copy, aligned the authoring assistant and generated node catalog with the same vocabulary, and preserved existing artifact-template labels for compatibility.
- `completed/0105_file_source_contract_and_workspacepath_foundation.md`: landed ADR-0037 for the hosted `Artifact` / `Local File` / `Server File` contract, clarified `WorkspacePath` as the accepted server-path authority model without pretending shared canonicalization already ships, updated root coredoc, and extracted `0106` for the remaining mounted-path implementation gap.
- `completed/0101_permissive_pdf_document_nodes.md`: added first-class Runtime/Flow `Read PDF` and `Write PDF` VisualFlow nodes backed by permissive `pypdf`/`reportlab`, removed PyMuPDF-family packages and `abstractcore[media]` from Runtime's base PDF path, tightened authoring readiness so Markdown/PDF writers must be on the execution path, and updated Flow/Runtime docs plus LLM context. Validation: Runtime PDF round-trip pytest and focused Flow authoring tests.
- `completed/0100_authoring_assistant_artifact_readiness_and_persistence.md`: persisted assistant chat/draft/session state across drawer close/reopen, replaced generic `llms-full.txt` planner context with `docs/workflow-authoring-skill.md` plus a generated complete node catalog with pin/config/capability contracts, added validated Code body/event/config authoring commands, hardened duplicate-template and pin-default validation, passed full Gateway tool schemas and graph config into planner context, tightened research readiness so Agent.system is required and Agent.meta/Agent Trace Report cannot masquerade as sources/report content, required real Markdown/PDF Write File artifact paths for matching requests, reduced successful chat output noise, and regenerated `llms-full.txt`. Validation: focused Flow frontend tests, lint, build, and docs generation.
- `completed/0099_autonomous_authoring_assistant_loop.md`: replaced the authoring assistant's one-shot planner with a Flow-owned iterative loop that starts Gateway `basic-agent` planner runs, reads terminal responses from ledgers, applies validated command batches, recomputes readiness, reflects, and continues until ready or explicitly blocked. It uses advertised Gateway defaults/tool discovery only, rejects malformed JSON instead of extracting partial plans, rejects hidden/deprecated/secret-bearing authoring commands, uses normal Gateway run/ledger routes instead of the console sandbox contract, aligns authored Agent defaults to `max_iterations=50`, and fails closed without local substitute workflows. Validation: Flow frontend lint, tests, and build.
- `completed/0098_flow_authoring_assistant_drawer.md`: added a Flow-owned conversational authoring assistant drawer that reads `llms-full.txt`, drafts typed edit commands through Gateway's default text model unless pinned, applies validated graph commands with undo, shows prompt size plus Gateway-discovered model context/output limits without truncating chat/docs, and fails closed without graph changes when Gateway defaults, model calls, JSON parsing, or command validation fail. Save/Publish/Run remain existing explicit user actions. Validation: Flow frontend tests, lint, and build.
- `completed/0097_artifact_pin_upload_voice_wait_and_media_progress.md`: added node-level artifact uploads for unconnected artifact input pins, browser capture/upload/resume for `Listen Voice` waits, stricter execution-pin preview inference, and image/image-edit child-run `abstract.progress` parity. Validation: Flow frontend build, focused Runtime media-node tests, focused Gateway generated-media/voice contract tests, and Core vision endpoint tests.
- `completed/0094_artifact_search_export_and_kg_memory_readiness.md` from `planned/0094_artifact_search_export_and_kg_memory_readiness.md`: added Gateway artifact search with all/session/run scope, modality/content-type/query/tag filters, Flow artifact picker search with session-list fallback, and KG memory readiness that stays available on fresh resolved stores. An initial Run modal export control was removed in favor of the graph-level file/artifact IO design later shipped in `completed/0095_file_nodes_artifact_io_boundary_resolution.md`. Validation: focused Gateway artifact/capability/default-scan tests, Flow frontend contract tests, and frontend build.
- `completed/0093_artifact_reference_visibility_and_runtime_handoff.md` from `planned/0093_artifact_reference_visibility_and_runtime_handoff.md`: standardized artifact refs at the Gateway/Flow boundary, added session-visible artifact listing, allowed same-session artifact metadata/content access, and validated run-start refs before Runtime handoff. Validation: focused Gateway, Flow frontend contract/build, and Runtime artifact-store tests.
- `completed/0092_run_modal_artifact_input_picker.md` from `planned/0092_run_modal_artifact_input_picker.md`: added a Run modal artifact input field for generic/image/audio/text/video pins with existing session artifact selection, browser upload, Gateway workspace import, modality filtering, previews, and canonical JSON ref submission. Validation: Flow frontend gateway contract tests and frontend build.
- `completed/0091_gateway_artifact_import_export_contract.md` from `planned/0091_gateway_artifact_import_export_contract.md`: added advertised Gateway artifact import/export/session-list APIs, shared canonical artifact ref construction, and a public Runtime file-backed artifact content path hook for export. Validation: focused Gateway capabilities/artifact endpoint tests and Runtime artifact-store test.
- `completed/0090_media_edit_reference_and_sampling_controls.md`: investigated run `e30bb129-1037-412a-ae4c-ab0c76153d57`, confirmed the edit source artifact was wired correctly, routed FLUX.2 MLX-Gen image edits through the dedicated edit variant, ranked dedicated edit models first for MLX-Gen image edits, preserved materialized media roles for source/mask artifacts, split image edit residency/catalog authoring to `image_to_image`, and surfaced seed/guidance controls by default on image/video media nodes. Validation: focused AbstractVision, Core, Runtime, Gateway, Flow VisualFlow, frontend gateway contract tests, and Flow frontend build.
- `completed/0088_flow_pin_and_code_regression_repair.md` from `planned/0088_flow_pin_and_code_regression_repair.md`: repaired AbstractFlow graph regressions by restoring execution pin connected-state/disconnect behavior, tightening provider/model pin compatibility, pruning invalid saved edges on load, regenerating Code-node wrappers from `codeBody` plus current pins in Flow and Runtime, and simplifying visible execution wording to plain Run/Publish authoring language. Validation: Code-node pytest suite, frontend gateway contract suite, focused regression tests, and frontend build.
- `completed/050_gateway_execution_regression_suite.md` from original planned item `050_gateway_execution_regression_suite.md`: Flow's default editor path now has a regression gate proving Gateway descriptors and exact v1 client contracts are required before publish/start, bad stream transports fail fast, frontend source avoids local runtime routes, and the default backend route registry exposes only the Gateway proxy. Validation: full frontend gateway contract pytest and frontend build.
- `completed/030_local_execution_compatibility_boundary.md` from original planned item `030_local_execution_compatibility_boundary.md`: Local Flow runtime routes remain available only through `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`; the default host and frontend stay Gateway-only, while compatibility dependencies live in explicit host profiles. Validation: full frontend gateway contract pytest and frontend build.
- `completed/020_draft_run_and_publish_lifecycle.md` from original planned item `020_draft_run_and_publish_lifecycle.md`: Flow introduced internal draft-run metadata, durable publish, exact-version published-bundle execution support, and Gateway purge support for expired ephemeral run trees. Current Flow UI intentionally presents the authoring path as plain Run plus Publish. Runtime store deletion protocols and Gateway purge tests cover file and SQLite backends, command records, ledgers, artifacts, and Gateway-owned workspace cleanup.
- `completed/0087_gateway_aware_palette_and_preflight.md` from `planned/0087_gateway_aware_palette_and_preflight.md`: Node templates now declare Gateway authoring capability requirements, the palette shows checking/unavailable states and blocks dragging known-unavailable Gateway-dependent nodes, and Run preflight reports reachable unavailable capability nodes before opening the run modal. Validation: focused gateway-authoring pytest, full frontend gateway contract pytest, frontend build, and diff check.
- `completed/0086_live_connection_feedback.md` from `planned/0086_live_connection_feedback.md`: Flow canvas connection drags now use render-only valid/invalid pin guidance and a themed cursor hint derived from ReactFlow's active end-handle state, with colored connection lines by source pin type and no persisted preview data. Validation: focused live-connection pytest, full frontend gateway contract pytest, frontend builds, and diff check.
- `completed/0085_media_artifact_modality_validation.md`: Media artifact authoring now has scoped image/audio/text/video/generic artifact pin types, canonical saved-flow pin normalization, modality-aware connection validation, and run preflight checks for incompatible connected or configured artifact defaults. `artifact_ref` is a generic artifact pin; media `outputs`/`meta` stay raw objects. Validation: focused frontend contract pytest and frontend build.
- `completed/0084_media_defaults_single_editor_surface.md`: PropertiesPanel no longer has a duplicate `Gateway Media` section. Scoped media provider/model/voice/quality/format defaults are edited through the single pin-default surface with themed selectors and connected-pin guards, while BaseNode no longer rewrites image defaults from stale static providers when `image_provider` is connected. Validation: focused frontend media contract pytest, frontend build, and diff check.
- `completed/0083_media_node_advanced_pin_disclosure.md`: Media nodes now use a shared UI-only pin disclosure helper. Unconnected advanced media tuning and diagnostic pins are hidden by default, connected advanced pins remain visible, selected media nodes can reveal the full pin set, and ReactFlow handle geometry is refreshed when the rendered pin set changes. Validation: focused frontend media contract pytest and frontend build.
- `completed/0082_validated_variable_name_selectors.md`: Variable creation now has a shared dotted-path validation contract. `get_var`, `set_var`, `bool_var`, and `var_decl` use themed `AfSelect` custom entry instead of prompts/datalists, invalid custom names are disabled with inline reasons, and AbstractUIC's shared select supports the same opt-in validation behavior. Validation: focused frontend contract pytest plus Flow and UI-kit builds.
- `completed/0081_code_editor_test_result_stability.md`: Code editor testing no longer lets graph tooltips cover the modal, the right-side variables/test input panel remains contained when the bottom result terminal opens, Gateway code simulation now includes `execution.permissions`, and Runtime tests cover connected `permissions` inputs without leaking that control value into user payloads. Validation: focused Runtime/Gateway/Flow tests and frontend build.
- `completed/0080_prompt_free_variable_name_selector.md`: Variable-name pins no longer use browser-native prompts. `get_var`/`set_var` now use the shared themed `AfSelect` custom-entry flow, selector popovers stop wheel events from reaching the graph, and frontend source tests guard against native prompt/confirm/alert regressions. Validation: focused frontend contract pytest and frontend build.
- `completed/0079_code_node_editor_execution_policy.md`: Code editor modal result output is now a deterministic full-width folded terminal with summary/raw test output, stale Code-node rendering was removed, the Code node has an explicit Gateway-policy-driven `permissions` pin, and Runtime/Gateway share sandbox plus policy-gated full-access execution semantics. Failed Runtime Code executions preserve the standard output envelope. Validation: focused Flow/Gateway pytest and frontend build.
- `completed/0076_run_resume_and_exec_backedge_routing.md`: Run Flow is now the single Ask User resume surface; resume controls prevent browser-level default navigation, empty Ask User completion results no longer crash model metadata extraction, and execution back edges prefer a clear upper lane for looped dialogue flows. Validation: frontend build, diff check, and Flow gateway contract pytest.
- `completed/0075_voice_residency_component_display.md`: Model Residency now distinguishes base TTS engines from cloned-voice engines and displays resolved model metadata instead of falling back to runtime ids as model names.
- `completed/0072_gateway_0_2_17_native_media_contract_alignment.md`: Flow now targets Gateway `0.2.17` native media contracts, uses canonical Gateway catalog helpers, consumes Gateway surface readiness as a conservative overlay, persists native Generate Music/Edit Image nodes, adds music residency, and removes browser-side music lowering except for legacy import normalization. Validation: focused Flow/Runtime/Gateway contract tests and frontend build.
- `completed/0071_flow_generate_music_runtime_compat_lowering.md`: Superseded by `0072`; historical temporary lowering item kept for audit trail.
- `completed/0070_flow_durable_bloc_prompt_cache_binding_ux.md` from `planned/0070_flow_durable_bloc_prompt_cache_binding_ux.md`: Flow now exposes Gateway durable bloc prompt-cache capability, a separate durable exact-reuse Run Flow UX, explicit `prompt_cache_binding` pins, opt-in local Runtime/Core imports, and pass-through into Runtime/Agent LLM params. Validation: targeted Flow pytest suite, AbstractAgent generation-param tests, frontend build, and py_compile for edited Flow/Runtime/Agent modules.
- `completed/060_gateway_contract_helper_endpoint_strictness.md`: Gateway helper endpoint strictness.
- `completed/040_gateway_capability_schema_and_connection_contract.md`: Gateway capability schema and Flow connection contract.
- `completed/010_gateway_only_remote_editor_transport.md`: Gateway-only remote editor transport.
- `completed/001_run-flow-advanced-layout.md`: Run Flow advanced layout.

## Notes
- `proposed/0078_code_node_execution_permissions.md`: Code node permission modes now have a narrow Runtime/Gateway/Flow discovery contract; remaining work is stronger host policy, audit metadata, honest average-resource sampling, and safer elevated execution isolation.
- The repo predates the stricter four-digit backlog filename rule. `proposed/` still contains date-prefixed and unnumbered legacy files. They were not renamed during item `0070` to avoid mixing unrelated backlog hygiene with implementation work.
- Gateway remains the primary product runtime/discovery/persistence boundary. Direct Runtime/Core usage in Flow should stay limited to local compatibility shims, compiler re-exports, and tests that explicitly exercise those shims.
