from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_stringify_json_beautify_default() -> None:
    flow_id = "test-visual-stringify-json-beautify"
    visual = VisualFlow(
        id=flow_id,
        name="stringify json (beautify)",
        entryNode="code",
        nodes=[
            VisualNode(
                id="obj",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {"a": 1, "b": [2, 3]}},
            ),
            VisualNode(
                id="stringify",
                type=NodeType.STRINGIFY_JSON,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('s')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="obj", sourceHandle="value", target="stringify", targetHandle="value"),
            VisualEdge(id="d2", source="stringify", sourceHandle="result", target="code", targetHandle="s"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    out = result.get("result")
    assert isinstance(out, str)
    assert "\n" in out
    assert '"a": 1' in out


def test_stringify_json_minified_mode_via_pin_defaults() -> None:
    flow_id = "test-visual-stringify-json-minified"
    visual = VisualFlow(
        id=flow_id,
        name="stringify json (minified)",
        entryNode="code",
        nodes=[
            VisualNode(
                id="obj",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {"a": 1, "b": [2, 3]}},
            ),
            VisualNode(
                id="stringify",
                type=NodeType.STRINGIFY_JSON,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"mode": "minified"}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('s')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="obj", sourceHandle="value", target="stringify", targetHandle="value"),
            VisualEdge(id="d2", source="stringify", sourceHandle="result", target="code", targetHandle="s"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == '{"a":1,"b":[2,3]}'


def test_stringify_json_parses_jsonish_strings() -> None:
    flow_id = "test-visual-stringify-json-parses-string"
    visual = VisualFlow(
        id=flow_id,
        name="stringify json (parse json-ish string)",
        entryNode="code",
        nodes=[
            VisualNode(
                id="text",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "```json\n{'a': 1}\n```"},
            ),
            VisualNode(
                id="stringify",
                type=NodeType.STRINGIFY_JSON,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"mode": "beautify"}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('s')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="text", sourceHandle="value", target="stringify", targetHandle="value"),
            VisualEdge(id="d2", source="stringify", sourceHandle="result", target="code", targetHandle="s"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    out = result.get("result")
    assert isinstance(out, str)
    assert out.lstrip().startswith("{")
    assert '"a": 1' in out


