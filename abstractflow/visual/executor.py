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
from .agent_ids import visual_react_workflow_id
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

    # Workflow registry is used for START_SUBWORKFLOW composition (subflows + Agent nodes).
    #
    # This project supports different AbstractRuntime distributions; some older installs
    # may not expose WorkflowRegistry. In that case, fall back to a tiny in-process
    # dict-based registry with the same `.register()` + `.get()` surface.
    try:
        from abstractruntime import WorkflowRegistry  # type: ignore
    except Exception:  # pragma: no cover
        try:
            from abstractruntime.scheduler.registry import WorkflowRegistry  # type: ignore
        except Exception:  # pragma: no cover
            from abstractruntime.core.spec import WorkflowSpec  # type: ignore

            class WorkflowRegistry(dict):  # type: ignore[no-redef]
                def register(self, workflow: "WorkflowSpec") -> None:
                    self[str(workflow.workflow_id)] = workflow

    from ..compiler import compile_flow

    def _node_type(node: Any) -> str:
        t = getattr(node, "type", None)
        return t.value if hasattr(t, "value") else str(t)

    def _reachable_exec_node_ids(vf: VisualFlow) -> set[str]:
        """Return execution-reachable node ids (within this VisualFlow only).

        We consider only the *execution graph* (exec edges: targetHandle=exec-in).
        Disconnected/isolated execution nodes are ignored (Blueprint-style).
        """
        EXEC_TYPES: set[str] = {
            # Triggers / core exec
            "on_flow_start",
            "on_user_request",
            "on_agent_message",
            "on_schedule",
            "on_flow_end",
            "agent",
            "function",
            "code",
            "subflow",
            # Control exec
            "if",
            "switch",
            "loop",
            "while",
            "sequence",
            "parallel",
            # Effects
            "ask_user",
            "answer_user",
            "llm_call",
            "wait_until",
            "wait_event",
            "memory_note",
            "memory_query",
        }

        node_types: Dict[str, str] = {n.id: _node_type(n) for n in vf.nodes}
        exec_ids = {nid for nid, t in node_types.items() if t in EXEC_TYPES}
        if not exec_ids:
            return set()

        incoming_exec = {e.target for e in vf.edges if getattr(e, "targetHandle", None) == "exec-in"}

        entry: Optional[str] = None
        if isinstance(vf.entryNode, str) and vf.entryNode in exec_ids:
            entry = vf.entryNode
        if entry is None:
            for n in vf.nodes:
                if n.id in exec_ids and n.id not in incoming_exec:
                    entry = n.id
                    break
        if entry is None:
            entry = next(iter(exec_ids))

        adj: Dict[str, list[str]] = {}
        for e in vf.edges:
            if getattr(e, "targetHandle", None) != "exec-in":
                continue
            if e.source not in exec_ids or e.target not in exec_ids:
                continue
            adj.setdefault(e.source, []).append(e.target)

        reachable: set[str] = set()
        stack2 = [entry]
        while stack2:
            cur = stack2.pop()
            if cur in reachable:
                continue
            reachable.add(cur)
            for nxt in adj.get(cur, []):
                if nxt not in reachable:
                    stack2.append(nxt)
        return reachable

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

        reachable = _reachable_exec_node_ids(vf)
        for n in vf.nodes:
            node_type = _node_type(n)
            if node_type != "subflow":
                continue
            if reachable and n.id not in reachable:
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

    # Detect optional runtime features needed by this flow tree.
    # These flags keep `create_visual_runner()` resilient to older AbstractRuntime installs.
    needs_registry = False
    needs_artifacts = False
    for vf in ordered:
        reachable = _reachable_exec_node_ids(vf)
        for n in vf.nodes:
            if reachable and n.id not in reachable:
                continue
            t = _node_type(n)
            if t in {"subflow", "agent"}:
                needs_registry = True
            if t in {"memory_note", "memory_query"}:
                needs_artifacts = True

    # Detect whether this flow tree needs AbstractCore LLM integration.
    # Provider/model can be supplied either via node config *or* via connected input pins.
    has_llm_nodes = False
    llm_configs: set[tuple[str, str]] = set()
    default_llm: tuple[str, str] | None = None
    provider_hints: list[str] = []

    def _pin_connected(vf: VisualFlow, *, node_id: str, pin_id: str) -> bool:
        for e in vf.edges:
            try:
                if e.target == node_id and e.targetHandle == pin_id:
                    return True
            except Exception:
                continue
        return False

    def _add_pair(provider_raw: Any, model_raw: Any) -> None:
        nonlocal default_llm
        if not isinstance(provider_raw, str) or not provider_raw.strip():
            return
        if not isinstance(model_raw, str) or not model_raw.strip():
            return
        pair = (provider_raw.strip().lower(), model_raw.strip())
        llm_configs.add(pair)
        if default_llm is None:
            default_llm = pair

    for vf in ordered:
        reachable = _reachable_exec_node_ids(vf)
        for n in vf.nodes:
            node_type = _node_type(n)
            if reachable and n.id not in reachable:
                continue
            if node_type in {"llm_call", "agent"}:
                has_llm_nodes = True

            if node_type == "llm_call":
                cfg = n.data.get("effectConfig", {}) if isinstance(n.data, dict) else {}
                cfg = cfg if isinstance(cfg, dict) else {}
                provider = cfg.get("provider")
                model = cfg.get("model")

                provider_ok = isinstance(provider, str) and provider.strip()
                model_ok = isinstance(model, str) and model.strip()
                provider_connected = _pin_connected(vf, node_id=n.id, pin_id="provider")
                model_connected = _pin_connected(vf, node_id=n.id, pin_id="model")

                if not provider_ok and not provider_connected:
                    raise ValueError(
                        f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing provider "
                        "(set effectConfig.provider or connect the provider input pin)"
                    )
                if not model_ok and not model_connected:
                    raise ValueError(
                        f"LLM_CALL node '{n.id}' in flow '{vf.id}' missing model "
                        "(set effectConfig.model or connect the model input pin)"
                    )
                _add_pair(provider, model)

            elif node_type == "agent":
                cfg = n.data.get("agentConfig", {}) if isinstance(n.data, dict) else {}
                cfg = cfg if isinstance(cfg, dict) else {}
                provider = cfg.get("provider")
                model = cfg.get("model")

                provider_ok = isinstance(provider, str) and provider.strip()
                model_ok = isinstance(model, str) and model.strip()
                provider_connected = _pin_connected(vf, node_id=n.id, pin_id="provider")
                model_connected = _pin_connected(vf, node_id=n.id, pin_id="model")

                if not provider_ok and not provider_connected:
                    raise ValueError(
                        f"Agent node '{n.id}' in flow '{vf.id}' missing provider "
                        "(set agentConfig.provider or connect the provider input pin)"
                    )
                if not model_ok and not model_connected:
                    raise ValueError(
                        f"Agent node '{n.id}' in flow '{vf.id}' missing model "
                        "(set agentConfig.model or connect the model input pin)"
                    )
                _add_pair(provider, model)

            elif node_type == "provider_models":
                cfg = n.data.get("providerModelsConfig", {}) if isinstance(n.data, dict) else {}
                cfg = cfg if isinstance(cfg, dict) else {}
                provider = cfg.get("provider")
                if isinstance(provider, str) and provider.strip():
                    provider_hints.append(provider.strip().lower())
                    allowed = cfg.get("allowedModels")
                    if not isinstance(allowed, list):
                        allowed = cfg.get("allowed_models")
                    if isinstance(allowed, list):
                        for m in allowed:
                            _add_pair(provider, m)

    if has_llm_nodes:
        provider_model = default_llm
        if provider_model is None and provider_hints:
            # If the graph contains a provider selection node, prefer it for the runtime default.
            try:
                from abstractcore.providers.registry import get_available_models_for_provider
            except Exception:
                get_available_models_for_provider = None  # type: ignore[assignment]
            if callable(get_available_models_for_provider):
                for p in provider_hints:
                    try:
                        models = get_available_models_for_provider(p)
                    except Exception:
                        models = []
                    if isinstance(models, list):
                        first = next((m for m in models if isinstance(m, str) and m.strip()), None)
                        if first:
                            provider_model = (p, first.strip())
                            break

        if provider_model is None:
            # Fall back to the first available provider/model from AbstractCore.
            try:
                from abstractcore.providers.registry import get_all_providers_with_models

                providers_meta = get_all_providers_with_models(include_models=True)
                for p in providers_meta:
                    if not isinstance(p, dict):
                        continue
                    if p.get("status") != "available":
                        continue
                    name = p.get("name")
                    models = p.get("models")
                    if not isinstance(name, str) or not name.strip():
                        continue
                    if not isinstance(models, list):
                        continue
                    first = next((m for m in models if isinstance(m, str) and m.strip()), None)
                    if first:
                        provider_model = (name.strip().lower(), first.strip())
                        break
            except Exception:
                provider_model = None

        if provider_model is None:
            raise RuntimeError(
                "This flow uses LLM nodes (llm_call/agent), but no provider/model could be determined. "
                "Either set provider/model on a node, connect provider+model pins, or ensure AbstractCore "
                "has at least one available provider with models."
            )

        provider, model = provider_model
        try:
            from abstractruntime.integrations.abstractcore.factory import create_local_runtime
            # Older/newer AbstractRuntime distributions expose tool executors differently.
            # Tool execution is not required for plain LLM_CALL-only flows, so we make
            # this optional and fall back to the factory defaults.
            try:
                from abstractruntime.integrations.abstractcore import MappingToolExecutor  # type: ignore
            except Exception:  # pragma: no cover
                try:
                    from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor  # type: ignore
                except Exception:  # pragma: no cover
                    MappingToolExecutor = None  # type: ignore[assignment]
            try:
                from abstractruntime.integrations.abstractcore.default_tools import get_default_tools  # type: ignore
            except Exception:  # pragma: no cover
                get_default_tools = None  # type: ignore[assignment]
        except Exception as e:  # pragma: no cover
            raise RuntimeError(
                "This flow uses LLM nodes (llm_call/agent), but the installed AbstractRuntime "
                "does not provide the AbstractCore integration. Install/enable the integration "
                "or remove LLM nodes from the flow."
            ) from e

        tool_executor = None
        if MappingToolExecutor is not None and callable(get_default_tools):
            try:
                tool_executor = MappingToolExecutor.from_tools(get_default_tools())  # type: ignore[attr-defined]
            except Exception:
                tool_executor = None

        runtime = create_local_runtime(
            provider=provider,
            model=model,
            tool_executor=tool_executor,
        )
    else:
        runtime_kwargs: Dict[str, Any] = {
            "run_store": InMemoryRunStore(),
            "ledger_store": InMemoryLedgerStore(),
        }

        if needs_artifacts:
            # MEMORY_* effects require an ArtifactStore. Only configure it when needed.
            artifact_store_obj: Any = None
            try:
                from abstractruntime import InMemoryArtifactStore  # type: ignore
                artifact_store_obj = InMemoryArtifactStore()
            except Exception:  # pragma: no cover
                try:
                    from abstractruntime.storage.artifacts import InMemoryArtifactStore  # type: ignore
                    artifact_store_obj = InMemoryArtifactStore()
                except Exception as e:  # pragma: no cover
                    raise RuntimeError(
                        "This flow uses MEMORY_* nodes, but the installed AbstractRuntime "
                        "does not provide an ArtifactStore implementation."
                    ) from e

            # Only pass artifact_store if the runtime supports it (older runtimes may not).
            try:
                from inspect import signature

                if "artifact_store" in signature(Runtime).parameters:
                    runtime_kwargs["artifact_store"] = artifact_store_obj
            except Exception:  # pragma: no cover
                # Best-effort: attempt to set via method if present.
                pass

        runtime = Runtime(**runtime_kwargs)

        # Best-effort: configure artifact store via setter if supported.
        if needs_artifacts and "artifact_store" not in runtime_kwargs and hasattr(runtime, "set_artifact_store"):
            try:
                runtime.set_artifact_store(artifact_store_obj)  # type: ignore[name-defined]
            except Exception:
                pass

    flow = visual_to_flow(visual_flow)
    runner = FlowRunner(flow, runtime=runtime)

    if needs_registry:
        registry = WorkflowRegistry()
        registry.register(runner.workflow)
        for vf in ordered[1:]:
            child_flow = visual_to_flow(vf)
            child_spec = compile_flow(child_flow)
            registry.register(child_spec)

        # Register per-Agent-node subworkflows (canonical AbstractAgent ReAct).
        #
        # Visual Agent nodes compile into START_SUBWORKFLOW effects that reference a
        # deterministic workflow_id. The registry must contain those WorkflowSpecs.
        #
        # This keeps VisualFlow JSON portable across hosts: any host can run a
        # VisualFlow document by registering these derived specs alongside the flow.
        agent_nodes: list[tuple[str, Dict[str, Any]]] = []
        for vf in ordered:
            for n in vf.nodes:
                node_type = _node_type(n)
                if node_type != "agent":
                    continue
                cfg = n.data.get("agentConfig", {})
                agent_nodes.append((visual_react_workflow_id(flow_id=vf.id, node_id=n.id), cfg if isinstance(cfg, dict) else {}))

        if agent_nodes:
            try:
                from abstractagent.adapters.react_runtime import create_react_workflow
                from abstractagent.logic.react import ReActLogic
            except Exception as e:  # pragma: no cover
                raise RuntimeError(
                    "Visual Agent nodes require AbstractAgent to be installed/importable."
                ) from e

            from abstractcore.tools import ToolDefinition
            from abstractruntime.integrations.abstractcore.default_tools import filter_tool_specs

            def _tool_defs(tool_names: list[str]) -> list[ToolDefinition]:
                specs = filter_tool_specs(tool_names)
                out: list[ToolDefinition] = []
                for s in specs:
                    if not isinstance(s, dict):
                        continue
                    name = s.get("name")
                    if not isinstance(name, str) or not name.strip():
                        continue
                    desc = s.get("description")
                    params = s.get("parameters")
                    out.append(
                        ToolDefinition(
                            name=name.strip(),
                            description=str(desc or ""),
                            parameters=dict(params) if isinstance(params, dict) else {},
                        )
                    )
                return out

            def _normalize_tool_names(raw: Any) -> list[str]:
                if not isinstance(raw, list):
                    return []
                out: list[str] = []
                for t in raw:
                    if isinstance(t, str) and t.strip():
                        out.append(t.strip())
                return out

            for workflow_id, cfg in agent_nodes:
                provider_raw = cfg.get("provider")
                model_raw = cfg.get("model")
                # NOTE: Provider/model are injected durably through the Agent node's
                # START_SUBWORKFLOW vars (see compiler `_build_sub_vars`). We keep the
                # registered workflow spec provider/model-agnostic so Agent pins can
                # override without breaking persistence/resume.
                provider = None
                model = None

                tools_selected = _normalize_tool_names(cfg.get("tools"))
                logic = ReActLogic(tools=_tool_defs(tools_selected))
                registry.register(
                    create_react_workflow(
                        logic=logic,
                        workflow_id=workflow_id,
                        provider=provider,
                        model=model,
                        allowed_tools=tools_selected,
                    )
                )

        if hasattr(runtime, "set_workflow_registry"):
            runtime.set_workflow_registry(registry)  # type: ignore[name-defined]
        else:  # pragma: no cover
            raise RuntimeError(
                "This flow requires subworkflows (agent/subflow nodes), but the installed "
                "AbstractRuntime does not support workflow registries."
            )

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

    literal_node_ids: set[str] = set()
    # Pre-evaluate literal nodes and store their values
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)
        if type_str in LITERAL_NODE_TYPES:
            literal_value = node.data.get("literalValue")
            flow._node_outputs[node.id] = {"value": literal_value}  # type: ignore[attr-defined]
            literal_node_ids.add(node.id)

    # Compute execution reachability and ignore disconnected execution nodes.
    #
    # Visual editors often contain experimentation / orphan nodes. These should not
    # prevent execution of the reachable pipeline.
    exec_node_ids: set[str] = set()
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)
        if type_str in LITERAL_NODE_TYPES:
            continue
        if _has_execution_pins(type_str, node.data):
            exec_node_ids.add(node.id)

    def _pick_entry() -> Optional[str]:
        # Prefer explicit entryNode if it is an execution node.
        if isinstance(getattr(visual, "entryNode", None), str) and visual.entryNode in exec_node_ids:
            return visual.entryNode
        # Otherwise, infer entry as a node with no incoming execution edges.
        targets = {e.target for e in visual.edges if getattr(e, "targetHandle", None) == "exec-in"}
        for node in visual.nodes:
            if node.id in exec_node_ids and node.id not in targets:
                return node.id
        # Fallback: first exec node in document order
        for node in visual.nodes:
            if node.id in exec_node_ids:
                return node.id
        return None

    entry_exec = _pick_entry()
    reachable_exec: set[str] = set()
    if entry_exec:
        adj: Dict[str, list[str]] = {}
        for e in visual.edges:
            if getattr(e, "targetHandle", None) != "exec-in":
                continue
            if e.source not in exec_node_ids or e.target not in exec_node_ids:
                continue
            adj.setdefault(e.source, []).append(e.target)
        stack = [entry_exec]
        while stack:
            cur = stack.pop()
            if cur in reachable_exec:
                continue
            reachable_exec.add(cur)
            for nxt in adj.get(cur, []):
                if nxt not in reachable_exec:
                    stack.append(nxt)

    ignored_exec = sorted([nid for nid in exec_node_ids if nid not in reachable_exec])
    if ignored_exec:
        # Runtime-local metadata for hosts/UIs that want to show warnings.
        flow._ignored_exec_nodes = ignored_exec  # type: ignore[attr-defined]

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
            provider = input_data.get("provider") if isinstance(input_data, dict) else None
            model = input_data.get("model") if isinstance(input_data, dict) else None
            return {
                "task": task,
                "context": context,
                "provider": provider if isinstance(provider, str) else None,
                "model": model if isinstance(model, str) else None,
            }

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

    def _create_while_handler(data: Dict[str, Any]):
        def handler(input_data):
            condition = input_data.get("condition") if isinstance(input_data, dict) else bool(input_data)
            return {"condition": bool(condition)}

        return handler

    def _create_loop_handler(data: Dict[str, Any]):
        def handler(input_data):
            items = input_data.get("items") if isinstance(input_data, dict) else input_data
            if items is None:
                items = []
            if not isinstance(items, (list, tuple)):
                items = [items]
            items_list = list(items) if isinstance(items, tuple) else list(items)  # type: ignore[arg-type]
            return {"items": items_list, "count": len(items_list)}

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
        provider_default = config.get("provider", "")
        model_default = config.get("model", "")
        temperature = config.get("temperature", 0.7)

        def handler(input_data):
            prompt = input_data.get("prompt", "") if isinstance(input_data, dict) else str(input_data)
            system = input_data.get("system", "") if isinstance(input_data, dict) else ""

            provider = (
                input_data.get("provider")
                if isinstance(input_data, dict) and isinstance(input_data.get("provider"), str)
                else provider_default
            )
            model = (
                input_data.get("model")
                if isinstance(input_data, dict) and isinstance(input_data.get("model"), str)
                else model_default
            )

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

    def _create_model_catalog_handler(data: Dict[str, Any]):
        cfg = data.get("modelCatalogConfig", {}) if isinstance(data, dict) else {}
        cfg = dict(cfg) if isinstance(cfg, dict) else {}

        allowed_providers_default = cfg.get("allowedProviders")
        allowed_models_default = cfg.get("allowedModels")
        index_default = cfg.get("index", 0)

        def _as_str_list(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for x in raw:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        def handler(input_data: Any):
            # Allow pin-based overrides (data edges) while keeping node config as defaults.
            allowed_providers = _as_str_list(
                input_data.get("allowed_providers") if isinstance(input_data, dict) else None
            ) or _as_str_list(allowed_providers_default)
            allowed_models = _as_str_list(
                input_data.get("allowed_models") if isinstance(input_data, dict) else None
            ) or _as_str_list(allowed_models_default)

            idx_raw = input_data.get("index") if isinstance(input_data, dict) else None
            try:
                idx = int(idx_raw) if idx_raw is not None else int(index_default or 0)
            except Exception:
                idx = 0
            if idx < 0:
                idx = 0

            try:
                from abstractcore.providers.registry import get_all_providers_with_models, get_available_models_for_provider
            except Exception:
                return {"providers": [], "models": [], "pair": None, "provider": "", "model": ""}

            providers_meta = get_all_providers_with_models(include_models=False)
            available_providers: list[str] = []
            for p in providers_meta:
                if not isinstance(p, dict):
                    continue
                if p.get("status") != "available":
                    continue
                name = p.get("name")
                if isinstance(name, str) and name.strip():
                    available_providers.append(name.strip())

            if allowed_providers:
                allow = {x.lower(): x for x in allowed_providers}
                available_providers = [p for p in available_providers if p.lower() in allow]

            pairs: list[dict[str, str]] = []
            model_ids: list[str] = []

            allow_models_norm = {m.strip() for m in allowed_models if isinstance(m, str) and m.strip()}

            for provider in available_providers:
                try:
                    models = get_available_models_for_provider(provider)
                except Exception:
                    models = []
                if not isinstance(models, list):
                    models = []
                for m in models:
                    if not isinstance(m, str) or not m.strip():
                        continue
                    model = m.strip()
                    mid = f"{provider}/{model}"
                    if allow_models_norm:
                        # Accept either full ids or raw model names.
                        if mid not in allow_models_norm and model not in allow_models_norm:
                            continue
                    pairs.append({"provider": provider, "model": model, "id": mid})
                    model_ids.append(mid)

            selected = pairs[idx] if pairs and idx < len(pairs) else (pairs[0] if pairs else None)
            return {
                "providers": available_providers,
                "models": model_ids,
                "pair": selected,
                "provider": selected.get("provider", "") if isinstance(selected, dict) else "",
                "model": selected.get("model", "") if isinstance(selected, dict) else "",
            }

        return handler

    def _create_provider_catalog_handler(data: Dict[str, Any]):
        def _as_str_list(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for x in raw:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        def handler(input_data: Any):
            allowed_providers = _as_str_list(
                input_data.get("allowed_providers") if isinstance(input_data, dict) else None
            )

            try:
                from abstractcore.providers.registry import get_all_providers_with_models
            except Exception:
                return {"providers": []}

            providers_meta = get_all_providers_with_models(include_models=False)
            available: list[str] = []
            for p in providers_meta:
                if not isinstance(p, dict):
                    continue
                if p.get("status") != "available":
                    continue
                name = p.get("name")
                if isinstance(name, str) and name.strip():
                    available.append(name.strip())

            if allowed_providers:
                allow = {x.lower() for x in allowed_providers}
                available = [p for p in available if p.lower() in allow]

            return {"providers": available}

        return handler

    def _create_provider_models_handler(data: Dict[str, Any]):
        cfg = data.get("providerModelsConfig", {}) if isinstance(data, dict) else {}
        cfg = dict(cfg) if isinstance(cfg, dict) else {}

        def _as_str_list(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for x in raw:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        def handler(input_data: Any):
            provider = None
            if isinstance(input_data, dict) and isinstance(input_data.get("provider"), str):
                provider = input_data.get("provider")
            if not provider and isinstance(cfg.get("provider"), str):
                provider = cfg.get("provider")

            provider = str(provider or "").strip()
            if not provider:
                return {"provider": "", "models": []}

            allowed_models = _as_str_list(
                input_data.get("allowed_models") if isinstance(input_data, dict) else None
            )
            if not allowed_models:
                # Optional allowlist from node config when the pin isn't connected.
                allowed_models = _as_str_list(cfg.get("allowedModels")) or _as_str_list(cfg.get("allowed_models"))
            allow = {m for m in allowed_models if m}

            try:
                from abstractcore.providers.registry import get_available_models_for_provider
            except Exception:
                return {"provider": provider, "models": []}

            try:
                models = get_available_models_for_provider(provider)
            except Exception:
                models = []
            if not isinstance(models, list):
                models = []

            out: list[str] = []
            for m in models:
                if not isinstance(m, str) or not m.strip():
                    continue
                name = m.strip()
                mid = f"{provider}/{name}"
                if allow and (name not in allow and mid not in allow):
                    continue
                out.append(name)

            return {"provider": provider, "models": out}

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

        # Sequence / Parallel are scheduler nodes compiled specially by `compile_flow`.
        # Their runtime semantics are handled in `abstractflow.adapters.control_adapter`.
        if type_str in ("sequence", "parallel"):
            return lambda x: x

        builtin = get_builtin_handler(type_str)
        if builtin:
            return _wrap_builtin(builtin, data)

        if type_str == "code":
            code = data.get("code", "def transform(input):\n    return input")
            function_name = data.get("functionName", "transform")
            return create_code_handler(code, function_name)

        if type_str == "agent":
            return _create_agent_input_handler(data)

        if type_str == "model_catalog":
            return _create_model_catalog_handler(data)

        if type_str == "provider_catalog":
            return _create_provider_catalog_handler(data)

        if type_str == "provider_models":
            return _create_provider_models_handler(data)

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
        if type_str == "while":
            return _create_while_handler(data)
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

        # Ignore disconnected/unreachable execution nodes.
        if reachable_exec and node.id not in reachable_exec:
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
            raw_cfg = node.data.get("agentConfig", {})
            cfg = dict(raw_cfg) if isinstance(raw_cfg, dict) else {}
            cfg.setdefault(
                "_react_workflow_id",
                visual_react_workflow_id(flow_id=visual.id, node_id=node.id),
            )
            effect_config = cfg
        elif type_str in ("sequence", "parallel"):
            # Control-flow scheduler nodes. Store pin order so compilation can
            # execute branches deterministically (Blueprint-style).
            effect_type = type_str

            pins = node.data.get("outputs") if isinstance(node.data, dict) else None
            exec_ids: list[str] = []
            if isinstance(pins, list):
                for p in pins:
                    if not isinstance(p, dict):
                        continue
                    if p.get("type") != "execution":
                        continue
                    pid = p.get("id")
                    if isinstance(pid, str) and pid:
                        exec_ids.append(pid)

            def _then_key(h: str) -> int:
                try:
                    if h.startswith("then:"):
                        return int(h.split(":", 1)[1])
                except Exception:
                    pass
                return 10**9

            then_handles = sorted([h for h in exec_ids if h.startswith("then:")], key=_then_key)
            cfg = {"then_handles": then_handles}
            if type_str == "parallel":
                cfg["completed_handle"] = "completed"
            effect_config = cfg
        elif type_str == "loop":
            # Control-flow scheduler node (Blueprint-style foreach).
            # Runtime semantics are handled in `abstractflow.adapters.control_adapter`.
            effect_type = type_str
            effect_config = {}
        elif type_str == "while":
            # Control-flow scheduler node (Blueprint-style while).
            # Runtime semantics are handled in `abstractflow.adapters.control_adapter`.
            effect_type = type_str
            effect_config = {}
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

        # Always attach minimal visual metadata for downstream compilation/wrapping.
        meta_cfg: Dict[str, Any] = {"_visual_type": type_str}
        if isinstance(effect_config, dict):
            meta_cfg.update(effect_config)
        effect_config = meta_cfg

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
