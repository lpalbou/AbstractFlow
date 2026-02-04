# API reference (high-level)

This page documents the public Python API surface of the `abstractflow` package.

See also: `README.md`, `docs/getting-started.md`, `docs/architecture.md`, `docs/faq.md`.

## Version

- `abstractflow.__version__` (string)

Evidence: `abstractflow/__init__.py`.

## Programmatic flows

### Flow IR

`Flow`, `FlowNode`, and `FlowEdge` are re-exported from AbstractRuntime so there is a single source of truth for semantics.

```python
from abstractflow import Flow, FlowNode, FlowEdge
```

Evidence: `abstractflow/core/flow.py`, `abstractflow/__init__.py`.

### FlowRunner

`FlowRunner` compiles a `Flow` to a runtime `WorkflowSpec` and executes it using an AbstractRuntime `Runtime`.

```python
from abstractflow import FlowRunner
```

Key behaviors:
- Creates a default in-memory runtime when you don’t provide one.
- Normalizes completion output into `{"success": bool, "result": ...}`.
- Returns `{"waiting": True, ...}` if the flow blocks on durable input.

Evidence: `abstractflow/runner.py`.

### Compilation

Compilation functions are delegated to AbstractRuntime’s VisualFlow compiler and re-exported:

```python
from abstractflow import compile_flow
```

Evidence: `abstractflow/compiler.py`, `abstractflow/__init__.py`.

## Visual flows (VisualFlow JSON)

### Models

Pydantic models for the portable JSON format:

```python
from abstractflow.visual import VisualFlow, VisualNode, VisualEdge, NodeType, PinType
```

Evidence: `abstractflow/visual/models.py`, `abstractflow/visual/__init__.py`.

### Execute a VisualFlow

Use `execute_visual_flow(...)` for a simple “run and return a result” call:

```python
from abstractflow.visual import execute_visual_flow
```

For advanced use cases (custom stores/tool execution, or access to run state/ledger), build a runner:

```python
from abstractflow.visual import create_visual_runner
```

Evidence: `abstractflow/visual/executor.py`, `docs/getting-started.md`.

### Interfaces/contracts (optional)

If a host expects a specific IO contract, VisualFlows can declare interface markers in `VisualFlow.interfaces`.

```python
from abstractflow.visual.interfaces import (
    ABSTRACTCODE_AGENT_V1,
    validate_visual_flow_interface,
    apply_visual_flow_interface_scaffold,
)
```

Evidence: `abstractflow/visual/interfaces.py`.

## Workflow bundles (`.flow`)

WorkflowBundle helpers are available as a thin wrapper around AbstractRuntime’s bundle implementation:

```python
from abstractflow.workflow_bundle import (
    pack_workflow_bundle,
    inspect_workflow_bundle,
    unpack_workflow_bundle,
)
```

Evidence: `abstractflow/workflow_bundle.py`, `docs/cli.md`.

## CLI

The `abstractflow` CLI entry point is declared in `pyproject.toml` (`project.scripts`) and implemented in:
- `abstractflow/cli.py`

Evidence: `pyproject.toml`, `abstractflow/cli.py`.
