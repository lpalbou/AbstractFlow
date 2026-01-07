"""FlowRunner - executes flows using AbstractRuntime."""

from __future__ import annotations

from typing import Any, Dict, Optional, TYPE_CHECKING

from .core.flow import Flow
from .compiler import compile_flow

if TYPE_CHECKING:
    from abstractruntime.core.models import RunState
    from abstractruntime.core.runtime import Runtime
    from abstractruntime.core.spec import WorkflowSpec


class FlowRunner:
    """Executes flows using AbstractRuntime.

    FlowRunner provides a high-level interface for running flows. It handles:
    - Compiling the flow to a WorkflowSpec
    - Creating a default runtime if not provided
    - Managing run lifecycle (start, step, run, resume)

    Example:
        >>> flow = Flow("my_flow")
        >>> flow.add_node("start", lambda x: x * 2, input_key="value")
        >>> flow.set_entry("start")
        >>>
        >>> runner = FlowRunner(flow)
        >>> result = runner.run({"value": 21})
        >>> print(result)  # {'result': 42, 'success': True}
    """

    def __init__(
        self,
        flow: Flow,
        runtime: Optional["Runtime"] = None,
    ):
        """Initialize a FlowRunner.

        Args:
            flow: The Flow definition to run
            runtime: Optional AbstractRuntime instance. If not provided,
                     a default in-memory runtime will be created.
        """
        self.flow = flow
        self.workflow: "WorkflowSpec" = compile_flow(flow)
        self.runtime = runtime or self._create_default_runtime()
        self._current_run_id: Optional[str] = None

    def _create_default_runtime(self) -> "Runtime":
        """Create a default in-memory runtime."""
        try:
            from abstractruntime import Runtime, InMemoryRunStore, InMemoryLedgerStore  # type: ignore
        except Exception:  # pragma: no cover
            from abstractruntime.core.runtime import Runtime  # type: ignore
            from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore  # type: ignore

        return Runtime(
            run_store=InMemoryRunStore(),
            ledger_store=InMemoryLedgerStore(),
        )

    @property
    def run_id(self) -> Optional[str]:
        """Get the current run ID."""
        return self._current_run_id

    def start(self, input_data: Optional[Dict[str, Any]] = None) -> str:
        """Start flow execution.

        Args:
            input_data: Initial variables for the flow

        Returns:
            The run ID for this execution
        """
        vars_dict = input_data or {}
        self._current_run_id = self.runtime.start(
            workflow=self.workflow,
            vars=vars_dict,
        )
        return self._current_run_id

    def step(self, max_steps: int = 1) -> "RunState":
        """Execute one or more steps.

        Args:
            max_steps: Maximum number of steps to execute

        Returns:
            The current RunState after stepping

        Raises:
            ValueError: If no run has been started
        """
        if not self._current_run_id:
            raise ValueError("No active run. Call start() first.")

        return self.runtime.tick(
            workflow=self.workflow,
            run_id=self._current_run_id,
            max_steps=max_steps,
        )

    def run(self, input_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute flow to completion.

        This method starts the flow and runs until it completes, fails,
        or enters a waiting state.

        Args:
            input_data: Initial variables for the flow

        Returns:
            The flow's output dictionary. If the flow is waiting,
            returns {"waiting": True, "state": <RunState>}.

        Raises:
            RuntimeError: If the flow fails
        """
        from abstractruntime.core.models import RunStatus, WaitReason

        self.start(input_data)

        while True:
            state = self.runtime.tick(
                workflow=self.workflow,
                run_id=self._current_run_id,
            )

            if state.status == RunStatus.COMPLETED:
                return state.output or {}

            if state.status == RunStatus.FAILED:
                raise RuntimeError(f"Flow failed: {state.error}")

            if state.status == RunStatus.WAITING:
                # Convenience: when waiting on a SUBWORKFLOW, FlowRunner.run() can
                # auto-drive the child to completion and resume the parent.
                #
                # Visual Agent nodes use async+wait START_SUBWORKFLOW so web hosts
                # can stream traces. In non-interactive contexts (unit tests, CLI),
                # we still want a synchronous `run()` to complete when possible.
                wait = getattr(state, "waiting", None)
                if (
                    wait is not None
                    and getattr(wait, "reason", None) == WaitReason.SUBWORKFLOW
                    and getattr(self.runtime, "workflow_registry", None) is not None
                ):
                    registry = getattr(self.runtime, "workflow_registry", None)

                    def _extract_sub_run_id(wait_state: Any) -> Optional[str]:
                        details2 = getattr(wait_state, "details", None)
                        if isinstance(details2, dict):
                            rid2 = details2.get("sub_run_id")
                            if isinstance(rid2, str) and rid2:
                                return rid2
                        wk = getattr(wait_state, "wait_key", None)
                        if isinstance(wk, str) and wk.startswith("subworkflow:"):
                            return wk.split("subworkflow:", 1)[1] or None
                        return None

                    def _spec_for(run_state: Any):
                        wf_id = getattr(run_state, "workflow_id", None)
                        # FlowRunner always has the root workflow spec (self.workflow).
                        # The runtime registry is required only for *child* workflows.
                        #
                        # Without this fallback, synchronous `FlowRunner.run()` can hang on
                        # SUBWORKFLOW waits if callers register only subworkflows (common in
                        # unit tests where the parent spec is not registered).
                        if wf_id == getattr(self.workflow, "workflow_id", None):
                            return self.workflow
                        return registry.get(wf_id) if registry is not None else None

                    top_run_id = self._current_run_id  # type: ignore[assignment]
                    if isinstance(top_run_id, str) and top_run_id:
                        # Find the deepest run in a SUBWORKFLOW wait chain.
                        target_run_id = top_run_id
                        for _ in range(50):
                            cur_state = self.runtime.get_state(target_run_id)
                            if cur_state.status != RunStatus.WAITING or cur_state.waiting is None:
                                break
                            if cur_state.waiting.reason != WaitReason.SUBWORKFLOW:
                                break
                            next_id = _extract_sub_run_id(cur_state.waiting)
                            if not next_id:
                                break
                            target_run_id = next_id

                        # Drive runs bottom-up: tick the deepest runnable run, then bubble completion
                        # payloads to waiting parents until we either block on external input or
                        # the chain unwinds.
                        current_run_id = target_run_id
                        for _ in range(10_000):
                            cur_state = self.runtime.get_state(current_run_id)
                            if cur_state.status == RunStatus.RUNNING:
                                wf = _spec_for(cur_state)
                                if wf is None:
                                    break
                                cur_state = self.runtime.tick(workflow=wf, run_id=current_run_id)

                            if cur_state.status == RunStatus.WAITING:
                                # If this is a subworkflow wait, descend further.
                                if cur_state.waiting is not None and cur_state.waiting.reason == WaitReason.SUBWORKFLOW:
                                    next_id = _extract_sub_run_id(cur_state.waiting)
                                    if next_id:
                                        current_run_id = next_id
                                        continue
                                # Blocked on non-subworkflow input (ASK_USER / EVENT / UNTIL).
                                break

                            if cur_state.status == RunStatus.FAILED:
                                raise RuntimeError(f"Subworkflow failed: {cur_state.error}")
                            if cur_state.status == RunStatus.CANCELLED:
                                raise RuntimeError("Subworkflow cancelled")
                            if cur_state.status != RunStatus.COMPLETED:
                                break

                            parent_id = getattr(cur_state, "parent_run_id", None)
                            if not isinstance(parent_id, str) or not parent_id:
                                break

                            parent_state = self.runtime.get_state(parent_id)
                            if (
                                parent_state.status == RunStatus.WAITING
                                and parent_state.waiting is not None
                                and parent_state.waiting.reason == WaitReason.SUBWORKFLOW
                            ):
                                parent_wf = _spec_for(parent_state)
                                if parent_wf is None:
                                    break

                                node_traces = None
                                try:
                                    node_traces = self.runtime.get_node_traces(cur_state.run_id)
                                except Exception:
                                    node_traces = None

                                self.runtime.resume(
                                    workflow=parent_wf,
                                    run_id=parent_id,
                                    wait_key=None,
                                    payload={
                                        "sub_run_id": cur_state.run_id,
                                        "output": cur_state.output,
                                        "node_traces": node_traces,
                                    },
                                    max_steps=0,
                                )
                                current_run_id = parent_id
                                # Continue bubbling (and ticking resumed parents) until we unwind.
                                continue

                            break

                        # After driving/bubbling, re-enter the main loop and tick the top run again.
                        continue

                # Flow is waiting for external input
                return {
                    "waiting": True,
                    "state": state,
                    "wait_key": state.waiting.wait_key if state.waiting else None,
                }

    def resume(
        self,
        wait_key: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        *,
        max_steps: int = 100,
    ) -> "RunState":
        """Resume a waiting flow.

        Args:
            wait_key: The wait key to resume (optional, uses current if not specified)
            payload: Data to provide to the waiting node

        Returns:
            The RunState after resuming
        """
        if not self._current_run_id:
            raise ValueError("No active run to resume.")

        return self.runtime.resume(
            workflow=self.workflow,
            run_id=self._current_run_id,
            wait_key=wait_key,
            payload=payload or {},
            max_steps=max_steps,
        )

    def get_state(self) -> Optional["RunState"]:
        """Get the current run state.

        Returns:
            The current RunState, or None if no run is active
        """
        if not self._current_run_id:
            return None
        return self.runtime.get_state(self._current_run_id)

    def get_ledger(self) -> list:
        """Get the execution ledger for the current run.

        Returns:
            List of step records, or empty list if no run
        """
        if not self._current_run_id:
            return []
        return self.runtime.get_ledger(self._current_run_id)

    def is_running(self) -> bool:
        """Check if the flow is currently running."""
        from abstractruntime.core.models import RunStatus

        state = self.get_state()
        return state is not None and state.status == RunStatus.RUNNING

    def is_waiting(self) -> bool:
        """Check if the flow is waiting for input."""
        from abstractruntime.core.models import RunStatus

        state = self.get_state()
        return state is not None and state.status == RunStatus.WAITING

    def is_complete(self) -> bool:
        """Check if the flow has completed."""
        from abstractruntime.core.models import RunStatus

        state = self.get_state()
        return state is not None and state.status == RunStatus.COMPLETED

    def is_failed(self) -> bool:
        """Check if the flow has failed."""
        from abstractruntime.core.models import RunStatus

        state = self.get_state()
        return state is not None and state.status == RunStatus.FAILED

    def __repr__(self) -> str:
        status = "not started"
        if self._current_run_id:
            state = self.get_state()
            if state:
                status = state.status.value
        return f"FlowRunner(flow={self.flow.flow_id!r}, status={status!r})"
