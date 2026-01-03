"""WebSocket integration tests for Subflow nodes (START_SUBWORKFLOW).

These tests validate that:
- a parent visual flow can execute a saved child flow as a subworkflow
- waiting in the child (ASK_USER) bubbles up to the parent and can be resumed
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_subflow_runs_child_and_returns_output() -> None:
    child_id = "child-flow-basic"
    parent_id = "parent-flow-basic"

    child = VisualFlow(
        id=child_id,
        name="child basic",
        entryNode="c1",
        nodes=[
            VisualNode(
                id="c1",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'child': 7}\n",
                    "functionName": "transform",
                },
            )
        ],
        edges=[],
    )

    parent = VisualFlow(
        id=parent_id,
        name="parent basic",
        entryNode="p1",
        nodes=[
            VisualNode(
                id="p1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="p2",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={"subflowId": child_id},
            ),
            VisualNode(
                id="p3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'from_child': input.get('input')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="p1",
                sourceHandle="exec-out",
                target="p2",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="p2",
                sourceHandle="exec-out",
                target="p3",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="p2",
                sourceHandle="output",
                target="p3",
                targetHandle="input",
            ),
        ],
    )

    _flows[child_id] = child
    _flows[parent_id] = parent
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{parent_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                completed = None
                for _ in range(200):
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_complete":
                        completed = msg
                        break

                assert completed is not None
                assert completed["result"]["success"] is True
                assert completed["result"]["result"]["from_child"] == {"child": 7}
    finally:
        _flows.pop(child_id, None)
        _flows.pop(parent_id, None)


def test_ws_subflow_child_ask_user_waits_then_resume_completes() -> None:
    child_id = "child-flow-ask"
    parent_id = "parent-flow-ask"

    child = VisualFlow(
        id=child_id,
        name="child ask_user",
        entryNode="c1",
        nodes=[
            VisualNode(
                id="c1",
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
                id="c2",
                type=NodeType.ASK_USER,
                position=Position(x=0, y=0),
                data={"effectConfig": {"allowFreeText": False}},
            ),
            VisualNode(
                id="c3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'answer': input.get('input')}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="c1",
                sourceHandle="exec-out",
                target="c2",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="c2",
                sourceHandle="exec-out",
                target="c3",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="prompt",
                sourceHandle="value",
                target="c2",
                targetHandle="prompt",
            ),
            VisualEdge(
                id="d2",
                source="choices",
                sourceHandle="value",
                target="c2",
                targetHandle="choices",
            ),
            VisualEdge(
                id="d3",
                source="c2",
                sourceHandle="response",
                target="c3",
                targetHandle="input",
            ),
        ],
    )

    parent = VisualFlow(
        id=parent_id,
        name="parent asks via child",
        entryNode="p1",
        nodes=[
            VisualNode(
                id="p1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="p2",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={"subflowId": child_id},
            ),
            VisualNode(
                id="p3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'child_answer': input.get('input')}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="p1",
                sourceHandle="exec-out",
                target="p2",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="p2",
                sourceHandle="exec-out",
                target="p3",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="p2",
                sourceHandle="output",
                target="p3",
                targetHandle="input",
            ),
        ],
    )

    _flows[child_id] = child
    _flows[parent_id] = parent
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{parent_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                waiting = None
                for _ in range(200):
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_waiting":
                        waiting = msg
                        break

                assert waiting is not None
                assert waiting["nodeId"] == "p2"
                assert waiting["prompt"] == "Pick one:"
                assert waiting["choices"] == ["alpha", "beta"]
                assert waiting["allow_free_text"] is False

                ws.send_text(json.dumps({"type": "resume", "response": "beta"}))

                subflow_complete = None
                completed = None
                for _ in range(400):
                    msg = ws.receive_json()
                    if msg.get("type") == "node_complete" and msg.get("nodeId") == "p2":
                        subflow_complete = msg
                    if msg.get("type") == "flow_complete":
                        completed = msg
                        break

                assert subflow_complete is not None
                assert isinstance(subflow_complete.get("result"), dict)
                assert subflow_complete["result"].get("output") == {"answer": "beta"}
                assert isinstance(subflow_complete.get("meta"), dict)
                assert isinstance(subflow_complete["meta"].get("duration_ms"), (int, float))

                assert completed is not None
                assert completed["result"]["success"] is True
                assert completed["result"]["result"]["child_answer"] == {"answer": "beta"}
    finally:
        _flows.pop(child_id, None)
        _flows.pop(parent_id, None)


def test_ws_subflow_can_inherit_parent_context_messages_when_configured() -> None:
    child_id = "child-flow-inherit-context"
    parent_id = "parent-flow-inherit-context"

    child = VisualFlow(
        id=child_id,
        name="child inherit context",
        entryNode="c1",
        nodes=[
            VisualNode(
                id="c1",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputKey": "context",
                    "code": (
                        "def transform(input):\n"
                        "    msgs = input.get('messages') if isinstance(input, dict) else []\n"
                        "    if not isinstance(msgs, list):\n"
                        "        return {'inherited': False}\n"
                        "    for m in msgs:\n"
                        "        if not isinstance(m, dict):\n"
                        "            continue\n"
                        "        if str(m.get('content') or '') == 'PARENT_CTX':\n"
                        "            return {'inherited': True}\n"
                        "    return {'inherited': False}\n"
                    ),
                    "functionName": "transform",
                },
            )
        ],
        edges=[],
    )

    parent = VisualFlow(
        id=parent_id,
        name="parent inherit context",
        entryNode="p1",
        nodes=[
            VisualNode(
                id="p1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="p2",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={"subflowId": child_id, "effectConfig": {"inherit_context": True}},
            ),
            VisualNode(
                id="p3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    out = input.get('input') if isinstance(input, dict) else None\n"
                        "    return {'inherited': (out or {}).get('inherited') if isinstance(out, dict) else False}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="p1", sourceHandle="exec-out", target="p2", targetHandle="exec-in"),
            VisualEdge(id="e2", source="p2", sourceHandle="exec-out", target="p3", targetHandle="exec-in"),
            VisualEdge(id="d1", source="p2", sourceHandle="output", target="p3", targetHandle="input"),
        ],
    )

    _flows[child_id] = child
    _flows[parent_id] = parent
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{parent_id}") as ws:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "run",
                            "input_data": {
                                "context": {"messages": [{"role": "system", "content": "PARENT_CTX"}]},
                            },
                        }
                    )
                )

                completed = None
                for _ in range(200):
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_complete":
                        completed = msg
                        break

                assert completed is not None
                assert completed["result"]["success"] is True
                assert completed["result"]["result"]["inherited"] is True
    finally:
        _flows.pop(child_id, None)
        _flows.pop(parent_id, None)
