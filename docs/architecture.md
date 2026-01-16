# AbstractFlow — Architecture (Current)

> Updated: 2026-01-07  
> Scope: this describes **what is implemented today** in this monorepo (no “future” design claims).

AbstractFlow is the **workflow authoring + orchestration** layer of the AbstractFramework:
- **Authoring**: a visual editor produces a portable `VisualFlow` JSON document.
- **Execution**: hosts compile/execute that JSON using `abstractflow.visual` and **AbstractRuntime**.
- **Orchestration**: nodes can run LLM calls, tools, agents, subflows, and durable waits (user/events/schedule).

This document focuses on AbstractFlow’s architecture and how it leverages:
- `abstractruntime` for durability + effects + run control
- `abstractcore` for provider/model/tool abstractions (via runtime integrations)
- `abstractagent` for agent workflows (ReAct/CodeAct) used by the visual Agent node

## High-level component/data flow

```
             (authoring)                                  (execution)
┌─────────────────────────────┐                 ┌─────────────────────────────┐
│ AbstractFlow Web Frontend    │                 │ Host (AbstractFlow backend, │
│ (React visual editor)        │                 │ AbstractCode, 3rd-party)    │
│ - edits VisualFlow JSON      │                 │ - loads VisualFlow JSON     │
└──────────────┬──────────────┘                 │ - compiles to WorkflowSpec  │
               │ save/load                        │ - ticks Runtime            │
               ▼                                  └──────────────┬────────────┘
┌─────────────────────────────┐                               uses│
│ AbstractFlow Web Backend     │                                   ▼
│ (FastAPI)                    │                 ┌─────────────────────────────┐
│ - persists VisualFlow JSON   │                 │ AbstractRuntime               │
│ - runs flows (WS)            │                 │ - RunStore/Ledger/Artifacts   │
│ - run history APIs           │                 │ - effects + waits + resume    │
└─────────────────────────────┘                 └─────────────────────────────┘
```

## Repository Layout

```
abstractflow/
  abstractflow/                 # Python library (portable)
    core/                       # Flow graph model
    visual/                     # VisualFlow schema + portable executor
    adapters/                   # Compiler adapters (control/effects/agents/events/subflows)
    compiler.py                 # Flow -> WorkflowSpec (AbstractRuntime)
    runner.py                   # FlowRunner (runtime-backed)
  web/
    backend/                    # FastAPI host app (flow CRUD + websocket execution)
    frontend/                   # React visual editor + Run Flow UI
    flows/                      # Saved VisualFlow JSON (web host default)
    runtime/                    # RunStore/LedgerStore/ArtifactStore base dir (web host default)
```

## Core Data Model (Portable)

### VisualFlow JSON
The visual editor saves workflows as `VisualFlow` JSON (Pydantic models in `abstractflow/abstractflow/visual/models.py`):
- `VisualFlow`: `id`, `name`, `description`, `nodes`, `edges`, optional `entryNode`.
- `VisualNode`: `id`, `type` (`NodeType`), `position`, `data` (pins + node config).
- `VisualEdge`: `source`, `sourceHandle`, `target`, `targetHandle`.

Recent additions (portable node types):
- `memory_rehydrate`: runtime-owned mutation that rehydrates archived `conversation_span` messages into `context.messages`.

**Important constraint:** the workflow must remain **portable** across hosts:
- the JSON includes node configuration (`data`) needed to execute outside the web backend
- execution semantics are expressed via AbstractRuntime effects + pure functions

### Programmatic Flow
AbstractFlow also exposes a programmatic graph model (`abstractflow/abstractflow/core/flow.py`):
- `Flow`, `FlowNode`, `FlowEdge`

Programmatic flows compile to AbstractRuntime the same way as visual flows (via `abstractflow/abstractflow/compiler.py`).

## Compilation + Execution Pipeline

### VisualFlow → Flow
`abstractflow.visual.executor.visual_to_flow()` builds a `Flow` from a `VisualFlow`:
- builds a **data-edge map** (`source node/pin → target node/pin`)
- pre-evaluates “pure” nodes (e.g., literals) into `flow._node_outputs`
- wraps node handlers so execution pins drive control flow and data pins resolve inputs

### Flow → WorkflowSpec (AbstractRuntime)
`abstractflow.compiler.compile_flow()` converts a `Flow` to `abstractruntime.WorkflowSpec`:
- function nodes → `create_function_node_handler(...)` (sync compute)
- effect nodes (ask_user/llm_call/wait_event/…) → `Effect` requests (durable waits/side effects)
  - memory effect nodes (`memory_note`, `memory_query`, `memory_rehydrate`) → runtime memory effects (require `ArtifactStore`)
- control nodes (sequence/parallel/while/loop) → scheduler handlers in `abstractflow.adapters.control_adapter`
- agent nodes (programmatic agents) → `abstractflow.adapters.agent_adapter`
- visual agent nodes (`type: "agent"`) → a **START_SUBWORKFLOW** wrapper that delegates to `abstractagent` ReAct workflows (implemented in `abstractflow.compiler._create_visual_agent_effect_handler`)

