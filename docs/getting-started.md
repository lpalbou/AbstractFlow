# Getting started

This guide covers the two primary ways to use AbstractFlow:
- **Programmatic flows** (`Flow` + `FlowRunner`)
- **Visual flows** (portable `VisualFlow` JSON authored by the editor in `web/`)

See also: `docs/README.md`, `docs/api.md`, `docs/faq.md`, `docs/visualflow.md`, `docs/web-editor.md`, `docs/cli.md`, `docs/architecture.md`.

## Requirements

- Python **3.10+** (`pyproject.toml`: `requires-python`)

## Install

```bash
# From PyPI
pip install abstractflow
```

Optional extras:
- Agent nodes (ReAct workflows): `pip install "abstractflow[agent]"`
- Visual editor backend (FastAPI): `pip install "abstractflow[server]"`
- Visual editor backend + Agent nodes (recommended): `pip install "abstractflow[editor]"`
- Dev tools: `pip install "abstractflow[dev]"`

From source (repo root):

```bash
pip install -e .
```

Evidence: dependencies and extras are declared in `pyproject.toml`.

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
- `Flow` / `FlowNode` / `FlowEdge` are re-exported from AbstractRuntime: `abstractflow/core/flow.py`
- `FlowRunner` output normalization is implemented in `abstractflow/runner.py`
- Baseline behavior is covered in `tests/test_runner.py`

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
- package them as a WorkflowBundle (`.flow`) and load via AbstractRuntime (see `docs/cli.md`).

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
- VisualFlow execution wiring lives in `abstractflow/visual/executor.py` (`create_visual_runner`, `execute_visual_flow`)
- Subflow reachability / registry behavior is exercised in `tests/test_visual_subflow_*.py`

## Run the visual editor (local)

The editor is a reference app (FastAPI backend + React frontend). Follow: `docs/web-editor.md`.

Quick start (no repo clone needed):

```bash
pip install "abstractflow[editor]"
abstractflow serve --reload --port 8080
npx @abstractframework/flow
```

Tip (from source): install the backend deps from the repo root with `pip install -e ".[server,agent]"`.

## Workflow bundles (`.flow`)

To package a VisualFlow + subflows into a single file, use the CLI:
- `docs/cli.md`

## Waiting runs (durable asks/events/schedules)

Some flows intentionally block waiting for external input (e.g. `ask_user`, `wait_event`, `wait_until`).

- `FlowRunner.run()` returns `{"waiting": True, "state": <RunState>, ...}` when blocked (`abstractflow/runner.py`).
- `execute_visual_flow()` returns a friendly shape including `waiting`, `wait_key`, and optional UX fields (`prompt`, `choices`, `allow_free_text`) (`abstractflow/visual/executor.py`).
  - Note: waiting results are reported as `success: False` with an `error` message (the run is not “failed”; it is blocked on input).

To resume a run you need a host that can call `Runtime.resume(...)` (the web editor does this via WebSocket; see `docs/web-editor.md`).
