"""Session-aware runner for VisualFlow executions.

This runner extends FlowRunner with:
- A durable session_id (defaults to root run_id)
- Auto-started custom event listener workflows ("On Event" nodes)

This keeps VisualFlow JSON portable: any host can execute a visual flow and its
event listeners using AbstractRuntime's durable semantics.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TYPE_CHECKING

from ..runner import FlowRunner

if TYPE_CHECKING:
    from abstractruntime.core.runtime import Runtime
    from abstractruntime.core.spec import WorkflowSpec


class VisualSessionRunner(FlowRunner):
    """FlowRunner that starts event listener workflows within the same session."""

    def __init__(
        self,
        flow: Any,
        *,
        runtime: Optional["Runtime"] = None,
        event_listener_specs: Optional[List["WorkflowSpec"]] = None,
    ) -> None:
        super().__init__(flow, runtime=runtime)
        self._event_listener_specs: List["WorkflowSpec"] = list(event_listener_specs or [])
        self._event_listener_run_ids: List[str] = []

    @property
    def event_listener_run_ids(self) -> List[str]:
        return list(self._event_listener_run_ids)

    def start(self, input_data: Optional[Dict[str, Any]] = None) -> str:
        run_id = super().start(input_data)

        # Default session_id to the root run_id for session-scoped events.
        try:
            state = self.runtime.get_state(run_id)
            if not getattr(state, "session_id", None):
                state.session_id = run_id  # type: ignore[attr-defined]
                self.runtime.run_store.save(state)
        except Exception:
            # Best-effort; session-scoped keys will fall back to run_id if missing.
            pass

        if not self._event_listener_specs:
            return run_id

        # Start listeners as child runs in the same session.
        for spec in self._event_listener_specs:
            try:
                child_run_id = self.runtime.start(
                    workflow=spec,
                    vars={},
                    session_id=run_id,
                    parent_run_id=run_id,
                )
                # Advance the listener to its first WAIT_EVENT (On Event node).
                self.runtime.tick(workflow=spec, run_id=child_run_id, max_steps=10)
                self._event_listener_run_ids.append(child_run_id)
            except Exception:
                # Listener start failures should surface during execution, but
                # we don't want to hide root runs from starting.
                continue

        return run_id

    def run(self, input_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute the root run and drive session-level listener runs.

        Rationale:
        - `EMIT_EVENT` resumes listener runs but does not (by default) execute them.
        - Hosts that only "run the main workflow" should still see event handler branches run.
        """
        from abstractruntime.core.models import RunStatus, WaitReason

        run_id = self.start(input_data)
        runtime = self.runtime

        def _list_session_runs() -> List[str]:
            out: List[str] = [run_id]
            try:
                rs = getattr(runtime, "run_store", None)
                if rs is not None and hasattr(rs, "list_children"):
                    children = rs.list_children(parent_run_id=run_id)  # type: ignore[attr-defined]
                    for c in children:
                        cid = getattr(c, "run_id", None)
                        if isinstance(cid, str) and cid and cid not in out:
                            out.append(cid)
            except Exception:
                pass
            for cid in self._event_listener_run_ids:
                if cid not in out:
                    out.append(cid)
            return out

        def _tick_child(child_run_id: str, *, max_steps: int = 100) -> None:
            st = runtime.get_state(child_run_id)
            if st.status != RunStatus.RUNNING:
                # WAIT_UNTIL can auto-unblock, so still call tick() to allow progress.
                if st.status == RunStatus.WAITING and st.waiting and st.waiting.reason == WaitReason.UNTIL:
                    pass
                else:
                    return
            reg = getattr(runtime, "workflow_registry", None)
            if reg is None:
                return
            wf = reg.get(st.workflow_id)
            if wf is None:
                return
            runtime.tick(workflow=wf, run_id=child_run_id, max_steps=max_steps)

        while True:
            state = runtime.tick(workflow=self.workflow, run_id=run_id, max_steps=100)

            # Drive children that became RUNNING due to EMIT_EVENT (or subflows).
            for cid in _list_session_runs():
                if cid == run_id:
                    continue
                _tick_child(cid, max_steps=100)

            # Root completion/termination conditions.
            if state.status == RunStatus.COMPLETED:
                # If all children are idle listeners (WAITING EVENT) or terminal, close the session.
                all_idle_or_done = True
                for cid in _list_session_runs():
                    if cid == run_id:
                        continue
                    st = runtime.get_state(cid)
                    if st.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
                        continue
                    if st.status == RunStatus.WAITING and st.waiting and st.waiting.reason == WaitReason.EVENT:
                        continue
                    all_idle_or_done = False
                if all_idle_or_done:
                    # Cancel idle listeners to keep the session tidy.
                    for cid in _list_session_runs():
                        if cid == run_id:
                            continue
                        st = runtime.get_state(cid)
                        if st.status == RunStatus.WAITING and st.waiting and st.waiting.reason == WaitReason.EVENT:
                            try:
                                runtime.cancel_run(cid, reason="Session completed")
                            except Exception:
                                pass
                    return state.output or {}
                # Otherwise, keep driving until children settle into waits/terminal.
                continue

            if state.status == RunStatus.FAILED:
                raise RuntimeError(f"Flow failed: {state.error}")

            if state.status == RunStatus.WAITING:
                # Preserve FlowRunner shape.
                return {
                    "waiting": True,
                    "state": state,
                    "wait_key": state.waiting.wait_key if state.waiting else None,
                }


