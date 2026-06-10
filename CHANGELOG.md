# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Workflow Authoring Assistant switched from incremental command-batch negotiation to direct document authoring: the model now emits the complete workflow as one JSON document (`flow_name`, `nodes`, `edges`) every cycle, and the editor diffs it against the current graph (`src/utils/flowAuthoringDocument.ts`) and compiles the diff into the existing validated command machinery, so all validators, canonicalization (exec fan-out, loop-back removal, route overrides), and security guards remain the single source of truth. Nodes, edges, and dynamic pins omitted from the document are deleted — removal is implicit, and the assistant can no longer ask the user to "remove manually". `pin_defaults` merge per key, node ids are stable identities (type changes require a new id), existing node positions never move, new nodes get execution-depth auto-layout, and secrets round-trip as a `<redacted>` sentinel the diff never writes back. An idempotent re-emit compiles to zero changes, so unchanged documents are correctly detected as stalls. The first cycle aims to one-shot the workflow; later cycles only repair validator errors, readiness issues, and acceptance findings.
- Workflow Authoring Assistant prompt is leaner per cycle (~86k chars / ~21k tokens baseline, down from ~151k chars) with **zero semantic loss** (ADR-0026): the node catalog renders one line per template (`type [template] (category) in[...] out[...] dyn[...] cfg[...] cap:... :: description`) keeping every full node description, pin label, and pin description intact — only repeated headings and command-JSON scaffolding were removed. `docs/workflow-authoring-skill.md` was rewritten for document authoring (the obsolete 17-command schema is gone because it would contradict document mode; ownership semantics, dynamic-pin lists, and repair guidance replace it). A catalog-fidelity test asserts no template or pin description is ever dropped or sliced from the prompt; there is no prompt size budget and no imposed output token budget on planner runs.
- Workflow Authoring Assistant now reports token usage in token terms end to end: every outgoing planner request is logged with an explicit estimated size (`Sending plan request (~21k tokens est. (86k chars) — authoring the full workflow document)`), and after each planner response, `result.usage` is summed across the Gateway run-tree ledgers (root run and subruns, tolerant of `input/output_tokens` and `prompt/completion_tokens` field families) and logged as `Response received (41.2k in / 1.1k out tokens · 12k chars · 1:59)`; cumulative turn totals appear in the status card footer. Usage collection is best-effort observability and never blocks the loop; estimates are labeled `est.` and never used for budgeting decisions.
- Workflow Authoring Assistant requests and responses are now inspectable: `Sending plan request`, `Response received`, and acceptance-review activity entries carry an expandable "Inspect payload" section with the exact system prompt + user prompt sent (or the raw model response) and a one-click copy. Payloads are session-only (persisted activity keeps the entry text but drops the attached payload to protect the localStorage quota).
- Workflow Authoring Assistant live status: the card header now carries the cycle number (`Cycle 3 · Planning workflow graph`), and a shimmering in-flight ticker pinned at the bottom of the activity feed shows what the assistant is waiting on right now — including the request purpose ("authoring the full workflow document", "repairing 2 validation issues", "acceptance review") and the estimated tokens sent — with a per-stage elapsed counter that ticks every second (static under `prefers-reduced-motion`).
- Canvas maximum zoom-out increased from 13 to 17 zoom steps (min zoom ≈ 0.09, roughly 2x more dezoom) so large authored workflows fit on screen.
- `docs/workflow-node-catalog.md` generation now documents the authoring document format (document node snippets, `template` variant selection, document config fields) instead of `add_node` command JSON.

### Added
- Added a `remove_pin` authoring command (the document-ownership counterpart of `add_input_pin`/`add_output_pin`): dynamic, non-execution pins omitted from an emitted document pin list are removed together with their edges; template-owned pins are refused.
- Added a toolbar Execution View toggle that condenses the canvas to the control-flow skeleton: only nodes linked by execution edges (and those edges) stay visible, rendered as compact cards with per-family color, shape, and iconography (events, control flow, user interaction, generative AI, generated media, tools & files, memory, subflow, logic & state). Node positions are preserved so switching between views keeps the same layout.
- Added a `Ctrl/⌘+S` keyboard shortcut that saves the current flow and suppresses the browser "Save page" dialog inside the editor.
- Added a leave-page confirmation (`beforeunload`) when the flow has unsaved changes or a save is still in flight, preventing silent loss of graph edits.
- Added a node palette search empty state ("No nodes match …" with a Clear search action) instead of a blank list when a search has no results.
- Added a first-use empty-canvas hint that explains dragging nodes from the palette and disappears once the flow has nodes.
- Added first-class `Read PDF` and `Write PDF` VisualFlow nodes so workflows can extract PDF text/metadata and render report content to real PDF files through Runtime.
- Added a first-class Restore / Upscale Image media node backed by Gateway's `upscaled_image` contract and `image_upscale` vision catalog task.
- Added a right-drawer Workflow Authoring Assistant that reads `docs/workflow-authoring-skill.md` plus a complete generated node catalog, drafts edits through Gateway's default `output.text` model unless a model is pinned, applies only validated graph commands, and fails closed without draft changes when Gateway/model/JSON/command validation fails.
- Added capability-route filtering for text model discovery, including reusable `output.text` defaults and Models Catalog support for input/output-shaped routes such as `input.image,output.text`.
- Added reasoning/thinking controls for Agent and LLM Call nodes, with Gateway/Core-backed model capability lookup and inline/right-panel selectors for supported reasoning models.
- Added Vitest coverage for node pin disclosure behavior, including compact media nodes, default-value handling, and generated-video defaults.
- Added inline JSON Schema editing for unconnected schema input pins, including a Builder tab for fields and Choice/enum values plus an expert JSON Schema tab.
- Added switch-friendly structured-output authoring: enum-backed response fields can be discovered through Parse JSON / Break Object and synced into explicit Switch cases.

