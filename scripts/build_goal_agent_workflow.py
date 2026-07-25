#!/usr/bin/env python3
"""Generator for the goal-agent bundle (laurent dm#52; coder-tui c4302).

Contract (posted commons c4972): bundle_id goal-agent, entrypoint goal-agent,
interface abstractcode.goal.v1 — inputs: goal, max_cycles (default 10),
pace_seconds (default 0), provider, model (workspace rides the ambient run
workspace); outputs: result, cycles_used, stopped_reason
(verified-done|max-cycles|no-progress-stall), success.

Settled design (coder-tui c4302 fold of the /goal answers): a while-loop over
ONE ReAct cycle per iteration; goal + progress in run vars; wait_until pacing
between cycles; stop = verified-done OR max_cycles. Progress evidence is a
VERIFIER VERDICT (independent llm_call with a response schema over the
worker's transcript + workspace listing), NEVER the worker's self-report —
the worker's "done" claim alone cannot stop the loop.

Structural spine: the multiagent/coding-agent idioms — zero backward exec
edges, one state fold per iteration consumed by exactly ONE set_var, every
post-write reader pulls a fresh get_var, a no-progress stall guard (two
consecutive cycles with no verifier-acknowledged progress ends the run
honestly).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W
from wf_common import (
    EXEC_IN, EXEC_OUT, pin, node, edge, base_flow, agent_node, code_node,
    get_var, set_var, while_node, llm_node, get_node,
    validate_edges, write_json, FLOWS_DIR,
)

BUNDLE_ID = "goal-agent"
BUNDLE_VERSION = "0.0.1"
FLOW_ID = "goal-agent"
GOAL_INTERFACE = "abstractcode.goal.v1"
STATE_VAR = "ga.state"


def if_node(node_id, label, x, y):
    return node(node_id, "if", label, x, y,
                inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
                outputs=[pin("true", "true", "execution"),
                         pin("false", "false", "execution")],
                extra={"icon": "&#x1F500;", "headerColor": "#F39C12"})


def wait_until_node(node_id, label, x, y):
    # The shipped wait_until node takes a `duration` (seconds by default) and
    # computes the UTC deadline itself in the runtime clock (executor
    # _create_wait_until_handler) - no client-side date arithmetic needed.
    return node(node_id, "wait_until", label, x, y,
                inputs=[EXEC_IN, pin("duration", "duration", "number")],
                outputs=[EXEC_OUT],
                pin_defaults={"durationType": "seconds"},
                extra={"icon": "&#x23F0;", "headerColor": "#F39C12"})


INIT_CODE = r"""
g = str(goal or "").strip()
mc = int(max_cycles or 10)
if mc < 1:
    mc = 1
if mc > 100:
    mc = 100
ps = float(pace_seconds or 0)
if ps < 0:
    ps = 0
if ps > 86400:
    ps = 86400
state = {
    "goal": g, "max_cycles": mc, "pace_seconds": ps,
    "cycles_used": 0, "done": False, "no_progress": 0,
    "progress_log": [], "last_verdict": {}, "stopped_reason": "",
}
failures = []
if not g:
    failures.append("goal-agent: empty goal")
return {"state": state, "ok": len(failures) == 0, "failures": failures}
""".strip()

COND_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
done = bool(s.get("done"))
used = int(s.get("cycles_used", 0) or 0)
mc = int(s.get("max_cycles", 10) or 10)
# no-progress stall: two consecutive verifier verdicts acknowledging zero
# progress end the run honestly (an unattended loop must not burn max_cycles
# repeating a stuck approach)
stalled = int(s.get("no_progress", 0) or 0) >= 2
pace = float(s.get("pace_seconds", 0) or 0)
return {"condition": (not done) and (not stalled) and (used < mc),
        "pace_on": pace > 0}
""".strip()

WORKER_PROMPT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
g = str(s.get("goal") or "")
used = int(s.get("cycles_used", 0) or 0)
log = s.get("progress_log") if isinstance(s.get("progress_log"), list) else []
hist = ""
for entry in log[-6:]:
    hist = hist + "- " + str(entry) + "\n"
