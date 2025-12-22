"""Deterministic workflow IDs for VisualFlow Agent nodes.

Visual Agent nodes are compiled into `START_SUBWORKFLOW` effects that reference
an AbstractAgent ReAct workflow registered in the runtime's WorkflowRegistry.

IDs must be stable across hosts so a VisualFlow JSON document can be executed
outside the web editor (CLI, AbstractCode, third-party apps).
"""

from __future__ import annotations

import re


_SAFE_ID_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def _sanitize(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return "unknown"
    value = _SAFE_ID_RE.sub("_", value)
    return value or "unknown"


def visual_react_workflow_id(*, flow_id: str, node_id: str) -> str:
    """Return the workflow_id used for a VisualFlow Agent node's ReAct subworkflow."""
    return f"visual_react_agent_{_sanitize(flow_id)}_{_sanitize(node_id)}"

