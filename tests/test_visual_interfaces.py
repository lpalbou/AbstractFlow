import pytest


def test_visual_interface_abstractcode_agent_v1_validates() -> None:
    from abstractflow.visual.interfaces import ABSTRACTCODE_AGENT_V1, validate_visual_flow_interface
    from abstractflow.visual.models import VisualFlow

    vf = VisualFlow.model_validate(
        {
            "id": "flow1",
            "name": "flow1",
            "interfaces": [ABSTRACTCODE_AGENT_V1],
            "nodes": [
                {
                    "id": "start",
                    "type": "on_flow_start",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "outputs": [
                            {"id": "exec-out", "label": "", "type": "execution"},
                            {"id": "request", "label": "request", "type": "string"},
                            {"id": "provider", "label": "provider", "type": "provider"},
                            {"id": "model", "label": "model", "type": "model"},
                            {"id": "tools", "label": "tools", "type": "tools"},
                        ]
                    },
                },
                {
                    "id": "end",
                    "type": "on_flow_end",
                    "position": {"x": 10, "y": 0},
                    "data": {
                        "inputs": [
                            {"id": "exec-in", "label": "", "type": "execution"},
                            {"id": "response", "label": "response", "type": "string"},
                        ]
                    },
                },
            ],
            "edges": [],
            "entryNode": "start",
        }
    )

    assert validate_visual_flow_interface(vf, ABSTRACTCODE_AGENT_V1) == []


def test_visual_interface_abstractcode_agent_v1_missing_pins_errors() -> None:
    from abstractflow.visual.interfaces import ABSTRACTCODE_AGENT_V1, validate_visual_flow_interface
    from abstractflow.visual.models import VisualFlow

    vf = VisualFlow.model_validate(
        {
            "id": "flow2",
            "name": "flow2",
            "interfaces": [ABSTRACTCODE_AGENT_V1],
            "nodes": [
                {
                    "id": "start",
                    "type": "on_flow_start",
                    "position": {"x": 0, "y": 0},
                    "data": {"outputs": [{"id": "exec-out", "label": "", "type": "execution"}]},
                },
                {
                    "id": "end",
                    "type": "on_flow_end",
                    "position": {"x": 10, "y": 0},
                    "data": {"inputs": [{"id": "exec-in", "label": "", "type": "execution"}]},
                },
            ],
            "edges": [],
            "entryNode": "start",
        }
    )

    errors = validate_visual_flow_interface(vf, ABSTRACTCODE_AGENT_V1)
    assert any("On Flow Start must expose an output pin 'request'" in e for e in errors)
    assert any("On Flow Start must expose an output pin 'provider'" in e for e in errors)
    assert any("On Flow Start must expose an output pin 'model'" in e for e in errors)
    assert any("On Flow Start must expose an output pin 'tools'" in e for e in errors)
    assert any("must expose an input pin 'response'" in e for e in errors)

