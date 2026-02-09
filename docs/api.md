# API reference (high-level)

This page documents the public Python API surface of the `abstractflow` package.

See also: [../README.md](../README.md), [getting-started.md](getting-started.md), [architecture.md](architecture.md), [faq.md](faq.md).

## Version

- `abstractflow.__version__` (string)
- `abstractflow.get_version()` (helper)

Evidence: [../abstractflow/__init__.py](../abstractflow/__init__.py), [../pyproject.toml](../pyproject.toml).

## Programmatic flows

### Flow IR

`Flow`, `FlowNode`, and `FlowEdge` are re-exported from AbstractRuntime so there is a single source of truth for semantics.

```python
from abstractflow import Flow, FlowNode, FlowEdge
```

Evidence: [../abstractflow/core/flow.py](../abstractflow/core/flow.py), [../abstractflow/__init__.py](../abstractflow/__init__.py).

### FlowRunner

`FlowRunner` compiles a `Flow` to a runtime `WorkflowSpec` and executes it using an AbstractRuntime `Runtime`.

```python
from abstractflow import FlowRunner
```

Key behaviors:
- Creates a default in-memory runtime when you don’t provide one.
- Normalizes completion output into `{"success": bool, "result": ...}`.
- Returns `{"waiting": True, ...}` if the flow blocks on durable input.
- Provides `start(...)`, `step(...)`, and `resume(...)` for host-driven execution loops.

Evidence: [../abstractflow/runner.py](../abstractflow/runner.py).

### Compilation

Compilation functions are delegated to AbstractRuntime’s VisualFlow compiler and re-exported:

```python
from abstractflow import compile_flow
```

Advanced compilation helpers are also re-exported (typically used by hosts/tools, not most end users):

```python
from abstractflow.compiler import compile_visualflow, compile_visualflow_tree
```

Evidence: [../abstractflow/compiler.py](../abstractflow/compiler.py), [../abstractflow/__init__.py](../abstractflow/__init__.py).

## Visual flows (VisualFlow JSON)

### Models

Pydantic models for the portable JSON format:

```python
from abstractflow.visual import VisualFlow, VisualNode, VisualEdge, NodeType, PinType
```

Evidence: [../abstractflow/visual/models.py](../abstractflow/visual/models.py), [../abstractflow/visual/__init__.py](../abstractflow/visual/__init__.py).

### Execute a VisualFlow

Use `execute_visual_flow(...)` for a simple “run and return a result” call:

```python
from abstractflow.visual import execute_visual_flow
```

For advanced use cases (custom stores/tool execution, or access to run state/ledger), build a runner:

```python
from abstractflow.visual import create_visual_runner
```

Utilities:

```python
from abstractflow.visual import visual_to_flow
```

Evidence: [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py), [getting-started.md](getting-started.md).

### Interfaces/contracts (optional)

If a host expects a specific IO contract, VisualFlows can declare interface markers in `VisualFlow.interfaces`.

```python
from abstractflow.visual.interfaces import (
    ABSTRACTCODE_AGENT_V1,
    validate_visual_flow_interface,
    apply_visual_flow_interface_scaffold,
)
```

Evidence: [../abstractflow/visual/interfaces.py](../abstractflow/visual/interfaces.py).

## Workflow bundles (`.flow`)

WorkflowBundle helpers are available as a thin wrapper around AbstractRuntime’s bundle implementation:

```python
from abstractflow.workflow_bundle import (
    pack_workflow_bundle,
    inspect_workflow_bundle,
    unpack_workflow_bundle,
)
```

Evidence: [../abstractflow/workflow_bundle.py](../abstractflow/workflow_bundle.py), [cli.md](cli.md).

## Adapters (advanced)

If you build custom hosts or want direct control over node handler construction, adapters are re-exported:

```python
from abstractflow.adapters import (
    create_function_node_handler,
    create_agent_node_handler,
    create_subflow_node_handler,
)
```

Evidence: [../abstractflow/adapters/](../abstractflow/adapters/).

## CLI

The `abstractflow` CLI entry point is declared in `pyproject.toml` (`project.scripts`) and implemented in:
- [../abstractflow/cli.py](../abstractflow/cli.py)

The CLI includes:
- WorkflowBundle tools: `abstractflow bundle ...`
- Visual editor backend runner (optional): `abstractflow serve ...` (requires `abstractflow[server]`)

Evidence: [../pyproject.toml](../pyproject.toml), [../abstractflow/cli.py](../abstractflow/cli.py), [../web/backend/cli.py](../web/backend/cli.py).
