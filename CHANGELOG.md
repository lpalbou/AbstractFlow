# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.10] - 2026-05-12

### Added
- AbstractFlow media node properties now load Gateway voice profiles, TTS models, STT models, provider image models, and cached local vision models from Gateway catalog routes.
- Generate Image, Generate Voice, Transcribe Audio, and Listen Voice nodes now expose simple Gateway Media controls for local/provider model selection.

### Fixed
- Image, TTS, and STT selectors now write media-specific fields (`image_provider`/`image_model`, `tts_model`, `stt_model`) instead of overloading LLM routing `provider`/`model`.

### Changed
- Apple/GPU Flow install profiles now require Gateway `>=0.2.9`, Runtime `>=0.4.10`, and Core `>=2.13.13`.

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
