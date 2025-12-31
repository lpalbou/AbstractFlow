from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

from abstractflow.compiler import _sync_effect_results_to_node_outputs, compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def _build_visual_tool_calls_flow(*, tool_calls_value: Any, allowed_tools_pin_value: Any | None, config_allowed: Any | None) -> VisualFlow:
    nodes = [
        VisualNode(id="n1", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
        VisualNode(
            id="calls",
            type=NodeType.LITERAL_ARRAY,
            position=Position(x=0, y=0),
            data={"literalValue": tool_calls_value},
        ),
        VisualNode(
            id="n2",
            type=NodeType.TOOL_CALLS,
            position=Position(x=0, y=0),
            data={
                "effectConfig": {
                    **({"allowed_tools": config_allowed} if config_allowed is not None else {}),
                }
            },
        ),
    ]

    edges = [
        VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in", animated=True),
        VisualEdge(id="d1", source="calls", sourceHandle="value", target="n2", targetHandle="tool_calls", animated=False),
    ]

    if allowed_tools_pin_value is not None:
        nodes.append(
            VisualNode(
                id="allow",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": allowed_tools_pin_value},
            )
        )
        edges.append(
            VisualEdge(
                id="d2",
                source="allow",
                sourceHandle="value",
                target="n2",
                targetHandle="allowed_tools",
                animated=False,
            )
        )

    return VisualFlow(id="vf", name="vf", entryNode="n1", nodes=nodes, edges=edges)


def test_visual_tool_calls_node_emits_tool_calls_effect_payload() -> None:
    visual = _build_visual_tool_calls_flow(
        tool_calls_value=[{"name": "read_file", "arguments": {"file_path": "/tmp/x"}, "call_id": "1"}],
        allowed_tools_pin_value=None,
        config_allowed=["read_file", "write_file"],
    )
    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="n2", vars={})
    plan = spec.get_node("n2")(run, _dummy_ctx())

    assert plan.effect is not None
    assert plan.effect.type.value == "tool_calls"
    payload = dict(plan.effect.payload or {})
    assert isinstance(payload.get("tool_calls"), list) and payload["tool_calls"]
    assert payload["tool_calls"][0]["name"] == "read_file"

    # Config allowlist should be forwarded when set.
    assert payload.get("allowed_tools") == ["read_file", "write_file"]


def test_visual_tool_calls_node_allowlist_pin_overrides_config_even_when_empty() -> None:
    visual = _build_visual_tool_calls_flow(
        tool_calls_value=[{"name": "read_file", "arguments": {}, "call_id": "1"}],
        allowed_tools_pin_value=[],  # explicit empty list => allow none
        config_allowed=["read_file"],
    )
    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="n2", vars={})
    plan = spec.get_node("n2")(run, _dummy_ctx())

    assert plan.effect is not None
    payload = dict(plan.effect.payload or {})
    assert payload.get("allowed_tools") == []


def test_visual_tool_calls_node_outputs_results_and_success_after_effect_completion() -> None:
    visual = _build_visual_tool_calls_flow(
        tool_calls_value=[{"name": "read_file", "arguments": {}, "call_id": "1"}],
        allowed_tools_pin_value=None,
        config_allowed=None,
    )
    flow = visual_to_flow(visual)

    raw_result: Dict[str, Any] = {
        "mode": "executed",
        "results": [
            {"call_id": "1", "name": "read_file", "success": True, "output": {"content": "ok"}, "error": None},
        ],
    }

    run = RunState(
        run_id="r1",
        workflow_id=str(flow.flow_id),
        status=RunStatus.RUNNING,
        current_node="n2",
        vars={"_temp": {"effects": {"n2": raw_result}}},
    )

    _sync_effect_results_to_node_outputs(run, flow)
    out = getattr(flow, "_node_outputs", {}).get("n2")
    assert isinstance(out, dict)
    assert out.get("results") == raw_result["results"]
    assert out.get("success") is True


