from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_sequence_executes_then_branches_in_order() -> None:
    flow = VisualFlow(
        id="flow-sequence-basic",
        name="sequence basic",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="seq",
                type=NodeType.SEQUENCE,
                position=Position(x=0, y=0),
                data={
                    "inputs": [{"id": "exec-in", "label": "", "type": "execution"}],
                    "outputs": [
                        {"id": "then:0", "label": "Then 0", "type": "execution"},
                        {"id": "then:1", "label": "Then 1", "type": "execution"},
                    ],
                },
            ),
            VisualNode(
                id="A",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    return {'visited': visited + ['A']}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="B",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    return {'visited': visited + ['B']}\n"
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
                target="seq",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="seq",
                sourceHandle="then:0",
                target="A",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e3",
                source="seq",
                sourceHandle="then:1",
                target="B",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"visited": []}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": ["A", "B"]}


def test_parallel_executes_all_branches_then_completed() -> None:
    flow = VisualFlow(
        id="flow-parallel-basic",
        name="parallel basic",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="par",
                type=NodeType.PARALLEL,
                position=Position(x=0, y=0),
                data={
                    "inputs": [{"id": "exec-in", "label": "", "type": "execution"}],
                    "outputs": [
                        {"id": "then:0", "label": "Then 0", "type": "execution"},
                        {"id": "then:1", "label": "Then 1", "type": "execution"},
                        {"id": "completed", "label": "Completed", "type": "execution"},
                    ],
                },
            ),
            VisualNode(
                id="A",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    return {'visited': visited + ['A']}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="B",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    return {'visited': visited + ['B']}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="C",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    return {'visited': visited + ['C']}\n"
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
                target="par",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e2",
                source="par",
                sourceHandle="then:0",
                target="A",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e3",
                source="par",
                sourceHandle="then:1",
                target="B",
                targetHandle="exec-in",
            ),
            VisualEdge(
                id="e4",
                source="par",
                sourceHandle="completed",
                target="C",
                targetHandle="exec-in",
            ),
        ],
    )

    result = execute_visual_flow(flow, {"visited": []}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": ["A", "B", "C"]}