v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
remaining = str(v.get("remaining") or "").strip()
p = ("You are working toward this GOAL across multiple bounded cycles:\n" + g +
     "\n\nThis is cycle " + str(used + 1) + ". Do ONE focused increment of real work now - "
     "use your tools, verify what you did, and end with a short factual summary of "
     "(a) what you actually did this cycle and (b) what concretely remains.")
if hist:
    p = p + "\n\nVerified progress so far:\n" + hist
if remaining:
    p = p + "\nThe verifier says this remains:\n" + remaining
return {"prompt": p}
""".strip()

VERIFIER_PROMPT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
g = str(s.get("goal") or "")
w = str(worker_response or "").strip()
if len(w) > 6000:
    w = w[:6000] + "\n[...truncated #TRUNCATION]"
p = ("You are the independent VERIFIER for a goal loop. The GOAL:\n" + g +
     "\n\nThe worker's report for this cycle:\n" + w +
     "\n\nJudge STRICTLY on evidence in the report (files named, commands run, outputs shown) - "
     "a bare claim of completion without evidence is NOT done and NOT progress. Return JSON: "
     "done (boolean: the WHOLE goal is verifiably complete), progressed (boolean: this cycle "
     "produced real verifiable progress), summary (one factual line of what was achieved), "
     "remaining (what concretely remains, empty if done).")
schema = {"type": "object", "properties": {
    "done": {"type": "boolean"}, "progressed": {"type": "boolean"},
    "summary": {"type": "string"}, "remaining": {"type": "string"}},
    "required": ["done", "progressed", "summary"]}
return {"prompt": p, "schema": schema}
""".strip()

FOLD_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
v = verdict if isinstance(verdict, dict) else {}
# verifier death/no-verdict is NOT progress and NOT done (never trust absence)
done = bool(v.get("done")) if "done" in v else False
progressed = bool(v.get("progressed")) if "progressed" in v else False
summary = str(v.get("summary") or "").strip()
s2["cycles_used"] = int(s.get("cycles_used", 0) or 0) + 1
s2["done"] = done
s2["last_verdict"] = {"done": done, "progressed": progressed,
                      "summary": summary[:300],
                      "remaining": str(v.get("remaining") or "")[:500]}
log = s.get("progress_log") if isinstance(s.get("progress_log"), list) else []
log = list(log)
if summary:
    log.append(("cycle " + str(s2["cycles_used"]) + ": " + summary)[:240])
s2["progress_log"] = log[-20:]
if "done" not in v:
    s2["no_progress"] = int(s.get("no_progress", 0) or 0) + 1
    lw = list(s2.get("progress_log") or [])
    lw.append("cycle " + str(s2["cycles_used"]) + ": verifier returned no verdict (#FALLBACK)")
    s2["progress_log"] = lw[-20:]
elif progressed:
    s2["no_progress"] = 0
else:
    s2["no_progress"] = int(s.get("no_progress", 0) or 0) + 1
return {"state": s2}
""".strip()

FINAL_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
done = bool(s.get("done"))
used = int(s.get("cycles_used", 0) or 0)
mc = int(s.get("max_cycles", 10) or 10)
stalled = int(s.get("no_progress", 0) or 0) >= 2
v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
log = s.get("progress_log") if isinstance(s.get("progress_log"), list) else []
if done:
    reason = "verified-done"
elif stalled:
    reason = "no-progress-stall (two consecutive cycles without verifiable progress)"
elif used >= mc:
    reason = "max-cycles"
else:
    reason = "stopped"
lines = ["# Goal-agent result", ""]
lines.append("Goal: " + str(s.get("goal") or ""))
lines.append("Outcome: " + reason)
lines.append("Cycles used: " + str(used) + " / " + str(mc))
if log:
    lines.append("")
    lines.append("Verified progress log:")
    for entry in log:
        lines.append("- " + str(entry))
remaining = str(v.get("remaining") or "").strip()
if remaining and not done:
    lines.append("")
    lines.append("Remaining (verifier):")
    lines.append(remaining)
return {"result": "\n".join(lines), "success": done,
        "cycles_used": used, "stopped_reason": reason}
""".strip()

