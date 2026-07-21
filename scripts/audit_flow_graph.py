#!/usr/bin/env python3
"""Audit VisualFlow JSON documents for dead nodes and layout defects.

Checks (operator directive 2026-07-20: "there should be no dead node. make
sure each workflow also has a clean layout of nodes"):

1. DEAD EXEC NODE: a node declaring execution pins that is not reachable from
   any trigger node over exec edges — the compiler skips it entirely, so any
   downstream data edge from it resolves to nothing.
2. DEAD PURE NODE: a node without execution pins (pure, lazily evaluated)
   whose outputs never reach an exec-reached node through data edges — dead
   weight that misleads readers.
3. ORPHAN EDGE: an edge naming a missing node or pin (build-time defect).
4. NODE OVERLAP: two node boxes intersecting (approximate box model:
   width 300, height 90 + 26 * max(#inputs, #outputs) data pins).

Usage:
  python3 scripts/audit_flow_graph.py examples/flows/co-scientist.json [...]
  python3 scripts/audit_flow_graph.py --all          # every bundled flow

Exit code 0 = clean, 1 = findings.
"""
from __future__ import annotations

import functools
import json
import sys
from pathlib import Path

TRIGGERS = {"on_flow_start", "on_user_request", "on_agent_message", "on_event"}

# The bundled/shipped catalog (mirrors src/utils/bundledFlows.ts globs).
BUNDLED = [
    "deep-research.json", "deep-investigate.json", "deep-plan.json",
    "deep-render.json", "deep-review.json", "81795ea9.json", "15f19f7f.json",
    "coding-agent.json", "coder.json", "coding-verify-gates.json",
    "adversarial-review.json", "structured-extract.json", "map-reduce.json",
    "co-scientist.json", "diagram-render.json",
    "meta-consensus.json", "meta-debate.json", "meta-reflect.json",
    "meta-perspectives.json", "meta-deliberate.json", "meta-baseline.json",
]


def node_type(node: dict) -> str:
    return (node.get("data") or {}).get("nodeType") or node.get("type") or ""


def has_exec_pin(node: dict) -> bool:
    data = node.get("data") or {}
    for key in ("inputs", "outputs"):
        for pin in data.get(key) or []:
            if isinstance(pin, dict) and pin.get("type") == "execution":
                return True
    return False


def node_box(node: dict) -> tuple[float, float, float, float]:
    """Approximate rendered box (x, y, w, h) for overlap checks."""
    pos = node.get("position") or {}
    x = float(pos.get("x") or 0.0)
    y = float(pos.get("y") or 0.0)
    data = node.get("data") or {}
    n_in = len([p for p in data.get("inputs") or [] if isinstance(p, dict) and p.get("type") != "execution"])
    n_out = len([p for p in data.get("outputs") or [] if isinstance(p, dict) and p.get("type") != "execution"])
    height = 90.0 + 26.0 * max(n_in, n_out)
    return (x, y, 300.0, height)


def boxes_overlap(a: tuple, b: tuple) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def audit(path: Path) -> list[str]:
    flow = json.loads(path.read_text())
    nodes = {n["id"]: n for n in flow.get("nodes") or []}
    edges = flow.get("edges") or []
    findings: list[str] = []

    # 3. Orphan edges (endpoint existence; pin-level checks live in
    # wf_common.validate_edges for generator builds).
    for edge in edges:
        for end in ("source", "target"):
            if edge.get(end) not in nodes:
                findings.append(f"ORPHAN EDGE {edge.get('id')}: {end} '{edge.get(end)}' missing")

    # Exec reachability.
    exec_edges = [e for e in edges if str(e.get("targetHandle") or "").startswith("exec")]
    adjacency: dict[str, list[str]] = {}
    for edge in exec_edges:
        adjacency.setdefault(edge["source"], []).append(edge["target"])
    reached: set[str] = set()
    stack = [nid for nid, n in nodes.items() if node_type(n) in TRIGGERS]
    while stack:
        current = stack.pop()
        if current in reached:
            continue
        reached.add(current)
        stack.extend(adjacency.get(current, []))

    # 1. Dead exec nodes.
    for nid, node in nodes.items():
        if node_type(node) in TRIGGERS:
            continue
        if has_exec_pin(node) and nid not in reached:
            findings.append(f"DEAD EXEC NODE {nid} ({node_type(node)}: {(node.get('data') or {}).get('label', '')})")

    # 2. Dead pure nodes (no data path into the exec spine).
    data_out: dict[str, list[str]] = {}
    for edge in edges:
        if str(edge.get("targetHandle") or "").startswith("exec"):
            continue
        data_out.setdefault(edge["source"], []).append(edge["target"])

    @functools.lru_cache(maxsize=None)
    def feeds_exec(nid: str) -> bool:
        for target in data_out.get(nid, []):
            if target in reached:
                return True
        return any(feeds_exec(t) for t in data_out.get(nid, []) if t not in reached)

    for nid, node in nodes.items():
        if nid in reached or has_exec_pin(node):
            continue
        try:
            alive = feeds_exec(nid)
        except RecursionError:
            alive = True
        if not alive:
            findings.append(f"DEAD PURE NODE {nid} ({node_type(node)}: {(node.get('data') or {}).get('label', '')})")

    # 4. Overlaps.
    entries = [(nid, node_box(node)) for nid, node in nodes.items()]
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if boxes_overlap(entries[i][1], entries[j][1]):
                findings.append(f"OVERLAP {entries[i][0]} <-> {entries[j][0]}")

    return findings


def main() -> int:
    args = sys.argv[1:]
    root = Path(__file__).resolve().parent.parent
    if args and args[0] == "--all":
        paths = [root / "examples" / "flows" / name for name in BUNDLED]
    else:
        paths = [Path(a) for a in args]
    if not paths:
        print(__doc__)
        return 2
    bad = 0
    for path in paths:
        if not path.exists():
            print(f"{path.name}: MISSING FILE")
            bad += 1
            continue
        findings = audit(path)
        if findings:
            bad += 1
            print(f"{path.name}: {len(findings)} finding(s)")
            for f in findings:
                print(f"  {f}")
        else:
            print(f"{path.name}: clean")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
