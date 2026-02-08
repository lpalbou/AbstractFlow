"""Workspace-scoped tool execution helpers (AbstractFlow re-export).

The core implementation lives in AbstractRuntime's AbstractCore integration so it can
be shared across hosts/clients. AbstractFlow re-exports the types to preserve existing
imports (`abstractflow.visual.workspace_scoped_tools`).
"""

from __future__ import annotations

from typing import Any, Callable

from abstractruntime.integrations.abstractcore.workspace_scoped_tools import (  # noqa: F401
    WorkspaceScope,
    WorkspaceScopedToolExecutor,
    resolve_workspace_base_dir,
    resolve_user_path,
)

ToolCallable = Callable[..., Any]


def _tool_name(func: ToolCallable) -> str:
    tool_def = getattr(func, "_tool_definition", None)
    if tool_def is not None:
        name = getattr(tool_def, "name", None)
        if isinstance(name, str) and name.strip():
            return name.strip()
    name = getattr(func, "__name__", "")
    return str(name or "").strip()


def _extend_default_tools(tools: list[ToolCallable]) -> list[ToolCallable]:
    """Extend AbstractRuntime defaults with additional AbstractCore tools.

    Rationale:
    - The editor UX expects the "common tools" set to be available.
    - AbstractRuntime intentionally keeps its default list small; this host opts into a couple
      of additional safe web helpers that are already shipped in `abstractcore[tools]`.
    """
    out = list(tools or [])
    seen = {_tool_name(t) for t in out if callable(t)}

    try:
        from abstractcore.tools.common_tools import skim_url, skim_websearch
    except Exception:
        return out

    for t in [skim_url, skim_websearch]:
        if not callable(t):
            continue
        name = _tool_name(t)
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(t)

    return out


def build_scoped_tool_executor(*, scope: WorkspaceScope) -> Any:
    """Create a local tool executor wrapped with workspace scoping."""
    from abstractruntime.integrations.abstractcore.default_tools import get_default_tools
    from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor

    delegate = MappingToolExecutor.from_tools(_extend_default_tools(list(get_default_tools())))
    return WorkspaceScopedToolExecutor(scope=scope, delegate=delegate)


