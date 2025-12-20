"""WebSocket routes for real-time execution updates."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import ExecutionEvent, VisualFlow
from ..services.executor import visual_to_flow

router = APIRouter(tags=["websocket"])

# Active WebSocket connections
_connections: Dict[str, WebSocket] = {}

# Active FlowRunners for waiting flows (keyed by connection_id)
_waiting_runners: Dict[str, Any] = {}

# Flow storage reference (shared with flows.py)
from .flows import _flows


@router.websocket("/ws/{flow_id}")
async def websocket_execution(websocket: WebSocket, flow_id: str):
    """WebSocket endpoint for real-time flow execution updates."""
    await websocket.accept()
    connection_id = f"{flow_id}:{id(websocket)}"
    _connections[connection_id] = websocket

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "run":
                # Execute flow with real-time updates
                await execute_with_updates(
                    websocket=websocket,
                    flow_id=flow_id,
                    input_data=message.get("input_data", {}),
                    connection_id=connection_id,
                )
            elif message.get("type") == "resume":
                # Resume a waiting flow with user response
                await resume_waiting_flow(
                    websocket=websocket,
                    connection_id=connection_id,
                    response=message.get("response", ""),
                )
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        if connection_id in _connections:
            del _connections[connection_id]
        if connection_id in _waiting_runners:
            del _waiting_runners[connection_id]


async def execute_with_updates(
    websocket: WebSocket,
    flow_id: str,
    input_data: Dict[str, Any],
    connection_id: str,
) -> None:
    """Execute a flow and send real-time updates via WebSocket."""
    if flow_id not in _flows:
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=f"Flow '{flow_id}' not found",
            ).model_dump()
        )
        return

    visual_flow = _flows[flow_id]

    try:
        # Import here to avoid circular imports
        from abstractflow import FlowRunner

        # Convert visual flow to AbstractFlow
        flow = visual_to_flow(visual_flow)

        # Create runner
        runner = FlowRunner(flow)

        # Send flow start event
        await websocket.send_json(
            ExecutionEvent(type="flow_start").model_dump()
        )

        # Start execution
        run_id = runner.start(input_data)

        # Execute and handle waiting
        await _execute_runner_loop(websocket, runner, connection_id)

    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )


async def _execute_runner_loop(
    websocket: WebSocket,
    runner: Any,
    connection_id: str,
) -> None:
    """Execute the runner loop with waiting support."""
    last_node = None

    while True:
        state = runner.step()

        # Send node complete for previous node
        if last_node and state.current_node != last_node:
            await websocket.send_json(
                ExecutionEvent(
                    type="node_complete",
                    nodeId=last_node,
                ).model_dump()
            )

        # Send node start for current node
        if state.current_node and state.current_node != last_node:
            await websocket.send_json(
                ExecutionEvent(
                    type="node_start",
                    nodeId=state.current_node,
                ).model_dump()
            )

        last_node = state.current_node

        # Check if waiting
        if runner.is_waiting():
            # Store the runner for resumption
            _waiting_runners[connection_id] = runner

            # Extract waiting info from state
            wait_info = {}
            if state.waiting:
                wait_info = {
                    "wait_key": state.waiting.wait_key if hasattr(state.waiting, "wait_key") else None,
                    "effect_type": state.waiting.effect_type.value if hasattr(state.waiting, "effect_type") else None,
                }

            # Try to get prompt info from the effect
            prompt_info = {}
            if hasattr(state, "pending_effect") and state.pending_effect:
                payload = state.pending_effect.payload if hasattr(state.pending_effect, "payload") else {}
                prompt_info = {
                    "prompt": payload.get("prompt", "Please respond:"),
                    "choices": payload.get("choices", []),
                    "allow_free_text": payload.get("allow_free_text", True),
                }

            await websocket.send_json({
                "type": "flow_waiting",
                "nodeId": state.current_node,
                **wait_info,
                **prompt_info,
            })
            break

        # Check if complete
        if runner.is_complete():
            # Clean up waiting runner if exists
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]

            # Send node_complete for last node
            if last_node:
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        nodeId=last_node,
                    ).model_dump()
                )
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_complete",
                    result=state.output,
                ).model_dump()
            )
            break

        # Check if failed
        if runner.is_failed():
            # Clean up waiting runner if exists
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]

            # Send node_complete for last node
            if last_node:
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        nodeId=last_node,
                    ).model_dump()
                )
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_error",
                    error=state.error,
                ).model_dump()
            )
            break

        # Small delay to avoid overwhelming the WebSocket
        await asyncio.sleep(0.01)


async def resume_waiting_flow(
    websocket: WebSocket,
    connection_id: str,
    response: str,
) -> None:
    """Resume a waiting flow with the user's response."""
    if connection_id not in _waiting_runners:
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error="No waiting flow to resume",
            ).model_dump()
        )
        return

    runner = _waiting_runners[connection_id]

    try:
        # Resume with the user's response
        runner.resume(payload={"response": response})

        # Continue execution
        await _execute_runner_loop(websocket, runner, connection_id)

    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )
