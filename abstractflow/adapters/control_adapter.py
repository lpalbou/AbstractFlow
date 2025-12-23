"""Control-flow adapters for visual execution nodes (Sequence / Parallel).

These nodes implement Blueprint-style structured flow control:
- Sequence: executes Then 0, Then 1, ... in order (each branch runs to completion)
- Parallel: executes all branches, then triggers Completed (join)

Key constraint: AbstractRuntime has a single `current_node` cursor and no in-memory call stack
(durable execution). Therefore we encode control-flow state in `RunState.vars` (JSON-safe).
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional


CONTROL_NS_KEY = "_control"
CONTROL_STACK_KEY = "stack"
CONTROL_FRAMES_KEY = "frames"


def _ensure_control(run_vars: Dict[str, Any]) -> tuple[Dict[str, Any], List[str], Dict[str, Any]]:
    temp = run_vars.get("_temp")
    if not isinstance(temp, dict):
        temp = {}
        run_vars["_temp"] = temp

    ctrl = temp.get(CONTROL_NS_KEY)
    if not isinstance(ctrl, dict):
        ctrl = {}
        temp[CONTROL_NS_KEY] = ctrl

    stack = ctrl.get(CONTROL_STACK_KEY)
    if not isinstance(stack, list):
        stack = []
        ctrl[CONTROL_STACK_KEY] = stack

    frames = ctrl.get(CONTROL_FRAMES_KEY)
    if not isinstance(frames, dict):
        frames = {}
        ctrl[CONTROL_FRAMES_KEY] = frames

    return ctrl, stack, frames


def get_active_control_node_id(run_vars: Dict[str, Any]) -> Optional[str]:
    """Return the active control node to resume to (top of the control stack)."""
    temp = run_vars.get("_temp")
    if not isinstance(temp, dict):
        return None
    ctrl = temp.get(CONTROL_NS_KEY)
    if not isinstance(ctrl, dict):
        return None
    stack = ctrl.get(CONTROL_STACK_KEY)
    if not isinstance(stack, list) or not stack:
        return None
    top = stack[-1]
    return top if isinstance(top, str) and top else None


def create_sequence_node_handler(
    *,
    node_id: str,
    ordered_then_handles: List[str],
    targets_by_handle: Dict[str, str],
) -> Callable:
    """Create a visual Sequence node handler (Then 0, Then 1, ...)."""

    from abstractruntime.core.models import StepPlan

    ordered = [h for h in ordered_then_handles if isinstance(h, str) and h]

    def handler(run: Any, ctx: Any) -> "StepPlan":
        # ctx unused (runtime-owned effects happen in other nodes)
        _ctrl, stack, frames = _ensure_control(run.vars)

        frame = frames.get(node_id)
        if not isinstance(frame, dict):
            frame = {"kind": "sequence", "idx": 0, "then": list(ordered)}
            frames[node_id] = frame
            stack.append(node_id)

        # Ensure this node is the active scheduler on the control stack.
        if not stack or stack[-1] != node_id:
            # Be conservative: push if missing. (Should be rare; handles resume/re-entry.)
            stack.append(node_id)

        try:
            idx = int(frame.get("idx", 0) or 0)
        except Exception:
            idx = 0

        then_handles = frame.get("then")
        if not isinstance(then_handles, list):
            then_handles = list(ordered)
            frame["then"] = then_handles

        # Dispatch next connected branch in order.
        while idx < len(then_handles):
            handle = then_handles[idx]
            idx += 1
            if not isinstance(handle, str) or not handle:
                continue
            target = targets_by_handle.get(handle)
            if isinstance(target, str) and target:
                frame["idx"] = idx
                return StepPlan(node_id=node_id, next_node=target)

        # Done: pop frame and return to parent control node if any, else complete.
        frames.pop(node_id, None)
        if stack and stack[-1] == node_id:
            stack.pop()
        else:
            # Remove any stray occurrences
            stack[:] = [x for x in stack if x != node_id]

        parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
        if parent:
            return StepPlan(node_id=node_id, next_node=parent)
        return StepPlan(
            node_id=node_id,
            complete_output={"success": True, "result": run.vars.get("_last_output")},
        )

    return handler


def create_parallel_node_handler(
    *,
    node_id: str,
    ordered_then_handles: List[str],
    targets_by_handle: Dict[str, str],
    completed_target: Optional[str],
) -> Callable:
    """Create a visual Parallel node handler (fan-out + join).

    Note: The current runtime executes a single cursor; therefore this parallel node
    provides fork/join *semantics* but executes branches deterministically (in pin order).
    """

    from abstractruntime.core.models import StepPlan

    ordered = [h for h in ordered_then_handles if isinstance(h, str) and h]
    completed = completed_target if isinstance(completed_target, str) and completed_target else None

    def handler(run: Any, ctx: Any) -> "StepPlan":
        _ctrl, stack, frames = _ensure_control(run.vars)

        frame = frames.get(node_id)
        if not isinstance(frame, dict):
            frame = {"kind": "parallel", "phase": "branches", "idx": 0, "then": list(ordered)}
            if completed:
                frame["completed_target"] = completed
            frames[node_id] = frame
            stack.append(node_id)

        if not stack or stack[-1] != node_id:
            stack.append(node_id)

        phase = frame.get("phase")
        if phase != "completed":
            try:
                idx = int(frame.get("idx", 0) or 0)
            except Exception:
                idx = 0

            then_handles = frame.get("then")
            if not isinstance(then_handles, list):
                then_handles = list(ordered)
                frame["then"] = then_handles

            while idx < len(then_handles):
                handle = then_handles[idx]
                idx += 1
                if not isinstance(handle, str) or not handle:
                    continue
                target = targets_by_handle.get(handle)
                if isinstance(target, str) and target:
                    frame["idx"] = idx
                    return StepPlan(node_id=node_id, next_node=target)

            frame["phase"] = "completed"

        # Join point: run Completed chain (if connected), otherwise return up/complete.
        frames.pop(node_id, None)
        if stack and stack[-1] == node_id:
            stack.pop()
        else:
            stack[:] = [x for x in stack if x != node_id]

        completed_target2 = completed
        if isinstance(frame, dict):
            ct = frame.get("completed_target")
            if isinstance(ct, str) and ct:
                completed_target2 = ct

        if completed_target2:
            return StepPlan(node_id=node_id, next_node=completed_target2)

        parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
        if parent:
            return StepPlan(node_id=node_id, next_node=parent)
        return StepPlan(
            node_id=node_id,
            complete_output={"success": True, "result": run.vars.get("_last_output")},
        )

    return handler


