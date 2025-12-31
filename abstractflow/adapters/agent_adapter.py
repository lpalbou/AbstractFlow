"""Adapter for using AbstractAgent agents as flow nodes."""

from __future__ import annotations

from typing import Any, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from abstractruntime.core.models import RunState, StepPlan
    from abstractagent.agents.base import BaseAgent


def create_agent_node_handler(
    node_id: str,
    agent: "BaseAgent",
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that runs an agent as a subworkflow.

    Agent nodes execute the full agent workflow (ReAct loop, CodeAct, etc.)
    as a subworkflow. The agent runs to completion before transitioning.

    Args:
        node_id: Unique identifier for this node
        agent: The agent instance to run
        next_node: ID of the next node to transition to (None for terminal)
        input_key: Key in run.vars to read task/input from
        output_key: Key in run.vars to write agent output to

    Returns:
        A node handler function compatible with AbstractRuntime

    Example:
        >>> from abstractagent import create_react_agent
        >>> planner = create_react_agent(provider="ollama", model="qwen3:4b")
        >>> handler = create_agent_node_handler("plan", planner, "search")
    """
    from abstractruntime.core.models import Effect, EffectType, StepPlan

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Start the agent as a subworkflow."""
        # Determine task for the agent
        task = ""

        if input_key:
            input_data = run.vars.get(input_key, {})
            if isinstance(input_data, dict):
                task = input_data.get("task", "") or input_data.get("query", "")
                if not task:
                    # Use the whole input as context
                    task = str(input_data)
            else:
                task = str(input_data)

        # Fallback to flow's main task
        if not task:
            context = run.vars.get("context", {})
            if isinstance(context, dict):
                task = context.get("task", "")

        if not task:
            task = f"Execute {node_id} step"

        # Build initial vars for the agent subworkflow
        max_iterations = getattr(agent, "_max_iterations", 25)
        max_history_messages = getattr(agent, "_max_history_messages", -1)
        max_tokens = getattr(agent, "_max_tokens", None)
        if not isinstance(max_tokens, int) or max_tokens <= 0:
            try:
                runtime = getattr(agent, "runtime", None)
                config = getattr(runtime, "config", None)
                base = config.to_limits_dict() if config is not None else {}
                max_tokens = int(base.get("max_tokens", 32768) or 32768)
            except Exception:
                max_tokens = 32768

        agent_vars = {
            "context": {
                "task": task,
                "messages": [],
            },
            "scratchpad": {
                "iteration": 0,
                "max_iterations": max_iterations,
                "max_history_messages": max_history_messages,
            },
            "_runtime": {"inbox": []},
            "_temp": {},
            # Canonical _limits namespace for runtime awareness
            "_limits": {
                "max_iterations": max_iterations,
                "current_iteration": 0,
                "max_tokens": max_tokens,
                "max_history_messages": max_history_messages,
                "estimated_tokens_used": 0,
                "warn_iterations_pct": 80,
                "warn_tokens_pct": 80,
            },
        }

        # Inject any additional context from the flow
        if input_key and isinstance(run.vars.get(input_key), dict):
            # Merge additional context
            for k, v in run.vars.get(input_key, {}).items():
                if k not in ("task", "query"):
                    agent_vars["context"][k] = v

        # Use START_SUBWORKFLOW effect to run agent durably
        return StepPlan(
            node_id=node_id,
            effect=Effect(
                type=EffectType.START_SUBWORKFLOW,
                payload={
                    "workflow_id": agent.workflow.workflow_id,
                    "vars": agent_vars,
                    "async": False,  # Sync: wait for completion
                },
                result_key=output_key or f"_flow.{node_id}.result",
            ),
            next_node=next_node,
        )

    return handler
