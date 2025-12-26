from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


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


def test_python_code_node_supports_top_level_helpers() -> None:
    flow = VisualFlow(
        id="flow-code-helpers",
        name="code helpers",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="v",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 41},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def _plus_one(x):\n"
                        "    return (x or 0) + 1\n"
                        "\n"
                        "def transform(_input):\n"
                        "    v = _input.get('v')\n"
                        "    return {'v': _plus_one(v)}\n"
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
                source="v",
                sourceHandle="value",
                target="code",
                targetHandle="v",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"v": 42.0}
