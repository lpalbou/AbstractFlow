#!/usr/bin/env python3
"""THE DRIFT PIN (cleanup adversary P0-1, 2026-07-25): the entity node
contract is spelled in four places — wf_common builders (pins the emitted
JSON declares), the executor's ENTITY_MEMORY_EFFECT_PINS (payload keys
forwarded), the compiler's effect-result allowlist (result keys exposed as
pins), and the editor palette (nodes.ts). Six live drift instances shipped
in one night with no pin — including a byte-for-byte recreation of the
ttl_activity starvation the executor comment memorializes. This check makes
the alignment structural: run it after touching ANY of the four surfaces.

Checks:
  1. Every wf_common entity-node INPUT pin is forwarded by the executor map
     (or named in SUBSET_BY_DESIGN — deliberate omissions, never silence).
  2. Every wf_common entity-node OUTPUT pin is servable: in the compiler's
     result allowlist or the universal set {result, success, exec-out}.
  3. Every edge in the emitted entity-*.json flows that targets an entity
     node lands on a forwarded pin (a renamed pin silently starves the
     handler — the map comment's law, now enforced).
  4. The editor palette (nodes.ts) declares the same pin ids as wf_common
     for every entity node type (the UI is the fifth copy).

Exit 0 = aligned; nonzero prints every drift with its surface pair.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FLOWS = HERE.parent / "examples" / "flows"

sys.path.insert(0, str(HERE))
import wf_common  # noqa: E402

EXEC_PATH = ROOT / "abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py"
COMPILER_PATH = ROOT / "abstractruntime/src/abstractruntime/visualflow_compiler/compiler.py"
NODES_TS = HERE.parent / "src" / "types" / "nodes.ts"

# Deliberate wf_common subsets of the executor's forwardable pins — named so
# silence is never ambiguity (the adversary's rule). These pins EXIST on the
# wire for advanced authors (set via pinDefaults / editor), the helper just
# doesn't surface them.
SUBSET_BY_DESIGN = {
    "memory_recall": {"patterns", "escalation_reason", "journal", "trace_id",
                      "anchor_record_ids", "budget", "scopes", "view",
                      "effort", "cue_text", "turn_id", "participants"},
    "memory_probe": {"depth", "max_records", "token_budget", "record_ids",
                     "op", "cue", "reason", "effort"},
    "memory_commit": {"trace_id", "used_record_ids", "prompt_token_estimate"},
    "memory_form": {"records", "scope", "turn_id", "idempotency_key"},
    "memory_appraise": {"target_ids", "scar", "bond", "scar_id", "bond_id",
                        "lesson_record_id", "at_seq"},
    "diary_write": {"as_of_seq", "remind_at", "resolves", "explores",
                    "receipts", "gist", "anchor_record_ids",
                    "anchor_graph_ids"},
    "memory_consolidate": {"include_dream", "include_identity", "report_only"},
    "diary_read": {"turn_id"},
}
UNIVERSAL_OUTPUTS = {"result", "success", "exec-out"}
NON_PAYLOAD_INPUTS = {"exec-in", "permissions"}

FAILURES: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)
    print(f"[DRIFT] {msg}")


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def parse_executor_map() -> dict[str, set[str]]:
    """ENTITY_MEMORY_EFFECT_PINS: node_type -> forwarded payload pins.

    Brace-count to the map's true close (a naive `\\n\\}` matched the first
    dedented brace INSIDE the structure once entity_tools_* was appended —
    the pin caught its own parser drift, which is the point)."""
    src = EXEC_PATH.read_text()
    anchor = src.find("ENTITY_MEMORY_EFFECT_PINS")
    brace = src.find("{", anchor)
    depth = 0
    end = brace
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    body = src[brace + 1:end]
    if not body:
        fail("executor: ENTITY_MEMORY_EFFECT_PINS not found")
        return {}
    # Strip # comment lines FIRST (runtime interleaves them between the
    # effect string and the pin tuple — memory_tend's channel note broke a
    # comment-blind regex).
    body = "\n".join(ln for ln in body.splitlines()
                     if not ln.strip().startswith("#"))
    out: dict[str, set[str]] = {}
    # Each entry: "node_type": ( "effect", ( "pin", "pin", ... ) ),
    for entry in re.finditer(
            r"\"([a-z_]+)\":\s*\(\s*\"([a-z_]+)\",\s*\((.*?)\),?\s*\),", body, re.S):
        node_type, _eff, pins_src = entry.groups()
        out[node_type] = set(re.findall(r"\"([a-z_]+)\"", pins_src))
    return out


def parse_compiler_allowlist() -> set[str]:
    # Two `elif effect_type in ENTITY_MEMORY_EFFECT_PINS` sites exist in
    # compiler.py (base-handler dispatch + result mapping); the allowlist is
    # the `for pin in (...)` tuple that contains "trace_id" — anchor on
    # content, not position (the first-match anchor produced false drift).
    src = COMPILER_PATH.read_text()
    for m in re.finditer(r"for pin in \((.*?)\):", src, re.S):
        names = set(re.findall(r"\"([a-z_]+)\"", m.group(1)))
        if "trace_id" in names and "handles" in names:
            return names
    fail("compiler: entity result-pin allowlist not found")
    return set()


def entity_nodes_from_wf_common() -> dict[str, dict]:
    builders = {
        "memory_recall": wf_common.memory_recall_node,
        "memory_commit": wf_common.memory_commit_node,
        "memory_form": wf_common.memory_form_node,
        "memory_adjust": wf_common.memory_adjust_node,
        "memory_appraise": wf_common.memory_appraise_node,
        "diary_write": wf_common.diary_write_node,
        "diary_read": wf_common.diary_read_node,
        "memory_consolidate": wf_common.memory_consolidate_node,
        "memory_probe": wf_common.memory_probe_node,
        "life_query": wf_common.life_query_node,
        "memory_tend": wf_common.memory_tend_node,
        "entity_tools_query": wf_common.entity_tools_query_node,
        "entity_tools_execute": wf_common.entity_tools_execute_node,
    }
    return {t: fn("x", "x", 0, 0) for t, fn in builders.items()}


def parse_nodes_ts() -> dict[str, tuple[set[str], set[str]]]:
    """Palette entries: type -> (input ids, output ids).

    Slice the ENTITY_NODES block FIRST — a whole-file regex let an earlier
    node's `{ type:` swallow memory_recall's entry up to the first
    `category: 'entity'` (found the hard way on this pin's first run)."""
    src = NODES_TS.read_text()
    start = src.find("const ENTITY_NODES")
    end = src.find("];", start)
    block = src[start:end]
    out: dict[str, tuple[set[str], set[str]]] = {}
    for m in re.finditer(r"type:\s*'([a-z_]+)'(.*?)category:\s*'entity'", block, re.S):
        t, body = m.groups()
        # Line-based array extraction: pin descriptions legitimately contain
        # ']' (rendered examples), so non-greedy ...\] truncates mid-array.
        # The arrays close at a 4-space-indented '],' line — split on that.
        im = re.search(r"inputs:\s*\[(.*?)\n\s{4}\]", body, re.S)
        om = re.search(r"outputs:\s*\[(.*?)\n\s{4}\]", body, re.S)
        ins = set(re.findall(r"id:\s*'([a-z_-]+)'", im.group(1))) if im else set()
        outs = set(re.findall(r"id:\s*'([a-z_-]+)'", om.group(1))) if om else set()
        out[t] = (ins, outs)
    return out


def main() -> int:
    exec_map = parse_executor_map()
    allowlist = parse_compiler_allowlist() | UNIVERSAL_OUTPUTS
    nodes = entity_nodes_from_wf_common()
    palette = parse_nodes_ts()

    if not exec_map or not allowlist:
        return 1

    # Check 0: every wf_common entity type exists in the executor map.
    for t in nodes:
        if t not in exec_map:
            fail(f"{t}: wf_common builds it but the executor map lacks it")

    for t, n in nodes.items():
        fwd = exec_map.get(t, set())
        ins = {p["id"] for p in n["data"]["inputs"]} - NON_PAYLOAD_INPUTS
        outs = {p["id"] for p in n["data"]["outputs"]}

        # 1. inputs ⊆ forwarded
        for p in sorted(ins - fwd):
            fail(f"{t}.{p}: wf_common declares an INPUT the executor never forwards (silent starvation)")
        # deliberate-subset bookkeeping: forwarded pins the helper omits must be named
        for p in sorted(fwd - ins - SUBSET_BY_DESIGN.get(t, set())):
            fail(f"{t}.{p}: executor forwards it but wf_common omits it UNDECLARED (name it in SUBSET_BY_DESIGN or add the pin)")
        # 2. outputs servable
        for p in sorted(outs - allowlist):
            fail(f"{t}.{p}: wf_common declares an OUTPUT the compiler allowlist cannot serve (starved pin)")
        # 4. palette parity
        if t in palette:
            pi, po = palette[t]
            pi = pi - NON_PAYLOAD_INPUTS - {"exec-in"}
            for p in sorted(ins - pi):
                fail(f"{t}.{p}: wf_common input missing from the editor palette (nodes.ts)")
            for p in sorted(pi - ins):
                fail(f"{t}.{p}: palette declares an input wf_common lacks (fifth-copy drift)")
            for p in sorted((outs - {"exec-out"}) - po):
                fail(f"{t}.{p}: wf_common output missing from the editor palette (nodes.ts)")
        else:
            fail(f"{t}: no editor palette entry found in nodes.ts")

    # 3. emitted flow edges into entity nodes land on forwarded pins
    for fp in sorted(FLOWS.glob("entity-*.json")):
        flow = json.loads(fp.read_text())
        types = {node["id"]: (node.get("data", {}).get("nodeType") or node.get("type"))
                 for node in flow.get("nodes", [])}
        for e in flow.get("edges", []):
            tt = types.get(e.get("target"))
            if tt in exec_map:
                th = e.get("targetHandle")
                if th in ("exec-in",):
                    continue
                if th not in exec_map[tt]:
                    fail(f"{fp.name}: edge into {tt}.{th} targets a pin the executor never forwards")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} DRIFT(S) — the four-copy contract is misaligned")
        return 1
    ok(f"contract aligned across executor map, compiler allowlist, wf_common, palette, and {len(list(FLOWS.glob('entity-*.json')))} emitted flows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
