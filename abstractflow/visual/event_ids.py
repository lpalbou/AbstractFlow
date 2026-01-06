"""Deterministic workflow IDs for VisualFlow custom event listeners.

Visual "On Event" nodes are compiled into dedicated listener workflows and started
alongside the main workflow run.

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


def visual_event_listener_workflow_id(*, flow_id: str, node_id: str) -> str:
    """Return the workflow_id used for a VisualFlow `on_event` listener workflow."""
    return f"visual_event_listener_{_sanitize(flow_id)}_{_sanitize(node_id)}"