REFUSE_CODE = r"""
fails = failures if isinstance(failures, list) else []
lines = ["# Goal-agent refused", ""]
for f in fails:
    lines.append("- " + str(f))
return {"result": "\n".join(lines), "reason": "refused-empty-goal",
        "cycles": 0, "ok": False}
""".strip()


def build_flow() -> dict:
    f = base_flow(FLOW_ID, "Goal agent",
                  "Bounded goal loop: [one ReAct work cycle -> independent verifier "
                  "verdict -> fold]xN with optional wait_until pacing; stops on "
                  "verified-done, max_cycles, or a two-cycle no-progress stall. "
                  "Progress evidence is the verifier's verdict, never worker "
                  "self-report.",
                  interfaces=[GOAL_INTERFACE])
    N, E = f["nodes"], f["edges"]

    N.append(node("start", "on_flow_start", "Goal", -1500, 0,
                  outputs=[EXEC_OUT,
                           pin("goal", "goal", "string"),
                           pin("max_cycles", "max_cycles", "number"),
                           pin("pace_seconds", "pace_seconds", "number"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model"),
                           pin("tools", "tools", "array")],
                  pin_defaults={"goal": "", "max_cycles": 10, "pace_seconds": 0}))
    N.append(code_node("init", "Init goal state", INIT_CODE, -1500, 320,
                       [pin("goal", "goal", "string"),
                        pin("max_cycles", "max_cycles", "number"),
                        pin("pace_seconds", "pace_seconds", "number")]))
    N.append(set_var("seed", "Seed state", STATE_VAR, -1140, 0))
    N.append(if_node("if_ok", "Goal present?", -780, 0))
    N.append(code_node("refuse", "Refusal report", REFUSE_CODE, -780, 320,
                       [pin("failures", "failures", "array")]))
    N.append(node("end_refused", "on_flow_end", "Refused", -780, 620,
                  inputs=[EXEC_IN, pin("result", "result", "string"),
                          pin("success", "success", "boolean"),
                          pin("cycles_used", "cycles_used", "number"),
                          pin("stopped_reason", "stopped_reason", "string")]))

    # loop
    N.append(get_var("get_state", STATE_VAR, {}, -420, 320))
    N.append(code_node("cond", "Another cycle?", COND_CODE, -420, 620,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(while_node("loop", "Goal loop", -420, 0))

    N.append(code_node("worker_prompt", "Worker prompt", WORKER_PROMPT_CODE, -60, -260,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("worker", "Worker (one cycle)", -60, 0,
                        pin_defaults={"max_iterations": 20, "temperature": 0.2}))
    N.append(code_node("verifier_prompt", "Verifier prompt", VERIFIER_PROMPT_CODE, 300, -260,
                       [pin("loop_state", "loop_state", "object"),
                        pin("worker_response", "worker_response", "string")]))
    N.append(llm_node("verifier", "Independent verifier", 300, 0))
    N.append(code_node("fold", "Fold verdict", FOLD_CODE, 660, -260,
                       [pin("verdict", "verdict", "object"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state", "Record cycle", STATE_VAR, 660, 0))
    # pacing (optional): wait_until duration=pace_seconds when pace_on
    N.append(if_node("if_pace", "Pace?", 1020, 0))
    N.append(get_var("get_state_pace", STATE_VAR, {}, 1380, 320))
    N.append(code_node("pace_dur", "Pace seconds", (
        "s = loop_state if isinstance(loop_state, dict) else {}\n"
        "return {\"duration\": float(s.get(\"pace_seconds\", 0) or 0)}"
    ), 1380, 560, [pin("loop_state", "loop_state", "object")]))
    N.append(wait_until_node("pause", "Pause between cycles", 1380, 0))

    # post-loop
    N.append(get_var("get_state_final", STATE_VAR, {}, 60, 620))
    N.append(code_node("final", "Final report", FINAL_CODE, 420, 620,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(node("end", "on_flow_end", "Result", 780, 620,
                  inputs=[EXEC_IN, pin("result", "result", "string"),
                          pin("success", "success", "boolean"),
                          pin("cycles_used", "cycles_used", "number"),
                          pin("stopped_reason", "stopped_reason", "string")]))

    def ex(a, b, *, src="exec-out", dst="exec-in"):
        E.append(edge(a, src, b, dst))

    def data(a, ah, b, bh):
        E.append(edge(a, ah, b, bh))

    ex("start", "seed")
    data("start", "goal", "init", "goal")
    data("start", "max_cycles", "init", "max_cycles")
    data("start", "pace_seconds", "init", "pace_seconds")
    data("init", "state", "seed", "value")
    ex("seed", "if_ok")
    data("init", "ok", "if_ok", "condition")
    ex("if_ok", "end_refused", src="false")
    data("init", "failures", "refuse", "failures")
    data("refuse", "result", "end_refused", "result")
    data("refuse", "ok", "end_refused", "success")
    data("refuse", "reason", "end_refused", "stopped_reason")
    data("refuse", "cycles", "end_refused", "cycles_used")

    ex("if_ok", "loop", src="true")
    data("get_state", "value", "cond", "loop_state")
    data("cond", "condition", "loop", "condition")

    ex("loop", "worker", src="loop")
    data("get_state", "value", "worker_prompt", "loop_state")
    data("worker_prompt", "prompt", "worker", "prompt")
    data("start", "provider", "worker", "provider")
    data("start", "model", "worker", "model")
    data("start", "tools", "worker", "tools")
    ex("worker", "verifier")
    data("get_state", "value", "verifier_prompt", "loop_state")
    data("worker", "response", "verifier_prompt", "worker_response")
    data("verifier_prompt", "prompt", "verifier", "prompt")
    data("verifier_prompt", "schema", "verifier", "resp_schema")
    data("start", "provider", "verifier", "provider")
    data("start", "model", "verifier", "model")
    ex("verifier", "set_state")
    data("verifier", "data", "fold", "verdict")
    data("get_state", "value", "fold", "loop_state")
    data("fold", "state", "set_state", "value")
    ex("set_state", "if_pace")
    data("cond", "pace_on", "if_pace", "condition")
    ex("if_pace", "pause", src="true")
    data("pace_dur", "duration", "pause", "duration")
    data("get_state_pace", "value", "pace_dur", "loop_state")
    # if_pace.false ends the iteration (loop re-fires); pause also ends it

    ex("loop", "end", src="done")
    data("get_state_final", "value", "final", "loop_state")
    data("final", "result", "end", "result")
    data("final", "success", "end", "success")
    data("final", "cycles_used", "end", "cycles_used")
    data("final", "stopped_reason", "end", "stopped_reason")

    # drop the deliberately-dead None append from the edge list
    f["edges"] = [e for e in f["edges"] if e is not None]
    write_json(FLOWS_DIR / f"{FLOW_ID}.json", f)
    return f


def main() -> int:
    flow = build_flow()
    problems = validate_edges(flow)
    if problems:
        print("EDGE PROBLEMS:")
        for p in problems:
            print("  " + p)
        return 1
    print(f"Wrote {FLOW_ID}.json ({len(flow['nodes'])} nodes, {len(flow['edges'])} edges)")
    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        compile_check(FLOW_ID, [FLOW_ID])
        out = pack_bundle(
            root_flow_id=FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION, entrypoints=[FLOW_ID],
            metadata={
                "family": "goal-agent",
                "purpose": ("bounded goal loop: one ReAct work cycle per iteration, "
                            "independent verifier verdict as the ONLY progress/done "
                            "evidence, optional wait_until pacing; stops on "
                            "verified-done, max_cycles, or two-cycle no-progress stall"),
                "outputs": ["result", "success", "cycles_used", "stopped_reason"],
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())