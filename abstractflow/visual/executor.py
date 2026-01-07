"""Portable visual-flow execution utilities.

This module converts visual-editor flow JSON into an `abstractflow.Flow` and
provides a convenience `create_visual_runner()` that wires an AbstractRuntime
instance with the right integrations (LLM/MEMORY/SUBFLOW) for execution.

The goal is host portability: the same visual flow should run from non-web
hosts (AbstractCode, CLI) without importing the web backend implementation.
"""

from __future__ import annotations

import os
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


def create_visual_runner(
    visual_flow: VisualFlow,
    *,
    flows: Dict[str, VisualFlow],
    run_store: Optional[Any] = None,
    ledger_store: Optional[Any] = None,
    artifact_store: Optional[Any] = None,
    tool_executor: Optional[Any] = None,
) -> FlowRunner:
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
    from .event_ids import visual_event_listener_workflow_id
    from .session_runner import VisualSessionRunner

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
            "on_event",
            "on_flow_end",
            "agent",
            "function",
            "code",
            "subflow",
            # Workflow variables (execution setter)
            "set_var",
            "set_vars",
            "set_var_property",
            # Control exec
            "if",
            "switch",
            "loop",
            "while",
            "for",
            "sequence",
            "parallel",
            # Effects
            "ask_user",
            "answer_user",
            "llm_call",
            "tool_calls",
            "wait_until",
            "wait_event",
            "emit_event",
            "read_file",
            "write_file",
            "memory_note",
            "memory_query",
            "memory_rehydrate",
        }

        node_types: Dict[str, str] = {n.id: _node_type(n) for n in vf.nodes}
        exec_ids = {nid for nid, t in node_types.items() if t in EXEC_TYPES}
        if not exec_ids:
            return set()

        incoming_exec = {e.target for e in vf.edges if getattr(e, "targetHandle", None) == "exec-in"}

        roots: list[str] = []
        if isinstance(vf.entryNode, str) and vf.entryNode in exec_ids:
            roots.append(vf.entryNode)
        # Custom events are independent entrypoints; include them as roots for "executable" reachability.
        for n in vf.nodes:
            if n.id in exec_ids and node_types.get(n.id) == "on_event":
                roots.append(n.id)

        if not roots:
            # Fallback: infer a single root as "exec node with no incoming edge".
            for n in vf.nodes:
                if n.id in exec_ids and n.id not in incoming_exec:
                    roots.append(n.id)
                    break
        if not roots:
            roots.append(next(iter(exec_ids)))

        adj: Dict[str, list[str]] = {}
        for e in vf.edges:
            if getattr(e, "targetHandle", None) != "exec-in":
                continue
            if e.source not in exec_ids or e.target not in exec_ids:
                continue
            adj.setdefault(e.source, []).append(e.target)

        reachable: set[str] = set()
        stack2 = list(dict.fromkeys([r for r in roots if isinstance(r, str) and r]))
        while stack2:
            cur = stack2.pop()
            if cur in reachable:
                continue
            reachable.add(cur)
            for nxt in adj.get(cur, []):
                if nxt not in reachable:
                    stack2.append(nxt)
        return reachable

    # Collect all reachable flows (root + transitive subflows).
    #
    # Important: subflows are executed via runtime `START_SUBWORKFLOW` by workflow id.
    # This means subflow cycles (including self-recursion) are valid and should not be
    # rejected at runner-wiring time; we only need to register each workflow id once.
    ordered: list[VisualFlow] = []
    visited: set[str] = set()

    def _dfs(vf: VisualFlow) -> None:
        if vf.id in visited:
            return
        visited.add(vf.id)
        ordered.append(vf)

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
            # Self-recursion should work even if `flows` does not redundantly include this vf.
            if child is None and subflow_id == vf.id:
                child = vf
            if child is None:
                raise ValueError(f"Referenced subflow '{subflow_id}' not found")
            _dfs(child)

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
            if t in {"on_event", "emit_event"}:
                needs_registry = True
            if t in {"memory_note", "memory_query", "memory_rehydrate"}:
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
            if node_type in {"llm_call", "agent", "tool_calls"}:
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

        effective_tool_executor = tool_executor
        if effective_tool_executor is None and MappingToolExecutor is not None and callable(get_default_tools):
            try:
                effective_tool_executor = MappingToolExecutor.from_tools(get_default_tools())  # type: ignore[attr-defined]
            except Exception:
                effective_tool_executor = None

        # LLM timeout policy (web-hosted workflow execution).
        #
        # Contract:
        # - AbstractRuntime (the orchestrator) is the authority for execution policy such as timeouts.
        # - This host can *override* that policy via env for deployments that want a different SLO.
        #
        # Env overrides:
        # - ABSTRACTFLOW_LLM_TIMEOUT_S (float seconds)
        # - ABSTRACTFLOW_LLM_TIMEOUT (alias)
        #
        # Set to 0 or a negative value to opt into "unlimited".
        llm_kwargs: Dict[str, Any] = {}
        timeout_raw = os.getenv("ABSTRACTFLOW_LLM_TIMEOUT_S") or os.getenv("ABSTRACTFLOW_LLM_TIMEOUT")
        if timeout_raw is None or not str(timeout_raw).strip():
            # No override: let the orchestrator (AbstractRuntime) apply its default.
            pass
        else:
            raw = str(timeout_raw).strip().lower()
            if raw in {"none", "null", "inf", "infinite", "unlimited"}:
                # Explicit override: opt back into unlimited HTTP requests.
                llm_kwargs["timeout"] = None
            else:
                try:
                    timeout_s = float(raw)
                except Exception:
                    timeout_s = None
                # Only override when parsing succeeded; otherwise fall back to AbstractCore config default.
                if timeout_s is None:
                    pass
                elif isinstance(timeout_s, (int, float)) and timeout_s <= 0:
                    # Consistent with the documented behavior: <=0 => unlimited.
                    llm_kwargs["timeout"] = None
                else:
                    llm_kwargs["timeout"] = timeout_s

        # Default output token cap for web-hosted runs.
        #
        # Without an explicit max_output_tokens, agent-style loops can produce very long
        # responses that are both slow (local inference) and unhelpful for a visual UI
        # (tools should write files; the model should not dump huge blobs into chat).
        max_out_raw = os.getenv("ABSTRACTFLOW_LLM_MAX_OUTPUT_TOKENS") or os.getenv("ABSTRACTFLOW_MAX_OUTPUT_TOKENS")
        max_out: Optional[int] = None
        if max_out_raw is None or not str(max_out_raw).strip():
            max_out = 4096
        else:
            try:
                max_out = int(str(max_out_raw).strip())
            except Exception:
                max_out = 4096
        if isinstance(max_out, int) and max_out <= 0:
            max_out = None

        # Pass runtime config to initialize `_limits.max_output_tokens`.
        try:
            from abstractruntime.core.config import RuntimeConfig
            runtime_config = RuntimeConfig(max_output_tokens=max_out)
        except Exception:  # pragma: no cover
            runtime_config = None

        runtime = create_local_runtime(
            provider=provider,
            model=model,
            llm_kwargs=llm_kwargs,
            tool_executor=effective_tool_executor,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
            config=runtime_config,
        )
    else:
        runtime_kwargs: Dict[str, Any] = {
            "run_store": run_store or InMemoryRunStore(),
            "ledger_store": ledger_store or InMemoryLedgerStore(),
        }

        if needs_artifacts:
            # MEMORY_* effects require an ArtifactStore. Only configure it when needed.
            artifact_store_obj: Any = artifact_store
            if artifact_store_obj is None:
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
    # Build and register custom event listener workflows (On Event nodes).
    event_listener_specs: list[Any] = []
    if needs_registry:
        try:
            from .agent_ids import visual_react_workflow_id
        except Exception:  # pragma: no cover
            visual_react_workflow_id = None  # type: ignore[assignment]

        for vf in ordered:
            reachable = _reachable_exec_node_ids(vf)
            for n in vf.nodes:
                if _node_type(n) != "on_event":
                    continue
                # On Event nodes are roots by definition (even if disconnected from the main entry).
                if reachable and n.id not in reachable:
                    continue

                workflow_id = visual_event_listener_workflow_id(flow_id=vf.id, node_id=n.id)

                # Create a derived VisualFlow for this listener workflow:
                # - workflow id is unique (so it can be registered)
                # - entryNode is the on_event node
                derived = vf.model_copy(deep=True)
                derived.id = workflow_id
                derived.entryNode = n.id

                # Ensure Agent nodes inside this derived workflow reference the canonical
                # ReAct workflow IDs based on the *source* flow id, not the derived id.
                if callable(visual_react_workflow_id):
                    for dn in derived.nodes:
                        if _node_type(dn) != "agent":
                            continue
                        raw_cfg = dn.data.get("agentConfig", {}) if isinstance(dn.data, dict) else {}
                        cfg = dict(raw_cfg) if isinstance(raw_cfg, dict) else {}
                        cfg.setdefault(
                            "_react_workflow_id",
                            visual_react_workflow_id(flow_id=vf.id, node_id=dn.id),
                        )
                        dn.data["agentConfig"] = cfg

                listener_flow = visual_to_flow(derived)
                listener_spec = compile_flow(listener_flow)
                event_listener_specs.append(listener_spec)
    runner: FlowRunner
    if event_listener_specs:
        runner = VisualSessionRunner(flow, runtime=runtime, event_listener_specs=event_listener_specs)
    else:
        runner = FlowRunner(flow, runtime=runtime)

    if needs_registry:
        registry = WorkflowRegistry()
        registry.register(runner.workflow)
        for vf in ordered[1:]:
            child_flow = visual_to_flow(vf)
            child_spec = compile_flow(child_flow)
            registry.register(child_spec)
        for spec in event_listener_specs:
            registry.register(spec)

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
            from abstractruntime.integrations.abstractcore.default_tools import list_default_tool_specs

            def _tool_defs_from_specs(specs: list[dict[str, Any]]) -> list[ToolDefinition]:
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

            all_tool_defs = _tool_defs_from_specs(list_default_tool_specs())
            # Add schema-only runtime tools (executed as runtime effects by AbstractAgent adapters).
            try:
                from abstractagent.logic.builtins import (  # type: ignore
                    ASK_USER_TOOL,
                    COMPACT_MEMORY_TOOL,
                    INSPECT_VARS_TOOL,
                    RECALL_MEMORY_TOOL,
                    REMEMBER_TOOL,
                )

                builtin_defs = [ASK_USER_TOOL, RECALL_MEMORY_TOOL, INSPECT_VARS_TOOL, REMEMBER_TOOL, COMPACT_MEMORY_TOOL]
                seen_names = {t.name for t in all_tool_defs if getattr(t, "name", None)}
                for t in builtin_defs:
                    if getattr(t, "name", None) and t.name not in seen_names:
                        all_tool_defs.append(t)
                        seen_names.add(t.name)
            except Exception:
                pass

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
                logic = ReActLogic(tools=all_tool_defs)
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
    flow._pure_node_ids = set()  # type: ignore[attr-defined]
    flow._volatile_pure_node_ids = set()  # type: ignore[attr-defined]
    # Snapshot of "static" node outputs (literals, schemas, etc.). This is used to
    # reset the in-memory cache when the same compiled VisualFlow is executed by
    # multiple runs (e.g. recursive/mutual subflows). See compiler._sync_effect_results_to_node_outputs.
    flow._static_node_outputs = {}  # type: ignore[attr-defined]
    flow._active_run_id = None  # type: ignore[attr-defined]

    def _normalize_pin_defaults(raw: Any) -> Dict[str, Any]:
        if not isinstance(raw, dict):
            return {}
        out: Dict[str, Any] = {}
        for k, v in raw.items():
            if not isinstance(k, str) or not k:
                continue
            # Allow JSON-serializable values (including arrays/objects) for defaults.
            # These are cloned at use-sites to avoid cross-run mutation.
            if v is None or isinstance(v, (str, int, float, bool, dict, list)):
                out[k] = v
        return out

    def _clone_default(value: Any) -> Any:
        # Prevent accidental shared-mutation of dict/list defaults across runs.
        if isinstance(value, (dict, list)):
            try:
                import copy

                return copy.deepcopy(value)
            except Exception:
                return value
        return value

    pin_defaults_by_node_id: Dict[str, Dict[str, Any]] = {}
    for node in visual.nodes:
        raw_defaults = node.data.get("pinDefaults") if isinstance(node.data, dict) else None
        normalized = _normalize_pin_defaults(raw_defaults)
        if normalized:
            pin_defaults_by_node_id[node.id] = normalized

    LITERAL_NODE_TYPES = {
        "literal_string",
        "literal_number",
        "literal_boolean",
        "literal_json",
        "json_schema",
        "literal_array",
    }

    pure_base_handlers: Dict[str, Any] = {}
    pure_node_ids: set[str] = set()

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
        # These nodes are pure (data-only) even if the JSON document omitted template pins.
        # This keeps programmatic tests and host-built VisualFlows portable.
        if type_str in {"get_var", "bool_var", "var_decl"}:
            return False
        if type_str == "break_object":
            return False
        if get_builtin_handler(type_str) is not None:
            return False
        return True

    evaluating: set[str] = set()
    volatile_pure_node_ids: set[str] = getattr(flow, "_volatile_pure_node_ids", set())  # type: ignore[attr-defined]

    def _ensure_node_output(node_id: str) -> None:
        if node_id in flow._node_outputs and node_id not in volatile_pure_node_ids:  # type: ignore[attr-defined]
            return

        handler = pure_base_handlers.get(node_id)
        if handler is None:
            return

        if node_id in evaluating:
            raise ValueError(f"Data edge cycle detected at '{node_id}'")

        evaluating.add(node_id)
        try:
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

            defaults = pin_defaults_by_node_id.get(node_id)
            if defaults:
                for pin_id, value in defaults.items():
                    if pin_id in data_edge_map.get(node_id, {}):
                        continue
                    if pin_id not in resolved_input:
                        resolved_input[pin_id] = _clone_default(value)

            result = handler(resolved_input if resolved_input else {})
            flow._node_outputs[node_id] = result  # type: ignore[attr-defined]
        finally:
            # IMPORTANT: even if an upstream pure node raises (bad input / parse_json failure),
            # we must not leave `node_id` in `evaluating`, otherwise later evaluations can
            # surface as a misleading "data edge cycle" at this node.
            try:
                evaluating.remove(node_id)
            except KeyError:
                pass

    EFFECT_NODE_TYPES = {
        "ask_user",
        "answer_user",
        "llm_call",
        "tool_calls",
        "wait_until",
        "wait_event",
        "emit_event",
        "memory_note",
        "memory_query",
        "memory_rehydrate",
    }

    literal_node_ids: set[str] = set()
    # Pre-evaluate literal nodes and store their values
    for node in visual.nodes:
        type_str = node.type.value if hasattr(node.type, "value") else str(node.type)
        if type_str in LITERAL_NODE_TYPES:
            literal_value = node.data.get("literalValue")
            flow._node_outputs[node.id] = {"value": literal_value}  # type: ignore[attr-defined]
            literal_node_ids.add(node.id)
    # Capture baseline outputs (typically only literal nodes). This baseline must
    # remain stable across runs so we can safely reset `_node_outputs` when switching
    # between different `RunState.run_id` contexts (self-recursive subflows).
    try:
        flow._static_node_outputs = dict(flow._node_outputs)  # type: ignore[attr-defined]
    except Exception:
        flow._static_node_outputs = {}  # type: ignore[attr-defined]

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

    def _create_read_file_handler(_data: Dict[str, Any]):
        import json
        from pathlib import Path

        def handler(input_data: Any) -> Dict[str, Any]:
            payload = input_data if isinstance(input_data, dict) else {}
            raw_path = payload.get("file_path")
            if not isinstance(raw_path, str) or not raw_path.strip():
                raise ValueError("read_file requires a non-empty 'file_path' input.")

            file_path = raw_path.strip()
            path = Path(file_path).expanduser()
            if not path.is_absolute():
                path = Path.cwd() / path

            if not path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")
            if not path.is_file():
                raise ValueError(f"Not a file: {file_path}")

            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError as e:
                raise ValueError(f"Cannot read '{file_path}' as UTF-8: {e}") from e

            # Detect JSON primarily from file extension; also opportunistically parse
            # when the content looks like JSON. Markdown and text are returned as-is.
            lower_name = path.name.lower()
            content_stripped = text.lstrip()
            looks_like_json = bool(content_stripped) and content_stripped[0] in "{["

            if lower_name.endswith(".json"):
                try:
                    return {"content": json.loads(text)}
                except Exception as e:
                    raise ValueError(f"Invalid JSON in '{file_path}': {e}") from e

            if looks_like_json:
                try:
                    return {"content": json.loads(text)}
                except Exception:
                    pass

            return {"content": text}

        return handler

    def _create_write_file_handler(_data: Dict[str, Any]):
        import json
        from pathlib import Path

        def handler(input_data: Any) -> Dict[str, Any]:
            payload = input_data if isinstance(input_data, dict) else {}
            raw_path = payload.get("file_path")
            if not isinstance(raw_path, str) or not raw_path.strip():
                raise ValueError("write_file requires a non-empty 'file_path' input.")

            file_path = raw_path.strip()
            path = Path(file_path).expanduser()
            if not path.is_absolute():
                path = Path.cwd() / path

            raw_content = payload.get("content")

            if path.name.lower().endswith(".json"):
                if isinstance(raw_content, str):
                    try:
                        raw_content = json.loads(raw_content)
                    except Exception as e:
                        raise ValueError(f"write_file JSON content must be valid JSON: {e}") from e
                text = json.dumps(raw_content, indent=2, ensure_ascii=False)
                if not text.endswith("\n"):
                    text += "\n"
            else:
                if raw_content is None:
                    text = ""
                elif isinstance(raw_content, str):
                    text = raw_content
                elif isinstance(raw_content, (dict, list)):
                    text = json.dumps(raw_content, indent=2, ensure_ascii=False)
                else:
                    text = str(raw_content)

            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

            return {"bytes": len(text.encode("utf-8")), "file_path": str(path)}

        return handler

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
            # Backward-compat: programmatic/test-created VisualNodes may omit template pins.
            # In that case, infer a stable pin order from the provided input keys at runtime
            # (prefer a..z single-letter pins), so `a`, `b`, ... behave as expected.
            pin_order = []

        def handler(input_data: Any) -> str:
            if not isinstance(input_data, dict):
                return str(input_data or "")

            parts: list[str] = []
            if pin_order:
                order = pin_order
            else:
                # Stable inference for missing pin metadata.
                keys = [k for k in input_data.keys() if isinstance(k, str)]
                letter = sorted([k for k in keys if len(k) == 1 and "a" <= k <= "z"])
                other = sorted([k for k in keys if k not in set(letter)])
                order = letter + other

            for pid in order:
                if pid in input_data:
                    v = input_data.get(pid)
                    parts.append("" if v is None else str(v))
            return separator.join(parts)

        return handler

    def _create_make_array_handler(data: Dict[str, Any]):
        """Build an array from 1+ inputs in pin order.

        Design:
        - We treat missing/unset pins as absent (skip None) to avoid surprising `null`
          elements when a pin is present but unconnected.
        - We do NOT flatten arrays/tuples; if you want flattening/concatenation,
          use `array_concat`.
        """
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
                out.append(v)
            return out

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

            # Best-effort: tolerate JSON-ish strings (common when breaking LLM outputs).
            if isinstance(src_obj, str) and src_obj.strip():
                try:
                    parser = get_builtin_handler("parse_json")
                    if parser is not None:
                        src_obj = parser({"text": src_obj, "wrap_scalar": True})
                except Exception:
                    pass

            out: Dict[str, Any] = {}
            for path in selected_paths:
                out[path] = _get_path(src_obj, path)
            return out

        return handler

    def _get_by_path(value: Any, path: str) -> Any:
        """Best-effort dotted-path lookup supporting dicts and numeric list indices."""
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

    def _create_get_var_handler(_data: Dict[str, Any]):
        # Pure node: reads from the current run vars (attached onto the Flow by the compiler).
        # Mark as volatile so it is recomputed whenever requested (avoids stale cached reads).
        def handler(input_data: Any) -> Dict[str, Any]:
            payload = input_data if isinstance(input_data, dict) else {}
            raw_name = payload.get("name")
            name = (raw_name if isinstance(raw_name, str) else str(raw_name or "")).strip()
            run_vars = getattr(flow, "_run_vars", None)  # type: ignore[attr-defined]
            if not isinstance(run_vars, dict) or not name:
                return {"value": None}
            return {"value": _get_by_path(run_vars, name)}

        return handler

    def _create_bool_var_handler(data: Dict[str, Any]):
        """Pure node: reads a workflow-level boolean variable from run.vars with a default.

        Config is stored in the visual node's `literalValue` as either:
        - a string: variable name
        - an object: { "name": "...", "default": true|false }
        """
        raw_cfg = data.get("literalValue")
        name_cfg = ""
        default_cfg = False
        if isinstance(raw_cfg, str):
            name_cfg = raw_cfg.strip()
        elif isinstance(raw_cfg, dict):
            n = raw_cfg.get("name")
            if isinstance(n, str):
                name_cfg = n.strip()
            d = raw_cfg.get("default")
            if isinstance(d, bool):
                default_cfg = d

        def handler(input_data: Any) -> Dict[str, Any]:
            del input_data
            run_vars = getattr(flow, "_run_vars", None)  # type: ignore[attr-defined]
            if not isinstance(run_vars, dict) or not name_cfg:
                return {"name": name_cfg, "value": bool(default_cfg)}

            raw = _get_by_path(run_vars, name_cfg)
            if isinstance(raw, bool):
                return {"name": name_cfg, "value": raw}
            return {"name": name_cfg, "value": bool(default_cfg)}

        return handler

    def _create_var_decl_handler(data: Dict[str, Any]):
        """Pure node: typed workflow variable declaration (name + type + default).

        Config is stored in `literalValue`:
          { "name": "...", "type": "boolean|number|string|object|array|any", "default": ... }

        Runtime semantics:
        - Read `run.vars[name]` (via `flow._run_vars`), and return it if it matches the declared type.
        - Otherwise fall back to the declared default.
        """
        raw_cfg = data.get("literalValue")
        name_cfg = ""
        type_cfg = "any"
        default_cfg: Any = None
        if isinstance(raw_cfg, dict):
            n = raw_cfg.get("name")
            if isinstance(n, str):
                name_cfg = n.strip()
            t = raw_cfg.get("type")
            if isinstance(t, str) and t.strip():
                type_cfg = t.strip()
            default_cfg = raw_cfg.get("default")

        allowed_types = {"boolean", "number", "string", "object", "array", "any"}
        if type_cfg not in allowed_types:
            type_cfg = "any"

        def _matches(v: Any) -> bool:
            if type_cfg == "any":
                return True
            if type_cfg == "boolean":
                return isinstance(v, bool)
            if type_cfg == "number":
                return isinstance(v, (int, float)) and not isinstance(v, bool)
            if type_cfg == "string":
                return isinstance(v, str)
            if type_cfg == "array":
                return isinstance(v, list)
            if type_cfg == "object":
                return isinstance(v, dict)
            return True

        def _default_for_type() -> Any:
            if type_cfg == "boolean":
                return False
            if type_cfg == "number":
                return 0
            if type_cfg == "string":
                return ""
            if type_cfg == "array":
                return []
            if type_cfg == "object":
                return {}
            return None

        def handler(input_data: Any) -> Dict[str, Any]:
            del input_data
            run_vars = getattr(flow, "_run_vars", None)  # type: ignore[attr-defined]
            if not isinstance(run_vars, dict) or not name_cfg:
                v = default_cfg if _matches(default_cfg) else _default_for_type()
                return {"name": name_cfg, "value": v}

            raw = _get_by_path(run_vars, name_cfg)
            if _matches(raw):
                return {"name": name_cfg, "value": raw}

            v = default_cfg if _matches(default_cfg) else _default_for_type()
            return {"name": name_cfg, "value": v}

        return handler

    def _create_set_var_handler(_data: Dict[str, Any]):
        # Execution node: does not mutate run.vars here (handled by compiler adapter).
        # This handler exists to participate in data-edge resolution and expose outputs.
        #
        # Important UX contract:
        # - In the visual editor, primitive pins (boolean/number/string) show default UI controls
        #   even when the user hasn't explicitly edited them.
        # - If we treat "missing" as None here, `Set Variable` would write None and this can
        #   cause typed `Variable` (`var_decl`) to fall back to its default (e.g. staying True).
        # - Therefore we default missing primitive values to their natural defaults.
        pins = _data.get("inputs") if isinstance(_data, dict) else None
        value_pin_type: Optional[str] = None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("id") != "value":
                    continue
                t = p.get("type")
                if isinstance(t, str) and t:
                    value_pin_type = t
                break

        def handler(input_data: Any) -> Dict[str, Any]:
            payload = input_data if isinstance(input_data, dict) else {}
            value_specified = isinstance(payload, dict) and "value" in payload
            value = payload.get("value")

            if not value_specified:
                if value_pin_type == "boolean":
                    value = False
                elif value_pin_type == "number":
                    value = 0
                elif value_pin_type == "string":
                    value = ""

            return {"name": payload.get("name"), "value": value}

        return handler

    def _wrap_builtin(handler, data: Dict[str, Any]):
        literal_value = data.get("literalValue")
        # Preserve pin order for builtins that need deterministic input selection (e.g. coalesce).
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

        def wrapped(input_data):
            if isinstance(input_data, dict):
                inputs = input_data.copy()
            else:
                inputs = {"value": input_data, "a": input_data, "text": input_data}

            if literal_value is not None:
                inputs["_literalValue"] = literal_value
            if pin_order:
                inputs["_pin_order"] = list(pin_order)

            return handler(inputs)

        return wrapped

    def _create_agent_input_handler(data: Dict[str, Any]):
        cfg = data.get("agentConfig", {}) if isinstance(data, dict) else {}
        cfg = cfg if isinstance(cfg, dict) else {}

        def _normalize_response_schema(raw: Any) -> Optional[Dict[str, Any]]:
            """Normalize a structured-output schema input into a JSON Schema dict.

            Supported inputs (best-effort):
            - JSON Schema dict: {"type":"object","properties":{...}, ...}
            - LMStudio/OpenAI-style wrapper: {"type":"json_schema","json_schema": {"schema": {...}}}
            """
            if raw is None:
                return None
            if isinstance(raw, dict):
                if raw.get("type") == "json_schema" and isinstance(raw.get("json_schema"), dict):
                    inner = raw.get("json_schema")
                    if isinstance(inner, dict) and isinstance(inner.get("schema"), dict):
                        return dict(inner.get("schema") or {})
                return dict(raw)
            return None

        def _normalize_tool_names(raw: Any) -> list[str]:
            if raw is None:
                return []
            items: list[Any]
            if isinstance(raw, list):
                items = raw
            elif isinstance(raw, tuple):
                items = list(raw)
            else:
                items = [raw]
            out: list[str] = []
            for t in items:
                if isinstance(t, str) and t.strip():
                    out.append(t.strip())
            # preserve order, remove duplicates
            seen: set[str] = set()
            uniq: list[str] = []
            for t in out:
                if t in seen:
                    continue
                seen.add(t)
                uniq.append(t)
            return uniq

        def handler(input_data):
            task = ""
            if isinstance(input_data, dict):
                raw_task = input_data.get("task")
                if raw_task is None:
                    raw_task = input_data.get("prompt")
                task = "" if raw_task is None else str(raw_task)
            else:
                task = str(input_data)

            context_raw = input_data.get("context", {}) if isinstance(input_data, dict) else {}
            context = context_raw if isinstance(context_raw, dict) else {}
            provider = input_data.get("provider") if isinstance(input_data, dict) else None
            model = input_data.get("model") if isinstance(input_data, dict) else None

            system_raw = input_data.get("system") if isinstance(input_data, dict) else ""
            system = system_raw if isinstance(system_raw, str) else str(system_raw or "")

            tools_specified = isinstance(input_data, dict) and "tools" in input_data
            tools_raw = input_data.get("tools") if isinstance(input_data, dict) else None
            tools = _normalize_tool_names(tools_raw) if tools_specified else []
            if not tools_specified:
                tools = _normalize_tool_names(cfg.get("tools"))

            out: Dict[str, Any] = {
                "task": task,
                "context": context,
                "provider": provider if isinstance(provider, str) else None,
                "model": model if isinstance(model, str) else None,
                "system": system,
                "tools": tools,
            }

            # Optional pin overrides (passed through for compiler/runtime consumption).
            if isinstance(input_data, dict) and "max_iterations" in input_data:
                out["max_iterations"] = input_data.get("max_iterations")

            if isinstance(input_data, dict) and "response_schema" in input_data:
                schema = _normalize_response_schema(input_data.get("response_schema"))
                if isinstance(schema, dict) and schema:
                    out["response_schema"] = schema

            include_context_specified = isinstance(input_data, dict) and (
                "include_context" in input_data or "use_context" in input_data
            )
            if include_context_specified:
                raw_inc = (
                    input_data.get("include_context")
                    if isinstance(input_data, dict) and "include_context" in input_data
                    else input_data.get("use_context") if isinstance(input_data, dict) else None
                )
                out["include_context"] = _coerce_bool(raw_inc)

            return out

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
                    # Control pin (not forwarded into child vars).
                    if pid in {"inherit_context", "inheritContext"}:
                        continue
                    input_pin_ids.append(pid)

        inherit_cfg = None
        if isinstance(data, dict):
            cfg = data.get("effectConfig")
            if isinstance(cfg, dict):
                inherit_cfg = cfg.get("inherit_context")
                if inherit_cfg is None:
                    inherit_cfg = cfg.get("inheritContext")
        inherit_context_default = bool(inherit_cfg) if inherit_cfg is not None else False

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

            # Never forward control pins into the child run vars.
            sub_vars_dict.pop("inherit_context", None)
            sub_vars_dict.pop("inheritContext", None)

            inherit_context_specified = isinstance(input_data, dict) and (
                "inherit_context" in input_data or "inheritContext" in input_data
            )
            if inherit_context_specified:
                raw_inherit = (
                    input_data.get("inherit_context")
                    if isinstance(input_data, dict) and "inherit_context" in input_data
                    else input_data.get("inheritContext") if isinstance(input_data, dict) else None
                )
                inherit_context_value = _coerce_bool(raw_inherit)
            else:
                inherit_context_value = inherit_context_default

            return {
                "output": None,
                "_pending_effect": (
                    {
                        "type": "start_subworkflow",
                        "workflow_id": subflow_id,
                        "vars": sub_vars_dict,
                        # Start subworkflows in async+wait mode so hosts (notably AbstractFlow Web)
                        # can tick child runs incrementally and stream their node_start/node_complete
                        # events for better observability (nested/recursive subflows).
                        #
                        # Non-interactive hosts (tests/CLI) still complete synchronously because
                        # FlowRunner.run() auto-drives WAITING(SUBWORKFLOW) children and resumes
                        # parents until completion.
                        "async": True,
                        "wait": True,
                        **({"inherit_context": True} if inherit_context_value else {}),
                    }
                ),
            }

        return handler

    def _create_event_handler(event_type: str, data: Dict[str, Any]):
        # Event nodes are special: they bridge external inputs / runtime vars into the graph.
        #
        # Critical constraint: RunState.vars must remain JSON-serializable for durable execution.
        # The runtime persists per-node outputs in `vars["_temp"]["node_outputs"]`. If an event node
        # returns the full `run.vars` dict (which contains `_temp`), we create a self-referential
        # cycle: `_temp -> node_outputs -> <start_output>['_temp'] -> _temp`, which explodes during
        # persistence (e.g. JsonFileRunStore uses dataclasses.asdict()).
        #
        # Therefore, `on_flow_start` must *not* leak internal namespaces like `_temp` into outputs.
        start_pin_ids: list[str] = []
        pins = data.get("outputs") if isinstance(data, dict) else None
        if isinstance(pins, list):
            for p in pins:
                if not isinstance(p, dict):
                    continue
                if p.get("type") == "execution":
                    continue
                pid = p.get("id")
                if isinstance(pid, str) and pid:
                    start_pin_ids.append(pid)

        def handler(input_data):
            if event_type == "on_flow_start":
                # Prefer explicit pins: the visual editor treats non-exec output pins as
                # "Flow Start Parameters" (initial vars). Only expose those by default.
                if isinstance(input_data, dict):
                    defaults_raw = data.get("pinDefaults") if isinstance(data, dict) else None
                    defaults = defaults_raw if isinstance(defaults_raw, dict) else {}
                    if start_pin_ids:
                        out: Dict[str, Any] = {}
                        for pid in start_pin_ids:
                            if pid in input_data:
                                out[pid] = input_data.get(pid)
                                continue
                            if isinstance(pid, str) and pid in defaults:
                                dv = defaults.get(pid)
                                out[pid] = _clone_default(dv)
                                # Also seed run.vars for downstream Get Variable / debugging.
                                if not pid.startswith("_") and pid not in input_data:
                                    input_data[pid] = _clone_default(dv)
                                continue
                            out[pid] = None
                        return out
                    # Backward-compat: older/test-created flows may omit pin metadata.
                    # In that case, expose non-internal keys only (avoid `_temp`, `_limits`, ...).
                    out2 = {k: v for k, v in input_data.items() if isinstance(k, str) and not k.startswith("_")}
                    # If pinDefaults exist, apply them for missing non-internal keys.
                    for k, dv in defaults.items():
                        if not isinstance(k, str) or not k or k.startswith("_"):
                            continue
                        if k in out2 or k in input_data:
                            continue
                        out2[k] = _clone_default(dv)
                        input_data[k] = _clone_default(dv)
                    return out2

                # Non-dict input: if there is a single declared pin, map into it; otherwise
                # keep a generic `input` key.
                if start_pin_ids and len(start_pin_ids) == 1:
                    return {start_pin_ids[0]: input_data}
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

    def _create_for_handler(data: Dict[str, Any]):
        def handler(input_data):
            payload = input_data if isinstance(input_data, dict) else {}
            start = payload.get("start")
            end = payload.get("end")
            step = payload.get("step")
            return {"start": start, "end": end, "step": step}

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

    def _coerce_bool(value: Any) -> bool:
        """Best-effort boolean parsing (handles common string forms)."""
        if value is None:
            return False
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            try:
                return float(value) != 0.0
            except Exception:
                return False
        if isinstance(value, str):
            s = value.strip().lower()
            if not s:
                return False
            if s in {"false", "0", "no", "off"}:
                return False
            if s in {"true", "1", "yes", "on"}:
                return True
        return False

    def _create_effect_handler(effect_type: str, data: Dict[str, Any]):
        effect_config = data.get("effectConfig", {})

        if effect_type == "ask_user":
            return _create_ask_user_handler(data, effect_config)
        if effect_type == "answer_user":
            return _create_answer_user_handler(data, effect_config)
        if effect_type == "llm_call":
            return _create_llm_call_handler(data, effect_config)
        if effect_type == "tool_calls":
            return _create_tool_calls_handler(data, effect_config)
        if effect_type == "wait_until":
            return _create_wait_until_handler(data, effect_config)
        if effect_type == "wait_event":
            return _create_wait_event_handler(data, effect_config)
        if effect_type == "memory_note":
            return _create_memory_note_handler(data, effect_config)
        if effect_type == "memory_query":
            return _create_memory_query_handler(data, effect_config)
        if effect_type == "memory_rehydrate":
            return _create_memory_rehydrate_handler(data, effect_config)

        return lambda x: x

    def _create_tool_calls_handler(data: Dict[str, Any], config: Dict[str, Any]):
        import json

        allowed_default = None
        if isinstance(config, dict):
            raw = config.get("allowed_tools")
            if raw is None:
                raw = config.get("allowedTools")
            allowed_default = raw

        def _normalize_str_list(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for x in raw:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        def _normalize_tool_calls(raw: Any) -> list[Dict[str, Any]]:
            if raw is None:
                return []
            if isinstance(raw, dict):
                return [dict(raw)]
            if isinstance(raw, list):
                out: list[Dict[str, Any]] = []
                for x in raw:
                    if isinstance(x, dict):
                        out.append(dict(x))
                return out
            if isinstance(raw, str) and raw.strip():
                # Best-effort: tolerate JSON strings coming from parse_json/text nodes.
                try:
                    parsed = json.loads(raw)
                except Exception:
                    return []
                return _normalize_tool_calls(parsed)
            return []

        def handler(input_data: Any):
            payload = input_data if isinstance(input_data, dict) else {}

            tool_calls_raw = payload.get("tool_calls")
            tool_calls = _normalize_tool_calls(tool_calls_raw)

            allow_specified = "allowed_tools" in payload or "allowedTools" in payload
            allowed_raw = payload.get("allowed_tools")
            if allowed_raw is None:
                allowed_raw = payload.get("allowedTools")
            allowed_tools = _normalize_str_list(allowed_raw) if allow_specified else []
            if not allow_specified:
                allowed_tools = _normalize_str_list(allowed_default)

            pending: Dict[str, Any] = {"type": "tool_calls", "tool_calls": tool_calls}
            # Only include allowlist when explicitly provided (empty list means "allow none").
            if allow_specified or isinstance(allowed_default, list):
                pending["allowed_tools"] = allowed_tools

            return {
                "results": None,
                "success": None,
                "_pending_effect": pending,
            }

        return handler

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
        tools_default_raw = config.get("tools")
        include_context_cfg = config.get("include_context")
        if include_context_cfg is None:
            include_context_cfg = config.get("use_context")
        include_context_default = _coerce_bool(include_context_cfg) if include_context_cfg is not None else False

        # Tool definitions (ToolSpecs) are required for tool calling. In the visual editor we
        # store tools as a portable `string[]` allowlist; at execution time we translate to
        # strict ToolSpecs `{name, description, parameters}` expected by AbstractCore.
        def _strip_tool_spec(raw: Any) -> Optional[Dict[str, Any]]:
            if not isinstance(raw, dict):
                return None
            name = raw.get("name")
            if not isinstance(name, str) or not name.strip():
                return None
            desc = raw.get("description")
            params = raw.get("parameters")
            out: Dict[str, Any] = {
                "name": name.strip(),
                "description": str(desc or ""),
                "parameters": dict(params) if isinstance(params, dict) else {},
            }
            return out

        def _normalize_tool_names(raw: Any) -> list[str]:
            if not isinstance(raw, list):
                return []
            out: list[str] = []
            for t in raw:
                if isinstance(t, str) and t.strip():
                    out.append(t.strip())
            return out

        # Precompute a best-effort "available ToolSpecs by name" map so we can turn tool names
        # into ToolSpecs without going through the web backend.
        tool_specs_by_name: Dict[str, Dict[str, Any]] = {}
        try:
            from abstractruntime.integrations.abstractcore.default_tools import list_default_tool_specs

            base_specs = list_default_tool_specs()
            if not isinstance(base_specs, list):
                base_specs = []
            for s in base_specs:
                stripped = _strip_tool_spec(s)
                if stripped is not None:
                    tool_specs_by_name[stripped["name"]] = stripped
        except Exception:
            pass

        # Optional schema-only runtime tools (used by AbstractAgent). These are useful for
        # "state machine" autonomy where the graph can route tool-like requests to effect nodes.
        try:
            from abstractagent.logic.builtins import (  # type: ignore
                ASK_USER_TOOL,
                COMPACT_MEMORY_TOOL,
                INSPECT_VARS_TOOL,
                RECALL_MEMORY_TOOL,
                REMEMBER_TOOL,
            )

            builtin_defs = [ASK_USER_TOOL, RECALL_MEMORY_TOOL, INSPECT_VARS_TOOL, REMEMBER_TOOL, COMPACT_MEMORY_TOOL]
            for tool_def in builtin_defs:
                try:
                    d = tool_def.to_dict()
                except Exception:
                    d = None
                stripped = _strip_tool_spec(d)
                if stripped is not None and stripped["name"] not in tool_specs_by_name:
                    tool_specs_by_name[stripped["name"]] = stripped
        except Exception:
            pass

        def _normalize_tools(raw: Any) -> list[Dict[str, Any]]:
            # Already ToolSpecs (from pins): accept and strip UI-only fields.
            if isinstance(raw, list) and raw and all(isinstance(x, dict) for x in raw):
                out: list[Dict[str, Any]] = []
                for x in raw:
                    stripped = _strip_tool_spec(x)
                    if stripped is not None:
                        out.append(stripped)
                return out

            # Tool names (portable representation): resolve against known tool specs.
            names = _normalize_tool_names(raw)
            out: list[Dict[str, Any]] = []
            for name in names:
                spec = tool_specs_by_name.get(name)
                if spec is not None:
                    out.append(spec)
            return out

        def _normalize_response_schema(raw: Any) -> Optional[Dict[str, Any]]:
            """Normalize a structured-output schema input into a JSON Schema dict.

            Supported inputs (best-effort):
            - JSON Schema dict: {"type":"object","properties":{...}, ...}
            - LMStudio/OpenAI-style wrapper: {"type":"json_schema","json_schema": {"schema": {...}}}
            """
            if raw is None:
                return None
            if isinstance(raw, dict):
                # Wrapper form (OpenAI "response_format": {type:"json_schema", json_schema:{schema:{...}}})
                if raw.get("type") == "json_schema" and isinstance(raw.get("json_schema"), dict):
                    inner = raw.get("json_schema")
                    if isinstance(inner, dict) and isinstance(inner.get("schema"), dict):
                        return dict(inner.get("schema") or {})
                # Plain JSON Schema dict
                return dict(raw)
            return None

        def handler(input_data):
            prompt = input_data.get("prompt", "") if isinstance(input_data, dict) else str(input_data)
            system = input_data.get("system", "") if isinstance(input_data, dict) else ""

            tools_specified = isinstance(input_data, dict) and "tools" in input_data
            tools_raw = input_data.get("tools") if isinstance(input_data, dict) else None
            tools = _normalize_tools(tools_raw) if tools_specified else []
            if not tools_specified:
                tools = _normalize_tools(tools_default_raw)

            include_context_specified = isinstance(input_data, dict) and (
                "include_context" in input_data or "use_context" in input_data
            )
            if include_context_specified:
                raw_inc = (
                    input_data.get("include_context")
                    if isinstance(input_data, dict) and "include_context" in input_data
                    else input_data.get("use_context") if isinstance(input_data, dict) else None
                )
                include_context_value = _coerce_bool(raw_inc)
            else:
                include_context_value = include_context_default

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
                        "tools": tools,
                        "params": {"temperature": temperature},
                        "include_context": include_context_value,
                    },
                    "error": "Missing provider or model configuration",
                }

            response_schema = (
                _normalize_response_schema(input_data.get("response_schema"))
                if isinstance(input_data, dict) and "response_schema" in input_data
                else None
            )

            pending: Dict[str, Any] = {
                "type": "llm_call",
                "prompt": prompt,
                "system_prompt": system,
                "tools": tools,
                "params": {"temperature": temperature},
                "provider": provider,
                "model": model,
                "include_context": include_context_value,
            }
            if isinstance(response_schema, dict) and response_schema:
                pending["response_schema"] = response_schema
                # Name is optional; AbstractRuntime will fall back to a safe default.
                pending["response_schema_name"] = "LLM_StructuredOutput"

            return {
                "response": None,
                "_pending_effect": pending,
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
            # `wait_event` is a durable pause that waits for an external signal.
            #
            # Input shape (best-effort):
            # - event_key: str (required; defaults to "default" for backward-compat)
            # - prompt: str (optional; enables human-in-the-loop UX for EVENT waits)
            # - choices: list[str] (optional)
            # - allow_free_text: bool (optional; default True)
            #
            # NOTE: The compiler will wrap `_pending_effect` into an AbstractRuntime Effect payload.
            event_key = input_data.get("event_key", "default") if isinstance(input_data, dict) else str(input_data)
            prompt = None
            choices = None
            allow_free_text = True
            if isinstance(input_data, dict):
                p = input_data.get("prompt")
                if isinstance(p, str) and p.strip():
                    prompt = p
                ch = input_data.get("choices")
                if isinstance(ch, list):
                    # Keep choices JSON-safe and predictable.
                    choices = [str(c) for c in ch if isinstance(c, str) and str(c).strip()]
                aft = input_data.get("allow_free_text")
                if aft is None:
                    aft = input_data.get("allowFreeText")
                if aft is not None:
                    allow_free_text = bool(aft)
 
            pending: Dict[str, Any] = {"type": "wait_event", "wait_key": event_key}
            if prompt is not None:
                pending["prompt"] = prompt
            if isinstance(choices, list):
                pending["choices"] = choices
            # Always include allow_free_text so hosts can render consistent UX.
            pending["allow_free_text"] = allow_free_text
            return {
                "event_data": {},
                "event_key": event_key,
                "_pending_effect": pending,
            }

        return handler

    def _create_memory_note_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            content = input_data.get("content", "") if isinstance(input_data, dict) else str(input_data)
            tags = input_data.get("tags") if isinstance(input_data, dict) else None
            sources = input_data.get("sources") if isinstance(input_data, dict) else None
            location = input_data.get("location") if isinstance(input_data, dict) else None
            scope = input_data.get("scope") if isinstance(input_data, dict) else None

            pending: Dict[str, Any] = {"type": "memory_note", "note": content, "tags": tags if isinstance(tags, dict) else {}}
            if isinstance(sources, dict):
                pending["sources"] = sources
            if isinstance(location, str) and location.strip():
                pending["location"] = location.strip()
            if isinstance(scope, str) and scope.strip():
                pending["scope"] = scope.strip()

            keep_in_context_specified = isinstance(input_data, dict) and (
                "keep_in_context" in input_data or "keepInContext" in input_data
            )
            if keep_in_context_specified:
                raw_keep = (
                    input_data.get("keep_in_context")
                    if isinstance(input_data, dict) and "keep_in_context" in input_data
                    else input_data.get("keepInContext") if isinstance(input_data, dict) else None
                )
                keep_in_context = _coerce_bool(raw_keep)
            else:
                # Visual-editor config (checkbox) default.
                keep_cfg = None
                if isinstance(config, dict):
                    keep_cfg = config.get("keep_in_context")
                    if keep_cfg is None:
                        keep_cfg = config.get("keepInContext")
                keep_in_context = _coerce_bool(keep_cfg)
            if keep_in_context:
                pending["keep_in_context"] = True

            return {"note_id": None, "_pending_effect": pending}

        return handler

    def _create_memory_query_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            query = input_data.get("query", "") if isinstance(input_data, dict) else str(input_data)
            limit = input_data.get("limit", 10) if isinstance(input_data, dict) else 10
            tags = input_data.get("tags") if isinstance(input_data, dict) else None
            tags_mode = input_data.get("tags_mode") if isinstance(input_data, dict) else None
            usernames = input_data.get("usernames") if isinstance(input_data, dict) else None
            locations = input_data.get("locations") if isinstance(input_data, dict) else None
            since = input_data.get("since") if isinstance(input_data, dict) else None
            until = input_data.get("until") if isinstance(input_data, dict) else None
            scope = input_data.get("scope") if isinstance(input_data, dict) else None
            try:
                limit_int = int(limit) if limit is not None else 10
            except Exception:
                limit_int = 10

            pending: Dict[str, Any] = {"type": "memory_query", "query": query, "limit_spans": limit_int, "return": "both"}
            if isinstance(tags, dict):
                pending["tags"] = tags
            if isinstance(tags_mode, str) and tags_mode.strip():
                pending["tags_mode"] = tags_mode.strip()
            if isinstance(usernames, list):
                pending["usernames"] = [str(x).strip() for x in usernames if isinstance(x, str) and str(x).strip()]
            if isinstance(locations, list):
                pending["locations"] = [str(x).strip() for x in locations if isinstance(x, str) and str(x).strip()]
            if since is not None:
                pending["since"] = since
            if until is not None:
                pending["until"] = until
            if isinstance(scope, str) and scope.strip():
                pending["scope"] = scope.strip()

            return {"results": [], "rendered": "", "_pending_effect": pending}

        return handler

    def _create_memory_rehydrate_handler(data: Dict[str, Any], config: Dict[str, Any]):
        def handler(input_data):
            raw = input_data.get("span_ids") if isinstance(input_data, dict) else None
            if raw is None and isinstance(input_data, dict):
                raw = input_data.get("span_id")
            span_ids: list[Any] = []
            if isinstance(raw, list):
                span_ids = list(raw)
            elif raw is not None:
                span_ids = [raw]

            placement = input_data.get("placement") if isinstance(input_data, dict) else None
            placement_str = str(placement).strip() if isinstance(placement, str) else "after_summary"
            if placement_str not in {"after_summary", "after_system", "end"}:
                placement_str = "after_summary"

            max_messages = input_data.get("max_messages") if isinstance(input_data, dict) else None

            pending: Dict[str, Any] = {"type": "memory_rehydrate", "span_ids": span_ids, "placement": placement_str}
            if max_messages is not None:
                pending["max_messages"] = max_messages
            return {"inserted": 0, "skipped": 0, "_pending_effect": pending}

        return handler

    def _create_handler(node_type: NodeType, data: Dict[str, Any]) -> Any:
        type_str = node_type.value if isinstance(node_type, NodeType) else str(node_type)

        if type_str == "get_var":
            return _create_get_var_handler(data)

        if type_str == "bool_var":
            return _create_bool_var_handler(data)

        if type_str == "var_decl":
            return _create_var_decl_handler(data)

        if type_str == "set_var":
            return _create_set_var_handler(data)

        if type_str == "concat":
            return _create_concat_handler(data)

        if type_str == "make_array":
            return _create_make_array_handler(data)

        if type_str == "array_concat":
            return _create_array_concat_handler(data)

        if type_str == "read_file":
            return _create_read_file_handler(data)

        if type_str == "write_file":
            return _create_write_file_handler(data)

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

        if type_str in ("on_flow_start", "on_user_request", "on_agent_message"):
            return _create_event_handler(type_str, data)

        if type_str == "if":
            return _create_if_handler(data)
        if type_str == "switch":
            return _create_switch_handler(data)
        if type_str == "while":
            return _create_while_handler(data)
        if type_str == "for":
            return _create_for_handler(data)
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
            pure_node_ids.add(node.id)
            if type_str in {"get_var", "bool_var", "var_decl"}:
                volatile_pure_node_ids.add(node.id)
            continue

        # Ignore disconnected/unreachable execution nodes.
        if reachable_exec and node.id not in reachable_exec:
            continue

        wrapped_handler = _create_data_aware_handler(
            node_id=node.id,
            base_handler=base_handler,
            data_edges=data_edge_map.get(node.id, {}),
            pin_defaults=pin_defaults_by_node_id.get(node.id),
            node_outputs=flow._node_outputs,  # type: ignore[attr-defined]
            ensure_node_output=_ensure_node_output,
            volatile_node_ids=volatile_pure_node_ids,
        )

        input_key = node.data.get("inputKey")
        output_key = node.data.get("outputKey")

        effect_type: Optional[str] = None
        effect_config: Optional[Dict[str, Any]] = None
        if type_str in EFFECT_NODE_TYPES:
            effect_type = type_str
            effect_config = node.data.get("effectConfig", {})
        elif type_str == "on_schedule":
            # Schedule trigger: compiles into WAIT_UNTIL under the hood.
            effect_type = "on_schedule"
            effect_config = node.data.get("eventConfig", {})
        elif type_str == "on_event":
            # Custom event listener (Blueprint-style "Custom Event").
            # Compiles into WAIT_EVENT under the hood.
            effect_type = "on_event"
            effect_config = node.data.get("eventConfig", {})
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
        elif type_str == "for":
            # Control-flow scheduler node (Blueprint-style numeric for).
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

    # Pure (no-exec) nodes are cached in `flow._node_outputs` for data-edge resolution.
    # Some schedulers (While, On Event, On Schedule) must invalidate these caches between iterations.
    flow._pure_node_ids = pure_node_ids  # type: ignore[attr-defined]

    return flow


def _create_data_aware_handler(
    node_id: str,
    base_handler,
    data_edges: Dict[str, tuple[str, str]],
    pin_defaults: Optional[Dict[str, Any]],
    node_outputs: Dict[str, Dict[str, Any]],
    *,
    ensure_node_output=None,
    volatile_node_ids: Optional[set[str]] = None,
):
    """Wrap a handler to resolve data edge inputs before execution."""

    volatile: set[str] = volatile_node_ids if isinstance(volatile_node_ids, set) else set()

    def wrapped_handler(input_data):
        resolved_input: Dict[str, Any] = {}

        if isinstance(input_data, dict):
            resolved_input.update(input_data)

        for target_pin, (source_node, source_pin) in data_edges.items():
            if ensure_node_output is not None and (source_node not in node_outputs or source_node in volatile):
                ensure_node_output(source_node)
            if source_node in node_outputs:
                source_output = node_outputs[source_node]
                if isinstance(source_output, dict) and source_pin in source_output:
                    resolved_input[target_pin] = source_output[source_pin]
                elif source_pin in ("result", "output"):
                    resolved_input[target_pin] = source_output

        if pin_defaults:
            for pin_id, value in pin_defaults.items():
                # Connected pins always win (even if the upstream value is None).
                if pin_id in data_edges:
                    continue
                if pin_id not in resolved_input:
                    # Clone object/array defaults so handlers can't mutate the shared default.
                    if isinstance(value, (dict, list)):
                        try:
                            import copy

                            resolved_input[pin_id] = copy.deepcopy(value)
                        except Exception:
                            resolved_input[pin_id] = value
                    else:
                        resolved_input[pin_id] = value

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
