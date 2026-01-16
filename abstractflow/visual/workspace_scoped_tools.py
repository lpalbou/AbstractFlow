"""Workspace-scoped tool execution helpers (AbstractFlow re-export).

The core implementation lives in AbstractRuntime's AbstractCore integration so it can
be shared across hosts/clients. AbstractFlow re-exports the types to preserve existing
imports (`abstractflow.visual.workspace_scoped_tools`).
"""

from __future__ import annotations

from typing import Any

from abstractruntime.integrations.abstractcore.workspace_scoped_tools import (  # noqa: F401
    WorkspaceScope,
    WorkspaceScopedToolExecutor,
    resolve_workspace_base_dir,
    resolve_user_path,
)


def build_scoped_tool_executor(*, scope: WorkspaceScope) -> Any:
    """Create a local tool executor wrapped with workspace scoping."""
    from abstractruntime.integrations.abstractcore.default_tools import get_default_tools
    from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor

    delegate = MappingToolExecutor.from_tools(get_default_tools())
    return WorkspaceScopedToolExecutor(scope=scope, delegate=delegate)



