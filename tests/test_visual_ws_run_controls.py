"""WebSocket integration tests for run controls (pause/resume/cancel)."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_pause_and_resume_stops_progress_until_resumed() -> None:
    flow_id = "test-ws-run-controls-pause"

    visual = VisualFlow(
        id=flow_id,
        name="test ws controls pause/resume",
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
                id="delay",
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
            VisualNode(id="n2", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="delay", targetHandle="exec-in"),
            VisualEdge(id="e2", source="delay", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="d1", source="dur", sourceHandle="value", target="delay", targetHandle="duration"),
            VisualEdge(id="d2", source="msg", sourceHandle="value", target="n2", targetHandle="message"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                run_id: str | None = None
                started_at = time.perf_counter()
                while time.perf_counter() - started_at < 5.0:
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_start":
                        run_id = msg.get("runId")
                        break
                    if msg.get("type") == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")
                assert isinstance(run_id, str) and run_id

                ws.send_text(json.dumps({"type": "control", "action": "pause", "run_id": run_id}))
                paused_at = time.perf_counter()
                while time.perf_counter() - paused_at < 5.0:
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_paused":
                        break
                    if msg.get("type") == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")

                # Stay paused longer than the delay duration. The delay should not progress.
                time.sleep(0.35)

                resume_sent_at = time.perf_counter()
                ws.send_text(json.dumps({"type": "control", "action": "resume", "run_id": run_id}))

                saw_resumed = False
                done_at: float | None = None
                while time.perf_counter() - resume_sent_at < 5.0:
                    msg = ws.receive_json()
                    t = msg.get("type")
                    if t == "flow_resumed":
                        saw_resumed = True
                        continue
                    if t == "node_complete" and msg.get("nodeId") == "n2":
                        done_at = time.perf_counter()
                        break
                    if t == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")
                assert saw_resumed is True
                assert done_at is not None
                assert (done_at - resume_sent_at) >= 0.18

    finally:
        _flows.pop(flow_id, None)


def test_ws_cancel_stops_run() -> None:
    flow_id = "test-ws-run-controls-cancel"

    visual = VisualFlow(
        id=flow_id,
        name="test ws controls cancel",
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
                id="delay",
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
            VisualNode(id="n2", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="delay", targetHandle="exec-in"),
            VisualEdge(id="e2", source="delay", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="d1", source="dur", sourceHandle="value", target="delay", targetHandle="duration"),
            VisualEdge(id="d2", source="msg", sourceHandle="value", target="n2", targetHandle="message"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(json.dumps({"type": "run", "input_data": {}}))

                run_id: str | None = None
                started_at = time.perf_counter()
                while time.perf_counter() - started_at < 5.0:
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_start":
                        run_id = msg.get("runId")
                        break
                    if msg.get("type") == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")
                assert isinstance(run_id, str) and run_id

                ws.send_text(json.dumps({"type": "control", "action": "cancel", "run_id": run_id}))
                cancelled_at = time.perf_counter()
                while time.perf_counter() - cancelled_at < 5.0:
                    msg = ws.receive_json()
                    if msg.get("type") == "flow_cancelled":
                        break
                    if msg.get("type") == "flow_error":
                        raise AssertionError(f"flow_error: {msg.get('error')}")

                # Give enough time for a non-cancelled run to have completed.
                time.sleep(0.35)

                ws.send_text(json.dumps({"type": "ping"}))
                # Drain until pong; ensure no completion sneaked in.
                drained_at = time.perf_counter()
                while time.perf_counter() - drained_at < 5.0:
                    msg = ws.receive_json()
                    if msg.get("type") == "pong":
                        break
                    if msg.get("type") == "flow_complete":
                        raise AssertionError("cancelled run must not complete")
                    if msg.get("type") == "node_complete" and msg.get("nodeId") == "n2":
                        raise AssertionError("cancelled run must not complete")

    finally:
        _flows.pop(flow_id, None)
