# AbstractFlow

Diagram-based, **durable** AI workflows for Python.

AbstractFlow is part of the [AbstractFramework ecosystem](https://github.com/lpalbou/AbstractFramework) and is built on:
- [AbstractRuntime](https://github.com/lpalbou/abstractruntime): durable runs, waits, subworkflows, stores
- [AbstractCore](https://github.com/lpalbou/abstractcore): providers/models/tools (used via runtime integrations)

It provides:
- A small programmatic API (`Flow`, `FlowRunner`) for building and running flows in Python.
- A portable workflow format (`VisualFlow` JSON) + helpers to execute it from any host (`abstractflow.visual`).
- A reference visual editor app in `web/` (FastAPI backend + React frontend).

Project status: **Pre-alpha** (`pyproject.toml`: `Development Status :: 2 - Pre-Alpha`). Expect breaking changes.

Evidence (code): [abstractflow/runner.py](abstractflow/runner.py), [abstractflow/visual/executor.py](abstractflow/visual/executor.py), [abstractflow/cli.py](abstractflow/cli.py), [web/backend/routes/ws.py](web/backend/routes/ws.py).

## Diagram (how it fits together)

```mermaid
flowchart LR
  UI[Visual editor UI<br/>npx @abstractframework/flow] <-->|/api/*| BE[Editor backend<br/>FastAPI (optional)]
  BE -->|save/load| FLOWS[(flows/*.json)]

  HOST[Any host process<br/>CLI / server / notebook] --> VF[VisualFlow models<br/>abstractflow/visual/models.py]
  HOST --> RUN[create_visual_runner / execute_visual_flow<br/>abstractflow/visual/executor.py]
  RUN --> RT[AbstractRuntime Runtime]
  RT -->|effects| AC[AbstractCore]
  RT --> STORES[(Run/Ledger/Artifacts stores)]
```

## Docs

- Getting started: [docs/getting-started.md](docs/getting-started.md)
- API (high-level): [docs/api.md](docs/api.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- FAQ: [docs/faq.md](docs/faq.md)
- VisualFlow JSON format: [docs/visualflow.md](docs/visualflow.md)
- CLI: [docs/cli.md](docs/cli.md)
- Visual editor: [docs/web-editor.md](docs/web-editor.md)
- Docs index: [docs/README.md](docs/README.md)

## Installation

```bash
pip install abstractflow
```

Requirements: Python **3.10+** (`pyproject.toml`: `requires-python`).

Optional extras (declared in `pyproject.toml`):
- Agent nodes (Visual Agent node support): `pip install "abstractflow[agent]"`
- Visual editor backend (FastAPI): `pip install "abstractflow[server]"`
- Visual editor backend + Agent nodes: `pip install "abstractflow[editor]"`
- Dev tools: `pip install "abstractflow[dev]"`

Notes:
- Runtime deps include `AbstractRuntime` + `abstractcore[tools]` (see `pyproject.toml`).
- Some VisualFlow nodes require extra packages at runtime (e.g. `memory_kg_*` nodes require `abstractmemory`).

## Quickstart (programmatic)

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

## Quickstart (execute a VisualFlow JSON)

```python
import json
from abstractflow.visual import VisualFlow, execute_visual_flow

with open("my-flow.json", "r", encoding="utf-8") as f:
    vf = VisualFlow.model_validate(json.load(f))

print(execute_visual_flow(vf, {"prompt": "Hello"}, flows={vf.id: vf}))
```

If your flow uses subflows, load all referenced `*.json` into the `flows={...}` mapping (see [docs/getting-started.md](docs/getting-started.md)).

## Visual editor (local)

The visual editor is split into:
- a **Python backend** (FastAPI) shipped with `abstractflow[editor]` (or `abstractflow[server]`)
- a **JS frontend** published as `@abstractframework/flow` (run via `npx`)

```bash
# Terminal 1: editor backend (FastAPI)
pip install "abstractflow[editor]"
abstractflow serve --reload --port 8080

# Terminal 2: editor UI (static server + /api proxy)
npx @abstractframework/flow
```

Open:
- UI: http://localhost:3003
- Backend health: http://localhost:8080/api/health

Optional: run an AbstractGateway at http://127.0.0.1:8081 and configure it in the UI “Connect” modal (used for embeddings-backed memory KG and bundle publishing). See [docs/web-editor.md](docs/web-editor.md) and [docs/architecture.md](docs/architecture.md).

## CLI (WorkflowBundle `.flow`)

```bash
abstractflow bundle pack web/flows/ac-echo.json --out /tmp/ac-echo.flow
abstractflow bundle inspect /tmp/ac-echo.flow
abstractflow bundle unpack /tmp/ac-echo.flow --dir /tmp/ac-echo
```

See [docs/cli.md](docs/cli.md) and `abstractflow/cli.py`.

## Related projects

- AbstractFramework: https://github.com/lpalbou/AbstractFramework
- AbstractRuntime: https://github.com/lpalbou/abstractruntime
- AbstractCore: https://github.com/lpalbou/abstractcore
- AbstractAgent (optional): https://github.com/lpalbou/AbstractAgent

## Repo policies

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)
- Acknowledgments: [ACKNOWLEDMENTS.md](ACKNOWLEDMENTS.md)
- License: [LICENSE](LICENSE)
