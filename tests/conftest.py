"""AbstractFlow test bootstrap for monorepo layouts.

Why this exists:
- In this repo, sibling projects live at the monorepo root (e.g. `abstractcore/`,
  `abstractflow/`, ...).
- When tests are invoked from the monorepo root, Python's default `sys.path`
  includes the CWD (""), which makes directories like `abstractcore/` appear as
  namespace packages (PEP 420) and *shadow* the actual installable package
  located at `abstractcore/abstractcore/`.

This breaks imports for the AbstractRuntime↔AbstractCore integration, e.g.:
`from abstractcore import create_llm`.

The fix is to ensure the *project roots* for sibling packages are on `sys.path`
ahead of the monorepo root CWD so imports resolve to the real packages.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _prepend_sys_path(path: Path) -> None:
    p = str(path)
    if p and p not in sys.path:
        sys.path.insert(0, p)


HERE = Path(__file__).resolve()
ABSTRACTFLOW_ROOT = HERE.parents[1]  # .../abstractflow
MONOREPO_ROOT = HERE.parents[2]      # .../abstractframework

# Ensure `abstractflow` resolves to .../abstractflow/abstractflow (has __init__.py)
_prepend_sys_path(ABSTRACTFLOW_ROOT)

# Ensure `abstractcore` resolves to .../abstractcore/abstractcore (has __init__.py)
_prepend_sys_path(MONOREPO_ROOT / "abstractcore")

# These two already use src-layout and are typically installed editable, but keep
# them stable when running from monorepo root.
_prepend_sys_path(MONOREPO_ROOT / "abstractruntime" / "src")
_prepend_sys_path(MONOREPO_ROOT / "abstractagent" / "src")





