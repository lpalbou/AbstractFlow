"""Flow execution service - converts visual flows to AbstractFlow.

This module handles the conversion from visual flow definitions (from the editor)
to executable AbstractFlow objects, with proper handling of:
- Execution edges: Control the order of node execution
- Data edges: Map outputs from one node to inputs of another
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
import datetime

# Add abstractflow to path for imports
abstractflow_path = Path(__file__).parent.parent.parent.parent
if str(abstractflow_path) not in sys.path:
    sys.path.insert(0, str(abstractflow_path))

from abstractflow import Flow, FlowRunner
from ..models import VisualFlow, VisualEdge, NodeType
from .builtins import get_builtin_handler
from .code_executor import create_code_handler


# Type alias for data edge mapping
# Maps target_node_id -> { target_pin -> (source_node_id, source_pin) }
DataEdgeMap = Dict[str, Dict[str, tuple]]


def _build_data_edge_map(edges: List[VisualEdge]) -> DataEdgeMap:
    """Build a mapping of data edges for input resolution.

    Returns a dict where:
    - Key: target node ID
    - Value: dict mapping target pin ID -> (source node ID, source pin ID)
    """
    data_edges: DataEdgeMap = {}

    for edge in edges:
        # Skip execution edges
        if edge.sourceHandle == "exec-out" or edge.targetHandle == "exec-in":
            continue

        # This is a data edge
        if edge.target not in data_edges:
            data_edges[edge.target] = {}

        data_edges[edge.target][edge.targetHandle] = (edge.source, edge.sourceHandle)

    return data_edges


def visual_to_flow(visual: VisualFlow) -> Flow:
    """Convert a visual flow definition to an AbstractFlow.

    Args:
        visual: The visual flow from the editor

    Returns:
        A Flow object ready for compilation and execution
    """
    flow = Flow(visual.id)

    # Build data edge map for input resolution
    data_edge_map = _build_data_edge_map(visual.edges)

    # Store node outputs during execution
    # This will be populated during runtime
    flow._node_outputs: Dict[str, Dict[str, Any]] = {}
    flow._data_edge_map = data_edge_map

    # Add nodes with wrapped handlers that resolve data edges
    for node in visual.nodes:
        base_handler = _create_handler(node.type, node.data)

        # Wrap the handler to resolve data edges
        wrapped_handler = _create_data_aware_handler(
            node_id=node.id,
            base_handler=base_handler,
            data_edges=data_edge_map.get(node.id, {}),
            node_outputs=flow._node_outputs,
        )

        # Determine input/output keys from node data
        input_key = node.data.get("inputKey")
        output_key = node.data.get("outputKey")

        flow.add_node(
            node_id=node.id,
            handler=wrapped_handler,
            input_key=input_key,
            output_key=output_key,
        )

    # Only add execution edges - these control the flow execution order
    for edge in visual.edges:
        if edge.sourceHandle == "exec-out" and edge.targetHandle == "exec-in":
            flow.add_edge(edge.source, edge.target)

    # Set entry node
    if visual.entryNode:
        flow.set_entry(visual.entryNode)
    elif visual.nodes:
        # Try to find a node with no incoming execution edges
        targets = {e.target for e in visual.edges if e.targetHandle == "exec-in"}
        for node in visual.nodes:
            if node.id not in targets:
                flow.set_entry(node.id)
                break
        # Fallback to first node
        if not flow.entry_node:
            flow.set_entry(visual.nodes[0].id)

    return flow


def _create_data_aware_handler(
    node_id: str,
    base_handler,
    data_edges: Dict[str, tuple],
    node_outputs: Dict[str, Dict[str, Any]],
):
    """Wrap a handler to resolve data edge inputs before execution.

    Args:
        node_id: ID of this node
        base_handler: The original handler function
        data_edges: Mapping of input pin -> (source_node, source_pin)
        node_outputs: Shared dict storing outputs from executed nodes
    """

    def wrapped_handler(input_data):
        # Build the resolved input by mapping data edges
        resolved_input = {}

        # Start with any input data passed through execution flow
        if isinstance(input_data, dict):
            resolved_input.update(input_data)

        # Override with values from connected data edges
        for target_pin, (source_node, source_pin) in data_edges.items():
            if source_node in node_outputs:
                source_output = node_outputs[source_node]
                if isinstance(source_output, dict) and source_pin in source_output:
                    resolved_input[target_pin] = source_output[source_pin]
                elif source_pin == "result":
                    # If looking for 'result' but output isn't a dict, use the whole output
                    resolved_input[target_pin] = source_output

        # Execute the base handler with resolved input
        result = base_handler(resolved_input if resolved_input else input_data)

        # Store this node's output for downstream nodes
        node_outputs[node_id] = result

        return result

    return wrapped_handler


def _create_handler(node_type: NodeType, data: Dict[str, Any]) -> Any:
    """Create a handler function for a node type."""
    type_str = node_type.value if isinstance(node_type, NodeType) else str(node_type)

    # Check for built-in handler
    builtin = get_builtin_handler(type_str)
    if builtin:
        return _wrap_builtin(builtin, data)

    # Handle special node types
    if type_str == "code":
        # Custom Python code
        code = data.get("code", "def transform(input):\n    return input")
        function_name = data.get("functionName", "transform")
        return create_code_handler(code, function_name)

    if type_str == "agent":
        # Agent node - return placeholder that will be replaced
        # In production, this would create an actual agent
        return _create_agent_placeholder(data)

    if type_str == "subflow":
        # Subflow node - would need the nested flow to be compiled
        return _create_subflow_placeholder(data)

    if type_str == "function":
        # Generic function - check for inline code or expression
        if "code" in data:
            return create_code_handler(data["code"], data.get("functionName", "transform"))
        elif "expression" in data:
            return _create_expression_handler(data["expression"])
        else:
            # Identity function
            return lambda x: x

    # Event/Trigger nodes - entry points
    if type_str in ("on_user_request", "on_agent_message", "on_schedule"):
        return _create_event_handler(type_str, data)

    # Control flow nodes
    if type_str == "if":
        return _create_if_handler(data)
    if type_str == "switch":
        return _create_switch_handler(data)
    if type_str == "loop":
        return _create_loop_handler(data)

    # Unknown type - return identity
    return lambda x: x


def _wrap_builtin(handler, data: Dict[str, Any]):
    """Wrap a builtin handler to handle input mapping."""

    def wrapped(input_data):
        # If input is already a dict with the expected keys, use directly
        if isinstance(input_data, dict):
            return handler(input_data)
        # Otherwise, use the input as the first argument
        return handler({"value": input_data, "a": input_data, "text": input_data})

    return wrapped


def _create_agent_placeholder(data: Dict[str, Any]):
    """Create a placeholder for agent nodes.

    In a full implementation, this would create an actual agent instance.
    """
    provider = data.get("agentConfig", {}).get("provider", "unknown")
    model = data.get("agentConfig", {}).get("model", "unknown")

    def placeholder(input_data):
        task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
        context = input_data.get("context", {}) if isinstance(input_data, dict) else {}
        return {
            "result": f"[Agent ({provider}/{model}) would process: {task}]",
            "task": task,
            "context": context,
            "success": True,
            "note": "This is a placeholder. Configure agent provider to enable real execution.",
        }

    return placeholder


def _create_subflow_placeholder(data: Dict[str, Any]):
    """Create a placeholder for subflow nodes."""

    def placeholder(input_data):
        flow_id = data.get("flowId", "unknown")
        return {
            "result": f"[Subflow '{flow_id}' would execute here]",
            "success": True,
        }

    return placeholder


def _create_event_handler(event_type: str, data: Dict[str, Any]):
    """Create a handler for event/trigger nodes.

    Event nodes are entry points that pass through input data
    with the appropriate output structure.
    """

    def handler(input_data):
        if event_type == "on_user_request":
            # Extract message and context from input
            message = input_data.get("message", "") if isinstance(input_data, dict) else str(input_data)
            context = input_data.get("context", {}) if isinstance(input_data, dict) else {}
            return {
                "message": message,
                "context": context,
            }
        elif event_type == "on_agent_message":
            # Agent message event
            sender = input_data.get("sender", "unknown") if isinstance(input_data, dict) else "unknown"
            message = input_data.get("message", "") if isinstance(input_data, dict) else str(input_data)
            channel = data.get("eventConfig", {}).get("channel", "")
            return {
                "sender": sender,
                "message": message,
                "channel": channel,
            }
        elif event_type == "on_schedule":
            # Scheduled event
            return {
                "timestamp": datetime.datetime.utcnow().isoformat(),
            }
        else:
            # Unknown event type - pass through
            return input_data

    return handler


def _create_expression_handler(expression: str):
    """Create a handler that evaluates a simple expression."""
    # Very limited expression evaluation for safety
    # Only supports basic arithmetic and variable access

    def handler(input_data):
        # Create a safe namespace
        namespace = {"x": input_data, "input": input_data}
        if isinstance(input_data, dict):
            namespace.update(input_data)

        try:
            # Only allow simple expressions
            result = eval(expression, {"__builtins__": {}}, namespace)
            return result
        except Exception as e:
            return {"error": str(e)}

    return handler


def _create_if_handler(data: Dict[str, Any]):
    """Create an if/else handler."""

    def handler(input_data):
        condition = input_data.get("condition") if isinstance(input_data, dict) else bool(input_data)
        return {"branch": "true" if condition else "false", "condition": condition}

    return handler


def _create_switch_handler(data: Dict[str, Any]):
    """Create a switch handler."""

    def handler(input_data):
        value = input_data.get("value") if isinstance(input_data, dict) else input_data
        cases = data.get("cases", {})
        matched = cases.get(str(value), "default")
        return {"branch": matched, "value": value}

    return handler


def _create_loop_handler(data: Dict[str, Any]):
    """Create a loop handler."""

    def handler(input_data):
        items = input_data.get("items") if isinstance(input_data, dict) else input_data
        if not isinstance(items, (list, tuple)):
            items = [items]
        return {"items": items, "count": len(items)}

    return handler


def execute_flow(flow: Flow, input_data: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a flow and return the result.

    Args:
        flow: The compiled Flow object
        input_data: Initial input data for the flow

    Returns:
        The flow's output dictionary
    """
    # Clear any previous outputs
    if hasattr(flow, '_node_outputs'):
        flow._node_outputs.clear()

    runner = FlowRunner(flow)
    result = runner.run(input_data)
    return {
        "result": result.get("result") if isinstance(result, dict) else result,
        "success": result.get("success", True) if isinstance(result, dict) else True,
        "run_id": runner.run_id,
    }
