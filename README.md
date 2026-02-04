# AbstractFlow

Diagram-based, **durable** AI workflows for Python.

AbstractFlow provides:
- A portable workflow format (`VisualFlow` JSON) and helpers to execute it from any host (`abstractflow.visual`).
- A simple programmatic API (`Flow`, `FlowRunner`) backed by **AbstractRuntime**.
- A reference visual editor app in `web/` (FastAPI backend + React frontend).

Project status: **Pre-alpha** (`pyproject.toml`: `Development Status :: 2 - Pre-Alpha`). Expect breaking changes.

## Capabilities (implemented)

- Execute programmatic flows (`Flow` → `FlowRunner`) with a default in-memory runtime.
- Execute portable `VisualFlow` JSON from any host process (`abstractflow.visual`).
- Durable waits and resumption via AbstractRuntime (e.g. user/event/schedule waits).
- Package a flow tree as a WorkflowBundle (`.flow`) via the CLI.
- Author/run VisualFlows in the reference web editor (`web/`).

Evidence (code): `abstractflow/runner.py`, `abstractflow/visual/executor.py`, `abstractflow/cli.py`, `web/backend/routes/ws.py`.

## Docs

- Start here: `docs/getting-started.md`
- API reference: `docs/api.md`
- VisualFlow format: `docs/visualflow.md`
- Visual editor: `docs/web-editor.md`
- CLI: `docs/cli.md`
- FAQ: `docs/faq.md`
- Architecture: `docs/architecture.md`
- Docs index: `docs/README.md`

## Installation

```bash
pip install abstractflow
```

Requirements: Python **3.10+** (`pyproject.toml`: `requires-python`).

Optional extras:
- Agent nodes (ReAct workflows): `pip install "abstractflow[agent]"`
- Dev tools (tests/formatting): `pip install "abstractflow[dev]"`

Notes:
- `abstractflow` depends on `AbstractRuntime` and `abstractcore[tools]` (see `pyproject.toml`).
- Some VisualFlow node types require additional packages (e.g. `memory_kg_*` nodes need `abstractmemory`).

## Quickstart (programmatic)

```python
from abstractflow import Flow, FlowRunner

flow = Flow("linear")
flow.add_node("double", lambda x: x * 2, input_key="value", output_key="doubled")
flow.add_node("add_ten", lambda x: x + 10, input_key="doubled", output_key="final")
flow.add_edge("double", "add_ten")
flow.set_entry("double")

result = FlowRunner(flow).run({"value": 5})
print(result)  # {"success": True, "result": 20}
```

## Quickstart (execute a VisualFlow JSON)

```python
import json
from abstractflow.visual import VisualFlow, execute_visual_flow

with open("my-flow.json", "r", encoding="utf-8") as f:
    vf = VisualFlow.model_validate(json.load(f))
result = execute_visual_flow(vf, {"prompt": "Hello"}, flows={vf.id: vf})
print(result)  # {"success": True, "waiting": False, "result": ...}
```

If your flow uses subflows, load all referenced `*.json` into the `flows={...}` mapping (see `docs/getting-started.md`).

## Visual editor (from source)

The visual editor is a dev/reference app in `web/` (not shipped as a Python package on PyPI).

```bash
git clone https://github.com/lpalbou/AbstractFlow.git
cd AbstractFlow

python -m venv .venv
source .venv/bin/activate
pip install -e ".[server,agent]"

# Terminal 1: Backend (FastAPI)
cd web && python -m backend --reload --port 8080

# Terminal 2: Frontend (Vite)
cd web/frontend && npm install && npm run dev
```

Open the frontend at http://localhost:3003 (default Vite port). See `docs/web-editor.md`.

## CLI (WorkflowBundle `.flow`)

```bash
abstractflow bundle pack web/flows/ac-echo.json --out /tmp/ac-echo.flow
abstractflow bundle inspect /tmp/ac-echo.flow
abstractflow bundle unpack /tmp/ac-echo.flow --dir /tmp/ac-echo
```

See `docs/cli.md` and `abstractflow/cli.py`.

## Related projects

- AbstractRuntime (durable execution kernel): https://github.com/lpalbou/AbstractRuntime
- AbstractCore (providers/models/tools): https://github.com/lpalbou/AbstractCore
- AbstractAgent (ReAct/CodeAct): https://github.com/lpalbou/AbstractAgent

## Changelog

See `CHANGELOG.md`.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## Acknowledgments

See `ACKNOWLEDMENTS.md`.

## License

MIT. See `LICENSE`.
