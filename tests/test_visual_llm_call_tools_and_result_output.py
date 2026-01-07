from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

from abstractflow.compiler import _sync_effect_results_to_node_outputs, compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def _build_minimal_visual_llm_flow(*, tools_pin_value: Any | None, config_tools: Any | None) -> VisualFlow:
    # Note: literal nodes are evaluated into {"value": literalValue} by visual_to_flow,
    # and can be wired into LLM Call pins via data edges.
    nodes = [
        VisualNode(id="n1", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
        VisualNode(
            id="prompt",
            type=NodeType.LITERAL_STRING,
            position=Position(x=0, y=0),
            data={"literalValue": "hi"},
        ),
        VisualNode(
            id="n2",
            type=NodeType.LLM_CALL,
            position=Position(x=0, y=0),
            data={
                "effectConfig": {
                    "provider": "lmstudio",
                    "model": "unit-test-model",
                    "temperature": 0.0,
                    **({"tools": config_tools} if config_tools is not None else {}),
                }
            },
        ),
    ]

    edges = [
        VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in", animated=True),
        VisualEdge(id="d1", source="prompt", sourceHandle="value", target="n2", targetHandle="prompt", animated=False),
    ]

    if tools_pin_value is not None:
        nodes.append(
            VisualNode(
                id="tools",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": tools_pin_value},
            )
        )
        edges.append(
            VisualEdge(
                id="d2",
                source="tools",
                sourceHandle="value",
                target="n2",
                targetHandle="tools",
                animated=False,
            )
        )

    return VisualFlow(id="vf", name="vf", entryNode="n1", nodes=nodes, edges=edges)


def test_visual_llm_call_tools_from_config_are_converted_to_tool_specs() -> None:
    visual = _build_minimal_visual_llm_flow(tools_pin_value=None, config_tools=["read_file"])
    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="n2", vars={})
    plan = spec.get_node("n2")(run, _dummy_ctx())

    assert plan.effect is not None
    assert plan.effect.type.value == "llm_call"

    payload = dict(plan.effect.payload or {})
    tools = payload.get("tools")
    assert isinstance(tools, list) and tools, "expected tools to be a non-empty list of ToolSpecs"
    assert any(isinstance(t, dict) and t.get("name") == "read_file" for t in tools)

    # Ensure UI-only fields are not required: spec should have at least {name, description, parameters}.
    first = next((t for t in tools if isinstance(t, dict) and t.get("name") == "read_file"), None)
    assert isinstance(first, dict)
    assert set(first.keys()) >= {"name", "description", "parameters"}
    assert isinstance(first.get("parameters"), dict)


def test_visual_llm_call_tools_pin_overrides_config_even_when_empty_list() -> None:
    # Config sets tools, but the tools pin provides an explicit empty list => tools disabled.
    visual = _build_minimal_visual_llm_flow(tools_pin_value=[], config_tools=["read_file"])
    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="n2", vars={})
    plan = spec.get_node("n2")(run, _dummy_ctx())

    assert plan.effect is not None
    payload = dict(plan.effect.payload or {})
    assert payload.get("tools") == []


def test_visual_llm_call_node_outputs_include_result_object_after_effect_completion() -> None:
    visual = _build_minimal_visual_llm_flow(tools_pin_value=None, config_tools=None)
    flow = visual_to_flow(visual)

    raw_result: Dict[str, Any] = {
        "content": "pong",
        "tool_calls": [{"name": "read_file", "arguments": {"file_path": "/tmp/x"}, "call_id": "1"}],
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        "gen_time": 12.3,
        "ttft_ms": 4.5,
        "trace_id": "trace-1",
        "metadata": {},
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
    assert out.get("response") == "pong"
    assert out.get("tool_calls") == raw_result.get("tool_calls")
    assert out.get("result") == raw_result
    assert out.get("gen_time") == 12.3
    assert out.get("ttft_ms") == 4.5
    assert out.get("raw") == raw_result

