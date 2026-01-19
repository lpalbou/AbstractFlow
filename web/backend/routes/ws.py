"""WebSocket routes for real-time execution updates."""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import ExecutionEvent, VisualFlow
from ..services.executor import create_visual_runner
from ..services.execution_workspace import ensure_default_workspace_root, ensure_run_id_workspace_alias
from ..services.runtime_stores import get_runtime_stores
from abstractflow.visual.workspace_scoped_tools import WorkspaceScope, build_scoped_tool_executor

router = APIRouter(tags=["websocket"])

class _SafeSendWebSocket:
    """Send-only WebSocket wrapper that never raises on send.

    Why:
    - In dev (Vite proxy) and in real networks, WebSockets can drop unexpectedly.
    - We do NOT want a transient UI disconnect to abort or corrupt a long-running run.
    - The durable source-of-truth is the RunStore/LedgerStore, not the socket.

    This wrapper makes `send_json` a best-effort no-op once the connection is gone.
    """

    def __init__(self, websocket: WebSocket):
        self._ws = websocket

    async def send_json(self, data: Any) -> None:  # type: ignore[override]
        try:
            await self._ws.send_json(data)
        except Exception:
            # Swallow errors: the execution loop should keep progressing even if the UI disconnects.
            return None


def _ws_utc_now_iso() -> str:
    """UTC ISO timestamp for WS event payloads (JSON-serializable)."""
    return datetime.now(timezone.utc).isoformat()

# Active WebSocket connections
_connections: Dict[str, WebSocket] = {}

# Active execution tasks per connection (run/resume segments).
_active_tasks: Dict[str, asyncio.Task] = {}

# Active runner per connection (includes runtime + run_id).
_active_runners: Dict[str, Any] = {}

# Root run_id per connection (when started).
_active_run_ids: Dict[str, str] = {}

# Pause gate per connection: cleared when paused, set when running.
_control_gates: Dict[str, asyncio.Event] = {}

# Per-connection lock to serialize runtime mutations (tick/resume/pause/cancel).
_connection_locks: Dict[str, asyncio.Lock] = {}

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

    # Track the current recursion path (not a global "seen") so repeated references
    # are preserved, while actual cycles are replaced with "<cycle>".
    vid: Optional[int] = None
    try:
        vid = id(value)
    except Exception:
        vid = None

    if vid is not None:
        if vid in seen:
            return "<cycle>"
        seen.add(vid)

    try:
        if isinstance(value, dict):
            out: Dict[str, Any] = {}
            for k, v in value.items():
                out[str(k)] = _json_safe(v, depth=depth + 1, seen=seen)
            return out

        if isinstance(value, (list, tuple)):
            return [_json_safe(v, depth=depth + 1, seen=seen) for v in list(value)]

        # Pydantic models / dataclasses (best-effort).
        try:
            md = getattr(value, "model_dump", None)
            if callable(md):
                return _json_safe(md(), depth=depth + 1, seen=seen)  # type: ignore[no-any-return]
        except Exception:
            pass

        return str(value)
    finally:
        if vid is not None:
            try:
                seen.discard(vid)
            except Exception:
                pass


def _is_pause_wait(wait: Any, *, run_id: str) -> bool:
    """Return True if this WaitState represents a synthetic manual pause."""
    if wait is None:
        return False
    try:
        reason = getattr(wait, "reason", None)
        reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None
    except Exception:
        reason_value = None
    if reason_value != "user":
        return False
    try:
        wait_key = getattr(wait, "wait_key", None)
        if isinstance(wait_key, str) and wait_key == f"pause:{run_id}":
            return True
    except Exception:
        pass
    try:
        details = getattr(wait, "details", None)
        if isinstance(details, dict) and details.get("kind") == "pause":
            return True
    except Exception:
        pass
    return False


def _list_descendant_run_ids(runtime: Any, root_run_id: str) -> list[str]:
    """Best-effort BFS of the run tree rooted at root_run_id (includes root)."""
    out: list[str] = []
    queue: list[str] = [root_run_id]
    seen: set[str] = set()

    run_store = getattr(runtime, "run_store", None)
    list_children = getattr(run_store, "list_children", None)

    while queue:
        rid = queue.pop(0)
        if rid in seen:
            continue
        seen.add(rid)
        out.append(rid)

        if callable(list_children):
            try:
                children = list_children(parent_run_id=rid)
                for c in children:
                    cid = getattr(c, "run_id", None)
                    if isinstance(cid, str) and cid and cid not in seen:
                        queue.append(cid)
            except Exception:
                continue

    return out


