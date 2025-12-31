from __future__ import annotations

from types import SimpleNamespace

from abstractflow.compiler import compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def test_visual_bool_var_reads_run_vars_with_default_fallback() -> None:
    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="flag",
                type=NodeType.BOOL_VAR,
                position=Position(x=0, y=0),
                data={"literalValue": {"name": "flag", "default": False}},
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
            VisualEdge(id="d1", source="flag", sourceHandle="value", target="copy", targetHandle="value"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    # Case 1: flag not set -> default False -> copy becomes False
    run1 = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="copy", vars={})
    spec.get_node("copy")(run1, _dummy_ctx())
    assert run1.vars.get("copy") is False

    # Case 2: flag set -> copy mirrors flag
    run2 = RunState(
        run_id="r2",
        workflow_id=spec.workflow_id,
        status=RunStatus.RUNNING,
        current_node="copy",
        vars={"flag": True},
    )
    spec.get_node("copy")(run2, _dummy_ctx())
    assert run2.vars.get("copy") is True


