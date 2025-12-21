"""Flow compiler - converts Flow definitions to AbstractRuntime WorkflowSpec."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, TYPE_CHECKING

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
    create_llm_call_handler,
    create_start_subworkflow_handler,
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
    from abstractruntime.core.vars import get_node_trace as _get_node_trace

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

    The Agent node is implemented as a small state machine that:
    - resolves inputs via data edges (task/context)
    - runs an LLM_CALL effect (optionally with tools)
    - executes TOOL_CALLS effects when tool calls are returned
    - optionally performs a final structured-output LLM_CALL
    """
    import json
    from abstractruntime.core.models import StepPlan, Effect, EffectType
    try:
        from abstractruntime.core.vars import get_node_trace as _get_node_trace
    except Exception:  # pragma: no cover
        _get_node_trace = None  # type: ignore[assignment]

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

    def _normalize_tools(raw: Any) -> list[str]:
        if not isinstance(raw, list):
            return []
        out: list[str] = []
        for t in raw:
            if isinstance(t, str) and t.strip():
                out.append(t.strip())
        return out

    def _build_prompt(*, task: str, context: Dict[str, Any]) -> str:
        if not context:
            return task
        context_str = "\n".join(f"{k}: {v}" for k, v in context.items())
        return f"Context:\n{context_str}\n\nTask: {task}"

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

    def _runtime_node_trace(run: Any) -> Dict[str, Any]:
        if callable(_get_node_trace):
            return _get_node_trace(run.vars, node_id)
        return {"node_id": node_id, "steps": []}

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx

        provider_raw = agent_config.get("provider")
        model_raw = agent_config.get("model")
        provider = str(provider_raw or "").strip().lower() if isinstance(provider_raw, str) else ""
        model = str(model_raw or "").strip() if isinstance(model_raw, str) else ""

        tools_selected = _normalize_tools(agent_config.get("tools"))

        output_schema_cfg = agent_config.get("outputSchema") if isinstance(agent_config.get("outputSchema"), dict) else {}
        schema_enabled = bool(output_schema_cfg.get("enabled"))
        schema = output_schema_cfg.get("jsonSchema") if isinstance(output_schema_cfg.get("jsonSchema"), dict) else None

        bucket = _get_agent_bucket(run)
        phase = str(bucket.get("phase") or "init")
        try:
            tool_round = int(bucket.get("tool_round") or 0)
        except (TypeError, ValueError):
            tool_round = 0
        try:
            max_tool_rounds = int(bucket.get("max_tool_rounds") or 8)
        except (TypeError, ValueError):
            max_tool_rounds = 8
        if max_tool_rounds < 1:
            max_tool_rounds = 1

        resolved_inputs = _resolve_inputs(run)
        task = str(resolved_inputs.get("task") or "")
        context_raw = resolved_inputs.get("context")
        context = context_raw if isinstance(context_raw, dict) else {}

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
                flow._node_outputs[node_id] = {"result": out, "scratchpad": _runtime_node_trace(run)}
                run.vars["_last_output"] = {"result": out}
                if next_node:
                    return StepPlan(node_id=node_id, next_node=next_node)
                return StepPlan(node_id=node_id, complete_output={"result": out, "success": False})

            bucket["messages"] = [{"role": "user", "content": _build_prompt(task=task, context=context)}]
            bucket["phase"] = "llm"
            bucket["tool_round"] = 0

            tools_payload = None
            if tools_selected:
                from abstractruntime.integrations.abstractcore.default_tools import filter_tool_specs

                tools_payload = filter_tool_specs(tools_selected)

            return StepPlan(
                node_id=node_id,
                effect=Effect(
                    type=EffectType.LLM_CALL,
                    payload={
                        "messages": bucket["messages"],
                        "provider": provider,
                        "model": model,
                        "tools": tools_payload,
                        "params": {"temperature": 0.7},
                    },
                    result_key=f"_temp.agent.{node_id}.llm",
                ),
                next_node=node_id,
            )

        if phase == "llm":
            llm_resp = bucket.get("llm")
            if llm_resp is None:
                temp = _ensure_temp_dict(run)
                agent_bucket = temp.get("agent", {}).get(node_id, {}) if isinstance(temp.get("agent"), dict) else {}
                llm_resp = agent_bucket.get("llm") if isinstance(agent_bucket, dict) else None

            # In normal execution, the LLM_CALL effect stores under _temp.agent.{node_id}.llm
            # which is the same dict bucket we use; keep defensive reads anyway.
            if isinstance(llm_resp, dict):
                tool_calls = llm_resp.get("tool_calls")
                if isinstance(tool_calls, list) and tool_calls and tools_selected:
                    # Preserve any assistant content as context for the next turn.
                    content = llm_resp.get("content")
                    messages = bucket.get("messages")
                    if not isinstance(messages, list):
                        messages = []
                    if content:
                        messages.append({"role": "assistant", "content": str(content)})
                    bucket["messages"] = messages

                    bucket["phase"] = "tool_calls"
                    bucket["last_tool_calls"] = tool_calls
                    return StepPlan(
                        node_id=node_id,
                        effect=Effect(
                            type=EffectType.TOOL_CALLS,
                            payload={
                                "tool_calls": tool_calls,
                                "allowed_tools": tools_selected,
                            },
                            result_key=f"_temp.agent.{node_id}.tool_results",
                        ),
                        next_node=node_id,
                    )

                content = llm_resp.get("content")
                usage = llm_resp.get("usage")
                result_obj = {
                    "result": str(content or ""),
                    "task": task,
                    "context": context,
                    "success": True,
                    "provider": provider,
                    "model": model,
                    "usage": usage,
                }

                if schema_enabled and schema:
                    bucket["phase"] = "structured"
                    messages = bucket.get("messages")
                    if not isinstance(messages, list):
                        messages = []
                    # Append the previous assistant response as context.
                    if content:
                        messages.append({"role": "assistant", "content": str(content)})
                    messages.append(
                        {
                            "role": "user",
                            "content": "Return a JSON object that matches the required schema. Return JSON only.",
                        }
                    )
                    bucket["messages"] = messages

                    return StepPlan(
                        node_id=node_id,
                        effect=Effect(
                            type=EffectType.LLM_CALL,
                            payload={
                                "messages": messages,
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
                flow._node_outputs[node_id] = {"result": result_obj, "scratchpad": _runtime_node_trace(run)}
                run.vars["_last_output"] = {"result": result_obj}
                if next_node:
                    return StepPlan(node_id=node_id, next_node=next_node)
                return StepPlan(node_id=node_id, complete_output={"result": result_obj, "success": True})

            # No llm result; fail fast.
            run.vars["_flow_error"] = "Agent node missing llm result"
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"error": "Agent node missing llm result", "success": False, "node": node_id},
            )

        if phase == "tool_calls":
            tool_results = bucket.get("tool_results")
            if tool_results is None:
                temp = _ensure_temp_dict(run)
                agent_bucket = temp.get("agent", {}).get(node_id, {}) if isinstance(temp.get("agent"), dict) else {}
                tool_results = agent_bucket.get("tool_results") if isinstance(agent_bucket, dict) else None

            results_list = tool_results.get("results") if isinstance(tool_results, dict) else None
            results = results_list if isinstance(results_list, list) else []

            messages = bucket.get("messages")
            if not isinstance(messages, list):
                messages = []

            # Feed tool results back into the model in a provider-agnostic way.
            try:
                results_json = json.dumps({"results": results}, ensure_ascii=False)
            except Exception:
                results_json = str({"results": results})
            messages.append(
                {
                    "role": "user",
                    "content": f"Tool execution results (JSON):\n{results_json}\n\nContinue the task using these results.",
                }
            )

            bucket["messages"] = messages
            tool_round += 1
            bucket["tool_round"] = tool_round

            if tool_round >= max_tool_rounds:
                out = {
                    "result": "Agent exceeded max tool iterations",
                    "task": task,
                    "context": context,
                    "success": False,
                    "error": "max_tool_iterations",
                    "provider": provider,
                    "model": model,
                    "tool_results": results,
                }
                _set_nested(run.vars, f"_temp.effects.{node_id}", out)
                bucket["phase"] = "done"
                flow._node_outputs[node_id] = {"result": out, "scratchpad": _runtime_node_trace(run)}
                run.vars["_last_output"] = {"result": out}
                if next_node:
                    return StepPlan(node_id=node_id, next_node=next_node)
                return StepPlan(node_id=node_id, complete_output={"result": out, "success": False})

            tools_payload = None
            if tools_selected:
                from abstractruntime.integrations.abstractcore.default_tools import filter_tool_specs

                tools_payload = filter_tool_specs(tools_selected)

            bucket["phase"] = "llm"
            return StepPlan(
                node_id=node_id,
                effect=Effect(
                    type=EffectType.LLM_CALL,
                    payload={
                        "messages": messages,
                        "provider": provider,
                        "model": model,
                        "tools": tools_payload,
                        "params": {"temperature": 0.7},
                    },
                    result_key=f"_temp.agent.{node_id}.llm",
                ),
                next_node=node_id,
            )

        if phase == "structured":
            structured_resp = bucket.get("structured")
            if structured_resp is None:
                temp = _ensure_temp_dict(run)
                agent_bucket = temp.get("agent", {}).get(node_id, {}) if isinstance(temp.get("agent"), dict) else {}
                structured_resp = agent_bucket.get("structured") if isinstance(agent_bucket, dict) else None

            data = structured_resp.get("data") if isinstance(structured_resp, dict) else None
            if data is None and isinstance(structured_resp, dict):
                # Best-effort parse: some providers may return JSON in content.
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
            flow._node_outputs[node_id] = {"result": data, "scratchpad": _runtime_node_trace(run)}
            run.vars["_last_output"] = {"result": data}
            if next_node:
                return StepPlan(node_id=node_id, next_node=next_node)
            return StepPlan(node_id=node_id, complete_output={"result": data, "success": True})

        # done / unknown phase
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
    node_outputs = flow._node_outputs
    temp_data = run.vars.get("_temp", {})
    if not isinstance(temp_data, dict):
        return

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
                current["raw"] = raw
                mapped_value = current["response"]
        elif effect_type == "agent":
            current["result"] = raw
            try:
                from abstractruntime.core.vars import get_node_trace as _get_node_trace
            except Exception:  # pragma: no cover
                _get_node_trace = None  # type: ignore[assignment]

            if callable(_get_node_trace):
                current["scratchpad"] = _get_node_trace(run.vars, node_id)
            mapped_value = raw
        elif effect_type == "wait_event":
            current["event_data"] = raw
            mapped_value = raw
        elif effect_type == "wait_until":
            if isinstance(raw, dict):
                current.update(raw)
            else:
                current["result"] = raw
            mapped_value = raw
        elif effect_type == "memory_note":
            span_id = _get_span_id(raw)
            current["note_id"] = span_id
            current["raw"] = raw
            mapped_value = span_id
        elif effect_type == "memory_query":
            if isinstance(raw, dict) and isinstance(raw.get("results"), list):
                current["results"] = raw.get("results")
            else:
                current["results"] = []
            current["raw"] = raw
            mapped_value = current["results"]
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

    def _is_supported_branch_handle(handle: str) -> bool:
        return handle in {"true", "false", "default"} or handle.startswith("case:")

    for node_id in flow.nodes:
        outs = outgoing.get(node_id, [])
        if not outs:
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

    for node_id, flow_node in flow.nodes.items():
        next_node = next_node_map.get(node_id)
        branch_map = branch_maps.get(node_id)
        handler_obj = getattr(flow_node, "handler", None)
        effect_type = getattr(flow_node, "effect_type", None)
        effect_config = getattr(flow_node, "effect_config", None) or {}

        # Check for effect nodes first
        if effect_type == "agent":
            data_aware_handler = handler_obj if callable(handler_obj) else None
            handlers[node_id] = _create_visual_agent_effect_handler(
                node_id=node_id,
                next_node=next_node,
                agent_config=effect_config if isinstance(effect_config, dict) else {},
                data_aware_handler=data_aware_handler,
                flow=flow,
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

    return WorkflowSpec(
        workflow_id=flow.flow_id,
        entry_node=flow.entry_node,
        nodes=handlers,
    )