@router.websocket("/ws/{flow_id}")
async def websocket_execution(websocket: WebSocket, flow_id: str):
    """WebSocket endpoint for real-time flow execution updates."""
    await websocket.accept()
    connection_id = f"{flow_id}:{id(websocket)}"
    _connections[connection_id] = websocket
    _connection_locks[connection_id] = asyncio.Lock()
    gate = asyncio.Event()
    gate.set()
    _control_gates[connection_id] = gate

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "run":
                existing = _active_tasks.get(connection_id)
                if existing is not None and not existing.done():
                    await websocket.send_json(
                        ExecutionEvent(type="flow_error", error="A run is already in progress on this connection").model_dump()
                    )
                    continue
                safe_ws = _SafeSendWebSocket(websocket)
                task = asyncio.create_task(
                    execute_with_updates(
                        websocket=safe_ws,  # type: ignore[arg-type]
                        flow_id=flow_id,
                        input_data=message.get("input_data", {}),
                        connection_id=connection_id,
                    )
                )
                _active_tasks[connection_id] = task
            elif message.get("type") == "resume":
                existing = _active_tasks.get(connection_id)
                if existing is not None and not existing.done():
                    await websocket.send_json(
                        ExecutionEvent(type="flow_error", error="Cannot resume while a run is in progress").model_dump()
                    )
                    continue
                safe_ws = _SafeSendWebSocket(websocket)
                task = asyncio.create_task(
                    resume_waiting_flow(
                        websocket=safe_ws,  # type: ignore[arg-type]
                        connection_id=connection_id,
                        response=message.get("response", ""),
                    )
                )
                _active_tasks[connection_id] = task
            elif message.get("type") == "control":
                action = str(message.get("action") or "").strip().lower()
                # Optional: allow the client to target a specific persisted run id.
                # This makes controls resilient to transient WS disconnects / UI reloads
                # (a new connection can still pause/cancel a previously started run).
                run_id = message.get("run_id") or message.get("runId")
                await control_run(
                    websocket=websocket,
                    connection_id=connection_id,
                    action=action,
                    run_id=str(run_id) if isinstance(run_id, str) and run_id.strip() else None,
                )
            elif message.get("type") == "ping":
                # Keepalive pong (ignored by the UI) - still includes a timestamp for observability.
                await websocket.send_json(ExecutionEvent(type="pong").model_dump())

    except WebSocketDisconnect:
        pass
    finally:
        # IMPORTANT:
        # Do NOT cancel in-flight run tasks when the UI disconnects.
        # The UI socket is an observability/control channel; execution is durable and should
        # continue (or remain waiting) independently of that socket.
        _active_tasks.pop(connection_id, None)
        if connection_id in _connections:
            del _connections[connection_id]
        _waiting_runners.pop(connection_id, None)
        _waiting_steps.pop(connection_id, None)
        _active_runners.pop(connection_id, None)
        _active_run_ids.pop(connection_id, None)
        _control_gates.pop(connection_id, None)
        _connection_locks.pop(connection_id, None)


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
        # Session semantics:
        # - Runtime scope `session` depends on `RunState.session_id`.
        # - WebSocket executions should default to a stable session_id so multiple
        #   flow runs in the same UI session can share session-scoped memory.
        #
        # Priority:
        # - explicit session id from client input_data (session_id / sessionId)
        # - otherwise: connection_id (stable for the lifetime of this socket)
        session_id = None
        try:
            raw = input_data.get("session_id") or input_data.get("sessionId")
            if isinstance(raw, str) and raw.strip():
                session_id = raw.strip()
        except Exception:
            session_id = None
        if session_id is None:
            session_id = str(connection_id or "").strip() or None

        gate = _control_gates.get(connection_id)
        if gate is not None:
            gate.set()

        # Default to an isolated per-run workspace so file/shell tools don't pollute the repo.
        # The stable alias `<ABSTRACTFLOW_BASE_EXECUTION>/<run_id>` is created after start.
        workspace_dir = ensure_default_workspace_root(input_data)

        run_store, ledger_store, artifact_store = get_runtime_stores()
        scope = WorkspaceScope.from_input_data(input_data)
        tool_executor = build_scoped_tool_executor(scope=scope) if scope is not None else None
        runner = create_visual_runner(
            visual_flow,
            flows=_flows,
            run_store=run_store,
            ledger_store=ledger_store,
            artifact_store=artifact_store,
            tool_executor=tool_executor,
            input_data=input_data,
        )
        _active_runners[connection_id] = runner

        # Start execution
        run_id = runner.start(input_data, session_id=session_id)
        if isinstance(run_id, str) and run_id:
            _active_run_ids[connection_id] = run_id
            if workspace_dir is not None:
                ensure_run_id_workspace_alias(run_id=run_id, workspace_dir=workspace_dir)
        await websocket.send_json(ExecutionEvent(type="flow_start", runId=run_id).model_dump())

        # Execute and handle waiting
        if gate is not None:
            await gate.wait()
        await _execute_runner_loop(websocket, runner, connection_id)

    except asyncio.CancelledError:
        # Cancellation is an expected control-plane operation (Cancel Run / disconnect).
        # Do not emit `flow_error` for it; the UI will receive `flow_cancelled`.
        return
    except Exception as e:
        import traceback
        traceback.print_exc()
        await websocket.send_json(
            ExecutionEvent(
                type="flow_error",
                error=str(e),
            ).model_dump()
        )
    finally:
        # Allow subsequent control/run messages to spawn new tasks.
        _active_tasks.pop(connection_id, None)


