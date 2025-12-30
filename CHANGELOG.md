# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Notes
- In this monorepo, `abstractflow` contains a working Flow compiler/runner and VisualFlow execution utilities. Packaging/docs alignment is tracked in `docs/backlog/planned/093-framework-packaging-alignment-flow-runtime.md`.

### Fixed
- VisualFlow execution now ignores unreachable/disconnected execution nodes (e.g. orphan `llm_call` / `subflow` nodes) so they cannot fail run initialization.
- `Split` now avoids spurious empty trailing items (common with delimiter-terminated strings like `"A@@B@@"`) so downstream `Loop` nodes don't execute an extra empty iteration.
- `Loop` (Foreach) now invalidates cached pure-node outputs (e.g. `concat`) per-iteration so loop bodies don't reuse stale values from iteration 0 (fixes scratchpad accumulation workflows).
- WebSocket run controls are now responsive during long-running steps: pause/resume/cancel no longer block on the per-connection execution lock (important when LLM/Agent nodes stall).
- Web run controls are now resilient to transient WebSocket disconnects: pause/resume/cancel can be sent with an explicit `run_id`, and the UI will reconnect-and-send for control actions when needed.
- `Cancel Run` no longer surfaces as a `flow_error` from an internal `asyncio.CancelledError` (treated as an expected control-plane operation).
- Visual `Agent` nodes now reset per-node state when re-entered (e.g. inside `Loop` iterations), so each iteration re-resolves inputs and runs the agent with the current scratchpad/task instead of reusing iteration 0.
- Run modal observability for Agent nodes is improved:
  - WebSocket `node_start` / `node_complete` events now include `runId`, allowing the UI to distinguish root visual runs from child/sub-runs.
  - The Agent details panel now renders a live sub-run trace of internal LLM/tool steps (expandable with prompts/responses/errors).
  - Runtime node trace entries are now streamed incrementally over WebSocket (`trace_update`) so Agent traces update during execution instead of only after the Agent node completes.
  - Visual Agent nodes now start their ReAct subworkflow in **async+wait** mode so the WebSocket runner can tick the child run incrementally (required for real-time `trace_update` streaming).

### Added
- Visual custom events (Blueprint-style):
  - `On Event` listeners are compiled into dedicated durable subworkflows and auto-started alongside the main run (session-scoped by default).
  - `Emit Event` node dispatches durable events via AbstractRuntime.
- `Parse JSON` (`parse_json`) pure data node to convert JSON (or JSON-ish) strings into objects compatible with `Break Object`.
- Blueprint-style workflow variables:
  - `Get Variable` (`get_var`) reads a value from durable `run.vars` by dotted path.
  - `Set Variable` (`set_var`) updates `run.vars` (pass-through, execution pins) to support scratchpads/stateful workflows.
- Visual runs now apply a safe default **local LLM HTTP timeout** (configurable via `ABSTRACTFLOW_LLM_TIMEOUT_S` / `ABSTRACTFLOW_LLM_TIMEOUT`) to prevent infinite hangs when a local provider stalls.

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


