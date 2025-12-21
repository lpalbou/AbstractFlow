from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_switch_routes_to_matching_case_or_default() -> None:
    flow = VisualFlow(
        id="flow-switch-basic",
        name="switch basic",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="sw",
                type=NodeType.SWITCH,
                position=Position(x=0, y=0),
                data={
                    "switchConfig": {
                        "cases": [
                            {"id": "a", "value": "alpha"},
                            {"id": "b", "value": "beta"},
                        ]
                    }
                },
            ),
            VisualNode(
                id="A",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'picked': 'A'}\n",
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="B",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'picked': 'B'}\n",
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="D",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'picked': 'default'}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="sw",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="ea",
                source="sw",
                sourceHandle="case:a",
                target="A",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="eb",
                source="sw",
                sourceHandle="case:b",
                target="B",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="ed",
                source="sw",
                sourceHandle="default",
                target="D",
                targetHandle="exec-in",
            ),
        ],
    )

    flows = {flow.id: flow}
    result_a = execute_visual_flow(flow, {"value": "alpha"}, flows=flows)
    assert result_a["success"] is True
    assert result_a["result"] == {"picked": "A"}

    result_default = execute_visual_flow(flow, {"value": "zzz"}, flows=flows)
    assert result_default["success"] is True
    assert result_default["result"] == {"picked": "default"}


def test_switch_default_unconnected_completes_cleanly() -> None:
    flow = VisualFlow(
        id="flow-switch-no-default",
        name="switch no default",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="sw",
                type=NodeType.SWITCH,
                position=Position(x=0, y=0),
                data={
                    "switchConfig": {
                        "cases": [
                            {"id": "a", "value": "alpha"},
                        ]
                    }
                },
            ),
            VisualNode(
                id="A",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'picked': 'A'}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="sw",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="ea",
                source="sw",
                sourceHandle="case:a",
                target="A",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"value": "nope"}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"]["branch"] == "default"
