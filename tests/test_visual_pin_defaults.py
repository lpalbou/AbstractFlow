from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def test_visual_pin_defaults_apply_to_unconnected_pure_inputs() -> None:
    flow_id = "test-visual-pin-defaults-pure"

    visual = VisualFlow(
        id=flow_id,
        name="pin defaults (pure)",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(id="answer", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
            # Pure node: no incoming edges, so it must use pinDefaults.
            VisualNode(
                id="add",
                type=NodeType.ADD,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"a": 2, "b": 3}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d1", source="add", sourceHandle="result", target="answer", targetHandle="message"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result["result"]["message"] == "5.0"


def test_visual_pin_defaults_do_not_override_connected_inputs() -> None:
    flow_id = "test-visual-pin-defaults-connected-wins"

    visual = VisualFlow(
        id=flow_id,
        name="pin defaults (connected wins)",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(id="answer", type=NodeType.ANSWER_USER, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="add",
                type=NodeType.ADD,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"a": 2, "b": 3}},
            ),
            VisualNode(
                id="lit_b",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 10},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
            VisualEdge(id="d1", source="add", sourceHandle="result", target="answer", targetHandle="message"),
            # Connected pin should win over pinDefaults.
            VisualEdge(id="d2", source="lit_b", sourceHandle="value", target="add", targetHandle="b"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result["result"]["message"] == "12.0"


def test_visual_pin_defaults_apply_to_unconnected_exec_inputs() -> None:
    flow_id = "test-visual-pin-defaults-exec"

    visual = VisualFlow(
        id=flow_id,
        name="pin defaults (exec)",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="answer",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={"pinDefaults": {"message": "hello"}},
            ),
        ],
        edges=[VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="answer", targetHandle="exec-in")],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True
    assert result["result"]["message"] == "hello"

