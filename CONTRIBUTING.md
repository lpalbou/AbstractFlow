# Contributing

Thanks for your interest in contributing to AbstractFlow. Contributions are welcome in the form of:
- Bug reports and reproducible test cases
- Documentation improvements
- Fixes and small features (via pull requests)

Security issues: please follow `SECURITY.md` and avoid public disclosure.

## Development setup

Requirements:
- Python **3.10+**
- Node.js **18+** (only if you work on the visual editor in `web/frontend/`)

Create a virtual environment and install the package in editable mode:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,server,agent]"
```

Run tests:

```bash
pytest -q
```

## Working on the visual editor

The visual editor is a reference/dev app under `web/`:
- Backend: FastAPI (`web/backend/`)
- Frontend: React/Vite (`web/frontend/`)

Run instructions: `docs/web-editor.md`.

## Style and quality

- Keep changes focused and well-scoped.
- Prefer adding/adjusting tests when changing behavior (`tests/`).
- Keep public docs concise and accurate; update cross-references when adding new docs (`docs/README.md` is the index).
- If you change docs, regenerate the full agentic pack: `python scripts/generate_llms_full.py` (updates `llms-full.txt`).

Optional formatting (if you use it locally):

```bash
python -m black .
python -m isort .
```
