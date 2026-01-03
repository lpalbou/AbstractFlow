"""WebSocket integration tests for MEMORY_* visual effect nodes (no mocks)."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient
import pytest

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_memory_note_and_query_work_with_in_memory_artifacts() -> None:
    flow_id = "test-ws-memory-effects"

    visual = VisualFlow(
        id=flow_id,
        name="test ws memory effects",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="note",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "hello memory"},
            ),
            VisualNode(
                id="n2",
                type=NodeType.MEMORY_NOTE,
                position=Position(x=0, y=0),
                data={"outputKey": "data.note_id", "effectConfig": {"keep_in_context": True}},
            ),
            VisualNode(
                id="ctx_check",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputKey": "context",
                    "outputKey": "data.has_memory_in_context",
                    "code": (
                        "def transform(input):\n"
                        "    msgs = input.get('messages') if isinstance(input, dict) else []\n"
                        "    if not isinstance(msgs, list):\n"
                        "        return False\n"
                        "    for m in msgs:\n"
                        "        if not isinstance(m, dict):\n"
                        "            continue\n"
                        "        if 'hello memory' in str(m.get('content') or ''):\n"
                        "            return True\n"
                        "    return False\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="query",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": ""},
            ),
            VisualNode(
                id="limit",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 3},
            ),
            VisualNode(
                id="n3",
                type=NodeType.MEMORY_QUERY,
                position=Position(x=0, y=0),
                data={"outputKey": "data.results"},
            ),
            VisualNode(
                id="n4",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputKey": "data",
                    "code": (
                        "def transform(input):\n"
                        "    note_id = input.get('note_id')\n"
                        "    results = input.get('results') or []\n"
                        "    has_memory = bool(input.get('has_memory_in_context'))\n"
                        "    return {'note_id': note_id, 'results_len': len(results), 'has_memory_in_context': has_memory}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="e2", source="n2", sourceHandle="exec-out", target="ctx_check", targetHandle="exec-in"),
            VisualEdge(id="e2b", source="ctx_check", sourceHandle="exec-out", target="n3", targetHandle="exec-in"),
            VisualEdge(id="e3", source="n3", sourceHandle="exec-out", target="n4", targetHandle="exec-in"),
            VisualEdge(id="d1", source="note", sourceHandle="value", target="n2", targetHandle="content"),
            VisualEdge(id="d2", source="query", sourceHandle="value", target="n3", targetHandle="query"),
            VisualEdge(id="d3", source="limit", sourceHandle="value", target="n3", targetHandle="limit"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                completed = None
                for _ in range(400):
                    msg = ws.receive_json()
                    t = msg.get("type")
                    if t == "flow_complete":
                        completed = msg
                        break
                    if t == "flow_error":
                        pytest.fail(f"flow_error: {msg.get('error')}")
                    if t == "flow_waiting":
                        pytest.fail(
                            f"flow_waiting: reason={msg.get('reason')} wait_key={msg.get('wait_key')} prompt={msg.get('prompt')}"
                        )

                assert completed is not None
                assert completed["result"]["success"] is True
                output = completed["result"]["result"]
                assert isinstance(output, dict)
                assert isinstance(output.get("note_id"), str)
                assert output["note_id"]
                assert isinstance(output.get("results_len"), int)
                assert output["results_len"] >= 1
                assert output.get("has_memory_in_context") is True
    finally:
        _flows.pop(flow_id, None)

