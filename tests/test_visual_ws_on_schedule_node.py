"""WebSocket integration test for On Schedule visual trigger node."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_on_schedule_waits_then_executes_next_node() -> None:
    flow_id = "test-ws-on-schedule"

    visual = VisualFlow(
        id=flow_id,
        name="test ws on_schedule",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_SCHEDULE,
                position=Position(x=0, y=0),
                data={"eventConfig": {"schedule": "0.25s", "recurrent": False}},
            ),
            VisualNode(
                id="msg",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "ok"},
            ),
            VisualNode(
                id="n2",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="d1", source="msg", sourceHandle="value", target="n2", targetHandle="message"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                started_at = None
                schedule_started_at = None
                schedule_completed_at = None
                saw_answer_complete = False
                saw_waiting = False
                saw_schedule_timestamp = False

                started_at = time.perf_counter()
                while time.perf_counter() - started_at < 5.0:
                    msg = ws.receive_json()
                    t = msg.get("type")
                    if t == "flow_waiting":
                        saw_waiting = True
                        break
                    if t == "node_start" and msg.get("nodeId") == "n1":
                        schedule_started_at = time.perf_counter()
                    if t == "node_complete" and msg.get("nodeId") == "n1":
                        schedule_completed_at = time.perf_counter()
                        result = msg.get("result")
                        if isinstance(result, dict) and isinstance(result.get("timestamp"), str) and result.get("timestamp"):
                            saw_schedule_timestamp = True
                    if t == "node_complete" and msg.get("nodeId") == "n2":
                        saw_answer_complete = True
                    if t == "flow_complete":
                        break
                    if t == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")

                assert saw_waiting is False
                assert saw_answer_complete is True
                assert saw_schedule_timestamp is True
                assert schedule_started_at is not None and schedule_completed_at is not None
                assert (schedule_completed_at - schedule_started_at) >= 0.2
    finally:
        _flows.pop(flow_id, None)

