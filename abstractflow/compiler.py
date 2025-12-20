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
    data_aware_handler: Optional[Callable] = None,
) -> Callable:
    """Create a node handler for effect nodes.

    Effect nodes produce AbstractRuntime Effects that can pause execution
    and wait for external input.

    If data_aware_handler is provided (from visual flow's executor), it will
    be called first to resolve data edge inputs before creating the effect.
    """
    from abstractruntime.core.models import StepPlan, Effect, EffectType

    # Build the base effect handler
    if effect_type == "ask_user":
        base_handler = create_ask_user_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            allow_free_text=effect_config.get("allowFreeText", True),
        )
    elif effect_type == "wait_until":
        base_handler = create_wait_until_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            duration_type=effect_config.get("durationType", "seconds"),
        )
    elif effect_type == "wait_event":
        base_handler = create_wait_event_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "memory_note":
        base_handler = create_memory_note_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "memory_query":
        base_handler = create_memory_query_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
        )
    elif effect_type == "llm_call":
        base_handler = create_llm_call_handler(
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

    # If no data-aware handler, just return the base effect handler
    if data_aware_handler is None:
        return base_handler

    # Wrap to resolve data edges before creating the effect
    def wrapped_effect_handler(run: Any, ctx: Any) -> "StepPlan":
        """Resolve data edges via executor handler, then create the proper Effect."""
        # Call the data-aware handler to resolve data edge inputs
        # This reads from flow._node_outputs which has literal values
        last_output = run.vars.get("_last_output", {})
        resolved = data_aware_handler(last_output)

        # Check if this returned a _pending_effect marker (from executor's effect handlers)
        if isinstance(resolved, dict) and "_pending_effect" in resolved:
            pending = resolved["_pending_effect"]
            effect_type_str = pending.get("type", "")

            # Map string to EffectType enum
            effect_type_map = {
                "ask_user": EffectType.ASK_USER,
                "llm_call": EffectType.LLM_CALL,
                "wait_until": EffectType.WAIT_UNTIL,
                "wait_event": EffectType.WAIT_EVENT,
                "memory_note": EffectType.MEMORY_NOTE,
                "memory_query": EffectType.MEMORY_QUERY,
            }

            eff_type = effect_type_map.get(effect_type_str)
            if eff_type:
                # Build the Effect with resolved values from data edges
                effect = Effect(
                    type=eff_type,
                    payload={
                        **pending,
                        "resume_to_node": next_node,
                    },
                    result_key=output_key or f"_temp.{effect_type_str}_response",
                )

                return StepPlan(
                    node_id=node_id,
                    effect=effect,
                    next_node=next_node,
                )

        # Fallback: run.vars won't have the values, but try anyway
        return base_handler(run, ctx)

    return wrapped_effect_handler


def _create_visual_function_handler(
    node_id: str,
    func: Callable,
    next_node: Optional[str],
    input_key: Optional[str],
    output_key: Optional[str],
    flow: Flow,
) -> Callable:
    """Create a handler for visual flow function nodes.

    Visual flows use data edges for passing values between nodes. This handler:
    1. Syncs effect results from run.vars to flow._node_outputs
    2. Calls the wrapped function with proper input
    3. Updates _last_output for downstream nodes
    """
    from abstractruntime.core.models import StepPlan

    def handler(run: Any, ctx: Any) -> "StepPlan":
        """Execute the function and transition to next node."""
        # Sync effect results from run.vars to flow._node_outputs
        # This allows data edges from effect nodes to resolve correctly
        if hasattr(flow, '_node_outputs') and hasattr(flow, '_data_edge_map'):
            _sync_effect_results_to_node_outputs(run, flow)

        # Get input from _last_output (visual flow pattern)
        # or from input_key if specified
        if input_key:
            input_data = run.vars.get(input_key)
        else:
            input_data = run.vars.get("_last_output", {})

        # Execute function (which is the data-aware wrapped handler)
        try:
            result = func(input_data)
        except Exception as e:
            run.vars["_flow_error"] = str(e)
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"error": str(e), "success": False, "node": node_id},
            )

        # Store result in _last_output for downstream nodes
        run.vars["_last_output"] = result

        # Also store in output_key if specified
        if output_key:
            _set_nested(run.vars, output_key, result)

        # Continue to next node or complete
        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        else:
            return StepPlan(
                node_id=node_id,
                complete_output={"result": result, "success": True},
            )

    return handler


def _sync_effect_results_to_node_outputs(run: Any, flow: Flow) -> None:
    """Sync effect results from run.vars to flow._node_outputs.

    When an effect (like ask_user) completes, its result is stored in run.vars
    at the result_key. But visual flow data edges read from flow._node_outputs.
    This function syncs those results so data edges resolve correctly.
    """
    node_outputs = flow._node_outputs
    data_edge_map = flow._data_edge_map

    # Check common effect result locations
    temp_data = run.vars.get("_temp", {})
    if not isinstance(temp_data, dict):
        return

    # Map effect result keys to their node IDs
    # We need to figure out which node produced each effect result
    for target_node, edges in data_edge_map.items():
        for target_pin, (source_node, source_pin) in edges.items():
            # Check if source node is an effect node by looking for its result in _temp
            # Effect nodes typically store results in _temp.<effect_type>_response
            for effect_type in ["ask_user", "llm_call", "wait_until", "wait_event", "memory_note", "memory_query"]:
                result_key = f"{effect_type}_response"
                if result_key in temp_data:
                    result = temp_data[result_key]
                    # If the source node's output doesn't have this pin, update it
                    if source_node in node_outputs:
                        current = node_outputs[source_node]
                        if isinstance(current, dict) and isinstance(result, dict):
                            # Merge the effect result into node outputs
                            # This allows data edges to pick up the new values
                            for key, value in result.items():
                                if key not in current or current.get(key) == f"[User prompt: {current.get('prompt', '')}]":
                                    current[key] = value


def _set_nested(target: Dict[str, Any], dotted_key: str, value: Any) -> None:
    """Set nested dict value using dot notation."""
    parts = dotted_key.split(".")
    cur = target
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


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
            # Pass the handler_obj as data_aware_handler if it's callable
            # This allows visual flows to resolve data edges before creating effects
            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = _create_effect_node_handler(
                node_id=node_id,
                effect_type=effect_type,
                effect_config=effect_config,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
                data_aware_handler=data_aware_handler,
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
            # Check if this is a visual flow handler (has closure access to node_outputs)
            # Visual flow handlers need special handling to resolve data edges
            handlers[node_id] = _create_visual_function_handler(
                node_id=node_id,
                func=handler_obj,
                next_node=next_node,
                input_key=flow_node.input_key,
                output_key=flow_node.output_key,
                flow=flow,
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
