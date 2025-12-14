"""WebSocket routes for real-time execution updates."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import ExecutionEvent, VisualFlow
from ..services.executor import visual_to_flow

router = APIRouter(tags=["websocket"])

# Active WebSocket connections
_connections: Dict[str, WebSocket] = {}

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
                )
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        if connection_id in _connections:
            del _connections[connection_id]


async def execute_with_updates(
    websocket: WebSocket,
    flow_id: str,
    input_data: Dict[str, Any],
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

        # Execute step by step with updates
        while True:
            state = runner.step()

            # Send node update
            if state.current_node:
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_start",
                        nodeId=state.current_node,
                    ).model_dump()
                )

            # Check if waiting
            if runner.is_waiting():
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_waiting",
                        nodeId=state.current_node,
                    ).model_dump()
                )
                break

            # Check if complete
            if runner.is_complete():
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_complete",
                        result=state.output,
                    ).model_dump()
                )
                break

            # Check if failed
            if runner.is_failed():
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_error",
                        error=state.error,
                    ).model_dump()
                )
                break

            # Small delay to avoid overwhelming the WebSocket
            await asyncio.sleep(0.01)

    except Exception as e:
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )
