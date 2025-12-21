"""Tool discovery endpoints for the visual editor.

The visual Agent node needs to present an allowlist of tools. Per the durable
execution design, tool availability is a host/runtime concern, so we source the
defaults from AbstractRuntime's AbstractCore integration.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["tools"])


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
        return list_default_tool_specs()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tools: {e}")

