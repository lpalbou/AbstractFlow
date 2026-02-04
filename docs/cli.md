# CLI (`abstractflow`)

AbstractFlow ships a small CLI focused on **WorkflowBundle** (`.flow`) utilities.

Entry point:
- `abstractflow` (declared in `pyproject.toml` → `project.scripts`)
- implementation: `abstractflow/cli.py`

See also: `docs/visualflow.md`, `docs/getting-started.md`, `docs/architecture.md`.

## WorkflowBundle (.flow)

A `.flow` file is a zip bundle containing:
- `manifest.json`
- `flows/<flow_id>.json` (one or more VisualFlow JSON documents)

Bundling semantics are shared with AbstractRuntime:
- AbstractFlow CLI uses `abstractruntime.workflow_bundle` under the hood.
- Evidence: `abstractflow/workflow_bundle.py`, `abstractflow/cli.py`.

## Commands

Pack a bundle from a root VisualFlow JSON (includes referenced subflows as determined by the AbstractRuntime packer):

```bash
abstractflow bundle pack web/flows/ac-echo.json --out /tmp/ac-echo.flow
```

Common options (see `abstractflow bundle pack --help`):
- `--flows-dir <dir>`: where to find `<flow_id>.json` files (defaults to the root file’s directory)
- `--bundle-id <id>`, `--bundle-version <x.y.z>`
- `--entrypoint <flow_id>` (repeatable)

Inspect a bundle manifest:

```bash
abstractflow bundle inspect /tmp/ac-echo.flow
```

Unpack to a directory:

```bash
abstractflow bundle unpack /tmp/ac-echo.flow --dir /tmp/ac-echo
```

Evidence:
- Delegation to AbstractRuntime: `abstractflow/workflow_bundle.py`
- CLI implementation: `abstractflow/cli.py`
- Tests: `tests/test_workflow_bundle_pack.py`
