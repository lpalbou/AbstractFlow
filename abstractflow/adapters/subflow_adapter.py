"""Adapter for using nested flows as flow nodes."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from abstractruntime.core.models import RunState, StepPlan
    from abstractruntime.core.spec import WorkflowSpec


def create_subflow_node_handler(
    node_id: str,
    nested_workflow: "WorkflowSpec",
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that runs a nested flow as a subworkflow.

    Subflow nodes enable hierarchical flow composition. A nested flow runs
    as a subworkflow with its own state, completing before the parent continues.

    Args:
        node_id: Unique identifier for this node
        nested_workflow: The compiled WorkflowSpec of the nested flow
        next_node: ID of the next node to transition to (None for terminal)
        input_key: Key in run.vars to read input from
        output_key: Key in run.vars to write output to

    Returns:
        A node handler function compatible with AbstractRuntime

    Example:
        >>> inner_flow = Flow("preprocessing")
        >>> # ... define inner flow ...
        >>> inner_spec = compile_flow(inner_flow)
        >>> handler = create_subflow_node_handler("preprocess", inner_spec, "main")
    """
    from abstractruntime.core.models import Effect, EffectType, StepPlan

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Start the nested flow as a subworkflow."""
        # Get input from parent flow's vars
        subflow_vars: Dict[str, Any] = {}

        if input_key:
            input_data = run.vars.get(input_key, {})
            if isinstance(input_data, dict):
                subflow_vars = dict(input_data)
            else:
                subflow_vars = {"input": input_data}
        else:
            # Copy relevant vars to subflow
            subflow_vars = {
                "context": run.vars.get("context", {}),
            }

        # Use START_SUBWORKFLOW effect
        return StepPlan(
            node_id=node_id,
            effect=Effect(
                type=EffectType.START_SUBWORKFLOW,
                payload={
                    "workflow_id": nested_workflow.workflow_id,
                    "vars": subflow_vars,
                    "async": False,  # Sync: wait for completion
                },
                result_key=output_key or f"_flow.{node_id}.result",
            ),
            next_node=next_node,
        )

    return handler
