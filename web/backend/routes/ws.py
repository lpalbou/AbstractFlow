"""WebSocket routes for real-time execution updates."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import ExecutionEvent, VisualFlow
from ..services.executor import create_visual_runner

router = APIRouter(tags=["websocket"])

# Active WebSocket connections
_connections: Dict[str, WebSocket] = {}

# Active FlowRunners for waiting flows (keyed by connection_id)
_waiting_runners: Dict[str, Any] = {}

# Flow storage reference (shared with flows.py)
from .flows import _flows


@router.websocket("/ws/{flow_id}")
async def websocket_execution(websocket: WebSocket, flow_id: str):
    """WebSocket endpoint for real-time flow execution updates."""
    await websocket.accept()
    connection_id = f"{flow_id}:{id(websocket)}"
    _connections[connection_id] = websocket

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "run":
                # Execute flow with real-time updates
                await execute_with_updates(
                    websocket=websocket,
                    flow_id=flow_id,
                    input_data=message.get("input_data", {}),
                    connection_id=connection_id,
                )
            elif message.get("type") == "resume":
                # Resume a waiting flow with user response
                await resume_waiting_flow(
                    websocket=websocket,
                    connection_id=connection_id,
                    response=message.get("response", ""),
                )
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        if connection_id in _connections:
            del _connections[connection_id]
        if connection_id in _waiting_runners:
            del _waiting_runners[connection_id]


async def execute_with_updates(
    websocket: WebSocket,
    flow_id: str,
    input_data: Dict[str, Any],
    connection_id: str,
) -> None:
    """Execute a flow and send real-time updates via WebSocket."""
    if flow_id not in _flows:
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=f"Flow '{flow_id}' not found",
            ).model_dump()
        )
        return

    visual_flow = _flows[flow_id]

    try:
        runner = create_visual_runner(visual_flow, flows=_flows)

        # Send flow start event
        await websocket.send_json(
            ExecutionEvent(type="flow_start").model_dump()
        )

        # Start execution
        run_id = runner.start(input_data)

        # Execute and handle waiting
        await _execute_runner_loop(websocket, runner, connection_id)

    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )


async def _execute_runner_loop(
    websocket: WebSocket,
    runner: Any,
    connection_id: str,
) -> None:
    """Execute the runner loop with waiting support."""
    # IMPORTANT: UI trace/scratchpad rendering depends on nested fields like
    # `scratchpad.steps[].effect.type/payload` and `scratchpad.steps[].result`.
    # A too-small depth limit collapses these into "…", making traces unreadable.
    #
    # Keep depth moderate but bounded. Strings/lists/dicts are already size-capped.
    _MAX_PREVIEW_DEPTH = 12

    def _preview(value: Any, *, depth: int = 0, max_str_len: Optional[int] = 2000) -> Any:
        """Best-effort JSON-safe preview (size-bounded)."""
        if depth > _MAX_PREVIEW_DEPTH:
            return "…"
        if value is None:
            return None
        if isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, str):
            if max_str_len is None or len(value) <= max_str_len:
                return value
            return value[:max_str_len] + "…"
        if isinstance(value, dict):
            out: Dict[str, Any] = {}
            for i, (k, v) in enumerate(value.items()):
                if i >= 50:
                    out["…"] = f"+{max(0, len(value) - 50)} more"
                    break
                out[str(k)] = _preview(v, depth=depth + 1, max_str_len=max_str_len)
            return out
        if isinstance(value, list):
            items = value[:50]
            out_list = [_preview(v, depth=depth + 1, max_str_len=max_str_len) for v in items]
            if len(value) > 50:
                out_list.append(f"… +{len(value) - 50} more")
            return out_list
        return str(value)

    def _node_effect_type(node_id: str) -> Optional[str]:
        try:
            node = runner.flow.nodes.get(node_id) if hasattr(runner, "flow") and hasattr(runner.flow, "nodes") else None
        except Exception:
            node = None
        if node is None:
            return None
        t = getattr(node, "effect_type", None)
        return str(t) if isinstance(t, str) else None

    def _node_output(node_id: str) -> Any:
        if hasattr(runner, "flow") and hasattr(runner.flow, "_node_outputs"):
            outputs = getattr(runner.flow, "_node_outputs")
            if isinstance(outputs, dict) and node_id in outputs:
                raw = outputs.get(node_id)
                # Avoid shipping the full nested `node_traces` blob over WS; the UI
                # uses the flattened `scratchpad.steps` list for rendering.
                if isinstance(raw, dict):
                    scratchpad = raw.get("scratchpad")
                    if isinstance(scratchpad, dict) and "node_traces" in scratchpad:
                        scratchpad_copy = dict(scratchpad)
                        scratchpad_copy.pop("node_traces", None)
                        raw_copy = dict(raw)
                        raw_copy["scratchpad"] = scratchpad_copy
                        raw = raw_copy
                effect_type = _node_effect_type(node_id)

                # Never truncate user-visible message content.
                if effect_type in {"ask_user", "answer_user", "llm_call"}:
                    return _preview(raw, max_str_len=None)

                # Agent node: keep preview size-bounded but never truncate the final answer.
                if effect_type == "agent":
                    previewed = _preview(raw)
                    try:
                        if (
                            isinstance(raw, dict)
                            and isinstance(previewed, dict)
                            and isinstance(raw.get("result"), dict)
                            and isinstance(previewed.get("result"), dict)
                        ):
                            raw_answer = raw["result"].get("result")
                            if isinstance(raw_answer, str):
                                previewed["result"]["result"] = raw_answer
                    except Exception:
                        pass
                    return previewed

                return _preview(raw)
        # Fallback for non-visual flows
        state = runner.get_state() if hasattr(runner, "get_state") else None
        if state and hasattr(state, "vars") and isinstance(state.vars, dict):
            return _preview(state.vars.get("_last_output"))
        return None

    def _extract_sub_run_id(wait: Any) -> Optional[str]:
        details = getattr(wait, "details", None)
        if isinstance(details, dict):
            sub_run_id = details.get("sub_run_id")
            if isinstance(sub_run_id, str) and sub_run_id:
                return sub_run_id
        wait_key = getattr(wait, "wait_key", None)
        if isinstance(wait_key, str) and wait_key.startswith("subworkflow:"):
            return wait_key.split("subworkflow:", 1)[1] or None
        return None

    def _resolve_waiting_info(state: Any) -> Tuple[str, list, bool, Optional[str], Optional[str]]:
        """Return (prompt, choices, allow_free_text, wait_key, reason)."""
        wait = getattr(state, "waiting", None)
        if wait is None:
            return ("Please respond:", [], True, None, None)

        reason = getattr(wait, "reason", None)
        reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None

        if reason_value != "subworkflow":
            prompt = getattr(wait, "prompt", None) or "Please respond:"
            choices = list(getattr(wait, "choices", []) or [])
            allow_free_text = bool(getattr(wait, "allow_free_text", True))
            wait_key = getattr(wait, "wait_key", None)
            return (prompt, choices, allow_free_text, wait_key, reason_value)

        # Bubble up the deepest waiting child so the UI can render ASK_USER prompts.
        runtime = getattr(runner, "runtime", None)
        if runtime is None:
            return ("Waiting for subworkflow…", [], True, getattr(wait, "wait_key", None), reason_value)

        sub_run_id = _extract_sub_run_id(wait)
        if not sub_run_id:
            return ("Waiting for subworkflow…", [], True, getattr(wait, "wait_key", None), reason_value)

        current_run_id = sub_run_id
        for _ in range(25):
            sub_state = runtime.get_state(current_run_id)
            sub_wait = getattr(sub_state, "waiting", None)
            if sub_wait is None:
                break
            sub_reason = getattr(sub_wait, "reason", None)
            sub_reason_value = (
                sub_reason.value if hasattr(sub_reason, "value") else str(sub_reason) if sub_reason else None
            )
            if sub_reason_value == "subworkflow":
                next_id = _extract_sub_run_id(sub_wait)
                if not next_id:
                    break
                current_run_id = next_id
                continue

            prompt = getattr(sub_wait, "prompt", None) or "Please respond:"
            choices = list(getattr(sub_wait, "choices", []) or [])
            allow_free_text = bool(getattr(sub_wait, "allow_free_text", True))
            wait_key = getattr(sub_wait, "wait_key", None)
            return (prompt, choices, allow_free_text, wait_key, sub_reason_value)

        return ("Waiting for subworkflow…", [], True, getattr(wait, "wait_key", None), reason_value)

    def _is_agent_node(node_id: str) -> bool:
        try:
            node = runner.flow.nodes.get(node_id) if hasattr(runner, "flow") and hasattr(runner.flow, "nodes") else None
        except Exception:
            node = None
        return bool(node is not None and getattr(node, "effect_type", None) == "agent")

    def _agent_phase(state_vars: Any, node_id: str) -> str:
        if not isinstance(state_vars, dict):
            return ""
        temp = state_vars.get("_temp")
        if not isinstance(temp, dict):
            return ""
        agent_ns = temp.get("agent")
        if not isinstance(agent_ns, dict):
            return ""
        bucket = agent_ns.get(node_id)
        if not isinstance(bucket, dict):
            return ""
        phase = bucket.get("phase")
        return str(phase) if phase is not None else ""

    # Track the currently "open" node step so we don't emit misleading `node_complete`
    # events for multi-tick nodes (e.g., Agent nodes that self-loop across phases).
    active_node_id: Optional[str] = None

    # Best-effort aggregate metrics (active time + token usage).
    total_duration_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    token_duration_ms: float = 0.0

    def _extract_usage_tokens(usage_raw: Any) -> Tuple[Optional[int], Optional[int]]:
        """Return (input_tokens, output_tokens) from a usage object (best-effort)."""
        if not isinstance(usage_raw, dict):
            return (None, None)
        usage = usage_raw

        def _as_int(v: Any) -> Optional[int]:
            try:
                n = int(v)
                return n if n >= 0 else None
            except Exception:
                return None

        input_tokens = _as_int(usage.get("prompt_tokens"))
        if input_tokens is None:
            input_tokens = _as_int(usage.get("input_tokens"))

        output_tokens = _as_int(usage.get("completion_tokens"))
        if output_tokens is None:
            output_tokens = _as_int(usage.get("output_tokens"))

        return (input_tokens, output_tokens)

    def _node_metrics(node_id: str, *, duration_ms: float) -> Dict[str, Any]:
        """Compute per-node metrics for UI badges (best-effort, JSON-safe)."""
        metrics: Dict[str, Any] = {"duration_ms": round(float(duration_ms), 2)}

        effect_type = _node_effect_type(node_id)
        if not effect_type:
            return metrics

        # Pull raw (non-preview) output so we can parse usage tokens.
        raw_out: Any = None
        if hasattr(runner, "flow") and hasattr(runner.flow, "_node_outputs"):
            outputs = getattr(runner.flow, "_node_outputs")
            if isinstance(outputs, dict):
                raw_out = outputs.get(node_id)

        input_tokens: Optional[int] = None
        output_tokens: Optional[int] = None

        if effect_type == "llm_call":
            if isinstance(raw_out, dict):
                raw_llm = raw_out.get("raw")
                if isinstance(raw_llm, dict):
                    usage = raw_llm.get("usage")
                else:
                    usage = raw_out.get("usage")
                input_tokens, output_tokens = _extract_usage_tokens(usage)

        elif effect_type == "agent":
            # Agent node: aggregate usage across its runtime-owned scratchpad steps.
            if isinstance(raw_out, dict):
                scratchpad = raw_out.get("scratchpad")
                steps = scratchpad.get("steps") if isinstance(scratchpad, dict) else None
                if isinstance(steps, list):
                    in_sum = 0
                    out_sum = 0
                    has_any = False
                    for s in steps:
                        if not isinstance(s, dict):
                            continue
                        effect = s.get("effect")
                        if not isinstance(effect, dict):
                            continue
                        if effect.get("type") != "llm_call":
                            continue
                        result = s.get("result")
                        usage = result.get("usage") if isinstance(result, dict) else None
                        i, o = _extract_usage_tokens(usage if isinstance(usage, dict) else None)
                        if i is not None:
                            in_sum += i
                            has_any = True
                        if o is not None:
                            out_sum += o
                            has_any = True
                    if has_any:
                        input_tokens = in_sum
                        output_tokens = out_sum

        if input_tokens is not None:
            metrics["input_tokens"] = int(input_tokens)
        if output_tokens is not None:
            metrics["output_tokens"] = int(output_tokens)
        if output_tokens is not None and duration_ms > 0:
            metrics["tokens_per_s"] = round(float(output_tokens) / (float(duration_ms) / 1000.0), 2)

        return metrics

    while True:
        # Capture node BEFORE stepping so events refer to the node being executed.
        before = runner.get_state()
        node_before = before.current_node if before else None

        # Emit node_start only when we enter a new node (keeps a single running
        # timeline entry for nodes that require multiple runtime ticks).
        if node_before and node_before != active_node_id:
            await websocket.send_json(
                ExecutionEvent(
                    type="node_start",
                    nodeId=node_before,
                ).model_dump()
            )
            active_node_id = node_before
            # Yield once so the client can render the new "running" item before
            # we perform any potentially long-running work in the tick.
            await asyncio.sleep(0)

        # IMPORTANT: FlowRunner.step() can block for a long time when running a
        # subworkflow synchronously (e.g., Agent nodes that execute LLM calls and tools).
        # Run it in a thread so the event loop can keep the websocket responsive.
        t0 = time.perf_counter()
        state = await asyncio.to_thread(runner.step)
        duration_ms = (time.perf_counter() - t0) * 1000.0

        # IMPORTANT: Sync effect outcomes into `flow._node_outputs` immediately after the tick.
        #
        # Without this, effect nodes (notably LLM_CALL) will still show the pre-effect
        # placeholder output (e.g. `{"response": null, "_pending_effect": ...}`) at the moment
        # we emit `node_complete`, which also prevents token/usage extraction for metrics.
        try:
            from abstractflow.compiler import _sync_effect_results_to_node_outputs as _sync_effect_results  # type: ignore

            if hasattr(runner, "flow"):
                _sync_effect_results(state, runner.flow)
        except Exception:
            pass

        # Check if waiting
        if runner.is_waiting():
            wait = getattr(state, "waiting", None)
            reason = getattr(wait, "reason", None) if wait is not None else None
            reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None

            # WAIT_UNTIL (Delay node) is time-based and should not require user input.
            # Keep the websocket loop running; sleep until the target time then continue ticking.
            if reason_value == "until":
                until_raw = getattr(wait, "until", None) if wait is not None else None
                try:
                    from datetime import datetime, timezone

                    until = datetime.fromisoformat(str(until_raw))
                    now = datetime.now(timezone.utc)
                    remaining_s = (until - now).total_seconds()
                    # Poll at a small cadence to keep the UI responsive without spamming events.
                    sleep_s = min(max(remaining_s, 0.05), 0.25)
                except Exception:
                    sleep_s = 0.2

                await asyncio.sleep(float(sleep_s))
                continue

            # All other waiting reasons require an external resume signal.
            _waiting_runners[connection_id] = runner

            prompt, choices, allow_free_text, wait_key, reason = _resolve_waiting_info(state)
            await websocket.send_json(
                {
                    "type": "flow_waiting",
                    "nodeId": node_before or state.current_node,
                    "wait_key": wait_key,
                    "reason": reason,
                    "prompt": prompt,
                    "choices": choices,
                    "allow_free_text": allow_free_text,
                }
            )
            break

        # Completed step: emit node_complete for the node we just executed, but only
        # when the node is "logically complete" for the visual timeline.
        #
        # Agent nodes are implemented as a small internal state machine (phase=init/subworkflow/structured/done)
        # and self-loop across ticks. Emitting node_complete on every tick produces confusing UI:
        # a completed step whose payload says `{status:"running"}`.
        if active_node_id:
            should_close = True
            if _is_agent_node(active_node_id):
                phase = _agent_phase(getattr(state, "vars", None), active_node_id)
                # Close only when done (or if the run is no longer running, e.g. completed/failed).
                if phase != "done" and not runner.is_complete() and not runner.is_failed():
                    should_close = False

            if should_close:
                meta = _node_metrics(active_node_id, duration_ms=duration_ms)
                try:
                    total_duration_ms += float(duration_ms)
                except Exception:
                    pass
                try:
                    if isinstance(meta.get("input_tokens"), int):
                        total_input_tokens += int(meta.get("input_tokens") or 0)
                    if isinstance(meta.get("output_tokens"), int):
                        total_output_tokens += int(meta.get("output_tokens") or 0)
                        if duration_ms > 0:
                            token_duration_ms += float(duration_ms)
                except Exception:
                    pass

                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        nodeId=active_node_id,
                        result=_node_output(active_node_id),
                        meta=meta,
                    ).model_dump()
                )
                active_node_id = None

        # Check if complete
        if runner.is_complete():
            # Clean up waiting runner if exists
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]

            summary: Dict[str, Any] = {
                "duration_ms": round(float(total_duration_ms), 2),
                "input_tokens": int(total_input_tokens),
                "output_tokens": int(total_output_tokens),
            }
            # Throughput is meaningful only over steps that actually produced tokens.
            if total_output_tokens > 0 and token_duration_ms > 0:
                summary["tokens_per_s"] = round(float(total_output_tokens) / (float(token_duration_ms) / 1000.0), 2)

            await websocket.send_json(
                ExecutionEvent(
                    type="flow_complete",
                    result=state.output,
                    meta=summary,
                ).model_dump()
            )
            break

        # Check if failed
        if runner.is_failed():
            # Clean up waiting runner if exists
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]

            error_node = None
            if hasattr(state, "vars") and isinstance(state.vars, dict):
                error_node = state.vars.get("_flow_error_node")
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_error",
                    nodeId=error_node,
                    error=state.error,
                ).model_dump()
            )
            break

        # Small delay to avoid overwhelming the WebSocket
        await asyncio.sleep(0.01)


async def resume_waiting_flow(
    websocket: WebSocket,
    connection_id: str,
    response: str,
) -> None:
    """Resume a waiting flow with the user's response."""
    if connection_id not in _waiting_runners:
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error="No waiting flow to resume",
            ).model_dump()
        )
        return

    runner = _waiting_runners[connection_id]

    try:
        state = runner.get_state()
        wait = state.waiting if state else None
        reason = wait.reason.value if wait and hasattr(wait, "reason") else None

        if reason != "subworkflow":
            # Resume with the user's response
            runner.resume(payload={"response": response}, max_steps=0)
            await _execute_runner_loop(websocket, runner, connection_id)
            return

        runtime = getattr(runner, "runtime", None)
        registry = getattr(runtime, "workflow_registry", None) if runtime else None
        if runtime is None or registry is None:
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_error",
                    error="Subworkflow resume requires runner runtime + workflow registry",
                ).model_dump()
            )
            return

        # Resume the deepest waiting child, then bubble completion back up to the parent.
        from abstractruntime.core.models import RunStatus, WaitReason

        def _spec_for(run_state: Any):
            spec = registry.get(run_state.workflow_id)
            if spec is None:
                raise RuntimeError(f"Workflow '{run_state.workflow_id}' not found in registry")
            return spec

        def _extract_sub_run_id_from_wait(wait_state: Any) -> Optional[str]:
            details = getattr(wait_state, "details", None)
            if isinstance(details, dict):
                sub_run_id = details.get("sub_run_id")
                if isinstance(sub_run_id, str) and sub_run_id:
                    return sub_run_id
            wait_key = getattr(wait_state, "wait_key", None)
            if isinstance(wait_key, str) and wait_key.startswith("subworkflow:"):
                return wait_key.split("subworkflow:", 1)[1] or None
            return None

        top_run_id = runner.run_id
        if not top_run_id:
            raise RuntimeError("No active run_id for runner")

        # Find deepest waiting run in subworkflow chain.
        target_run_id = top_run_id
        for _ in range(25):
            current = runtime.get_state(target_run_id)
            if current.status != RunStatus.WAITING or current.waiting is None:
                break
            if current.waiting.reason != WaitReason.SUBWORKFLOW:
                break
            next_id = _extract_sub_run_id_from_wait(current.waiting)
            if not next_id:
                break
            target_run_id = next_id

        target_state = runtime.get_state(target_run_id)
        runtime.resume(
            workflow=_spec_for(target_state),
            run_id=target_run_id,
            wait_key=None,
            payload={"response": response},
            max_steps=0,
        )

        # Drive child runs until they wait again or complete, bubbling completion up.
        current_run_id = target_run_id
        for _ in range(50):
            current_state = runtime.get_state(current_run_id)
            if current_state.status == RunStatus.RUNNING:
                current_state = runtime.tick(workflow=_spec_for(current_state), run_id=current_run_id, max_steps=100)

            if current_state.status == RunStatus.WAITING:
                break

            if current_state.status == RunStatus.FAILED:
                raise RuntimeError(current_state.error or "Subworkflow failed")

            if current_state.status != RunStatus.COMPLETED:
                raise RuntimeError(f"Unexpected subworkflow status: {current_state.status.value}")

            parent_id = current_state.parent_run_id
            if not parent_id:
                break

            parent_state = runtime.get_state(parent_id)
            if parent_state.status != RunStatus.WAITING or parent_state.waiting is None:
                break
            if parent_state.waiting.reason != WaitReason.SUBWORKFLOW:
                break

            runtime.resume(
                workflow=_spec_for(parent_state),
                run_id=parent_id,
                wait_key=None,
                payload={
                    "sub_run_id": current_state.run_id,
                    "output": current_state.output,
                    "node_traces": runtime.get_node_traces(current_state.run_id),
                },
                max_steps=0,
            )

            if parent_id == top_run_id:
                break
            current_run_id = parent_id

        # Top-level may still be waiting (child asked again) or ready to run.
        if runner.is_waiting():
            top_state = runner.get_state()
            top_wait = top_state.waiting if top_state else None

            prompt = "Please respond:"
            choices: list = []
            allow_free_text = True
            wait_key = top_wait.wait_key if top_wait else None
            reason = top_wait.reason.value if top_wait and hasattr(top_wait, "reason") else None

            if top_wait and top_wait.reason == WaitReason.SUBWORKFLOW:
                sub_run_id = _extract_sub_run_id_from_wait(top_wait)
                current_run_id = sub_run_id
                for _ in range(25):
                    if not current_run_id:
                        break
                    sub_state = runtime.get_state(current_run_id)
                    sub_wait = sub_state.waiting
                    if sub_wait is None:
                        break
                    if sub_wait.reason == WaitReason.SUBWORKFLOW:
                        current_run_id = _extract_sub_run_id_from_wait(sub_wait)
                        continue
                    prompt = sub_wait.prompt or "Please respond:"
                    choices = list(sub_wait.choices) if isinstance(sub_wait.choices, list) else []
                    allow_free_text = bool(sub_wait.allow_free_text)
                    wait_key = sub_wait.wait_key
                    reason = sub_wait.reason.value
                    break
            elif top_wait is not None:
                prompt = top_wait.prompt or "Please respond:"
                choices = list(top_wait.choices) if isinstance(top_wait.choices, list) else []
                allow_free_text = bool(top_wait.allow_free_text)

            await websocket.send_json(
                {
                    "type": "flow_waiting",
                    "nodeId": top_state.current_node if top_state else None,
                    "wait_key": wait_key,
                    "reason": reason,
                    "prompt": prompt,
                    "choices": choices,
                    "allow_free_text": allow_free_text,
                }
            )
            return

        await _execute_runner_loop(websocket, runner, connection_id)

    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )
