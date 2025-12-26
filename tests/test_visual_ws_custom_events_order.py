"""WS regression test: custom event listeners should not appear as RUNNING before fired.

Historically, the WS runner would emit `node_start` for listener runs that were
WAITING on an EVENT, making `On Event` look like it executed immediately on
flow start. It could also re-emit node_start/node_complete for terminal runs
while keeping the socket open to drive child runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import anyio

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


@dataclass
class _CapturingWebSocket:
    sent: list[dict]

    async def send_json(self, data: Any) -> None:  # matches FastAPI WebSocket API
        assert isinstance(data, dict)
        self.sent.append(data)


def test_ws_custom_event_listener_is_silent_until_emit_event() -> None:
    import web.backend.routes.ws as ws_routes

    flow_id = "test-ws-custom-events-order"
    visual = VisualFlow(
        id=flow_id,
        name="ws custom event order",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="dur",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 0.1},
            ),
            VisualNode(
                id="delay",
                type=NodeType.WAIT_UNTIL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"durationType": "seconds"}},
            ),
            VisualNode(
                id="emit",
                type=NodeType.EMIT_EVENT,
                position=Position(x=0, y=0),
                data={"effectConfig": {"name": "evt1", "scope": "session"}},
            ),
            VisualNode(
                id="on_evt",
                type=NodeType.ON_EVENT,
                position=Position(x=0, y=0),
                data={"eventConfig": {"name": "evt1", "scope": "session"}},
            ),
            VisualNode(
                id="msg",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "event fired"},
            ),
            VisualNode(id="answer", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="delay", targetHandle="exec-in"),
            VisualEdge(id="e2", source="delay", sourceHandle="exec-out", target="emit", targetHandle="exec-in"),
            VisualEdge(id="d1", source="dur", sourceHandle="value", target="delay", targetHandle="duration"),
            VisualEdge(id="e3", source="on_evt", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d2", source="msg", sourceHandle="value", target="answer", targetHandle="message"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    runner.start({})

    ws = _CapturingWebSocket(sent=[])

    async def _drive() -> None:
        with anyio.fail_after(3.0):
            await ws_routes._execute_runner_loop(ws, runner, "conn_custom_event_order")  # type: ignore[arg-type]

    anyio.run(_drive)

    node_events = [
        (m.get("type"), m.get("nodeId"))
        for m in ws.sent
        if m.get("type") in {"node_start", "node_complete"}
    ]

    assert node_events == [
        ("node_start", "start"),
        ("node_complete", "start"),
        ("node_start", "delay"),
        ("node_complete", "delay"),
        ("node_start", "emit"),
        ("node_complete", "emit"),
        ("node_start", "on_evt"),
        ("node_complete", "on_evt"),
        ("node_start", "answer"),
        ("node_complete", "answer"),
    ]

