from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_parse_json_enables_break_object_field_extraction() -> None:
    flow_id = "test-visual-parse-json-break"
    visual = VisualFlow(
        id=flow_id,
        name="parse json → break object",
        entryNode="code",
        nodes=[
            VisualNode(
                id="text",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": '{"a": 1, "b": {"c": "x"}}'},
            ),
            VisualNode(
                id="parse",
                type=NodeType.PARSE_JSON,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="break",
                type=NodeType.BREAK_OBJECT,
                position=Position(x=0, y=0),
                data={"breakConfig": {"selectedPaths": ["a", "b.c"]}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'a': input.get('a'), 'c': input.get('c')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="text", sourceHandle="value", target="parse", targetHandle="text"),
            VisualEdge(id="d2", source="parse", sourceHandle="result", target="break", targetHandle="object"),
            VisualEdge(id="d3", source="break", sourceHandle="a", target="code", targetHandle="a"),
            VisualEdge(id="d4", source="break", sourceHandle="b.c", target="code", targetHandle="c"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"a": 1, "c": "x"}


def test_parse_json_accepts_json_code_fences() -> None:
    flow_id = "test-visual-parse-json-fence"
    visual = VisualFlow(
        id=flow_id,
        name="parse json fence",
        entryNode="code",
        nodes=[
            VisualNode(
                id="text",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": '```json\n{"a": 1}\n```'},
            ),
            VisualNode(id="parse", type=NodeType.PARSE_JSON, position=Position(x=0, y=0), data={}),
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
            VisualEdge(id="d1", source="text", sourceHandle="value", target="parse", targetHandle="text"),
            VisualEdge(id="d2", source="parse", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"a": 1}