### Added
- The Workflow Authoring Assistant input row now has a max-cycles dropdown next to Send (10/20/40/60/80 autonomous planning cycles per turn, default 40, persisted across sessions). The cap is captured when a turn starts; changing it mid-turn applies from the next turn.

### Fixed
- The provider/model preflight rule for LLM Call and Agent nodes no longer produces unsatisfiable demands. The old rule ("Set both provider and model, or leave both blank for Gateway defaults") fired when the model pin was wired dynamically (e.g. a model pool feeding `llm_call.model` through a loop item) with provider on Gateway defaults — a valid runtime configuration the rule made impossible to satisfy without deleting a needed wire. It also read only the effect config, so typed pin defaults could never clear it. The rule now skips pairs where either pin is connected, reads pin defaults, and the remaining half-typed-default message names the current values (`Provider is "openai" but model is blank — …`) so users and the authoring model can see what to fix. This single false positive cost an authoring run 10 wasted cycles (~15 minutes) before failing the turn.
- Authoring loop stall guard: a cycle whose applied batch is identical to the previous one and leaves identical readiness issues counts as repetition, not progress. The first repeat sends the model a corrective note; the second stops the turn as "needs your input" with the remaining issues instead of grinding the full cycle budget. Rewriting an identical pin default is also now a warning no-op instead of counting as an applied change.
- Authoring applied-change logs now include the written value (`Set llm.provider = "openai"` instead of `Set llm.provider`), so users can see which provider/model/value the assistant actually chose.
- The authoring assistant now enforces its language contract at the boundary instead of trusting the model. A full ledger audit proved the planner model can reply in another language (English reasoning, French reply) with a 100% single-language 157k-char context at temperature 0 — and a replay of the exact same payload returned English, demonstrating serving-layer non-determinism no prompt can prevent. Every cycle's user-visible plan text is now language-checked against the user request (conservative stopword/script detector that abstains on ambiguity); mismatches trigger a bounded retry with a LANGUAGE CORRECTION note (2 per turn, live-validated to rewrite the same plan in the request language), then accept with a `#FALLBACK` activity note. The response schema also requires a leading `language` field as a decoding anchor.
- Switching to the Properties tab (or collapsing the right drawer) no longer wipes the Workflow Authoring Assistant: the drawer now stays mounted once opened (it renders nothing while hidden), so the in-flight autonomous authoring loop, conversation, plan, and activity feed all survive tab switches. Previously the tab switch unmounted the component, destroying the running turn and all in-memory state.
- The authoring status card (plan + activity feed + collapse state) is now persisted per workflow alongside the conversation: it survives page reloads and workflow switches, follows a draft promoted to a saved flow, and is only removed by Clear Chat. A turn that was in flight when the page reloaded is restored as "Interrupted (editor reloaded)" instead of pretending to still run; switching workflows now loads that workflow's own activity feed instead of leaking the previous one.

