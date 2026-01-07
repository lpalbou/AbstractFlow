"""Flow compiler - converts Flow definitions to AbstractRuntime WorkflowSpec."""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TYPE_CHECKING

from .core.flow import Flow
from .adapters.function_adapter import create_function_node_handler
from .adapters.agent_adapter import create_agent_node_handler
from .adapters.subflow_adapter import create_subflow_node_handler
from .adapters.effect_adapter import (
    create_ask_user_handler,
    create_answer_user_handler,
    create_wait_until_handler,
    create_wait_event_handler,
    create_memory_note_handler,
    create_memory_query_handler,
    create_memory_rehydrate_handler,
    create_llm_call_handler,
    create_tool_calls_handler,
    create_start_subworkflow_handler,
)

if TYPE_CHECKING:
    from abstractruntime.core.models import StepPlan
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
    *,
    flow: Optional[Flow] = None,
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
    elif effect_type == "answer_user":
        base_handler = create_answer_user_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
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
    elif effect_type == "memory_rehydrate":
        base_handler = create_memory_rehydrate_handler(
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
    elif effect_type == "tool_calls":
        base_handler = create_tool_calls_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            allowed_tools=effect_config.get("allowed_tools") if isinstance(effect_config, dict) else None,
        )
    elif effect_type == "start_subworkflow":
        base_handler = create_start_subworkflow_handler(
            node_id=node_id,
            next_node=next_node,
            input_key=input_key,
            output_key=output_key,
            workflow_id=effect_config.get("workflow_id"),
        )
    else:
        raise ValueError(f"Unknown effect type: {effect_type}")

    # If no data-aware handler, just return the base effect handler
    if data_aware_handler is None:
        return base_handler

    # Wrap to resolve data edges before creating the effect
    def wrapped_effect_handler(run: Any, ctx: Any) -> "StepPlan":
        """Resolve data edges via executor handler, then create the proper Effect."""
        if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
            _sync_effect_results_to_node_outputs(run, flow)

        # Call the data-aware handler to resolve data edge inputs
        # This reads from flow._node_outputs which has literal values
        last_output = run.vars.get("_last_output", {})
        resolved = data_aware_handler(last_output)

        # Check if this returned a _pending_effect marker (from executor's effect handlers)
        if isinstance(resolved, dict) and "_pending_effect" in resolved:
            pending = resolved["_pending_effect"]
            effect_type_str = pending.get("type", "")

            # Get the EffectType enum value by name (avoid building dict with all members)
            eff_type = None
            try:
                eff_type = EffectType(effect_type_str)
            except ValueError:
                pass  # Unknown effect type
            if eff_type:
                # Visual LLM Call UX: include the run's active context messages when possible.
                #
                # Why here (compiler) and not in AbstractRuntime:
                # - LLM_CALL is a generic runtime effect; not all callers want implicit context.
                # - Visual LLM Call nodes expect "Recall into context" to affect subsequent calls.
                if (
                    eff_type == EffectType.LLM_CALL
                    and isinstance(pending, dict)
                    and "messages" not in pending
                    and pending.get("include_context") is True
                ):
                    try:
                        from abstractruntime.memory.active_context import ActiveContextPolicy

                        base = ActiveContextPolicy.select_active_messages_for_llm_from_run(run)
                        messages = [dict(m) for m in base if isinstance(m, dict)]

                        sys_raw = pending.get("system_prompt") or pending.get("system")
                        sys_text = str(sys_raw).strip() if isinstance(sys_raw, str) else ""
                        if sys_text:
                            # Insert after existing system messages (system must precede user/assistant).
                            insert_at = 0
                            while insert_at < len(messages):
                                m = messages[insert_at]
                                if not isinstance(m, dict) or m.get("role") != "system":
                                    break
                                insert_at += 1
                            messages.insert(insert_at, {"role": "system", "content": sys_text})

                        prompt_raw = pending.get("prompt")
                        prompt_text = prompt_raw if isinstance(prompt_raw, str) else str(prompt_raw or "")
                        messages.append({"role": "user", "content": prompt_text})

                        pending["messages"] = messages
                        # Avoid double-including prompt/system_prompt if the LLM client also
                        # builds messages from them.
                        pending.pop("prompt", None)
                        pending.pop("system_prompt", None)
                        pending.pop("system", None)
                    except Exception:
                        pass

                # Visual Subflow UX: optionally seed the child run's `context.messages` from the
                # parent run's active context view (so LLM/Agent nodes inside the subflow can
                # "Use context" without extra wiring).
                if (
                    eff_type == EffectType.START_SUBWORKFLOW
                    and isinstance(pending, dict)
                    and pending.get("inherit_context") is True
                ):
                    try:
                        from abstractruntime.memory.active_context import ActiveContextPolicy

                        inherited = ActiveContextPolicy.select_active_messages_for_llm_from_run(run)
                        inherited_msgs = [dict(m) for m in inherited if isinstance(m, dict)]
                        if inherited_msgs:
                            sub_vars = pending.get("vars")
                            if not isinstance(sub_vars, dict):
                                sub_vars = {}
                            sub_ctx = sub_vars.get("context")
                            if not isinstance(sub_ctx, dict):
                                sub_ctx = {}
                                sub_vars["context"] = sub_ctx

                            # Explicit child context wins (do not override).
                            existing = sub_ctx.get("messages")
                            if not isinstance(existing, list) or not existing:
                                sub_ctx["messages"] = inherited_msgs

                            pending["vars"] = sub_vars
                    except Exception:
                        pass
                    # Keep payload clean (runtime ignores it, but it clutters traces).
                    pending.pop("inherit_context", None)

                # Build the Effect with resolved values from data edges
                effect = Effect(
                    type=eff_type,
                    payload={
                        **pending,
                        "resume_to_node": next_node,
                    },
                    # Always store effect outcomes per-node; visual syncing can optionally copy to output_key.
                    result_key=f"_temp.effects.{node_id}",
                )

                return StepPlan(
                    node_id=node_id,
                    effect=effect,
                    next_node=next_node,
                )

        # Fallback: run.vars won't have the values, but try anyway
        return base_handler(run, ctx)

    return wrapped_effect_handler


