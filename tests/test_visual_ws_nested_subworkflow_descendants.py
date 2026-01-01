"""Regression: WS runner loop must tick *descendant* runs (not just direct children).

Why this matters:
- A root visual flow can run a Subflow node (child run).
- That subflow can contain an Agent node, which runs as another subworkflow (grandchild run).
- Agent nodes use async+wait START_SUBWORKFLOW for real-time trace streaming.

If the WS loop only ticks direct children of the root, the grandchild is never ticked and the
session deadlocks: UI shows a running subflow but nothing is computing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

import anyio

from abstractruntime.core.models import RunStatus, WaitReason, WaitState


@dataclass
class _FakeRunState:
    run_id: str
    workflow_id: str
    status: RunStatus
    current_node: Optional[str]
    vars: Dict[str, Any]
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    waiting: Optional[WaitState] = None
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
    def __init__(self, *, states: Dict[str, _FakeRunState], workflow_registry: Dict[str, Any]) -> None:
        self._states = states
        self.run_store = _FakeRunStore(runtime=self)
        self.workflow_registry = workflow_registry

    def get_state(self, run_id: str) -> _FakeRunState:
        return self._states[run_id]

    def tick(self, *, workflow: Any, run_id: str, max_steps: int = 1) -> _FakeRunState:
        # Minimal semantics for WS loop:
        # - WAITING runs do not progress on tick()
        # - RUNNING runs complete in one tick()
        st = self._states[run_id]
        if st.status != RunStatus.RUNNING:
            return st
        st.status = RunStatus.COMPLETED
        st.current_node = None
        st.output = {"ok": True, "run_id": run_id}
        st.waiting = None
        return st

    def resume(
        self,
        *,
        workflow: Any,
        run_id: str,
        wait_key: Optional[str],
        payload: Dict[str, Any],
        max_steps: int = 0,
    ) -> _FakeRunState:
        # Bring a WAITING run back to RUNNING so the WS loop can tick it.
        st = self._states[run_id]
        st.status = RunStatus.RUNNING
        st.waiting = None
        # Store payload so tests/debugging can inspect if needed.
        st.vars.setdefault("_temp", {})["resume_payload"] = payload
        return st

    def get_node_traces(self, run_id: str) -> Dict[str, Any]:
        return {}


@dataclass
class _FakeWorkflow:
    workflow_id: str


class _FakeFlowNode:
    def __init__(self, *, effect_type: Optional[str] = None) -> None:
        self.effect_type = effect_type


class _FakeFlow:
    def __init__(self) -> None:
        self._node_outputs: Dict[str, Any] = {}
        self.nodes = {"root_node": _FakeFlowNode(effect_type="start_subworkflow")}


class _FakeRunner:
    def __init__(self, *, runtime: _FakeRuntime, workflow_id: str, run_id: str) -> None:
        self.runtime = runtime
        self.workflow = _FakeWorkflow(workflow_id=workflow_id)
        self.flow = _FakeFlow()
        self.run_id = run_id

    def get_state(self) -> _FakeRunState:
        return self.runtime.get_state(self.run_id)

    def step(self) -> _FakeRunState:
        # Root is driven by runner.step() in WS loop.
        st = self.runtime.get_state(self.run_id)
        if st.status == RunStatus.RUNNING:
            st.status = RunStatus.COMPLETED
            st.current_node = None
            st.output = {"success": True}
            st.waiting = None
        return self.runtime.get_state(self.run_id)


def test_ws_ticks_descendant_runs_to_avoid_nested_subworkflow_deadlock() -> None:
    import web.backend.routes.ws as ws_routes

    class _CapturingWebSocket:
        def __init__(self) -> None:
            self.sent: list[dict] = []

        async def send_json(self, data: Any) -> None:
            assert isinstance(data, dict)
            self.sent.append(data)

    root_run_id = "run_root"
    child_run_id = "run_child"
    grandchild_run_id = "run_grandchild"

    wf_root = "wf_root"
    wf_child = "wf_child"
    wf_grandchild = "wf_grandchild"

    # Root waits on child; child waits on grandchild; grandchild is runnable.
    root_state = _FakeRunState(
        run_id=root_run_id,
        workflow_id=wf_root,
        status=RunStatus.WAITING,
        current_node="root_node",
        vars={},
        waiting=WaitState(
            reason=WaitReason.SUBWORKFLOW,
            wait_key=f"subworkflow:{child_run_id}",
            resume_to_node="after_child",
            result_key="_temp.effects.root_node",
            details={"sub_run_id": child_run_id, "sub_workflow_id": wf_child},
        ),
        parent_run_id=None,
    )
    child_state = _FakeRunState(
        run_id=child_run_id,
        workflow_id=wf_child,
        status=RunStatus.WAITING,
        current_node="child_node",
        vars={},
        waiting=WaitState(
            reason=WaitReason.SUBWORKFLOW,
            wait_key=f"subworkflow:{grandchild_run_id}",
            resume_to_node="after_grandchild",
            result_key="_temp.effects.child_node",
            details={"sub_run_id": grandchild_run_id, "sub_workflow_id": wf_grandchild},
        ),
        parent_run_id=root_run_id,
    )
    grandchild_state = _FakeRunState(
        run_id=grandchild_run_id,
        workflow_id=wf_grandchild,
        status=RunStatus.RUNNING,
        current_node="grandchild_node",
        vars={},
        parent_run_id=child_run_id,
    )

    runtime = _FakeRuntime(
        states={
            root_run_id: root_state,
            child_run_id: child_state,
            grandchild_run_id: grandchild_state,
        },
        workflow_registry={
            wf_root: object(),
            wf_child: object(),
            wf_grandchild: object(),
        },
    )
    runner = _FakeRunner(runtime=runtime, workflow_id=wf_root, run_id=root_run_id)
    ws = _CapturingWebSocket()

    async def _drive() -> None:
        # Without descendant ticking, this would deadlock forever.
        with anyio.fail_after(1.0):
            await ws_routes._execute_runner_loop(ws, runner, "conn_fake")  # type: ignore[arg-type]

    anyio.run(_drive)

    # Grandchild must have been ticked to completion, otherwise the chain can't resolve.
    assert runtime.get_state(grandchild_run_id).status == RunStatus.COMPLETED