### Runtime Execution
Execution is owned by AbstractRuntime:
- `FlowRunner` (`abstractflow/abstractflow/runner.py`) runs a `WorkflowSpec` via `Runtime.start(...)` + `Runtime.tick(...)`.
- For visual flows, `abstractflow.visual.executor.create_visual_runner(...)` wires the runtime with needed integrations and returns a runner.

## AbstractRuntime Integration (Durability + Effects)

### Store Backends (Web Host)
The AbstractFlow web backend chooses file-based runtime stores (`abstractflow/web/backend/services/runtime_stores.py`):
- `JsonFileRunStore` → `run_<run_id>.json` checkpoints
- `JsonlLedgerStore` → `ledger_<run_id>.jsonl` append-only step journal
- `FileArtifactStore` → large payloads referenced from run vars

The base directory is `ABSTRACTFLOW_RUNTIME_DIR` (default `./runtime`). When the backend runs from `abstractflow/web`, this becomes `abstractflow/web/runtime/`.

### LLM + Tool Effects (via AbstractCore Integration)
When a visual flow contains LLM nodes (`llm_call` / `agent`), `abstractflow.visual.executor.create_visual_runner(...)` constructs a runtime via:
- `abstractruntime.integrations.abstractcore.factory.create_local_runtime(...)`

This wires:
- `EffectType.LLM_CALL` via an AbstractCore-backed LLM client
- `EffectType.TOOL_CALLS` via a host-configured `ToolExecutor` (typically `MappingToolExecutor.from_tools(...)`)

Visual node outputs are designed to be easy to wire:
- **LLM Call** exposes `response`, `success`, `meta`, and a convenience `tool_calls` output (so you can connect directly into **Tool Calls** or event nodes).
  - In structured-output mode, `response` is a JSON string of the structured object (matching the schema).
  - Older saved flows may still have legacy pins (e.g. `result`); new nodes do not generate them.
- **Agent** exposes `response`, `success`, `meta`, and `scratchpad`.
  - In structured-output mode, `response` is a JSON string of the structured object (matching the schema).
  - `scratchpad` is runtime-owned observability data and includes:
    - `messages`: the agent’s internal message transcript/history for this run
    - `node_traces`: the structured per-node trace produced by the ReAct subworkflow
    - `steps`: a flattened list derived from `node_traces` (easier for UI rendering)
    - best-effort `tool_calls` / `tool_results` extracted post-run from `steps`

When a visual flow contains memory nodes, the host must also configure:
- an `ArtifactStore` (for archived spans, notes, and rehydration source artifacts)

## Events and Schedules (Durable)

AbstractFlow expresses event-driven behavior using AbstractRuntime’s durable waits:
- `On Event` nodes compile to `WAIT_EVENT` waits (listener runs)
- `Emit Event` nodes compile to `EMIT_EVENT` (delivers to matching waiters)
- `On Schedule` nodes compile to `WAIT_UNTIL` (time-based waits)

For visual flows, `VisualSessionRunner` (`abstractflow/abstractflow/visual/session_runner.py`) starts `On Event` listeners as child runs in the same session and actively ticks them when events are emitted.

Note:
- `Wait Event` nodes support optional UX metadata pins (`prompt`, `choices`, `allow_free_text`) so hosts can render durable “ask + wait” interactions (ADR-0017).

## Web Backend Execution (Run Flow UI)

The real-time Run Flow UI is powered by WebSockets (`abstractflow/web/backend/routes/ws.py`):
- client sends `{type:"run"}` to start
- backend creates a runner with durable stores (`create_visual_runner(...)`)
- backend drives execution by calling `runner.step()` (which calls `Runtime.tick(...)`) and streams `ExecutionEvent` updates
- if the runtime enters a wait state (ASK_USER / WAIT_EVENT / WAIT_UNTIL / SUBWORKFLOW), the UI shows the waiting step and can send `{type:"resume"}` to continue
- run controls (pause/resume/cancel) are exposed as `{type:"control"}` messages and map to AbstractRuntime run control APIs

### Run history (web host)
The web backend also exposes run-history endpoints (list runs + replay) to support browsing historical runs in the UI:
- see `abstractflow/web/backend/routes/runs.py`

## What AbstractFlow Owns vs Uses

**AbstractFlow owns**
- Visual authoring schema (`VisualFlow`)
- Compilation from graphs to AbstractRuntime `WorkflowSpec`
- Orchestration primitives (control nodes, subflows, event listener wiring)
- Web host UX (editor + execution UI)

**AbstractFlow uses**
- **AbstractRuntime**: durable run state, waits, ledger, artifacts, run control
- **AbstractCore**: providers/models/tools (via runtime’s `integrations.abstractcore`)
- **AbstractAgent**: agent workflows used by the visual Agent node (ReAct today; CodeAct exists in AbstractAgent)

## Acknowledgements (inspiration)
- The visual editor UX is inspired by **Unreal Engine (UE4/UE5) Blueprints**: execution pins, typed pins with color coding, and “graph-as-program” ergonomics.