def _create_visual_agent_effect_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    agent_config: Dict[str, Any],
    data_aware_handler: Optional[Callable[[Any], Any]],
    flow: Flow,
) -> Callable:
    """Create a handler for the visual Agent node.

    Visual Agent nodes delegate to AbstractAgent's canonical ReAct workflow
    via `START_SUBWORKFLOW` (runtime-owned execution and persistence).

    This handler:
    - resolves `task` / `context` via data edges
    - starts the configured ReAct subworkflow (sync; may wait)
    - exposes the final agent result and trace ("scratchpad") via output pins
    - optionally performs a final structured-output LLM_CALL (format-only pass)
    """
    import json

    from abstractruntime.core.models import Effect, EffectType, StepPlan

    from .visual.agent_ids import visual_react_workflow_id

    def _ensure_temp_dict(run: Any) -> Dict[str, Any]:
        temp = run.vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run.vars["_temp"] = temp
        return temp

    def _get_agent_bucket(run: Any) -> Dict[str, Any]:
        temp = _ensure_temp_dict(run)
        agent = temp.get("agent")
        if not isinstance(agent, dict):
            agent = {}
            temp["agent"] = agent
        bucket = agent.get(node_id)
        if not isinstance(bucket, dict):
            bucket = {}
            agent[node_id] = bucket
        return bucket

    def _resolve_inputs(run: Any) -> Dict[str, Any]:
        if hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
            _sync_effect_results_to_node_outputs(run, flow)

        if not callable(data_aware_handler):
            return {}
        last_output = run.vars.get("_last_output", {})
        try:
            resolved = data_aware_handler(last_output)
        except Exception:
            resolved = {}
        return resolved if isinstance(resolved, dict) else {}

    def _flatten_node_traces(node_traces: Any) -> list[Dict[str, Any]]:
        if not isinstance(node_traces, dict):
            return []
        out: list[Dict[str, Any]] = []
        for trace in node_traces.values():
            if not isinstance(trace, dict):
                continue
            steps = trace.get("steps")
            if not isinstance(steps, list):
                continue
            for s in steps:
                if isinstance(s, dict):
                    out.append(dict(s))
        out.sort(key=lambda s: str(s.get("ts") or ""))
        return out

    def _as_dict_list(value: Any) -> list[Dict[str, Any]]:
        if value is None:
            return []
        if isinstance(value, dict):
            return [dict(value)]
        if isinstance(value, list):
            out: list[Dict[str, Any]] = []
            for x in value:
                if isinstance(x, dict):
                    out.append(dict(x))
            return out
        return []

    def _extract_tool_activity_from_steps(steps: Any) -> tuple[list[Dict[str, Any]], list[Dict[str, Any]]]:
        """Best-effort tool call/result extraction from flattened scratchpad steps."""
        if not isinstance(steps, list):
            return [], []
        tool_calls: list[Dict[str, Any]] = []
        tool_results: list[Dict[str, Any]] = []
        for entry_any in steps:
            entry = entry_any if isinstance(entry_any, dict) else None
            if entry is None:
                continue
            effect = entry.get("effect")
            if not isinstance(effect, dict) or str(effect.get("type") or "") != "tool_calls":
                continue
            payload = effect.get("payload")
            payload_d = payload if isinstance(payload, dict) else {}
            tool_calls.extend(_as_dict_list(payload_d.get("tool_calls")))

            result = entry.get("result")
            if not isinstance(result, dict):
                continue
            tool_results.extend(_as_dict_list(result.get("results")))
        return tool_calls, tool_results

    def _build_sub_vars(
        run: Any,
        *,
        task: str,
        context: Dict[str, Any],
        provider: str,
        model: str,
        system_prompt: str,
        allowed_tools: list[str],
        include_context: bool = False,
        max_iterations: Optional[int] = None,
    ) -> Dict[str, Any]:
        parent_limits = run.vars.get("_limits")
        limits = dict(parent_limits) if isinstance(parent_limits, dict) else {}
        limits.setdefault("max_iterations", 25)
        limits.setdefault("current_iteration", 0)
        limits.setdefault("max_tokens", 32768)
        limits.setdefault("max_output_tokens", None)
        limits.setdefault("max_history_messages", -1)
        limits.setdefault("estimated_tokens_used", 0)
        limits.setdefault("warn_iterations_pct", 80)
        limits.setdefault("warn_tokens_pct", 80)

        if isinstance(max_iterations, int) and max_iterations > 0:
            limits["max_iterations"] = int(max_iterations)

        ctx_ns: Dict[str, Any] = {"task": str(task or ""), "messages": []}

        # Optional: inherit the parent's active context as agent history (including Recall into context inserts).
        # This is a visual-editor UX feature; it is disabled by default and can be enabled via
        # agentConfig.include_context or the include_context input pin.
        if bool(include_context):
            try:
                from abstractruntime.memory.active_context import ActiveContextPolicy

                base = ActiveContextPolicy.select_active_messages_for_llm_from_run(run)
                if isinstance(base, list):
                    ctx_ns["messages"] = [dict(m) for m in base if isinstance(m, dict)]
            except Exception:
                pass

        # Explicit context.messages from a pin overrides the inherited run context.
        raw_msgs = context.get("messages") if isinstance(context, dict) else None
        if isinstance(raw_msgs, list):
            msgs = [dict(m) for m in raw_msgs if isinstance(m, dict)]
            if msgs:
                ctx_ns["messages"] = msgs

        if isinstance(context, dict) and context:
            for k, v in context.items():
                if k in ("task", "messages"):
                    continue
                ctx_ns[str(k)] = v

        runtime_ns: Dict[str, Any] = {"inbox": [], "provider": provider, "model": model, "allowed_tools": list(allowed_tools)}
        if isinstance(system_prompt, str) and system_prompt.strip():
            runtime_ns["system_prompt"] = system_prompt

        return {
            "context": ctx_ns,
            "scratchpad": {"iteration": 0, "max_iterations": int(limits.get("max_iterations") or 25)},
            # `_runtime` is durable; we store provider/model here so the ReAct subworkflow
            # can inject them into LLM_CALL payloads (and remain resumable).
            "_runtime": runtime_ns,
            "_temp": {},
            "_limits": limits,
        }

    def _coerce_max_iterations(value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            if isinstance(value, bool):
                return None
            if isinstance(value, (int, float)):
                iv = int(float(value))
                return iv if iv > 0 else None
            if isinstance(value, str) and value.strip():
                iv = int(float(value.strip()))
                return iv if iv > 0 else None
        except Exception:
            return None
        return None

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx

        output_schema_cfg = agent_config.get("outputSchema") if isinstance(agent_config.get("outputSchema"), dict) else {}
        schema_enabled = bool(output_schema_cfg.get("enabled"))
        schema = output_schema_cfg.get("jsonSchema") if isinstance(output_schema_cfg.get("jsonSchema"), dict) else None

        bucket = _get_agent_bucket(run)
        phase = str(bucket.get("phase") or "init")

        # IMPORTANT: This visual Agent node can be executed multiple times within a single run
        # (e.g. inside a Loop/While/Sequence). The per-node bucket is durable and would otherwise
        # keep `phase="done"` and `resolved_inputs` from the first invocation, causing subsequent
        # invocations to skip work and reuse stale inputs/results.
        #
        # When we re-enter the node after it previously completed, reset the bucket to start a
        # fresh subworkflow invocation with the current upstream inputs.
        if phase == "done":
            try:
                bucket.clear()
            except Exception:
                # Best-effort; if clear fails, overwrite key fields below.
                pass
            phase = "init"
            bucket["phase"] = "init"

        resolved_inputs = bucket.get("resolved_inputs")
        if not isinstance(resolved_inputs, dict) or phase == "init":
            resolved_inputs = _resolve_inputs(run)
            bucket["resolved_inputs"] = resolved_inputs if isinstance(resolved_inputs, dict) else {}

        # Pin-driven structured output:
        # If `response_schema` is provided via an input pin (data edge), it overrides the node config
        # and enables the structured-output post-pass (durable LLM_CALL).
        pin_schema = resolved_inputs.get("response_schema") if isinstance(resolved_inputs, dict) else None
        if isinstance(pin_schema, dict) and pin_schema:
            schema = dict(pin_schema)
            schema_enabled = True

        # Provider/model can come from Agent node config or from data-edge inputs (pins).
        provider_raw = resolved_inputs.get("provider") if isinstance(resolved_inputs, dict) else None
        model_raw = resolved_inputs.get("model") if isinstance(resolved_inputs, dict) else None
        if not isinstance(provider_raw, str) or not provider_raw.strip():
            provider_raw = agent_config.get("provider")
        if not isinstance(model_raw, str) or not model_raw.strip():
            model_raw = agent_config.get("model")

        provider = str(provider_raw or "").strip().lower() if isinstance(provider_raw, str) else ""
        model = str(model_raw or "").strip() if isinstance(model_raw, str) else ""

        task = str(resolved_inputs.get("task") or "")
        context_raw = resolved_inputs.get("context")
        context = context_raw if isinstance(context_raw, dict) else {}
        system_raw = resolved_inputs.get("system") if isinstance(resolved_inputs, dict) else None
        system_prompt = system_raw if isinstance(system_raw, str) else str(system_raw or "")

        # Include parent run context (as agent history):
        # - Pin override wins when connected (resolved_inputs contains include_context)
        # - Otherwise fall back to node config (checkbox)
        # - Default: false
        include_context: bool
        if isinstance(resolved_inputs, dict) and "include_context" in resolved_inputs:
            include_context = bool(resolved_inputs.get("include_context"))
        else:
            include_context_cfg = agent_config.get("include_context")
            include_context = bool(include_context_cfg) if include_context_cfg is not None else False

        # Agent loop budget (max_iterations) can come from a data-edge pin or from config.
        max_iterations_raw = resolved_inputs.get("max_iterations") if isinstance(resolved_inputs, dict) else None
        max_iterations_override = _coerce_max_iterations(max_iterations_raw)
        if max_iterations_override is None:
            max_iterations_override = _coerce_max_iterations(agent_config.get("max_iterations"))

        # Tools selection:
        # - If the resolved inputs explicitly include `tools` (e.g. tools pin connected),
        #   respect it even if it's an empty list (disables tools).
        # - Otherwise fall back to the Agent node's configuration.
        if isinstance(resolved_inputs, dict) and "tools" in resolved_inputs:
            tools_raw = resolved_inputs.get("tools")
        else:
            tools_raw = agent_config.get("tools")
        allowed_tools: list[str] = []
        if isinstance(tools_raw, list):
            for t in tools_raw:
                if isinstance(t, str) and t.strip():
                    allowed_tools.append(t.strip())
        elif isinstance(tools_raw, tuple):
            for t in tools_raw:
                if isinstance(t, str) and t.strip():
                    allowed_tools.append(t.strip())
        elif isinstance(tools_raw, str) and tools_raw.strip():
            allowed_tools.append(tools_raw.strip())

        # De-dup while preserving order.
        seen_tools: set[str] = set()
        allowed_tools = [t for t in allowed_tools if not (t in seen_tools or seen_tools.add(t))]

        workflow_id_raw = agent_config.get("_react_workflow_id")
        react_workflow_id = (
            workflow_id_raw.strip()
            if isinstance(workflow_id_raw, str) and workflow_id_raw.strip()
            else visual_react_workflow_id(flow_id=flow.flow_id, node_id=node_id)
        )

        if phase == "init":
            if not provider or not model:
                run.vars["_flow_error"] = "Agent node missing provider/model configuration"
                run.vars["_flow_error_node"] = node_id
                out = {
                    "result": "Agent configuration error: missing provider/model",
                    "task": task,
                    "context": context,
                    "success": False,
                    "error": "missing provider/model",
                    "provider": provider or "unknown",
                    "model": model or "unknown",
                }
                _set_nested(run.vars, f"_temp.effects.{node_id}", out)
                bucket["phase"] = "done"
                flow._node_outputs[node_id] = {
                    "result": out,
                    "scratchpad": {"node_id": node_id, "steps": []},
                    "tool_calls": [],
                    "tool_results": [],
                }
                run.vars["_last_output"] = {"result": out}
                if next_node:
                    return StepPlan(node_id=node_id, next_node=next_node)
                return StepPlan(node_id=node_id, complete_output={"result": out, "success": False})

            bucket["phase"] = "subworkflow"
            flow._node_outputs[node_id] = {"status": "running", "task": task, "context": context, "result": None}

            return StepPlan(
                node_id=node_id,
                effect=Effect(
                    type=EffectType.START_SUBWORKFLOW,
                    payload={
                        "workflow_id": react_workflow_id,
                        "vars": _build_sub_vars(
                            run,
                            task=task,
                            context=context,
                            provider=provider,
                            model=model,
                            system_prompt=system_prompt,
                            allowed_tools=allowed_tools,
                            include_context=include_context,
                            max_iterations=max_iterations_override,
                        ),
                        # Run Agent as a durable async subworkflow so the host can:
                        # - tick the child incrementally (real-time observability of each effect)
                        # - resume the parent once the child completes (async+wait mode)
                        "async": True,
                        "wait": True,
                        "include_traces": True,
                    },
                    result_key=f"_temp.agent.{node_id}.sub",
                ),
                next_node=node_id,
            )

        if phase == "subworkflow":
            sub = bucket.get("sub")
            if sub is None:
                temp = _ensure_temp_dict(run)
                agent_ns = temp.get("agent")
                if isinstance(agent_ns, dict):
                    node_bucket = agent_ns.get(node_id)
                    if isinstance(node_bucket, dict):
                        sub = node_bucket.get("sub")

            if not isinstance(sub, dict):
                return StepPlan(node_id=node_id, next_node=node_id)

            sub_run_id = sub.get("sub_run_id") if isinstance(sub.get("sub_run_id"), str) else None
            output = sub.get("output")
            output_dict = output if isinstance(output, dict) else {}
            answer = str(output_dict.get("answer") or "")
            iterations = output_dict.get("iterations")

            node_traces = sub.get("node_traces")
            scratchpad = {
                "sub_run_id": sub_run_id,
                "workflow_id": react_workflow_id,
                "node_traces": node_traces if isinstance(node_traces, dict) else {},
                "steps": _flatten_node_traces(node_traces),
            }
            bucket["scratchpad"] = scratchpad
            tc, tr = _extract_tool_activity_from_steps(scratchpad.get("steps"))

            result_obj = {
                "result": answer,
                "task": task,
                "context": context,
                "success": True,
                "provider": provider,
                "model": model,
                "iterations": iterations,
                "sub_run_id": sub_run_id,
            }

            if schema_enabled and schema:
                bucket["phase"] = "structured"
                messages = [
                    {
                        "role": "user",
                        "content": (
                            "Convert the Agent answer into a JSON object matching the required schema. Return JSON only.\n\n"
                            f"Task:\n{task}\n\n"
                            f"Answer:\n{answer}"
                        ),
                    }
                ]
                return StepPlan(
                    node_id=node_id,
                    effect=Effect(
                        type=EffectType.LLM_CALL,
                        payload={
                            "messages": messages,
                            "system_prompt": system_prompt,
                            "provider": provider,
                            "model": model,
                            "response_schema": schema,
                            "response_schema_name": f"Agent_{node_id}",
                            "params": {"temperature": 0.2},
                        },
                        result_key=f"_temp.agent.{node_id}.structured",
                    ),
                    next_node=node_id,
                )

            _set_nested(run.vars, f"_temp.effects.{node_id}", result_obj)
            bucket["phase"] = "done"
            flow._node_outputs[node_id] = {"result": result_obj, "scratchpad": scratchpad, "tool_calls": tc, "tool_results": tr}
            run.vars["_last_output"] = {"result": result_obj}
            if next_node:
                return StepPlan(node_id=node_id, next_node=next_node)
            return StepPlan(node_id=node_id, complete_output={"result": result_obj, "success": True})

        if phase == "structured":
            structured_resp = bucket.get("structured")
            if structured_resp is None:
                temp = _ensure_temp_dict(run)
                agent_bucket = temp.get("agent", {}).get(node_id, {}) if isinstance(temp.get("agent"), dict) else {}
                structured_resp = agent_bucket.get("structured") if isinstance(agent_bucket, dict) else None

            data = structured_resp.get("data") if isinstance(structured_resp, dict) else None
            if data is None and isinstance(structured_resp, dict):
                content = structured_resp.get("content")
                if isinstance(content, str) and content.strip():
                    try:
                        data = json.loads(content)
                    except Exception:
                        data = None

            if not isinstance(data, dict):
                data = {}

            _set_nested(run.vars, f"_temp.effects.{node_id}", data)
            bucket["phase"] = "done"
            scratchpad = bucket.get("scratchpad")
            if not isinstance(scratchpad, dict):
                scratchpad = {"node_id": node_id, "steps": []}
            tc, tr = _extract_tool_activity_from_steps(scratchpad.get("steps"))
            flow._node_outputs[node_id] = {"result": data, "scratchpad": scratchpad, "tool_calls": tc, "tool_results": tr}
            run.vars["_last_output"] = {"result": data}
            if next_node:
                return StepPlan(node_id=node_id, next_node=next_node)
            return StepPlan(node_id=node_id, complete_output={"result": data, "success": True})

        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        return StepPlan(node_id=node_id, complete_output={"result": run.vars.get("_last_output"), "success": True})

    return handler


def _create_visual_function_handler(
    node_id: str,
    func: Callable,
    next_node: Optional[str],
    input_key: Optional[str],
    output_key: Optional[str],
    flow: Flow,
    branch_map: Optional[Dict[str, str]] = None,
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
            input_data = run.vars.get("_last_output") if "_last_output" in run.vars else run.vars

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

        # Persist per-node outputs for data-edge rehydration across pause/resume.
        #
        # Visual data edges read from `flow._node_outputs`, which is an in-memory
        # cache. When a run pauses (ASK_USER / TOOL passthrough) and is resumed
        # in a different process, we must be able to reconstruct upstream node
        # outputs from persisted `RunState.vars`.
        temp = run.vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run.vars["_temp"] = temp
        persisted_outputs = temp.get("node_outputs")
        if not isinstance(persisted_outputs, dict):
            persisted_outputs = {}
            temp["node_outputs"] = persisted_outputs
        persisted_outputs[node_id] = result

        # Also store in output_key if specified
        if output_key:
            _set_nested(run.vars, output_key, result)

        if branch_map is not None:
            branch = result.get("branch") if isinstance(result, dict) else None
            if not isinstance(branch, str) or not branch:
                run.vars["_flow_error"] = "Branching node did not return a string 'branch' value"
                run.vars["_flow_error_node"] = node_id
                return StepPlan(
                    node_id=node_id,
                    complete_output={
                        "error": "Branching node did not return a string 'branch' value",
                        "success": False,
                        "node": node_id,
                    },
                )
            chosen = branch_map.get(branch)
            if not isinstance(chosen, str) or not chosen:
                # Blueprint-style behavior: if the chosen execution pin isn't connected,
                # treat it as a clean completion instead of an error.
                if branch in {"true", "false", "default"} or branch.startswith("case:"):
                    return StepPlan(
                        node_id=node_id,
                        complete_output={"result": result, "success": True},
                    )

                run.vars["_flow_error"] = f"Unknown branch '{branch}'"
                run.vars["_flow_error_node"] = node_id
                return StepPlan(
                    node_id=node_id,
                    complete_output={
                        "error": f"Unknown branch '{branch}'",
                        "success": False,
                        "node": node_id,
                    },
                )
            return StepPlan(node_id=node_id, next_node=chosen)

        # Continue to next node or complete
        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
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
    # Attach a live reference to the current run vars so pure nodes (e.g. Get Variable)
    # can read the up-to-date workflow state during data-edge resolution.
    try:
        if hasattr(run, "vars") and isinstance(run.vars, dict):
            flow._run_vars = run.vars  # type: ignore[attr-defined]
    except Exception:
        pass

    # IMPORTANT: `flow._node_outputs` is an in-memory cache used by the visual executor
    # to resolve data edges (including lazy "pure" nodes like compare/subtract/concat).
    #
    # A single compiled `Flow` instance can be executed by multiple `RunState`s in the
    # same process when using subworkflows (START_SUBWORKFLOW) — especially with
    # self-recursion or mutual recursion. In that situation, stale cached outputs from
    # another run can break correctness (e.g. a cached `compare` result keeps a base-case
    # from ever becoming false), leading to infinite recursion.
    #
    # We isolate caches per run_id by resetting the dict *in-place* when the active run
    # changes, then rehydrating persisted outputs from `run.vars["_temp"]`.
    node_outputs = flow._node_outputs
    try:
        rid = getattr(run, "run_id", None)
        if isinstance(rid, str) and rid:
            active = getattr(flow, "_active_run_id", None)
            if active != rid:
                base = getattr(flow, "_static_node_outputs", None)
                # Backward-compat: if the baseline wasn't set (older flows), infer it
                # on first use — at this point it should contain only literal nodes.
                if not isinstance(base, dict):
                    base = dict(node_outputs) if isinstance(node_outputs, dict) else {}
                    try:
                        flow._static_node_outputs = dict(base)  # type: ignore[attr-defined]
                    except Exception:
                        pass
                if isinstance(node_outputs, dict):
                    node_outputs.clear()
                    if isinstance(base, dict):
                        node_outputs.update(base)
                try:
                    flow._active_run_id = rid  # type: ignore[attr-defined]
                except Exception:
                    pass
    except Exception:
        # Best-effort; never let cache isolation break execution.
        pass

    temp_data = run.vars.get("_temp", {})
    if not isinstance(temp_data, dict):
        return

    # Restore persisted outputs for executed (non-effect) nodes.
    persisted = temp_data.get("node_outputs")
    if isinstance(persisted, dict):
        for nid, out in persisted.items():
            if isinstance(nid, str) and nid:
                node_outputs[nid] = out

    effects = temp_data.get("effects")
    if not isinstance(effects, dict):
        effects = {}

    def _get_span_id(raw: Any) -> Optional[str]:
        if not isinstance(raw, dict):
            return None
        results = raw.get("results")
        if not isinstance(results, list) or not results:
            return None
        first = results[0]
        if not isinstance(first, dict):
            return None
        meta = first.get("meta")
        if not isinstance(meta, dict):
            return None
        span_id = meta.get("span_id")
        if isinstance(span_id, str) and span_id.strip():
            return span_id.strip()
        return None

    def _as_dict_list(value: Any) -> List[Dict[str, Any]]:
        """Normalize a value into a list of dicts (best-effort, JSON-safe)."""
        if value is None:
            return []
        if isinstance(value, dict):
            return [dict(value)]
        if isinstance(value, list):
            out: List[Dict[str, Any]] = []
            for x in value:
                if isinstance(x, dict):
                    out.append(dict(x))
            return out
        return []

    def _extract_agent_tool_activity(scratchpad: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Extract tool call requests and tool results from an agent scratchpad.

        This is *post-run* ergonomics: it does not provide real-time streaming while the agent runs.
        For real-time tool observability, hosts should subscribe to the ledger and/or node_traces.
        """
        sp = scratchpad if isinstance(scratchpad, dict) else None
        if sp is None:
            return [], []

        node_traces = sp.get("node_traces")
        if not isinstance(node_traces, dict):
            # Allow passing a single node trace directly.
            if isinstance(sp.get("steps"), list) and sp.get("node_id") is not None:
                node_traces = {str(sp.get("node_id")): sp}
            else:
                return [], []

        # Flatten steps across nodes and sort by timestamp (ISO strings are lexicographically sortable).
        steps: List[Tuple[str, Dict[str, Any]]] = []
        for _nid, trace_any in node_traces.items():
            trace = trace_any if isinstance(trace_any, dict) else None
            if trace is None:
                continue
            entries = trace.get("steps")
            if not isinstance(entries, list):
                continue
            for entry_any in entries:
                entry = entry_any if isinstance(entry_any, dict) else None
                if entry is None:
                    continue
                ts = entry.get("ts")
                ts_s = ts if isinstance(ts, str) else ""
                steps.append((ts_s, entry))
        steps.sort(key=lambda x: x[0])

        tool_calls: List[Dict[str, Any]] = []
        tool_results: List[Dict[str, Any]] = []
        for _ts, entry in steps:
            effect = entry.get("effect")
            if not isinstance(effect, dict):
                continue
            if str(effect.get("type") or "") != "tool_calls":
                continue
            payload = effect.get("payload")
            payload_d = payload if isinstance(payload, dict) else {}
            tool_calls.extend(_as_dict_list(payload_d.get("tool_calls")))

            result = entry.get("result")
            if not isinstance(result, dict):
                continue
            results = result.get("results")
            tool_results.extend(_as_dict_list(results))

        return tool_calls, tool_results

    for node_id, flow_node in flow.nodes.items():
        effect_type = flow_node.effect_type
        if not effect_type:
            continue

        raw = effects.get(node_id)
        if raw is None:
            # Backward-compat for older runs/tests that stored by effect type.
            legacy_key = f"{effect_type}_response"
            raw = temp_data.get(legacy_key)
        if raw is None:
            continue

        current = node_outputs.get(node_id)
        if not isinstance(current, dict):
            current = {}
            node_outputs[node_id] = current
        else:
            # If this node previously produced a pre-effect placeholder from the
            # visual executor (e.g. `_pending_effect`), remove it now that we have
            # the durable effect outcome in `run.vars["_temp"]["effects"]`.
            current.pop("_pending_effect", None)

        mapped_value: Any = None

        if effect_type == "ask_user":
            if isinstance(raw, dict):
                # raw is usually {"response": "..."} (resume payload)
                current.update(raw)
                mapped_value = raw.get("response")
        elif effect_type == "answer_user":
            if isinstance(raw, dict):
                current.update(raw)
                mapped_value = raw.get("message")
            else:
                current["message"] = raw
                mapped_value = raw
        elif effect_type == "llm_call":
            if isinstance(raw, dict):
                current["response"] = raw.get("content")
                # Convenience pin: expose tool_calls directly, instead of forcing consumers
                # to drill into `result.tool_calls` via a Break Object node.
                current["tool_calls"] = _as_dict_list(raw.get("tool_calls"))
                # Expose the full normalized LLM result as an object output pin (`result`).
                # This enables deterministic state-machine workflows to branch on:
                # - tool_calls
                # - usage / model / finish_reason
                # - trace_id / metadata for observability
                current["result"] = raw
                current["gen_time"] = raw.get("gen_time")
                current["ttft_ms"] = raw.get("ttft_ms")
                current["raw"] = raw
                mapped_value = current["response"]
        elif effect_type == "tool_calls":
            # Effect outcome is produced by AbstractRuntime TOOL_CALLS handler:
            # - executed: {"mode":"executed","results":[{call_id,name,success,output,error}, ...]}
            # - passthrough/untrusted: {"mode": "...", "tool_calls": [...]}
            if isinstance(raw, dict):
                mode = raw.get("mode")
                results = raw.get("results")
                if not isinstance(results, list):
                    results = []
                current["results"] = results
                # Only treat non-executed modes as failure (results are unavailable).
                if isinstance(mode, str) and mode.strip() and mode != "executed":
                    current["success"] = False
                else:
                    current["success"] = all(isinstance(r, dict) and r.get("success") is True for r in results)
                current["raw"] = raw
                mapped_value = current["results"]
        elif effect_type == "agent":
            current["result"] = raw
            scratchpad = None
            agent_ns = temp_data.get("agent")
            if isinstance(agent_ns, dict):
                bucket = agent_ns.get(node_id)
                if isinstance(bucket, dict):
                    scratchpad = bucket.get("scratchpad")

            if scratchpad is None:
                # Fallback: use this node's own trace if present.
                try:
                    from abstractruntime.core.vars import get_node_trace as _get_node_trace
                except Exception:  # pragma: no cover
                    _get_node_trace = None  # type: ignore[assignment]
                if callable(_get_node_trace):
                    scratchpad = _get_node_trace(run.vars, node_id)

            current["scratchpad"] = scratchpad if scratchpad is not None else {"node_id": node_id, "steps": []}
            # Convenience pins: expose tool activity extracted from the scratchpad trace.
            # This is intentionally best-effort and does not change agent execution behavior.
            tc, tr = _extract_agent_tool_activity(current.get("scratchpad"))
            current["tool_calls"] = tc
            current["tool_results"] = tr
            mapped_value = raw
        elif effect_type == "wait_event":
            current["event_data"] = raw
            mapped_value = raw
        elif effect_type == "on_event":
            # Custom event listener: the resume payload is a structured envelope.
            if isinstance(raw, dict):
                current["event"] = raw
                current["payload"] = raw.get("payload")
                current["event_id"] = raw.get("event_id")
                current["name"] = raw.get("name")
                mapped_value = raw
            else:
                current["event"] = raw
                mapped_value = raw
        elif effect_type == "on_schedule":
            cfg = flow_node.effect_config if isinstance(flow_node.effect_config, dict) else {}
            schedule_cfg = cfg.get("schedule")
            schedule_str = str(schedule_cfg or "").strip() if schedule_cfg is not None else ""
            recurrent_cfg = cfg.get("recurrent")
            recurrent_flag = True if recurrent_cfg is None else bool(recurrent_cfg)
            # ISO timestamps are treated as one-shot; recurrence is disabled.
            if schedule_str and not isinstance(schedule_cfg, (int, float)) and schedule_str:
                import re

                if not re.match(r"^\\s*\\d+(?:\\.\\d+)?\\s*(ms|s|m|h|d)\\s*$", schedule_str, re.IGNORECASE):
                    recurrent_flag = False

            if isinstance(raw, dict):
                current.update(raw)
                ts = raw.get("timestamp")
                if ts is None:
                    ts = raw.get("scheduled_for")
                current["timestamp"] = ts
                current["recurrent"] = recurrent_flag
                mapped_value = ts if ts is not None else raw
            else:
                current["timestamp"] = raw
                current["recurrent"] = recurrent_flag
                mapped_value = raw
        elif effect_type == "wait_until":
            if isinstance(raw, dict):
                current.update(raw)
            else:
                current["result"] = raw
            mapped_value = raw
        elif effect_type == "emit_event":
            # Custom event emission result (dispatch summary).
            if isinstance(raw, dict):
                current.update(raw)
                mapped_value = raw
            else:
                current["result"] = raw
                mapped_value = raw
        elif effect_type == "memory_note":
            span_id = _get_span_id(raw)
            current["note_id"] = span_id
            current["raw"] = raw
            mapped_value = span_id
        elif effect_type == "memory_query":
            # Runtime returns a tool-results envelope:
            #   {"mode":"executed","results":[{call_id,name,success,output,error,meta?}, ...]}
            rendered = ""
            matches: list[Any] = []
            span_ids: list[Any] = []
            if isinstance(raw, dict):
                results_list = raw.get("results")
                if isinstance(results_list, list) and results_list:
                    first = results_list[0]
                    if isinstance(first, dict):
                        out = first.get("output")
                        if isinstance(out, str):
                            rendered = out
                        meta = first.get("meta")
                        if isinstance(meta, dict):
                            m = meta.get("matches")
                            if isinstance(m, list):
                                matches = m
                            sids = meta.get("span_ids")
                            if isinstance(sids, list):
                                span_ids = sids

            current["rendered"] = rendered
            current["results"] = matches
            current["span_ids"] = span_ids
            current["raw"] = raw
            mapped_value = current["results"]
        elif effect_type == "memory_rehydrate":
            if isinstance(raw, dict):
                current["inserted"] = raw.get("inserted")
                current["skipped"] = raw.get("skipped")
                current["artifacts"] = raw.get("artifacts")
            else:
                current["inserted"] = 0
                current["skipped"] = 0
                current["artifacts"] = []
            current["raw"] = raw
            mapped_value = raw
        elif effect_type == "start_subworkflow":
            if isinstance(raw, dict):
                current["sub_run_id"] = raw.get("sub_run_id")
                out = raw.get("output")
                if isinstance(out, dict) and "result" in out:
                    result_value = out.get("result")
                    current["output"] = result_value
                    current["child_output"] = out
                else:
                    result_value = out
                    current["output"] = result_value
                    if isinstance(out, dict):
                        current["child_output"] = out
                mapped_value = current.get("output")

                cfg = flow_node.effect_config or {}
                out_pins = cfg.get("output_pins")
                if isinstance(out_pins, list) and out_pins:
                    if isinstance(result_value, dict):
                        for pid in out_pins:
                            if isinstance(pid, str) and pid:
                                if pid == "output":
                                    continue
                                current[pid] = result_value.get(pid)
                    elif len(out_pins) == 1 and isinstance(out_pins[0], str) and out_pins[0]:
                        current[out_pins[0]] = result_value
            else:
                current["output"] = raw
                mapped_value = raw

        # Optional: also write the mapped output to run.vars if configured.
        if flow_node.output_key and mapped_value is not None:
            _set_nested(run.vars, flow_node.output_key, mapped_value)


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

    outgoing: Dict[str, list] = {}
    for edge in flow.edges:
        outgoing.setdefault(edge.source, []).append(edge)

    # Build next-node map (linear) and branch maps (If/Else).
    next_node_map: Dict[str, Optional[str]] = {}
    branch_maps: Dict[str, Dict[str, str]] = {}
    control_specs: Dict[str, Dict[str, Any]] = {}

    def _is_supported_branch_handle(handle: str) -> bool:
        return handle in {"true", "false", "default"} or handle.startswith("case:")

    for node_id in flow.nodes:
        outs = outgoing.get(node_id, [])
        if not outs:
            next_node_map[node_id] = None
            continue

        flow_node = flow.nodes.get(node_id)
        node_effect_type = getattr(flow_node, "effect_type", None) if flow_node else None

        # Sequence / Parallel: deterministic fan-out scheduling (Blueprint-style).
        #
        # Important: these nodes may have 0..N connected outputs; even a single
        # `then:0` edge should compile (it is not "branching" based on data).
        if node_effect_type in {"sequence", "parallel"}:
            # Validate all execution edges have a handle
            handles: list[str] = []
            targets_by_handle: Dict[str, str] = {}
            for e in outs:
                h = getattr(e, "source_handle", None)
                if not isinstance(h, str) or not h:
                    raise ValueError(
                        f"Control node '{node_id}' has an execution edge with no source_handle."
                    )
                handles.append(h)
                targets_by_handle[h] = e.target

            cfg = getattr(flow_node, "effect_config", None) if flow_node else None
            cfg_dict = cfg if isinstance(cfg, dict) else {}
            then_handles = cfg_dict.get("then_handles")
            if not isinstance(then_handles, list):
                then_handles = [h for h in handles if h.startswith("then:")]

                def _then_key(h: str) -> int:
                    try:
                        if h.startswith("then:"):
                            return int(h.split(":", 1)[1])
                    except Exception:
                        pass
                    return 10**9

                then_handles = sorted(then_handles, key=_then_key)
            else:
                then_handles = [str(h) for h in then_handles if isinstance(h, str) and h]

            allowed = set(then_handles)
            completed_target: Optional[str] = None
            if node_effect_type == "parallel":
                allowed.add("completed")
                completed_target = targets_by_handle.get("completed")

            unknown = [h for h in handles if h not in allowed]
            if unknown:
                raise ValueError(
                    f"Control node '{node_id}' has unsupported execution outputs: {unknown}"
                )

            control_specs[node_id] = {
                "kind": node_effect_type,
                "then_handles": then_handles,
                "targets_by_handle": targets_by_handle,
                "completed_target": completed_target,
            }
            next_node_map[node_id] = None
            continue

        # Loop (Foreach): structured scheduling via `loop` (body) and `done` (completed).
        #
        # This is a scheduler node (like Sequence/Parallel), not data-driven branching.
        if node_effect_type == "loop":
            handles: list[str] = []
            targets_by_handle: Dict[str, str] = {}
            for e in outs:
                h = getattr(e, "source_handle", None)
                if not isinstance(h, str) or not h:
                    raise ValueError(
                        f"Control node '{node_id}' has an execution edge with no source_handle."
                    )
                handles.append(h)
                targets_by_handle[h] = e.target

            allowed = {"loop", "done"}
            unknown = [h for h in handles if h not in allowed]
            if unknown:
                raise ValueError(
                    f"Control node '{node_id}' has unsupported execution outputs: {unknown}"
                )

            control_specs[node_id] = {
                "kind": "loop",
                "loop_target": targets_by_handle.get("loop"),
                "done_target": targets_by_handle.get("done"),
            }
            next_node_map[node_id] = None
            continue

        # While: structured scheduling via `loop` (body) and `done` (completed),
        # gated by a boolean condition pin resolved via data edges.
        if node_effect_type == "while":
            handles = []
            targets_by_handle = {}
            for e in outs:
                h = getattr(e, "source_handle", None)
                if not isinstance(h, str) or not h:
                    raise ValueError(
                        f"Control node '{node_id}' has an execution edge with no source_handle."
                    )
                handles.append(h)
                targets_by_handle[h] = e.target

            allowed = {"loop", "done"}
            unknown = [h for h in handles if h not in allowed]
            if unknown:
                raise ValueError(
                    f"Control node '{node_id}' has unsupported execution outputs: {unknown}"
                )

            control_specs[node_id] = {
                "kind": "while",
                "loop_target": targets_by_handle.get("loop"),
                "done_target": targets_by_handle.get("done"),
            }
            next_node_map[node_id] = None
            continue

        # For: structured scheduling via `loop` (body) and `done` (completed),
        # over a numeric range resolved via data edges (start/end/step).
        if node_effect_type == "for":
            handles = []
            targets_by_handle = {}
            for e in outs:
                h = getattr(e, "source_handle", None)
                if not isinstance(h, str) or not h:
                    raise ValueError(
                        f"Control node '{node_id}' has an execution edge with no source_handle."
                    )
                handles.append(h)
                targets_by_handle[h] = e.target

            allowed = {"loop", "done"}
            unknown = [h for h in handles if h not in allowed]
            if unknown:
                raise ValueError(
                    f"Control node '{node_id}' has unsupported execution outputs: {unknown}"
                )

            control_specs[node_id] = {
                "kind": "for",
                "loop_target": targets_by_handle.get("loop"),
                "done_target": targets_by_handle.get("done"),
            }
            next_node_map[node_id] = None
            continue

        if len(outs) == 1:
            h = getattr(outs[0], "source_handle", None)
            if isinstance(h, str) and h and h != "exec-out":
                if not _is_supported_branch_handle(h):
                    raise ValueError(
                        f"Node '{node_id}' has unsupported branching output '{h}'. "
                        "Branching is not yet supported."
                    )
                branch_maps[node_id] = {h: outs[0].target}  # type: ignore[arg-type]
                next_node_map[node_id] = None
            else:
                next_node_map[node_id] = outs[0].target
            continue

        handles: list[str] = []
        for e in outs:
            h = getattr(e, "source_handle", None)
            if not isinstance(h, str) or not h:
                handles = []
                break
            handles.append(h)

        if len(handles) != len(outs) or len(set(handles)) != len(handles):
            raise ValueError(
                f"Node '{node_id}' has multiple outgoing edges. "
                "Branching is not yet supported."
            )

        # Minimal branching support: If/Else uses `true` / `false` execution outputs.
        if set(handles) <= {"true", "false"}:
            branch_maps[node_id] = {e.source_handle: e.target for e in outs}  # type: ignore[arg-type]
            next_node_map[node_id] = None
            continue

        # Switch branching: stable case handles + optional default.
        if all(h == "default" or h.startswith("case:") for h in handles):
            branch_maps[node_id] = {e.source_handle: e.target for e in outs}  # type: ignore[arg-type]
            next_node_map[node_id] = None
            continue

        raise ValueError(
            f"Node '{node_id}' has multiple outgoing edges. "
            "Branching is not yet supported."
        )

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

    def _wrap_return_to_active_control(
        handler: Callable,
        *,
        node_id: str,
        visual_type: Optional[str],
    ) -> Callable:
        """If a node tries to complete the run inside an active control block, return to the scheduler.

        This is crucial for Blueprint-style nodes:
        - branch chains can end (no outgoing exec edges) without ending the whole flow
        - Sequence/Parallel can then continue scheduling other branches
        """
        from abstractruntime.core.models import StepPlan

        try:
            from .adapters.control_adapter import get_active_control_node_id
        except Exception:  # pragma: no cover
            get_active_control_node_id = None  # type: ignore[assignment]

        def wrapped(run: Any, ctx: Any) -> "StepPlan":
            plan: StepPlan = handler(run, ctx)
            if not callable(get_active_control_node_id):
                return plan

            active = get_active_control_node_id(run.vars)
            if not isinstance(active, str) or not active:
                return plan
            if active == node_id:
                return plan

            # Explicit end node should always terminate the run, even inside a control block.
            if visual_type == "on_flow_end":
                return plan

            # If the node is about to complete the run, treat it as "branch complete" instead.
            if plan.complete_output is not None:
                return StepPlan(node_id=plan.node_id, next_node=active)

            # Terminal effect node: runtime would auto-complete if next_node is missing.
            if plan.effect is not None and not plan.next_node:
                return StepPlan(node_id=plan.node_id, effect=plan.effect, next_node=active)

            # Defensive fallback.
            if plan.effect is None and not plan.next_node and plan.complete_output is None:
                return StepPlan(node_id=plan.node_id, next_node=active)

            return plan

        return wrapped

    for node_id, flow_node in flow.nodes.items():
        next_node = next_node_map.get(node_id)
        branch_map = branch_maps.get(node_id)
        handler_obj = getattr(flow_node, "handler", None)
        effect_type = getattr(flow_node, "effect_type", None)
        effect_config = getattr(flow_node, "effect_config", None) or {}
        visual_type = effect_config.get("_visual_type") if isinstance(effect_config, dict) else None

        # Check for effect/control nodes first
        if effect_type == "sequence":
            from .adapters.control_adapter import create_sequence_node_handler

            spec = control_specs.get(node_id) or {}
            handlers[node_id] = create_sequence_node_handler(
                node_id=node_id,
                ordered_then_handles=list(spec.get("then_handles") or []),
                targets_by_handle=dict(spec.get("targets_by_handle") or {}),
            )
        elif effect_type == "parallel":
            from .adapters.control_adapter import create_parallel_node_handler

            spec = control_specs.get(node_id) or {}
            handlers[node_id] = create_parallel_node_handler(
                node_id=node_id,
                ordered_then_handles=list(spec.get("then_handles") or []),
                targets_by_handle=dict(spec.get("targets_by_handle") or {}),
                completed_target=spec.get("completed_target"),
            )
        elif effect_type == "loop":
            from .adapters.control_adapter import create_loop_node_handler

            spec = control_specs.get(node_id) or {}
            loop_data_handler = handler_obj if callable(handler_obj) else None

            # Precompute upstream pure-node ids for cache invalidation (best-effort).
            #
            # Pure nodes (e.g. concat/split/break_object) are cached in `flow._node_outputs`.
            # Inside a Loop, the inputs to those pure nodes often change per-iteration
            # (index/item, evolving scratchpad vars, etc.). If we don't invalidate, the
            # loop body may reuse stale values from iteration 0.
            pure_ids = getattr(flow, "_pure_node_ids", None) if flow is not None else None
            pure_ids = set(pure_ids) if isinstance(pure_ids, (set, list, tuple)) else set()

            def _resolve_items(
                run: Any,
                _handler: Any = loop_data_handler,
                _node_id: str = node_id,
            ) -> list[Any]:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                if not callable(_handler):
                    return []
                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception as e:
                    # Surface this as a workflow error (don't silently treat as empty).
                    try:
                        run.vars["_flow_error"] = f"Loop items resolution failed: {e}"
                        run.vars["_flow_error_node"] = _node_id
                    except Exception:
                        pass
                    raise
                if not isinstance(resolved, dict):
                    return []
                raw = resolved.get("items")
                if isinstance(raw, list):
                    return raw
                if isinstance(raw, tuple):
                    return list(raw)
                if raw is None:
                    return []
                return [raw]

            base_loop = create_loop_node_handler(
                node_id=node_id,
                loop_target=spec.get("loop_target"),
                done_target=spec.get("done_target"),
                resolve_items=_resolve_items,
            )

            def _wrapped_loop(
                run: Any,
                ctx: Any,
                *,
                _base: Any = base_loop,
                _pure_ids: set[str] = pure_ids,
            ) -> StepPlan:
                # Ensure pure nodes feeding the loop body are re-evaluated per iteration.
                if flow is not None and _pure_ids and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                    node_outputs = getattr(flow, "_node_outputs", None)
                    if isinstance(node_outputs, dict):
                        for nid in _pure_ids:
                            node_outputs.pop(nid, None)
                plan = _base(run, ctx)
                # The loop scheduler persists `{item,index,total}` into run.vars, but
                # UI node_complete events read from `flow._node_outputs`. Sync after
                # scheduling so observability reflects the current iteration.
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                return plan

            handlers[node_id] = _wrapped_loop
        elif effect_type == "agent":
            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = _create_visual_agent_effect_handler(
                node_id=node_id,
                next_node=next_node,
                agent_config=effect_config if isinstance(effect_config, dict) else {},
                data_aware_handler=data_aware_handler,
                flow=flow,
            )
        elif effect_type == "while":
            from .adapters.control_adapter import create_while_node_handler

            spec = control_specs.get(node_id) or {}
            while_data_handler = handler_obj if callable(handler_obj) else None

            # Precompute upstream pure-node ids for cache invalidation (best-effort).
            pure_ids = getattr(flow, "_pure_node_ids", None) if flow is not None else None
            pure_ids = set(pure_ids) if isinstance(pure_ids, (set, list, tuple)) else set()

            data_edge_map = getattr(flow, "_data_edge_map", None) if flow is not None else None
            data_edge_map = data_edge_map if isinstance(data_edge_map, dict) else {}

            upstream_pure: set[str] = set()
            if pure_ids:
                stack2 = [node_id]
                seen2: set[str] = set()
                while stack2:
                    cur = stack2.pop()
                    if cur in seen2:
                        continue
                    seen2.add(cur)
                    deps = data_edge_map.get(cur)
                    if not isinstance(deps, dict):
                        continue
                    for _pin, src in deps.items():
                        if not isinstance(src, tuple) or len(src) != 2:
                            continue
                        src_node = src[0]
                        if not isinstance(src_node, str) or not src_node:
                            continue
                        stack2.append(src_node)
                        if src_node in pure_ids:
                            upstream_pure.add(src_node)

            def _resolve_condition(
                run: Any,
                _handler: Any = while_data_handler,
                _node_id: str = node_id,
                _upstream_pure: set[str] = upstream_pure,
            ) -> bool:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                    # Ensure pure nodes feeding the condition are re-evaluated per iteration.
                    if _upstream_pure and hasattr(flow, "_node_outputs"):
                        node_outputs = getattr(flow, "_node_outputs", None)
                        if isinstance(node_outputs, dict):
                            for nid in _upstream_pure:
                                node_outputs.pop(nid, None)

                if not callable(_handler):
                    return False

                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception as e:
                    try:
                        run.vars["_flow_error"] = f"While condition resolution failed: {e}"
                        run.vars["_flow_error_node"] = _node_id
                    except Exception:
                        pass
                    raise

                if isinstance(resolved, dict) and "condition" in resolved:
                    return bool(resolved.get("condition"))
                return bool(resolved)

            base_while = create_while_node_handler(
                node_id=node_id,
                loop_target=spec.get("loop_target"),
                done_target=spec.get("done_target"),
                resolve_condition=_resolve_condition,
            )

            def _wrapped_while(
                run: Any,
                ctx: Any,
                *,
                _base: Any = base_while,
            ) -> StepPlan:
                plan = _base(run, ctx)
                # While scheduler persists `index` into run.vars; sync so WS/UI
                # node_complete events show the latest iteration count.
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                return plan

            handlers[node_id] = _wrapped_while
        elif effect_type == "for":
            from .adapters.control_adapter import create_for_node_handler

            spec = control_specs.get(node_id) or {}
            for_data_handler = handler_obj if callable(handler_obj) else None

            # Precompute upstream pure-node ids for cache invalidation (best-effort).
            pure_ids = getattr(flow, "_pure_node_ids", None) if flow is not None else None
            pure_ids = set(pure_ids) if isinstance(pure_ids, (set, list, tuple)) else set()

            def _resolve_range(
                run: Any,
                _handler: Any = for_data_handler,
                _node_id: str = node_id,
            ) -> Dict[str, Any]:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                if not callable(_handler):
                    return {}
                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception as e:
                    try:
                        run.vars["_flow_error"] = f"For range resolution failed: {e}"
                        run.vars["_flow_error_node"] = _node_id
                    except Exception:
                        pass
                    raise
                return resolved if isinstance(resolved, dict) else {}

            base_for = create_for_node_handler(
                node_id=node_id,
                loop_target=spec.get("loop_target"),
                done_target=spec.get("done_target"),
                resolve_range=_resolve_range,
            )

            def _wrapped_for(
                run: Any,
                ctx: Any,
                *,
                _base: Any = base_for,
                _pure_ids: set[str] = pure_ids,
            ) -> StepPlan:
                # Ensure pure nodes feeding the loop body are re-evaluated per iteration.
                if flow is not None and _pure_ids and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                    node_outputs = getattr(flow, "_node_outputs", None)
                    if isinstance(node_outputs, dict):
                        for nid in _pure_ids:
                            node_outputs.pop(nid, None)
                plan = _base(run, ctx)
                # For scheduler persists `{i,index,total}` into run.vars; sync so
                # WS/UI node_complete events show the current iteration.
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                return plan

            handlers[node_id] = _wrapped_for
        elif effect_type == "on_event":
            from .adapters.event_adapter import create_on_event_node_handler

            on_event_data_handler = handler_obj if callable(handler_obj) else None

            def _resolve_inputs(
                run: Any,
                _handler: Any = on_event_data_handler,
            ) -> Dict[str, Any]:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                if not callable(_handler):
                    return {}
                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception:
                    resolved = {}
                return resolved if isinstance(resolved, dict) else {}

            # Blank/unspecified name is treated as "listen to any event" (wildcard).
            default_name = ""
            scope = "session"
            if isinstance(effect_config, dict):
                raw_name = effect_config.get("name") or effect_config.get("event_name")
                if isinstance(raw_name, str) and raw_name.strip():
                    default_name = raw_name
                raw_scope = effect_config.get("scope")
                if isinstance(raw_scope, str) and raw_scope.strip():
                    scope = raw_scope

            handlers[node_id] = create_on_event_node_handler(
                node_id=node_id,
                next_node=next_node,
                resolve_inputs=_resolve_inputs if callable(on_event_data_handler) else None,
                default_name=default_name,
                scope=scope,
                flow=flow,
            )
        elif effect_type == "on_schedule":
            from .adapters.event_adapter import create_on_schedule_node_handler

            on_schedule_data_handler = handler_obj if callable(handler_obj) else None

            def _resolve_inputs(
                run: Any,
                _handler: Any = on_schedule_data_handler,
            ) -> Dict[str, Any]:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                if not callable(_handler):
                    return {}
                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception:
                    resolved = {}
                return resolved if isinstance(resolved, dict) else {}

            schedule = "15s"
            recurrent = True
            if isinstance(effect_config, dict):
                raw_schedule = effect_config.get("schedule")
                if isinstance(raw_schedule, str) and raw_schedule.strip():
                    schedule = raw_schedule.strip()
                raw_recurrent = effect_config.get("recurrent")
                if isinstance(raw_recurrent, bool):
                    recurrent = raw_recurrent

            handlers[node_id] = create_on_schedule_node_handler(
                node_id=node_id,
                next_node=next_node,
                resolve_inputs=_resolve_inputs if callable(on_schedule_data_handler) else None,
                schedule=schedule,
                recurrent=recurrent,
                flow=flow,
            )
        elif effect_type == "emit_event":
            from .adapters.event_adapter import create_emit_event_node_handler

            emit_data_handler = handler_obj if callable(handler_obj) else None

            def _resolve_inputs(
                run: Any,
                _handler: Any = emit_data_handler,
            ) -> Dict[str, Any]:
                if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
                    _sync_effect_results_to_node_outputs(run, flow)
                if not callable(_handler):
                    return {}
                last_output = run.vars.get("_last_output", {})
                try:
                    resolved = _handler(last_output)
                except Exception:
                    resolved = {}
                return resolved if isinstance(resolved, dict) else {}

            default_name = ""
            default_session_id: Optional[str] = None
            scope = "session"
            if isinstance(effect_config, dict):
                raw_name = effect_config.get("name") or effect_config.get("event_name")
                if isinstance(raw_name, str) and raw_name.strip():
                    default_name = raw_name
                raw_session = effect_config.get("session_id")
                if raw_session is None:
                    raw_session = effect_config.get("sessionId")
                if isinstance(raw_session, str) and raw_session.strip():
                    default_session_id = raw_session.strip()
                raw_scope = effect_config.get("scope")
                if isinstance(raw_scope, str) and raw_scope.strip():
                    scope = raw_scope

            handlers[node_id] = create_emit_event_node_handler(
                node_id=node_id,
                next_node=next_node,
                resolve_inputs=_resolve_inputs,
                default_name=default_name,
                default_session_id=default_session_id,
                scope=scope,
            )
        elif effect_type:
            # Pass the handler_obj as data_aware_handler if it's callable
            # This allows visual flows to resolve data edges before creating effects
            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = _create_effect_node_handler(
                node_id=node_id,
                effect_type=effect_type,
                effect_config=effect_config,
                next_node=next_node,
                input_key=getattr(flow_node, "input_key", None),
                output_key=getattr(flow_node, "output_key", None),
                data_aware_handler=data_aware_handler,
                flow=flow,
            )
        elif _is_agent(handler_obj):
            handlers[node_id] = create_agent_node_handler(
                node_id=node_id,
                agent=handler_obj,
                next_node=next_node,
                input_key=getattr(flow_node, "input_key", None),
                output_key=getattr(flow_node, "output_key", None),
            )
        elif _is_flow(handler_obj):
            # Nested flow - compile recursively
            nested_spec = compile_flow(handler_obj)
            handlers[node_id] = create_subflow_node_handler(
                node_id=node_id,
                nested_workflow=nested_spec,
                next_node=next_node,
                input_key=getattr(flow_node, "input_key", None),
                output_key=getattr(flow_node, "output_key", None),
            )
        elif visual_type == "set_var":
            from .adapters.variable_adapter import create_set_var_node_handler

            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = create_set_var_node_handler(
                node_id=node_id,
                next_node=next_node,
                data_aware_handler=data_aware_handler,
                flow=flow,
            )
        elif visual_type == "set_var_property":
            from .adapters.variable_adapter import create_set_var_property_node_handler

            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = create_set_var_property_node_handler(
                node_id=node_id,
                next_node=next_node,
                data_aware_handler=data_aware_handler,
                flow=flow,
            )
        elif visual_type == "set_vars":
            from .adapters.variable_adapter import create_set_vars_node_handler

            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = create_set_vars_node_handler(
                node_id=node_id,
                next_node=next_node,
                data_aware_handler=data_aware_handler,
                flow=flow,
            )
        elif callable(handler_obj):
            # Check if this is a visual flow handler (has closure access to node_outputs)
            # Visual flow handlers need special handling to resolve data edges
            handlers[node_id] = _create_visual_function_handler(
                node_id=node_id,
                func=handler_obj,
                next_node=next_node,
                input_key=getattr(flow_node, "input_key", None),
                output_key=getattr(flow_node, "output_key", None),
                branch_map=branch_map,
                flow=flow,
            )
        else:
            raise TypeError(
                f"Unknown handler type for node '{node_id}': {type(handler_obj)}. "
                "Expected agent, function, or Flow."
            )

        # Blueprint-style control flow: terminal nodes inside Sequence/Parallel should
        # return to the active scheduler instead of completing the whole run.
        handlers[node_id] = _wrap_return_to_active_control(
            handlers[node_id],
            node_id=node_id,
            visual_type=visual_type if isinstance(visual_type, str) else None,
        )

    return WorkflowSpec(
        workflow_id=flow.flow_id,
        entry_node=flow.entry_node,
        nodes=handlers,
    )
