from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, Optional


def _resolve_no_strict(path: Path) -> Path:
    try:
        return path.expanduser().resolve(strict=False)
    except TypeError:  # pragma: no cover (older python)
        return path.expanduser().resolve()


def resolve_base_execution_dir() -> Path:
    """Return the base directory for per-run execution workspaces.

    Priority:
    - `ABSTRACTFLOW_BASE_EXECUTION` env var, if set
    - /tmp (if present)
    - OS temp directory
    """
    env = os.getenv("ABSTRACTFLOW_BASE_EXECUTION")
    raw = env.strip() if isinstance(env, str) else ""
    base = Path(raw) if raw else (Path("/tmp") if Path("/tmp").exists() else Path(tempfile.gettempdir()))
    base = _resolve_no_strict(base)
    if base.exists() and not base.is_dir():
        raise ValueError(f"ABSTRACTFLOW_BASE_EXECUTION must be a directory (got file): {base}")
    base.mkdir(parents=True, exist_ok=True)
    return base


def ensure_default_workspace_root(
    input_data: Dict[str, Any],
    *,
    key: str = "workspace_root",
    base_dir: Optional[Path] = None,
) -> Optional[Path]:
    """Ensure `input_data[key]` points to a per-run workspace directory.

    If the key is already provided by the caller, this is a no-op and returns None.
    """
    raw = input_data.get(key)
    if isinstance(raw, str) and raw.strip():
        return None

    base = base_dir or resolve_base_execution_dir()
    # Keep the real workspace hidden to avoid cluttering /tmp with many folders.
    # A user-friendly alias (base/<run_id>) is created once we know the run_id.
    workspace_dir = base / ".abstractflow" / "runs" / uuid.uuid4().hex
    workspace_dir.mkdir(parents=True, exist_ok=True)
    input_data[key] = str(workspace_dir)
    return workspace_dir


def ensure_run_id_workspace_alias(*, run_id: str, workspace_dir: Path, base_dir: Optional[Path] = None) -> Optional[Path]:
    """Create a stable alias at `<base>/<run_id>` pointing to the workspace directory.

    This makes it easy to locate artifacts by run id while keeping the actual workspace path
    stable (the tool executor is constructed before `run_id` is known).
    """
    rid = str(run_id or "").strip()
    if not rid:
        return None

    base = base_dir or resolve_base_execution_dir()
    alias = base / rid
    alias = _resolve_no_strict(alias)

    # If already present (dir or symlink), keep it.
    try:
        if alias.exists() or alias.is_symlink():
            return alias
    except Exception:
        pass

    try:
        alias.symlink_to(workspace_dir, target_is_directory=True)
        return alias
    except Exception:
        # Fallback (e.g. platforms without symlink privileges): create a small pointer.
        try:
            alias.mkdir(parents=True, exist_ok=True)
            (alias / "WORKSPACE_POINTER.txt").write_text(
                f"This run's workspace is stored at:\n{workspace_dir}\n",
                encoding="utf-8",
            )
            return alias
        except Exception:
            return None
