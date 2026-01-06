from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

from abstractflow.compiler import compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def test_visual_llm_call_response_schema_pin_is_forwarded_to_effect_payload() -> None:
    schema: Dict[str, Any] = {
        "type": "object",
        "properties": {"joke": {"type": "string"}},
        "required": ["joke"],
    }

    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Tell me a joke."},
            ),
            VisualNode(
                id="schema",
                type=NodeType.JSON_SCHEMA,
                position=Position(x=0, y=0),
                data={"literalValue": schema},
            ),
            VisualNode(
                id="llm",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"provider": "lmstudio", "model": "unit-test-model", "temperature": 0.0}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="llm", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="llm", targetHandle="prompt"),
            VisualEdge(id="d2", source="schema", sourceHandle="value", target="llm", targetHandle="response_schema"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(
        run_id="r1",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="llm",
        vars={},
    )
    plan = spec.get_node("llm")(run, _dummy_ctx())

    assert plan.effect is not None
    assert plan.effect.type.value == "llm_call"
    payload = dict(plan.effect.payload or {})
    assert payload.get("response_schema") == schema
    assert payload.get("response_schema_name") == "LLM_StructuredOutput"


def test_visual_llm_call_response_schema_wrapper_is_normalized() -> None:
    schema: Dict[str, Any] = {
        "type": "object",
        "properties": {"answer": {"type": "string"}},
        "required": ["answer"],
    }
    # LMStudio/OpenAI-style wrapper (like response_format.type=json_schema).
    wrapper: Dict[str, Any] = {
        "type": "json_schema",
        "json_schema": {"name": "joke_response", "strict": True, "schema": schema},
    }

    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "hi"},
            ),
            VisualNode(
                id="schema",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": wrapper},
            ),
            VisualNode(
                id="llm",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"provider": "lmstudio", "model": "unit-test-model", "temperature": 0.0}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="llm", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="llm", targetHandle="prompt"),
            VisualEdge(id="d2", source="schema", sourceHandle="value", target="llm", targetHandle="response_schema"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(
        run_id="r1",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="llm",
        vars={},
    )
    plan = spec.get_node("llm")(run, _dummy_ctx())

    assert plan.effect is not None
    payload = dict(plan.effect.payload or {})
    assert payload.get("response_schema") == schema



