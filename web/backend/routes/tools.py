"""Tool discovery endpoints for the visual editor.

The visual Agent node needs to present an allowlist of tools. Per the durable
execution design, tool availability is a host/runtime concern, so we source the
defaults from AbstractRuntime's AbstractCore integration.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["tools"])


def _tool_spec_from_callable(func: Any) -> Dict[str, Any]:
    tool_def = getattr(func, "_tool_definition", None)
    if tool_def is not None and hasattr(tool_def, "to_dict"):
        return dict(tool_def.to_dict())
    from abstractcore.tools.core import ToolDefinition

    return dict(ToolDefinition.from_function(func).to_dict())


@router.get("/tools")
async def list_tools() -> List[Dict[str, Any]]:
    """List available tools (ToolSpec dicts)."""
    try:
        from abstractruntime.integrations.abstractcore.default_tools import list_default_tool_specs
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="AbstractRuntime not installed. Run: pip install abstractruntime",
        )

    try:
        specs = list_default_tool_specs()
        if not isinstance(specs, list):
            specs = []

        # AbstractCore common tools that are safe but not yet included in AbstractRuntime defaults.
        # Keep discovery aligned with the host executor (`abstractflow.visual.workspace_scoped_tools`).
        try:
            from abstractcore.tools.common_tools import skim_url, skim_websearch

            seen = {str(s.get("name") or "") for s in specs if isinstance(s, dict)}
            for tool_fn in [skim_url, skim_websearch]:
                if not callable(tool_fn):
                    continue
                d = _tool_spec_from_callable(tool_fn)
                name = str(d.get("name") or "").strip()
                if not name or name in seen:
                    continue
                seen.add(name)
                d.setdefault("toolset", "web")
                specs.append(d)
        except Exception:
            pass

        # Add schema-only runtime tools used by agents (no external callable).
        # These are executed as runtime effects by AbstractAgent adapters.
        try:
            from abstractagent.logic.builtins import (  # type: ignore
                ASK_USER_TOOL,
                COMPACT_MEMORY_TOOL,
                DELEGATE_AGENT_TOOL,
                INSPECT_VARS_TOOL,
                RECALL_MEMORY_TOOL,
                REMEMBER_TOOL,
            )
        except Exception:
            return specs

        builtin_defs = [
            (ASK_USER_TOOL, "system", ["builtin", "hitl"]),
            (RECALL_MEMORY_TOOL, "memory", ["builtin", "memory"]),
            (INSPECT_VARS_TOOL, "memory", ["builtin", "debug"]),
            (REMEMBER_TOOL, "memory", ["builtin", "memory"]),
            (COMPACT_MEMORY_TOOL, "memory", ["builtin", "memory"]),
            (DELEGATE_AGENT_TOOL, "system", ["builtin", "agent"]),
        ]

        seen = {str(s.get("name") or "") for s in specs if isinstance(s, dict)}
        for tool_def, toolset, tags in builtin_defs:
            name = getattr(tool_def, "name", None)
            if not isinstance(name, str) or not name.strip():
                continue
            if name in seen:
                continue
            seen.add(name)
            d = tool_def.to_dict()
            if isinstance(d, dict):
                d.setdefault("toolset", toolset)
                d.setdefault("tags", list(tags))
                specs.append(d)

        return specs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tools: {e}")
