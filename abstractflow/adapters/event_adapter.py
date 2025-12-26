"""Event adapters for visual custom events.

This module provides durable, session-scoped custom events (Blueprint-style):
- `on_event`: a listener node that waits for an event and then runs its branch
- `emit_event`: an emitter node that signals listeners in the same session (or a target session)

These are built on AbstractRuntime primitives:
- WAIT_EVENT (durable pause)
- EMIT_EVENT (durable dispatch + resume)
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


def create_on_event_node_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    event_name: str,
    scope: str = "session",
) -> Callable:
    """Create an `on_event` node handler.

    The node:
    - pushes itself as the active control node so terminal branch nodes return here
    - waits for a session-scoped event via WAIT_EVENT
    - resumes into `next_node` when the event arrives
    """
    from abstractruntime.core.models import Effect, EffectType, StepPlan

    from .control_adapter import _ensure_control

    # Blank/unspecified name is treated as "listen to any event" (wildcard).
    # This avoids the surprising behavior of binding to an opaque node_id and
    # makes older saved flows (that may have name="") still behave sensibly.
    name = str(event_name or "").strip() or "*"
    scope_norm = str(scope or "session").strip().lower() or "session"

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx

        _ctrl, stack, _frames = _ensure_control(run.vars)
        if not stack or stack[-1] != node_id:
            # Ensure this node is the active scheduler for its branch.
            stack.append(node_id)

        # If the event has no connected branch, we still wait and "consume" the event.
        # This mirrors Blueprint semantics: an unconnected Custom Event is a no-op.
        resume_to = next_node or node_id

        effect = Effect(
            type=EffectType.WAIT_EVENT,
            payload={"scope": scope_norm, "name": name, "resume_to_node": resume_to},
            result_key=f"_temp.effects.{node_id}",
        )

        return StepPlan(node_id=node_id, effect=effect, next_node=next_node)

    return handler


def create_emit_event_node_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    resolve_inputs: Callable[[Any], Dict[str, Any]],
    default_name: str,
    default_session_id: Optional[str] = None,
    scope: str = "session",
) -> Callable:
    """Create an `emit_event` node handler.

    The node resolves its inputs durably (via Visual data edges) and emits an EMIT_EVENT effect.

    Inputs (resolved via `resolve_inputs`):
    - name: str (optional, falls back to default_name)
    - payload: dict|any (optional)
    - session_id: str (optional, target session id for cross-workflow delivery)
    """
    from abstractruntime.core.models import Effect, EffectType, StepPlan

    default_name2 = str(default_name or "").strip()
    scope_norm = str(scope or "session").strip().lower() or "session"

    def _next_seq(run_vars: Dict[str, Any]) -> int:
        temp = run_vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run_vars["_temp"] = temp
        seqs = temp.get("event_seq")
        if not isinstance(seqs, dict):
            seqs = {}
            temp["event_seq"] = seqs
        raw = seqs.get(node_id, 0)
        try:
            cur = int(raw or 0)
        except Exception:
            cur = 0
        nxt = cur + 1
        seqs[node_id] = nxt
        return nxt

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        resolved = resolve_inputs(run)

        name_raw = resolved.get("name") or resolved.get("event_name") or default_name2
        name = str(name_raw or "").strip()
        if not name:
            raise ValueError(f"emit_event node '{node_id}' missing event name")

        payload = resolved.get("payload")
        if isinstance(payload, dict):
            payload_dict: Dict[str, Any] = dict(payload)
        elif payload is None:
            payload_dict = {}
        else:
            payload_dict = {"value": payload}

        target_session_id = resolved.get("session_id")
        if target_session_id is None and isinstance(default_session_id, str) and default_session_id.strip():
            target_session_id = default_session_id.strip()
        if isinstance(target_session_id, str) and not target_session_id.strip():
            target_session_id = None

        seq = _next_seq(run.vars)
        event_id = f"{run.run_id}:{node_id}:{seq}"

        eff_payload: Dict[str, Any] = {
            "scope": scope_norm,
            "name": name,
            "payload": payload_dict,
            "event_id": event_id,
            # IMPORTANT (Blueprint semantics + observability):
            # - Emit should resume listeners durably, but hosts (WS loop / schedulers)
            #   should drive execution so we can stream node_start/node_complete in-order.
            # - This avoids "invisible" listener execution that happens inside the emitter tick.
            "max_steps": 0,
        }
        if isinstance(target_session_id, str) and target_session_id.strip():
            eff_payload["session_id"] = target_session_id.strip()

        effect = Effect(
            type=EffectType.EMIT_EVENT,
            payload=eff_payload,
            result_key=f"_temp.effects.{node_id}",
        )

        return StepPlan(node_id=node_id, effect=effect, next_node=next_node)

    return handler


