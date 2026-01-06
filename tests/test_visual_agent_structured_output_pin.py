from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict

from abstractflow.compiler import compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def test_agent_response_schema_pin_triggers_structured_output_postpass() -> None:
    schema: Dict[str, Any] = {
        "type": "object",
        "properties": {"answer": {"type": "string"}},
        "required": ["answer"],
    }

    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="schema",
                type=NodeType.JSON_SCHEMA,
                position=Position(x=0, y=0),
                data={"literalValue": schema},
            ),
            VisualNode(
                id="agent",
                type=NodeType.AGENT,
                position=Position(x=0, y=0),
                data={"agentConfig": {"provider": "lmstudio", "model": "unit-test-model"}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="agent", targetHandle="exec-in"),
            VisualEdge(id="d1", source="schema", sourceHandle="value", target="agent", targetHandle="response_schema"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(
        run_id="r1",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="agent",
        vars={},
    )

    # Phase 1: init -> START_SUBWORKFLOW effect
    plan1 = spec.get_node("agent")(run, _dummy_ctx())
    assert plan1.effect is not None
    assert plan1.effect.type.value == "start_subworkflow"

    # Simulate the subworkflow completing by writing the expected durable key that the agent handler reads:
    # result_key = "_temp.agent.{node_id}.sub"
    temp = run.vars.get("_temp")
    assert isinstance(temp, dict)
    agent_ns = temp.get("agent")
    assert isinstance(agent_ns, dict)
    bucket = agent_ns.get("agent")
    assert isinstance(bucket, dict)

    bucket["sub"] = {
        "sub_run_id": "sub_fake_1",
        "output": {"answer": "hello", "iterations": 1},
        "node_traces": {},
    }

    # Phase 2: agent sees subworkflow output and should trigger a structured-output post-pass
    # because the response_schema pin is provided (even though agentConfig.outputSchema is unset).
    plan2 = spec.get_node("agent")(run, _dummy_ctx())
    assert plan2.effect is not None
    assert plan2.effect.type.value == "llm_call"

    payload = dict(plan2.effect.payload or {})
    assert payload.get("response_schema") == schema
    assert payload.get("response_schema_name") == "Agent_agent"



