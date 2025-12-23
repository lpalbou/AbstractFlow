"""WebSocket integration test for the ANSWER_USER effect node."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_answer_user_emits_message_and_continues() -> None:
    flow_id = "test-ws-answer-user"

    visual = VisualFlow(
        id=flow_id,
        name="test ws answer_user",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="msg",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Hello from flow"},
            ),
            VisualNode(
                id="n2",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
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
            VisualEdge(
                id="d1",
                source="msg",
                sourceHandle="value",
                target="n2",
                targetHandle="message",
            ),
            VisualEdge(
                id="d2",
                source="n2",
                sourceHandle="message",
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

                messages: list[dict] = []
                completed = None
                for _ in range(300):
                    msg = ws.receive_json()
                    messages.append(msg)
                    if msg.get("type") == "flow_error":
                        pytest.fail(f"Flow failed over WS: {msg.get('error')}")
                    if msg.get("type") == "flow_waiting":
                        pytest.fail(
                            "Flow unexpectedly entered waiting state over WS: "
                            + json.dumps(msg, ensure_ascii=False)
                        )
                    if msg.get("type") == "flow_complete":
                        completed = msg
                        break

                assert completed is not None
                assert completed["result"]["success"] is True
                assert completed["result"]["result"]["final"] == "Hello from flow"

                answer_complete = next(
                    (m for m in messages if m.get("type") == "node_complete" and m.get("nodeId") == "n2"),
                    None,
                )
                assert answer_complete is not None
                assert answer_complete.get("result", {}).get("message") == "Hello from flow"
    finally:
        _flows.pop(flow_id, None)

