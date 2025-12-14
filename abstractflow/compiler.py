"""Flow compiler - converts Flow definitions to AbstractRuntime WorkflowSpec."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TYPE_CHECKING

from .core.flow import Flow
from .adapters.function_adapter import create_function_node_handler
from .adapters.agent_adapter import create_agent_node_handler
from .adapters.subflow_adapter import create_subflow_node_handler

if TYPE_CHECKING:
    from abstractruntime.core.spec import WorkflowSpec


def _is_agent(obj: Any) -> bool:
    """Check if object is an agent (has workflow attribute)."""
    return hasattr(obj, "workflow") and hasattr(obj, "start") and hasattr(obj, "step")


def _is_flow(obj: Any) -> bool:
    """Check if object is a Flow."""
    return isinstance(obj, Flow)


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

        if _is_agent(handler_obj):
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
