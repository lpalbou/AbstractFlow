"""Regression: WS streams runtime node trace deltas (trace_update) for child runs.

Why this matters:
- Agent nodes run as durable subworkflows (child runs).
- Each internal LLM/tool effect is recorded in runtime-owned node traces.
- The UI must receive these trace entries *during* execution, not only after the
  outer visual node completes.
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
    def __init__(self, *, states: Dict[str, _FakeRunState], traces: Dict[str, Dict[str, Any]]) -> None:
        self._states = states
        self._traces = traces
        self.run_store = _FakeRunStore(runtime=self)

    def get_state(self, run_id: str) -> _FakeRunState:
        return self._states[run_id]

    def tick(self, *, workflow: Any, run_id: str, max_steps: int = 1) -> _FakeRunState:
        st = self._states[run_id]
        if st.status == RunStatus.RUNNING:
            # Complete immediately; trace is still expected to be emitted.
            st.status = RunStatus.COMPLETED
            st.current_node = None
            st.output = {"ok": True}
        return st

    def get_node_traces(self, run_id: str) -> Dict[str, Any]:
        return self._traces.get(run_id, {})


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
        # Complete root quickly.
        if not self._stepped:
            st = self.runtime.get_state(self.run_id)
            st.status = RunStatus.COMPLETED
            st.current_node = None
            st.output = {"success": True}
            self._stepped = True
        return self.runtime.get_state(self.run_id)


def test_ws_streams_trace_update_for_child_run() -> None:
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

    traces = {
        child_run_id: {
            "child_node": {
                "node_id": "child_node",
                "steps": [
                    {
                        "ts": "2025-12-30T00:00:00Z",
                        "node_id": "child_node",
                        "status": "completed",
                        "effect": {"type": "llm_call", "payload": {"prompt": "hi"}, "result_key": "_temp.llm"},
                        "result": {"content": "ok"},
                    }
                ],
            }
        }
    }

    runtime = _FakeRuntime(states={root_run_id: root_state, child_run_id: child_state}, traces=traces)
    runner = _FakeRunner(runtime=runtime, workflow_id=wf_id, run_id=root_run_id)
    ws = _CapturingWebSocket()

    async def _drive() -> None:
        with anyio.fail_after(1.0):
            await ws_routes._execute_runner_loop(ws, runner, "conn_fake")  # type: ignore[arg-type]

    anyio.run(_drive)

    trace_msgs = [m for m in ws.sent if m.get("type") == "trace_update"]
    assert trace_msgs, "Expected at least one trace_update event"

    # Must include child run id and node id.
    assert any(m.get("runId") == child_run_id and m.get("nodeId") == "child_node" for m in trace_msgs)
    first = next(m for m in trace_msgs if m.get("runId") == child_run_id and m.get("nodeId") == "child_node")
    assert isinstance(first.get("steps"), list) and first["steps"], "trace_update.steps must be a non-empty list"


