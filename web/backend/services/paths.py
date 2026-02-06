from __future__ import annotations

import os
from pathlib import Path


def _is_repo_checkout() -> bool:
    """Best-effort detection for running from a source checkout.

    In this repository layout:
    - this file lives at `web/backend/services/paths.py`
    - repo root contains `pyproject.toml` and `web/backend/`
    """
    here = Path(__file__).resolve()
    repo_root = here.parents[3]
    return bool((repo_root / "pyproject.toml").is_file() and (repo_root / "web" / "backend").is_dir())


def default_runtime_dir() -> Path:
    """Default on-disk runtime directory (runs/ledger/artifacts and small backend configs).

    - Source checkout: `<repo>/web/runtime` (keeps dev artifacts local to the repo)
    - Installed package: `~/.abstractflow/runtime` (user-writable)
    """
    here = Path(__file__).resolve()
    if _is_repo_checkout():
        return (here.parents[2] / "runtime").resolve()
    return (Path.home() / ".abstractflow" / "runtime").expanduser().resolve()


def resolve_runtime_dir() -> Path:
    """Resolve the runtime directory (env override + mkdir)."""
    raw = os.getenv("ABSTRACTFLOW_RUNTIME_DIR") or ""
    p = Path(str(raw)).expanduser() if str(raw).strip() else default_runtime_dir()
    p = p.resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p

