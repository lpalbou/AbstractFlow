#!/usr/bin/env python3
"""One-shot gate for the shipped multiagent-coding family (layout + bundle shape).

Exit 0 = clean. Used after builder changes and before operator UI walkthrough.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOWS = ROOT / "examples" / "flows"
MULTIAGENT = (
    "multiagent-coding.json",
    "multiagent-coder.json",
    "multiagent-verify-gates.json",
)


def blob_findings(flow: dict, name: str) -> list[str]:
    """THE ANTI-BLOB GATE (operator ruling, standing since 2026-07-29).

    > "the state blob, I don't think it should ever have been created, it's
    > opaque and then we never see on the visual authoring which variable is
    > actually used ... I would completely break / remove the state blob."

    Run state is FLAT top-level vars now: writes are `set_vars`, reads are one
    `get_var` chip per variable. A `state` container coming back in ANY shape
    fails this gate by name:
      - a `set_var`/`get_var` node named `state` (or `state.<field>`)
      - a pin expression touching `vars.state` / `vars["state"]`
      - a library function body reading `vars.state`
      - a node still taking a `loop_state` container pin
    """
    out: list[str] = []
    for node in flow.get("nodes") or []:
        data = node.get("data") or {}
        node_id = node.get("id")
        if data.get("nodeType") in ("set_var", "get_var"):
            var_name = str((data.get("pinDefaults") or {}).get("name") or "")
            if var_name == "state" or var_name.startswith("state."):
                out.append(f"{name}:{node_id} {data['nodeType']} name={var_name!r}")
        for pin_id, expr in (data.get("pinExpressions") or {}).items():
            text = str(expr)
            if "vars.state" in text or 'vars["state"]' in text or "vars['state']" in text:
                out.append(f"{name}:{node_id}.{pin_id} = {text[:70]}")
        for spec in data.get("inputs") or []:
            if isinstance(spec, dict) and spec.get("id") == "loop_state":
                out.append(f"{name}:{node_id} still takes a loop_state container pin")
    for entry in flow.get("functions") or []:
        if "vars.state" in str(entry.get("code") or ""):
            out.append(f"{name}:function {entry.get('name')!r} reads vars.state")
    return out


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import wf_common as W  # noqa: E402

    bad = 0
    for name in MULTIAGENT:
        path = FLOWS / name
        if not path.exists():
            print(f"MISSING {name}")
            bad += 1
            continue
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "audit_flow_graph.py"), str(path)],
            capture_output=True,
            text=True,
        )
        line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else ""
        if proc.returncode != 0:
            print(f"AUDIT FAIL {name}: {line or proc.stderr.strip()}")
            bad += 1
            continue
        flow = json.loads(path.read_text(encoding="utf-8"))
        overlaps = W.layout_overlap_findings(flow)
        if overlaps:
            print(f"OVERLAP {name}: {len(overlaps)}")
            for finding in overlaps[:5]:
                print(f"  {finding}")
            bad += 1
            continue
        blob = blob_findings(flow, name)
        if blob:
            print(f"STATE BLOB {name}: {len(blob)}")
            for finding in blob[:5]:
                print(f"  {finding}")
            bad += 1
            continue
        print(f"OK {name}: audit clean, 0 overlaps, no state blob "
              f"({len(flow.get('nodes') or [])} nodes)")

    if bad:
        return 1
    print("verify_multiagent_bundle: all clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
