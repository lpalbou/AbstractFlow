from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_set_var_updates_run_vars_and_get_var_is_not_stale() -> None:
    """Regression: variables are durable state, not cached pure-node outputs.

    Scenario:
    - Set var to "A"
    - Read it via Get Variable (forces evaluation + potential caching)
    - Set var to "B"
    - Read it again via the *same* Get Variable node

    Expected:
    - Second read returns "B" (no stale cached value)
    - Set Variable does not clobber the pipeline `_last_output` (pass-through)
    """

    flow = VisualFlow(
        id="flow-vars-stale",
        name="vars stale",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="a",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "A"},
            ),
            VisualNode(
                id="b",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "B"},
            ),
            VisualNode(
                id="set1",
                type=NodeType.SET_VAR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                        {"id": "value", "label": "value", "type": "any"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "value", "label": "value", "type": "any"},
                    ],
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
                id="read1",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    reads = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('reads'), list):\n"
                        "        reads = list(input.get('reads'))\n"
                        "    current = input.get('current') if isinstance(input, dict) else None\n"
                        "    return {'reads': reads + [current]}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="set2",
                type=NodeType.SET_VAR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "name", "label": "name", "type": "string"},
                        {"id": "value", "label": "value", "type": "any"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "value", "label": "value", "type": "any"},
                    ],
                    "pinDefaults": {"name": "scratchpad"},
                },
            ),
            VisualNode(
                id="read2",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    reads = []\n"
                        "    if isinstance(input, dict) and isinstance(input.get('reads'), list):\n"
                        "        reads = list(input.get('reads'))\n"
                        "    current = input.get('current') if isinstance(input, dict) else None\n"
                        "    return {'reads': reads + [current], 'final': current}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            # Exec chain
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="set1", targetHandle="exec-in"),
            VisualEdge(id="e2", source="set1", sourceHandle="exec-out", target="read1", targetHandle="exec-in"),
            VisualEdge(id="e3", source="read1", sourceHandle="exec-out", target="set2", targetHandle="exec-in"),
            VisualEdge(id="e4", source="set2", sourceHandle="exec-out", target="read2", targetHandle="exec-in"),
            # Values
            VisualEdge(id="d1", source="a", sourceHandle="value", target="set1", targetHandle="value"),
            VisualEdge(id="d2", source="b", sourceHandle="value", target="set2", targetHandle="value"),
            # Reads: same Get Variable node is used twice (must not be cached/stale)
            VisualEdge(id="d3", source="get", sourceHandle="value", target="read1", targetHandle="current"),
            VisualEdge(id="d4", source="get", sourceHandle="value", target="read2", targetHandle="current"),
        ],
    )

    result = execute_visual_flow(flow, {"reads": []}, flows={flow.id: flow})
    assert result["success"] is True
    assert result["result"] == {"reads": ["A", "B"], "final": "B"}


def test_set_var_rejects_reserved_names() -> None:
    flow = VisualFlow(
        id="flow-vars-reserved",
        name="vars reserved",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="v",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "x"},
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
                    "pinDefaults": {"name": "_private"},
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="set", targetHandle="exec-in"),
            VisualEdge(id="d1", source="v", sourceHandle="value", target="set", targetHandle="value"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is False
    assert "reserved" in str(result.get("error", "")).lower() or "reserved" in str(result.get("result", "")).lower()


