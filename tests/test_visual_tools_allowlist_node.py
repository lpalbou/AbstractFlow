from __future__ import annotations

from types import SimpleNamespace

from abstractflow.compiler import compile_flow
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from abstractruntime.core.models import RunState, RunStatus


def _dummy_ctx():
    return SimpleNamespace(now_iso=lambda: "2025-01-01T00:00:00Z")


def test_visual_tools_allowlist_outputs_tools_array() -> None:
    visual = VisualFlow(
        id="vf",
        name="vf",
        entryNode="n1",
        nodes=[
            VisualNode(id="n1", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="allow",
                type=NodeType.TOOLS_ALLOWLIST,
                position=Position(x=0, y=0),
                data={"literalValue": ["read_file", "write_file", "read_file", "  ", 123]},
            ),
            VisualNode(
                id="tc",
                type=NodeType.TOOL_CALLS,
                position=Position(x=0, y=0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="tc", targetHandle="exec-in"),
            VisualEdge(id="d1", source="allow", sourceHandle="tools", target="tc", targetHandle="allowed_tools"),
        ],
    )

    flow = visual_to_flow(visual)
    spec = compile_flow(flow)

    run = RunState(run_id="r1", workflow_id=spec.workflow_id, status=RunStatus.RUNNING, current_node="tc", vars={})
    plan = spec.get_node("tc")(run, _dummy_ctx())
    assert plan.effect is not None
    payload = dict(plan.effect.payload or {})
    assert payload.get("allowed_tools") == ["read_file", "write_file"]


