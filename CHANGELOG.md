# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Notes
- In this monorepo, `abstractflow` contains a working Flow compiler/runner and VisualFlow execution utilities. Packaging/docs alignment is tracked in `docs/backlog/planned/093-framework-packaging-alignment-flow-runtime.md`.

### Fixed
- VisualFlow execution now ignores unreachable/disconnected execution nodes (e.g. orphan `llm_call` / `subflow` nodes) so they cannot fail run initialization.
- Recursive subflows (self/mutual) now terminate correctly when the base case depends on **pure nodes** (e.g. `compare`, `subtract`): the visual data-edge cache (`flow._node_outputs`) is now isolated per `run_id` to prevent stale outputs leaking across nested runs.
- `Split` now avoids spurious empty trailing items (common with delimiter-terminated strings like `"A@@B@@"`) so downstream `Loop` nodes don't execute an extra empty iteration.
- `Loop` (Foreach) now invalidates cached pure-node outputs (e.g. `concat`) per-iteration so loop bodies don't reuse stale values from iteration 0 (fixes scratchpad accumulation workflows).
- `Concat` now infers a stable pin order (a..z) when template pin metadata is missing (common in programmatic/test-built VisualFlows), so connections to `b/c/...` are honored.
- Durable persistence no longer crashes on file-backed runs: `on_flow_start` no longer leaks internal `_temp` into cached node outputs (which could create self-referential cycles and raise `RecursionError: maximum recursion depth exceeded` during JSON persistence).
- WebSocket run controls are now responsive during long-running steps: pause/resume/cancel no longer block on the per-connection execution lock (important when LLM/Agent nodes stall).
- Web run controls are now resilient to transient WebSocket disconnects: pause/resume/cancel can be sent with an explicit `run_id`, and the UI will reconnect-and-send for control actions when needed.
- WebSocket execution is now resilient to transient UI disconnects: a dropped WebSocket connection no longer cancels the in-flight run task (execution continues durably; the UI is an observability/control channel).
- Web run history now reliably shows persisted runs regardless of the server working directory (web backend defaults runtime persistence to `abstractflow/web/runtime` unless `ABSTRACTFLOW_RUNTIME_DIR` is set).
- `Cancel Run` no longer surfaces as a `flow_error` from an internal `asyncio.CancelledError` (treated as an expected control-plane operation).
- Visual `Agent` nodes now reset per-node state when re-entered (e.g. inside `Loop` iterations), so each iteration re-resolves inputs and runs the agent with the current scratchpad/task instead of reusing iteration 0.
- Run modal observability for Agent nodes is improved:
  - WebSocket `node_start` / `node_complete` events now include `runId`, allowing the UI to distinguish root visual runs from child/sub-runs.
  - The Agent details panel now renders a live sub-run trace of internal LLM/tool steps (expandable with prompts/responses/errors).
  - Runtime node trace entries are now streamed incrementally over WebSocket (`trace_update`) so Agent traces update during execution instead of only after the Agent node completes.
  - Visual Agent nodes now start their ReAct subworkflow in **async+wait** mode so the WebSocket runner can tick the child run incrementally (required for real-time `trace_update` streaming).
- Canvas execution highlighting is now robust to fast child-run emissions: a race where child-run `node_start` events could arrive before the root `runId` state update (causing incorrect node highlights due to `node-#` id collisions) is fixed.
- WebSocket subworkflow waits now correctly close the waiting node when the run resumes past `WAITING(reason=SUBWORKFLOW)`, preventing steps from getting stuck as RUNNING in the Run modal.
- Run history replay (`/api/runs/{run_id}/history`) now synthesizes missing `node_complete` events for steps left open in the durable ledger (common with async+wait subworkflow nodes), so past runs don’t show “forever running” steps.
- Web run “afterglow” execution highlighting now decays smoothly (3s) and highlights only the execution edges actually taken (prev → next), avoiding misleading branch highlighting on conditional/control nodes.
- Data edges are now colored by their data type (based on the source pin type) to improve readability in dense graphs.
- Markdown code block “Copy” now copies the original raw code (preserving newlines/indentation) even after syntax highlighting is applied.
- Run modal header token badge now reflects cumulative LLM usage across the entire run tree (including loops, subflows, and agent subruns) by aggregating `llm_call` usage from the durable ledger.

