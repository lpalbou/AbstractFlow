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
        from abstractruntime.core.models import RunStatus

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
