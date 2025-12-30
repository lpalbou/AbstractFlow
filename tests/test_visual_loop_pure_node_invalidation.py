from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_loop_recomputes_pure_nodes_per_iteration() -> None:
    """Regression: pure nodes (e.g. concat) must not be cached across loop iterations.

    Scenario:
    - Foreach over ["a", "b"]
    - Build a string from (index, item) via a pure Concat node
    - Set it into a durable var ("scratchpad") each iteration

    Expected:
    - Final scratchpad reflects the last iteration ("i=1:b"), not iteration 0.
    """

    flow = VisualFlow(
        id="flow-loop-pure-invalidation",
        name="loop pure invalidation",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="items",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["a", "b"]},
            ),
            VisualNode(
                id="foreach",
                type=NodeType.LOOP,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "items", "label": "items", "type": "array"},
                    ],
                    "outputs": [
                        {"id": "loop", "label": "loop", "type": "execution"},
                        {"id": "done", "label": "done", "type": "execution"},
                        {"id": "item", "label": "item", "type": "any"},
                        {"id": "index", "label": "index", "type": "number"},
                    ],
                },
            ),
            # Pure node: must be recomputed per iteration (depends on foreach.index/item).
            VisualNode(
                id="concat",
                type=NodeType.CONCAT,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "a", "label": "a", "type": "string"},
                        {"id": "b", "label": "b", "type": "string"},
                        {"id": "c", "label": "c", "type": "string"},
                        {"id": "d", "label": "d", "type": "string"},
                    ],
                    "outputs": [{"id": "result", "label": "result", "type": "string"}],
                    "concatConfig": {"separator": ""},
                    "pinDefaults": {"a": "i=", "c": ":"},
                },
            ),
            VisualNode(
                id="set",
                type=NodeType.SET_VAR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                        {"id": "value", "label": "value", "type": "any"},
                    ],
                    "outputs": [{"id": "exec-out", "label": "", "type": "execution"}],
                    "pinDefaults": {"name": "scratchpad"},
                },
            ),
            VisualNode(
                id="get",
                type=NodeType.GET_VAR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [{"id": "name", "label": "name", "type": "string"}],
                    "outputs": [{"id": "value", "label": "value", "type": "any"}],
                    "pinDefaults": {"name": "scratchpad"},
                },
            ),
            VisualNode(
                id="end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "scratchpad", "label": "scratchpad", "type": "any"},
                    ],
                },
            ),
        ],
        edges=[
            # Exec graph
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="foreach", targetHandle="exec-in"),
            VisualEdge(id="e2", source="foreach", sourceHandle="loop", target="set", targetHandle="exec-in"),
            VisualEdge(id="e3", source="foreach", sourceHandle="done", target="end", targetHandle="exec-in"),
            # Data edges
            VisualEdge(id="d1", source="items", sourceHandle="value", target="foreach", targetHandle="items"),
            VisualEdge(id="d2", source="foreach", sourceHandle="index", target="concat", targetHandle="b"),
            VisualEdge(id="d3", source="foreach", sourceHandle="item", target="concat", targetHandle="d"),
            VisualEdge(id="d4", source="concat", sourceHandle="result", target="set", targetHandle="value"),
            VisualEdge(id="d5", source="get", sourceHandle="value", target="end", targetHandle="scratchpad"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"scratchpad": "i=1:b"}


