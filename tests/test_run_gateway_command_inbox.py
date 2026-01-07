from __future__ import annotations

import tempfile
import time
from pathlib import Path

from abstractruntime import FileArtifactStore, JsonFileRunStore, JsonlLedgerStore, ObservableLedgerStore
from abstractruntime.storage.commands import CommandRecord, JsonlCommandStore

from abstractflow.visual.executor import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode

from web.backend.services.gateway_runner import GatewayRunner, GatewayRunnerConfig


def _wait_until(fn, *, timeout_s: float = 5.0, poll_s: float = 0.05):
    t0 = time.time()
    last = None
    while (time.time() - t0) < timeout_s:
        last = fn()
        if last:
            return last
        time.sleep(poll_s)
    return None


def test_gateway_runner_processes_resume_commands_and_survives_restart() -> None:
    # Minimal flow: On Flow Start -> Ask User -> Code (terminal)
    flow_id = "test-gateway-ask-user"
    visual = VisualFlow(
        id=flow_id,
        name="gateway ask_user",
        entryNode="start",
        nodes=[
            VisualNode(id="start", type=NodeType.ON_FLOW_START, position=Position(x=0, y=0), data={}),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Pick one:"},
            ),
            VisualNode(
                id="choices",
                type=NodeType.LITERAL_ARRAY,
                position=Position(x=0, y=0),
                data={"literalValue": ["alpha", "beta"]},
            ),
            VisualNode(
                id="ask",
                type=NodeType.ASK_USER,
                position=Position(x=0, y=0),
                data={"effectConfig": {"allowFreeText": False}},
            ),
            VisualNode(
                id="code",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={"code": "def transform(input):\n    return {'final': input.get('input')}\n", "functionName": "transform"},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="start", sourceHandle="exec-out", target="ask", targetHandle="exec-in"),
            VisualEdge(id="e2", source="ask", sourceHandle="exec-out", target="code", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="ask", targetHandle="prompt"),
            VisualEdge(id="d2", source="choices", sourceHandle="value", target="ask", targetHandle="choices"),
            VisualEdge(id="d3", source="ask", sourceHandle="response", target="code", targetHandle="input"),
        ],
    )

    with tempfile.TemporaryDirectory(prefix="abstractflow-gateway-") as td:
        base = Path(td)
        run_store = JsonFileRunStore(base)
        ledger_store = ObservableLedgerStore(JsonlLedgerStore(base))
        artifact_store = FileArtifactStore(base)

        flows = {flow_id: visual}

        cfg = GatewayRunnerConfig(poll_interval_s=0.05, tick_workers=1, tick_max_steps=50, run_scan_limit=200)
        runner1 = GatewayRunner(
            base_dir=base,
            flows=flows,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
            config=cfg,
            enable=True,
        )
        runner1.start()
        try:
            # Start a run; the gateway runner should tick it into WAITING(USER).
            vis_runner = create_visual_runner(
                visual,
                flows=flows,
                run_store=run_store,
                ledger_store=ledger_store,
                artifact_store=artifact_store,
            )
            run_id = vis_runner.start({}, actor_id="gateway")

            def _waiting():
                st = run_store.load(run_id)
                if st is None:
                    return None
                if st.status.value != "waiting" or st.waiting is None:
                    return None
                if st.waiting.reason.value != "user":
                    return None
                return st

            st_wait = _wait_until(_waiting)
            assert st_wait is not None
            wait_key = st_wait.waiting.wait_key
            assert isinstance(wait_key, str) and wait_key

            # Submit a durable resume command (idempotent).
            res = runner1.command_store.append(
                CommandRecord(
                    command_id="cmd-resume-1",
                    run_id=run_id,
                    type="resume",
                    payload={"wait_key": wait_key, "payload": {"response": "alpha"}},
                    ts="t",
                    seq=0,
                )
            )
            assert res.accepted is True

            def _completed():
                st = run_store.load(run_id)
                if st is None:
                    return None
                return st if st.status.value == "completed" else None

            st_done = _wait_until(_completed)
            assert st_done is not None
            assert isinstance(st_done.output, dict)
        finally:
            runner1.stop()

        # Simulate "runner restart": new instance, same stores + inbox.
        # While the runner is down, accept a durable cancel command for a new run.
        vis_runner2 = create_visual_runner(
            visual,
            flows=flows,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
        )
        run_id2 = vis_runner2.start({}, actor_id="gateway")

        inbox = JsonlCommandStore(base)
        inbox.append(CommandRecord(command_id="cmd-cancel-1", run_id=run_id2, type="cancel", payload={}, ts="t", seq=0))

        runner2 = GatewayRunner(
            base_dir=base,
            flows=flows,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
            config=cfg,
            enable=True,
        )
        runner2.start()
        try:
            def _cancelled():
                st = run_store.load(run_id2)
                if st is None:
                    return None
                return st if st.status.value == "cancelled" else None

            st_cancel = _wait_until(_cancelled)
            assert st_cancel is not None
        finally:
            runner2.stop()


