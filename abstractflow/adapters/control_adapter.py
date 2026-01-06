"""Control-flow adapters for visual execution nodes (Sequence / Parallel / Loop).

These nodes implement Blueprint-style structured flow control:
- Sequence: executes Then 0, Then 1, ... in order (each branch runs to completion)
- Parallel: executes all branches, then triggers Completed (join)
- Loop: executes Loop body sequentially for each item, then triggers Done (completed)

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


def create_loop_node_handler(
    *,
    node_id: str,
    loop_target: Optional[str],
    done_target: Optional[str],
    resolve_items: Callable[[Any], List[Any]],
) -> Callable:
    """Create a visual Loop (Foreach) node handler.

    Semantics (Blueprint-style):
    - On entry: resolve `items` once and store them durably in the control frame.
    - For each item: set `{item, index}` outputs and schedule the Loop body chain.
    - When the Loop body chain ends (or pauses/resumes), control returns here via the
      active control stack, and the next item is scheduled.
    - After the last item: schedule Done (if connected) or return to parent control.
    """

    from abstractruntime.core.models import StepPlan

    loop_next = loop_target if isinstance(loop_target, str) and loop_target else None
    done_next = done_target if isinstance(done_target, str) and done_target else None

    def _persist_node_output(run_vars: Dict[str, Any], value: Dict[str, Any]) -> None:
        temp = run_vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run_vars["_temp"] = temp
        persisted = temp.get("node_outputs")
        if not isinstance(persisted, dict):
            persisted = {}
            temp["node_outputs"] = persisted
        persisted[node_id] = value

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        _ctrl, stack, frames = _ensure_control(run.vars)

        frame = frames.get(node_id)
        if not isinstance(frame, dict):
            items = list(resolve_items(run))
            frame = {"kind": "loop", "idx": 0, "items": items}
            frames[node_id] = frame
            stack.append(node_id)

        # Ensure this node is the active scheduler on the control stack.
        if not stack or stack[-1] != node_id:
            stack.append(node_id)

        try:
            idx = int(frame.get("idx", 0) or 0)
        except Exception:
            idx = 0

        items = frame.get("items")
        if not isinstance(items, list):
            items = list(resolve_items(run))
            frame["items"] = items

        # If no loop body is connected, treat as a no-op and go to Done/parent.
        if not loop_next or idx >= len(items):
            frames.pop(node_id, None)
            if stack and stack[-1] == node_id:
                stack.pop()
            else:
                stack[:] = [x for x in stack if x != node_id]

            if done_next:
                return StepPlan(node_id=node_id, next_node=done_next)

            parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
            if parent:
                return StepPlan(node_id=node_id, next_node=parent)
            return StepPlan(node_id=node_id, complete_output={"success": True, "result": run.vars.get("_last_output")})

        # Emit per-iteration outputs without losing the pipeline output from prior nodes/iterations.
        current_item = items[idx]
        out: Dict[str, Any]
        base = run.vars.get("_last_output")
        if isinstance(base, dict):
            out = dict(base)
        else:
            out = {"input": base}
        out["item"] = current_item
        out["index"] = idx
        # Helpful for UI observability: show progress as (index+1)/total for Foreach loops.
        # This is purely additive and does not change loop semantics.
        out["total"] = len(items)

        run.vars["_last_output"] = out
        _persist_node_output(run.vars, out)

        # Advance idx *before* scheduling the body so pause/resume can't repeat an item.
        frame["idx"] = idx + 1
        return StepPlan(node_id=node_id, next_node=loop_next)

    return handler


def create_for_node_handler(
    *,
    node_id: str,
    loop_target: Optional[str],
    done_target: Optional[str],
    resolve_range: Callable[[Any], Dict[str, Any]],
    max_iterations: int = 10_000,
) -> Callable:
    """Create a visual For node handler (numeric range).

    Semantics (Blueprint-style):
    - On entry: resolve {start,end,step} once and store them durably in the control frame.
    - Each iteration: emit outputs {i, index, total} and schedule Loop body.
    - When the loop finishes: schedule Done (if connected) or return to parent control / complete.

    Notes:
    - End is exclusive, like Python's range(): step>0 runs while i<end, step<0 runs while i>end.
    - We store iteration state durably (i, index, total) for pause/resume safety.
    - A max_iterations guard prevents accidental infinite/huge loops.
    """

    from abstractruntime.core.models import StepPlan

    loop_next = loop_target if isinstance(loop_target, str) and loop_target else None
    done_next = done_target if isinstance(done_target, str) and done_target else None

    def _persist_node_output(run_vars: Dict[str, Any], value: Dict[str, Any]) -> None:
        temp = run_vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run_vars["_temp"] = temp
        persisted = temp.get("node_outputs")
        if not isinstance(persisted, dict):
            persisted = {}
            temp["node_outputs"] = persisted
        persisted[node_id] = value

    def _to_number(raw: Any) -> Optional[float]:
        try:
            if raw is None:
                return None
            if isinstance(raw, bool):
                return float(int(raw))
            if isinstance(raw, (int, float)):
                return float(raw)
            if isinstance(raw, str) and raw.strip():
                return float(raw.strip())
        except Exception:
            return None
        return None

    def _compute_total(start: float, end: float, step: float) -> int:
        # Best-effort: used for observability only.
        try:
            if step == 0:
                return 0
            if step > 0:
                span = end - start
                if span <= 0:
                    return 0
                import math

                return int(math.ceil(span / step))
            # step < 0
            span = start - end
            if span <= 0:
                return 0
            import math

            return int(math.ceil(span / (-step)))
        except Exception:
            return 0

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        _ctrl, stack, frames = _ensure_control(run.vars)

        frame = frames.get(node_id)
        if not isinstance(frame, dict):
            resolved = resolve_range(run) if callable(resolve_range) else {}
            resolved = resolved if isinstance(resolved, dict) else {}

            start = _to_number(resolved.get("start"))
            end = _to_number(resolved.get("end"))
            step = _to_number(resolved.get("step"))
            if step is None:
                step = 1.0

            if start is None or end is None:
                run.vars["_flow_error"] = "For loop requires numeric 'start' and 'end'."
                run.vars["_flow_error_node"] = node_id
                return StepPlan(
                    node_id=node_id,
                    complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
                )

            if step == 0:
                run.vars["_flow_error"] = "For loop requires a non-zero 'step'."
                run.vars["_flow_error_node"] = node_id
                return StepPlan(
                    node_id=node_id,
                    complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
                )

            total = _compute_total(start, end, step)
            frame = {"kind": "for", "start": start, "end": end, "step": step, "i": start, "index": 0, "total": total}
            frames[node_id] = frame
            stack.append(node_id)

        # Ensure this node is the active scheduler on the control stack.
        if not stack or stack[-1] != node_id:
            stack.append(node_id)

        # If no loop body is connected, treat as a no-op.
        if not loop_next:
            frames.pop(node_id, None)
            if stack and stack[-1] == node_id:
                stack.pop()
            else:
                stack[:] = [x for x in stack if x != node_id]

            if done_next:
                return StepPlan(node_id=node_id, next_node=done_next)
            parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
            if parent:
                return StepPlan(node_id=node_id, next_node=parent)
            return StepPlan(node_id=node_id, complete_output={"success": True, "result": run.vars.get("_last_output")})

        try:
            idx = int(frame.get("index", 0) or 0)
        except Exception:
            idx = 0

        if max_iterations > 0 and idx >= max_iterations:
            run.vars["_flow_error"] = f"For loop exceeded max_iterations={max_iterations}"
            run.vars["_flow_error_node"] = node_id
            frames.pop(node_id, None)
            stack[:] = [x for x in stack if x != node_id]
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        try:
            cur = float(frame.get("i", 0.0) or 0.0)
        except Exception:
            cur = 0.0
        try:
            end = float(frame.get("end", 0.0) or 0.0)
        except Exception:
            end = 0.0
        try:
            step = float(frame.get("step", 1.0) or 1.0)
        except Exception:
            step = 1.0

        # Termination (end-exclusive).
        done = (cur >= end) if step > 0 else (cur <= end)
        if done:
            frames.pop(node_id, None)
            if stack and stack[-1] == node_id:
                stack.pop()
            else:
                stack[:] = [x for x in stack if x != node_id]

            if done_next:
                return StepPlan(node_id=node_id, next_node=done_next)
            parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
            if parent:
                return StepPlan(node_id=node_id, next_node=parent)
            return StepPlan(node_id=node_id, complete_output={"success": True, "result": run.vars.get("_last_output")})

        # Emit per-iteration outputs without clobbering the pipeline output.
        base = run.vars.get("_last_output")
        out: Dict[str, Any]
        if isinstance(base, dict):
            out = dict(base)
        else:
            out = {"input": base}
        out["i"] = cur
        out["index"] = idx
        total = frame.get("total")
        if isinstance(total, int):
            out["total"] = total

        run.vars["_last_output"] = out
        _persist_node_output(run.vars, out)

        # Advance state before scheduling the body (pause/resume safety).
        frame["i"] = cur + step
        frame["index"] = idx + 1
        return StepPlan(node_id=node_id, next_node=loop_next)

    return handler


def create_while_node_handler(
    *,
    node_id: str,
    loop_target: Optional[str],
    done_target: Optional[str],
    resolve_condition: Callable[[Any], bool],
    max_iterations: int = 10_000,
) -> Callable:
    """Create a visual While node handler.

    Semantics (Blueprint-style):
    - Evaluate `condition` each time the node is entered.
    - If true: schedule Loop body.
    - If false: schedule Done (if connected) or return to parent control / complete.

    Notes:
    - Single-cursor runtime: this provides loop semantics deterministically.
    - `max_iterations` is a safety cap to avoid accidental infinite loops.
    """

    from abstractruntime.core.models import StepPlan

    loop_next = loop_target if isinstance(loop_target, str) and loop_target else None
    done_next = done_target if isinstance(done_target, str) and done_target else None

    def _persist_node_output(run_vars: Dict[str, Any], value: Dict[str, Any]) -> None:
        temp = run_vars.get("_temp")
        if not isinstance(temp, dict):
            temp = {}
            run_vars["_temp"] = temp
        persisted = temp.get("node_outputs")
        if not isinstance(persisted, dict):
            persisted = {}
            temp["node_outputs"] = persisted
        persisted[node_id] = value

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        _ctrl, stack, frames = _ensure_control(run.vars)

        frame = frames.get(node_id)
        if not isinstance(frame, dict):
            frame = {"kind": "while", "iters": 0}
            frames[node_id] = frame
            stack.append(node_id)

        if not stack or stack[-1] != node_id:
            stack.append(node_id)

        try:
            iters = int(frame.get("iters", 0) or 0)
        except Exception:
            iters = 0

        if max_iterations > 0 and iters >= max_iterations:
            run.vars["_flow_error"] = f"While loop exceeded max_iterations={max_iterations}"
            run.vars["_flow_error_node"] = node_id
            frames.pop(node_id, None)
            stack[:] = [x for x in stack if x != node_id]
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        cond = bool(resolve_condition(run))
        if not cond or not loop_next:
            # Exit: pop frame and proceed to Done/parent/complete.
            frames.pop(node_id, None)
            if stack and stack[-1] == node_id:
                stack.pop()
            else:
                stack[:] = [x for x in stack if x != node_id]

            if done_next:
                return StepPlan(node_id=node_id, next_node=done_next)

            parent = stack[-1] if stack and isinstance(stack[-1], str) and stack[-1] else None
            if parent:
                return StepPlan(node_id=node_id, next_node=parent)
            return StepPlan(
                node_id=node_id,
                complete_output={"success": True, "result": run.vars.get("_last_output")},
            )

        # Emit an iteration index (Blueprint-style convenience, like Foreach.index).
        base = run.vars.get("_last_output")
        out: Dict[str, Any]
        if isinstance(base, dict):
            out = dict(base)
        else:
            out = {"input": base}
        # Expose `item:any` for parity with Foreach loops.
        #
        # Semantics:
        # - If an upstream scheduler already set `item` (e.g. nested Loop), preserve it.
        # - Otherwise, treat the current pipeline value as the loop "item".
        #
        # This is intentionally conservative: existing flows that rely on a prior `item`
        # (from an outer loop) keep working, while standalone While loops gain a usable
        # `item` output for wiring into the loop body.
        if "item" not in out:
            out["item"] = base
        out["index"] = iters
        run.vars["_last_output"] = out
        _persist_node_output(run.vars, out)

        frame["iters"] = iters + 1
        return StepPlan(node_id=node_id, next_node=loop_next)

    return handler

