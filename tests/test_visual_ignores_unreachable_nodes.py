from __future__ import annotations

import pytest

from abstractflow.visual import execute_visual_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_execute_visual_flow_ignores_unreachable_execution_nodes() -> None:
    """Orphan nodes should not prevent execution of the reachable pipeline."""
    flow = VisualFlow(
        id="flow-ignore-unreachable",
        name="ignore unreachable",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "pong"},
            ),
            VisualNode(
                id="answer",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
            ),
            # Unreachable LLM node (no exec edges to it) that would normally require runtime wiring.
            VisualNode(
                id="orphan_llm",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={
                    "effectConfig": {},
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="answer", targetHandle="message"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True


def test_unreachable_llm_node_is_still_validated_if_reachable() -> None:
    """If the same node becomes reachable, missing provider/model should surface as an error."""
    flow = VisualFlow(
        id="flow-unreachable-becomes-reachable",
        name="unreachable becomes reachable",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="orphan_llm",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={
                    "effectConfig": {},
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="orphan_llm", targetHandle="exec-in"),
        ],
    )

    with pytest.raises(Exception):
        execute_visual_flow(flow, {}, flows={flow.id: flow})


def test_execute_visual_flow_ignores_unreachable_subflow_nodes() -> None:
    """Orphan subflow nodes should not be resolved/validated if unreachable."""
    flow = VisualFlow(
        id="flow-ignore-unreachable-subflow",
        name="ignore unreachable subflow",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "ok"},
            ),
            VisualNode(id="answer", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
            # Unreachable subflow pointing to a missing flow id.
            VisualNode(
                id="orphan_subflow",
                type=NodeType.SUBFLOW,
                position=Position(x=0, y=0),
                data={"subflowId": "missing-flow"},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="answer", targetHandle="message"),
        ],
    )

    result = execute_visual_flow(flow, {}, flows={flow.id: flow})
    assert result["success"] is True


