from __future__ import annotations

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_set_var_with_typed_boolean_value_pin_defaults_to_false_when_unset() -> None:
    """Regression: Set Variable should not write None for an unset boolean pin.

    In the UI, an unchecked checkbox visually means False. Historically, leaving the
    boolean pin untouched could omit the default and cause `Set Variable` to write None,
    which then made typed variable reads (var_decl) fall back to their default (often True).
    """
    flow = VisualFlow(
        id="flow-set-var-bool-default",
        name="set var bool default",
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
                        {"id": "value", "label": "value", "type": "boolean"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "value", "label": "value", "type": "boolean"},
                    ],
                    "pinDefaults": {"name": "b_continue"},
                },
            ),
            VisualNode(
                id="get",
                type=NodeType.GET_VAR,
                position=Position(x=0, y=0),
                data={
                    "inputs": [{"id": "name", "label": "name", "type": "string"}],
                    "outputs": [{"id": "value", "label": "value", "type": "boolean"}],
                    "pinDefaults": {"name": "b_continue"},
                },
            ),
            VisualNode(
                id="final",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    # Code nodes receive a dict of resolved inputs.\n"
                        "    # When the `input` pin is wired, the value is under input['input'].\n"
                        "    v = input.get('input') if isinstance(input, dict) else input\n"
                        "    return {'b_continue': v}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="set", targetHandle="exec-in"),
            VisualEdge(id="e2", source="set", sourceHandle="exec-out", target="final", targetHandle="exec-in"),
            VisualEdge(id="d1", source="get", sourceHandle="value", target="final", targetHandle="input"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True
    # If the set wrote None, get would return None and we would see it here.
    assert result["result"] == {"b_continue": False}


