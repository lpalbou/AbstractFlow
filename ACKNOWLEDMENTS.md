# Acknowledgments

AbstractFlow is built on the shoulders of many projects and ideas. Thank you to the maintainers and contributors of the libraries and tools that make this project possible.

## Inspiration

- The visual workflow UX is inspired by Unreal Engine (UE4/UE5) Blueprints: execution pins, typed pins, and “graph as program”.

Evidence: [docs/architecture.md](docs/architecture.md).

## Core building blocks

- AbstractFramework (ecosystem): https://github.com/lpalbou/AbstractFramework
- AbstractRuntime (durable execution kernel: runs, waits, ledgers, artifacts)
- AbstractCore (providers/models/tools integration used by runtime effects)
- AbstractAgent (optional ReAct/CodeAct agent workflows used by the Visual Agent node)

See `README.md` for links to the upstream repositories.

Evidence: [pyproject.toml](pyproject.toml) (dependencies and extras), [abstractflow/visual/executor.py](abstractflow/visual/executor.py) (Agent + memory wiring).

## Open-source libraries used in this repo

This list is intentionally focused on **direct dependencies** declared by the repository (plus a small number of optional integrations that are referenced in code). For the authoritative list, use the manifests below.

Evidence: `pyproject.toml`, `web/frontend/package.json`.

### Python package (`abstractflow/`)

Declared runtime dependencies:
- AbstractRuntime
- abstractcore (`abstractcore[tools]`)
- Pydantic
- typing-extensions

Evidence: `pyproject.toml` (`project.dependencies`).

Optional Python extras:
- `abstractflow[agent]`: AbstractAgent
- `abstractflow[server]`: FastAPI, Uvicorn, websockets
- `abstractflow[ui]`: Streamlit, Plotly, NetworkX
- `abstractflow[dev]`: pytest, pytest-asyncio, Black, isort, Flake8, mypy, pre-commit

Evidence: `pyproject.toml` (`project.optional-dependencies`).

Optional integration (not installed by default):
- AbstractMemory: used when executing `memory_kg_*` nodes; requires `abstractmemory` (and a LanceDB-backed store when configured).

Evidence: `abstractflow/visual/executor.py` (imports + error messages for missing installs).

### Reference web editor (`web/`)

Backend (FastAPI):
- FastAPI (API + WebSockets)
- Uvicorn (ASGI server)

Evidence: `web/backend/main.py`, `pyproject.toml` (`server` extra).

Frontend (React/Vite):
- React, React DOM
- React Flow (graph editor)
- Vite, TypeScript
- Monaco editor (`@monaco-editor/react`)
- TanStack Query (`@tanstack/react-query`)
- Zustand (state)
- DOMPurify (HTML sanitization)
- Marked (Markdown rendering)
- clsx (className composition)
- react-hot-toast (toasts)

Evidence: `web/frontend/package.json`.

Developer tooling (frontend):
- ESLint + TypeScript ESLint
- `@types/*` typings packages

Evidence: `web/frontend/package.json` (`devDependencies`).