### Changed
- Workflow Authoring Assistant `connect` now mirrors the canvas connection semantics: connecting a different valid source to an occupied single-entry data input replaces the existing edge (the re-drag gesture), an exact duplicate connect is a no-op warning, and on multi-entry nodes (2+ incoming execution paths) connecting a data pin from a direct execution predecessor adds a per-path route override instead of replacing the base edge. A new `disconnect` command removes an edge by endpoints without replacing it, and "already connected" rejections now name the existing source so the planner can rewire instead of looping. When replacement is blocked by an invalid new edge (e.g. type mismatch), the underlying reason is reported instead of a misleading "already connected".
- Workflow Authoring Assistant planner runs now pin `temperature: 0` so structured command batches are deterministic instead of inheriting the Gateway agent default (0.7), which produced run-to-run language and command variance.
- Workflow Authoring Assistant session policy is now explicit: one durable Gateway session per workflow conversation (scoped to the workflow storage key, never shared across workflows), carried over when a draft is promoted to a saved flow, and rotated by Clear Chat so gateway-side agent memory restarts together with the visible conversation.
- Workflow Authoring Assistant prompt now anchors the language directive at the request site ("write … in the language of THIS request") and marks the replayed conversation as historical context that does not control the language. The gateway agent replays durable session memory into the model context, so without the anchored directive an English request kept producing French workflows when the session/conversation history was French.
- Workflow Authoring Assistant no longer hard-fails a turn when the planner returns `continue` with zero commands ("Gateway assistant returned no graph commands" discarded otherwise-progressing builds): command-less cycles get a corrective note for up to two consecutive cycles, then the turn ends as a "needs your input" message carrying the model's own reply so the user can guide the next turn.
- Workflow Authoring Assistant system prompt and skill now require all user-visible workflow content (flow name, node labels, prompts, replies) to match the language of the user request; the prompt's example label was also de-localized (an English request previously produced a French workflow because the only label example in the prompt was French).
- Workflow Authoring Assistant is now encouraged to ask follow-up questions mid-loop: the prompt/skill instruct the model to return `needs_user` with concrete questions when the request is ambiguous or repair cycles stop progressing, and `needs_user` replies render under an explicit "The assistant needs your input to continue" header.
- Research-scaffold readiness checks (Agent node, sources/citations, audit trace) now apply only when the request's deliverable is researched content (deep research, internet/web research, news, digest, jobs, or "research" coupled to a workflow/report deliverable in the same sentence). An incidental mention of "research" — e.g. "genuine discussion, research, and deepening of ideas" — previously forced 8 unfixable readiness issues onto a multi-LLM discussion workflow and stalled the loop.
- Workflow Authoring Assistant activity feed now groups entries under per-cycle divider rows, making iteration boundaries visible; the status card header gained a leading chevron with hover affordance (clear collapse signal) and a copy button that exports the activity feed (grouped by cycle with elapsed timestamps) to the clipboard.
- Workflow Authoring Assistant command batches are no longer atomic: commands are applied per-command in dependency order (nodes, then configuration, then connections), valid commands are kept even when others fail, and failed commands return to the planner as "skipped commands" feedback. Atomic rejection previously discarded whole batches, so the planner kept referencing nodes that never existed ("Source or target node not found" cascades across repair cycles).
- Workflow Authoring Assistant validator now auto-repairs execution fan-out: connecting an already-connected execution output inserts (or extends) a Sequence node and reports the rewiring as a warning instead of rejecting the edge ("Execution output pin already connected" was a recurring repair-loop trap).
- Workflow Authoring Assistant validator now drops loop-back edges from a loop body to the loop's `exec-in` (with a warning): AbstractRuntime control frames return to the loop automatically when the body chain ends, and an explicit loop-back resets the iteration counter. The authoring skill and system prompt now document these loop/control-frame semantics.
- Workflow Authoring Assistant working state is now a live activity feed (per-cycle plan request/response sizes, plan status and command counts, applied changes with labels, skipped/rejected commands, readiness and acceptance review events) with a spinner, elapsed timer, and cycle label, replacing the two static progress bars that conveyed no real-time information.
- Workflow Authoring Assistant turns can now be interrupted: a Stop control (in the status card and in place of Send while busy) aborts the autonomous loop between calls, best-effort cancels the in-flight Gateway planner run, and reports an explicit "Interrupted" message; applied edits stay in the draft and remain undoable via Undo Turn.
- Workflow Authoring Assistant drawer actions are now compact high-contrast icon buttons (copy, clear, undo at 19px/2px stroke in full text color) on the bottom row next to Send/Stop; the dedicated topbar action row is gone and the top of the drawer only shows the context-usage line while a request is being typed or running. Drawer chrome uses theme variables (`color-mix` on theme tokens) instead of hardcoded dark-biased rgba values so light themes render correctly.
- Workflow Authoring Assistant activity card is now collapsible (header toggles the log) and persists after the turn ends with a final state (green dot "Draft graph updated", red dot "Authoring failed"/"Interrupted by user") so the per-cycle history can be reviewed post-turn; Clear resets it.
- Fixed a loop-exit bug where an accepted `done` (including a passed acceptance review) was re-labeled "Autonomous authoring reached N cycles after validator rejections" because a stale rejected-batch marker from an earlier cycle survived the successful break; cap-exhaustion errors now apply only when the loop genuinely runs out of cycles.
- Workflow Authoring Assistant completion is now model-owned: the autonomous loop keeps cycling while the planner returns `continue` instead of force-stopping as soon as heuristic readiness checks pass (which previously cut the model off mid-build on requests outside the research/PDF/Markdown keyword heuristics, e.g. non-English multi-AI discussion workflows).
- Workflow Authoring Assistant now runs an acceptance review before accepting `done`: the planner declares per-request acceptance criteria, and a second model pass compares the draft graph against the original request; unmet findings are fed back into the loop as issues, and any findings left when the review budget is exhausted are reported with the result instead of being hidden.
- Workflow Authoring Assistant now preserves the planner's own plan memory: applied cycles carry one-line next-step notes into later cycles, and assistant turns are replayed across user turns as trimmed plan/result summaries (`#TRUNCATION`-labeled) so pending plan items are no longer forgotten between turns.
- Workflow authoring skill now documents iterative multi-participant discussion (loop + state) and multi-model fan-out patterns, and the system prompt explicitly forbids collapsing requested multi-participant/multi-model/iteration structure into a single Agent prompt simulation.
- Redesigned the editor toolbar: consistent stroke SVG icons replace mixed emoji/glyphs, actions are organized into segmented groups (file, import/export, run + history, gateway publish/lifecycle/models, workspace tools), Run is a labeled primary button with a running spinner, and the Connect/Disconnect button shows a live connection status dot.
- Execution View compact nodes now reuse the full-view node header (same per-node header color, uppercase title, and sheen) over a dark node body, so node identity carries across both modes while family icon and silhouette cues remain; the full-view header gained the same subtle sheen for harmony.
- Replaced the Execution View toolbar glyph (three dots on a line, easily read as a plain line) with a clearer node-to-node arrow icon, and toggle buttons now use accent-tinted pressed styling that works in all themes.
- Toolbar buttons now use fast AfTooltip hints (with disabled-state explanations and the save shortcut) instead of slow native `title` tooltips; `AfTooltip` gained a `minWidthPx` override for compact hints.
- Model residency and media provider/model selectors now include the `image_upscale` task for Gateway/Core upscaler discovery and explicit load/unload steps.
- Workflow Authoring Assistant PDF readiness now requires an executable `Write PDF` node and exposed PDF path instead of accepting Code or generic Write File workarounds.
- Compact node rendering now uses a shared pin disclosure policy so nodes show required, connected, or explicitly configured pins by default and hide optional/default/diagnostic pins behind a chevron.
- Workflow Authoring Assistant now shows prompt size plus Gateway-discovered model context/output limits and includes a Clear Chat control instead of trimming conversation history.
- Workflow Authoring Assistant now persists drawer chat/draft/session state across close/reopen and uses the authoring skill instead of generic `llms-full.txt` context for graph construction.
- Improved canvas rendering with clearer node cards, stronger edge readability, state-aware MiniMap node styling, and a pannable/zoomable preview.
- Restyled the MiniMap collapse/expand control as an icon button and moved React Flow attribution away from the preview while removing its grey backing.
- Restyled the schema-pin editor modal with clearer titles, validation, and editable Choice chips while keeping saved data as standard JSON Schema.

