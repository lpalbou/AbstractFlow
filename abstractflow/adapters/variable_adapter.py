"""Variable node adapters (Blueprint-style Get/Set Variable).

Design goals:
- Variables are stored durably in `run.vars` (so pause/resume works).
- `Set Variable` must not clobber the visual pipeline `_last_output` (pass-through),
  otherwise inserting it into a chain would destroy downstream inputs.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


def _set_by_path(target: Dict[str, Any], dotted_key: str, value: Any) -> None:
    """Set a dotted path on a dict, creating intermediate dicts as needed."""
    parts = [p for p in dotted_key.split(".") if p]
    if not parts:
        raise ValueError("Variable name must be non-empty")
    cur: Dict[str, Any] = target
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


def _persist_node_output(run_vars: Dict[str, Any], node_id: str, value: Dict[str, Any]) -> None:
    temp = run_vars.get("_temp")
    if not isinstance(temp, dict):
        temp = {}
        run_vars["_temp"] = temp
    persisted = temp.get("node_outputs")
    if not isinstance(persisted, dict):
        persisted = {}
        temp["node_outputs"] = persisted
    persisted[node_id] = value


def create_set_var_node_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    data_aware_handler: Optional[Callable[[Any], Any]],
    flow: Any,
) -> Callable:
    """Create a handler for `set_var` visual nodes."""
    from abstractruntime.core.models import StepPlan
    from abstractflow.compiler import _sync_effect_results_to_node_outputs

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
            _sync_effect_results_to_node_outputs(run, flow)

        last_output = run.vars.get("_last_output", {})
        resolved = data_aware_handler(last_output) if callable(data_aware_handler) else {}
        payload = resolved if isinstance(resolved, dict) else {}

        raw_name = payload.get("name")
        name = (raw_name if isinstance(raw_name, str) else str(raw_name or "")).strip()
        if not name:
            run.vars["_flow_error"] = "Set Variable requires a non-empty variable name."
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )
        if name.startswith("_"):
            run.vars["_flow_error"] = f"Invalid variable name '{name}': names starting with '_' are reserved."
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        value = payload.get("value")

        try:
            if not isinstance(run.vars, dict):
                raise ValueError("run.vars is not a dict")
            _set_by_path(run.vars, name, value)
        except Exception as e:
            run.vars["_flow_error"] = f"Failed to set variable '{name}': {e}"
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        # Persist this node's outputs for pause/resume (data edges may depend on them).
        _persist_node_output(run.vars, node_id, {"value": value})

        # IMPORTANT: pass-through semantics (do NOT clobber the pipeline output).
        # `_last_output` stays as-is.

        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        return StepPlan(node_id=node_id, complete_output={"success": True, "result": run.vars.get("_last_output")})

    return handler


