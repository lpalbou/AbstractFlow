from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_split_feeds_loop_and_ignores_trailing_empty_segment() -> None:
    """Split should produce stable loop items for common delimiter-separated payloads.

    Real-world LLM outputs and templates frequently end with a trailing delimiter
    (e.g. "A@@B@@"), which would otherwise create a spurious empty last item and
    an extra loop iteration.
    """

    flow = VisualFlow(
        id="flow-split-loop",
        name="split → loop",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="text",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "A@@B@@C@@"},
            ),
            VisualNode(
                id="split",
                type=NodeType.SPLIT,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"delimiter": "@@"}},
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
            VisualEdge(id="e3", source="loop", sourceHandle="done", target="final", targetHandle="exec-in"),
            VisualEdge(id="d1", source="text", sourceHandle="value", target="split", targetHandle="text"),
            VisualEdge(id="d2", source="split", sourceHandle="result", target="loop", targetHandle="items"),
            VisualEdge(id="d3", source="body", sourceHandle="visited", target="final", targetHandle="visited"),
        ],
    )

    result = execute_visual_flow(flow, {"visited": []}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"visited": ["A", "B", "C"]}





