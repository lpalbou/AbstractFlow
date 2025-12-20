"""Flow compiler - converts Flow definitions to AbstractRuntime WorkflowSpec."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TYPE_CHECKING

from .core.flow import Flow
from .adapters.function_adapter import create_function_node_handler
from .adapters.agent_adapter import create_agent_node_handler
from .adapters.subflow_adapter import create_subflow_node_handler
from .adapters.effect_adapter import (
    create_ask_user_handler,
    create_wait_until_handler,
    create_wait_event_handler,
    create_memory_note_handler,
    create_memory_query_handler,
    create_llm_call_handler,
)

if TYPE_CHECKING:
    from abstractruntime.core.spec import WorkflowSpec


def _is_agent(obj: Any) -> bool:
    """Check if object is an agent (has workflow attribute)."""
    return hasattr(obj, "workflow") and hasattr(obj, "start") and hasattr(obj, "step")


def _is_flow(obj: Any) -> bool:
    """Check if object is a Flow."""
    return isinstance(obj, Flow)


def _create_effect_node_handler(
    node_id: str,
    effect_type: str,
    effect_config: Dict[str, Any],
    next_node: Optional[str],
    input_key: Optional[str],
    output_key: Optional[str],
) -> Callable:
    """Create a node handler for effect nodes.

    Effect nodes produce AbstractRuntime Effects that can pause execution
    and wait for external input.
    """
    if effect_type == "ask_user":
        return create_ask_user_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            allow_free_text=effect_config.get("allowFreeText", True),
        )
    elif effect_type == "wait_until":
        return create_wait_until_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            duration_type=effect_config.get("durationType", "seconds"),
        )
    elif effect_type == "wait_event":
        return create_wait_event_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "memory_note":
        return create_memory_note_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "memory_query":
        return create_memory_query_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "llm_call":
        return create_llm_call_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            provider=effect_config.get("provider"),
            model=effect_config.get("model"),
            temperature=effect_config.get("temperature", 0.7),
        )
    else:
        raise ValueError(f"Unknown effect type: {effect_type}")


def compile_flow(flow: Flow) -> "WorkflowSpec":
    """Compile a Flow definition into an AbstractRuntime WorkflowSpec.

    This function transforms a declarative Flow definition into an executable
    WorkflowSpec that can be run by AbstractRuntime. Each flow node is converted
    to a workflow node handler based on its type:

    - Functions: Executed directly within the workflow
    - Agents: Run as subworkflows using START_SUBWORKFLOW effect
    - Nested Flows: Compiled recursively and run as subworkflows

    Args:
        flow: The Flow definition to compile

    Returns:
        A WorkflowSpec that can be executed by AbstractRuntime

    Raises:
        ValueError: If the flow is invalid (no entry node, missing nodes, etc.)
        TypeError: If a node handler is of unknown type

    Example:
        >>> flow = Flow("my_flow")
        >>> flow.add_node("start", my_func)
        >>> flow.set_entry("start")
        >>> spec = compile_flow(flow)
        >>> runtime.start(workflow=spec)
    """
    from abstractruntime.core.spec import WorkflowSpec

    # Validate flow
    errors = flow.validate()
    if errors:
        raise ValueError(f"Invalid flow: {'; '.join(errors)}")

    # Build adjacency map for determining next nodes
    next_node_map: Dict[str, Optional[str]] = {}
    for edge in flow.edges:
        # For now, only support single next node (no branching)
        if edge.source in next_node_map:
            raise ValueError(
                f"Node '{edge.source}' has multiple outgoing edges. "
                "Branching is not yet supported."
            )
        next_node_map[edge.source] = edge.target

    # Determine exit node if not set
    exit_node = flow.exit_node
    if not exit_node:
        terminal_nodes = flow.get_terminal_nodes()
        if len(terminal_nodes) == 1:
            exit_node = terminal_nodes[0]
        elif len(terminal_nodes) > 1:
            # Multiple terminals - each will complete the flow when reached
            pass

    # Create node handlers
    handlers: Dict[str, Callable] = {}

    for node_id, flow_node in flow.nodes.items():
        next_node = next_node_map.get(node_id)
        handler_obj = flow_node.handler
        effect_type = flow_node.effect_type
        effect_config = flow_node.effect_config or {}

        # Check for effect nodes first
        if effect_type:
            handlers[node_id] = _create_effect_node_handler(
                node_id=node_id,
                effect_type=effect_type,
                effect_config=effect_config,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
            )
        elif _is_agent(handler_obj):
            handlers[node_id] = create_agent_node_handler(
                node_id=node_id,
                agent=handler_obj,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
            )
        elif _is_flow(handler_obj):
            # Nested flow - compile recursively
            nested_spec = compile_flow(handler_obj)
            handlers[node_id] = create_subflow_node_handler(
                node_id=node_id,
                nested_workflow=nested_spec,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
            )
        elif callable(handler_obj):
            handlers[node_id] = create_function_node_handler(
                node_id=node_id,
                func=handler_obj,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
            )
        else:
            raise TypeError(
                f"Unknown handler type for node '{node_id}': {type(handler_obj)}. "
                "Expected agent, function, or Flow."
            )

    return WorkflowSpec(
        workflow_id=flow.flow_id,
        entry_node=flow.entry_node,
        nodes=handlers,
    )
