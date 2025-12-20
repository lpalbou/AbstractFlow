"""Tests for pure (no-exec) data nodes in the visual runner."""

from __future__ import annotations

from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.services.executor import create_visual_runner


def test_visual_pure_builtin_node_evaluates_via_data_edges() -> None:
    """Regression: pure builtin nodes (e.g., Add) must work without exec wiring."""
    flow_id = "test-visual-pure-add"
    visual = VisualFlow(
        id=flow_id,
        name="pure add",
        entryNode="code",
        nodes=[
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
                id="add",
                type=NodeType.ADD,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('input')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="a", sourceHandle="value", target="add", targetHandle="a"),
            VisualEdge(id="d2", source="b", sourceHandle="value", target="add", targetHandle="b"),
            VisualEdge(id="d3", source="add", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == 5.0


def test_visual_break_object_extracts_nested_fields() -> None:
    flow_id = "test-visual-break-object"
    visual = VisualFlow(
        id=flow_id,
        name="break object",
        entryNode="code",
        nodes=[
            VisualNode(
                id="payload",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {"task": "hello", "usage": {"total_tokens": 123}}},
            ),
            VisualNode(
                id="break",
                type=NodeType.BREAK_OBJECT,
                position=Position(x=0, y=0),
                data={"breakConfig": {"selectedPaths": ["task", "usage.total_tokens"]}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'task': input.get('task'), 'total': input.get('total')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="payload", sourceHandle="value", target="break", targetHandle="object"),
            VisualEdge(id="d2", source="break", sourceHandle="task", target="code", targetHandle="task"),
            VisualEdge(
                id="d3",
                source="break",
                sourceHandle="usage.total_tokens",
                target="code",
                targetHandle="total",
            ),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"task": "hello", "total": 123}

