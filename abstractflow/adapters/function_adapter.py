"""Adapter for using Python functions as flow nodes."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from abstractruntime.core.models import RunState, StepPlan


def create_function_node_handler(
    node_id: str,
    func: Callable[[Any], Any],
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that runs a Python function.

    Function nodes execute synchronously within the workflow. They're ideal for:
    - Data transformations
    - Validation logic
    - Aggregating results from previous nodes

    Args:
        node_id: Unique identifier for this node
        func: The function to execute. Receives input data and returns result.
        next_node: ID of the next node to transition to (None for terminal)
        input_key: Key in run.vars to read input from (uses full vars if not set)
        output_key: Key in run.vars to write output to

    Returns:
        A node handler function compatible with AbstractRuntime

    Example:
        >>> def double(x):
        ...     return x * 2
        >>> handler = create_function_node_handler("double", double, "next", "input", "result")
    """
    # Import here to avoid import-time dependency
    from abstractruntime.core.models import StepPlan

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Execute the function and transition to next node."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key)
        else:
            input_data = run.vars

        # Execute function
        try:
            result = func(input_data)
        except Exception as e:
            # Store error and fail the flow
            run.vars["_flow_error"] = str(e)
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"error": str(e), "success": False, "node": node_id},
            )

        # Store result in vars
        if output_key:
            _set_nested(run.vars, output_key, result)

        # Continue to next node or complete
        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        else:
            # Terminal node - complete with result
            return StepPlan(
                node_id=node_id,
                complete_output={"result": result, "success": True},
            )

    return handler


def _set_nested(target: Dict[str, Any], dotted_key: str, value: Any) -> None:
    """Set a nested dictionary value using dot notation.

    Example:
        >>> d = {}
        >>> _set_nested(d, "a.b.c", 123)
        >>> d
        {'a': {'b': {'c': 123}}}
    """
    parts = dotted_key.split(".")
    cur = target
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value
