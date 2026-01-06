from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_subflow_registry_is_configured_when_reached_through_set_var() -> None:
    """Regression: exec reachability must include `set_var`.

    If `set_var` is not treated as an execution node during runner wiring,
    `create_visual_runner()` may incorrectly conclude subflows are unreachable and
    skip configuring the runtime workflow_registry, causing:
      "start_subworkflow requires a workflow_registry"
    """

    child = VisualFlow(
        id="child-flow",
        name="child",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
        ],
        edges=[],
    )

    root = VisualFlow(
        id="root-flow",
        name="root",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
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
                id="sub",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={"subflowId": child.id},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="set", targetHandle="exec-in"),
            VisualEdge(id="e2", source="set", sourceHandle="exec-out", target="sub", targetHandle="exec-in"),
        ],
    )

    result = execute_visual_flow(root, {}, flows={root.id: root, child.id: child})
    # The subflow does nothing; the root should still complete successfully.
    assert result["success"] is True





