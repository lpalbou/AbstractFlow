# AbstractFlow documentation

AbstractFlow is a Python library + reference UI for authoring and executing **durable** AI workflows.

All file paths in this doc set are relative to the repository root.

## Read this first

- Project overview + install: `README.md`
- Getting started (install + quickstarts): `docs/getting-started.md`
- FAQ (common questions): `docs/faq.md`
- API reference (high-level): `docs/api.md`
- VisualFlow JSON format (portable workflow document): `docs/visualflow.md`
- Visual editor (FastAPI + React dev app): `docs/web-editor.md`
- CLI (`abstractflow bundle …`): `docs/cli.md`
- Architecture (how the pieces fit): `docs/architecture.md`

## Repo policies

- Changelog: `CHANGELOG.md`
- Contributing: `CONTRIBUTING.md`
- Security reporting: `SECURITY.md`
- Acknowledgments: `ACKNOWLEDMENTS.md`

## Code map (evidence)

- Public Python API: `abstractflow/__init__.py`
- Programmatic flows: `abstractflow/core/flow.py` (re-export from AbstractRuntime)
- Flow execution: `abstractflow/runner.py` (`FlowRunner`)
- VisualFlow schema: `abstractflow/visual/models.py` (`VisualFlow`, `VisualNode`, `NodeType`, …)
- VisualFlow execution wiring: `abstractflow/visual/executor.py` (`create_visual_runner`, `execute_visual_flow`)
- VisualFlow interfaces/contracts: `abstractflow/visual/interfaces.py`
- CLI entrypoint: `abstractflow/cli.py`
- WorkflowBundle utilities: `abstractflow/workflow_bundle.py` (delegates to `abstractruntime.workflow_bundle`)
- Web backend: `web/backend/main.py`, `web/backend/routes/*`
- Web frontend: `web/frontend/src/*`
