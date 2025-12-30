"""Regression: WS node events include runId for root + child runs.

This matters for UX:
- The visual run timeline should only show the root run (visual node ids)
- Agent/Subflow nodes run subworkflows as child runs; their LLM/tool activity must
  be observable without breaking graph highlighting.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import anyio

from abstractruntime.core.models import RunStatus


@dataclass
class _FakeRunState:
    run_id: str
    workflow_id: str
    status: RunStatus
    current_node: Optional[str]
    vars: Dict[str, Any]
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    waiting: Any = None
    parent_run_id: Optional[str] = None


class _FakeRunStore:
    def __init__(self, *, runtime: "_FakeRuntime") -> None:
        self._runtime = runtime

    def list_children(self, *, parent_run_id: str, status: Optional[RunStatus] = None):  # type: ignore[override]
        out = []
        for st in self._runtime._states.values():
            if st.parent_run_id != parent_run_id:
                continue
            if status is not None and st.status != status:
                continue
            out.append(st)
        return out


class _FakeRuntime:
    def __init__(self, *, states: Dict[str, _FakeRunState]) -> None:
        self._states = states
        self.run_store = _FakeRunStore(runtime=self)

    def get_state(self, run_id: str) -> _FakeRunState:
        return self._states[run_id]

    def tick(self, *, workflow: Any, run_id: str, max_steps: int = 1) -> _FakeRunState:
        st = self._states[run_id]
        if st.status != RunStatus.RUNNING:
            return st
        # One step completes the run (enough to validate WS semantics).
        st.status = RunStatus.COMPLETED
        st.output = {"ok": True}
        st.current_node = None
        return st


@dataclass
class _FakeWorkflow:
    workflow_id: str


class _FakeFlowNode:
    def __init__(self, *, effect_type: Optional[str] = None) -> None:
        self.effect_type = effect_type


class _FakeFlow:
    def __init__(self) -> None:
        self._node_outputs: Dict[str, Any] = {}
        self.nodes = {"root_node": _FakeFlowNode(effect_type=None)}


class _FakeRunner:
    def __init__(self, *, runtime: _FakeRuntime, workflow_id: str, run_id: str) -> None:
        self.runtime = runtime
        self.workflow = _FakeWorkflow(workflow_id=workflow_id)
        self.flow = _FakeFlow()
        self.run_id = run_id
        self._stepped = False

    def get_state(self) -> _FakeRunState:
        return self.runtime.get_state(self.run_id)

    def step(self) -> _FakeRunState:
        # Mimic FlowRunner.step() behavior: progress the root run by one tick.
        if not self._stepped:
            st = self.runtime.get_state(self.run_id)
            self.flow._node_outputs["root_node"] = {"ok": True}
            st.status = RunStatus.COMPLETED
            st.output = {"success": True}
            st.current_node = None
            self._stepped = True
        return self.runtime.get_state(self.run_id)


def test_ws_node_events_include_run_id_for_child_runs() -> None:
    import web.backend.routes.ws as ws_routes

    class _CapturingWebSocket:
        def __init__(self) -> None:
            self.sent: list[dict] = []

        async def send_json(self, data: Any) -> None:
            assert isinstance(data, dict)
            self.sent.append(data)

    root_run_id = "run_root"
    child_run_id = "run_child"
    wf_id = "wf_test"

    root_state = _FakeRunState(
        run_id=root_run_id,
        workflow_id=wf_id,
        status=RunStatus.RUNNING,
        current_node="root_node",
        vars={},
        parent_run_id=None,
    )
    child_state = _FakeRunState(
        run_id=child_run_id,
        workflow_id=wf_id,
        status=RunStatus.RUNNING,
        current_node="child_node",
        vars={},
        parent_run_id=root_run_id,
    )

    runtime = _FakeRuntime(states={root_run_id: root_state, child_run_id: child_state})
    runner = _FakeRunner(runtime=runtime, workflow_id=wf_id, run_id=root_run_id)
    ws = _CapturingWebSocket()

    async def _drive() -> None:
        with anyio.fail_after(1.0):
            await ws_routes._execute_runner_loop(ws, runner, "conn_fake")  # type: ignore[arg-type]

    anyio.run(_drive)

    node_msgs = [m for m in ws.sent if m.get("type") in {"node_start", "node_complete"}]
    assert node_msgs, "Expected node_start/node_complete messages"

    # All node events must include runId (used by UI to group child runs).
    for m in node_msgs:
        assert isinstance(m.get("runId"), str) and m.get("runId")

    # Child run must have emitted at least one node_start.
    assert any(m.get("type") == "node_start" and m.get("runId") == child_run_id for m in node_msgs)


