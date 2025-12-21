from __future__ import annotations

from datetime import datetime

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_system_datetime_node_outputs_stable_keys() -> None:
    flow = VisualFlow(
        id="flow-system-datetime",
        name="system datetime",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="dt",
                type=NodeType.SYSTEM_DATETIME,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {\n"
                        "        'iso': input.get('iso'),\n"
                        "        'timezone': input.get('timezone'),\n"
                        "        'utc_offset_minutes': input.get('utc_offset_minutes'),\n"
                        "        'locale': input.get('locale'),\n"
                        "    }\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="dt",
                sourceHandle="iso",
                target="code",
                targetHandle="iso",
            ),
            VisualEdge(
                id="d2",
                source="dt",
                sourceHandle="timezone",
                target="code",
                targetHandle="timezone",
            ),
            VisualEdge(
                id="d3",
                source="dt",
                sourceHandle="utc_offset_minutes",
                target="code",
                targetHandle="utc_offset_minutes",
            ),
            VisualEdge(
                id="d4",
                source="dt",
                sourceHandle="locale",
                target="code",
                targetHandle="locale",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    out = result["result"]
    assert isinstance(out, dict)
    assert isinstance(out.get("iso"), str)
    assert isinstance(out.get("timezone"), str)
    assert isinstance(out.get("utc_offset_minutes"), (int, float))
    assert isinstance(out.get("locale"), str)

    # Should be parseable ISO-8601 (best-effort; timezone may be included).
    datetime.fromisoformat(out["iso"])
