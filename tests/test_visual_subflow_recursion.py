"""Regression: Subflow nodes should be able to call the current workflow (self recursion)."""

from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_visual_subflow_can_call_self_and_terminate() -> None:
    flow_id = "test-self-recursive-subflow"

    flow = VisualFlow(
        id=flow_id,
        name="self recursive subflow",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="inc",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    c = input.get('count', 0)\n"
                        "    try:\n"
                        "        c = int(c)\n"
                        "    except Exception:\n"
                        "        c = 0\n"
                        "    c = c + 1\n"
                        "    return {'count': c, 'condition': c >= 3}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="if",
                type=NodeType.IF,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="recurse",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={
                    "subflowId": flow_id,
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="end_true",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="end_false",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                },
            ),
        ],
        edges=[
            # Exec wiring.
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="inc", targetHandle="exec-in"),
            VisualEdge(id="e2", source="inc", sourceHandle="exec-out", target="if", targetHandle="exec-in"),
            VisualEdge(id="e3", source="if", sourceHandle="true", target="end_true", targetHandle="exec-in"),
            VisualEdge(id="e4", source="if", sourceHandle="false", target="recurse", targetHandle="exec-in"),
            VisualEdge(id="e5", source="recurse", sourceHandle="exec-out", target="end_false", targetHandle="exec-in"),
            # Data wiring.
            VisualEdge(id="d1", source="inc", sourceHandle="condition", target="if", targetHandle="condition"),
            VisualEdge(id="d2", source="inc", sourceHandle="count", target="recurse", targetHandle="count"),
            VisualEdge(id="d3", source="inc", sourceHandle="count", target="end_true", targetHandle="count"),
            VisualEdge(id="d4", source="recurse", sourceHandle="count", target="end_false", targetHandle="count"),
        ],
    )

    # Self recursion should work even if `flows` does not redundantly include this id.
    result = execute_visual_flow(flow, {"count": 0}, flows={})
    assert result["success"] is True
    assert result["result"] == {"count": 3}


def test_visual_subflow_self_recursion_with_pure_nodes_terminates() -> None:
    """Regression: pure-node caching must be run-scoped for recursive subflows.

    This mirrors the common visual pattern:
      if (number > 0) -> Subflow(self, number-1)
      else -> End(number)
    where `compare` / `subtract` are *pure* (no exec pins) and evaluated lazily via data edges.
    """
    from abstractflow.visual.models import NodeType

    flow_id = "test-self-recursive-subflow-pure"

    flow = VisualFlow(
        id=flow_id,
        name="self recursive subflow (pure nodes)",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "number", "label": "number", "type": "number"},
                    ],
                },
            ),
            # Pure nodes: compare + subtract (no execution pins).
            VisualNode(
                id="zero",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 0},
            ),
            VisualNode(
                id="cmp",
                type=NodeType.COMPARE,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"op": ">"},
                },
            ),
            VisualNode(
                id="sub",
                type=NodeType.SUBTRACT,
                position=Position(x=0, y=0),
                data={
                    "pinDefaults": {"b": 1},
                },
            ),
            VisualNode(
                id="if",
                type=NodeType.IF,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="recurse",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={
                    "subflowId": flow_id,
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "number", "label": "number", "type": "number"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "number", "label": "number", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="end_base",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "number", "label": "number", "type": "number"},
                    ],
                },
            ),
            VisualNode(
                id="end_after",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "number", "label": "number", "type": "number"},
                    ],
                },
            ),
        ],
        edges=[
            # Exec wiring.
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="if", targetHandle="exec-in"),
            VisualEdge(id="e2", source="if", sourceHandle="true", target="recurse", targetHandle="exec-in"),
            VisualEdge(id="e3", source="if", sourceHandle="false", target="end_base", targetHandle="exec-in"),
            VisualEdge(id="e4", source="recurse", sourceHandle="exec-out", target="end_after", targetHandle="exec-in"),
            # Data wiring (pure nodes are evaluated lazily from these).
            VisualEdge(id="d1", source="start", sourceHandle="number", target="cmp", targetHandle="a"),
            VisualEdge(id="d2", source="zero", sourceHandle="value", target="cmp", targetHandle="b"),
            VisualEdge(id="d3", source="cmp", sourceHandle="result", target="if", targetHandle="condition"),
            VisualEdge(id="d4", source="start", sourceHandle="number", target="sub", targetHandle="a"),
            VisualEdge(id="d5", source="sub", sourceHandle="result", target="recurse", targetHandle="number"),
            # Base-case output: direct.
            VisualEdge(id="d6", source="start", sourceHandle="number", target="end_base", targetHandle="number"),
            # Recursive output: propagate the child's output through the Subflow node.
            VisualEdge(id="d7", source="recurse", sourceHandle="number", target="end_after", targetHandle="number"),
        ],
    )

    # Self recursion should terminate cleanly with pure node evaluation.
    result = execute_visual_flow(flow, {"number": 2}, flows={})
    assert result["success"] is True
    assert result["result"] == {"number": 0}

