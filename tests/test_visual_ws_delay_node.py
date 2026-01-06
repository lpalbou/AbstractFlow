"""WebSocket integration test for WAIT_UNTIL (Delay) visual effect node."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_delay_waits_then_executes_next_node() -> None:
    flow_id = "test-ws-delay"

    visual = VisualFlow(
        id=flow_id,
        name="test ws delay",
        entryNode="n1",
        nodes=[
            VisualNode(id="n1", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="dur",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 0.2},
            ),
            VisualNode(
                id="n2",
                type=NodeType.WAIT_UNTIL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"durationType": "seconds"}},
            ),
            VisualNode(
                id="msg",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "ok"},
            ),
            VisualNode(
                id="n3",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="e2", source="n2", sourceHandle="exec-out", target="n3", targetHandle="exec-in"),
            VisualEdge(id="d1", source="dur", sourceHandle="value", target="n2", targetHandle="duration"),
            VisualEdge(id="d2", source="msg", sourceHandle="value", target="n3", targetHandle="message"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                saw_answer_complete = False
                saw_waiting = False
                started = time.perf_counter()
                while time.perf_counter() - started < 5.0:
                    msg = ws.receive_json()
                    t = msg.get("type")
                    if t == "flow_waiting":
                        # Delay must not surface as user waiting.
                        saw_waiting = True
                        break
                    if t == "node_complete" and msg.get("nodeId") == "n3":
                        saw_answer_complete = True
                    if t == "flow_complete":
                        break
                    if t == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")

                assert saw_waiting is False
                assert saw_answer_complete is True
    finally:
        _flows.pop(flow_id, None)





