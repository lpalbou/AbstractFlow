"""Visual runner branching tests (If/Else)."""

from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def _make_if_flow(flow_id: str, condition_value: bool) -> VisualFlow:
    return VisualFlow(
        id=flow_id,
        name="if branching",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="cond",
                type=NodeType.LITERAL_BOOLEAN,
                position=Position(x=0, y=0),
                data={"literalValue": condition_value},
            ),
            VisualNode(
                id="if",
                type=NodeType.IF,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="true_node",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'path': 'true'}\n",
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="false_node",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'path': 'false'}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="if", targetHandle="exec-in"),
            VisualEdge(id="d1", source="cond", sourceHandle="value", target="if", targetHandle="condition"),
            VisualEdge(id="e2", source="if", sourceHandle="true", target="true_node", targetHandle="exec-in"),
            VisualEdge(id="e3", source="if", sourceHandle="false", target="false_node", targetHandle="exec-in"),
        ],
    )


def test_visual_if_branching_true_path() -> None:
    flow_id = "test-visual-if-true"
    visual = _make_if_flow(flow_id, True)
    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({"message": "hi", "context": {}})
    assert result.get("success") is True
    assert result.get("result") == {"path": "true"}


def test_visual_if_branching_false_path() -> None:
    flow_id = "test-visual-if-false"
    visual = _make_if_flow(flow_id, False)
    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({"message": "hi", "context": {}})
    assert result.get("success") is True
    assert result.get("result") == {"path": "false"}
