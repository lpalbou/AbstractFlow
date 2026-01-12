"""Portable visual-flow execution utilities.

This module wires the VisualFlow authoring DSL (JSON) to AbstractRuntime for
durable execution. Compilation semantics (VisualFlow → Flow → WorkflowSpec) are
delegated to `abstractruntime.visualflow_compiler` so there is a single
semantics engine across the framework.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, cast

from ..core.flow import Flow
from ..runner import FlowRunner

from .agent_ids import visual_react_workflow_id
from .models import VisualFlow


def create_visual_runner(
    visual_flow: VisualFlow,
    *,
    flows: Dict[str, VisualFlow],
    run_store: Optional[Any] = None,
    ledger_store: Optional[Any] = None,
    artifact_store: Optional[Any] = None,
    tool_executor: Optional[Any] = None,
    input_data: Optional[Dict[str, Any]] = None,
) -> FlowRunner:
    """Create a FlowRunner for a visual run with a correctly wired runtime.

    Responsibilities:
    - Build a WorkflowRegistry containing the root flow and any referenced subflows.
    - Create a runtime with an ArtifactStore (required for MEMORY_* effects).
    - If any LLM_CALL / Agent nodes exist in the flow tree, wire AbstractCore-backed
      effect handlers (via AbstractRuntime's integration module).

    Notes:
    - When LLM nodes rely on *connected* provider/model pins (e.g. from ON_FLOW_START),
      this runner still needs a default provider/model to initialize runtime capabilities.
      We use `input_data["provider"]`/`input_data["model"]` when provided, otherwise fall
      back to static pin defaults (best-effort).
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
            "memory_tag",
            "memory_compact",
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
            if t in {"memory_note", "memory_query", "memory_rehydrate", "memory_compact"}:
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

    def _infer_connected_pin_default(vf: VisualFlow, *, node_id: str, pin_id: str) -> Optional[str]:
        """Best-effort static inference for a connected pin's default value.

        This is used only to pick a reasonable *default* provider/model for the runtime
        (capabilities, limits, etc). Per-node/provider routing still happens at execution
        time via effect payloads.
        """
        try:
            for e in vf.edges:
                if e.target != node_id or e.targetHandle != pin_id:
                    continue
                source_id = getattr(e, "source", None)
                if not isinstance(source_id, str) or not source_id:
                    continue
                source_handle = getattr(e, "sourceHandle", None)
                if not isinstance(source_handle, str) or not source_handle:
                    source_handle = pin_id

                src = next((n for n in vf.nodes if getattr(n, "id", None) == source_id), None)
                if src is None:
                    return None
                data = getattr(src, "data", None)
                if not isinstance(data, dict):
                    return None

                pin_defaults = data.get("pinDefaults")
                if isinstance(pin_defaults, dict) and source_handle in pin_defaults:
                    v = pin_defaults.get(source_handle)
                    if isinstance(v, str) and v.strip():
                        return v.strip()

                literal_value = data.get("literalValue")
                if isinstance(literal_value, str) and literal_value.strip():
                    return literal_value.strip()
                if isinstance(literal_value, dict):
                    dv = literal_value.get("default")
                    if isinstance(dv, str) and dv.strip():
                        return dv.strip()
                    vv = literal_value.get(source_handle)
                    if isinstance(vv, str) and vv.strip():
                        return vv.strip()
                return None
        except Exception:
            return None

        return None

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

    # Prefer run inputs for the runtime default provider/model when available.
    # This avoids expensive provider probing and makes model capability detection match
    # what the user selected in the Run Flow modal.
    if isinstance(input_data, dict):
        _add_pair(input_data.get("provider"), input_data.get("model"))

    for vf in ordered:
        reachable = _reachable_exec_node_ids(vf)
        for n in vf.nodes:
            node_type = _node_type(n)
            if reachable and n.id not in reachable:
                continue
            if node_type in {"llm_call", "agent", "tool_calls", "memory_compact"}:
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
                provider_default = (
                    provider
                    if provider_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="provider")
                    if provider_connected
                    else None
                )
                model_default = (
                    model
                    if model_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="model")
                    if model_connected
                    else None
                )
                _add_pair(provider_default, model_default)

            elif node_type == "memory_compact":
                cfg = n.data.get("effectConfig", {}) if isinstance(n.data, dict) else {}
                cfg = cfg if isinstance(cfg, dict) else {}
                provider = cfg.get("provider")
                model = cfg.get("model")

                provider_ok = isinstance(provider, str) and provider.strip()
                model_ok = isinstance(model, str) and model.strip()
                provider_connected = _pin_connected(vf, node_id=n.id, pin_id="provider")
                model_connected = _pin_connected(vf, node_id=n.id, pin_id="model")

                provider_default = (
                    provider
                    if provider_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="provider")
                    if provider_connected
                    else None
                )
                model_default = (
                    model
                    if model_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="model")
                    if model_connected
                    else None
                )
                _add_pair(provider_default, model_default)

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
                provider_default = (
                    provider
                    if provider_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="provider")
                    if provider_connected
                    else None
                )
                model_default = (
                    model
                    if model_ok
                    else _infer_connected_pin_default(vf, node_id=n.id, pin_id="model")
                    if model_connected
                    else None
                )
                _add_pair(provider_default, model_default)

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

        # Strict behavior: do not probe unrelated providers/models to "guess" a default.
        #
        # A VisualFlow run must provide a deterministic provider+model for the runtime:
        # - via run inputs (e.g. ON_FLOW_START pinDefaults / user-provided input_data), OR
        # - via static node configs (effectConfig/agentConfig), OR
        # - via connected pin defaults (best-effort).
        #
        # If we can't determine that, fail loudly with a clear error message.
        if provider_model is None:
            raise RuntimeError(
                "This flow uses LLM nodes (llm_call/agent/memory_compact), but no default provider/model could be determined. "
                "Set provider+model on a node, or connect provider/model pins to a node with pinDefaults "
                "(e.g. ON_FLOW_START), or pass `input_data={'provider': ..., 'model': ...}` when creating the runner."
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


def visual_to_flow(visual: VisualFlow) -> Flow:
    """Convert a VisualFlow definition to a runtime Flow IR."""
    from abstractruntime.visualflow_compiler import load_visualflow_json as _load_visualflow_json
    from abstractruntime.visualflow_compiler import visual_to_flow as _runtime_visual_to_flow

    vf = _load_visualflow_json(visual)
    return cast(Flow, _runtime_visual_to_flow(vf))


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
