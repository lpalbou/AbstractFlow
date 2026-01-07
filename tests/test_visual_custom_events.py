from __future__ import annotations

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


def _make_event_flow(flow_id: str, *, on_event_name: str) -> VisualFlow:
    return VisualFlow(
        id=flow_id,
        name="custom events",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            # Main path: emit the event once, then finish.
            VisualNode(
                id="emit",
                type=NodeType.EMIT_EVENT,
                position=Position(x=0, y=0),
                data={"effectConfig": {"name": "my_event", "scope": "session"}},
            ),
            VisualNode(
                id="payload",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": {"message": "hello"}},
            ),
            # Disconnected listener branch (Blueprint-style Custom Event).
            VisualNode(
                id="on_evt",
                type=NodeType.ON_EVENT,
                position=Position(x=0, y=0),
                data={"eventConfig": {"name": on_event_name, "scope": "session"}},
            ),
            VisualNode(
                id="answer",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="emit", targetHandle="exec-in"),
            VisualEdge(id="d1", source="payload", sourceHandle="value", target="emit", targetHandle="payload"),
            VisualEdge(id="e2", source="on_evt", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
        ],
    )


def _make_event_flow_with_payload(flow_id: str, *, on_event_name: str, payload_value) -> VisualFlow:
    """Same as _make_event_flow, but allows non-dict payloads (e.g., lists) for Emit Event wiring."""
    return VisualFlow(
        id=flow_id,
        name="custom events",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="emit",
                type=NodeType.EMIT_EVENT,
                position=Position(x=0, y=0),
                data={"effectConfig": {"name": "my_event", "scope": "session"}},
            ),
            VisualNode(
                id="payload",
                type=NodeType.LITERAL_JSON,
                position=Position(x=0, y=0),
                data={"literalValue": payload_value},
            ),
            VisualNode(
                id="on_evt",
                type=NodeType.ON_EVENT,
                position=Position(x=0, y=0),
                data={"eventConfig": {"name": on_event_name, "scope": "session"}},
            ),
            VisualNode(
                id="answer",
                type=NodeType.ANSWER_USER,
                position=Position(x=0, y=0),
                data={},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="emit", targetHandle="exec-in"),
            VisualEdge(id="d1", source="payload", sourceHandle="value", target="emit", targetHandle="payload"),
            VisualEdge(id="e2", source="on_evt", sourceHandle="exec-out", target="answer", targetHandle="exec-in"),
        ],
    )


def test_visual_custom_event_intrarun_emit_triggers_listener() -> None:
    flow_id = "test-visual-custom-event-intrarun"
    visual = _make_event_flow(flow_id, on_event_name="my_event")
    runner = create_visual_runner(visual, flows={flow_id: visual})

    result = runner.run({})
    assert result.get("success") is True

    # The VisualSessionRunner should have started the listener run.
    listener_ids = getattr(runner, "event_listener_run_ids", None)
    assert isinstance(listener_ids, list) and len(listener_ids) == 1
    listener_run_id = listener_ids[0]

    state = runner.runtime.get_state(listener_run_id)
    effects = (state.vars.get("_temp") or {}).get("effects") or {}
    assert isinstance(effects, dict)
    evt = effects.get("on_evt")
    assert isinstance(evt, dict)
    assert evt.get("payload") == {"message": "hello"}

    ledger = runner.runtime.get_ledger(listener_run_id)
    assert any(
        isinstance(rec, dict)
        and rec.get("node_id") == "answer"
        and rec.get("status") == "completed"
        for rec in ledger
    )


def test_visual_custom_event_external_emit_triggers_listener() -> None:
    from abstractruntime.scheduler import Scheduler, WorkflowRegistry

    flow_id = "test-visual-custom-event-external"
    visual = _make_event_flow(flow_id, on_event_name="my_event")
    runner = create_visual_runner(visual, flows={flow_id: visual})

    run_id = runner.start({})

    # Sanity: listener is started and waiting.
    listener_ids = getattr(runner, "event_listener_run_ids", None)
    assert isinstance(listener_ids, list) and len(listener_ids) == 1
    listener_run_id = listener_ids[0]

    # Use the host-facing scheduler API to emit an external event into the session.
    registry = runner.runtime.workflow_registry
    assert isinstance(registry, WorkflowRegistry)
    scheduler = Scheduler(runtime=runner.runtime, registry=registry)
    scheduler.emit_event(
        name="my_event",
        scope="session",
        session_id=run_id,
        payload={"message": "hello"},
    )

    state = runner.runtime.get_state(listener_run_id)
    effects = (state.vars.get("_temp") or {}).get("effects") or {}
    evt = effects.get("on_evt")
    assert isinstance(evt, dict)
    assert evt.get("payload") == {"message": "hello"}


def test_visual_custom_event_blank_name_listens_to_any_event() -> None:
    flow_id = "test-visual-custom-event-blank-name"
    visual = _make_event_flow(flow_id, on_event_name="")
    runner = create_visual_runner(visual, flows={flow_id: visual})

    result = runner.run({})
    assert result.get("success") is True

    listener_ids = getattr(runner, "event_listener_run_ids", None)
    assert isinstance(listener_ids, list) and len(listener_ids) == 1
    listener_run_id = listener_ids[0]

    state = runner.runtime.get_state(listener_run_id)
    effects = (state.vars.get("_temp") or {}).get("effects") or {}
    assert isinstance(effects, dict)
    evt = effects.get("on_evt")
    assert isinstance(evt, dict)
    assert evt.get("payload") == {"message": "hello"}


def test_visual_custom_event_preserves_list_payload() -> None:
    flow_id = "test-visual-custom-event-list-payload"
    visual = _make_event_flow_with_payload(flow_id, on_event_name="my_event", payload_value=[{"x": 1}, {"y": 2}])
    runner = create_visual_runner(visual, flows={flow_id: visual})

    result = runner.run({})
    assert result.get("success") is True

    listener_ids = getattr(runner, "event_listener_run_ids", None)
    assert isinstance(listener_ids, list) and len(listener_ids) == 1
    listener_run_id = listener_ids[0]

    state = runner.runtime.get_state(listener_run_id)
    effects = (state.vars.get("_temp") or {}).get("effects") or {}
    assert isinstance(effects, dict)
    evt = effects.get("on_evt")
    assert isinstance(evt, dict)
    assert evt.get("payload") == {"value": [{"x": 1}, {"y": 2}]}


