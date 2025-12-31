from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_for_executes_numeric_range_with_index_and_i_then_done() -> None:
    flow = VisualFlow(
        id="flow-for-basic",
        name="for basic",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="init",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'visited': []}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="f",
                type=NodeType.FOR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "start", "label": "start", "type": "number"},
                        {"id": "end", "label": "end", "type": "number"},
                        {"id": "step", "label": "step", "type": "number"},
                    ],
                    "outputs": [
                        {"id": "loop", "label": "loop", "type": "execution"},
                        {"id": "done", "label": "done", "type": "execution"},
                        {"id": "i", "label": "i", "type": "number"},
                        {"id": "index", "label": "index", "type": "number"},
                    ],
                    "pinDefaults": {"step": 1},
                },
            ),
            VisualNode(
                id="body",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = input.get('visited') if isinstance(input, dict) else []\n"
                        "    if not isinstance(visited, list):\n"
                        "        visited = []\n"
                        "    visited = list(visited)\n"
                        "    i = input.get('i') if isinstance(input, dict) else None\n"
                        "    idx = input.get('index') if isinstance(input, dict) else None\n"
                        "    visited.append([idx, i])\n"
                        "    return {'visited': visited}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="final",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = input.get('visited') if isinstance(input, dict) else None\n"
                        "    return {'visited': visited}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="init", targetHandle="exec-in"),
            VisualEdge(id="e2", source="init", sourceHandle="exec-out", target="f", targetHandle="exec-in"),
            VisualEdge(id="e3", source="f", sourceHandle="loop", target="body", targetHandle="exec-in"),
            VisualEdge(id="e4", source="f", sourceHandle="done", target="final", targetHandle="exec-in"),
            VisualEdge(id="d0a", source="start", sourceHandle="start", target="f", targetHandle="start"),
            VisualEdge(id="d0b", source="start", sourceHandle="end", target="f", targetHandle="end"),
            VisualEdge(id="d1", source="body", sourceHandle="visited", target="final", targetHandle="visited"),
            VisualEdge(id="d2", source="body", sourceHandle="visited", target="body", targetHandle="visited"),
            VisualEdge(id="d3", source="f", sourceHandle="i", target="body", targetHandle="i"),
            VisualEdge(id="d4", source="f", sourceHandle="index", target="body", targetHandle="index"),
        ],
    )

    result = execute_visual_flow(flow, {"start": 0, "end": 3}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": [[0, 0.0], [1, 1.0], [2, 2.0]]}


