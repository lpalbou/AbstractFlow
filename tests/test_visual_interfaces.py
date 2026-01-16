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


def test_visual_interface_abstractcode_agent_v1_scaffold_adds_success_meta_scratchpad_and_drops_result() -> None:
    from abstractflow.visual.interfaces import ABSTRACTCODE_AGENT_V1, apply_visual_flow_interface_scaffold
    from abstractflow.visual.models import VisualFlow

    vf = VisualFlow.model_validate(
        {
            "id": "flow3",
            "name": "flow3",
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
                    "data": {
                        "inputs": [
                            {"id": "exec-in", "label": "", "type": "execution"},
                            # Legacy/deprecated pins should be removed by scaffold.
                            {"id": "raw_result", "label": "raw_result", "type": "object"},
                            {"id": "result", "label": "result", "type": "object"},
                        ]
                    },
                },
            ],
            "edges": [],
            "entryNode": "start",
        }
    )

    changed = apply_visual_flow_interface_scaffold(vf, ABSTRACTCODE_AGENT_V1, include_recommended=True)
    assert changed is True

    end = [n for n in vf.nodes if n.id == "end"][0]
    pins = end.data.get("inputs") if isinstance(end.data, dict) else None
    assert isinstance(pins, list)
    ids = [p.get("id") for p in pins if isinstance(p, dict)]

    assert ids[:1] == ["exec-in"]
    assert "response" in ids
    assert "success" in ids
    assert "meta" in ids
    assert "scratchpad" in ids
    assert "result" not in ids
    assert "raw_result" not in ids
