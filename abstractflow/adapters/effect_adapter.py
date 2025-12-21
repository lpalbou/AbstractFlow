"""Adapter for creating effect nodes in visual flows.

This adapter creates node handlers that produce AbstractRuntime Effects,
enabling visual flows to pause and wait for external input (user prompts,
events, delays, etc.).
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from abstractruntime.core.models import RunState, StepPlan


def create_ask_user_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
    allow_free_text: bool = True,
) -> Callable:
    """Create a node handler that asks the user for input.

    This handler produces an ASK_USER effect that pauses the flow
    until the user provides a response.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after response
        input_key: Key in run.vars to read prompt/choices from
        output_key: Key in run.vars to write the response to
        allow_free_text: Whether to allow free text response

    Returns:
        A node handler that produces ASK_USER effect
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Ask user and wait for response."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract prompt and choices
        if isinstance(input_data, dict):
            prompt = input_data.get("prompt", "Please respond:")
            choices = input_data.get("choices", [])
        else:
            prompt = str(input_data) if input_data else "Please respond:"
            choices = []

        # Ensure choices is a list
        if not isinstance(choices, list):
            choices = []

        # Create the effect
        effect = Effect(
            type=EffectType.ASK_USER,
            payload={
                "prompt": prompt,
                "choices": choices,
                "allow_free_text": allow_free_text,
            },
            result_key=output_key or "_temp.user_response",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_answer_user_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that requests the host UI to display a message.

    This handler produces an ANSWER_USER effect that completes immediately.
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        if isinstance(input_data, dict):
            message = input_data.get("message") or input_data.get("text") or ""
        else:
            message = str(input_data) if input_data is not None else ""

        effect = Effect(
            type=EffectType.ANSWER_USER,
            payload={"message": str(message)},
            result_key=output_key or "_temp.answer_user",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_wait_until_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
    duration_type: str = "seconds",
) -> Callable:
    """Create a node handler that waits until a specified time.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after waiting
        input_key: Key in run.vars to read duration from
        output_key: Key in run.vars to write the completion info to
        duration_type: How to interpret duration (seconds/minutes/hours/timestamp)

    Returns:
        A node handler that produces WAIT_UNTIL effect
    """
    from datetime import datetime, timedelta, timezone
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Wait until time and then continue."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract duration
        if isinstance(input_data, dict):
            duration = input_data.get("duration", 0)
        else:
            duration = input_data

        # Convert to seconds
        try:
            amount = float(duration) if duration else 0
        except (TypeError, ValueError):
            amount = 0

        # Calculate target time
        now = datetime.now(timezone.utc)

        if duration_type == "timestamp":
            # Already an ISO timestamp
            until = str(duration)
        elif duration_type == "minutes":
            until = (now + timedelta(minutes=amount)).isoformat()
        elif duration_type == "hours":
            until = (now + timedelta(hours=amount)).isoformat()
        else:  # seconds
            until = (now + timedelta(seconds=amount)).isoformat()

        # Create the effect
        effect = Effect(
            type=EffectType.WAIT_UNTIL,
            payload={"until": until},
            result_key=output_key or "_temp.wait_result",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_wait_event_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that waits for an external event.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after event
        input_key: Key in run.vars to read event_key from
        output_key: Key in run.vars to write the event data to

    Returns:
        A node handler that produces WAIT_EVENT effect
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Wait for event and then continue."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract event key
        if isinstance(input_data, dict):
            event_key = input_data.get("event_key", "default")
        else:
            event_key = str(input_data) if input_data else "default"

        # Create the effect
        effect = Effect(
            type=EffectType.WAIT_EVENT,
            payload={"wait_key": event_key},
            result_key=output_key or "_temp.event_data",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_memory_note_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that stores a memory note.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after storing
        input_key: Key in run.vars to read note content from
        output_key: Key in run.vars to write the note_id to

    Returns:
        A node handler that produces MEMORY_NOTE effect
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Store memory note and continue."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract content
        if isinstance(input_data, dict):
            content = input_data.get("content", "")
        else:
            content = str(input_data) if input_data else ""

        # Create the effect
        effect = Effect(
            type=EffectType.MEMORY_NOTE,
            payload={"note": content, "tags": {}},
            result_key=output_key or "_temp.note_id",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_memory_query_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
) -> Callable:
    """Create a node handler that queries memory.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after query
        input_key: Key in run.vars to read query from
        output_key: Key in run.vars to write results to

    Returns:
        A node handler that produces MEMORY_QUERY effect
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Query memory and continue."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract query params
        if isinstance(input_data, dict):
            query = input_data.get("query", "")
            limit = input_data.get("limit", 10)
        else:
            query = str(input_data) if input_data else ""
            limit = 10

        # Create the effect
        effect = Effect(
            type=EffectType.MEMORY_QUERY,
            payload={"query": query, "limit_spans": limit},
            result_key=output_key or "_temp.memory_results",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_llm_call_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    temperature: float = 0.7,
) -> Callable:
    """Create a node handler that makes an LLM call.

    Args:
        node_id: Unique identifier for this node
        next_node: ID of the next node to transition to after LLM response
        input_key: Key in run.vars to read prompt/system from
        output_key: Key in run.vars to write response to
        provider: LLM provider to use
        model: Model name to use
        temperature: Temperature parameter

    Returns:
        A node handler that produces LLM_CALL effect
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        """Make LLM call and continue."""
        # Get input from vars
        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        # Extract prompt and system
        if isinstance(input_data, dict):
            prompt = input_data.get("prompt", "")
            system = input_data.get("system", "")
        else:
            prompt = str(input_data) if input_data else ""
            system = ""

        # Build messages for LLM
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        # Create the effect
        effect = Effect(
            type=EffectType.LLM_CALL,
            payload={
                "messages": messages,
                "provider": provider,
                "model": model,
                "params": {
                    "temperature": temperature,
                },
            },
            result_key=output_key or "_temp.llm_response",
        )

        return StepPlan(
            node_id=node_id,
            effect=effect,
            next_node=next_node,
        )

    return handler


def create_start_subworkflow_handler(
    node_id: str,
    next_node: Optional[str],
    input_key: Optional[str] = None,
    output_key: Optional[str] = None,
    workflow_id: Optional[str] = None,
) -> Callable:
    """Create a node handler that starts a subworkflow by workflow id.

    This is the effect-level equivalent of `create_subflow_node_handler`, but it
    defers lookup/execution to the runtime's workflow registry.
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    def handler(run: "RunState", ctx: Any) -> "StepPlan":
        if not workflow_id:
            return StepPlan(
                node_id=node_id,
                complete_output={
                    "success": False,
                    "error": "start_subworkflow requires workflow_id (node config missing)",
                },
            )

        if input_key:
            input_data = run.vars.get(input_key, {})
        else:
            input_data = run.vars

        sub_vars: Dict[str, Any] = {}
        if isinstance(input_data, dict):
            # Prefer explicit "vars" field, else pass through common "input" field.
            if isinstance(input_data.get("vars"), dict):
                sub_vars = dict(input_data["vars"])
            elif isinstance(input_data.get("input"), dict):
                sub_vars = dict(input_data["input"])
            else:
                sub_vars = dict(input_data)
        else:
            sub_vars = {"input": input_data}

        return StepPlan(
            node_id=node_id,
            effect=Effect(
                type=EffectType.START_SUBWORKFLOW,
                payload={
                    "workflow_id": workflow_id,
                    "vars": sub_vars,
                    "async": False,
                },
                result_key=output_key or f"_temp.effects.{node_id}",
            ),
            next_node=next_node,
        )

    return handler
