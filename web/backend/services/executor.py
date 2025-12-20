"""Flow execution service - converts visual flows to AbstractFlow.

This module handles the conversion from visual flow definitions (from the editor)
to executable AbstractFlow objects, with proper handling of:
- Execution edges: Control the order of node execution
- Data edges: Map outputs from one node to inputs of another
"""

from __future__ import annotations

import sys
import importlib
from pathlib import Path
from typing import Any, Dict, List, Optional
import datetime
import logging

# Add abstractflow to path for imports
abstractflow_path = Path(__file__).parent.parent.parent.parent
abstractflow_path_str = str(abstractflow_path)
while abstractflow_path_str in sys.path:
    sys.path.remove(abstractflow_path_str)
sys.path.insert(0, abstractflow_path_str)

# Add abstractcore to path for LLM access
abstractcore_path = Path(__file__).parent.parent.parent.parent.parent / "abstractcore"
abstractcore_path_str = str(abstractcore_path)
while abstractcore_path_str in sys.path:
    sys.path.remove(abstractcore_path_str)
sys.path.insert(0, abstractcore_path_str)

# Add abstractruntime to path for durable execution (avoid picking up a different checkout)
abstractruntime_path = Path(__file__).parent.parent.parent.parent.parent / "abstractruntime" / "src"
if abstractruntime_path.exists():
    abstractruntime_path_str = str(abstractruntime_path)
    while abstractruntime_path_str in sys.path:
        sys.path.remove(abstractruntime_path_str)
    sys.path.insert(0, abstractruntime_path_str)

    # If another checkout of `abstractruntime` was already imported (common when a
    # different repo is installed editable), purge it so imports resolve to this
    # monorepo's runtime.
    loaded = sys.modules.get("abstractruntime")
    loaded_file = getattr(loaded, "__file__", None) if loaded is not None else None
    try:
        loaded_path = str(Path(str(loaded_file)).resolve()) if loaded_file else None
    except Exception:
        loaded_path = None

    expected_prefix = str(abstractruntime_path.resolve())
    if loaded_path and not loaded_path.startswith(expected_prefix):
        for name in list(sys.modules.keys()):
            if name == "abstractruntime" or name.startswith("abstractruntime."):
                sys.modules.pop(name, None)
        importlib.invalidate_caches()

logger = logging.getLogger(__name__)

from abstractflow import Flow, FlowRunner
from ..models import VisualFlow, VisualEdge, NodeType
from .builtins import get_builtin_handler
from .code_executor import create_code_handler


# Type alias for data edge mapping
# Maps target_node_id -> { target_pin -> (source_node_id, source_pin) }
DataEdgeMap = Dict[str, Dict[str, tuple]]


