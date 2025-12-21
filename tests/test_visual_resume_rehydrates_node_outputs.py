from __future__ import annotations

from abstractflow import FlowRunner
from abstractflow.visual import visual_to_flow
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from abstractruntime import InMemoryLedgerStore, InMemoryRunStore, Runtime, RunStatus


def test_visual_resume_rehydrates_function_node_outputs() -> None:
    """Regression: visual data edges must survive pause/resume across process restarts.

    Visual execution stores node outputs in an in-memory `flow._node_outputs` cache.
    When a run pauses (ASK_USER) and is resumed in another process, the resumed
    runner must rehydrate upstream outputs from persisted `RunState.vars`.
    """
    flow_id = "test-visual-resume-node-outputs"
    visual = VisualFlow(
        id=flow_id,
        name="resume rehydrates node outputs",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="x",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "alpha"},
            ),
            VisualNode(
                id="a",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return input.get('input')\n",
                    "functionName": "transform",
                },
            ),
            VisualNode(id="ask", type=NodeType.ASK_USER, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="final",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": (
                        "def transform(input):\n"
                        "    return {'combined': str(input.get('a')) + '|' + str(input.get('b'))}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            # Execution edges
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="a", targetHandle="exec-in"),
            VisualEdge(id="e2", source="a", sourceHandle="exec-out", target="ask", targetHandle="exec-in"),
            VisualEdge(id="e3", source="ask", sourceHandle="exec-out", target="final", targetHandle="exec-in"),
            # Data edges
            VisualEdge(id="d1", source="x", sourceHandle="value", target="a", targetHandle="input"),
            VisualEdge(id="d2", source="a", sourceHandle="result", target="final", targetHandle="a"),
            VisualEdge(id="d3", source="ask", sourceHandle="response", target="final", targetHandle="b"),
        ],
    )

    runtime = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())

    # Run until waiting (simulates the first process/session).
    flow1 = visual_to_flow(visual)
    runner1 = FlowRunner(flow1, runtime=runtime)
    first = runner1.run({})
    assert first.get("waiting") is True

    run_id = runner1.run_id
    assert isinstance(run_id, str) and run_id

    state = runner1.get_state()
    assert state is not None
    assert state.status == RunStatus.WAITING

    wait_key = first.get("wait_key")
    assert isinstance(wait_key, str) and wait_key

    # Resume from a "fresh process" with an empty in-memory node output cache.
    flow2 = visual_to_flow(visual)
    runner2 = FlowRunner(flow2, runtime=runtime)
    runner2._current_run_id = run_id  # simulate attach

    resumed = runner2.resume(wait_key=wait_key, payload={"response": "user"})
    assert resumed.status == RunStatus.COMPLETED

    out = resumed.output or {}
    assert out.get("success") is True
    assert out.get("result") == {"combined": "alpha|user"}

