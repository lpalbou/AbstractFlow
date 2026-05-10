"""Portable utilities for AbstractFlow visual workflows.

The visual editor saves flows as JSON (nodes/edges). These helpers compile that
representation into an `abstractflow.Flow` / `abstractruntime.WorkflowSpec` so
the same workflow can be executed from other hosts (e.g. AbstractCode, CLI),
not only the web backend.
"""
from __future__ import annotations

from importlib import import_module
from typing import Any

from .models import (
    ExecutionEvent,
    FlowCreateRequest,
    FlowRunRequest,
    FlowRunResult,
    FlowUpdateRequest,
    NodeType,
    Pin,
    PinType,
    Position,
    VisualEdge,
    VisualFlow,
    VisualNode,
)

__all__ = [
    "create_visual_runner",
    "execute_visual_flow",
    "visual_to_flow",
    # Models
    "ExecutionEvent",
    "FlowCreateRequest",
    "FlowRunRequest",
    "FlowRunResult",
    "FlowUpdateRequest",
    "NodeType",
    "Pin",
    "PinType",
    "Position",
    "VisualEdge",
    "VisualFlow",
    "VisualNode",
]

_RUNTIME_EXPORTS = {
    "create_visual_runner": (".executor", "create_visual_runner"),
    "execute_visual_flow": (".executor", "execute_visual_flow"),
    "visual_to_flow": (".executor", "visual_to_flow"),
}

_RUNTIME_INSTALL_HINT = (
    "Install the runtime stack with: pip install \"abstractflow[runtime]\" "
    '(or "abstractflow[all-apple]", "abstractflow[all-gpu]" for host profiles).'
)


def __getattr__(name: str) -> Any:
    entry = _RUNTIME_EXPORTS.get(name)
    if entry is None:
        raise AttributeError(name)

    module_name, attr_name = entry
    try:
        return getattr(import_module(module_name, package=__name__), attr_name)
    except ModuleNotFoundError as exc:
        missing = str(exc.name or "").lower()
        if "abstractruntime" in missing or "abstractcore" in missing:
            raise RuntimeError(f"{name} requires the local execution stack. {_RUNTIME_INSTALL_HINT}") from exc
        raise


def __dir__() -> list[str]:
    return sorted(set(globals().keys()) | set(__all__))
