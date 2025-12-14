"""Flow execution service - converts visual flows to AbstractFlow."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict

# Add abstractflow to path for imports
abstractflow_path = Path(__file__).parent.parent.parent.parent
if str(abstractflow_path) not in sys.path:
    sys.path.insert(0, str(abstractflow_path))

from abstractflow import Flow, FlowRunner
from ..models import VisualFlow, NodeType
from .builtins import get_builtin_handler
from .code_executor import create_code_handler


def visual_to_flow(visual: VisualFlow) -> Flow:
    """Convert a visual flow definition to an AbstractFlow.

    Args:
        visual: The visual flow from the editor

    Returns:
        A Flow object ready for compilation and execution
    """
    flow = Flow(visual.id)

    # Track which edge goes where for determining next nodes
    edge_map: Dict[str, str] = {}  # source -> target
    for edge in visual.edges:
        # Only consider execution flow edges (exec-in/exec-out handles)
        if edge.sourceHandle == "exec-out" and edge.targetHandle == "exec-in":
            edge_map[edge.source] = edge.target

    # Add nodes
    for node in visual.nodes:
        handler = _create_handler(node.type, node.data)

        # Determine input/output keys from node data
        input_key = node.data.get("inputKey")
        output_key = node.data.get("outputKey")

        flow.add_node(
            node_id=node.id,
            handler=handler,
            input_key=input_key,
            output_key=output_key,
        )

    # Add edges (data flow edges, not execution flow)
    for edge in visual.edges:
        # Skip execution edges - they're handled by the runtime
        if edge.sourceHandle == "exec-out" or edge.targetHandle == "exec-in":
            continue

        # For data edges, we add an edge between nodes
        flow.add_edge(edge.source, edge.target)

    # Also add execution edges
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

    def placeholder(input_data):
        task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
        return {
            "result": f"[Agent would process: {task}]",
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
    runner = FlowRunner(flow)
    result = runner.run(input_data)
    return {
        "result": result.get("result"),
        "success": result.get("success", True),
        "run_id": runner.run_id,
    }
