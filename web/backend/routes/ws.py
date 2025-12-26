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

# Waiting step context so we can correctly close the waiting node on resume.
# Without this, flows that resume to a different node (ASK_USER, START_SUBWORKFLOW)
# would leave the original node permanently in WAITING in the UI.
_waiting_steps: Dict[str, Dict[str, Any]] = {}

# Flow storage reference (shared with flows.py)
from .flows import _flows

# IMPORTANT: UI trace/scratchpad rendering depends on nested fields like
# `scratchpad.steps[].effect.type/payload` and `scratchpad.steps[].result`.
# A too-small depth limit collapses these into "…", making traces unreadable.
#
# Keep depth bounded to avoid pathological recursion. We do not truncate
# normal user-visible outputs (no string/list/dict caps).
_MAX_JSON_DEPTH = 64


def _json_safe(value: Any, *, depth: int = 0, seen: Optional[set[int]] = None) -> Any:
    """Best-effort JSON-safe conversion (no truncation)."""
    if depth > _MAX_JSON_DEPTH:
        return str(value)

    if value is None or isinstance(value, (bool, int, float, str)):
        return value

    if seen is None:
        seen = set()
    try:
        vid = id(value)
        if vid in seen:
            return "<cycle>"
        seen.add(vid)
    except Exception:
        pass

    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for k, v in value.items():
            out[str(k)] = _json_safe(v, depth=depth + 1, seen=seen)
        return out

    if isinstance(value, (list, tuple)):
        return [_json_safe(v, depth=depth + 1, seen=seen) for v in list(value)]

    # Pydantic models / dataclasses (best-effort).
    try:
        if hasattr(value, "model_dump") and callable(getattr(value, "model_dump")):
            return _json_safe(value.model_dump(), depth=depth + 1, seen=seen)  # type: ignore[no-any-return]
    except Exception:
        pass

    return str(value)


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
    flow_started_at = time.perf_counter()

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
                return _json_safe(raw)
        # Fallback for non-visual flows
        state = runner.get_state() if hasattr(runner, "get_state") else None
        if state and hasattr(state, "vars") and isinstance(state.vars, dict):
            return _json_safe(state.vars.get("_last_output"))
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

    runtime = getattr(runner, "runtime", None)

    # Backward-compat / test support:
    # Some tests patch `create_visual_runner()` with a minimal fake runner that does not
    # expose a Runtime. In that case, fall back to the legacy single-run loop.
    if runtime is None:
        active_node_id: Optional[str] = None
        while True:
            before = runner.get_state() if hasattr(runner, "get_state") else None
            node_before = getattr(before, "current_node", None) if before is not None else None

            if node_before and node_before != active_node_id:
                await websocket.send_json(ExecutionEvent(type="node_start", nodeId=node_before).model_dump())
                active_node_id = node_before
                await asyncio.sleep(0)

            t0 = time.perf_counter()
            # NOTE: This branch exists primarily for tests that patch `create_visual_runner()`
            # with a minimal fake runner (no Runtime). Running `runner.step()` directly keeps
            # the control flow deterministic and avoids relying on thread executors.
            state = runner.step()
            duration_ms = (time.perf_counter() - t0) * 1000.0

            if hasattr(runner, "is_waiting") and runner.is_waiting():
                _waiting_runners[connection_id] = runner
                _waiting_steps[connection_id] = {
                    "node_id": node_before or getattr(state, "current_node", None),
                    "started_at": time.perf_counter(),
                }
                prompt, choices, allow_free_text, wait_key, reason = _resolve_waiting_info(state)
                await websocket.send_json(
                    {
                        "type": "flow_waiting",
                        "nodeId": node_before or getattr(state, "current_node", None),
                        "wait_key": wait_key,
                        "reason": reason,
                        "prompt": prompt,
                        "choices": choices,
                        "allow_free_text": allow_free_text,
                    }
                )
                break

            if active_node_id:
                should_close = True
                if _is_agent_node(active_node_id):
                    phase = _agent_phase(getattr(state, "vars", None), active_node_id)
                    if phase != "done" and not getattr(runner, "is_complete", lambda: False)() and not getattr(
                        runner, "is_failed", lambda: False
                    )():
                        should_close = False

                if should_close:
                    await websocket.send_json(
                        ExecutionEvent(
                            type="node_complete",
                            nodeId=active_node_id,
                            result=_node_output(active_node_id),
                                meta={"duration_ms": round(float(duration_ms), 2)},
                        ).model_dump()
                    )
                    active_node_id = None

            if hasattr(runner, "is_complete") and runner.is_complete():
                flow_duration_ms = (time.perf_counter() - flow_started_at) * 1000.0
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_complete",
                        result=getattr(state, "output", None),
                        meta={"duration_ms": round(float(flow_duration_ms), 2)},
                    ).model_dump()
                )
                break

            if hasattr(runner, "is_failed") and runner.is_failed():
                error_node = None
                if hasattr(state, "vars") and isinstance(state.vars, dict):
                    error_node = state.vars.get("_flow_error_node")
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_error",
                        nodeId=error_node,
                        error=getattr(state, "error", None),
                    ).model_dump()
                )
                break

            await asyncio.sleep(0.01)

        return

    # Track "open" node steps per run_id so we can support session-level execution
    # (root run + event listener runs) without losing UX semantics (Delay/event waits).
    run_tracks: Dict[str, Dict[str, Any]] = {}

    def _track(run_id: str) -> Dict[str, Any]:
        t = run_tracks.get(run_id)
        if not isinstance(t, dict):
            t = {
                "active_node_id": None,
                "active_duration_ms": 0.0,
                "wait_until_started_at": None,
                "wait_until_node_id": None,
                "wait_event_started_at": None,
                "wait_event_node_id": None,
            }
            run_tracks[run_id] = t
        return t

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

    def _node_metrics(node_id: str, *, duration_ms: float, output: Any) -> Dict[str, Any]:
        """Compute per-node metrics for UI badges (best-effort, JSON-safe)."""
        metrics: Dict[str, Any] = {"duration_ms": round(float(duration_ms), 2)}

        effect_type = _node_effect_type(node_id)
        if not effect_type:
            return metrics

        input_tokens: Optional[int] = None
        output_tokens: Optional[int] = None

        if effect_type == "llm_call":
            usage = None
            if isinstance(output, dict):
                raw = output.get("raw")
                if isinstance(raw, dict):
                    usage = raw.get("usage")
                if usage is None:
                    usage = output.get("usage")
            input_tokens, output_tokens = _extract_usage_tokens(usage if isinstance(usage, dict) else None)

        elif effect_type == "agent":
            scratchpad = output.get("scratchpad") if isinstance(output, dict) else None
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

    root_run_id = getattr(runner, "run_id", None)
    if not isinstance(root_run_id, str) or not root_run_id:
        return

    # Helper: get a durable output for a node from a given RunState (works for listener runs).
    def _run_node_output(state: Any, node_id: str) -> Any:
        if state is None or not hasattr(state, "vars") or not isinstance(state.vars, dict):
            return None
        temp = state.vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}

        def _agent_scratchpad() -> Any:
            agent_ns = temp.get("agent")
            if not isinstance(agent_ns, dict):
                return None
            bucket = agent_ns.get(node_id)
            if not isinstance(bucket, dict):
                return None
            return bucket.get("scratchpad")

        effects = temp.get("effects")
        if isinstance(effects, dict) and node_id in effects:
            raw = effects.get(node_id)
            effect_type = _node_effect_type(node_id)

            # Normalize child-run outputs to match root visual node outputs where possible.
            if effect_type == "llm_call":
                if isinstance(raw, dict):
                    return _json_safe({"response": raw.get("content"), "raw": raw})
                return _json_safe({"response": raw, "raw": raw})

            if effect_type == "agent":
                scratchpad = _agent_scratchpad()
                if scratchpad is not None:
                    return _json_safe({"result": raw, "scratchpad": scratchpad})
                return _json_safe(raw)

            return _json_safe(raw)
        node_outputs = temp.get("node_outputs")
        if isinstance(node_outputs, dict) and node_id in node_outputs:
            return _json_safe(node_outputs.get(node_id))
        last = state.vars.get("_last_output")
        return _json_safe(last)

    def _workflow_for_run_id(run_id: str) -> Any:
        if runtime is None:
            raise RuntimeError("Runtime missing on runner")
        st = runtime.get_state(run_id)
        if getattr(st, "workflow_id", None) == getattr(runner, "workflow", None).workflow_id:  # type: ignore[attr-defined]
            return runner.workflow
        reg = getattr(runtime, "workflow_registry", None)
        if reg is None:
            raise RuntimeError("workflow_registry missing on runtime (required for event listeners)")
        spec = reg.get(getattr(st, "workflow_id", None))
        if spec is None:
            raise RuntimeError(f"Workflow '{getattr(st, 'workflow_id', None)}' not found in registry")
        return spec

    async def _tick_run(run_id: str, *, is_root: bool) -> Optional[Any]:
        """Tick a run by at most one step and emit node_start/node_complete for it.

        Returns the updated state (or None if unchanged).
        """
        nonlocal total_duration_ms, total_input_tokens, total_output_tokens, token_duration_ms
        if runtime is None:
            return None
        track = _track(run_id)

        before = runtime.get_state(run_id)
        node_before = getattr(before, "current_node", None)

        # Blueprint-style UX: event listeners should not appear as a "running step"
        # while they are *waiting* for an EVENT. Keep them silent until they are
        # actually triggered (resumed by EMIT_EVENT).
        if not is_root and str(getattr(before, "status", None)) == "RunStatus.WAITING":
            w0 = getattr(before, "waiting", None)
            r0 = getattr(w0, "reason", None) if w0 is not None else None
            rv0 = r0.value if hasattr(r0, "value") else str(r0) if r0 else None
            if rv0 == "event":
                if isinstance(node_before, str) and node_before:
                    if track.get("wait_event_started_at") is None or track.get("wait_event_node_id") != node_before:
                        track["wait_event_started_at"] = time.perf_counter()
                        track["wait_event_node_id"] = node_before
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0
                return None

        # Close EVENT waits for non-root runs when they get resumed (wait is over).
        if (
            isinstance(track.get("wait_event_node_id"), str)
            and track.get("wait_event_node_id")
            and str(getattr(before, "status", None)) != "RunStatus.WAITING"
        ):
            wnode = str(track.get("wait_event_node_id"))
            started_at = track.get("wait_event_started_at")
            waited_ms = 0.0
            if isinstance(started_at, (int, float)):
                waited_ms = (time.perf_counter() - float(started_at)) * 1000.0
            # Emit start+complete at the moment the event is delivered (Blueprint-style).
            await websocket.send_json(
                ExecutionEvent(
                    type="node_start",
                    nodeId=wnode,
                ).model_dump()
            )
            out0 = _run_node_output(before, wnode)
            await websocket.send_json(
                ExecutionEvent(
                    type="node_complete",
                    nodeId=wnode,
                    result=out0,
                    meta=_node_metrics(wnode, duration_ms=waited_ms, output=out0),
                ).model_dump()
            )
            track["wait_event_node_id"] = None
            track["wait_event_started_at"] = None
            track["active_node_id"] = None
            track["active_duration_ms"] = 0.0

        # Terminal runs: avoid re-emitting node_start/node_complete on every loop
        # iteration while we keep the WS open to drive child runs.
        if str(getattr(before, "status", None)) in {"RunStatus.COMPLETED", "RunStatus.FAILED", "RunStatus.CANCELLED"}:
            track["active_node_id"] = None
            track["active_duration_ms"] = 0.0
            return None

        # Special-case WAIT_UNTIL (Delay): handle time-based waits without user prompts.
        wait0 = getattr(before, "waiting", None)
        if str(getattr(before, "status", None)) == "RunStatus.WAITING":
            reason0 = getattr(wait0, "reason", None) if wait0 is not None else None
            reason_value0 = reason0.value if hasattr(reason0, "value") else str(reason0) if reason0 else None
            if reason_value0 == "until":
                if track.get("wait_until_started_at") is None or track.get("wait_until_node_id") != node_before:
                    track["wait_until_started_at"] = time.perf_counter()
                    track["wait_until_node_id"] = node_before

                until_raw = getattr(wait0, "until", None) if wait0 is not None else None
                remaining_s = 0.2
                try:
                    from datetime import datetime, timezone

                    until = datetime.fromisoformat(str(until_raw))
                    now = datetime.now(timezone.utc)
                    remaining_s = (until - now).total_seconds()
                except Exception:
                    remaining_s = 0.2

                if remaining_s > 0:
                    await asyncio.sleep(float(min(max(remaining_s, 0.05), 0.25)))
                    return None

                # Time elapsed: resume to next node, but do not execute it yet.
                wf = _workflow_for_run_id(run_id)
                resume_payload: Dict[str, Any] = {}
                try:
                    from datetime import datetime, timezone

                    if _node_effect_type(str(node_before)) == "on_schedule":
                        resume_payload = {"timestamp": datetime.now(timezone.utc).isoformat()}
                        if until_raw is not None:
                            resume_payload["scheduled_for"] = str(until_raw)
                except Exception:
                    resume_payload = {}

                await asyncio.to_thread(
                    runtime.resume,
                    workflow=wf,
                    run_id=run_id,
                    wait_key=None,
                    payload=resume_payload,
                    max_steps=0,
                )
                after_resume = runtime.get_state(run_id)

                # Close Delay node step now (the wait is finished).
                active = track.get("active_node_id")
                if isinstance(active, str) and active:
                    if is_root:
                        # Ensure root flow outputs reflect the resumed effect payload.
                        try:
                            from abstractflow.compiler import _sync_effect_results_to_node_outputs as _sync_effect_results  # type: ignore

                            if hasattr(runner, "flow"):
                                _sync_effect_results(after_resume, runner.flow)
                        except Exception:
                            pass

                    waited_ms = 0.0
                    started = track.get("wait_until_started_at")
                    if isinstance(started, (int, float)):
                        waited_ms = (time.perf_counter() - float(started)) * 1000.0
                    out0 = _run_node_output(after_resume, active) if not is_root else _node_output(active)
                    await websocket.send_json(
                        ExecutionEvent(
                            type="node_complete",
                            nodeId=active,
                            result=out0,
                            meta=_node_metrics(active, duration_ms=waited_ms, output=out0),
                        ).model_dump()
                    )
                    track["active_node_id"] = None
                    track["active_duration_ms"] = 0.0
                track["wait_until_started_at"] = None
                track["wait_until_node_id"] = None
                return after_resume

        # Listener workflow entrypoints (On Event): transitioning into WAITING EVENT
        # must be silent, otherwise the UI shows the listener as "RUNNING" while it
        # is merely subscribed.
        if (
            not is_root
            and str(getattr(before, "status", None)) == "RunStatus.RUNNING"
            and isinstance(getattr(before, "workflow_id", None), str)
            and str(getattr(before, "workflow_id", None)).startswith("visual_event_listener_")
            and isinstance(node_before, str)
            and node_before
        ):
            try:
                wf = _workflow_for_run_id(run_id)
                entry = getattr(wf, "entry_node", None)
            except Exception:
                wf = None
                entry = None

            if wf is not None and isinstance(entry, str) and entry == node_before:
                state = await asyncio.to_thread(runtime.tick, workflow=wf, run_id=run_id, max_steps=1)

                if str(getattr(state, "status", None)) == "RunStatus.WAITING":
                    w = getattr(state, "waiting", None)
                    reason = getattr(w, "reason", None) if w is not None else None
                    reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None
                    if reason_value == "event":
                        track["wait_event_started_at"] = time.perf_counter()
                        track["wait_event_node_id"] = node_before
                        track["active_node_id"] = None
                        track["active_duration_ms"] = 0.0
                        return state

                # Fall back to normal processing if the listener entrypoint didn't wait.
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0

        # Emit node_start when we enter a new node (per-run).
        if isinstance(node_before, str) and node_before and node_before != track.get("active_node_id"):
            await websocket.send_json(
                ExecutionEvent(
                    type="node_start",
                    nodeId=node_before,
                ).model_dump()
            )
            track["active_node_id"] = node_before
            track["active_duration_ms"] = 0.0
            await asyncio.sleep(0)

        # Tick one step
        t0 = time.perf_counter()
        if is_root:
            state = await asyncio.to_thread(runner.step)
        else:
            wf = _workflow_for_run_id(run_id)
            state = await asyncio.to_thread(runtime.tick, workflow=wf, run_id=run_id, max_steps=1)
        duration_ms = (time.perf_counter() - t0) * 1000.0

        if is_root:
            # Keep root flow outputs in sync for rich previews and metrics.
            try:
                from abstractflow.compiler import _sync_effect_results_to_node_outputs as _sync_effect_results  # type: ignore
                if hasattr(runner, "flow"):
                    _sync_effect_results(state, runner.flow)
            except Exception:
                pass

        # Accumulate wall time per node while it stays "open" (multi-tick nodes like Agent).
        active = track.get("active_node_id")
        if isinstance(active, str) and active:
            try:
                track["active_duration_ms"] = float(track.get("active_duration_ms") or 0.0) + float(duration_ms)
            except Exception:
                track["active_duration_ms"] = float(duration_ms)

        # Waiting
        if str(getattr(state, "status", None)) == "RunStatus.WAITING":
            wait = getattr(state, "waiting", None)
            reason = getattr(wait, "reason", None) if wait is not None else None
            reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None

            if reason_value == "until":
                if track.get("wait_until_started_at") is None or track.get("wait_until_node_id") != track.get("active_node_id"):
                    track["wait_until_started_at"] = time.perf_counter()
                    track["wait_until_node_id"] = track.get("active_node_id")
                return state

            if reason_value == "event" and not is_root:
                # Listener waits are silent; we close the step when the event resumes.
                if isinstance(node_before, str) and node_before:
                    if track.get("wait_event_started_at") is None or track.get("wait_event_node_id") != node_before:
                        track["wait_event_started_at"] = time.perf_counter()
                        track["wait_event_node_id"] = node_before
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0
                return state

            # Root waits (or non-event waits) are surfaced to the UI.
            if is_root:
                _waiting_runners[connection_id] = runner
                _waiting_steps[connection_id] = {
                    "node_id": node_before or getattr(state, "current_node", None),
                    "started_at": time.perf_counter(),
                }
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
            return state

        # Completed step: emit node_complete for the node we just executed.
        active = track.get("active_node_id")
        if isinstance(active, str) and active:
            should_close = True
            if _is_agent_node(active):
                phase = _agent_phase(getattr(state, "vars", None), active)
                status_raw = getattr(state, "status", None)
                status_val = getattr(status_raw, "value", None) if status_raw is not None else None
                status_str = status_val if isinstance(status_val, str) else (status_raw if isinstance(status_raw, str) else str(status_raw))
                is_running = status_str in {"running", "RunStatus.RUNNING"}
                if phase != "done" and is_running:
                    should_close = False
            if should_close:
                out0 = _node_output(active) if is_root else _run_node_output(state, active)
                total_node_ms = float(track.get("active_duration_ms") or duration_ms)
                metrics = _node_metrics(active, duration_ms=total_node_ms, output=out0)
                # Aggregate totals (best-effort). We only count tokens on nodes that report them.
                total_duration_ms += float(total_node_ms)
                in_tok = metrics.get("input_tokens")
                out_tok = metrics.get("output_tokens")
                if isinstance(in_tok, int) and in_tok >= 0:
                    total_input_tokens += int(in_tok)
                if isinstance(out_tok, int) and out_tok >= 0:
                    total_output_tokens += int(out_tok)
                if isinstance(in_tok, int) or isinstance(out_tok, int):
                    token_duration_ms += float(total_node_ms)
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        nodeId=active,
                        result=out0,
                        meta=metrics,
                    ).model_dump()
                )
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0

        return state

    while True:
        # Discover current session children (event listeners + any async descendants).
        run_ids: list[str] = [root_run_id]
        try:
            run_store = getattr(runtime, "run_store", None)
            if run_store is not None and hasattr(run_store, "list_children"):
                children = run_store.list_children(parent_run_id=root_run_id)  # type: ignore[attr-defined]
                for c in children:
                    rid = getattr(c, "run_id", None)
                    if isinstance(rid, str) and rid and rid not in run_ids:
                        run_ids.append(rid)
        except Exception:
            pass

        # Tick root first, then children.
        root_state = await _tick_run(root_run_id, is_root=True)
        # If root sent flow_waiting, stop the loop.
        if connection_id in _waiting_runners:
            break

        # Tick all children once per cycle (enough for UX; delays/events are handled in _tick_run).
        for rid in run_ids:
            if rid == root_run_id:
                continue
            try:
                st = runtime.get_state(rid) if runtime is not None else None
                if st is None:
                    continue
                # Only drive active children; idle event listeners will stay waiting.
                if str(getattr(st, "status", None)) == "RunStatus.RUNNING" or (
                    str(getattr(st, "status", None)) == "RunStatus.WAITING"
                    and getattr(getattr(st, "waiting", None), "reason", None) is not None
                ):
                    await _tick_run(rid, is_root=False)
            except Exception:
                continue

        # Check session completion:
        # - If root failed: error immediately (best-effort: include node id if available).
        try:
            root_now = runtime.get_state(root_run_id) if runtime is not None else None
        except Exception:
            root_now = None

        if root_now is not None and str(getattr(root_now, "status", None)) == "RunStatus.FAILED":
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]
            error_node = None
            if hasattr(root_now, "vars") and isinstance(root_now.vars, dict):
                error_node = root_now.vars.get("_flow_error_node")
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_error",
                    nodeId=error_node,
                    error=getattr(root_now, "error", None),
                ).model_dump()
            )
            break

        # If root completed, keep the websocket open until all children are either:
        # - completed/failed/cancelled, or
        # - waiting for EVENT (idle listeners).
        if root_now is not None and str(getattr(root_now, "status", None)) == "RunStatus.COMPLETED":
            all_children_idle_or_done = True
            try:
                for rid in run_ids:
                    if rid == root_run_id:
                        continue
                    st = runtime.get_state(rid) if runtime is not None else None
                    if st is None:
                        continue
                    s = str(getattr(st, "status", None))
                    if s in {"RunStatus.COMPLETED", "RunStatus.FAILED", "RunStatus.CANCELLED"}:
                        continue
                    if s == "RunStatus.WAITING":
                        w = getattr(st, "waiting", None)
                        reason = getattr(w, "reason", None) if w is not None else None
                        reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None
                        if reason_value == "event":
                            continue
                    all_children_idle_or_done = False
            except Exception:
                all_children_idle_or_done = True

            if all_children_idle_or_done:
                # Cancel idle listeners waiting on EVENT so the session can end cleanly.
                try:
                    for rid in run_ids:
                        if rid == root_run_id:
                            continue
                        st = runtime.get_state(rid) if runtime is not None else None
                        if st is None:
                            continue
                        if str(getattr(st, "status", None)) != "RunStatus.WAITING":
                            continue
                        w = getattr(st, "waiting", None)
                        reason = getattr(w, "reason", None) if w is not None else None
                        reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None
                        if reason_value != "event":
                            continue
                        try:
                            runtime.cancel_run(rid, reason="Session completed")  # type: ignore[union-attr]
                        except Exception:
                            pass
                except Exception:
                    pass

                flow_duration_ms = (time.perf_counter() - flow_started_at) * 1000.0
                flow_meta: Dict[str, Any] = {"duration_ms": round(float(flow_duration_ms), 2)}
                # Include aggregate token totals when available (best-effort).
                flow_meta["input_tokens"] = int(total_input_tokens)
                flow_meta["output_tokens"] = int(total_output_tokens)
                if token_duration_ms > 0:
                    flow_meta["tokens_per_s"] = round(
                        float(total_output_tokens) / (float(token_duration_ms) / 1000.0), 2
                    )
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_complete",
                        result=getattr(root_now, "output", None),
                        meta=flow_meta,
                    ).model_dump()
                )
                break

        # Avoid overwhelming the WebSocket / event loop.
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

    # Clear the waiting marker before resuming; `_execute_runner_loop()` uses the
    # presence of `connection_id` in `_waiting_runners` as a signal to stop the loop.
    runner = _waiting_runners.pop(connection_id)

    try:
        state = runner.get_state()
        wait = state.waiting if state else None
        reason = wait.reason.value if wait and hasattr(wait, "reason") else None
        waiting_ctx = _waiting_steps.get(connection_id) if isinstance(_waiting_steps.get(connection_id), dict) else {}
        waiting_node_id = (
            waiting_ctx.get("node_id")
            if isinstance(waiting_ctx, dict) and isinstance(waiting_ctx.get("node_id"), str)
            else getattr(state, "current_node", None)
        )
        started_at = waiting_ctx.get("started_at") if isinstance(waiting_ctx, dict) else None
        waited_ms = 0.0
        if isinstance(started_at, (int, float)):
            waited_ms = (time.perf_counter() - float(started_at)) * 1000.0

        async def _maybe_close_waiting_step() -> None:
            """Close the node that was WAITING if the run has resumed past it."""
            if not isinstance(waiting_node_id, str) or not waiting_node_id:
                return
            after = runner.get_state()
            after_node = getattr(after, "current_node", None) if after is not None else None
            if after_node == waiting_node_id:
                # Still on the same node (e.g. multi-tick Agent); keep it open.
                return

            try:
                from abstractflow.compiler import _sync_effect_results_to_node_outputs as _sync_effect_results  # type: ignore
                if after is not None and hasattr(runner, "flow"):
                    _sync_effect_results(after, runner.flow)
            except Exception:
                pass

            out = None
            try:
                if hasattr(runner, "flow") and hasattr(runner.flow, "_node_outputs"):
                    outputs = getattr(runner.flow, "_node_outputs")
                    if isinstance(outputs, dict):
                        out = outputs.get(waiting_node_id)
            except Exception:
                out = None

            # Emit completion so the UI doesn't keep this node permanently "WAITING".
            # Duration reflects time spent waiting for user input.
            await websocket.send_json(
                ExecutionEvent(
                    type="node_complete",
                    nodeId=waiting_node_id,
                    result=_json_safe(out),
                    meta={"duration_ms": round(float(waited_ms), 2)},
                ).model_dump()
            )
            _waiting_steps.pop(connection_id, None)

        if reason != "subworkflow":
            # Resume with the user's response
            runner.resume(payload={"response": response}, max_steps=0)
            await _maybe_close_waiting_step()
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
            # Keep runner resumable + record waiting-step context for a follow-up resume.
            _waiting_runners[connection_id] = runner
            _waiting_steps[connection_id] = {
                "node_id": top_state.current_node if top_state else None,
                "started_at": time.perf_counter(),
            }
            return

        await _maybe_close_waiting_step()
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
