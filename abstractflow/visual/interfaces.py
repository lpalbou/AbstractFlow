"""VisualFlow interface contracts (portable host validation).

This module defines *declarative* workflow interface markers and best-effort
validators so hosts (e.g. AbstractCode) can safely treat a workflow as a
specialized capability with a known IO contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

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
            description=(
                "Host-configurable request → response contract for running a workflow as an AbstractCode agent."
            ),
            # NOTE: We require host routing/policy pins (provider/model/tools) so workflows
            # can be driven by AbstractCode without hardcoding node configs.
            required_start_outputs={
                "request": "string",
                "provider": "provider",
                "model": "model",
                "tools": "tools",
            },
            required_end_inputs={"response": "string"},
            recommended_start_outputs={
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


def apply_visual_flow_interface_scaffold(
    flow: VisualFlow,
    interface_id: str,
    *,
    include_recommended: bool = True,
) -> bool:
    """Best-effort: apply a known interface's pin scaffolding to a VisualFlow.

    This is intended for authoring UX:
    - When a workflow is marked as implementing an interface, we ensure the
      required pins exist on the expected nodes (On Flow Start / On Flow End).
    - If those nodes are missing, we create them (unconnected) so the author
      has a correct starting point.

    Returns True if the flow was mutated.
    """
    iid = str(interface_id or "").strip()
    spec = get_interface_specs().get(iid)
    if spec is None:
        return False

    def _pin_dict(pin_id: str, type_str: str, *, label: Optional[str] = None) -> Dict[str, Any]:
        return {"id": pin_id, "label": label or pin_id, "type": type_str}

    def _ensure_pin(
        pins: list[Any],
        *,
        pin_id: str,
        type_str: str,
        label: Optional[str] = None,
    ) -> bool:
        for p in pins:
            if isinstance(p, dict) and p.get("id") == pin_id:
                # Ensure type matches the interface contract.
                if p.get("type") != type_str:
                    p["type"] = type_str
                    return True
                return False
        pins.append(_pin_dict(pin_id, type_str, label=label))
        return True

    def _ensure_exec_pin(pins: list[Any], *, pin_id: str, direction: str) -> bool:
        # We keep exec pins present because most authoring UX expects them, even though the
        # interface contract itself only speaks about data pins.
        if not isinstance(direction, str) or direction not in {"in", "out"}:
            direction = "out"
        changed = False
        for p in pins:
            if isinstance(p, dict) and p.get("id") == pin_id:
                if p.get("type") != "execution":
                    p["type"] = "execution"
                    changed = True
                # exec pins typically have empty label; keep existing label if present.
                return changed
        # Prepend exec pins for readability.
        pins.insert(0, {"id": pin_id, "label": "", "type": "execution"})
        return True

    # Desired pins (required + optional recommended).
    start_pins = dict(spec.required_start_outputs)
    end_pins = dict(spec.required_end_inputs)
    if include_recommended:
        if isinstance(spec.recommended_start_outputs, Mapping):
            for k, v in dict(spec.recommended_start_outputs).items():
                start_pins.setdefault(str(k), str(v))
        if isinstance(spec.recommended_end_inputs, Mapping):
            for k, v in dict(spec.recommended_end_inputs).items():
                end_pins.setdefault(str(k), str(v))

    # Locate nodes.
    nodes = list(getattr(flow, "nodes", []) or [])
    used_ids = {str(getattr(n, "id", "") or "") for n in nodes}

    def _unique_node_id(base: str) -> str:
        b = str(base or "").strip() or "node"
        if b not in used_ids:
            used_ids.add(b)
            return b
        i = 2
        while True:
            cand = f"{b}-{i}"
            if cand not in used_ids:
                used_ids.add(cand)
                return cand
            i += 1

    def _ensure_nodes() -> Tuple[Any, List[Any], bool]:
        changed_local = False
        starts = [n for n in nodes if _node_type_str(n) == "on_flow_start"]
        ends = [n for n in nodes if _node_type_str(n) == "on_flow_end"]

        if not starts:
            try:
                from .models import NodeType, Position, VisualNode
            except Exception:
                # Should not happen in normal installs; bail out gracefully.
                return (None, ends, False)
            start_id = _unique_node_id("start")
            start = VisualNode(
                id=start_id,
                type=NodeType.ON_FLOW_START,
                position=Position(x=-420.0, y=120.0),
                data={
                    "nodeType": "on_flow_start",
                    "label": "On Flow Start",
                    "icon": "&#x1F3C1;",
                    "headerColor": "#C0392B",
                    "inputs": [],
                    "outputs": [{"id": "exec-out", "label": "", "type": "execution"}],
                },
            )
            nodes.insert(0, start)
            changed_local = True
            starts = [start]

        if not ends:
            try:
                from .models import NodeType, Position, VisualNode
            except Exception:
                return (starts[0], [], changed_local)
            end_id = _unique_node_id("end")
            end = VisualNode(
                id=end_id,
                type=NodeType.ON_FLOW_END,
                position=Position(x=260.0, y=120.0),
                data={
                    "nodeType": "on_flow_end",
                    "label": "On Flow End",
                    "icon": "&#x23F9;",
                    "headerColor": "#C0392B",
                    "inputs": [{"id": "exec-in", "label": "", "type": "execution"}],
                    "outputs": [],
                },
            )
            nodes.append(end)
            changed_local = True
            ends = [end]

        return (starts[0], ends, changed_local)

    start_node, end_nodes, changed = _ensure_nodes()
    if start_node is None:
        return False

    # Ensure pins on start.
    start_data = getattr(start_node, "data", None)
    if not isinstance(start_data, dict):
        start_data = {}
        setattr(start_node, "data", start_data)
        changed = True
    outputs = start_data.get("outputs")
    if not isinstance(outputs, list):
        outputs = []
        start_data["outputs"] = outputs
        changed = True
    changed = _ensure_exec_pin(outputs, pin_id="exec-out", direction="out") or changed
    for pid, t in start_pins.items():
        changed = _ensure_pin(outputs, pin_id=str(pid), type_str=str(t), label=str(pid)) or changed

    # Ensure pins on all end nodes.
    for end in end_nodes:
        end_data = getattr(end, "data", None)
        if not isinstance(end_data, dict):
            end_data = {}
            setattr(end, "data", end_data)
            changed = True
        inputs = end_data.get("inputs")
        if not isinstance(inputs, list):
            inputs = []
            end_data["inputs"] = inputs
            changed = True
        changed = _ensure_exec_pin(inputs, pin_id="exec-in", direction="in") or changed
        for pid, t in end_pins.items():
            changed = _ensure_pin(inputs, pin_id=str(pid), type_str=str(t), label=str(pid)) or changed

    # Write back nodes list if it was reconstructed.
    try:
        flow.nodes = nodes  # type: ignore[assignment]
    except Exception:
        pass

    # Ensure entryNode points at the start when missing/empty.
    try:
        entry = getattr(flow, "entryNode", None)
        if not isinstance(entry, str) or not entry.strip():
            flow.entryNode = str(getattr(start_node, "id", "") or "") or None
            changed = True
    except Exception:
        pass

    return bool(changed)