def create_visual_runner(visual_flow: VisualFlow, *, flows: Dict[str, VisualFlow]) -> FlowRunner:
    """Create a FlowRunner for a visual run with a correctly wired runtime.

    Responsibilities:
    - Build a WorkflowRegistry containing the root flow and any referenced subflows.
    - Create a runtime with an ArtifactStore (required for MEMORY_* effects).
    - If any LLM_CALL nodes exist in the flow tree, wire AbstractCore-backed
      effect handlers and validate provider/model consistency.
    """
    # Be resilient to different AbstractRuntime install layouts: not all exports
    # are guaranteed to be re-exported from `abstractruntime.__init__`.
    try:
        from abstractruntime import Runtime  # type: ignore
    except Exception:  # pragma: no cover
        from abstractruntime.core.runtime import Runtime  # type: ignore

    try:
        from abstractruntime import InMemoryRunStore, InMemoryLedgerStore  # type: ignore
    except Exception:  # pragma: no cover
        from abstractruntime.storage.in_memory import InMemoryRunStore, InMemoryLedgerStore  # type: ignore

    try:
        from abstractruntime import WorkflowRegistry  # type: ignore
    except Exception:  # pragma: no cover
        from abstractruntime.scheduler.registry import WorkflowRegistry  # type: ignore

    try:
        from abstractruntime import InMemoryArtifactStore  # type: ignore
    except Exception:  # pragma: no cover
        from abstractruntime.storage.artifacts import InMemoryArtifactStore  # type: ignore
    from abstractruntime.integrations.abstractcore.factory import create_local_runtime
    from abstractflow import compile_flow

    def _node_type(node: Any) -> str:
        t = getattr(node, "type", None)
        return t.value if hasattr(t, "value") else str(t)

    # Collect all reachable flows (root + transitive subflows), with cycle detection.
    ordered: list[VisualFlow] = []
    visited: set[str] = set()
    visiting: set[str] = set()

    def _dfs(vf: VisualFlow) -> None:
        if vf.id in visited:
            return
        if vf.id in visiting:
            raise ValueError(f"Subflow cycle detected at '{vf.id}'")

        visiting.add(vf.id)
        ordered.append(vf)
        visited.add(vf.id)

        for n in vf.nodes:
            if _node_type(n) != "subflow":
                continue
            subflow_id = n.data.get("subflowId") or n.data.get("flowId")  # legacy
            if not isinstance(subflow_id, str) or not subflow_id.strip():
                raise ValueError(f"Subflow node '{n.id}' missing subflowId")
            subflow_id = subflow_id.strip()
            child = flows.get(subflow_id)
            if child is None:
                raise ValueError(f"Referenced subflow '{subflow_id}' not found")
            _dfs(child)

        visiting.remove(vf.id)

    _dfs(visual_flow)

    # Validate LLM_CALL config consistency across the flow tree.
    llm_configs: set[tuple[str, str]] = set()
    for vf in ordered:
        for n in vf.nodes:
            if _node_type(n) != "llm_call":
                continue
            cfg = n.data.get("effectConfig", {})
            provider = cfg.get("provider")
            model = cfg.get("model")
            if not isinstance(provider, str) or not provider.strip():
                raise ValueError(f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing provider")
            if not isinstance(model, str) or not model.strip():
                raise ValueError(f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing model")
            llm_configs.add((provider.strip().lower(), model.strip()))

    if len(llm_configs) > 1:
        rendered = ", ".join(f"{p}/{m}" for (p, m) in sorted(llm_configs))
        raise ValueError(f"All LLM_CALL nodes must share the same provider/model (found: {rendered})")

    # Create a runtime:
    # - Always include an ArtifactStore for MEMORY_* effects
    # - Add AbstractCore LLM handlers only when needed.
    if llm_configs:
        provider, model = next(iter(llm_configs))
        runtime = create_local_runtime(provider=provider, model=model)
    else:
        runtime = Runtime(
            run_store=InMemoryRunStore(),
            ledger_store=InMemoryLedgerStore(),
            artifact_store=InMemoryArtifactStore(),
        )

    flow = visual_to_flow(visual_flow)
    runner = FlowRunner(flow, runtime=runtime)

    registry = WorkflowRegistry()
    registry.register(runner.workflow)
    for vf in ordered[1:]:
        child_flow = visual_to_flow(vf)
        child_spec = compile_flow(child_flow)
        registry.register(child_spec)
    runtime.set_workflow_registry(registry)

    return runner


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

    Note:
        Literal nodes (string, number, boolean, json, array) are NOT added to
        the execution flow. They are pure data nodes that are evaluated when
        their output is read via data edges.
    """
    flow = Flow(visual.id)

    # Build data edge map for input resolution
    data_edge_map = _build_data_edge_map(visual.edges)

    # Store node outputs during execution
    # This will be populated during runtime
    flow._node_outputs: Dict[str, Dict[str, Any]] = {}
    flow._data_edge_map = data_edge_map

    # Literal node types - these are pure data nodes, not execution nodes.
    # They are evaluated up-front and should NOT be added to the execution graph.
    LITERAL_NODE_TYPES = {
        "literal_string", "literal_number", "literal_boolean",
        "literal_json", "literal_array"
    }

    # ------------------------------------------------------------------
    # Pure (no-exec) data nodes
    # ------------------------------------------------------------------
    #
    # Blueprint-like UX expects "pure" nodes (no exec pins) to evaluate via
    # data edges when their outputs are requested by an executing node.
    #
    # We support this by:
    # - excluding pure nodes from the execution graph (avoids unreachable errors)
    # - evaluating them on-demand and caching their outputs in flow._node_outputs
    #
    # Pure nodes are detected structurally (no execution pins), not by type.
    pure_base_handlers: Dict[str, Any] = {}

    def _has_execution_pins(type_str: str, node_data: Dict[str, Any]) -> bool:
        """Return True if a node should be treated as an execution node.

        Frontend-saved flows include `inputs`/`outputs` in node.data; some tests
        construct VisualNode objects without these pin lists. In that case, fall
        back to treating builtins and known pure nodes as pure, and everything
        else as execution.
        """
        pins: list[Any] = []
        inputs = node_data.get("inputs")
        outputs = node_data.get("outputs")
        if isinstance(inputs, list):
            pins.extend(inputs)
        if isinstance(outputs, list):
            pins.extend(outputs)

        if pins:
            for p in pins:
                if isinstance(p, dict) and p.get("type") == "execution":
                    return True
            return False

        # Fallback when pin metadata is missing.
        if type_str in LITERAL_NODE_TYPES:
            return False
        if type_str == "break_object":
            return False
        if get_builtin_handler(type_str) is not None:
            return False
        return True

    evaluating: set[str] = set()

    def _ensure_node_output(node_id: str) -> None:
        """Ensure node_outputs contains the node_id output.

        Only evaluates pure nodes (no exec pins). Execution nodes are populated
        when they run; literal nodes are pre-populated.
        """
        if node_id in flow._node_outputs:
            return

        handler = pure_base_handlers.get(node_id)
        if handler is None:
            return

        if node_id in evaluating:
            raise ValueError(f"Data edge cycle detected at '{node_id}'")

        evaluating.add(node_id)
        resolved_input: Dict[str, Any] = {}

        # Resolve this node's inputs via connected data edges.
        for target_pin, (source_node, source_pin) in data_edge_map.get(node_id, {}).items():
            _ensure_node_output(source_node)
            if source_node not in flow._node_outputs:
                continue
            source_output = flow._node_outputs[source_node]
            if isinstance(source_output, dict) and source_pin in source_output:
                resolved_input[target_pin] = source_output[source_pin]
            elif source_pin == "result":
                # Convention: primitive-returning nodes expose their value on a
                # virtual "result" pin.
                resolved_input[target_pin] = source_output

        result = handler(resolved_input if resolved_input else {})
        flow._node_outputs[node_id] = result
        evaluating.remove(node_id)

    # Effect node types that need special handling by the compiler.
    # Note: `subflow` is compiled as `start_subworkflow` (see below).
    EFFECT_NODE_TYPES = {"ask_user", "llm_call", "wait_until", "wait_event", "memory_note", "memory_query"}

    # Pre-evaluate literal nodes and store their values
    # This allows data edges from literals to resolve correctly
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)
        if type_str in LITERAL_NODE_TYPES:
            # Evaluate the literal and store in node_outputs
            literal_value = node.data.get("literalValue")
            flow._node_outputs[node.id] = {"value": literal_value}

    # Add nodes with wrapped handlers that resolve data edges.
    # Skip literal nodes (pre-evaluated) and pure nodes (evaluated on-demand).
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)

        # Skip literal nodes - they're pure data providers, not execution nodes
        if type_str in LITERAL_NODE_TYPES:
            continue

        base_handler = _create_handler(node.type, node.data)

        # Pure nodes: no exec pins → evaluate via data edges, don't add to execution graph.
        if not _has_execution_pins(type_str, node.data):
            pure_base_handlers[node.id] = base_handler
            continue

        # Wrap the handler to resolve data edges
        wrapped_handler = _create_data_aware_handler(
            node_id=node.id,
            base_handler=base_handler,
            data_edges=data_edge_map.get(node.id, {}),
            node_outputs=flow._node_outputs,
            ensure_node_output=_ensure_node_output,
        )

        # Determine input/output keys from node data
        input_key = node.data.get("inputKey")
        output_key = node.data.get("outputKey")

        # Check if this is an effect node - set effect_type for compiler
        effect_type = None
        effect_config = None
        if type_str in EFFECT_NODE_TYPES:
            effect_type = type_str
            effect_config = node.data.get("effectConfig", {})
        elif type_str == "subflow":
            effect_type = "start_subworkflow"
            subflow_id = node.data.get("subflowId") or node.data.get("flowId")  # legacy
            effect_config = {"workflow_id": subflow_id}

        flow.add_node(
            node_id=node.id,
            handler=wrapped_handler,
            input_key=input_key,
            output_key=output_key,
            effect_type=effect_type,
            effect_config=effect_config,
        )

    # Add execution edges (control flow).
    # Execution edges are identified by targeting the `exec-in` pin; the source
    # handle can be `exec-out` or a branch handle like `true`/`false`.
    for edge in visual.edges:
        if edge.targetHandle == "exec-in":
            if edge.source in flow.nodes and edge.target in flow.nodes:
                flow.add_edge(edge.source, edge.target, source_handle=edge.sourceHandle)

    # Set entry node - only consider nodes that are actually in the flow
    # (excludes literal nodes which were skipped above)
    if visual.entryNode and visual.entryNode in flow.nodes:
        flow.set_entry(visual.entryNode)
    else:
        # Try to find a node with no incoming execution edges
        targets = {e.target for e in visual.edges if e.targetHandle == "exec-in"}
        for node_id in flow.nodes:
            if node_id not in targets:
                flow.set_entry(node_id)
                break
        # Fallback to first node in the flow
        if not flow.entry_node and flow.nodes:
            flow.set_entry(next(iter(flow.nodes)))

    return flow


def _create_data_aware_handler(
    node_id: str,
    base_handler,
    data_edges: Dict[str, tuple],
    node_outputs: Dict[str, Dict[str, Any]],
    *,
    ensure_node_output=None,
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
            if ensure_node_output is not None and source_node not in node_outputs:
                ensure_node_output(source_node)
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
        return _create_subflow_effect_builder(data)

    if type_str == "break_object":
        return _create_break_object_handler(data)

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
    if type_str in ("on_flow_start", "on_user_request", "on_agent_message", "on_schedule"):
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


def _create_break_object_handler(data: Dict[str, Any]):
    """Create a handler that extracts selected dotted paths from an object.

    The node is "pure" (no exec pins) and returns a dict keyed by output pin IDs
    (which are the selected paths).
    """
    config = data.get("breakConfig", {}) if isinstance(data, dict) else {}
    selected = config.get("selectedPaths", []) if isinstance(config, dict) else []
    selected_paths = [p.strip() for p in selected if isinstance(p, str) and p.strip()]

    def _get_path(value: Any, path: str) -> Any:
        current = value
        for part in path.split("."):
            if current is None:
                return None
            if isinstance(current, dict):
                current = current.get(part)
                continue
            if isinstance(current, list) and part.isdigit():
                idx = int(part)
                if idx < 0 or idx >= len(current):
                    return None
                current = current[idx]
                continue
            return None
        return current

    def handler(input_data):
        src_obj = None
        if isinstance(input_data, dict):
            src_obj = input_data.get("object")

        out: Dict[str, Any] = {}
        for path in selected_paths:
            out[path] = _get_path(src_obj, path)
        return out

    return handler


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
        context_raw = input_data.get("context", {}) if isinstance(input_data, dict) else {}
        context = context_raw if isinstance(context_raw, dict) else {}

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

            # Visual nodes expect handler outputs to be a dict keyed by output pin
            # IDs. The Agent node has a single output pin named `result` that is
            # typed as an object, so we wrap the full response object under that
            # key (Blueprint-style).
            return {
                "result": {
                    "result": response.content,
                    "task": task,
                    "context": context,
                    "success": True,
                    "provider": provider,
                    "model": model,
                    "usage": response.usage if hasattr(response, "usage") else None,
                }
            }

        except ImportError as e:
            logger.error(f"Failed to import AbstractCore: {e}")
            return {
                "result": {
                    "result": f"Error: AbstractCore not available - {e}",
                    "task": task,
                    "context": context,
                    "success": False,
                    "error": str(e),
                }
            }
        except Exception as e:
            logger.error(f"Agent execution failed: {e}", exc_info=True)
            return {
                "result": {
                    "result": f"Error: {e}",
                    "task": task,
                    "context": context,
                    "success": False,
                    "error": str(e),
                }
            }

    return handler


def _create_agent_fallback(data: Dict[str, Any], reason: str):
    """Create a fallback handler when agent configuration is invalid."""
    provider = data.get("agentConfig", {}).get("provider", "unknown")
    model = data.get("agentConfig", {}).get("model", "unknown")

    def fallback(input_data):
        task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
        context_raw = input_data.get("context", {}) if isinstance(input_data, dict) else {}
        context = context_raw if isinstance(context_raw, dict) else {}
        return {
            "result": {
                "result": f"Agent configuration error: {reason}",
                "task": task,
                "context": context,
                "success": False,
                "error": reason,
                "note": f"Provider: {provider}, Model: {model}",
            }
        }

    return fallback


def _create_subflow_effect_builder(data: Dict[str, Any]):
    """Create an effect-builder handler for subflow nodes.

    The visual compiler detects `_pending_effect` and turns it into a durable
    START_SUBWORKFLOW effect executed by AbstractRuntime.
    """

    def handler(input_data):
        subflow_id = (
            data.get("subflowId")
            or data.get("flowId")  # legacy
            or data.get("workflowId")
            or data.get("workflow_id")
        )

        # Subflow vars come from the `input` pin by convention.
        if isinstance(input_data, dict):
            sub_vars = input_data.get("input")
            if isinstance(sub_vars, dict):
                sub_vars_dict: Dict[str, Any] = dict(sub_vars)
            else:
                sub_vars_dict = {"input": sub_vars}
        else:
            sub_vars_dict = {"input": input_data}

        return {
            "output": None,
            "_pending_effect": {
                "type": "start_subworkflow",
                "workflow_id": subflow_id,
                "vars": sub_vars_dict,
                "async": False,
            },
        }

    return handler


def _create_event_handler(event_type: str, data: Dict[str, Any]):
    """Create a handler for event/trigger nodes.

    Event nodes are entry points that pass through input data
    with the appropriate output structure.
    """

    def handler(input_data):
        if event_type == "on_flow_start":
            # No parameters; pass through initial vars for downstream nodes.
            if isinstance(input_data, dict):
                return dict(input_data)
            return {"input": input_data}
        elif event_type == "on_user_request":
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


# Effect handlers - visual compiler turns `_pending_effect` into durable effects.
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
        allow_free_text = config.get("allowFreeText", True)

        # Return placeholder - real implementation needs pause/resume
        return {
            "response": f"[User prompt: {prompt}]",
            "prompt": prompt,
            "choices": choices,
            "allow_free_text": allow_free_text,
            "_pending_effect": {
                "type": "ask_user",
                "prompt": prompt,
                "choices": choices,
                "allow_free_text": allow_free_text,
            },
        }
    return handler


def _create_llm_call_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create LLM_CALL effect builder (no direct execution).

    The actual LLM call is executed by AbstractRuntime's LLM_CALL handler.
    """
    provider = config.get("provider", "")
    model = config.get("model", "")
    temperature = config.get("temperature", 0.7)

    def handler(input_data):
        prompt = input_data.get("prompt", "") if isinstance(input_data, dict) else str(input_data)
        system = input_data.get("system", "") if isinstance(input_data, dict) else ""

        if not provider or not model:
            # Validation is performed before execution, but keep a safe fallback.
            return {
                "response": "[LLM Call: missing provider/model]",
                "_pending_effect": {
                    "type": "llm_call",
                    "prompt": prompt,
                    "system_prompt": system,
                    "params": {"temperature": temperature},
                },
                "error": "Missing provider or model configuration",
            }

        return {
            "response": None,
            "_pending_effect": {
                "type": "llm_call",
                "prompt": prompt,
                "system_prompt": system,
                "params": {"temperature": temperature},
                "provider": provider,
                "model": model,
            },
        }

    return handler


def _create_wait_until_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create WAIT_UNTIL effect builder (no direct sleeping)."""
    from datetime import datetime, timedelta, timezone

    duration_type = config.get("durationType", "seconds")

    def handler(input_data):
        duration = input_data.get("duration", 0) if isinstance(input_data, dict) else 0

        try:
            amount = float(duration)
        except (TypeError, ValueError):
            amount = 0

        now = datetime.now(timezone.utc)
        if duration_type == "timestamp":
            until = str(duration or "")
        elif duration_type == "minutes":
            until = (now + timedelta(minutes=amount)).isoformat()
        elif duration_type == "hours":
            until = (now + timedelta(hours=amount)).isoformat()
        else:
            until = (now + timedelta(seconds=amount)).isoformat()

        return {
            "_pending_effect": {
                "type": "wait_until",
                "until": until,
            }
        }

    return handler


def _create_wait_event_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create WAIT_EVENT effect builder."""
    def handler(input_data):
        event_key = input_data.get("event_key", "default") if isinstance(input_data, dict) else str(input_data)

        return {
            "event_data": {},
            "event_key": event_key,
            "_pending_effect": {
                "type": "wait_event",
                "wait_key": event_key,
            },
        }

    return handler


def _create_memory_note_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create MEMORY_NOTE effect builder (no direct storage)."""
    def handler(input_data):
        content = input_data.get("content", "") if isinstance(input_data, dict) else str(input_data)

        return {
            "note_id": None,
            "_pending_effect": {
                "type": "memory_note",
                "note": content,
                "tags": {},
            },
        }

    return handler


def _create_memory_query_handler(data: Dict[str, Any], config: Dict[str, Any]):
    """Create MEMORY_QUERY effect builder (no direct storage)."""
    def handler(input_data):
        query = input_data.get("query", "") if isinstance(input_data, dict) else str(input_data)
        limit = input_data.get("limit", 10) if isinstance(input_data, dict) else 10
        try:
            limit_int = int(limit) if limit is not None else 10
        except Exception:
            limit_int = 10

        return {
            "results": [],
            "_pending_effect": {
                "type": "memory_query",
                "query": query,
                "limit_spans": limit_int,
            },
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

    # If the flow is waiting (e.g. ASK_USER), return explicit waiting info.
    if isinstance(result, dict) and result.get("waiting"):
        state = runner.get_state()
        wait = state.waiting if state else None
        return {
            "success": False,
            "waiting": True,
            "error": "Flow is waiting for input. Use WebSocket (/api/ws/{flow_id}) to resume.",
            "run_id": runner.run_id,
            "wait_key": wait.wait_key if wait else None,
            "prompt": wait.prompt if wait else None,
            "choices": list(wait.choices) if wait and isinstance(wait.choices, list) else [],
            "allow_free_text": bool(wait.allow_free_text) if wait else None,
        }

    # Completed (or completed with an error payload).
    if isinstance(result, dict):
        return {
            "success": bool(result.get("success", True)),
            "waiting": False,
            "result": result.get("result"),
            "error": result.get("error"),
            "run_id": runner.run_id,
        }

    return {
        "success": True,
        "waiting": False,
        "result": result,
        "run_id": runner.run_id,
    }


def execute_visual_flow(visual_flow: VisualFlow, input_data: Dict[str, Any], *, flows: Dict[str, VisualFlow]) -> Dict[str, Any]:
    """Execute a visual flow with a correctly wired runtime (LLM/MEMORY/SUBFLOW)."""
    runner = create_visual_runner(visual_flow, flows=flows)
    result = runner.run(input_data)

    if isinstance(result, dict) and result.get("waiting"):
        state = runner.get_state()
        wait = state.waiting if state else None
        return {
            "success": False,
            "waiting": True,
            "error": "Flow is waiting for input. Use WebSocket (/api/ws/{flow_id}) to resume.",
            "run_id": runner.run_id,
            "wait_key": wait.wait_key if wait else None,
            "prompt": wait.prompt if wait else None,
            "choices": list(wait.choices) if wait and isinstance(wait.choices, list) else [],
            "allow_free_text": bool(wait.allow_free_text) if wait else None,
        }

    if isinstance(result, dict):
        return {
            "success": bool(result.get("success", True)),
            "waiting": False,
            "result": result.get("result"),
            "error": result.get("error"),
            "run_id": runner.run_id,
        }

    return {
        "success": True,
        "waiting": False,
        "result": result,
        "run_id": runner.run_id,
    }
