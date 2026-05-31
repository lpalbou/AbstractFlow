# API reference (high-level)

This page documents the public Python API surface of the `abstractflow` package.

See also: [../README.md](../README.md), [getting-started.md](getting-started.md), [architecture.md](architecture.md), [faq.md](faq.md).

## Version

- `abstractflow.__version__` (string)
- `abstractflow.get_version()` (helper)

Evidence: [../abstractflow/_version.py](../abstractflow/_version.py), [../abstractflow/__init__.py](../abstractflow/__init__.py), [../pyproject.toml](../pyproject.toml).

## Programmatic flows

### Flow IR

`Flow`, `FlowNode`, and `FlowEdge` are re-exported from AbstractRuntime so there is a single source of truth for semantics.
These APIs are available with `abstractflow[apple]` or `abstractflow[gpu]`.

```python
from abstractflow import Flow, FlowNode, FlowEdge
```

Evidence: [../abstractflow/core/flow.py](../abstractflow/core/flow.py), [../abstractflow/__init__.py](../abstractflow/__init__.py).

### FlowRunner

`FlowRunner` compiles a `Flow` to a runtime `WorkflowSpec` and executes it using an AbstractRuntime `Runtime`.
Available with `abstractflow[apple]` or `abstractflow[gpu]`.

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
Requires `abstractflow[apple]` or `abstractflow[gpu]`.

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

Requires `abstractflow[apple]`.

```python
from abstractflow.visual import execute_visual_flow
```

For advanced use cases (custom stores/tool execution, or access to run state/ledger), build a runner:

Requires `abstractflow[apple]`.

```python
from abstractflow.visual import create_visual_runner
```

Utilities:

Requires `abstractflow[apple]` for runtime flow-spec conversion.

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
Requires `abstractflow[apple]`.

```python
from abstractflow.workflow_bundle import (
    pack_workflow_bundle,
    inspect_workflow_bundle,
    unpack_workflow_bundle,
)
```

Evidence: [../abstractflow/workflow_bundle.py](../abstractflow/workflow_bundle.py), [cli.md](cli.md).

## Gateway editor contract

The React editor is a thin client for AbstractGateway's versioned discovery contract:

```text
GET /api/gateway/discovery/capabilities
```

It reads `capabilities.contracts.flow_editor` plus `capabilities.contracts.common` for VisualFlow CRUD/publish, run input schema, run start, ledger stream, artifact, and prompt-cache endpoints. Artifact descriptors include run artifact listing/content, session-visible artifact listing, cross-run/session/run artifact search, workspace-path import, and artifact-to-workspace export when the Gateway supports them. Session prompt cache and durable bloc exact-reuse bindings are separate contract tracks (`common.prompt_cache.session_lifecycle` and `common.prompt_cache.durable_blocs`). Gateway catalog routes may return the canonical `gateway_catalog_v1` envelope (`catalog` metadata plus `items`) or older legacy arrays/maps; the editor normalizes both.

Artifact start inputs use JSON refs, not paths:

```json
{
  "$artifact": "abc123",
  "artifact_id": "abc123",
  "run_id": "session_memory_my-session",
  "content_type": "image/png",
  "filename": "input.png",
  "sha256": "..."
}
```

The editor obtains those refs by uploading a browser file, importing a Gateway
workspace path through `common.artifacts.import`, or selecting from
`common.artifacts.search` / `common.artifacts.session_list`. Search supports
all-artifact or session-scoped lookup, modality filtering from the pin type, and
simple metadata filters such as `pin_id=image,purpose=run_input`.

When Gateway advertises `common.readiness.contract = gateway_surface_readiness_v1`, the editor uses that surface summary as a conservative overlay for optional media/model-residency UX. Endpoint descriptors remain the authority for actual request paths.

Generated media is discovered through the Gateway contracts:
- `assistant.media.generated_image`
- `assistant.media.edited_image`
- `assistant.media.generated_video`
- `assistant.media.image_to_video`
- `assistant.media.generated_voice`
- `assistant.media.generated_music`

Gateway progress callbacks emitted as `abstract.progress` ledger events are mapped
to running-step progress in the editor instead of being treated as terminal node
outputs. This is especially important for long video generations.

Model residency is discovered through `common.model_residency` and includes
`text_to_video` and `image_to_video` when the Gateway/runtime stack supports
video warmup/list/unload semantics.

The browser calls same-origin `/api/gateway/*`; the Flow static server, Vite
dev proxy, and Python host proxy those requests to Gateway and inject the
Gateway user token from the browser's HTTP-only sign-in cookie. Requests without
that browser session receive `401`.

Evidence: [../web/frontend/src/hooks/useGatewayCapabilities.ts](../web/frontend/src/hooks/useGatewayCapabilities.ts), [../web/frontend/src/utils/gatewayClient.ts](../web/frontend/src/utils/gatewayClient.ts), [../web/backend/main.py](../web/backend/main.py).

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
- Visual editor backend runner (optional): `abstractflow serve ...` (requires `abstractflow[apple]` or `abstractflow[gpu]`)

Evidence: [../pyproject.toml](../pyproject.toml), [../abstractflow/cli.py](../abstractflow/cli.py), [../web/backend/cli.py](../web/backend/cli.py).
