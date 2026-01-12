"""AbstractFlow Visual Editor Backend.

Dev convenience:
When running via `cd web && PYTHONPATH=. uvicorn backend.main:app`, the Python
import root is `abstractflow/web/`, so the sibling `abstractflow` package
(`abstractflow/abstractflow/`) is not importable unless it's installed in the
active venv.

To keep the local dev command stable, we add the monorepo `abstractflow/`
directory (and other monorepo src-layout packages) to `sys.path` when needed.
"""

__version__ = "0.1.0"

from pathlib import Path
import sys

def _ensure_path(path: Path) -> None:
    value = str(path)
    # Ensure monorepo paths win over any installed/namespace packages by
    # moving them to the front (even if already present).
    try:
        sys.path.remove(value)
    except ValueError:
        pass
    sys.path.insert(0, value)


repo_root = Path(__file__).resolve().parents[3]  # .../abstractframework

# Prefer local monorepo packages when running from source. This intentionally
# takes precedence over any installed packages so "dev run" executes the code
# in this repository.

_flow_root = repo_root / "abstractflow"  # package-at-root layout
if _flow_root.is_dir():
    _ensure_path(_flow_root)

_runtime_src = repo_root / "abstractruntime" / "src"  # src-layout
if _runtime_src.is_dir():
    _ensure_path(_runtime_src)

_agent_src = repo_root / "abstractagent" / "src"  # src-layout
if _agent_src.is_dir():
    _ensure_path(_agent_src)

_core_root = repo_root / "abstractcore"  # package-at-root layout
if _core_root.is_dir():
    _ensure_path(_core_root)

_memory_src = repo_root / "abstractmemory" / "src"  # src-layout
if _memory_src.is_dir():
    _ensure_path(_memory_src)
