# AbstractFlow Backlog Overview

## Snapshot
- Updated: 2026-07-22
- Planned: 0
- Proposed: 40
- Completed: 53
- Deprecated: 0

## 2026-07-22 deterministic camera nodes (0151)
Item 0151 (`abstractflow-0151`): operator order (laurent dm#49) — five
fixed-verb camera nodes (Open/Capture Photo/Capture Video/Analyze Media/Close)
compiling to runtime's `tool_invoke` effect (write_chart pattern generalized:
host-constructed effect, capture runs ungated because trust rides the EFFECT
CLASS, never a forgeable payload field). Verb baked into the node type, never
an editable pin (the load-bearing anti-forgery invariant, adversary-proven
under a hostile doc). tsc/nodes-test/audit/compile green; runtime owner-review
approved (c4332, 89 visualflow green); gateway bundle-host classification gap
fixed (c4325). Live proof + operator receipt pending the gateway bounce +
`analyze_media` served. Capture bypasses camera's approval-by-default BY
DESIGN — a recorded operator decision (dm#10), named to laurent.

## 2026-07-21 coding-agent 0.2.4 process wave (0150)
Item 0150 (`abstractflow-0150`): operator order (laurent dm#122 via code;
byte-proven forensics — 0.2.3's semantics worked, the PROCESS lost a
verified-green artifact to a post-verification rewrite + stale SELFCHECK).
R1 repair reflex (builder report persists; last_verdict-scoped repair
prompts; failure-signature stall guard + anti-repeat), R2 best-artifact
`.cg_rounds/` snapshot/restore (delivery takes the BEST round, restoration
named in the report), R3 hash-bound SELFCHECK gate G5 (post-verify edits
caught deterministically), R4 schema-forced per-feature `feature_checks[]`
+ merge belt, R5 mode-driven budget (build→repair→one rebuild), G6
DOM-contract gate (JS-referenced ids must exist in markup — flags exactly
the broken r3 run). 150/150 gate smoke; audit clean; live gateway run;
code's bench armed for the verification rerun (c4078).

## 2026-07-21 waits actionable + approval lifecycle (0138)
Item 0138 (`abstractflow-0138`): COMPLETE across two slices. Slice 1 —
reason-aware wait notifications (`classifyWait`: event/deadline parks no
longer force-open the modal) + a toolbar "Waiting for you / Approval needed"
badge. Slice 2 (operator-approved, one fable5 adversary) — Approve-All
state chip + Revoke (with a sync-ref hardening fix so a wait right after
Revoke can't still auto-resume), timeline auto-approved/approved markers
(the silent bypass is now visible), and a subrun-attach tightening so
concurrent agents can't cross-attach cycles. +24 tests total.

## 2026-07-21 coding-agent verifier-death fail-soft (coding-agent@0.2.2)
Operator order (laurent dm#96): all-gates-pass runs exited rc=1 when the LLM
verifier died on infra — the exit code lied about a good artifact. A missing
verdict is now the "cannot verify here" class → honest "delivered, not
verifiable" terminal (delivered≠verified≠passed), never a fabricated pass.
Fully live under the gateway runner; the `abstractcode exec` parent-resume
half is filed to the code seat.

## 2026-07-21 canvas undo/redo (0127)
Item 0127 (`abstractflow-0127`): bounded (50) snapshot stack in the useFlow
store — graph-mutating actions capture a pre-mutation baseline; undo/redo
move between past/future with deep-clone-on-restore (no aliasing). Drag
gestures and rapid same-node config edits coalesce into one step; a new edit
forks the timeline; load/clear reset history. Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z
/ Ctrl+Y + a toolbar Undo/Redo group. Closes the top self-contained trust
gap (unrecoverable destructive edits). 10 store tests; 368 total green.

## 2026-07-20 workflow-catalog adversary wave (0149)
Item 0149 (`abstractflow-0149`): operator-mandated 4-adversary (fable5)
sweep of every shipped workflow generator, gated by the new deterministic
`scripts/audit_flow_graph.py` (dead exec/pure nodes, orphan edges, box
overlaps; `--all` = the 21-flow bundled catalog). All 21 flows now audit
clean. Real fixes beyond ~300 layout overlaps: basic-agent's dead
`wait_until` (post_delay silently dropped) + unwired `memory` pin;
deep-research generator drift BEHIND the shipped bundle (rebuild would have
deleted the artifact-registration lane); coding-agent verifier fail-closed
gap with explicit run_commands; adversarial-review merge fold crash/verdict
upgrade on broken critic output; three generators that never packed their
bundles; co-scientist citation-verification overclaims. Version bumps
(sha-immutable): coding-agent@0.2.1, co-scientist@0.1.14,
deep-research@0.1.7, basic-agent@0.0.2, structured-extract/adversarial-
review/map-reduce/diagram-render/meta-*@0.1.1; gateway reloaded + catalog
verified; gateway-side pins updated (19 gateway tests green).

## 2026-07-20 diagram-render professional figures (0148)
Item 0148 (`abstractflow-0148`): the NEW dedicated `diagram-render@0.1.0`
workflow (structured spec -> fixed matplotlib script -> publication PNG+PDF;
injection-proofed inputs; deterministic render gate; honest rendered:false
degradation) + co-scientist@0.1.12 integration (LLM-designed architecture
figure + deterministic 1200-anchored Elo chart; md embeds PNGs; PDF gains
figures as appendix pages via pypdf merge; post-merge sha; timestamped
basenames). One mandated adversarial reviewer; all P0/P1 folded;
live-verified 15-page merged PDF.

## 2026-07-19 co-scientist report quality wave (0147) + JsonViewer fork (0146)
Item 0147 (`abstractflow-0147`): operator-directed self-review of the last two
co-scientist reports against the Nature paper via two fable5 adversaries, then
a two-cycle fix wave (`co-scientist@0.1.8`→`0.1.9`) live-verified on OVH
gpt-oss-120b — hardened grounding + citation allowlist (killed fabricated
citations), structured falsifiable protocols, novelty floor + diversity
de-crowding, decoration sanitizer, honest Elo framing, Methodology +
Elo-evolution figure + Limitations sections. A `0.1.10` degraded-path wave
followed from the live 0.1.9 zero-source run: identical-title collapse
(fold + final ranking), empty-allowlist citation BAN (parametric venue
name-drops), ledger discipline via deep-investigate's adversarial_review
channel, 1200-anchored Elo figure. A `0.1.11` wave closed the two-adversary
before/after audit (verdict: genuinely better; every baseline P0 eliminated)
by fixing their converged remaining defects: a deterministic citation
VERIFICATION loop (re-fetch every ledger URL + title-check; wrong title↔id
pairs barred from citation — caught 2 live), near-identical sibling collapse
+ visible sibling/de-crowded flags, falsification token scrub + form rules,
evidence-verb honesty. Item 0146 (`abstractflow-0146`,
proposed): JsonViewer fork deletion / one-source consolidation, scheduled.

## 2026-07-18 coding-agent deterministic verification gates
Item 0145 (work id `abstractflow-0145`, first item under the ruled
hub-work-join process) records the coding-agent v2 redesign: deterministic
delivery/integration/execution/orphan-function gates before the LLM
verifier, fail-closed web execution via code's `browser_probe`, and the
environment-vs-fixable failure split. Externally validated by code's
harness (cav2: strictly beats v1; cav2r2: taxonomy classes 4+5
FIXED-with-gate, ~2x faster). Receipts + honest limits in the item; the
thread anchor is agora commons c2725→c3031.

## 2026-07-11 entity-agency Phase-B precondition audit
Item 0142 captures the adversary-verified audit of flow's Phase-B guarantee
("basic-agent published + interfaces in the listing payload"): the shipped
bundle vs source drift (max_iterations 20/5/50 three-way disagreement), the
missing repack path, and the per-phase entity workflow picker contract. Build
gated on the entity-agency + entity-config-object sign-offs (agora c713).

## 2026-07-11 general review wave
A seven-agent adversarial review (3 authoring/usability, 3 design/UX, 1
competitive researcher) produced items 0111-0141. Items 0111-0116 were the
top-3-per-group implementation picks — ALL SIX IMPLEMENTED, adversarially
reviewed (2 fable5 implementation reviewers; all P1s and most P2s fixed
same-day), and moved to completed/ with reports. Proposed 0117-0141 preserve
every other ranked finding. Review evidence (file:line) is embedded in each
item's "Current code reality".

- Group 1 (authoring, completed): 0111 run-modal event interaction, 0112
  assistant transport cost overhaul, 0113 catalog parity + Files taxonomy.
- Group 2 (design/UX, completed): 0114 design token integrity + interaction
  states, 0115 run-modal live inspection + failure forensics, 0116 universal
  artifact previewer.

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

## Proposed Ledger (2026-07-11 review wave)
- `proposed/0117_effect_error_branch_retry_timeout.md`: error exec-branch +
  retry/timeout pins on effect nodes (cross-repo with runtime).
- `proposed/0118_async_subflow_fanout_and_honest_parallel.md`: async subflow +
  Gather; honest Parallel description.
- `proposed/0119_event_webhook_schedule_triggers_start_runs.md`: gateway
  trigger registry so events/webhooks/schedules START runs.
- `proposed/0120_first_class_mailbox_durable_emit_drain_reply.md`: durable pin
  on emit_event; drain_inbox/reply_to_event nodes; structured wait keys.
- `proposed/0121_regex_and_aggregation_node_pack.md`: regex match/extract/
  replace/split; sum/min/max/avg; array sort/slice/reverse.
- `proposed/0122_assistant_test_run_loop_and_fix_entrypoints.md`: build-run-fix
  loop, fix-with-assistant buttons, lightweight Q&A path.
- `proposed/0123_file_operations_completeness_pack.md`: append/copy/move/
  delete/find/CSV nodes; read_file caps.
- `proposed/0124_author_visible_memory_inspector_semantic_recall_kv.md`: memory
  panel UI, semantic recall, exact-key KV, stack-convergence note.
- `proposed/0125_partial_execution_and_pinned_data.md`: run-to-node + pinned
  mock data (top competitive gap).
- `proposed/0126_last_run_values_on_canvas.md`: node badges + pin hover values
  from ledger data.
- `proposed/0127_canvas_undo_redo.md`: bounded snapshot stack, Ctrl+Z/redo.
- `proposed/0128_drag_off_pin_quick_add.md`: type-filtered node menu on wire
  release (extends 0089).
- `proposed/0129_sticky_notes_and_frames.md`: canvas documentation primitives.
- `proposed/0130_flow_evaluation_datasets.md`: datasets + scoring + run
  comparison over the existing run path.
- `proposed/0131_theme_safe_chrome_sweep.md`: light-theme correctness for
  hardcoded-dark chrome.
- `proposed/0132_node_icon_language_and_pin_palette.md`: one SVG icon language;
  softened pin/wire palette; legend=canvas.
- `proposed/0133_global_assets_library_and_upload_unification.md`: assets
  modal + one robust upload path (fixes follow-up 30s timeout drift).
- `proposed/0134_run_page_scale_export_and_history_findability.md`: run URL
  identity, virtualization, export, history facets.
- `proposed/0135_open_workspace_outputs_from_run_modal.md`: workspace file
  outputs become open/preview/download chips.
- `proposed/0136_big_output_tooling_and_streaming_text.md`: virtualized JSON,
  search, labeled truncation, YAML/CSV views, streaming-text ask to runtime.
- `proposed/0137_template_gallery_via_gateway_catalog.md`: gallery with
  tags/capability filters/preview.
- `proposed/0138_waits_actionable_everywhere_and_approval_visibility.md`:
  reason-aware notifications, toolbar wait badge, Approve All revoke +
  timeline markers, subrun-attach fix.
- `proposed/0139_faithful_follow_up_context.md`: editable context preview,
  complete seed, single history mechanism, durable threads.
- `proposed/0140_react_loop_template_and_reusable_groups.md`: insertable
  canvas templates, clipboard with edges, reusable groups.
- `proposed/0141_component_decomposition_for_oversized_surfaces.md`:
  incremental extraction plan for the 8k/6.8k/6k/3.5k-line surfaces.

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
- `completed/0111_run_modal_event_interaction_surface.md` (2026-07-11, from
  planned/): send-event composer on event parks (evt: key parse/compose
  verified against the gateway contract), received-event envelope surfaced as
  the park step's result, copy-key affordance. Validation: eventComposer +
  ledgerEvents tests, full vitest/tsc/build, adversarial fable5 review.
- `completed/0112_authoring_assistant_transport_cost_overhaul.md` (2026-07-11,
  from planned/): byte-stable context block on the SYSTEM message
  (review-corrected placement — runtime grounding envelopes make user-prompt
  prefixes uncacheable), sessionless planner/review runs (kills quadratic
  replay AND per-cycle orphan owner runs), 500k cumulative-usage note,
  honest context meter. Validation: prefix-stability tests, full gates.
- `completed/0113_catalog_parity_and_files_taxonomy.md` (2026-07-11, from
  planned/): max_output_tokens pins on llm_call/agent (+ legacy-flow
  migration after review), wait_event until/details advanced folding, Files
  palette category split from Memory, catalog + llms-full regenerated.
- `completed/0114_design_token_integrity_and_interaction_states.md`
  (2026-07-11, from planned/): missing tokens defined (accent-primary/
  secondary/border-color), fallback reconciliation, outline-based
  focus-visible ring (review-corrected vs box-shadow conflicts), calm base
  hover, reduced-motion gates, token-integrity regression test.
- `completed/0115_run_modal_live_inspection_and_failure_forensics.md`
  (2026-07-11, from planned/): follow-live disarm/re-arm (three disarm leaks
  closed post-review incl. terminal-landing steal), failure jump
  expand+scroll, failed-step effect payloads, resume identity threading
  (ask_user/choice/voice; explicit identity honored past live-run paused
  state), follow-up prompt-key fidelity (shared tested helper).
- `completed/0116_universal_artifact_previewer.md` (2026-07-11, from
  planned/): inline PDF (typed blobs)/text/markdown previews with labeled
  truncation + 25MB honest-refusal guard, image lightbox, multi-image
  gallery (per-step keyed, primary always reachable), markdown links
  new-tab except fragments.
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
