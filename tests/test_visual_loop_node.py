from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_loop_executes_body_for_each_item_then_done_even_with_effect_nodes_present() -> None:
    """Regression: Loop item resolution must not break when later nodes are effect nodes.

    This specifically guards against Python closure late-binding bugs inside compile_flow.
    """
    flow = VisualFlow(
        id="flow-loop-basic",
        name="loop basic",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="items",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["A", "B", "C"]},
            ),
            VisualNode(
                id="loop",
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
            VisualNode(
                id="body",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    visited = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('visited'), list):\n"
                        "        visited = list(input.get('visited'))\n"
                        "    item = input.get('item') if isinstance(input, dict) else None\n"
                        "    return {'visited': visited + [item]}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="done_message",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "done"},
            ),
            VisualNode(
                id="answer",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
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
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="loop", targetHandle="exec-in"),
            VisualEdge(id="e2", source="loop", sourceHandle="loop", target="body", targetHandle="exec-in"),
            VisualEdge(id="e3", source="loop", sourceHandle="done", target="answer", targetHandle="exec-in"),
            VisualEdge(id="e4", source="answer", sourceHandle="exec-out", target="final", targetHandle="exec-in"),
            VisualEdge(id="d1", source="items", sourceHandle="value", target="loop", targetHandle="items"),
            VisualEdge(id="d2", source="done_message", sourceHandle="value", target="answer", targetHandle="message"),
            VisualEdge(id="d3", source="body", sourceHandle="visited", target="final", targetHandle="visited"),
        ],
    )

    result = execute_visual_flow(flow, {"visited": []}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": ["A", "B", "C"]}