### Fixed
- Pin type compatibility now lets the dynamic `any` type connect to nominal provider/model pins: ForEach `item`, Get Variable `value`, Code outputs, and Parse JSON results are all `any`, so the documented multi-model pattern `loop.item -> llm_call.model` (and reading a model-typed variable) was unconstructible for both the authoring assistant and canvas users. Execution pins and non-`any` payload types (e.g. `string -> model`) keep their nominal guards.
- Authoring commands can now configure Variable nodes (`var_decl`/`bool_var`), which have no input pins: `set_pin_default` on pin `name`/`value` maps onto the declaration config, and `set_literal` accepts the canonical `{name, type, default}` object (or a bare value as the default), keeping the value output pin type in sync with the declared type. Previously these commands were refused ("unknown input pin 'name' on var_transcript") with no supported alternative.
- Connection and pin-default rejections now list the real pins so authors can self-correct: "Output pin 'end' not found (available outputs: loop, done, i, index)" and "unknown input pin 'instructions' on llm (available input pins: ...)" instead of dead-end messages.
- `add_node` without a descriptive label now records a non-blocking validator note (event nodes excepted), and the authoring prompt/skill instruct the model to label every node with its role in the user's language, so generated workflows stop shipping walls of "Variable"/"Array" default labels.
- Workflow Authoring Assistant plan parsing is now tolerant of model formatting: plan and acceptance-review JSON is extracted from markdown fences and prose-wrapped responses via a string-aware balanced-brace scan, instead of requiring the raw response to be bare JSON. Strict parsing previously made a fenced or prose-prefixed answer look like a missing response and killed the turn as "completed without an authoring response in its run tree ledger".
- Workflow Authoring Assistant no longer aborts the whole turn on one unusable planner response: an empty run output or unparseable/truncated plan JSON now retries the same cycle (up to 3 unusable responses per turn) with a corrective format note asking for bare JSON and smaller command batches, and the retry is logged in the activity feed. Previously a single bad cycle-2 response discarded an otherwise progressing turn, leaving nodes without edges.
- Theme support: the theme selector dropdown (and other AfSelect popovers) no longer hardcodes dark panel colors that broke light themes — app-level overrides were removed in favor of the ui-kit's theme-aware styles, with node-scoped colors kept for inline pin selects inside the intentionally dark node frames.
- Theme support: toolbar group chrome, toggle states, the offline connection dot, and the empty-canvas hint now derive from theme variables instead of white-alpha/hardcoded darks, so they stay visible in light themes.
- Theme support: the edge underlay now follows the canvas background color per theme, removing the chain-link edge artifacts that appeared on light themes.
- Workflow Authoring Assistant requests now keep full prior turns inside the current prompt instead of sending assistant-led chat history to OpenAI-compatible endpoints, avoiding LM Studio/Qwen prompt-template failures without imposing a local model-context cap.
- Model selectors now request provider models with the appropriate capability route so discovery stays aligned with Gateway/Core model capability metadata.
- Optional single-pin disclosures no longer collapse unnecessarily, and thinking pins stay hidden for models without detected thinking support unless already configured.
- Schema Builder mode no longer drops JSON Schema `enum` values when switching between Builder and JSON Schema editing.

## [0.3.18] - 2026-06-03

### Changed
- Reorganized AbstractFlow as the web editor package `@abstractframework/flow` at the repository root.
- Moved sample VisualFlow JSON files from `web/flows/` to `examples/flows/`.
- Rewrote current docs around the web package, Gateway connection flow, and Gateway/Runtime ownership boundaries.

### Removed
- Removed the Python package, Python packaging metadata, Python tests, FastAPI compatibility backend, generated Python docs site, and local runtime artifacts from the AbstractFlow repository.

## [0.3.17] - 2026-05-31

### Added
- Hosted Flow sessions can sign in with Gateway URL, user id, and token. Flow validates that the token resolves to the requested Gateway user, exchanges it for an opaque Gateway browser session, and stores only that session id in an HTTP-only browser-session cookie; the `/api/gateway/*` proxy resolves that request session before any server-wide Gateway token so different browsers can connect as different Gateway principals.
- Flow provider/model discovery now includes Gateway provider endpoint profiles as virtual providers, including OpenAI-compatible endpoints configured in the Gateway Console.

### Changed
- Remote browser connection updates may provide a token for the server-configured Gateway URL without mutating Flow server environment state. Remote browsers still cannot change the Gateway URL unless `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is enabled.
- Apple/GPU Flow profiles now require Gateway `>=0.2.23` and Agent `>=0.3.10`.

### Fixed
- Flow's Gateway proxy now strips browser-supplied `Authorization`, `Cookie`, forwarded, and other unapproved request headers before proxying, then injects only the resolved opaque Gateway browser session and CSRF token where required.

## [0.3.16] - 2026-05-29

### Added
- Artifact input selection in the Run modal, including Gateway-backed search/filtering for reusable text, document, image, video, voice, audio, and music artifacts.
- Artifact search/import/export contract support in the Gateway client layer, while keeping file read/write behavior as graph-level nodes rather than modal-only actions.
- Staged Deep Research demo workflow for authoring demonstrations.

### Changed
- Media nodes now surface the critical sampling controls (`steps`, `seed`, and `guidance`) consistently for image and video generation/editing, with model defaults used when fields are left empty.
- Run progress rendering now includes elapsed/estimated remaining time when Gateway progress events provide enough timing data.
- The Run modal now uses a window-style top bar and only shows lifecycle actions that match the current run state.
- Apple/GPU Flow profiles now require Gateway `>=0.2.21` and Agent `>=0.3.9`; hosted CI/release tests install the base Gateway package because HTTP/SSE is part of the light install.

### Fixed
- Media provider selectors now keep image/video provider defaults scoped to media providers instead of showing text-only providers.
- Canvas interactions avoid stale pointer-capture state after trackpad/mouse release events.
- Generated media cards no longer expose a modal-level export button; artifact-to-file workflows should use graph nodes.

## [0.3.15] - 2026-05-26

### Added
- Native Generate Video and Image-to-Video authoring in the Flow editor, including scoped video provider/model pins, Gateway readiness checks, run preflight, artifact previews, and Runtime compatibility execution.
- Gateway `abstract.progress` ledger events now render as running-step progress in the Run modal.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.20` for the video media, progress, catalog, and model-residency contracts.
- Model residency and default routing now use task-scoped Gateway vision catalogs for `text_to_video` and `image_to_video` instead of reusing image defaults.
- Hosted CI/release tests now install the host-neutral Gateway HTTP stack instead of macOS-only Apple extras on Ubuntu runners.

