"""WebSocket integration tests for execution observability."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_node_events_are_in_order_and_include_outputs() -> None:
    flow_id = "test-ws-observability"

    visual = VisualFlow(
        id=flow_id,
        name="test ws observability",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="n2",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'step': 'n2', 'message': input.get('message')}\n",
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="n3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'step': 'n3', 'prev': input}\n",
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
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(
                    json.dumps(
                        {"type": "run", "input_data": {"message": "hello", "context": {}}}
                    )
                )

                # Collect all messages until flow_complete.
                msgs = []
                for _ in range(200):
                    msg = ws.receive_json()
                    msgs.append(msg)
                    if msg.get("type") == "flow_complete":
                        break

                seq = [(m.get("type"), m.get("nodeId")) for m in msgs if m.get("type") in {"node_start", "node_complete"}]
                assert seq == [
                    ("node_start", "n1"),
                    ("node_complete", "n1"),
                    ("node_start", "n2"),
                    ("node_complete", "n2"),
                    ("node_start", "n3"),
                    ("node_complete", "n3"),
                ]

                # node_complete results contain per-node outputs (preview).
                complete_n1 = next(m for m in msgs if m.get("type") == "node_complete" and m.get("nodeId") == "n1")
                complete_n2 = next(m for m in msgs if m.get("type") == "node_complete" and m.get("nodeId") == "n2")
                complete_n3 = next(m for m in msgs if m.get("type") == "node_complete" and m.get("nodeId") == "n3")

                assert complete_n1.get("result") == {"message": "hello", "context": {}}
                assert complete_n2.get("result") == {"step": "n2", "message": "hello"}
                assert complete_n3.get("result") == {"step": "n3", "prev": {"step": "n2", "message": "hello"}}

                # Metrics are best-effort but duration should always be present for node_complete.
                for m in (complete_n1, complete_n2, complete_n3):
                    meta = m.get("meta")
                    assert isinstance(meta, dict)
                    assert isinstance(meta.get("duration_ms"), (int, float))
                    assert meta.get("duration_ms") >= 0

                flow_complete = next(m for m in msgs if m.get("type") == "flow_complete")
                meta = flow_complete.get("meta")
                assert isinstance(meta, dict)
                assert isinstance(meta.get("duration_ms"), (int, float))
    finally:
        _flows.pop(flow_id, None)
