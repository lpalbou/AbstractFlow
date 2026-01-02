from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple


def _load_visual_flow(path: Path):
    from abstractflow.visual.models import VisualFlow

    return VisualFlow(**json.loads(path.read_text()))


def _pin_ids(pins: Any) -> set[str]:
    out: set[str] = set()
    if not isinstance(pins, list):
        return out
    for p in pins:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        if isinstance(pid, str) and pid:
            out.add(pid)
    return out


def _node_pin_map(vf: Any) -> Tuple[Dict[str, set[str]], Dict[str, set[str]]]:
    """Return {node_id -> input_pin_ids}, {node_id -> output_pin_ids}."""
    inputs: Dict[str, set[str]] = {}
    outputs: Dict[str, set[str]] = {}
    for n in getattr(vf, "nodes", []):
        node_id = getattr(n, "id", None)
        data = getattr(n, "data", None)
        if not isinstance(node_id, str) or not node_id:
            continue
        data_dict = data if isinstance(data, dict) else {}
        inputs[node_id] = _pin_ids(data_dict.get("inputs"))
        outputs[node_id] = _pin_ids(data_dict.get("outputs"))
    return inputs, outputs


def _find_nodes(vf: Any, node_type: str) -> list[Any]:
    out: list[Any] = []
    for n in getattr(vf, "nodes", []):
        t = getattr(n, "type", None)
        t_str = t.value if hasattr(t, "value") else str(t)
        if t_str == node_type:
            out.append(n)
    return out


def _find_first_node_by_node_type(vf: Any, node_type: str) -> Any:
    for n in getattr(vf, "nodes", []):
        data = getattr(n, "data", None)
        if isinstance(data, dict) and data.get("nodeType") == node_type:
            return n
    return None


def _edges(vf: Any) -> Iterable[Any]:
    for e in getattr(vf, "edges", []):
        yield e


def test_role_and_orchestrator_workflows_compile_and_have_basic_invariants() -> None:
    """Regression guard for shipped role workflows.

    This test catches:
    - broken pin references (edge refers to missing pin)
    - flow compilation errors (VisualFlow -> FlowRunner)
    - prompt/schema wiring mistakes (schema pin overwritten by connected data)
    """
    from abstractflow.visual.executor import create_visual_runner

    # Resolve relative to the AbstractFlow package root, not the process CWD.
    flows_dir = Path(__file__).resolve().parents[1] / "web" / "flows"
    targets = [
        "role_deep_researcher.json",
        "role_architect.json",
        "role_manager.json",
        "role_coder.json",
        "role_reviewer.json",
        "multi_agent_state_machine.json",
    ]

    # Load all flows so create_visual_runner can resolve subflows.
    all_flows = {}
    for p in flows_dir.glob("*.json"):
        try:
            vf = _load_visual_flow(p)
            all_flows[vf.id] = vf
        except Exception:
            continue

    for name in targets:
        vf = _load_visual_flow(flows_dir / name)
        runner = create_visual_runner(vf, flows=all_flows)
        assert runner.flow.validate() == []

        # Pin integrity: every edge must reference a declared pin.
        in_pins, out_pins = _node_pin_map(vf)
        for e in _edges(vf):
            src = getattr(e, "source", "")
            tgt = getattr(e, "target", "")
            sh = getattr(e, "sourceHandle", "")
            th = getattr(e, "targetHandle", "")
            assert src in out_pins, f"{name}: edge source node missing: {src}"
            assert tgt in in_pins, f"{name}: edge target node missing: {tgt}"
            assert sh in out_pins[src], f"{name}: missing source pin {src}.{sh}"
            assert th in in_pins[tgt], f"{name}: missing target pin {tgt}.{th}"

    # SOTA guardrails (hand-picked gotchas we already hit once).

    # role_architect: schema pin must be last and unconnected.
    vf_arch = _load_visual_flow(flows_dir / "role_architect.json")
    arch_concat = _find_first_node_by_node_type(vf_arch, "concat")
    assert arch_concat is not None
    arch_inputs = arch_concat.data.get("inputs") if isinstance(arch_concat.data, dict) else None
    assert isinstance(arch_inputs, list) and arch_inputs
    assert (arch_inputs[-1].get("id") if isinstance(arch_inputs[-1], dict) else None) == "f"
    assert not any(
        (getattr(e, "target", "") == arch_concat.id and getattr(e, "targetHandle", "") == "f")
        for e in _edges(vf_arch)
    ), "role_architect: schema pin 'f' must not be connected (defaults must apply)."

    # role_coder: schema pin must not be overwritten by feedback.
    vf_coder = _load_visual_flow(flows_dir / "role_coder.json")
    coder_concat = _find_first_node_by_node_type(vf_coder, "concat")
    assert coder_concat is not None
    coder_inputs = coder_concat.data.get("inputs") if isinstance(coder_concat.data, dict) else None
    assert isinstance(coder_inputs, list) and coder_inputs
    assert (coder_inputs[-1].get("id") if isinstance(coder_inputs[-1], dict) else None) == "l"
    assert not any(
        (getattr(e, "target", "") == coder_concat.id and getattr(e, "targetHandle", "") == "l")
        for e in _edges(vf_coder)
    ), "role_coder: schema pin 'l' must not be connected."

    # role_reviewer: schema pin must not be overwritten by coder_summary_md.
    vf_rev = _load_visual_flow(flows_dir / "role_reviewer.json")
    rev_concat = _find_first_node_by_node_type(vf_rev, "concat")
    assert rev_concat is not None
    rev_inputs = rev_concat.data.get("inputs") if isinstance(rev_concat.data, dict) else None
    assert isinstance(rev_inputs, list) and rev_inputs
    assert (rev_inputs[-1].get("id") if isinstance(rev_inputs[-1], dict) else None) == "n"
    assert not any(
        (getattr(e, "target", "") == rev_concat.id and getattr(e, "targetHandle", "") == "n")
        for e in _edges(vf_rev)
    ), "role_reviewer: schema pin 'n' must not be connected."

    # role_deep_researcher: break_object must use breakConfig (runtime handler expects it).
    vf_dr = _load_visual_flow(flows_dir / "role_deep_researcher.json")
    breaks = _find_nodes(vf_dr, "break_object")
    assert breaks, "role_deep_researcher: expected a break_object node."
    for n in breaks:
        data = n.data if isinstance(n.data, dict) else {}
        assert "breakConfig" in data
        assert "breakObjectConfig" not in data