## [0.3.14] - 2026-05-26

### Added
- Gateway-aware palette, preflight, live connection feedback, run lifecycle, workflow bundle, variable-name, and media artifact helpers for the thin-client editor.
- Validated code-editor execution policy and prompt-free variable selector improvements.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.19` and Agent `>=0.3.8`; Runtime/Core are still consumed through Gateway extras.
- Media defaults and advanced media pin disclosure now use one editor surface backed by Gateway discovery.

### Fixed
- Repaired code node, pin, media artifact, and run UI regressions around resumed runs, validated variables, and modality-specific source selection.

## [0.3.13] - 2026-05-22

### Added
- Native Generate Music authoring against the released Runtime/Gateway media contract, including Gateway music catalog selectors, music residency targeting, and advanced music controls.
- Image edit/image-to-image node templates and controls aligned with Gateway's generated media contracts.
- Gateway catalog v1 helpers that prefer canonical `items` envelopes while retaining legacy catalog fallbacks.
- Artifact reference primitives for text, image, voice, music, and video references in the palette.
- Artifact literal editor and built-in artifact content previews (image/audio/video) backed by Gateway artifact content endpoints.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.18`; Runtime/Core are consumed through Gateway extras instead of direct Flow dependencies.
- Generated media readiness honors Gateway's `common.readiness` surface summary when available while remaining compatible with legacy direct endpoint descriptors.
- Gateway proxy/model residency operations now allow long media and warmup requests without the previous short frontend/backend timeout path.

### Fixed
- Removed browser-side Generate Music lowering. Old lowered flows are normalized back to native `generate_music` when loaded or saved.
- Python VisualFlow models now accept the new native media node types without importing Runtime/Core at package import time.
- Warm/unload authoring is Gateway-only, allows Gateway default provider/model selection, and no longer disables all media residency controls from stale per-task support flags.
- Music provider/model changes clear stale backend overrides so Stable Audio 3 and Stable Audio Open do not inherit the wrong backend.
- Media previews are modality-aware and can fetch child-run/projected artifacts without using the wrong run id.
- Run preflight now catches missing media prompts and required source artifacts before starting a run.

## [0.3.12] - 2026-05-19

