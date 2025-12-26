"""WebSocket integration tests for the visual editor runner.

These tests run the FastAPI app in-process (no network) and validate that
waiting effects (ASK_USER) pause and can be resumed to completion.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_ask_user_waiting_then_resume_completes() -> None:
    flow_id = "test-ws-ask-user"

    visual = VisualFlow(
        id=flow_id,
        name="test ws ask_user",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Pick one:"},
            ),
            VisualNode(
                id="choices",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["alpha", "beta"]},
            ),
            VisualNode(
                id="n2",
                type=NodeType.ASK_USER,
                position=Position(x=0, y=0),
                data={"effectConfig": {"allowFreeText": False}},
            ),
            VisualNode(
                id="n3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'final': input.get('input')}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            # Execution edges
            VisualEdge(
                id="e1",
                source="n1",
                sourceHandle="exec-out",
                target="n2",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="n2",
                sourceHandle="exec-out",
                target="n3",
                targetHandle="exec-in",
            ),
            # Data edges: literals -> ask_user
            VisualEdge(
                id="d1",
                source="prompt",
                sourceHandle="value",
                target="n2",
                targetHandle="prompt",
            ),
            VisualEdge(
                id="d2",
                source="choices",
                sourceHandle="value",
                target="n2",
                targetHandle="choices",
            ),
            # Data edge: ask_user response -> code input
            VisualEdge(
                id="d3",
                source="n2",
                sourceHandle="response",
                target="n3",
                targetHandle="input",
            ),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                waiting = None
                for _ in range(100):
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_waiting":
                        waiting = msg
                        break

                assert waiting is not None
                assert waiting["nodeId"] == "n2"
                assert waiting["prompt"] == "Pick one:"
                assert waiting["choices"] == ["alpha", "beta"]
                assert waiting["allow_free_text"] is False
                assert waiting.get("wait_key")

                ws.send_text(json.dumps({"type": "resume", "response": "beta"}))

                ask_complete = None
                completed = None
                for _ in range(200):
                    msg = ws.receive_json()
                    if msg.get("type") == "node_complete" and msg.get("nodeId") == "n2":
                        ask_complete = msg
                    if msg.get("type") == "flow_complete":
                        completed = msg
                        break

                assert ask_complete is not None
                assert isinstance(ask_complete.get("result"), dict)
                assert ask_complete["result"].get("response") == "beta"
                assert isinstance(ask_complete.get("meta"), dict)
                assert isinstance(ask_complete["meta"].get("duration_ms"), (int, float))

                assert completed is not None
                assert completed["result"]["success"] is True
                assert completed["result"]["result"]["final"] == "beta"
    finally:
        _flows.pop(flow_id, None)
