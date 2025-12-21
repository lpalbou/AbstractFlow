"""Portable visual-flow execution utilities.

This module converts visual-editor flow JSON into an `abstractflow.Flow` and
provides a convenience `create_visual_runner()` that wires an AbstractRuntime
instance with the right integrations (LLM/MEMORY/SUBFLOW) for execution.

The goal is host portability: the same visual flow should run from non-web
hosts (AbstractCode, CLI) without importing the web backend implementation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..core.flow import Flow
from ..runner import FlowRunner

from .builtins import get_builtin_handler
from .code_executor import create_code_handler
from .models import NodeType, VisualEdge, VisualFlow


# Type alias for data edge mapping
# Maps target_node_id -> { target_pin -> (source_node_id, source_pin) }
DataEdgeMap = Dict[str, Dict[str, tuple[str, str]]]


def create_visual_runner(visual_flow: VisualFlow, *, flows: Dict[str, VisualFlow]) -> FlowRunner:
    """Create a FlowRunner for a visual run with a correctly wired runtime.

    Responsibilities:
    - Build a WorkflowRegistry containing the root flow and any referenced subflows.
    - Create a runtime with an ArtifactStore (required for MEMORY_* effects).
    - If any LLM_CALL / Agent nodes exist in the flow tree, wire AbstractCore-backed
      effect handlers (via AbstractRuntime's integration module).
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

    from ..compiler import compile_flow

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
            node_type = _node_type(n)
            if node_type != "subflow":
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

    # Validate LLM config across the flow tree and choose a default runtime model.
    llm_configs: set[tuple[str, str]] = set()
    default_llm: tuple[str, str] | None = None
    for vf in ordered:
        for n in vf.nodes:
            node_type = _node_type(n)
            if node_type not in {"llm_call", "agent"}:
                continue

            if node_type == "llm_call":
                cfg = n.data.get("effectConfig", {})
                provider = cfg.get("provider")
                model = cfg.get("model")
                if not isinstance(provider, str) or not provider.strip():
                    raise ValueError(f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing provider")
                if not isinstance(model, str) or not model.strip():
                    raise ValueError(f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing model")
            else:
                cfg = n.data.get("agentConfig", {})
                provider = cfg.get("provider")
                model = cfg.get("model")
                if not isinstance(provider, str) or not provider.strip():
                    continue
                if not isinstance(model, str) or not model.strip():
                    continue

            pair = (provider.strip().lower(), model.strip())
            llm_configs.add(pair)
            if default_llm is None:
                default_llm = pair

    if llm_configs:
        provider, model = default_llm or next(iter(llm_configs))
        from abstractruntime.integrations.abstractcore import MappingToolExecutor
        from abstractruntime.integrations.abstractcore.default_tools import get_default_tools

        runtime = create_local_runtime(
            provider=provider,
            model=model,
            tool_executor=MappingToolExecutor.from_tools(get_default_tools()),
        )
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
    """Build a mapping of data edges for input resolution."""
    data_edges: DataEdgeMap = {}

    for edge in edges:
        # Skip execution edges
        if edge.sourceHandle == "exec-out" or edge.targetHandle == "exec-in":
            continue

        if edge.target not in data_edges:
            data_edges[edge.target] = {}

        data_edges[edge.target][edge.targetHandle] = (edge.source, edge.sourceHandle)

    return data_edges


def visual_to_flow(visual: VisualFlow) -> Flow:
    """Convert a visual flow definition to an AbstractFlow `Flow`."""
    import datetime

    flow = Flow(visual.id)

    data_edge_map = _build_data_edge_map(visual.edges)

    # Store node outputs during execution (visual data-edge evaluation cache)
    flow._node_outputs = {}  # type: ignore[attr-defined]
    flow._data_edge_map = data_edge_map  # type: ignore[attr-defined]

    LITERAL_NODE_TYPES = {
        "literal_string",
        "literal_number",
        "literal_boolean",
        "literal_json",
        "literal_array",
    }

    pure_base_handlers: Dict[str, Any] = {}

    def _has_execution_pins(type_str: str, node_data: Dict[str, Any]) -> bool:
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

        if type_str in LITERAL_NODE_TYPES:
            return False
        if type_str == "break_object":
            return False
        if get_builtin_handler(type_str) is not None:
            return False
        return True

    evaluating: set[str] = set()

    def _ensure_node_output(node_id: str) -> None:
        if node_id in flow._node_outputs:  # type: ignore[attr-defined]
            return

        handler = pure_base_handlers.get(node_id)
        if handler is None:
            return

        if node_id in evaluating:
            raise ValueError(f"Data edge cycle detected at '{node_id}'")

        evaluating.add(node_id)
        resolved_input: Dict[str, Any] = {}

        for target_pin, (source_node, source_pin) in data_edge_map.get(node_id, {}).items():
            _ensure_node_output(source_node)
            if source_node not in flow._node_outputs:  # type: ignore[attr-defined]
                continue
            source_output = flow._node_outputs[source_node]  # type: ignore[attr-defined]
            if isinstance(source_output, dict) and source_pin in source_output:
                resolved_input[target_pin] = source_output[source_pin]
            elif source_pin in ("result", "output"):
                resolved_input[target_pin] = source_output

        result = handler(resolved_input if resolved_input else {})
        flow._node_outputs[node_id] = result  # type: ignore[attr-defined]
        evaluating.remove(node_id)

    EFFECT_NODE_TYPES = {
        "ask_user",
        "answer_user",
        "llm_call",
        "wait_until",
        "wait_event",
        "memory_note",
        "memory_query",
    }

    # Pre-evaluate literal nodes and store their values
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)
        if type_str in LITERAL_NODE_TYPES:
            literal_value = node.data.get("literalValue")
            flow._node_outputs[node.id] = {"value": literal_value}  # type: ignore[attr-defined]

    def _decode_separator(value: str) -> str:
        return value.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")

    def _create_concat_handler(data: Dict[str, Any]):
        config = data.get("concatConfig", {}) if isinstance(data, dict) else {}
        separator = " "
        if isinstance(config, dict):
            sep_raw = config.get("separator")
            if isinstance(sep_raw, str):
                separator = sep_raw
        separator = _decode_separator(separator)

        pin_order: list[str] = []
        pins = data.get("inputs") if isinstance(data, dict) else None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "execution":
                    continue
                pid = p.get("id")
                if isinstance(pid, str) and pid:
                    pin_order.append(pid)

        if not pin_order:
            pin_order = ["a", "b"]

        def handler(input_data: Any) -> str:
            if not isinstance(input_data, dict):
                return str(input_data or "")

            parts: list[str] = []
            for pid in pin_order:
                if pid in input_data:
                    v = input_data.get(pid)
                    parts.append("" if v is None else str(v))
            return separator.join(parts)

        return handler

    def _create_array_concat_handler(data: Dict[str, Any]):
        pin_order: list[str] = []
        pins = data.get("inputs") if isinstance(data, dict) else None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "execution":
                    continue
                pid = p.get("id")
                if isinstance(pid, str) and pid:
                    pin_order.append(pid)

        if not pin_order:
            pin_order = ["a", "b"]

        def handler(input_data: Any) -> list[Any]:
            if not isinstance(input_data, dict):
                if input_data is None:
                    return []
                if isinstance(input_data, list):
                    return list(input_data)
                if isinstance(input_data, tuple):
                    return list(input_data)
                return [input_data]

            out: list[Any] = []
            for pid in pin_order:
                if pid not in input_data:
                    continue
                v = input_data.get(pid)
                if v is None:
                    continue
                if isinstance(v, list):
                    out.extend(v)
                    continue
                if isinstance(v, tuple):
                    out.extend(list(v))
                    continue
                out.append(v)
            return out

        return handler

    def _create_break_object_handler(data: Dict[str, Any]):
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
        literal_value = data.get("literalValue")

        def wrapped(input_data):
            if isinstance(input_data, dict):
                inputs = input_data.copy()
            else:
                inputs = {"value": input_data, "a": input_data, "text": input_data}

            if literal_value is not None:
                inputs["_literalValue"] = literal_value

            return handler(inputs)

        return wrapped

    def _create_agent_input_handler(data: Dict[str, Any]):
        def handler(input_data):
            task = input_data.get("task") if isinstance(input_data, dict) else str(input_data)
            context_raw = input_data.get("context", {}) if isinstance(input_data, dict) else {}
            context = context_raw if isinstance(context_raw, dict) else {}
            return {"task": task, "context": context}

        return handler

    def _create_subflow_effect_builder(data: Dict[str, Any]):
        input_pin_ids: list[str] = []
        pins = data.get("inputs") if isinstance(data, dict) else None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "execution":
                    continue
                pid = p.get("id")
                if isinstance(pid, str) and pid:
                    input_pin_ids.append(pid)

        def handler(input_data):
            subflow_id = (
                data.get("subflowId")
                or data.get("flowId")  # legacy
                or data.get("workflowId")
                or data.get("workflow_id")
            )

            sub_vars_dict: Dict[str, Any] = {}
            if isinstance(input_data, dict):
                base: Dict[str, Any] = {}
                if isinstance(input_data.get("vars"), dict):
                    base.update(dict(input_data["vars"]))
                elif isinstance(input_data.get("input"), dict):
                    base.update(dict(input_data["input"]))

                if input_pin_ids:
                    for pid in input_pin_ids:
                        if pid in ("vars", "input") and isinstance(input_data.get(pid), dict):
                            continue
                        if pid in input_data:
                            base[pid] = input_data.get(pid)
                    sub_vars_dict = base
                else:
                    if base:
                        sub_vars_dict = base
                    else:
                        sub_vars_dict = dict(input_data)
            else:
                if input_pin_ids and len(input_pin_ids) == 1:
                    sub_vars_dict = {input_pin_ids[0]: input_data}
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
        def handler(input_data):
            if event_type == "on_flow_start":
                if isinstance(input_data, dict):
                    return dict(input_data)
                return {"input": input_data}
            if event_type == "on_user_request":
                message = input_data.get("message", "") if isinstance(input_data, dict) else str(input_data)
                context = input_data.get("context", {}) if isinstance(input_data, dict) else {}
                return {"message": message, "context": context}
            if event_type == "on_agent_message":
                sender = input_data.get("sender", "unknown") if isinstance(input_data, dict) else "unknown"
                message = input_data.get("message", "") if isinstance(input_data, dict) else str(input_data)
                channel = data.get("eventConfig", {}).get("channel", "")
                return {"sender": sender, "message": message, "channel": channel}
            if event_type == "on_schedule":
                return {"timestamp": datetime.datetime.utcnow().isoformat()}
            return input_data

        return handler

    def _create_flow_end_handler(data: Dict[str, Any]):
        pin_ids: list[str] = []
        pins = data.get("inputs") if isinstance(data, dict) else None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "execution":
                    continue
                pid = p.get("id")
                if isinstance(pid, str) and pid:
                    pin_ids.append(pid)

        def handler(input_data: Any):
            if not pin_ids:
                if isinstance(input_data, dict):
                    return dict(input_data)
                return {"result": input_data}

            if not isinstance(input_data, dict):
                if len(pin_ids) == 1:
                    return {pin_ids[0]: input_data}
                return {"result": input_data}

            return {pid: input_data.get(pid) for pid in pin_ids}

        return handler

    def _create_expression_handler(expression: str):
        def handler(input_data):
            namespace = {"x": input_data, "input": input_data}
            if isinstance(input_data, dict):
                namespace.update(input_data)
            try:
                return eval(expression, {"__builtins__": {}}, namespace)
            except Exception as e:
                return {"error": str(e)}

        return handler

    def _create_if_handler(data: Dict[str, Any]):
        def handler(input_data):
            condition = input_data.get("condition") if isinstance(input_data, dict) else bool(input_data)
            return {"branch": "true" if condition else "false", "condition": condition}

        return handler

    def _create_switch_handler(data: Dict[str, Any]):
        def handler(input_data):
            value = input_data.get("value") if isinstance(input_data, dict) else input_data

            config = data.get("switchConfig", {}) if isinstance(data, dict) else {}
            raw_cases = config.get("cases", []) if isinstance(config, dict) else []

            value_str = "" if value is None else str(value)
            if isinstance(raw_cases, list):
                for case in raw_cases:
                    if not isinstance(case, dict):
                        continue
                    case_id = case.get("id")
                    case_value = case.get("value")
                    if not isinstance(case_id, str) or not case_id:
                        continue
                    if case_value is None:
                        continue
                    if value_str == str(case_value):
                        return {"branch": f"case:{case_id}", "value": value, "matched": str(case_value)}

            return {"branch": "default", "value": value}

        return handler

    def _create_loop_handler(data: Dict[str, Any]):
        def handler(input_data):
            items = input_data.get("items") if isinstance(input_data, dict) else input_data
            if not isinstance(items, (list, tuple)):
                items = [items]
            return {"items": items, "count": len(items)}

        return handler

    def _create_effect_handler(effect_type: str, data: Dict[str, Any]):
        effect_config = data.get("effectConfig", {})

        if effect_type == "ask_user":
            return _create_ask_user_handler(data, effect_config)
        if effect_type == "answer_user":
            return _create_answer_user_handler(data, effect_config)
        if effect_type == "llm_call":
            return _create_llm_call_handler(data, effect_config)
        if effect_type == "wait_until":
            return _create_wait_until_handler(data, effect_config)
        if effect_type == "wait_event":
            return _create_wait_event_handler(data, effect_config)
        if effect_type == "memory_note":
            return _create_memory_note_handler(data, effect_config)
        if effect_type == "memory_query":
            return _create_memory_query_handler(data, effect_config)

        return lambda x: x

    def _create_ask_user_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            prompt = input_data.get("prompt", "Please respond:") if isinstance(input_data, dict) else str(input_data)
            choices = input_data.get("choices", []) if isinstance(input_data, dict) else []
            allow_free_text = config.get("allowFreeText", True)

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

    def _create_answer_user_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            message = input_data.get("message", "") if isinstance(input_data, dict) else str(input_data or "")
            return {"message": message, "_pending_effect": {"type": "answer_user", "message": message}}

        return handler

    def _create_llm_call_handler(data: Dict[str, Any], config: Dict[str, Any]):
        provider = config.get("provider", "")
        model = config.get("model", "")
        temperature = config.get("temperature", 0.7)

        def handler(input_data):
            prompt = input_data.get("prompt", "") if isinstance(input_data, dict) else str(input_data)
            system = input_data.get("system", "") if isinstance(input_data, dict) else ""

            if not provider or not model:
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
        from datetime import datetime as _dt, timedelta, timezone

        duration_type = config.get("durationType", "seconds")

        def handler(input_data):
            duration = input_data.get("duration", 0) if isinstance(input_data, dict) else 0

            try:
                amount = float(duration)
            except (TypeError, ValueError):
                amount = 0

            now = _dt.now(timezone.utc)
            if duration_type == "timestamp":
                until = str(duration or "")
            elif duration_type == "minutes":
                until = (now + timedelta(minutes=amount)).isoformat()
            elif duration_type == "hours":
                until = (now + timedelta(hours=amount)).isoformat()
            else:
                until = (now + timedelta(seconds=amount)).isoformat()

            return {"_pending_effect": {"type": "wait_until", "until": until}}

        return handler

    def _create_wait_event_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            event_key = input_data.get("event_key", "default") if isinstance(input_data, dict) else str(input_data)
            return {
                "event_data": {},
                "event_key": event_key,
                "_pending_effect": {"type": "wait_event", "wait_key": event_key},
            }

        return handler

    def _create_memory_note_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            content = input_data.get("content", "") if isinstance(input_data, dict) else str(input_data)
            return {"note_id": None, "_pending_effect": {"type": "memory_note", "note": content, "tags": {}}}

        return handler

    def _create_memory_query_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            query = input_data.get("query", "") if isinstance(input_data, dict) else str(input_data)
            limit = input_data.get("limit", 10) if isinstance(input_data, dict) else 10
            try:
                limit_int = int(limit) if limit is not None else 10
            except Exception:
                limit_int = 10

            return {"results": [], "_pending_effect": {"type": "memory_query", "query": query, "limit_spans": limit_int}}

        return handler

    def _create_handler(node_type: NodeType, data: Dict[str, Any]) -> Any:
        type_str = node_type.value if isinstance(node_type, NodeType) else str(node_type)

        if type_str == "concat":
            return _create_concat_handler(data)

        if type_str == "array_concat":
            return _create_array_concat_handler(data)

        builtin = get_builtin_handler(type_str)
        if builtin:
            return _wrap_builtin(builtin, data)

        if type_str == "code":
            code = data.get("code", "def transform(input):\n    return input")
            function_name = data.get("functionName", "transform")
            return create_code_handler(code, function_name)

        if type_str == "agent":
            return _create_agent_input_handler(data)

        if type_str == "subflow":
            return _create_subflow_effect_builder(data)

        if type_str == "break_object":
            return _create_break_object_handler(data)

        if type_str == "function":
            if "code" in data:
                return create_code_handler(data["code"], data.get("functionName", "transform"))
            if "expression" in data:
                return _create_expression_handler(data["expression"])
            return lambda x: x

        if type_str == "on_flow_end":
            return _create_flow_end_handler(data)

        if type_str in ("on_flow_start", "on_user_request", "on_agent_message", "on_schedule"):
            return _create_event_handler(type_str, data)

        if type_str == "if":
            return _create_if_handler(data)
        if type_str == "switch":
            return _create_switch_handler(data)
        if type_str == "loop":
            return _create_loop_handler(data)

        if type_str in EFFECT_NODE_TYPES:
            return _create_effect_handler(type_str, data)

        return lambda x: x

    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)

        if type_str in LITERAL_NODE_TYPES:
            continue

        base_handler = _create_handler(node.type, node.data)

        if not _has_execution_pins(type_str, node.data):
            pure_base_handlers[node.id] = base_handler
            continue

        wrapped_handler = _create_data_aware_handler(
            node_id=node.id,
            base_handler=base_handler,
            data_edges=data_edge_map.get(node.id, {}),
            node_outputs=flow._node_outputs,  # type: ignore[attr-defined]
            ensure_node_output=_ensure_node_output,
        )

        input_key = node.data.get("inputKey")
        output_key = node.data.get("outputKey")

        effect_type: Optional[str] = None
        effect_config: Optional[Dict[str, Any]] = None
        if type_str in EFFECT_NODE_TYPES:
            effect_type = type_str
            effect_config = node.data.get("effectConfig", {})
        elif type_str == "agent":
            effect_type = "agent"
            effect_config = node.data.get("agentConfig", {})
        elif type_str == "subflow":
            effect_type = "start_subworkflow"
            subflow_id = node.data.get("subflowId") or node.data.get("flowId")
            output_pin_ids: list[str] = []
            outs = node.data.get("outputs")
            if isinstance(outs, list):
                for p in outs:
                    if not isinstance(p, dict):
                        continue
                    if p.get("type") == "execution":
                        continue
                    pid = p.get("id")
                    if isinstance(pid, str) and pid and pid != "output":
                        output_pin_ids.append(pid)
            effect_config = {"workflow_id": subflow_id, "output_pins": output_pin_ids}

        flow.add_node(
            node_id=node.id,
            handler=wrapped_handler,
            input_key=input_key,
            output_key=output_key,
            effect_type=effect_type,
            effect_config=effect_config,
        )

    for edge in visual.edges:
        if edge.targetHandle == "exec-in":
            if edge.source in flow.nodes and edge.target in flow.nodes:
                flow.add_edge(edge.source, edge.target, source_handle=edge.sourceHandle)

    if visual.entryNode and visual.entryNode in flow.nodes:
        flow.set_entry(visual.entryNode)
    else:
        targets = {e.target for e in visual.edges if e.targetHandle == "exec-in"}
        for node_id in flow.nodes:
            if node_id not in targets:
                flow.set_entry(node_id)
                break
        if not flow.entry_node and flow.nodes:
            flow.set_entry(next(iter(flow.nodes)))

    return flow


def _create_data_aware_handler(
    node_id: str,
    base_handler,
    data_edges: Dict[str, tuple[str, str]],
    node_outputs: Dict[str, Dict[str, Any]],
    *,
    ensure_node_output=None,
):
    """Wrap a handler to resolve data edge inputs before execution."""

    def wrapped_handler(input_data):
        resolved_input: Dict[str, Any] = {}

        if isinstance(input_data, dict):
            resolved_input.update(input_data)

        for target_pin, (source_node, source_pin) in data_edges.items():
            if ensure_node_output is not None and source_node not in node_outputs:
                ensure_node_output(source_node)
            if source_node in node_outputs:
                source_output = node_outputs[source_node]
                if isinstance(source_output, dict) and source_pin in source_output:
                    resolved_input[target_pin] = source_output[source_pin]
                elif source_pin in ("result", "output"):
                    resolved_input[target_pin] = source_output

        result = base_handler(resolved_input if resolved_input else input_data)
        node_outputs[node_id] = result
        return result

    return wrapped_handler


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
            "error": "Flow is waiting for input. Use a host resume mechanism to continue.",
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

    return {"success": True, "waiting": False, "result": result, "run_id": runner.run_id}
