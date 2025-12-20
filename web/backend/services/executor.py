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
import logging

# Add abstractflow to path for imports
abstractflow_path = Path(__file__).parent.parent.parent.parent
if str(abstractflow_path) not in sys.path:
    sys.path.insert(0, str(abstractflow_path))

# Add abstractcore to path for LLM access
abstractcore_path = Path(__file__).parent.parent.parent.parent.parent / "abstractcore"
if str(abstractcore_path) not in sys.path:
    sys.path.insert(0, str(abstractcore_path))

logger = logging.getLogger(__name__)

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
        # Agent node - use AbstractCore to create real LLM handler
        return _create_agent_handler(data)

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

    # Effect nodes
    if type_str in ("ask_user", "llm_call", "wait_until", "wait_event", "memory_note", "memory_query"):
        return _create_effect_handler(type_str, data)

    # Unknown type - return identity
    return lambda x: x


def _wrap_builtin(handler, data: Dict[str, Any]):
    """Wrap a builtin handler to handle input mapping.

    For literal nodes, injects the configured literalValue from node data.
    """
    literal_value = data.get("literalValue")

    def wrapped(input_data):
        # Build inputs dict
        if isinstance(input_data, dict):
            inputs = input_data.copy()
        else:
            inputs = {"value": input_data, "a": input_data, "text": input_data}

        # Inject literal value if present (for literal_* nodes)
        if literal_value is not None:
            inputs["_literalValue"] = literal_value

        return handler(inputs)

    return wrapped


def _create_agent_handler(data: Dict[str, Any]):
    """Create a real agent handler using AbstractCore providers.

    Uses the configured provider (lmstudio, ollama, openai, anthropic, etc.)
    and model to make actual LLM calls.
    """
    agent_config = data.get("agentConfig", {})
    provider = agent_config.get("provider", "").lower()
    model = agent_config.get("model", "")

    # Validate configuration
    if not provider or not model:
        logger.warning(f"Agent node missing provider or model configuration: {agent_config}")
        return _create_agent_fallback(data, "Missing provider or model configuration")

    def handler(input_data):
        task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
        context = input_data.get("context", {}) if isinstance(input_data, dict) else {}

        try:
            # Import AbstractCore's create_llm
            from abstractcore import create_llm

            # Create LLM instance with the configured provider and model
            logger.info(f"Creating LLM: provider={provider}, model={model}")
            llm = create_llm(provider, model=model)

            # Build the prompt from task and context
            prompt = task
            if context:
                context_str = "\n".join(f"{k}: {v}" for k, v in context.items())
                prompt = f"Context:\n{context_str}\n\nTask: {task}"

            # Generate response
            logger.info(f"Generating response for task: {task[:100]}...")
            response = llm.generate(prompt)

            return {
                "result": response.content,
                "task": task,
                "context": context,
                "success": True,
                "provider": provider,
                "model": model,
                "usage": response.usage if hasattr(response, 'usage') else None,
            }

        except ImportError as e:
            logger.error(f"Failed to import AbstractCore: {e}")
            return {
                "result": f"Error: AbstractCore not available - {e}",
                "task": task,
                "context": context,
                "success": False,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"Agent execution failed: {e}", exc_info=True)
            return {
                "result": f"Error: {e}",
                "task": task,
                "context": context,
                "success": False,
                "error": str(e),
            }

    return handler


def _create_agent_fallback(data: Dict[str, Any], reason: str):
    """Create a fallback handler when agent configuration is invalid."""
    provider = data.get("agentConfig", {}).get("provider", "unknown")
    model = data.get("agentConfig", {}).get("model", "unknown")

    def fallback(input_data):
        task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
        context = input_data.get("context", {}) if isinstance(input_data, dict) else {}
        return {
            "result": f"Agent configuration error: {reason}",
            "task": task,
            "context": context,
            "success": False,
            "error": reason,
            "note": f"Provider: {provider}, Model: {model}",
        }

    return fallback


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


# Effect handlers - these return results directly for now
# Full AbstractRuntime integration is handled in the FlowRunner
def _create_effect_handler(effect_type: str, data: Dict[str, Any]):
    """Create handlers for effect nodes.

    These handlers execute effects directly for now.
    Full durable execution with pause/resume requires FlowRunner integration.
    """
    effect_config = data.get("effectConfig", {})

    if effect_type == "ask_user":
        return _create_ask_user_handler(data, effect_config)
    elif effect_type == "llm_call":
        return _create_llm_call_handler(data, effect_config)
    elif effect_type == "wait_until":
        return _create_wait_until_handler(data, effect_config)
    elif effect_type == "wait_event":
        return _create_wait_event_handler(data, effect_config)
    elif effect_type == "memory_note":
        return _create_memory_note_handler(data, effect_config)
    elif effect_type == "memory_query":
        return _create_memory_query_handler(data, effect_config)

    # Fallback - identity
    return lambda x: x


