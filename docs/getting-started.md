# Getting started

This guide covers the two primary ways to use AbstractFlow:
- **Programmatic flows** (`Flow` + `FlowRunner`)
- **Visual flows** (portable `VisualFlow` JSON authored by the editor in `web/`)

See also: [README](../README.md), [docs index](README.md), [api.md](api.md), [faq.md](faq.md), [visualflow.md](visualflow.md), [web-editor.md](web-editor.md), [cli.md](cli.md), [architecture.md](architecture.md).

## Requirements

- Python **3.10+** (`pyproject.toml`: `requires-python`)

## Install

```bash
# From PyPI
pip install abstractflow
```

Optional extras:
- Host profile for the Python proxy stack + matching Gateway deployment profile + compatibility routes (`Flow`, `FlowRunner`, `abstractflow.visual` local execution, workflow bundles, Agent nodes): `pip install "abstractflow[apple]"` or `pip install "abstractflow[gpu]"`
- Agent nodes only, without the host profile: `pip install "abstractflow[agent]"`
- Documentation site tools: `pip install "abstractflow[docs]"`

From source (repo root):

```bash
pip install -e .
```

Evidence: dependencies and extras are declared in [../pyproject.toml](../pyproject.toml).

For thin-client gateway-first mode, `abstractflow` (without extras) is sufficient. Install `abstractgateway` separately for the backend.
Enable local runtime compatibility only when needed with `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1`.

If you install a host profile (`apple`, `gpu`), the local execution stack is already included for compatibility.

Programmatic and local VisualFlow execution examples below require a host profile:

```bash
pip install "abstractflow[apple]"  # or abstractflow[gpu]
```

## Programmatic flow (FlowRunner)

```python
from abstractflow import Flow, FlowRunner

flow = Flow("linear")
flow.add_node("double", lambda x: x * 2, input_key="value", output_key="doubled")
flow.add_node("add_ten", lambda x: x + 10, input_key="doubled", output_key="final")
flow.add_edge("double", "add_ten")
flow.set_entry("double")

print(FlowRunner(flow).run({"value": 5}))
# {"success": True, "result": 20}
```

Evidence:
- `Flow` / `FlowNode` / `FlowEdge` are re-exported from AbstractRuntime: [../abstractflow/core/flow.py](../abstractflow/core/flow.py)
- `FlowRunner` output normalization and “waiting” shape: [../abstractflow/runner.py](../abstractflow/runner.py)
- Baseline behavior: [../tests/test_runner.py](../tests/test_runner.py)

## Execute a VisualFlow JSON

Visual flows are JSON documents matching the Pydantic models in `abstractflow/visual/models.py`.

Minimal example (single flow, no subflows):

```python
import json
from abstractflow.visual import VisualFlow, execute_visual_flow

with open("my-flow.json", "r", encoding="utf-8") as f:
    vf = VisualFlow.model_validate(json.load(f))
print(execute_visual_flow(vf, {"prompt": "Hello"}, flows={vf.id: vf}))
```

If your flow uses subflows:
- load **all referenced** `*.json` flows into the `flows={flow_id: VisualFlow}` mapping, or
- package them as a WorkflowBundle (`.flow`) and load via AbstractRuntime (see [cli.md](cli.md)).

Convenient loader:

```python
from pathlib import Path
import json
from abstractflow.visual import VisualFlow

def load_flows(dir_path: str) -> dict[str, VisualFlow]:
    flows: dict[str, VisualFlow] = {}
    for p in Path(dir_path).glob("*.json"):
        vf = VisualFlow.model_validate(json.loads(p.read_text(encoding="utf-8")))
        flows[vf.id] = vf
    return flows
```

Evidence:
- VisualFlow execution wiring: [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py)
- Subflow reachability / registry behavior: [../tests/test_visual_subflow_registry_reachability.py](../tests/test_visual_subflow_registry_reachability.py), [../tests/test_visual_subflow_recursion.py](../tests/test_visual_subflow_recursion.py)

## Run the visual editor (local)

The modern editor talks to AbstractGateway. Follow: [web-editor.md](web-editor.md).

Quick start (no repo clone needed):

```bash
pip install abstractgateway abstractflow
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway serve --port 8080

export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Tip (from source): install Flow and Gateway editably, then run `npm run dev` from `web/frontend` with `ABSTRACTGATEWAY_AUTH_TOKEN` set so Vite can inject Gateway auth in its proxy.

## Create media with Gateway nodes

In the editor, add media nodes from the palette:
- `Generate Image`: prompt to image artifact.
- `Edit Image`: prompt plus source image artifact, optional mask, to image artifact. `Image-to-Image` is accepted as a legacy alias when loading older flows.
- `Generate Video`: prompt to video artifact.
- `Image-to-Video`: prompt plus source image artifact to video artifact.
- `Generate Voice`: text to voice/audio artifact.
- `Generate Music`: prompt/lyrics/duration to music artifact.
- `Transcribe Audio` / `Listen Voice`: audio input to text.

For the simple path, leave provider/model as `Auto` and let Gateway resolve the
configured backend. If you need reproducibility, choose explicit provider/model
values from the Gateway catalog selectors. Video model selectors are populated
from Gateway vision provider-model catalogs scoped to `text_to_video` or
`image_to_video`; music catalog data comes from
`/api/gateway/audio/music/providers` and `/api/gateway/audio/music/models`.

Generated media is returned as Gateway artifacts. The Run modal renders images,
videos, and audio/music players first; raw ledger JSON and artifact IDs remain
available for debugging. Long video runs surface Gateway `abstract.progress`
ledger events as progress on the active step.

For image editing, wire `image_artifact` from a previous `Generate Image` node
or use the `Artifacts` palette primitives (`Image Artifact`, `Voice Artifact`,
`Music Artifact`, etc.) to paste an existing Gateway `$artifact` id. A richer
browser artifact picker/upload flow is tracked separately.

Example Generate Video path:
1. Drag `On Flow Start`, `Generate Video`, and `On Flow End` onto the canvas.
2. Wire execution `On Flow Start -> Generate Video -> On Flow End`.
3. Wire or type a `prompt` such as `glowing data streams converging into a geometric logo`.
4. Leave provider/model as `Auto (Gateway default)` unless you need a specific backend.
5. Save, then click `Run Flow`.
6. Watch progress in the Run modal and open the generated video artifact when the step completes.

## Workflow bundles (`.flow`)

To package a VisualFlow + subflows into a single file, use the CLI:
- [cli.md](cli.md)

## Waiting runs (durable asks/events/schedules)

Some flows intentionally block waiting for external input (e.g. `ask_user`, `wait_event`, `wait_until`).

- `FlowRunner.run()` returns `{"waiting": True, "state": <RunState>, ...}` when blocked (`abstractflow/runner.py`).
- `execute_visual_flow()` returns a friendly shape including `waiting`, `wait_key`, and optional UX fields (`prompt`, `choices`, `allow_free_text`) (`abstractflow/visual/executor.py`).
  - Note: waiting results are reported as `success: False` with an `error` message (the run is not “failed”; it is blocked on input).

To resume a run you need a host that can call `Runtime.resume(...)` (the web editor does this via WebSocket; see [web-editor.md](web-editor.md)).