async def control_run(
    *,
    websocket: WebSocket,
    connection_id: str,
    action: str,
    run_id: Optional[str] = None,
) -> None:
    """Handle control operations (pause/resume/cancel) for the current run."""
    # Prefer an explicit run id from the client, fall back to the active connection run.
    runner = _active_runners.get(connection_id) or _waiting_runners.get(connection_id)
    run_id_target = run_id
    if not isinstance(run_id_target, str) or not run_id_target.strip():
        run_id_target = _active_run_ids.get(connection_id) or getattr(runner, "run_id", None)

    if not isinstance(run_id_target, str) or not run_id_target.strip():
        await websocket.send_json(ExecutionEvent(type="flow_error", error="No run_id provided to control").model_dump())
        return
    run_id_target = run_id_target.strip()

    # Use the runner's runtime when available, otherwise create a minimal runtime over the same stores.
    runtime = getattr(runner, "runtime", None) if runner is not None else None
    if runtime is None:
        try:
            run_store, ledger_store, artifact_store = get_runtime_stores()
            try:
                from abstractruntime import Runtime  # type: ignore
            except Exception:  # pragma: no cover
                from abstractruntime.core.runtime import Runtime  # type: ignore
            runtime = Runtime(run_store=run_store, ledger_store=ledger_store, artifact_store=artifact_store)
        except Exception as e:
            await websocket.send_json(
                ExecutionEvent(type="flow_error", error=f"Failed to create runtime for control: {e}").model_dump()
            )
            return

    gate = _control_gates.get(connection_id)
    # IMPORTANT:
    # Do NOT block on the per-connection lock here. The execution loop may hold it
    # across a long-running `runner.step()` (e.g. a local LLM HTTP call). If we wait
    # for the lock, pause/cancel/resume become unresponsive in exactly the scenarios
    # users need them most.
    #
    # Runtime durability is protected by:
    # - atomic RunStore writes (JsonFileRunStore.save)
    # - Runtime.tick() honoring externally persisted pause/cancel before saving

    action2 = str(action or "").strip().lower()
    if action2 not in {"pause", "resume", "cancel"}:
        await websocket.send_json(
            ExecutionEvent(type="flow_error", error=f"Unknown control action '{action2}'").model_dump()
        )
        return

    run_ids = _list_descendant_run_ids(runtime, run_id_target)

    def _apply(fn_name: str, *, reason: Optional[str] = None) -> None:
        fn = getattr(runtime, fn_name, None)
        if not callable(fn):
            raise RuntimeError(f"Runtime missing '{fn_name}()'")
        for rid in run_ids:
            if reason is None:
                fn(rid)
            else:
                fn(rid, reason=reason)

    try:
        if action2 == "pause":
            if gate is not None:
                gate.clear()
            # Apply synchronously: pause/cancel must remain responsive even if the threadpool
            # is saturated by long-running `runner.step()` calls.
            _apply("pause_run", reason="Paused via AbstractFlow UI")
            await websocket.send_json(ExecutionEvent(type="flow_paused", runId=run_id_target).model_dump())
            return

        if action2 == "resume":
            _apply("resume_run")
            if gate is not None:
                gate.set()
            await websocket.send_json(ExecutionEvent(type="flow_resumed", runId=run_id_target).model_dump())
            return

        # cancel
        if gate is not None:
            gate.set()
        _apply("cancel_run", reason="Cancelled via AbstractFlow UI")

        # Stop any in-flight execution loop promptly.
        task = _active_tasks.get(connection_id)
        if task is not None and not task.done():
            task.cancel()

        _waiting_runners.pop(connection_id, None)
        _waiting_steps.pop(connection_id, None)

        await websocket.send_json(ExecutionEvent(type="flow_cancelled", runId=run_id_target).model_dump())
    except Exception as e:
        await websocket.send_json(
            ExecutionEvent(type="flow_error", error=f"Control action failed: {e}").model_dump()
        )


