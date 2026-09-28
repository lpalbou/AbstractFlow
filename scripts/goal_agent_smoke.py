#!/usr/bin/env python3
"""Deterministic smoke for the goal-agent code nodes: sandbox-compile every
body through the real RestrictedPython wrap, then exercise the load-bearing
folds (init refusal + clamps, loop stop conditions, verdict fold incl.
verifier-death, final terminal reasons, pacing extract)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from abstractruntime.visualflow_compiler.visual.code_executor import create_code_handler  # noqa: E402
from abstractruntime.visualflow_compiler.visual.executor import _generate_code_from_body  # noqa: E402

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"
FAILURES: list[str] = []
_H: dict[str, object] = {}


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def run(code, inputs):
    h = _H.get(code) or create_code_handler(code, "transform")
    _H[code] = h
    out = h(inputs)
    if not isinstance(out, dict):
        raise RuntimeError("non-dict")
    return out


def main() -> int:
    flow = json.loads((FLOWS / "goal-agent.json").read_text())
    B = {n["id"]: _generate_code_from_body(n["data"], "transform")
         for n in flow["nodes"] if n["data"].get("nodeType") == "code"}

    compiled = 0
    for nid, code in sorted(B.items()):
        try:
            create_code_handler(code, "transform"); compiled += 1
        except Exception as e:  # noqa: BLE001
            check(f"compile:{nid}", False, str(e)[:200])
    check("sandbox-compile-all", compiled == len(B), f"{compiled}/{len(B)}")

    # init: clamps + refusal
    o = run(B["init"], {"goal": "build X", "max_cycles": 999, "pace_seconds": -5})
    check("init-clamps", o["state"]["max_cycles"] == 100 and o["state"]["pace_seconds"] == 0 and o["ok"] is True)
    o = run(B["init"], {"goal": "  ", "max_cycles": 0, "pace_seconds": 0})
    # max_cycles=0 -> `0 or 10` -> default 10 (0 is falsey, treated as unset)
    check("init-refuses-empty", o["ok"] is False and o["state"]["max_cycles"] == 10 and o["failures"])

    # cond: continue / done / max / stall / pace_on
    o = run(B["cond"], {"loop_state": {"done": False, "cycles_used": 0, "max_cycles": 10, "no_progress": 0, "pace_seconds": 0}})
    check("cond-continue", o["condition"] is True and o["pace_on"] is False)
    o = run(B["cond"], {"loop_state": {"done": True}})
    check("cond-stop-done", o["condition"] is False)
    o = run(B["cond"], {"loop_state": {"done": False, "cycles_used": 10, "max_cycles": 10}})
    check("cond-stop-max", o["condition"] is False)
    o = run(B["cond"], {"loop_state": {"done": False, "cycles_used": 1, "max_cycles": 10, "no_progress": 2}})
    check("cond-stop-stall", o["condition"] is False)
    o = run(B["cond"], {"loop_state": {"done": False, "cycles_used": 0, "max_cycles": 10, "pace_seconds": 5}})
    check("cond-pace-on", o["pace_on"] is True)

    # fold: done / progress resets stall / no-progress increments / verifier death
    st = {"cycles_used": 0, "no_progress": 0, "progress_log": []}
    o = run(B["fold"], {"verdict": {"done": True, "progressed": True, "summary": "shipped it", "remaining": ""}, "loop_state": st})
    check("fold-done", o["state"]["done"] is True and o["state"]["cycles_used"] == 1
          and o["state"]["no_progress"] == 0 and any("shipped it" in x for x in o["state"]["progress_log"]))
    o = run(B["fold"], {"verdict": {"done": False, "progressed": False, "summary": "spun", "remaining": "everything"},
                        "loop_state": {"cycles_used": 1, "no_progress": 0, "progress_log": []}})
    check("fold-no-progress-inc", o["state"]["no_progress"] == 1 and o["state"]["done"] is False)
    o2 = run(B["fold"], {"verdict": {"done": False, "progressed": False, "summary": "spun again", "remaining": "x"},
                         "loop_state": o["state"]})
    check("fold-stall-reaches-2", o2["state"]["no_progress"] == 2)
    o = run(B["fold"], {"verdict": {"done": False, "progressed": True, "summary": "real work", "remaining": "a bit"},
                        "loop_state": {"cycles_used": 3, "no_progress": 1, "progress_log": []}})
    check("fold-progress-resets-stall", o["state"]["no_progress"] == 0)
    # verifier death: verdict missing "done" key -> not done, not progress, counts against stall
    o = run(B["fold"], {"verdict": {}, "loop_state": {"cycles_used": 0, "no_progress": 0, "progress_log": []}})
    check("fold-verifier-death", o["state"]["done"] is False and o["state"]["no_progress"] == 1
          and any("no verdict" in x for x in o["state"]["progress_log"]))

    # final: reasons
    o = run(B["final"], {"loop_state": {"done": True, "cycles_used": 2, "max_cycles": 10, "goal": "g", "progress_log": ["c1: x"]}})
    check("final-done", o["stopped_reason"] == "verified-done" and o["success"] is True and o["cycles_used"] == 2)
    o = run(B["final"], {"loop_state": {"done": False, "cycles_used": 3, "max_cycles": 3, "goal": "g"}})
    check("final-max", o["stopped_reason"] == "max-cycles" and o["success"] is False)
    o = run(B["final"], {"loop_state": {"done": False, "no_progress": 2, "cycles_used": 4, "max_cycles": 10, "goal": "g",
                                        "last_verdict": {"remaining": "stuck part"}}})
    check("final-stall", "no-progress-stall" in o["stopped_reason"] and "stuck part" in o["result"])

    # worker/verifier prompts + pace
    o = run(B["worker_prompt"], {"loop_state": {"goal": "make a thing", "cycles_used": 2, "progress_log": ["c1: a", "c2: b"],
                                                "last_verdict": {"remaining": "the rest"}}})
    check("worker-prompt", "make a thing" in o["prompt"] and "cycle 3" in o["prompt"] and "the rest" in o["prompt"])
    o = run(B["verifier_prompt"], {"loop_state": {"goal": "g"}, "worker_response": "I wrote foo.py and ran it: OK"})
    check("verifier-prompt-schema", o["schema"]["required"] == ["done", "progressed", "summary"] and "foo.py" in o["prompt"])
    o = run(B["pace_dur"], {"loop_state": {"pace_seconds": 12}})
    check("pace-duration", o["duration"] == 12.0)

    # refuse
    o = run(B["refuse"], {"failures": ["goal-agent: empty goal"]})
    check("refuse", o["ok"] is False and o["cycles"] == 0 and "empty goal" in o["result"])

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {FAILURES}"); return 1
    print("SMOKE OK: all scenarios passed"); return 0


if __name__ == "__main__":
    raise SystemExit(main())
