from __future__ import annotations

from types import SimpleNamespace

from abstractflow.compiler import compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def test_visual_var_decl_reads_typed_value_or_default_boolean() -> None:
    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="decl",
                type=NodeType.VAR_DECL,
                position=Position(x=0, y=0),
                data={"literalValue": {"name": "flag", "type": "boolean", "default": False}},
            ),
            VisualNode(
                id="copy",
                type=NodeType.SET_VAR,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"name": "copy"}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="copy", targetHandle="exec-in"),
            VisualEdge(id="d1", source="decl", sourceHandle="value", target="copy", targetHandle="value"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run1 = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="copy", vars={})
    spec.get_node("copy")(run1, _dummy_ctx())
    assert run1.vars.get("copy") is False

    run2 = RunState(
        run_id="r2",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="copy",
        vars={"flag": True},
    )
    spec.get_node("copy")(run2, _dummy_ctx())
    assert run2.vars.get("copy") is True


def test_visual_var_decl_reads_typed_value_or_default_number() -> None:
    visual = VisualFlow(
        id="vf2",
        name="vf2",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="decl",
                type=NodeType.VAR_DECL,
                position=Position(x=0, y=0),
                data={"literalValue": {"name": "n", "type": "number", "default": 7}},
            ),
            VisualNode(
                id="copy",
                type=NodeType.SET_VAR,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"name": "copy"}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="copy", targetHandle="exec-in"),
            VisualEdge(id="d1", source="decl", sourceHandle="value", target="copy", targetHandle="value"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run1 = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="copy", vars={})
    spec.get_node("copy")(run1, _dummy_ctx())
    assert run1.vars.get("copy") == 7

    run2 = RunState(
        run_id="r2",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="copy",
        vars={"n": 3},
    )
    spec.get_node("copy")(run2, _dummy_ctx())
    assert run2.vars.get("copy") == 3

    # Mismatch type -> fallback to default
    run3 = RunState(
        run_id="r3",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="copy",
        vars={"n": "3"},
    )
    spec.get_node("copy")(run3, _dummy_ctx())
    assert run3.vars.get("copy") == 7