### Fixed
- Generate Image, Generate Voice, Transcribe Audio, and Listen Voice selectors now rely on Gateway provider catalogs instead of hardcoded media model fallbacks.
- Supertonic voice options now come from the Gateway voice catalog, so Flow surfaces the same voices that Gateway can execute.
- Media nodes keep image, TTS, and STT provider/model selections in media-specific fields instead of falling back to generic LLM `provider`/`model` values.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.14`, Runtime `>=0.4.14`, and Core `>=2.13.15`.

## [0.3.11] - 2026-05-13

### Fixed
- Media node controls keep image, TTS, and STT model selectors in media-specific fields so runtime LLM provider/model inputs no longer overwrite generated media routing.
- Listen Voice nodes now expose the Gateway STT model selector and pass the chosen transcription model through wait metadata.

### Changed
- Apple/GPU Flow profiles now require Runtime `>=0.4.11` and Core `>=2.13.14`.
- Frontend npm package metadata is aligned with the Python release version for the next npm publication.


## [0.3.10] - 2026-05-12

### Added
- AbstractFlow media node properties now load Gateway voice profiles, TTS models, STT models, provider image models, and cached local vision models from Gateway catalog routes.
- Generate Image, Generate Voice, Transcribe Audio, and Listen Voice nodes now expose simple Gateway Media controls for local/provider model selection.

### Fixed
- Image, TTS, and STT selectors now write media-specific fields (`image_provider`/`image_model`, `tts_model`, `stt_model`) instead of overloading LLM routing `provider`/`model`.
- Apple/GPU Flow release-profile installs now include `abstractagent>=0.3.7`, so Agent-node workflow validation matches the capabilities shipped in the local host profiles.

### Changed
- Apple/GPU Flow install profiles now require Runtime `>=0.4.10` and Core `>=2.13.13` while keeping Gateway as a separately installed server dependency to avoid a Flow/Gateway release-order cycle.

## [0.3.9] - 2026-05-11

### Changed
- Release/install profile guidance now consistently targets canonical install profiles: `abstractflow`, `abstractflow[apple]`, `abstractflow[gpu]`.
- Runtime profile references and CLI error messages were updated across docs/code paths to remove `all-apple`, `all-gpu`, `runtime`, and `standalone` guidance.

### Fixed
- Release workflow manual dispatch now handles existing tags safely:
  - existing `vX.Y.Z` tags for the same commit are reused,
  - mismatched tag/commit state now fails with a clear remediation message.

### Added
- Release notes/packaging metadata refresh for the corrected profile taxonomy and corrected dependency/error messaging.

## [0.3.8] - 2026-05-09

### Added
- **Gateway contract strictness for run detail helpers**: AbstractFlow now requires Gateway discovery descriptors for
  `capabilities.contracts.common.runs.input_data` and `capabilities.contracts.common.runs.history_bundle` (or
  `contracts.flow_editor.runs.*`) before enabling run rehydration and run history replay in the editor UX.
  Missing helper descriptors in versioned contracts now produce explicit readiness failures instead of
  implicit path assumptions.
- **Gateway capability readiness checks**: New `gatewayClient` helpers (`getGatewayFlowEditorReadiness`,
  `endpointFromDescriptor`, `descriptorEndpointAvailable`) and the `useGatewayCapabilities` hook
  (`gatewayReadinessFromCapabilities`) for frontend capability discovery.
- **Gateway connectivity check**: New `check_gateway_connection()` and `require_gateway_connectivity()`
  functions in `gateway_options.py` for early validation of gateway reachability.
- **Lazy runtime exports**: `abstractflow.__init__.py` now uses `__getattr__` to lazily import runtime
  dependencies (Flow, FlowRunner, compile_flow, etc.), enabling a true thin-client install profile.
- **npm publish job**: Release workflow now publishes the frontend CLI (`@abstractframework/flow`) to npm
  alongside the PyPI release.

### Changed
- **Descriptor-driven endpoint usage in editor paths**: `RunFlowModal` and `Toolbar` now resolve
  run helper endpoints through descriptors and only use fallback canonical paths for legacy, non-versioned
  Gateway contracts.
- **CLI workflow bundle loading**: `abstractflow bundle` commands now lazily import `abstractruntime` to
  avoid hard dependencies on the runtime stack for thin-client users.
- **Install profile names**: Updated all documentation and CLI error messages to use canonical profiles
  (`abstractflow`, `abstractflow[apple]`, `abstractflow[gpu]`).

### Fixed
- **Gateway auth token resolution**: Simplified `resolve_gateway_token()` to use a single env var
  (`ABSTRACTGATEWAY_AUTH_TOKEN`) and removed fragile comma-split fallback.

### Notable cleanup for thin-client direction
- Documentation and install guidance now use the canonical profiles:
  - `abstractflow` (thin client)
  - `abstractflow[apple]` / `abstractflow[gpu]` (local execution + gateway-compatible host stack)

## [0.3.7] - 2026-05-06

### Added
- **Release and documentation automation**:
  - GitHub Actions now builds the MkDocs documentation site in CI and on releases.
  - Tagged releases deploy the docs site to the `gh-pages` branch after PyPI and GitHub Release publication.
  - Added a MkDocs Material documentation site configuration.
- **Centralized package version source**: `abstractflow/_version.py` is now the single source of truth for release version metadata.
- **AbstractCode UI event demo flows** (`web/flows/*.json`):
  - `acagent_message_demo.json`: `abstractcode.message`
  - `acagent_ask_demo.json`: durable ask+wait via `wait_event.prompt`
  - `acagent_tool_events_demo.json`: `abstractcode.tool_execution` + `abstractcode.tool_result`
- **Tool observability wiring improvements (Visual nodes)**:
  - `LLM Call` exposes `tool_calls` as a first-class output pin (same as `result.tool_calls`) for easier wiring into `Tool Calls` / `Emit Event`.
  - `Agent` exposes best-effort `tool_calls` / `tool_results` extracted from its scratchpad trace (post-run ergonomics).
- **Pure Utility Nodes (Runtime-backed)**:
  - `Stringify JSON` (`stringify_json`): Render JSON (or JSON-ish strings) into text with a `mode` dropdown (`none` | `beautify` | `minified`). Implementation delegates to `abstractruntime.rendering.stringify_json` for consistent host behavior.
  - `Agent Trace Report` (`agent_trace_report`): Render an agent scratchpad (`node_traces`) into a condensed Markdown timeline of LLM calls and tool actions (full tool args + results, no truncation). Implementation delegates to `abstractruntime.rendering.render_agent_trace_markdown`.

### Changed
- **Run Flow modal (array parameters)**: Array pins now render as a Blueprint-style item list (add/remove items) with a "Raw JSON (advanced)" escape hatch for non-string arrays.

### Fixed
- **FlowRunner SUBWORKFLOW auto-drive**: `FlowRunner.run()` no longer hangs if the runtime registry contains only subworkflow specs (common in unit tests). It now falls back to the runner’s own root `WorkflowSpec` when resuming/bubbling parents.
- **GitHub CI portability**: Tests and frontend build now work from a clean GitHub checkout instead of relying on local workspace-only paths.

## [0.3.4] - 2026-02-06

### Added
- **More AbstractCore “common tools” in the editor**: `skim_url` and `skim_websearch` are now included in `/api/tools` and are executable by the default host tool executor.
- **Comms tools documentation**: clarified how to opt into email/WhatsApp/Telegram tools via env flags.

## [0.3.3] - 2026-02-06

### Added
- **Historical install profile**: `abstractflow[standalone]` was the then-current profile for the Visual Editor backend.
  It is now replaced by the current split: `abstractflow` (thin client),
  `abstractflow[apple]`, and `abstractflow[gpu]`.

## [0.3.2] - 2026-02-06

### Added
- **Packaged visual editor backend** (FastAPI) as part of the then-current `abstractflow[standalone]` profile:
  - `abstractflow serve ...` CLI subcommand
  - `abstractflow-backend ...` console script (alias of `python -m backend`)

### Changed
- **Backend runtime directory defaults**:
  - source checkout: `web/runtime/`
  - installed package: `~/.abstractflow/runtime`
  - override: `ABSTRACTFLOW_RUNTIME_DIR`
- **Backend flow storage can be overridden** via `ABSTRACTFLOW_FLOWS_DIR` (default remains `./flows`).
- **Default publish directory** is now `./flows/bundles/` (override via `ABSTRACTFLOW_PUBLISH_DIR`).

### Fixed
- **`npx @abstractframework/flow` UI server now proxies `/api/*`** (HTTP + WebSocket) to the backend, preventing “Save failed: JSON.parse …” when the backend is running.

## [0.3.1] - 2026-02-04

### Added
- **User-facing documentation set** for public release:
  - Core docs: `README.md`, `docs/getting-started.md`, `docs/architecture.md`, `docs/api.md`, `docs/faq.md`
  - Repo policies: `CONTRIBUTING.md`, `SECURITY.md`, `ACKNOWLEDMENTS.md`
  - Agentic index: `llms.txt`, `llms-full.txt`

### Changed
- **Documentation accuracy + structure**: refreshed docs to match the implemented code (VisualFlow portability, runtime wiring, CLI bundle tooling, web editor layout) and improved cross-references for first-time users.

## [0.3.0] - 2025-01-06

### Added
- **VisualFlow Interface System** (`abstractflow/visual/interfaces.py`): Declarative workflow interface markers for portable host validation, enabling workflows to be run as specialized capabilities with known IO contracts
  - `abstractcode.agent.v1` interface: Host-configurable prompt → response contract for running a workflow as an AbstractCode agent
  - Interface validation with required/recommended pin specifications (provider/model/tools/prompt/response)
  - Auto-scaffolding support: enabling `abstractcode.agent.v1` auto-creates `On Flow Start` / `On Flow End` nodes with required pins
- **Structured Output Support**: Visual `LLM Call` and `Agent` nodes accept optional `response_schema` input pin (JSON Schema object) for schema-conformant responses
  - New literal node `JSON Schema` (`json_schema`) to author schema objects
  - New `JsonSchemaNodeEditor` UI component for authoring schemas in the visual editor
  - Pin-driven schema overrides node config and enables durable structured-output enforcement via AbstractRuntime `LLM_CALL`
- **Tool Calling Infrastructure**:
  - Visual `LLM Call` nodes support optional **tool calling** via `tools` allowlist input (pin or node config)
  - Expose structured `result` output object (normalized LLM response including `tool_calls`, `usage`, `trace_id`)
  - Inline tools dropdown in node UI (when `tools` pin not connected)
  - Visual `Tool Calls` node (`tool_calls`) to execute tool call requests via AbstractRuntime `EffectType.TOOL_CALLS`
  - New pure node `Tools Allowlist` (`tools_allowlist`) with inline multi-select for workflow-scope tool lists
  - Dedicated `tools` pin type (specialized `string[]`) for `On Flow Start` parameters
- **Control Flow & Loop Enhancements**:
  - New control node `For` (`for`) for numeric loops with `start`/`end`/`step` inputs and `i`/`index` outputs
  - `While` node now exposes `index` output pin (0-based iteration count) and `item:any` output pin for parity with `ForEach`
  - `Loop` (Foreach) now invalidates cached pure-node outputs per-iteration (fixes scratchpad accumulation)
- **Workflow Variables**:
  - New pure node `Variable` (`var_decl`) to declare workflow-scope persistent variables with explicit types
  - New pure node `Bool Variable` (`bool_var`) for boolean variables with typed outputs
  - New execution node `Set Variables` (`set_vars`) to update multiple variables in a single step
  - New execution node `Set Variable Property` (`set_var_property`) to update nested object properties
  - `Get Variable` (`get_var`) reads from durable `run.vars` by dotted path
  - `Set Variable` (`set_var`) updates `run.vars` with pass-through execution semantics
- **Custom Events** (Blueprint-style):
  - `On Event` listeners compiled into dedicated durable subworkflows (auto-started, session-scoped)
  - `Emit Event` node dispatches durable events via AbstractRuntime
- **Run History & Observability**:
  - New web API endpoints: `/api/runs`, `/api/runs/{run_id}/history`, `/api/runs/{run_id}/artifacts/{artifact_id}`
  - UI "Run History" picker (🕘) to open past runs and apply pause/resume/cancel controls
  - Run modal shows clickable **run id** pill (hover → copy to clipboard)
  - Run modal header token badge reflects cumulative LLM usage across entire run tree
  - WebSocket events include JSON-safe ISO timestamp (`ts`)
  - Runtime node trace entries streamed incrementally over WebSocket (`trace_update`)
  - Agent details panel renders live sub-run trace with expandable prompts/responses/errors
- **Pure Utility Nodes**:
  - `Parse JSON` (`parse_json`) to convert JSON/JSON-ish strings into objects
  - `coalesce` (first non-null selection by pin order)
  - `string_template` (render `{{path.to.value}}` with filters: json, join, trim)
  - `array_length`, `array_append`, `array_dedup`
  - `Compare` (`compare`) now has `op` input pin supporting `==`, `>=`, `>`, `<=`, `<`
  - `get` (Get Property) supports `default` input and safer nested path handling (e.g. `a[0].b`)
- **Memory Node Enhancements**:
  - `Memorize` (`memory_note`) adds optional `location` input
  - `Memorize` supports **Keep in context** toggle to rehydrate notes into `context.messages`
  - `Recall` (`memory_query`) adds `tags_mode` (all/any), `usernames`, `locations` inputs
- **Subflow Enhancements**:
  - `Subflow` supports **Inherit context** toggle to seed child run's `context.messages` from parent
  - `multi_agent_state_machine` accepts `workspace_root` parameter to scope agent file/system tools
- **Visual Execution Defaults**:
  - Default **LLM HTTP timeout** (7200s, overrideable via `ABSTRACTFLOW_LLM_TIMEOUT_S`)
  - Default **max output token cap** (4096, overrideable via `ABSTRACTFLOW_LLM_MAX_OUTPUT_TOKENS`)
- **UI/UX Improvements**:
  - Run preflight validation panel with itemized "Fix before running" checklist
  - Node tooltips available in palette and on-canvas (hover > 1s)
  - Node palette exposed transforms (`trim`, `substring`, `format`) and math ops (`modulo`, `power`)
  - Enhanced `PropertiesPanel` with structured output configuration
  - Improved `RunFlowModal` with better input validation and error display
  - JSON validation and error handling across executor and frontend (`web/frontend/src/utils/validation.ts`)

### Changed
- **Workflow-Agent Interface UX**: Enabling `abstractcode.agent.v1` auto-scaffolds `On Flow Start` / `On Flow End` pins (provider/model/tools)
- **Memory Nodes UX**: `memory_note` labeled **Memorize** (was Remember) to align with AbstractCode `/memorize`
- **Flow Library Modal**: Flow name/description edited via inline pencil icons (removed Rename/Edit Description buttons)
- **Run Modal UX**:
  - String inputs default to 3-line textarea
  - Modal actions pinned in footer (body scrolls)
  - No truncation of sub-run/memory previews (full content on demand)
  - JSON panels (`Raw JSON`, `Trace JSON`, `Scratchpad`) syntax-highlighted
- **Node Palette Organization**:
  - Removed **Effects** category
  - Added **Memory** category (memories + file IO)
  - Added **Math** category (after Variables)
  - Moved **Delay** to **Events**
  - Split into **Literals**, **Variables**, **Data** (renamed from "Data" to **Transforms**)
  - Reordered **Control** nodes (loops → branching → conditions)
  - `System Date/Time` moved to **Events**
  - `Provider Catalog` + `Models Catalog` moved to **Literals**
  - `Tool Calls` moved from **Effects** to **Core** (reordered: Subflow, Agent, LLM Call, Tool Calls, Ask User, Answer User)
- **Models Catalog**: Removed deprecated `allowed_models` input pin (in-node multi-select synced with right panel)
- **Node/Pin Tooltips**: Appear after 2s hover, rendered in overlay layer (no clipping)
- **Python Code Nodes**: Include in-node **Edit Code** button; editor injects "Available variables" comment block
- **Execution Highlighting**: Stronger, more diffuse bloom for readability during runs; afterglow decays smoothly (3s), highlights only taken edges
- **Data Edges**: Colored by data type (based on source pin type)

### Fixed
- **Recursive Subflows**: Visual data-edge cache (`flow._node_outputs`) now isolated per `run_id` to prevent stale outputs leaking across nested runs (fixes self/mutual recursion with pure nodes like `compare`, `subtract`)
- **Durable Persistence**: `on_flow_start` no longer leaks internal `_temp` into cached node outputs (prevented `RecursionError: maximum recursion depth exceeded`)
- **WebSocket Run Controls**: Pause/resume/cancel no longer block on per-connection execution lock (responsive during long-running LLM/Agent nodes)
- **WebSocket Resilience**:
  - Controls resilient to transient disconnects (can send with explicit `run_id`, UI reconnects-and-sends)
  - Execution resilient to UI disconnects (dropped connection doesn't cancel in-flight run)
- **VisualFlow Execution**: Ignores unreachable/disconnected execution nodes (orphan `llm_call`/`subflow` can't fail initialization)
- **Loop Nodes**:
  - `Split` avoids spurious empty trailing items (e.g. `"A@@B@@"`) so `Loop` doesn't execute extra empty iteration
  - Scheduler-node outputs in WebSocket `node_complete`: Loop/While/For sync persisted `{index,...}` outputs to `flow._node_outputs` (UI no longer shows stale index)
- **Pure Node Behavior**:
  - `Concat` infers stable pin order (a..z) when template metadata missing
  - `Set Variable` defaulting for typed primitives: `boolean/number/string` pins default to `false/0/""` instead of `None`
- **Agent Nodes**: Reset per-node state when re-entered (e.g. inside `Loop` iterations) so each iteration re-resolves inputs
- **Run Modal Observability**:
  - WebSocket `node_start`/`node_complete` events include `runId` (distinguish root vs child runs)
  - Visual Agent nodes start ReAct subworkflow in **async+wait** mode for incremental ticking
  - Run history replay synthesizes missing `node_complete` events for steps left open in durable ledger
- **Canvas Highlighting**: Robust to fast child-run emissions (race with `node_start` before `runId` state update fixed)
- **WebSocket Subworkflow Waits**: Correctly close waiting node when run resumes past `WAITING(reason=SUBWORKFLOW)`
- **Web Run History**: Reliably shows persisted runs regardless of server working directory (backend defaults to `web/runtime` unless `ABSTRACTFLOW_RUNTIME_DIR` set)
- **Cancel Run**: No longer surfaces as `flow_error` from `asyncio.CancelledError` (treated as expected control-plane operation)
- **Markdown Code Blocks**: "Copy" now copies original raw code (preserves newlines/indentation) after syntax highlighting

### Technical Details
- **13 commits**, **48 files changed**: 12,142 insertions, 368 deletions
- New module: `abstractflow/visual/interfaces.py` (347 lines)
- New UI component: `web/frontend/src/components/JsonSchemaNodeEditor.tsx` (460 lines)
- New tests: `test_visual_interfaces.py`, `test_visual_agent_structured_output_pin.py`, `test_visual_llm_call_structured_output_pin.py`, `test_visual_subflow_recursion.py`
- Compiler enhancements: Interface validation, per-run cache isolation, structured output pin support
- Executor optimizations: Performance improvements for VisualFlow execution
- 12 new example workflow JSON files in `web/flows/`

### Notes
- This repository includes the published Python package (`abstractflow/`) and a reference visual editor app (`web/`).

## [0.1.0] - 2025-01-15

### Added
- Initial placeholder package to reserve PyPI name
- Basic project structure and packaging configuration
- Comprehensive README with project vision and roadmap
- MIT license and contribution guidelines
- CLI placeholder with planned command structure

### Notes
- This is a placeholder release to secure the `abstractflow` name on PyPI
- No functional code is included in this version
- Follow the GitHub repository for development updates and release timeline
