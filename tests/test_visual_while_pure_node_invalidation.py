from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_while_invalidates_pure_nodes_inside_loop_body_so_index_dependent_logic_updates() -> None:
    """Regression: pure-node cache must not make while-loop bodies reuse iteration-0 values.

    This guards against `compare` (pure) being evaluated once with index=0 and then
    reused forever, even though `While.index` changes per-iteration.
    """
    flow = VisualFlow(
        id="flow-while-pure-invalidation",
        name="while pure invalidation",
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
                id="cmp",
                type=NodeType.COMPARE,
                position=Position(x=0, y=0),
                data={
                    # We want: (index == 1)
                    "pinDefaults": {"op": "=="},
                },
            ),
            VisualNode(
                id="one",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 1},
            ),
            VisualNode(
                id="body",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    n = int(input.get('n') or 0) if isinstance(input, dict) else 0\n"
                        "    visited = input.get('visited') if isinstance(input, dict) else []\n"
                        "    if not isinstance(visited, list):\n"
                        "        visited = []\n"
                        "    visited = list(visited)\n"
                        "    is_one = bool(input.get('is_one')) if isinstance(input, dict) else False\n"
                        "    visited.append(is_one)\n"
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
            # while condition comes from the body output
            VisualEdge(id="d1", source="body", sourceHandle="condition", target="w", targetHandle="condition"),
            VisualEdge(id="d2", source="body", sourceHandle="visited", target="final", targetHandle="visited"),
            # compare: index == 1
            VisualEdge(id="d3", source="w", sourceHandle="index", target="cmp", targetHandle="a"),
            VisualEdge(id="d4", source="one", sourceHandle="value", target="cmp", targetHandle="b"),
            VisualEdge(id="d5", source="cmp", sourceHandle="result", target="body", targetHandle="is_one"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": [False, True, False]}


