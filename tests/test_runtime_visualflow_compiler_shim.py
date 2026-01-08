from __future__ import annotations

from abstractflow import compile_flow
from abstractflow.compiler import (
    _create_visual_agent_effect_handler,
    _sync_effect_results_to_node_outputs,
)
from abstractflow.visual.executor import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_compile_flow_is_routed_via_abstractruntime() -> None:
    assert compile_flow.__module__.startswith("abstractruntime.visualflow_compiler.")
    assert _sync_effect_results_to_node_outputs.__module__.startswith(
        "abstractruntime.visualflow_compiler."
    )
    assert _create_visual_agent_effect_handler.__module__.startswith(
        "abstractruntime.visualflow_compiler."
    )


def test_visual_to_flow_delegates_to_abstractruntime() -> None:
    vf = VisualFlow(
        id="vf",
        name="Minimal",
        nodes=[
            VisualNode(
                id="start",
                type=NodeType.ON_FLOW_START,
                position=Position(x=0.0, y=0.0),
                data={},
            ),
            VisualNode(
                id="end",
                type=NodeType.ON_FLOW_END,
                position=Position(x=1.0, y=0.0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(
                source="start",
                sourceHandle="exec-out",
                target="end",
                targetHandle="exec-in",
            )
        ],
        entryNode="start",
    )

    flow = visual_to_flow(vf)
    assert type(flow).__module__.startswith("abstractruntime.visualflow_compiler.")