### Changed
- Memory nodes UX naming: `memory_note` is now labeled **Memorize** (was Remember) to align with AbstractCode `/memorize` and reduce ambiguity with span tagging.
- Flow Library modal UX: flow name/description are now edited via inline edit icons (pencil) and the action row is simplified (removed `Rename` / `Edit Description` buttons).
- Run modal now shows a discreet, clickable **run id** pill (hover → click to copy to clipboard) for better observability/debugging.
- Run modal UX: string inputs now default to a 3-line textarea, and modal actions are always pinned in the footer (the body scrolls).
- Run modal observability no longer truncates sub-run (Agent) step previews or memory previews; full recalled content is displayed (loaded on demand).
- Run modal JSON panels (`Raw JSON`, `Trace JSON`, `Scratchpad`) are now syntax-highlighted for readability.
- In-run execution highlighting (nodes/edges) now has a stronger, more diffuse bloom to improve readability while flows are running.
- Node palette UX is simplified for discoverability:
  - removed **Effects**
  - added **Memory** (memories + file IO)
  - moved **Delay** to **Events**
  - split “values/state vs transforms” into **Literals**, **Variables**, and **Data**
  - reordered **Control** nodes (loops → branching → conditions)
- Palette organization tweaks:
  - `System Date/Time` is now in **Events** (near `On Schedule`).
  - `Provider Catalog` + `Models Catalog` (was Provider Models) are now in **Literals** (above `Tools Allowlist`).
- Models Catalog UX: removed the deprecated `allowed_models` input pin; model allowlisting is now edited via an in-node multi-select synced with the right panel.
- Node/pin tooltips now appear after **2s** hover and are rendered in an overlay layer so they are not clipped by scroll containers.
- `Python Code` nodes now include an in-node **Edit Code** button (same editor as the right panel).
- `Python Code` editor now injects an “Available variables” comment block in the code body (one line per variable with type) to make pin-derived variables discoverable while editing.
- Node palette: exposed additional built-in transforms (`trim`, `substring`, `format`) and math ops (`modulo`, `power`). Added a dedicated **Math** category (after Variables) and renamed the former “Data” transforms category label to **Transforms**.

### Added
- Run history for the current workflow:
  - New web API endpoints to list persisted runs and replay a run’s event stream from the durable ledger (`/api/runs`, `/api/runs/{run_id}/history`).
  - UI “Run History” picker (🕘) to open past runs in the Run modal and apply pause/resume/cancel controls to that run.
- New web API endpoint to fetch persisted artifacts for a run (`/api/runs/{run_id}/artifacts/{artifact_id}`) so the UI can render full Recall-into-context payloads without relying on truncated previews.
- New execution node `Set Variables` (`set_vars`) to update multiple workflow variables in a single step (reduces timeline clutter vs chaining many `set_var` nodes).
- New execution node `Set Variable Property` (`set_var_property`) to update a nested property on an object variable in workflow state (durable, pass-through semantics).
- Run preflight validation panel: when attempting to run with missing required node config (e.g. `LLM Call` / `Agent` provider/model), the UI shows an itemized “Fix before running” panel and clicking an item focuses + highlights the offending node.
- `multi_agent_state_machine` now accepts a `workspace_root` run parameter; when set, agent file/system tools are scoped to that folder (paths resolve under the workspace root and escapes are rejected).
- Visual custom events (Blueprint-style):
  - `On Event` listeners are compiled into dedicated durable subworkflows and auto-started alongside the main run (session-scoped by default).
  - `Emit Event` node dispatches durable events via AbstractRuntime.
- `Parse JSON` (`parse_json`) pure data node to convert JSON (or JSON-ish) strings into objects compatible with `Break Object`.
- Blueprint-style workflow variables:
  - `Get Variable` (`get_var`) reads a value from durable `run.vars` by dotted path.
  - `Set Variable` (`set_var`) updates `run.vars` (pass-through, execution pins) to support scratchpads/stateful workflows.
- Visual runs now apply safe defaults for local LLM execution in the web host:
  - A default **LLM HTTP timeout** for workflow execution (default 7200s, per `LLM_CALL`/Agent step) enforced by the **AbstractRuntime orchestrator** and overrideable via `ABSTRACTFLOW_LLM_TIMEOUT_S` / `ABSTRACTFLOW_LLM_TIMEOUT`.
  - A default **max output token cap** (4096; configurable via `ABSTRACTFLOW_LLM_MAX_OUTPUT_TOKENS` / `ABSTRACTFLOW_MAX_OUTPUT_TOKENS`) to keep agent generations bounded and avoid late-loop slowdowns/timeouts.
