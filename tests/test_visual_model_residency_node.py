from __future__ import annotations

from typing import Any

import pytest

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def _model_residency_flow(effect_config: dict[str, Any]) -> VisualFlow:
    return VisualFlow(
        id="vf_model_residency",
        name="Model Residency",
        entryNode="start",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0, y=0),
                data={"nodeType": "on_flow_start"},
            ),
            VisualNode(
                id="load",
                type=NodeType.MODEL_RESIDENCY,
                position=Position(x=240, y=0),
                data={
                    "nodeType": "model_residency",
                    "effectConfig": effect_config,
                },
            ),
            VisualNode(
                id="end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=480, y=0),
                data={"nodeType": "on_flow_end"},
            ),
        ],
        edges=[
            VisualEdge(source="start", sourceHandle="exec-out", target="load", targetHandle="exec-in"),
            VisualEdge(source="load", sourceHandle="exec-out", target="end", targetHandle="exec-in"),
        ],
    )


def test_model_residency_node_type_and_visual_payload_compile() -> None:
    from abstractruntime.core.models import EffectType, RunState, RunStatus
    from abstractruntime.visualflow_compiler import compile_visualflow

    vf = _model_residency_flow(
        {
            "operation": "load",
            "task": "image_generation",
            "provider": "mflux",
            "model": "unit-test-model",
            "pin": True,
            "required": False,
        }
    )

    spec = compile_visualflow(vf.model_dump(mode="json"))
    run = RunState(
        run_id="run",
        workflow_id=str(spec.workflow_id),
        status=RunStatus.RUNNING,
        current_node="load",
        vars={"_temp": {}},
    )

    plan = spec.nodes["load"](run, {})

    assert plan.effect is not None
    assert plan.effect.type == EffectType.MODEL_RESIDENCY
    assert plan.effect.payload["operation"] == "load"
    assert plan.effect.payload["task"] == "image_generation"
    assert plan.effect.payload["provider"] == "mflux"
    assert plan.effect.payload["model"] == "unit-test-model"
    assert plan.effect.payload["pin"] is True
    assert plan.effect.payload["required"] is False


def test_model_residency_only_local_runner_does_not_require_default_llm(monkeypatch) -> None:
    for name in [
        "ABSTRACTCORE_SERVER_BASE_URL",
    ]:
        monkeypatch.delenv(name, raising=False)

    vf = _model_residency_flow(
        {
            "operation": "load",
            "task": "image_generation",
            "provider": "mflux",
            "model": "unit-test-model",
            "pin": True,
            "required": False,
        }
    )

    runner = create_visual_runner(vf, flows={vf.id: vf})
    result = runner.run({})

    assert result["success"] is True
    state = runner.get_state()
    assert state is not None
    effect_result = state.vars["_temp"]["effects"]["load"]
    assert effect_result["ok"] is False
    assert effect_result["code"] == "model_residency_unavailable"
    assert "Gateway-hosted runs" in effect_result["config_hint"]


def test_model_residency_required_failure_is_ledgered_at_runtime(monkeypatch) -> None:
    for name in [
        "ABSTRACTCORE_SERVER_BASE_URL",
    ]:
        monkeypatch.delenv(name, raising=False)

    vf = _model_residency_flow(
        {
            "operation": "load",
            "task": "image_generation",
            "provider": "mflux",
            "model": "unit-test-model",
            "pin": True,
            "required": True,
        }
    )

    runner = create_visual_runner(vf, flows={vf.id: vf})
    with pytest.raises(RuntimeError, match="standalone local Flow compatibility mode"):
        runner.run({})
