"""Tests for workflow IO nodes (On Flow Start / On Flow End) and subflow IO mapping."""

from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_on_flow_start_params_and_on_flow_end_outputs() -> None:
    flow = VisualFlow(
        id="flow-io-basic",
        name="io basic",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    name = input.get('name')\n"
                        "    count = input.get('count')\n"
                        "    return {'greeting': str(name) + ':' + str(count), 'extra': 123}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "greeting", "label": "greeting", "type": "string"},
                    ],
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
                id="e2",
                source="code",
                sourceHandle="exec-out",
                target="end",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"name": "Alice", "count": 2}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"greeting": "Alice:2"}


def test_subflow_maps_entry_params_and_exposed_outputs() -> None:
    child_id = "child-flow-io"
    parent_id = "parent-flow-io"

    child = VisualFlow(
        id=child_id,
        name="child io",
        entryNode="c_start",
        nodes=[
            VisualNode(
                id="c_start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "question", "label": "question", "type": "string"},
                    ],
                },
            ),
            VisualNode(
                id="c_code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    q = input.get('question') or ''\n"
                        "    return {'answer': str(q).upper(), 'debug': True}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="c_end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "answer", "label": "answer", "type": "string"},
                    ],
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="ce1",
                source="c_start",
                sourceHandle="exec-out",
                target="c_code",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="ce2",
                source="c_code",
                sourceHandle="exec-out",
                target="c_end",
                targetHandle="exec-in",
            ),
        ],
    )

    parent = VisualFlow(
        id=parent_id,
        name="parent io",
        entryNode="p_start",
        nodes=[
            VisualNode(
                id="p_start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "question", "label": "question", "type": "string"},
                    ],
                },
            ),
            VisualNode(
                id="p_sub",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={
                    "subflowId": child_id,
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "question", "label": "question", "type": "string"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "answer", "label": "answer", "type": "string"},
                    ],
                },
            ),
            VisualNode(
                id="p_end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "answer", "label": "answer", "type": "string"},
                    ],
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="pe1",
                source="p_start",
                sourceHandle="exec-out",
                target="p_sub",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="pe2",
                source="p_sub",
                sourceHandle="exec-out",
                target="p_end",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="pd1",
                source="p_start",
                sourceHandle="question",
                target="p_sub",
                targetHandle="question",
            ),
            VisualEdge(
                id="pd2",
                source="p_sub",
                sourceHandle="answer",
                target="p_end",
                targetHandle="answer",
            ),
        ],
    )

    flows = {child_id: child, parent_id: parent}
    result = execute_visual_flow(parent, {"question": "hello"}, flows=flows)
    assert result["success"] is True
    assert result["result"] == {"answer": "HELLO"}


def test_on_flow_start_pin_defaults_used_when_vars_missing() -> None:
    """When a start parameter is missing from run.vars, pinDefaults should supply it."""
    flow = VisualFlow(
        id="flow-io-defaults",
        name="io defaults",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                    ],
                    "pinDefaults": {"name": "Alice"},
                },
            ),
            VisualNode(
                id="end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                    ],
                },
            ),
        ],
        edges=[
            VisualEdge(
                id="e1",
                source="start",
                sourceHandle="exec-out",
                target="end",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="d1",
                source="start",
                sourceHandle="name",
                target="end",
                targetHandle="name",
            ),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"name": "Alice"}