- WebSocket execution events now include a JSON-safe ISO timestamp (`ts`) for clearer observability in the UI and logs.
- Visual `LLM Call` nodes now support optional **tool calling** via a `tools` allowlist input (pin or node config) and expose a structured `result` output object (normalized LLM response including `tool_calls`, `usage`, and `trace_id`). Tool execution remains runtime-owned and must be modeled explicitly in the workflow (no agent loop/scratchpad).
- Visual `LLM Call` now also exposes an **inline tools dropdown** in the node UI (when the `tools` pin is not connected), matching the Agent node UX for quickly selecting an allowlist.
- Visual `LLM Call` and `Agent` nodes now accept an optional **Structured Output** input pin (`response_schema`) containing a JSON Schema object. The schema is passed durably to AbstractRuntime `LLM_CALL` (`payload.response_schema`) so AbstractCore providers can enforce schema-conformant assistant `content`.
- New literal node **JSON Schema** (`json_schema`) to author schema objects and wire them into `LLM Call.structured_output` / `Agent.structured_output`.
- Visual `Tool Calls` node (`tool_calls`) to execute one or many tool call requests via AbstractRuntime `EffectType.TOOL_CALLS`, outputting `results[]` (per-call output/error) and an aggregate `success` boolean.
- New pure node `Tools Allowlist` (`tools_allowlist`) that outputs a workflow-scope `tools: string[]` list (configured via inline multi-select), so one allowlist can be fed into `LLM Call.tools`, `Agent.tools`, and `Tool Calls.allowed_tools`.
  - Added a dedicated `tools` pin type (specialized `string[]`) so `On Flow Start` parameters can be typed as `tools` and selected via the Run modal (same multi-select UX as `Tools Allowlist`).
- New pure node `Bool Variable` (`bool_var`) to declare a workflow-scope boolean variable (name + default) with typed outputs (`value:boolean`, `name:string`) so flows can branch and mutate it cleanly via `Set Variable`.
- New control node `For` (`for`) for numeric loops with inputs (`start`, `end`, `step`) and outputs (`i`, `index`) plus `loop`/`done` execution pins.
- `While` (`while`) now exposes an `index` output pin (0-based iteration count) like `ForEach`.
- `While` (`while`) now also exposes an `item:any` output pin (pass-through) for parity with `ForEach` (`loop`).
- New pure node `Variable` (`var_decl`) to declare a workflow-scope persistent variable with an explicit type (dropdown) and default; its `value` output pin updates to the selected type, and `Get/Set Variable` nodes now auto-adopt that type when the selected name matches a declaration.
- Added pure utility nodes to reduce Python glue in workflows:
  - `coalesce` (first non-null selection by pin order)
  - `string_template` (render `{{path.to.value}}` with basic filters like `json`, `join`, `trim`)
  - `array_length`, `array_append`, `array_dedup`
- `get` (Get Property) now supports a `default` input and safer nested path handling (including bracket indices like `a[0].b`).
- Node tooltips in the visual editor (hover > 1s) are now available in both the left palette and on-canvas nodes, powered by a per-node `description` field in templates.
- Moved `Tool Calls` (`tool_calls`) from the `Effects` palette category to `Core`, and reordered core nodes to: Subflow, Agent, LLM Call, Tool Calls, Ask User, Answer User.
- Improved `Compare` (`compare`) node with an `op` input pin (dropdown in the UI) supporting `==`, `>=`, `>`, `<=`, `<` (defaults to `==` for backward compatibility).
- Memory nodes now expose richer recall metadata filters:
  - `Memorize` (`memory_note`) adds an optional `location` input.
  - `Memorize` (`memory_note`) now supports a **Keep in context** toggle to immediately rehydrate the stored note into `context.messages` so downstream `LLM Call` / `Agent` nodes with **Use context** enabled can see it.
  - `Recall` (`memory_query`) adds `tags_mode` (all/any), `usernames`, and `locations` inputs for refined retrieval.
- `Subflow` now supports an **Inherit context** toggle to seed the child run’s `context.messages` from the parent run’s active context view (useful when LLM/Agent nodes inside a subflow should see the parent’s context without extra Recall/Rehydrate glue).
- Fixed scheduler-node outputs in WebSocket `node_complete`: Loop/While/For now sync their persisted `{index,...}` outputs into `flow._node_outputs` after scheduling, so the UI no longer shows a stale index (often stuck at 0).
- Fixed `Set Variable` defaulting for typed primitive pins: when the `value` pin is `boolean/number/string` and left unset, it now defaults to `false/0/""` instead of writing `None` (which could make typed `Variable` (`var_decl`) reads fall back to their defaults unexpectedly).

### Planned
- Visual workflow editor with drag-and-drop interface
- Real-time workflow execution and monitoring
- Integration with AbstractCore for multi-provider LLM support
- Custom node development SDK
- Cloud deployment capabilities
- Collaborative workflow development features

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


