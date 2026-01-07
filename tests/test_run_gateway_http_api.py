from __future__ import annotations

import time

from fastapi.testclient import TestClient

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def _wait_until(fn, *, timeout_s: float = 5.0, poll_s: float = 0.05):
    t0 = time.time()
    last = None
    while (time.time() - t0) < timeout_s:
        last = fn()
        if last:
            return last
        time.sleep(poll_s)
    return None


def test_gateway_http_start_resume_and_ledger_replay() -> None:
    flow_id = "test-gateway-http-ask-user"

    visual = VisualFlow(
        id=flow_id,
        name="test gateway http ask_user",
        entryNode="n1",
        nodes=[
            VisualNode(id="n1", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(id="prompt", type=NodeType.LITERAL_STRING, position=Position(x=0, y=0), data={"literalValue": "Pick:"}),
            VisualNode(
                id="choices",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["alpha", "beta"]},
            ),
            VisualNode(id="ask", type=NodeType.ASK_USER, position=Position(x=0, y=0), data={"effectConfig": {"allowFreeText": False}}),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={"code": "def transform(input):\n    return {'final': input.get('input')}\n", "functionName": "transform"},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="ask", targetHandle="exec-in"),
            VisualEdge(id="e2", source="ask", sourceHandle="exec-out", target="code", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="ask", targetHandle="prompt"),
            VisualEdge(id="d2", source="choices", sourceHandle="value", target="ask", targetHandle="choices"),
            VisualEdge(id="d3", source="ask", sourceHandle="response", target="code", targetHandle="input"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            # Start run
            r = client.post("/api/gateway/runs/start", json={"flow_id": flow_id, "input_data": {}})
            assert r.status_code == 200
            run_id = r.json().get("run_id")
            assert isinstance(run_id, str) and run_id

            # Wait until it's waiting for user
            def _get_wait():
                rr = client.get(f"/api/gateway/runs/{run_id}")
                if rr.status_code != 200:
                    return None
                st = rr.json()
                if st.get("status") != "waiting":
                    return None
                waiting = st.get("waiting") or {}
                if waiting.get("reason") != "user":
                    return None
                wk = waiting.get("wait_key")
                if not isinstance(wk, str) or not wk:
                    return None
                return wk

            wait_key = _wait_until(_get_wait)
            assert isinstance(wait_key, str) and wait_key

            # Resume via durable command
            cmd = client.post(
                "/api/gateway/commands",
                json={
                    "command_id": "cmd-http-resume-1",
                    "run_id": run_id,
                    "type": "resume",
                    "payload": {"wait_key": wait_key, "payload": {"response": "alpha"}},
                },
            )
            assert cmd.status_code == 200
            assert cmd.json().get("accepted") is True

            def _completed():
                rr = client.get(f"/api/gateway/runs/{run_id}")
                if rr.status_code != 200:
                    return None
                st = rr.json()
                return st if st.get("status") == "completed" else None

            st_done = _wait_until(_completed)
            assert st_done is not None

            # Ledger replay by cursor
            ledger1 = client.get(f"/api/gateway/runs/{run_id}/ledger?after=0&limit=10")
            assert ledger1.status_code == 200
            body = ledger1.json()
            items = body.get("items")
            assert isinstance(items, list) and len(items) >= 1
            next_after = body.get("next_after")
            assert isinstance(next_after, int) and next_after >= 1

            ledger2 = client.get(f"/api/gateway/runs/{run_id}/ledger?after={next_after}&limit=10")
            assert ledger2.status_code == 200
            body2 = ledger2.json()
            assert body2.get("items") == []
    finally:
        _flows.pop(flow_id, None)