def _create_ask_user_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create ASK_USER effect handler.

    For now, returns a placeholder. Full implementation requires
    WebSocket integration for user prompts.
    """
    def handler(input_data):
        prompt = input_data.get("prompt", "Please respond:") if isinstance(input_data, dict) else str(input_data)
        choices = input_data.get("choices", []) if isinstance(input_data, dict) else []

        # Return placeholder - real implementation needs pause/resume
        return {
            "response": f"[User prompt: {prompt}]",
            "prompt": prompt,
            "choices": choices,
            "allow_free_text": config.get("allowFreeText", True),
            "_pending_effect": {
                "type": "ask_user",
                "prompt": prompt,
                "choices": choices,
            },
        }
    return handler


def _create_llm_call_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create LLM_CALL effect handler.

    Uses AbstractCore to make LLM calls.
    """
    provider = config.get("provider", "").lower()
    model = config.get("model", "")
    temperature = config.get("temperature", 0.7)

    def handler(input_data):
        prompt = input_data.get("prompt", "") if isinstance(input_data, dict) else str(input_data)
        system = input_data.get("system", "") if isinstance(input_data, dict) else ""

        if not provider or not model:
            return {
                "response": "[LLM Call: No provider/model configured]",
                "error": "Missing provider or model configuration",
            }

        try:
            from abstractcore import create_llm

            logger.info(f"LLM Call: provider={provider}, model={model}")
            llm = create_llm(provider, model=model)

            # Build messages or use simple prompt
            full_prompt = prompt
            if system:
                full_prompt = f"System: {system}\n\n{prompt}"

            response = llm.generate(full_prompt)

            return {
                "response": response.content,
                "prompt": prompt,
                "system": system,
                "provider": provider,
                "model": model,
            }

        except ImportError as e:
            logger.error(f"Failed to import AbstractCore: {e}")
            return {
                "response": f"[Error: AbstractCore not available - {e}]",
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"LLM Call failed: {e}", exc_info=True)
            return {
                "response": f"[Error: {e}]",
                "error": str(e),
            }

    return handler


def _create_wait_until_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create WAIT_UNTIL effect handler.

    For simple delays, can use time.sleep.
    Full durable implementation requires AbstractRuntime.
    """
    import time

    duration_type = config.get("durationType", "seconds")

    def handler(input_data):
        duration = input_data.get("duration", 0) if isinstance(input_data, dict) else 0

        try:
            amount = float(duration)
        except (TypeError, ValueError):
            amount = 0

        # Convert to seconds
        if duration_type == "minutes":
            seconds = amount * 60
        elif duration_type == "hours":
            seconds = amount * 3600
        elif duration_type == "timestamp":
            # For timestamps, calculate delta from now
            # For now, just return immediately
            return {"waited": True, "duration_type": "timestamp"}
        else:
            seconds = amount

        # For short delays (< 10 seconds), actually wait
        # For longer delays, return a pending effect marker
        if seconds > 0 and seconds <= 10:
            time.sleep(seconds)

        return {
            "waited": True,
            "duration": duration,
            "duration_type": duration_type,
            "seconds": seconds,
        }

    return handler


def _create_wait_event_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create WAIT_EVENT effect handler.

    Returns a placeholder - full implementation requires AbstractRuntime.
    """
    def handler(input_data):
        event_key = input_data.get("event_key", "default") if isinstance(input_data, dict) else str(input_data)

        return {
            "event_data": {},
            "event_key": event_key,
            "_pending_effect": {
                "type": "wait_event",
                "event_key": event_key,
            },
        }

    return handler


def _create_memory_note_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create MEMORY_NOTE effect handler.

    Returns a placeholder - full implementation requires AbstractRuntime with memory store.
    """
    def handler(input_data):
        content = input_data.get("content", "") if isinstance(input_data, dict) else str(input_data)

        # Placeholder - would use AbstractRuntime memory effect
        import uuid
        note_id = f"note-{str(uuid.uuid4())[:8]}"

        return {
            "note_id": note_id,
            "content": content,
            "stored": True,
        }

    return handler


def _create_memory_query_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create MEMORY_QUERY effect handler.

    Returns a placeholder - full implementation requires AbstractRuntime with memory store.
    """
    def handler(input_data):
        query = input_data.get("query", "") if isinstance(input_data, dict) else str(input_data)
        limit = input_data.get("limit", 10) if isinstance(input_data, dict) else 10

        # Placeholder - would use AbstractRuntime memory effect
        return {
            "results": [],
            "query": query,
            "limit": limit,
            "note": "Memory query requires AbstractRuntime integration",
        }

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
