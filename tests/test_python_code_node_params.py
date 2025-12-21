from __future__ import annotations

from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.services.executor import execute_visual_flow


def test_python_code_node_executes_with_multiple_params() -> None:
    flow = VisualFlow(
        id="flow-code-params",
        name="code params",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="a",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 2},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 3},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(_input):\n"
                        "    a = _input.get('a')\n"
                        "    b = _input.get('b')\n"
                        "    return {'sum': (a or 0) + (b or 0)}\n"
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
                source="a",
                sourceHandle="value",
                target="code",
                targetHandle="a",
            ),
            VisualEdge(
                id="d2",
                source="b",
                sourceHandle="value",
                target="code",
                targetHandle="b",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"sum": 5.0}

