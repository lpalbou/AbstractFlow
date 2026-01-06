"""VisualFlow interface contracts (portable host validation).

This module defines *declarative* workflow interface markers and best-effort
validators so hosts (e.g. AbstractCode) can safely treat a workflow as a
specialized capability with a known IO contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .models import VisualFlow


ABSTRACTCODE_AGENT_V1 = "abstractcode.agent.v1"


@dataclass(frozen=True)
class VisualFlowInterfaceSpec:
    interface_id: str
    label: str
    description: str
    required_start_outputs: Mapping[str, str]
    required_end_inputs: Mapping[str, str]
    recommended_start_outputs: Mapping[str, str] = None  # type: ignore[assignment]
    recommended_end_inputs: Mapping[str, str] = None  # type: ignore[assignment]


def _pin_types(pins: Any) -> Dict[str, str]:
    """Return {pin_id -> type_str} for a pin list.

    VisualFlow stores pins inside the node's `data.inputs/outputs` lists.
    """
    out: Dict[str, str] = {}
    if not isinstance(pins, list):
        return out
    for p in pins:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not pid:
            continue
        ptype = p.get("type")
        t = ptype.value if hasattr(ptype, "value") else str(ptype or "")
        out[pid] = t
    return out


def _node_type_str(node: Any) -> str:
    t = getattr(node, "type", None)
    return t.value if hasattr(t, "value") else str(t or "")


def _iter_nodes(flow: VisualFlow) -> Iterable[Any]:
    for n in getattr(flow, "nodes", []) or []:
        yield n


def get_interface_specs() -> Dict[str, VisualFlowInterfaceSpec]:
    """Return known interface specs (by id)."""
    return {
        ABSTRACTCODE_AGENT_V1: VisualFlowInterfaceSpec(
            interface_id=ABSTRACTCODE_AGENT_V1,
            label="AbstractCode Agent (v1)",
            description="Minimal request → response contract for running a workflow as an AbstractCode agent.",
            required_start_outputs={"request": "string"},
            required_end_inputs={"response": "string"},
            recommended_start_outputs={
                "provider": "provider",
                "model": "model",
                "tools": "tools",
                "context": "object",
                "max_iterations": "number",
            },
            recommended_end_inputs={
                "meta": "object",
                "scratchpad": "object",
                "raw_result": "object",
            },
        ),
    }


def validate_visual_flow_interface(flow: VisualFlow, interface_id: str) -> List[str]:
    """Validate that a VisualFlow implements a known interface contract.

    Returns a list of human-friendly error strings (empty when valid).
    """
    errors: List[str] = []
    iid = str(interface_id or "").strip()
    if not iid:
        return ["interface_id is required"]

    spec = get_interface_specs().get(iid)
    if spec is None:
        return [f"Unknown interface_id: {iid}"]

    declared = getattr(flow, "interfaces", None)
    declared_list = list(declared) if isinstance(declared, list) else []
    if iid not in declared_list:
        errors.append(f"Flow must declare interfaces: ['{iid}']")

    starts = [n for n in _iter_nodes(flow) if _node_type_str(n) == "on_flow_start"]
    if not starts:
        errors.append("Flow must include an On Flow Start node (type=on_flow_start).")
        return errors
    if len(starts) > 1:
        errors.append("Flow must include exactly one On Flow Start node (found multiple).")
        return errors

    ends = [n for n in _iter_nodes(flow) if _node_type_str(n) == "on_flow_end"]
    if not ends:
        errors.append("Flow must include at least one On Flow End node (type=on_flow_end).")
        return errors

    start = starts[0]
    start_data = getattr(start, "data", None)
    start_out = _pin_types(start_data.get("outputs") if isinstance(start_data, dict) else None)

    for pin_id, expected_type in dict(spec.required_start_outputs).items():
        if pin_id not in start_out:
            errors.append(f"On Flow Start must expose an output pin '{pin_id}' ({expected_type}).")
            continue
        actual = start_out.get(pin_id) or ""
        if expected_type and actual and actual != expected_type:
            errors.append(
                f"On Flow Start pin '{pin_id}' must be type '{expected_type}' (got '{actual}')."
            )

    # Validate all end nodes: whichever executes must satisfy the contract.
    for end in ends:
        end_data = getattr(end, "data", None)
        end_in = _pin_types(end_data.get("inputs") if isinstance(end_data, dict) else None)
        for pin_id, expected_type in dict(spec.required_end_inputs).items():
            if pin_id not in end_in:
                errors.append(
                    f"On Flow End node '{getattr(end, 'id', '')}' must expose an input pin '{pin_id}' ({expected_type})."
                )
                continue
            actual = end_in.get(pin_id) or ""
            if expected_type and actual and actual != expected_type:
                errors.append(
                    f"On Flow End node '{getattr(end, 'id', '')}' pin '{pin_id}' must be type '{expected_type}' (got '{actual}')."
                )

    return errors

