"""Tests for pure (no-exec) data nodes in the visual runner."""

from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


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


def test_visual_break_object_parses_json_string_inputs() -> None:
    """Break Object should tolerate JSON-ish strings (common LLM outputs) by parsing best-effort."""
    flow_id = "test-visual-break-object-json-string"
    visual = VisualFlow(
        id=flow_id,
        name="break object json string",
        entryNode="code",
        nodes=[
            VisualNode(
                id="payload",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": '{"enriched_request":"hello","tasks":["a","b"]}'},
            ),
            VisualNode(
                id="break",
                type=NodeType.BREAK_OBJECT,
                position=Position(x=0, y=0),
                data={"breakConfig": {"selectedPaths": ["enriched_request", "tasks"]}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'req': input.get('req'), 'tasks': input.get('tasks')}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="payload", sourceHandle="value", target="break", targetHandle="object"),
            VisualEdge(
                id="d2",
                source="break",
                sourceHandle="enriched_request",
                target="code",
                targetHandle="req",
            ),
            VisualEdge(id="d3", source="break", sourceHandle="tasks", target="code", targetHandle="tasks"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"req": "hello", "tasks": ["a", "b"]}


def test_visual_concat_supports_dynamic_inputs_and_separator() -> None:
    flow_id = "test-visual-concat-dynamic"
    visual = VisualFlow(
        id=flow_id,
        name="concat dynamic",
        entryNode="code",
        nodes=[
            VisualNode(
                id="a",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "hello"},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "world"},
            ),
            VisualNode(
                id="c",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "!"},
            ),
            VisualNode(
                id="concat",
                type=NodeType.CONCAT,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "a", "label": "a", "type": "string"},
                        {"id": "b", "label": "b", "type": "string"},
                        {"id": "c", "label": "c", "type": "string"},
                    ],
                    "outputs": [{"id": "result", "label": "result", "type": "string"}],
                    "concatConfig": {"separator": " | "},
                },
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
            VisualEdge(id="d1", source="a", sourceHandle="value", target="concat", targetHandle="a"),
            VisualEdge(id="d2", source="b", sourceHandle="value", target="concat", targetHandle="b"),
            VisualEdge(id="d3", source="c", sourceHandle="value", target="concat", targetHandle="c"),
            VisualEdge(id="d4", source="concat", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == "hello | world | !"


def test_visual_array_concat_flattens_arrays_in_pin_order() -> None:
    flow_id = "test-visual-array-concat"
    visual = VisualFlow(
        id=flow_id,
        name="array concat",
        entryNode="code",
        nodes=[
            VisualNode(
                id="a",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["hello"]},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["world", "!"]},
            ),
            VisualNode(
                id="c",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": []},
            ),
            VisualNode(
                id="concat",
                type=NodeType.ARRAY_CONCAT,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "a", "label": "a", "type": "array"},
                        {"id": "b", "label": "b", "type": "array"},
                        {"id": "c", "label": "c", "type": "array"},
                    ],
                    "outputs": [{"id": "result", "label": "result", "type": "array"}],
                },
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
            VisualEdge(id="d1", source="a", sourceHandle="value", target="concat", targetHandle="a"),
            VisualEdge(id="d2", source="b", sourceHandle="value", target="concat", targetHandle="b"),
            VisualEdge(id="d3", source="c", sourceHandle="value", target="concat", targetHandle="c"),
            VisualEdge(id="d4", source="concat", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == ["hello", "world", "!"]


def test_visual_make_array_collects_values_in_pin_order_and_skips_null() -> None:
    flow_id = "test-visual-make-array"
    visual = VisualFlow(
        id=flow_id,
        name="make array",
        entryNode="code",
        nodes=[
            VisualNode(
                id="a",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "hello"},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": None},
            ),
            VisualNode(
                id="c",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "world"},
            ),
            VisualNode(
                id="make",
                type=NodeType.MAKE_ARRAY,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "a", "label": "a", "type": "any"},
                        {"id": "b", "label": "b", "type": "any"},
                        {"id": "c", "label": "c", "type": "any"},
                    ],
                    "outputs": [{"id": "result", "label": "result", "type": "array"}],
                },
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
            VisualEdge(id="d1", source="a", sourceHandle="value", target="make", targetHandle="a"),
            VisualEdge(id="d2", source="b", sourceHandle="value", target="make", targetHandle="b"),
            VisualEdge(id="d3", source="c", sourceHandle="value", target="make", targetHandle="c"),
            VisualEdge(id="d4", source="make", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == ["hello", "world"]


def test_visual_get_property_supports_default_value() -> None:
    flow_id = "test-visual-get-default"
    visual = VisualFlow(
        id=flow_id,
        name="get default",
        entryNode="code",
        nodes=[
            VisualNode(
                id="obj",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {}},
            ),
            VisualNode(
                id="fallback",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "fallback"},
            ),
            VisualNode(
                id="get",
                type=NodeType.GET,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"key": "missing"}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('value')\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="obj", sourceHandle="value", target="get", targetHandle="object"),
            VisualEdge(id="d2", source="fallback", sourceHandle="value", target="get", targetHandle="default"),
            VisualEdge(id="d3", source="get", sourceHandle="value", target="code", targetHandle="value"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == "fallback"


def test_visual_coalesce_returns_first_non_none_in_pin_order() -> None:
    flow_id = "test-visual-coalesce"
    visual = VisualFlow(
        id=flow_id,
        name="coalesce",
        entryNode="code",
        nodes=[
            VisualNode(
                id="obj",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {}},
            ),
            VisualNode(
                id="get",
                type=NodeType.GET,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"key": "missing"}},
            ),
            VisualNode(
                id="fallback",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "fallback"},
            ),
            VisualNode(
                id="coalesce",
                type=NodeType.COALESCE,
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
            VisualEdge(id="d1", source="obj", sourceHandle="value", target="get", targetHandle="object"),
            VisualEdge(id="d2", source="get", sourceHandle="value", target="coalesce", targetHandle="a"),
            VisualEdge(id="d3", source="fallback", sourceHandle="value", target="coalesce", targetHandle="b"),
            VisualEdge(id="d4", source="coalesce", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == "fallback"


def test_visual_string_template_renders_paths_and_filters() -> None:
    flow_id = "test-visual-string-template"
    visual = VisualFlow(
        id=flow_id,
        name="string template",
        entryNode="code",
        nodes=[
            VisualNode(
                id="tpl",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={
                    "literalValue": "Hello {{ user.name | trim }} age={{user.age}} tags={{tags|join(\", \")}} json={{user|json}} missing={{missing}}",
                },
            ),
            VisualNode(
                id="vars",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {"user": {"name": " Alice ", "age": 30}, "tags": ["a", "b"]}},
            ),
            VisualNode(
                id="render",
                type=NodeType.STRING_TEMPLATE,
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
            VisualEdge(id="d1", source="tpl", sourceHandle="value", target="render", targetHandle="template"),
            VisualEdge(id="d2", source="vars", sourceHandle="value", target="render", targetHandle="vars"),
            VisualEdge(id="d3", source="render", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == 'Hello Alice age=30 tags=a, b json={"age": 30, "name": " Alice "} missing='


def test_visual_array_helpers_length_append_dedup() -> None:
    flow_id = "test-visual-array-helpers"
    visual = VisualFlow(
        id=flow_id,
        name="array helpers",
        entryNode="code",
        nodes=[
            VisualNode(
                id="arr",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": [1, 1, 2, 1, 3]},
            ),
            VisualNode(
                id="dedup",
                type=NodeType.ARRAY_DEDUP,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="append_item",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 4},
            ),
            VisualNode(
                id="append",
                type=NodeType.ARRAY_APPEND,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="len",
                type=NodeType.ARRAY_LENGTH,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'dedup': input.get('dedup'), 'len': input.get('len')}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="d1", source="arr", sourceHandle="value", target="dedup", targetHandle="array"),
            VisualEdge(id="d2", source="dedup", sourceHandle="result", target="append", targetHandle="array"),
            VisualEdge(id="d3", source="append_item", sourceHandle="value", target="append", targetHandle="item"),
            VisualEdge(id="d4", source="append", sourceHandle="result", target="len", targetHandle="array"),
            VisualEdge(id="d5", source="append", sourceHandle="result", target="code", targetHandle="dedup"),
            VisualEdge(id="d6", source="len", sourceHandle="result", target="code", targetHandle="len"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"dedup": [1, 2, 3, 4.0], "len": 4}


def test_visual_array_dedup_by_key_path() -> None:
    flow_id = "test-visual-array-dedup-key"
    visual = VisualFlow(
        id=flow_id,
        name="array dedup by key",
        entryNode="code",
        nodes=[
            VisualNode(
                id="arr",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": [{"id": "a"}, {"id": "a"}, {"id": "b"}]},
            ),
            VisualNode(
                id="dedup",
                type=NodeType.ARRAY_DEDUP,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"key": "id"}},
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
            VisualEdge(id="d1", source="arr", sourceHandle="value", target="dedup", targetHandle="array"),
            VisualEdge(id="d2", source="dedup", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == [{"id": "a"}, {"id": "b"}]


def test_visual_data_pin_fanout_from_single_output() -> None:
    """Regression: a single data output can feed multiple downstream nodes (1:N)."""
    flow_id = "test-visual-data-fanout"
    visual = VisualFlow(
        id=flow_id,
        name="data fanout",
        entryNode="code",
        nodes=[
            VisualNode(
                id="n",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 2},
            ),
            VisualNode(
                id="one",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 1},
            ),
            VisualNode(
                id="ten",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 10},
            ),
            VisualNode(
                id="add1",
                type=NodeType.ADD,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="add2",
                type=NodeType.ADD,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="base",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {}},
            ),
            VisualNode(
                id="k1",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "first"},
            ),
            VisualNode(
                id="k2",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "second"},
            ),
            VisualNode(
                id="set1",
                type=NodeType.SET,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="set2",
                type=NodeType.SET,
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
            # Fan-out: n.value is used by multiple downstream nodes.
            VisualEdge(id="d1", source="n", sourceHandle="value", target="add1", targetHandle="a"),
            VisualEdge(id="d2", source="one", sourceHandle="value", target="add1", targetHandle="b"),
            VisualEdge(id="d3", source="n", sourceHandle="value", target="add2", targetHandle="a"),
            VisualEdge(id="d4", source="ten", sourceHandle="value", target="add2", targetHandle="b"),
            # Build output object with both results.
            VisualEdge(id="d5", source="base", sourceHandle="value", target="set1", targetHandle="object"),
            VisualEdge(id="d6", source="k1", sourceHandle="value", target="set1", targetHandle="key"),
            VisualEdge(id="d7", source="add1", sourceHandle="result", target="set1", targetHandle="value"),
            VisualEdge(id="d8", source="set1", sourceHandle="result", target="set2", targetHandle="object"),
            VisualEdge(id="d9", source="k2", sourceHandle="value", target="set2", targetHandle="key"),
            VisualEdge(id="d10", source="add2", sourceHandle="result", target="set2", targetHandle="value"),
            VisualEdge(id="d11", source="set2", sourceHandle="result", target="code", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result.get("result") == {"first": 3.0, "second": 12.0}
