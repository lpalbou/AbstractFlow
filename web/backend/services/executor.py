"""Flow execution service (web backend).

This module is intentionally thin: the portable implementation lives in
`abstractflow.visual.executor` so visual workflows can run from non-web hosts.
"""

from __future__ import annotations

from typing import Any, Dict

from abstractflow import Flow, FlowRunner
from abstractflow.visual.executor import (  # noqa: F401
    create_visual_runner,
    execute_visual_flow,
    visual_to_flow,
)


def execute_flow(flow: Flow, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a Flow and return a normalized result payload."""
    if hasattr(flow, "_node_outputs"):
        flow._node_outputs.clear()

    runner = FlowRunner(flow)
    result = runner.run(input_data)

    if isinstance(result, dict) and result.get("waiting"):
        state = runner.get_state()
        wait = state.waiting if state else None
        return {
            "success": False,
            "waiting": True,
            "error": "Flow is waiting for input. Use WebSocket (/api/ws/{flow_id}) to resume.",
            "run_id": runner.run_id,
            "wait_key": wait.wait_key if wait else None,
            "prompt": wait.prompt if wait else None,
            "choices": list(wait.choices) if wait and isinstance(wait.choices, list) else [],
            "allow_free_text": bool(wait.allow_free_text) if wait else None,
        }

    if isinstance(result, dict):
        return {
            "success": bool(result.get("success", True)),
            "waiting": False,
            "result": result.get("result"),
            "error": result.get("error"),
            "run_id": runner.run_id,
        }

    return {"success": True, "waiting": False, "result": result, "run_id": runner.run_id}

