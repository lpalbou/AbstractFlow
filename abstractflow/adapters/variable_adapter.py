"""Variable node adapters (Blueprint-style Get/Set Variable).

Design goals:
- Variables are stored durably in `run.vars` (so pause/resume works).
- `Set Variable` must not clobber the visual pipeline `_last_output` (pass-through),
  otherwise inserting it into a chain would destroy downstream inputs.
"""

from __future__ import annotations

import json
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


def _get_by_path(source: Dict[str, Any], dotted_key: str) -> Any:
    """Best-effort dotted-path lookup supporting dicts (and nested dicts).

    This is intentionally conservative: workflow variables (`run.vars`) are dict-like state.
    """
    parts = [p for p in str(dotted_key or "").split(".") if p]
    if not parts:
        return None
    current: Any = source
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _set_on_object(obj: Dict[str, Any], dotted_key: str, value: Any) -> Dict[str, Any]:
    """Set a nested key on an object dict (mutates the given dict) and return it."""
    parts = [p for p in str(dotted_key or "").split(".") if p]
    if not parts:
        return obj
    cur: Dict[str, Any] = obj
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value
    return obj


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


def create_set_var_property_node_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    data_aware_handler: Optional[Callable[[Any], Any]],
    flow: Any,
) -> Callable:
    """Create a handler for `set_var_property` visual nodes.

    Contract:
    - Inputs:
      - `name`: base variable path (e.g. "state" or "state.player")
      - `key`: nested key path inside that variable's object (e.g. "hp" or "stats.hp")
      - `value`: value to set at `key`
    - Behavior:
      - reads current object at `name` (defaults to `{}` if missing/not an object)
      - applies the update to a copy
      - writes the updated object back into `run.vars[name]` (durable)
      - persists node outputs for pause/resume
      - does NOT clobber `_last_output` (pass-through)
    """
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
            run.vars["_flow_error"] = "Set Variable Property requires a non-empty variable name."
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

        raw_key = payload.get("key")
        key = (raw_key if isinstance(raw_key, str) else str(raw_key or "")).strip()
        if not key:
            run.vars["_flow_error"] = "Set Variable Property requires a non-empty key."
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        value = payload.get("value")

        try:
            if not isinstance(run.vars, dict):
                raise ValueError("run.vars is not a dict")

            current = _get_by_path(run.vars, name)
            base_obj: Dict[str, Any] = dict(current) if isinstance(current, dict) else {}
            _set_on_object(base_obj, key, value)
            _set_by_path(run.vars, name, base_obj)
        except Exception as e:
            run.vars["_flow_error"] = f"Failed to set variable property '{name}.{key}': {e}"
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        # Persist this node's outputs for pause/resume (data edges may depend on them).
        _persist_node_output(run.vars, node_id, {"value": base_obj})

        # IMPORTANT: pass-through semantics (do NOT clobber the pipeline output).
        # `_last_output` stays as-is.
        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        return StepPlan(node_id=node_id, complete_output={"success": True, "value": base_obj, "result": run.vars.get("_last_output")})

    return handler


def create_set_vars_node_handler(
    *,
    node_id: str,
    next_node: Optional[str],
    data_aware_handler: Optional[Callable[[Any], Any]],
    flow: Any,
) -> Callable:
    """Create a handler for `set_vars` visual nodes.

    Contract:
    - Input pin: `updates` (object or JSON string), where keys are dotted paths and values are JSON-safe values.
    - Output pin: `updates` (echoed), for observability/debugging.
    - Pass-through: must NOT clobber `_last_output` (same as `set_var`).
    """
    from abstractruntime.core.models import StepPlan
    from abstractflow.compiler import _sync_effect_results_to_node_outputs

    def _coerce_updates(raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict):
            return dict(raw)
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = json.loads(raw)
            except Exception:
                return {}
            return dict(parsed) if isinstance(parsed, dict) else {}
        return {}

    def handler(run: Any, ctx: Any) -> "StepPlan":
        del ctx
        if flow is not None and hasattr(flow, "_node_outputs") and hasattr(flow, "_data_edge_map"):
            _sync_effect_results_to_node_outputs(run, flow)

        last_output = run.vars.get("_last_output", {})
        resolved = data_aware_handler(last_output) if callable(data_aware_handler) else {}
        payload = resolved if isinstance(resolved, dict) else {}

        updates = _coerce_updates(payload.get("updates"))
        if not updates:
            # Deterministic no-op (still counts as a step, but doesn't pollute `_flow_error`).
            _persist_node_output(run.vars, node_id, {"updates": {}})
            if next_node:
                return StepPlan(node_id=node_id, next_node=next_node)
            return StepPlan(node_id=node_id, complete_output={"success": True, "updates": {}, "result": run.vars.get("_last_output")})

        # Validate all keys first so we don't partially apply.
        normalized: Dict[str, Any] = {}
        for k, v in updates.items():
            name = (k if isinstance(k, str) else str(k or "")).strip()
            if not name:
                run.vars["_flow_error"] = "Set Variables requires non-empty variable names in updates."
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
            normalized[name] = v

        try:
            if not isinstance(run.vars, dict):
                raise ValueError("run.vars is not a dict")
            for name, value in normalized.items():
                _set_by_path(run.vars, name, value)
        except Exception as e:
            run.vars["_flow_error"] = f"Failed to set variables: {e}"
            run.vars["_flow_error_node"] = node_id
            return StepPlan(
                node_id=node_id,
                complete_output={"success": False, "error": run.vars["_flow_error"], "node": node_id},
            )

        # Persist this node's outputs for pause/resume (data edges may depend on them).
        _persist_node_output(run.vars, node_id, {"updates": normalized})

        # IMPORTANT: pass-through semantics (do NOT clobber the pipeline output).
        # `_last_output` stays as-is.
        if next_node:
            return StepPlan(node_id=node_id, next_node=next_node)
        return StepPlan(node_id=node_id, complete_output={"success": True, "updates": normalized, "result": run.vars.get("_last_output")})

    return handler


