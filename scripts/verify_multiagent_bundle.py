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
        print(f"OK {name}: audit clean, 0 overlaps ({len(flow.get('nodes') or [])} nodes)")

    if bad:
        return 1
    print("verify_multiagent_bundle: all clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
