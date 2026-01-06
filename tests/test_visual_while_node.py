from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_while_executes_loop_until_condition_false_then_done() -> None:
    flow = VisualFlow(
        id="flow-while-basic",
        name="while basic",
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
                        "    # initialize counter and condition\n"
                        "    return {'n': 3, 'visited': [], 'condition': True}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="w",
                type=NodeType.WHILE,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "condition", "label": "condition", "type": "boolean"},
                    ],
                    "outputs": [
                        {"id": "loop", "label": "loop", "type": "execution"},
                        {"id": "done", "label": "done", "type": "execution"},
                        {"id": "item", "label": "item", "type": "any"},
                        {"id": "index", "label": "index", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="body",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    n = int(input.get('n') or 0) if isinstance(input, dict) else 0\n"
                        "    idx = int(input.get('index') or 0) if isinstance(input, dict) else 0\n"
                        "    item = input.get('item') if isinstance(input, dict) else None\n"
                        "    item_n = item.get('n') if isinstance(item, dict) else None\n"
                        "    visited = input.get('visited') if isinstance(input, dict) else []\n"
                        "    if not isinstance(visited, list):\n"
                        "        visited = []\n"
                        "    visited = list(visited)\n"
                        "    visited.append([idx, n, item_n])\n"
                        "    n2 = n - 1\n"
                        "    return {'n': n2, 'visited': visited, 'condition': n2 > 0}\n"
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
            VisualEdge(id="e2", source="init", sourceHandle="exec-out", target="w", targetHandle="exec-in"),
            VisualEdge(id="e3", source="w", sourceHandle="loop", target="body", targetHandle="exec-in"),
            VisualEdge(id="e4", source="w", sourceHandle="done", target="final", targetHandle="exec-in"),
            VisualEdge(id="d0", source="w", sourceHandle="index", target="body", targetHandle="index"),
            VisualEdge(id="d1", source="body", sourceHandle="condition", target="w", targetHandle="condition"),
            VisualEdge(id="d2", source="body", sourceHandle="visited", target="final", targetHandle="visited"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": [[0, 3, 3], [1, 2, 2], [2, 1, 1]]}



