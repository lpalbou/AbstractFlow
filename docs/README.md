# AbstractFlow documentation

AbstractFlow is a Python library (plus a reference web UI) for authoring and executing **durable** AI workflows.

This doc set is intentionally:
- **actionable** (commands and entrypoints you can run)
- **evidence-based** (each page points to the code that implements the described behavior)

## Start here

- Project overview + install: [../README.md](../README.md)
- Getting started (quickstarts + “waiting” runs): [getting-started.md](getting-started.md)

## Find what you need

- API reference (high-level): [api.md](api.md)
- Architecture (how the pieces fit): [architecture.md](architecture.md)
- FAQ (common questions): [faq.md](faq.md)
- VisualFlow JSON format: [visualflow.md](visualflow.md)
- Visual editor (run the reference UI): [web-editor.md](web-editor.md)
- CLI (`bundle`, `serve`): [cli.md](cli.md)

## Repo policies

- Changelog: [../CHANGELOG.md](../CHANGELOG.md)
- Contributing: [../CONTRIBUTING.md](../CONTRIBUTING.md)
- Security reporting: [../SECURITY.md](../SECURITY.md)
- Acknowledgments: [../ACKNOWLEDMENTS.md](../ACKNOWLEDMENTS.md)

## Code map (evidence)

- Public Python API exports: [../abstractflow/__init__.py](../abstractflow/__init__.py)
- Programmatic flows (IR re-export from AbstractRuntime): [../abstractflow/core/flow.py](../abstractflow/core/flow.py)
- Flow execution convenience: [../abstractflow/runner.py](../abstractflow/runner.py) (`FlowRunner`)
- VisualFlow schema (portable JSON): [../abstractflow/visual/models.py](../abstractflow/visual/models.py)
- VisualFlow host wiring + execution: [../abstractflow/visual/executor.py](../abstractflow/visual/executor.py)
- VisualFlow interface contracts: [../abstractflow/visual/interfaces.py](../abstractflow/visual/interfaces.py)
- WorkflowBundle helpers (thin wrapper): [../abstractflow/workflow_bundle.py](../abstractflow/workflow_bundle.py)
- CLI entrypoint: [../abstractflow/cli.py](../abstractflow/cli.py)
- Web backend (FastAPI): [../web/backend/main.py](../web/backend/main.py), [../web/backend/routes/](../web/backend/routes/)
- Web frontend (React): [../web/frontend/src/](../web/frontend/src/)
