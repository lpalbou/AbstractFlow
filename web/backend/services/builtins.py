"""Web backend builtins.

Re-export the portable visual builtins from `abstractflow.visual.builtins` so
the node semantics are shared across hosts.
"""

from __future__ import annotations

from abstractflow.visual.builtins import BUILTIN_HANDLERS, get_builtin_handler  # noqa: F401

__all__ = ["BUILTIN_HANDLERS", "get_builtin_handler"]