async def _execute_runner_loop(
    websocket: WebSocket,
    runner: Any,
    connection_id: str,
) -> None:
    """Execute the runner loop with waiting support."""
    flow_started_at = time.perf_counter()
    gate = _control_gates.get(connection_id)
    lock = _connection_locks.get(connection_id)

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

    def _utc_now_iso() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()

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

    # Runtime-owned node traces (stored in RunState.vars["_runtime"]["node_traces"]) are the
    # most reliable source of per-effect observability (LLM_CALL / TOOL_CALLS loops), especially
    # for Agent nodes that may stay on the same runtime node across many effects.
    #
    # We stream *deltas* (new entries) over the WS so the UI can render live traces without
    # waiting for the outer visual node to complete.
    trace_cursors: Dict[str, Dict[str, int]] = {}

    # Child subworkflow ticks can be configured to trade off granularity vs overhead.
    # More steps per tick reduces store IO and WS chatter for fast tool loops.
    try:
        child_tick_max_steps = int(os.environ.get("ABSTRACTFLOW_CHILD_TICK_MAX_STEPS", "5") or "5")
    except Exception:
        child_tick_max_steps = 5
    if child_tick_max_steps < 1:
        child_tick_max_steps = 1

    async def _emit_trace_deltas(run_id: str, state: Any) -> None:
        """Emit trace_update events for newly appended runtime node trace entries."""
        if runtime is None:
            return
        traces: Any = None
        try:
            vars_obj = getattr(state, "vars", None)
            if isinstance(vars_obj, dict):
                runtime_ns = vars_obj.get("_runtime")
                traces = runtime_ns.get("node_traces") if isinstance(runtime_ns, dict) else None
        except Exception:
            traces = None

        # Fallback (slower): load persisted run state from the runtime store.
        if traces is None:
            try:
                traces = runtime.get_node_traces(run_id)
            except Exception:
                return

        if not isinstance(traces, dict) or not traces:
            return

        cursor = trace_cursors.get(run_id)
        if not isinstance(cursor, dict):
            cursor = {}
            trace_cursors[run_id] = cursor

        for node_id, trace_obj in traces.items():
            if not isinstance(node_id, str) or not node_id:
                continue
            if not isinstance(trace_obj, dict):
                continue
            steps = trace_obj.get("steps")
            if not isinstance(steps, list) or not steps:
                continue

            prev = cursor.get(node_id, 0)
            if not isinstance(prev, int) or prev < 0:
                prev = 0
            if prev >= len(steps):
                cursor[node_id] = len(steps)
                continue

            new_steps = steps[prev:]
            cursor[node_id] = len(steps)
            # NOTE: The UI expects JSON-safe objects; runtime traces are already JSON-safe,
            # but we still run through _json_safe to guard against handler bugs.
            await websocket.send_json(
                {
                    "type": "trace_update",
                    "ts": _utc_now_iso(),
                    "runId": run_id,
                    "nodeId": node_id,
                    "steps": _json_safe(new_steps),
                }
            )

    # Backward-compat / test support:
    # Some tests patch `create_visual_runner()` with a minimal fake runner that does not
    # expose a Runtime. In that case, fall back to the legacy single-run loop.
    if runtime is None:
        active_node_id: Optional[str] = None
        root_run_id = getattr(runner, "run_id", None)
        while True:
            if gate is not None:
                await gate.wait()
            before = runner.get_state() if hasattr(runner, "get_state") else None
            node_before = getattr(before, "current_node", None) if before is not None else None

            if node_before and node_before != active_node_id:
                await websocket.send_json(
                    ExecutionEvent(type="node_start", runId=root_run_id, nodeId=node_before).model_dump()
                )
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
                        "ts": _utc_now_iso(),
                        "runId": root_run_id,
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
                            runId=root_run_id,
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
                        runId=root_run_id,
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
                        runId=root_run_id,
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
                # START_SUBWORKFLOW waits (Agent nodes / Subflow nodes):
                # When a run is WAITING(reason=SUBWORKFLOW) and later gets resumed to a different node,
                # we must emit `node_complete` for the waiting node. Otherwise the UI keeps it stuck
                # as RUNNING forever (and subsequent nodes appear to run "in parallel").
                "subworkflow_started_at": None,
                "subworkflow_node_id": None,
                # For UX: allow the UI to expand and render child run steps while the parent
                # is still waiting on a subworkflow (so long-running subflows aren't "opaque").
                "subworkflow_child_run_id": None,
            }
            run_tracks[run_id] = t
        return t

    # Best-effort aggregate metrics (active time + token usage).
    total_duration_ms: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    _token_lock = threading.Lock()
    _seen_token_step_ids: set[str] = set()

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

    def _count_tokens_from_usage(usage: Any, *, key: Optional[str] = None) -> None:
        """Accumulate session token totals from an LLM `usage` object (best-effort)."""
        nonlocal total_input_tokens, total_output_tokens
        i, o = _extract_usage_tokens(usage)
        if i is None and o is None:
            return
        with _token_lock:
            if key and key in _seen_token_step_ids:
                return
            if key:
                _seen_token_step_ids.add(key)
            if i is not None:
                total_input_tokens += int(i)
            if o is not None:
                total_output_tokens += int(o)

    def _on_ledger_record(rec: Any) -> None:
        """Ledger subscriber callback: count tokens for completed LLM_CALL effects."""
        if not isinstance(rec, dict):
            return
        if rec.get("status") != "completed":
            return
        eff = rec.get("effect")
        if not isinstance(eff, dict) or eff.get("type") != "llm_call":
            return
        step_id = rec.get("step_id")
        step_key = step_id.strip() if isinstance(step_id, str) and step_id.strip() else None
        result = rec.get("result")
        usage = None
        if isinstance(result, dict):
            usage = result.get("usage")
            if usage is None:
                raw = result.get("raw")
                if isinstance(raw, dict):
                    usage = raw.get("usage")
        _count_tokens_from_usage(usage, key=step_key)

    root_run_id = getattr(runner, "run_id", None)
    if not isinstance(root_run_id, str) or not root_run_id:
        return

    # Aggregate token totals from durable ledger records (LLM_CALL usage).
    #
    # Why ledger:
    # - It captures *every* completed LLM call (including loops, agents, subflows).
    # - `_temp.effects` only stores the *latest* result per node id and would undercount loops.
    unsubscribe_ledger: Optional[Any] = None
    ledger_trace_task: Optional[asyncio.Task] = None
    try:
        ledger_store = runtime.ledger_store if runtime is not None else None  # type: ignore[union-attr]
    except Exception:
        ledger_store = None

    if ledger_store is not None and hasattr(ledger_store, "subscribe"):
        # Stream ledger records as trace_update events (STARTED/COMPLETED/FAILED/WAITING).
        #
        # Why ledger:
        # - STARTED records are appended *before* long-running effects execute (LLM/tool),
        #   so UIs can show truthful "something is happening" signals on slow hardware.
        # - COMPLETED/FAILED/WAITING updates reuse the same `step_id` and are appended as
        #   separate records, allowing the frontend to upsert (started -> completed).
        ledger_q: "asyncio.Queue[dict]" = asyncio.Queue()
        loop = asyncio.get_running_loop()

        descendant_cache: set[str] = {root_run_id}

        def _is_descendant_run_id(candidate: str) -> bool:
            if candidate in descendant_cache:
                return True
            if runtime is None:
                return False
            cur = candidate
            seen: set[str] = set()
            for _ in range(50):
                if cur in seen:
                    return False
                seen.add(cur)
                try:
                    st = runtime.get_state(cur)
                except Exception:
                    return False
                parent = getattr(st, "parent_run_id", None)
                if not isinstance(parent, str) or not parent.strip():
                    return False
                pid = parent.strip()
                if pid == root_run_id:
                    descendant_cache.add(candidate)
                    return True
                cur = pid
            return False

        def _trace_step_from_ledger(rec: dict) -> dict:
            # Normalize StepRecord (ledger) -> TraceStep (UI).
            status = rec.get("status")
            eff = rec.get("effect")
            step: dict = {
                "ts": rec.get("ended_at") or rec.get("started_at") or _utc_now_iso(),
                "status": status,
                "step_id": rec.get("step_id"),
                "attempt": rec.get("attempt"),
                "idempotency_key": rec.get("idempotency_key"),
                "effect": eff,
            }
            if status == "completed":
                step["result"] = rec.get("result")
            elif status == "failed":
                step["error"] = rec.get("error")
            elif status == "waiting":
                # Legacy trace entries store wait details under `wait`.
                res = rec.get("result")
                if isinstance(res, dict):
                    w = res.get("wait")
                    if isinstance(w, dict):
                        step["wait"] = w
                    else:
                        step["result"] = res
                else:
                    step["result"] = res
            return step

        async def _pump_ledger_traces() -> None:
            while True:
                rec = await ledger_q.get()
                if rec is None:
                    return
                try:
                    run_id = rec.get("run_id")
                    node_id = rec.get("node_id")
                    if not isinstance(run_id, str) or not run_id.strip():
                        continue
                    if not isinstance(node_id, str) or not node_id.strip():
                        continue
                    rid = run_id.strip()
                    if rid == root_run_id:
                        # Root run traces are ignored by the UI, so skip.
                        continue
                    if not _is_descendant_run_id(rid):
                        continue
                    await websocket.send_json(
                        {
                            "type": "trace_update",
                            "ts": _utc_now_iso(),
                            "runId": rid,
                            "nodeId": node_id,
                            "steps": _json_safe([_trace_step_from_ledger(rec)]),
                        }
                    )
                except Exception:
                    # Observability must not crash the WS loop.
                    continue

        ledger_trace_task = asyncio.create_task(_pump_ledger_traces())

        def _ledger_cb(payload: Any) -> None:
            if not isinstance(payload, dict):
                return
            rid = payload.get("run_id")
            if isinstance(rid, str) and rid.strip():
                # Fast-path filter for unrelated runs.
                if rid.strip() != root_run_id and not _is_descendant_run_id(rid.strip()):
                    return
            _on_ledger_record(payload)
            try:
                loop.call_soon_threadsafe(ledger_q.put_nowait, payload)
            except Exception:
                return

        try:
            unsubscribe_ledger = ledger_store.subscribe(_ledger_cb)  # type: ignore[attr-defined]
        except Exception:
            unsubscribe_ledger = None

        # Prime totals from already persisted records (handles resume/reconnect).
        try:
            if hasattr(ledger_store, "list") and runtime is not None:
                for rid in _list_descendant_run_ids(runtime, root_run_id):
                    for rec in ledger_store.list(rid):  # type: ignore[attr-defined]
                        _on_ledger_record(rec)
        except Exception:
            pass

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
        nonlocal total_duration_ms
        if runtime is None:
            return None
        if gate is not None:
            await gate.wait()
        track = _track(run_id)

        if lock is not None:
            async with lock:
                before = runtime.get_state(run_id)
        else:
            before = runtime.get_state(run_id)
        node_before = getattr(before, "current_node", None)

        # Close SUBWORKFLOW waits when the run has been resumed past the waiting node.
        #
        # Why: Runtime.resume(...) transitions WAITING(SUBWORKFLOW) → RUNNING(next_node) without
        # producing a new runtime step record for the waiting node. The WS layer must therefore
        # synthesize a `node_complete` so the UI timeline + canvas highlighting stay consistent.
        sw_node = track.get("subworkflow_node_id")
        if isinstance(sw_node, str) and sw_node:
            status_str = str(getattr(before, "status", None))
            still_waiting_sub = False
            if status_str == "RunStatus.WAITING":
                w = getattr(before, "waiting", None)
                r = getattr(w, "reason", None) if w is not None else None
                rv = r.value if hasattr(r, "value") else str(r) if r else None
                still_waiting_sub = rv == "subworkflow"
            if not still_waiting_sub and node_before != sw_node:
                started_at = track.get("subworkflow_started_at")
                waited_ms = 0.0
                if isinstance(started_at, (int, float)):
                    waited_ms = (time.perf_counter() - float(started_at)) * 1000.0

                # Keep root flow outputs in sync (so `_node_output` can see the resumed effect result).
                if is_root:
                    try:
                        from abstractflow.compiler import _sync_effect_results_to_node_outputs as _sync_effect_results  # type: ignore
                        if hasattr(runner, "flow"):
                            _sync_effect_results(before, runner.flow)
                    except Exception:
                        pass

                out_sw = _node_output(sw_node) if is_root else _run_node_output(before, sw_node)
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        runId=run_id,
                        nodeId=sw_node,
                        result=out_sw,
                        meta=_node_metrics(sw_node, duration_ms=waited_ms, output=out_sw),
                    ).model_dump()
                )

                # Clear wait markers; allow the next node_start to become active.
                track["subworkflow_node_id"] = None
                track["subworkflow_started_at"] = None
                track["subworkflow_child_run_id"] = None
                active0 = track.get("active_node_id")
                if isinstance(active0, str) and active0 == sw_node:
                    track["active_node_id"] = None
                    track["active_duration_ms"] = 0.0

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
                    runId=run_id,
                    nodeId=wnode,
                ).model_dump()
            )
            out0 = _run_node_output(before, wnode)
            await websocket.send_json(
                ExecutionEvent(
                    type="node_complete",
                    runId=run_id,
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
            if _is_pause_wait(wait0, run_id=run_id):
                # Manual pause: never surface as flow_waiting.
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0
                return None
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
                    if gate is not None:
                        await gate.wait()
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

                if lock is not None:
                    async with lock:
                        await asyncio.to_thread(
                            runtime.resume,
                            workflow=wf,
                            run_id=run_id,
                            wait_key=None,
                            payload=resume_payload,
                            max_steps=0,
                        )
                        after_resume = runtime.get_state(run_id)
                else:
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
                            runId=run_id,
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
                    runId=run_id,
                    nodeId=node_before,
                ).model_dump()
            )
            track["active_node_id"] = node_before
            track["active_duration_ms"] = 0.0
            await asyncio.sleep(0)

        # Tick one step
        t0 = time.perf_counter()
        if is_root:
            if lock is not None:
                async with lock:
                    state = await asyncio.to_thread(runner.step)
            else:
                state = await asyncio.to_thread(runner.step)
        else:
            wf = _workflow_for_run_id(run_id)
            if lock is not None:
                async with lock:
                    state = await asyncio.to_thread(
                        runtime.tick, workflow=wf, run_id=run_id, max_steps=child_tick_max_steps
                    )
            else:
                state = await asyncio.to_thread(
                    runtime.tick, workflow=wf, run_id=run_id, max_steps=child_tick_max_steps
                )
        duration_ms = (time.perf_counter() - t0) * 1000.0

        # Emit per-effect trace deltas for this run (including child agent runs).
        #
        # Primary source: ledger stream (STARTED/COMPLETED/FAILED) via subscription.
        # Fallback: runtime node_traces (older runtimes / tests).
        if not is_root and ledger_trace_task is None:
            await _emit_trace_deltas(run_id, state)

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
            if is_root and _is_pause_wait(wait, run_id=root_run_id):
                # Manual pause: do not surface as flow_waiting.
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0
                return state
            reason = getattr(wait, "reason", None) if wait is not None else None
            reason_value = reason.value if hasattr(reason, "value") else str(reason) if reason else None

            if reason_value == "subworkflow":
                active0 = track.get("active_node_id")
                sw_id = active0 if isinstance(active0, str) and active0 else (node_before if isinstance(node_before, str) else None)
                if isinstance(sw_id, str) and sw_id:
                    if track.get("subworkflow_started_at") is None or track.get("subworkflow_node_id") != sw_id:
                        track["subworkflow_started_at"] = time.perf_counter()
                        track["subworkflow_node_id"] = sw_id

                    sub_run_id = _extract_sub_run_id(wait)
                    if isinstance(sub_run_id, str) and sub_run_id and track.get("subworkflow_child_run_id") != sub_run_id:
                        track["subworkflow_child_run_id"] = sub_run_id
                        # Inform the UI of the child run id *while* the parent node is still running.
                        await websocket.send_json(
                            {
                                "type": "subworkflow_update",
                                "ts": _utc_now_iso(),
                                "runId": run_id,
                                "nodeId": sw_id,
                                "sub_run_id": sub_run_id,
                            }
                        )

            if reason_value == "until":
                if track.get("wait_until_started_at") is None or track.get("wait_until_node_id") != track.get("active_node_id"):
                    track["wait_until_started_at"] = time.perf_counter()
                    track["wait_until_node_id"] = track.get("active_node_id")
                return state

            if reason_value == "event" and not is_root:
                # Listener waits are silent; we close the node we just executed (if any),
                # then track the WAIT_EVENT node so we can emit it only when resumed.
                #
                # Without this, a listener that runs a normal node (e.g. ANSWER_USER)
                # and then returns to WAITING(event) would drop the final `node_complete`.
                wait_node = getattr(state, "current_node", None)
                wait_node_id = str(wait_node) if isinstance(wait_node, str) else (str(node_before) if isinstance(node_before, str) else "")

                active0 = track.get("active_node_id")
                if isinstance(active0, str) and active0 and active0 != wait_node_id:
                    out0 = _run_node_output(state, active0)
                    total_node_ms = float(track.get("active_duration_ms") or duration_ms)
                    metrics = _node_metrics(active0, duration_ms=total_node_ms, output=out0)
                    await websocket.send_json(
                        ExecutionEvent(
                            type="node_complete",
                            runId=run_id,
                            nodeId=active0,
                            result=out0,
                            meta=metrics,
                        ).model_dump()
                    )

                if wait_node_id:
                    if track.get("wait_event_started_at") is None or track.get("wait_event_node_id") != wait_node_id:
                        track["wait_event_started_at"] = time.perf_counter()
                        track["wait_event_node_id"] = wait_node_id
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0
                return state

            # Root waits (or non-event waits) are surfaced to the UI *only* when the deepest
            # waiting reason requires user input. A root waiting on SUBWORKFLOW completion
            # must keep running so we can tick the child and stream live trace updates.
            if is_root:
                prompt, choices, allow_free_text, wait_key, reason = _resolve_waiting_info(state)
                if reason != "subworkflow":
                    _waiting_runners[connection_id] = runner
                    _waiting_steps[connection_id] = {
                        "node_id": node_before or getattr(state, "current_node", None),
                        "started_at": time.perf_counter(),
                    }
                    await websocket.send_json(
                        {
                            "type": "flow_waiting",
                            "ts": _utc_now_iso(),
                            "runId": run_id,
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
                # Best-effort wall time (kept for future aggregation/diagnostics).
                total_duration_ms += float(total_node_ms)
                await websocket.send_json(
                    ExecutionEvent(
                        type="node_complete",
                        runId=run_id,
                        nodeId=active,
                        result=out0,
                        meta=metrics,
                    ).model_dump()
                )
                track["active_node_id"] = None
                track["active_duration_ms"] = 0.0

        return state

    while True:
        if gate is not None:
            await gate.wait()
        # Discover all descendant runs (root + children + grandchildren...).
        #
        # This is critical for nested subworkflow composition:
        # - Root run may wait on a Subflow child
        # - That child may itself wait on an Agent sub-run (grandchild)
        # If we only tick direct children of the root, the grandchild never progresses
        # and the session deadlocks (UI shows "running" but nothing is computing).
        run_ids: list[str] = _list_descendant_run_ids(runtime, root_run_id)
        if not run_ids:
            run_ids = [root_run_id]

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
                if runtime is None:
                    st = None
                elif lock is not None:
                    async with lock:
                        st = runtime.get_state(rid)
                else:
                    st = runtime.get_state(rid)
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

        # Bubble async subworkflow completions back into any waiting parents (root or children).
        #
        # This is required for async+wait START_SUBWORKFLOW (Agent nodes): the parent stays in
        # WAITING(reason=SUBWORKFLOW) while the host drives the child run incrementally.
        try:
            if runtime is not None and getattr(runtime, "workflow_registry", None) is not None:
                from abstractruntime.core.models import RunStatus, WaitReason

                registry = runtime.workflow_registry

                def _spec_for(run_state: Any):
                    spec = registry.get(run_state.workflow_id)
                    if spec is None:
                        raise RuntimeError(f"Workflow '{run_state.workflow_id}' not found in registry")
                    return spec

                for parent_id in list(run_ids):
                    try:
                        parent_state = runtime.get_state(parent_id)
                    except Exception:
                        continue
                    if parent_state is None:
                        continue
                    if parent_state.status != RunStatus.WAITING or parent_state.waiting is None:
                        continue
                    if parent_state.waiting.reason != WaitReason.SUBWORKFLOW:
                        continue
                    sub_run_id = _extract_sub_run_id(parent_state.waiting)
                    if not sub_run_id:
                        continue

                    try:
                        sub_state = runtime.get_state(sub_run_id)
                    except Exception:
                        continue

                    if sub_state.status == RunStatus.COMPLETED:
                        runtime.resume(
                            workflow=_spec_for(parent_state),
                            run_id=parent_state.run_id,
                            wait_key=None,
                            payload={
                                "sub_run_id": sub_state.run_id,
                                "output": sub_state.output,
                                "node_traces": runtime.get_node_traces(sub_state.run_id),
                            },
                            max_steps=0,
                        )
                        continue

                    if sub_state.status == RunStatus.FAILED:
                        # Preserve the durable failure semantics of sync START_SUBWORKFLOW.
                        parent_state.status = RunStatus.FAILED
                        parent_state.waiting = None
                        parent_state.error = f"Subworkflow '{parent_state.workflow_id}' failed: {sub_state.error}"
                        parent_state.updated_at = _utc_now_iso()
                        runtime.run_store.save(parent_state)
                        continue

                    if sub_state.status == RunStatus.CANCELLED:
                        parent_state.status = RunStatus.CANCELLED
                        parent_state.waiting = None
                        parent_state.error = f"Subworkflow '{parent_state.workflow_id}' cancelled"
                        parent_state.updated_at = _utc_now_iso()
                        runtime.run_store.save(parent_state)
                        continue
        except Exception:
            # Best-effort; never let bubbling break the execution loop.
            pass

        # Check session completion:
        # - If root failed: error immediately (best-effort: include node id if available).
        try:
            if runtime is None:
                root_now = None
            elif lock is not None:
                async with lock:
                    root_now = runtime.get_state(root_run_id)
            else:
                root_now = runtime.get_state(root_run_id)
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
                    runId=root_run_id,
                    nodeId=error_node,
                    error=getattr(root_now, "error", None),
                ).model_dump()
            )
            break

        if root_now is not None and str(getattr(root_now, "status", None)) == "RunStatus.CANCELLED":
            if connection_id in _waiting_runners:
                del _waiting_runners[connection_id]
            await websocket.send_json(
                ExecutionEvent(
                    type="flow_cancelled",
                    runId=root_run_id,
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
                #
                # NOTE: We count tokens from durable ledger records (LLM_CALL completions), so this
                # remains correct across loops, subflows, and agent subruns.
                with _token_lock:
                    in_total = int(total_input_tokens)
                    out_total = int(total_output_tokens)
                if in_total > 0 or out_total > 0:
                    flow_meta["input_tokens"] = in_total
                    flow_meta["output_tokens"] = out_total
                    # Throughput (overall) is best-effort; use total wall time.
                    if flow_duration_ms > 0 and out_total > 0:
                        flow_meta["tokens_per_s"] = round(float(out_total) / (float(flow_duration_ms) / 1000.0), 2)
                await websocket.send_json(
                    ExecutionEvent(
                        type="flow_complete",
                        runId=root_run_id,
                        result=getattr(root_now, "output", None),
                        meta=flow_meta,
                    ).model_dump()
                )
                break

        # Avoid overwhelming the WebSocket / event loop.
        await asyncio.sleep(0.01)

    # Clean up ledger subscription (best-effort).
    if callable(unsubscribe_ledger):
        try:
            unsubscribe_ledger()
        except Exception:
            pass

    if ledger_trace_task is not None:
        ledger_trace_task.cancel()
        try:
            await ledger_trace_task
        except Exception:
            pass


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
    _active_runners[connection_id] = runner
    rid0 = getattr(runner, "run_id", None)
    if isinstance(rid0, str) and rid0:
        _active_run_ids[connection_id] = rid0

    gate = _control_gates.get(connection_id)
    if gate is not None:
        gate.set()
    lock = _connection_locks.get(connection_id)

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
                    runId=getattr(runner, "run_id", None),
                    nodeId=waiting_node_id,
                    result=_json_safe(out),
                    meta={"duration_ms": round(float(waited_ms), 2)},
                ).model_dump()
            )
            _waiting_steps.pop(connection_id, None)

        if reason != "subworkflow":
            # Resume with the user's response
            if lock is not None:
                async with lock:
                    runner.resume(payload={"response": response}, max_steps=0)
            else:
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
                    "ts": _ws_utc_now_iso(),
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
