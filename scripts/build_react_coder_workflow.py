#!/usr/bin/env python3
"""Generator for the REACT-CODER family — a coding agent built as a hand-wired
llm_call + tool_calls loop, with NO agent node (operator directive 2026-07-31:
"create a react-flow and ralph-flow based on iterative llm_call + tool_call —
do NOT use the agent node").

WHY NO AGENT NODE. The `agent` node is one opaque effect: its loop, its
context growth, its stop rule and its steering handling all live inside the
runtime. Benchmarking orchestrations against each other needs the loop ITSELF
on the canvas — every cycle boundary observable, every prompt editable, the
steering fold visible as a node. So the ReAct loop is drawn:

    while (not done and cycle < max_cycles):
        drain the steer inbox  -> steering_notes           (interactive control)
        progress line          -> answer_user              (TUI live channel)
        compose the cycle prompt (task + transcript + steering)
        llm_call (tools DECLARED, so the model emits tool_calls)
        tool_calls?  yes -> execute -> fold observations into the transcript
                     no  -> wait-mode gate (ask_user) or auto-finish

MEMORY MODEL: ACCUMULATING. The transcript run var grows every cycle and is
templated into the next prompt — that is ReAct's identity, and the axis this
family is meant to measure against ralph-coder (fresh context + workspace
memory). The transcript is tail-bounded so a long run degrades honestly
instead of exploding the context.

STEERING (the mission's second half): `Runtime.steer()` / the gateway's
`inject_guidance` command queue into the steer sidecar; the run's own tick
drains pending messages into `_runtime.inbox` at the next iteration boundary.
This loop READS that inbox at the TOP OF EVERY CYCLE through a Get Variable
chip (`get_var` resolves dotted paths) and folds unseen messages into
`steering_notes`, which the prompt composer templates into the next prompt.
Dedup is a run-owned WATERMARK (`steer_seen` = how many inbox entries this
loop has consumed), so a message is applied exactly once. The loop never
mutates `_runtime.inbox`: the tick thread stays its single writer (a full
inbox backpressures in the sidecar, which is the runtime's documented and
loud failure mode, rather than the flow destroying operator words).

INTERFACES: `react-coding` is the coding.v1 root (edit on canvas);
`react-coder` is the thin abstractcode.agent.v1 wrapper the TUI picker shows.
The wrapper takes the SAME seven start pins as `multiagent-coder` and returns
the SAME contract (response / success / meta{branch, stopped_reason}) so the
two orchestrations benchmark 1:1.

DOCTRINE: flat top-level run vars (never a state blob), one `set_vars` seed,
one Get Variable chip per read, code nodes ON the exec lane, every prompt and
report sentence in an EDITABLE pin default with {{slots}}, expressions only
for derivations (the two loop laws).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W
from wf_common import (
    EXEC_IN, EXEC_OUT, AGENT_INTERFACE, pin, node, edge, base_flow, code_node,
    llm_node, while_node, subflow_node, validate_edges, write_json, FLOWS_DIR,
    call_tool_node, tool_calls_node, has_tools_node, format_tool_results_node,
    stringify_json_node, if_node, ask_user_node, answer_user_node,
    read_pin, read_vars,
)

BUNDLE_ID = "react-coding"
BUNDLE_VERSION = "0.1.1"
ROOT_FLOW_ID = "react-coding"
WRAPPER_FLOW_ID = "react-coder"
CODING_INTERFACE = "abstractcode.coding.v1"

# Tools the loop DECLARES to the model (llm_call `tools`) and ENFORCES on the
# executor node (`allowed_tools`). Both lists are the same by construction:
# declaring a tool the executor would refuse is how a loop burns cycles on
# calls that can never land. browser_probe is granted unconditionally — an
# unmounted tool is dropped by the runtime's spec resolution, so the grant is
# a no-op on a probe-less host; only the PROMPT hint is conditional.
CODER_TOOLS = [
    "read_file", "write_file", "edit_file", "list_files", "search_files",
    "analyze_code", "execute_command", "browser_probe",
]

# ---------------------------------------------------------------------------
# EDITABLE TEXT — every sentence a human or a model reads lives here and ships
# as a PIN DEFAULT with {{slots}}. Nothing composed for a reader is buried in
# a Python body (operator ruling 2026-07-30).
# ---------------------------------------------------------------------------
REACT_SYSTEM = (
    "You are a coding agent working directly in a real workspace. You run in CYCLES: "
    "think briefly, then either call tools or finish.\n\n"
    "Rules:\n"
    "- Every change to the workspace happens through a TOOL CALL. Never claim an edit you did not make.\n"
    "- Read before you write: inspect the files you are about to change.\n"
    "- Prefer small, verifiable steps. After a change, run or check it when a command is available.\n"
    "- The ACTION TRACE below is your own history in this run; it is the only memory you carry between cycles.\n"
    "- OPERATOR STEERING outranks your current plan: when it appears, apply it before continuing.\n"
    "- When the task is complete, reply WITHOUT tool calls: a short report of what you changed, "
    "which files, and how it was checked. That reply ends the run."
)

TASK_TEXT = (
    "# CODING TASK\n{{request}}\n\n"
    "WORKSPACE ROOT: {{workspace}}\n"
    "CYCLE {{cycle}} of {{max}}."
)
VERIFY_HINT_TEXT = (
    "A verification command is configured for this task: `{{verify}}`. "
    "Run it yourself before you declare the task done — the flow runs it independently at the end, "
    "and a red run is reported as a failure whatever your final message says."
)
PROBE_HINT_TEXT = (
    "The `browser_probe` tool is mounted: use it to load a page you produced and read back console "
    "errors and DOM facts instead of guessing. Give it a timeout in SECONDS and a port you own."
)
STEERING_HEADER_TEXT = (
    "# OPERATOR STEERING (live — these arrived while you were working; they amend the task)"
)
TRANSCRIPT_HEADER_TEXT = (
    "# ACTION TRACE (your tool calls and their observations, earlier cycles of this run)"
)
FIRST_CYCLE_TEXT = (
    "This is the first cycle: nothing has been done yet. Start by looking at the workspace."
)
CLOSING_TEXT = (
    "Decide your next step now. Either call tools, or — if the task is complete — answer with your "
    "final report as plain text and make no tool calls."
)

CYCLE_LINE_TEXT = "react cycle {{n}} of {{max}}: {{note}}"
CYCLE_START_WORD = "reasoning"
CYCLE_STEER_WORD = "steering applied — "

GATING_LINE_TEXT = "gating: {{mode}}"
GATING_WAIT_WORD = "wait"
GATING_AUTO_WORD = "auto"

TRACE_ENTRY_TEXT = (
    "--- cycle {{n}} ---\nTHOUGHT: {{thought}}\nACTIONS: {{calls}}\nOBSERVATIONS:\n{{obs}}"
)
TRACE_TRIM_TEXT = "[...earlier cycles trimmed to keep the context bounded...]\n"

GATE_PROMPT_TEXT = (
    "The coding agent believes the task is done after {{cycles}} cycle(s).\n\n"
    "{{summary}}\n\n"
    "Reply 'accept' to finish, or describe what still needs to change (your words are fed straight "
    "into the next cycle as operator steering)."
)
GATE_REJECT_ENTRY_TEXT = "--- reviewer rejected the finish claim ---\n{{answer}}"

STEER_AFTER_CLAIM_ENTRY_TEXT = (
    "--- cycle {{n}}: the model claimed the task was complete ---\n{{claim}}\n"
    "OPERATOR STEERING arrived at that moment, so the run continues: apply it."
)
EMPTY_ANSWER_TEXT = (
    "#FALLBACK the model stopped calling tools but returned no final report; the workspace holds "
    "whatever the earlier cycles changed. The action trace in this run is the record."
)
FALLBACK_REPORT_TEXT = (
    "#FALLBACK the cycle budget ({{max}}) was exhausted before the model declared the task complete. "
    "Work from the finished cycles is still in the workspace; re-run to continue from there."
)
VERIFY_OK_TEXT = "VERIFICATION: the configured command exited 0.\n{{tail}}"
VERIFY_FAIL_TEXT = "VERIFICATION FAILED: the configured command did not exit 0.\n{{tail}}"
STEERING_SUMMARY_TEXT = "OPERATOR STEERING APPLIED DURING THIS RUN:"
REPORT_FOOTER_TEXT = "— react loop: {{cycles}} of {{max}} cycles used, stopped_reason={{stopped}}"

PREFLIGHT_EMPTY_REQUEST_TEXT = (
    "no coding request was provided (send `prompt` on the agent wrapper, or `request` on the root)"
)
PREFLIGHT_NO_WORKSPACE_TEXT = (
    "no workspace_root was provided; this workflow reads and writes real files, so it refuses to "
    "run against an unknown directory"
)
PREFLIGHT_REFUSAL_HEADER_TEXT = "REFUSED AT THE DOOR — the react coding loop did not start:"

WRAPPER_DIED_TEXT = (
    "The react coding run did not finish: {{error}}\n\nThe workspace holds whatever the completed "
    "cycles changed; the run's own trace holds the failing step."
)
WRAPPER_UNKNOWN_ERROR_TEXT = "the child run ended without producing a report"

# ---------------------------------------------------------------------------
# CODE BODIES — logic only. Every sentence they emit arrives on a pin.
# ---------------------------------------------------------------------------
PREFLIGHT_CODE = r"""
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
mode = str(gating_mode or "wait").strip().lower()
try:
    budget = int(max_cycles or 0)
except Exception:
    budget = 0
if budget < 1:
    budget = 1
if budget > 40:
    budget = 40
verify = str(verify_command or "").strip()
problems = []
if not req:
    problems.append(str(empty_request_text or ""))
if not ws:
    problems.append(str(no_workspace_text or ""))
ok = len(problems) == 0
lines = []
if not ok:
    lines.append(str(refusal_header_text or ""))
    for p in problems:
        lines.append("- " + p)
return {
    "updates": {
        "preflight_ok": ok,
        "wait_gating": mode != "auto",
        "request": req,
        "workspace_root": ws,
        "verify_command": verify,
        "has_verify": len(verify) > 0,
        "probe_ok": bool(browser_probe_available),
        "max_cycles": budget,
        "cycle": 0,
        "done": False,
        "transcript": "",
        "steering_notes": "",
        "steer_seen": 0,
        "steer_new": 0,
        "last_action": "",
        "final_response": "",
        "stopped_reason": "",
        "verified": False,
        "verify_text": "",
    },
    "report": "\n".join(lines),
}
""".strip()

# THE STEER FOLD — the interactive-control hook, once per cycle.
#
# `inbox` is `_runtime.inbox` read through a Get Variable chip (dotted path).
# The runtime APPENDS to it at iteration boundaries and never removes; this
# loop therefore keeps its OWN watermark (`steer_seen` = entries consumed) and
# never writes the runtime namespace. The shrink guard exists because a host
# that DOES reset the inbox (the abstractagent loops clear theirs) must not
# make this loop skip messages forever.
STEER_FOLD_CODE = r"""
items = inbox if isinstance(inbox, list) else []
seen = int(steer_seen or 0)
if seen > len(items):
    seen = 0
notes = str(steering_notes or "")
added = 0
for m in items[seen:]:
    text = ""
    if isinstance(m, dict):
        c = m.get("content")
        text = str(c) if c is not None else ""
    else:
        text = str(m or "")
    text = text.strip()
    if text:
        notes = notes + ("\n" if notes else "") + "- " + text
        added = added + 1
# CARRY (0.1.1): a steer caught by the LATE drain at the end of the previous
# cycle is already folded into the notes, but this cycle's progress line has
# not announced it yet. Carrying the pending count means the line still says
# "steering applied" on the cycle that actually acts on it; the count is
# cleared once the cycle's own fold runs.
return {"updates": {"steering_notes": notes, "steer_seen": len(items),
                    "steer_new": added + int(steer_new or 0)}}
""".strip()

# THE LATE DRAIN's own body (0.1.1). Deliberately NOT the carrying top-fold
# body: `steer_new` here must count ONLY the messages that arrived AFTER this
# cycle's prompt was composed, because that count is what decides whether a
# finish claim is re-opened. Carrying the top fold's (already-applied,
# already-announced) count would buy a pointless extra cycle every time a
# steer landed normally.
STEER_LATE_CODE = r"""
items = inbox if isinstance(inbox, list) else []
seen = int(steer_seen or 0)
if seen > len(items):
    seen = 0
notes = str(steering_notes or "")
added = 0
for m in items[seen:]:
    text = ""
    if isinstance(m, dict):
        c = m.get("content")
        text = str(c) if c is not None else ""
    else:
        text = str(m or "")
    text = text.strip()
    if text:
        notes = notes + ("\n" if notes else "") + "- " + text
        added = added + 1
return {"updates": {"steering_notes": notes, "steer_seen": len(items), "steer_new": added}}
""".strip()

CYCLE_LINE_CODE = r"""
n = int(cycle or 0) + 1
mx = int(max_cycles or 0)
note = str(last_action or "").strip()
if not note:
    note = str(start_word or "")
if int(steer_new or 0) > 0:
    note = str(steer_word or "") + note
msg = str(line_text or "")
msg = msg.replace("{{n}}", str(n)).replace("{{max}}", str(mx)).replace("{{note}}", note)
return {"message": msg}
""".strip()

GATING_LINE_CODE = r"""
word = str(wait_word or "") if bool(wait_gating) else str(auto_word or "")
return {"message": str(line_text or "").replace("{{mode}}", word)}
""".strip()

PROMPT_CODE = r"""
n = int(cycle or 0) + 1
mx = int(max_cycles or 0)
head = str(task_text or "")
head = head.replace("{{request}}", str(request or ""))
head = head.replace("{{workspace}}", str(workspace_root or ""))
head = head.replace("{{cycle}}", str(n)).replace("{{max}}", str(mx))
parts = [head]
verify = str(verify_command or "").strip()
if verify:
    parts.append(str(verify_hint or "").replace("{{verify}}", verify))
if bool(probe_ok):
    parts.append(str(probe_hint or ""))
notes = str(steering_notes or "").strip()
if notes:
    parts.append(str(steering_header or "") + "\n" + notes)
trace = str(transcript or "").strip()
if trace:
    parts.append(str(transcript_header or "") + "\n" + trace)
else:
    parts.append(str(first_cycle_text or ""))
parts.append(str(closing_text or ""))
return {"prompt": "\n\n".join(parts)}
""".strip()

# THE ACCUMULATION STEP — ReAct's identity. Tail-bounded: an unbounded
# transcript turns a long run into a context overflow, and a truncated MIDDLE
# is worse than a marked head (the model must be able to see what it just did).
FOLD_CODE = r"""
n = int(cycle or 0) + 1
entry = str(entry_text or "")
entry = entry.replace("{{n}}", str(n))
entry = entry.replace("{{thought}}", str(thought or "").strip())
entry = entry.replace("{{calls}}", str(calls_text or ""))
entry = entry.replace("{{obs}}", str(observations or ""))
trace = str(transcript or "")
trace = trace + ("\n" if trace else "") + entry
try:
    cap = int(max_chars or 0)
except Exception:
    cap = 0
if cap > 0 and len(trace) > cap:
    trace = str(trim_marker or "") + trace[len(trace) - cap:]
summary = str(calls_text or "").strip()
if len(summary) > 160:
    summary = summary[:160]
return {"updates": {"transcript": trace, "cycle": n, "last_action": summary, "steer_new": 0}}
""".strip()

# A CLAIM OF DONE IS NOT THE END WHEN THE OPERATOR JUST SPOKE (0.1.1, found
# on the live gateway run 97d61a88 class): the steer inbox is drained again
# immediately before this node, so a message that arrived WHILE the model was
# composing its final answer is still unapplied here. Finishing anyway drops
# the operator's words silently — the run ends having never seen them. So a
# fresh steer keeps `done` False for one more cycle and puts the claim in the
# transcript, which is exactly what an operator means by "wait, also...".
AUTO_DONE_CODE = r"""
resp = str(response or "").strip()
n = int(cycle or 0) + 1
reason = str(stop_reason or "")
if not resp:
    resp = str(empty_answer_text or "")
    reason = str(empty_reason or "")
if int(steer_new or 0) > 0:
    entry = str(steer_entry_text or "").replace("{{n}}", str(n)).replace("{{claim}}", resp)
    trace = str(transcript or "")
    trace = trace + ("\n" if trace else "") + entry
    # steer_new is NOT cleared here: the next cycle's progress line still owes
    # the operator the "steering applied" word, and the top fold carries it.
    return {"updates": {"final_response": resp, "done": False, "cycle": n,
                        "transcript": trace, "stopped_reason": str(steer_reason or "")}}
return {"updates": {"final_response": resp, "done": True, "cycle": n,
                    "stopped_reason": reason, "steer_new": 0}}
""".strip()

GATE_PROMPT_CODE = r"""
n = int(cycle or 0) + 1
text = str(prompt_text or "")
text = text.replace("{{cycles}}", str(n))
text = text.replace("{{summary}}", str(response or "").strip())
return {"prompt": text}
""".strip()

# The gate is a REAL steering channel, not a yes/no: anything that is not an
# acceptance becomes operator steering for the next cycle, so a reviewer's
# sentence lands in the same place a mid-run `inject_guidance` would.
GATE_FOLD_CODE = r"""
ans = str(answer or "").strip()
resp = str(response or "").strip()
n = int(cycle or 0) + 1
low = ans.lower()
accepted = (not low) or low.startswith("accept") or low.startswith("approve") or low == "ok" or low == "yes"
if accepted:
    if not resp:
        resp = str(empty_answer_text or "")
    return {"updates": {"final_response": resp, "done": True, "cycle": n,
                        "stopped_reason": str(accept_reason or ""), "steer_new": 0}}
notes = str(steering_notes or "")
notes = notes + ("\n" if notes else "") + "- " + ans
trace = str(transcript or "")
entry = str(reject_entry_text or "").replace("{{answer}}", ans)
trace = trace + ("\n" if trace else "") + entry
return {"updates": {"steering_notes": notes, "transcript": trace, "cycle": n,
                    "done": False, "stopped_reason": str(revise_reason or ""), "steer_new": 1}}
""".strip()

# `verify_command` is operator-supplied SHELL and is interpolated as a command,
# not as data — quoting it would break it. Everything around it is quoted with
# shq. The exit code is captured BEFORE the tail pipe (a pipe would report
# tail's status, which is always 0 — the classic false-green).
VERIFY_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
cmd = ("cd '" + ws_q + "' && ( " + str(verify_command or "true") + " ) "
       "> .react_verify.log 2>&1; echo \"VERIFY_EXIT=$?\"; "
       "tail -n 40 .react_verify.log 2>/dev/null")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 300},
                      "call_id": "react-verify"}}
""".strip()

VERIFY_FOLD_CODE = r"""
txt = text_of(result)
tail = txt[-2000:] if len(txt) > 2000 else txt
return {"updates": {"verified": "VERIFY_EXIT=0" in txt, "verify_text": tail}}
""".strip()

REPORT_CODE = r"""
final = str(final_response or "").strip()
n = int(cycle or 0)
mx = int(max_cycles or 0)
stopped = str(stopped_reason or "")
finished = bool(done_flag)
if not final:
    final = str(fallback_text or "").replace("{{max}}", str(mx))
    finished = False
    stopped = str(budget_reason or "")
if not finished and not stopped:
    stopped = str(budget_reason or "")
has_v = bool(has_verify)
passed = bool(verified) if has_v else finished
lines = [final]
if has_v:
    line = str(verify_ok_text or "") if bool(verified) else str(verify_fail_text or "")
    lines.append(line.replace("{{tail}}", str(verify_text or "")))
notes = str(steering_notes or "").strip()
if notes:
    lines.append(str(steering_summary_text or "") + "\n" + notes)
foot = str(footer_text or "")
foot = foot.replace("{{cycles}}", str(n)).replace("{{max}}", str(mx)).replace("{{stopped}}", stopped)
lines.append(foot)
return {"report": "\n\n".join(lines), "passed": passed, "ok": passed,
        "stopped": stopped, "cycles": n}
""".strip()

WRAPPER_ANSWER_CODE = r"""
rep = report if isinstance(report, str) else ""
ok = bool(child_success)
died = child_result if isinstance(child_result, dict) else {}
if not rep.strip():
    err = str(died.get("error") or "").strip()
    rep = str(died_text or "").replace(
        "{{error}}", err if err else str(unknown_error_text or ""))
    ok = False
return {
    "response": rep,
    "ok": ok,
    "meta": {"branch": "",
             "stopped_reason": stopped_reason if isinstance(stopped_reason, str) else "",
             "cycles_used": cycles_used if isinstance(cycles_used, (int, float)) else 0,
             "orchestration": "react"},
}
""".strip()

# The whole run-var inventory on ONE node's pin default: readable, editable,
# and fail-closed (preflight_ok False refuses the run if the wire ever went
# missing).
SEED_VARS = {
    "preflight_ok": False,
    "wait_gating": True,
    "request": "",
    "workspace_root": "",
    "verify_command": "",
    "has_verify": False,
    "probe_ok": False,
    "max_cycles": 12,
    "cycle": 0,
    "done": False,
    "transcript": "",
    "steering_notes": "",
    "steer_seen": 0,
    "steer_new": 0,
    "last_action": "",
    "final_response": "",
    "stopped_reason": "",
    "verified": False,
    "verify_text": "",
}

# The loop law. An expression because it is a DERIVATION over two run vars,
# never an access; the pin default is False so a pre-expression runtime exits
# the loop immediately (bounded refusal) instead of spinning it to the cap.
LOOP_LAW = "not vars.done and vars.cycle < vars.max_cycles"


def build_root() -> dict:
    f = base_flow(
        ROOT_FLOW_ID, "React coder — llm_call + tool loop (edit on canvas)",
        "Hand-wired ReAct coding loop: no agent node. Each cycle drains the steer inbox "
        "(`_runtime.inbox`) into the next prompt, prints a progress line, calls the model with "
        "tools declared, executes the tool calls it asks for and folds the observations into an "
        "ACCUMULATING transcript. Stops when the model answers without tool calls (wait mode "
        "asks a human first) or when the cycle budget runs out; an optional verify_command is "
        "run deterministically at the end and decides `passed`.",
        interfaces=[CODING_INTERFACE])
    N, E = f["nodes"], f["edges"]

    # ---- the door ----------------------------------------------------------
    N.append(node("start", "on_flow_start", "Coding request", -2400, 0,
                  outputs=[EXEC_OUT,
                           pin("request", "request", "string"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("max_cycles", "max_cycles", "number"),
                           pin("verify_command", "verify_command", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  pin_defaults={"request": "", "workspace_root": "", "gating_mode": "wait",
                                "max_cycles": 12, "verify_command": "",
                                "browser_probe_available": False}))

    pf = code_node("preflight", "Preflight", PREFLIGHT_CODE, -2200, 0,
                   [pin("request", "request", "string"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("gating_mode", "gating_mode", "string"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("verify_command", "verify_command", "string"),
                    pin("browser_probe_available", "browser_probe_available", "boolean"),
                    pin("empty_request_text", "empty_request_text", "string"),
                    pin("no_workspace_text", "no_workspace_text", "string"),
                    pin("refusal_header_text", "refusal_header_text", "string")],
                   outputs=[pin("updates", "updates", "object"),
                            pin("report", "report", "string")], exec_pins=True)
    pf["data"]["pinDefaults"].update({
        "empty_request_text": PREFLIGHT_EMPTY_REQUEST_TEXT,
        "no_workspace_text": PREFLIGHT_NO_WORKSPACE_TEXT,
        "refusal_header_text": PREFLIGHT_REFUSAL_HEADER_TEXT,
    })
    N.append(pf)
    for pin_id in ("request", "workspace_root", "gating_mode", "max_cycles",
                   "verify_command", "browser_probe_available"):
        E.append(edge("start", pin_id, "preflight", pin_id))

    N.append(W.set_vars("seed_vars", "Seed run variables", -2000, 0, seed=SEED_VARS))
    E.append(edge("preflight", "updates", "seed_vars", "updates"))
    N.append(if_node("if_preflight", "Preflight ok?", -1800, 0))
    read_pin(N, E, "if_preflight", "condition", "preflight_ok", False, -1800, -320)
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", -1800, 300,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("passed", "passed", "boolean"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string"),
                          pin("cycles_used", "cycles_used", "number")],
                  pin_defaults={"passed": False, "success": False, "branch": "",
                                "stopped_reason": "preflight-failed", "cycles_used": 0}))
    E.append(edge("preflight", "report", "end_pre", "report"))

    # ---- the run-start gating line (every client sees the mode) ------------
    gl = code_node("gating_line", "Compose gating line", GATING_LINE_CODE, -1600, -200,
                   [pin("wait_gating", "wait_gating", "boolean"),
                    pin("line_text", "line_text", "string"),
                    pin("wait_word", "wait_word", "string"),
                    pin("auto_word", "auto_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    gl["data"]["pinDefaults"].update({"line_text": GATING_LINE_TEXT,
                                      "wait_word": GATING_WAIT_WORD,
                                      "auto_word": GATING_AUTO_WORD})
    N.append(gl)
    read_pin(N, E, "gating_line", "wait_gating", "wait_gating", True, -1600, -520)
    N.append(answer_user_node("gating_status", "Gating mode", -1600, 0))
    E.append(edge("gating_line", "message", "gating_status", "message"))

    # ---- THE REACT LOOP ----------------------------------------------------
    loop = while_node("loop", "REACT LOOP", -1400, 0)
    loop["data"]["pinDefaults"] = {"condition": False}
    N.append(W.with_expressions(loop, {"condition": LOOP_LAW}))

    # 1. steer inbox -> steering_notes (interactive control, once per cycle)
    sf = code_node("steer_fold", "Drain steer inbox", STEER_FOLD_CODE, -1200, 0,
                   [pin("inbox", "inbox", "array"),
                    pin("steer_seen", "steer_seen", "number"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("steer_new", "steer_new", "number")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(sf)
    read_vars(N, E, "steer_fold",
              [("inbox", "_runtime.inbox", []),
               ("steer_seen", "steer_seen", 0),
               ("steering_notes", "steering_notes", ""),
               ("steer_new", "steer_new", 0)], -1200, -320)
    N.append(W.set_vars("set_steer", "Apply steering", -1000, 0))
    E.append(edge("steer_fold", "updates", "set_steer", "updates"))

    # 2. the progress line
    cl = code_node("cycle_line", "Compose cycle line", CYCLE_LINE_CODE, -800, 0,
                   [pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("steer_new", "steer_new", "number"),
                    pin("last_action", "last_action", "string"),
                    pin("line_text", "line_text", "string"),
                    pin("start_word", "start_word", "string"),
                    pin("steer_word", "steer_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    cl["data"]["pinDefaults"].update({"line_text": CYCLE_LINE_TEXT,
                                      "start_word": CYCLE_START_WORD,
                                      "steer_word": CYCLE_STEER_WORD})
    N.append(cl)
    read_vars(N, E, "cycle_line",
              [("cycle", "cycle", 0), ("max_cycles", "max_cycles", 12),
               ("steer_new", "steer_new", 0), ("last_action", "last_action", "")], -800, -320)
    N.append(answer_user_node("cycle_status", "Cycle progress", -600, 0))
    E.append(edge("cycle_line", "message", "cycle_status", "message"))

    # 3. the cycle prompt (task + steering + accumulated transcript)
    pc = code_node("prompt_compose", "Compose cycle prompt", PROMPT_CODE, -400, 0,
                   [pin("request", "request", "string"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("transcript", "transcript", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("verify_command", "verify_command", "string"),
                    pin("probe_ok", "probe_ok", "boolean"),
                    pin("task_text", "task_text", "string"),
                    pin("verify_hint", "verify_hint", "string"),
                    pin("probe_hint", "probe_hint", "string"),
                    pin("steering_header", "steering_header", "string"),
                    pin("transcript_header", "transcript_header", "string"),
                    pin("first_cycle_text", "first_cycle_text", "string"),
                    pin("closing_text", "closing_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    pc["data"]["pinDefaults"].update({
        "task_text": TASK_TEXT, "verify_hint": VERIFY_HINT_TEXT,
        "probe_hint": PROBE_HINT_TEXT, "steering_header": STEERING_HEADER_TEXT,
        "transcript_header": TRANSCRIPT_HEADER_TEXT,
        "first_cycle_text": FIRST_CYCLE_TEXT, "closing_text": CLOSING_TEXT,
    })
    N.append(pc)
    read_vars(N, E, "prompt_compose",
              [("request", "request", ""), ("workspace_root", "workspace_root", ""),
               ("transcript", "transcript", ""), ("steering_notes", "steering_notes", ""),
               ("cycle", "cycle", 0), ("max_cycles", "max_cycles", 12),
               ("verify_command", "verify_command", ""), ("probe_ok", "probe_ok", False)],
              -400, -320)

    # 4. REASON + ACT — tools DECLARED so the model emits tool_calls
    N.append(llm_node("react_llm", "REASON + ACT", -200, 0,
                      pin_defaults={"system": REACT_SYSTEM, "tools": CODER_TOOLS,
                                    "temperature": 0.2}))
    E.append(edge("prompt_compose", "prompt", "react_llm", "prompt"))
    read_pin(N, E, "react_llm", "provider", "provider", None, -200, -320, chip="llm_provider")
    read_pin(N, E, "react_llm", "model", "model", None, -200, -460, chip="llm_model")

    # 5. act or conclude
    N.append(has_tools_node("has_calls", "Wants tools?", 0, -320))
    E.append(edge("react_llm", "tool_calls", "has_calls", "array"))
    N.append(if_node("route", "Act or conclude", 0, 0))
    E.append(edge("has_calls", "result", "route", "condition"))

    # 5a. ACT: execute the model's calls, fold observations into the transcript
    N.append(tool_calls_node("act", "EXECUTE TOOL CALLS", CODER_TOOLS, 200, 0))
    E.append(edge("react_llm", "tool_calls", "act", "tool_calls"))
    N.append(stringify_json_node("calls_json", "Calls to text", 200, -320))
    E.append(edge("react_llm", "tool_calls", "calls_json", "value"))
    N.append(format_tool_results_node("obs_text", "Observations", 400, -320))
    E.append(edge("act", "results", "obs_text", "results"))

    fold = code_node("fold", "Fold cycle into transcript", FOLD_CODE, 400, 0,
                     [pin("transcript", "transcript", "string"),
                      pin("cycle", "cycle", "number"),
                      pin("thought", "thought", "string"),
                      pin("calls_text", "calls_text", "string"),
                      pin("observations", "observations", "string"),
                      pin("entry_text", "entry_text", "string"),
                      pin("trim_marker", "trim_marker", "string"),
                      pin("max_chars", "max_chars", "number")],
                     outputs=[pin("updates", "updates", "object")], exec_pins=True)
    fold["data"]["pinDefaults"].update({"entry_text": TRACE_ENTRY_TEXT,
                                        "trim_marker": TRACE_TRIM_TEXT,
                                        "max_chars": 24000})
    N.append(fold)
    E.append(edge("react_llm", "response", "fold", "thought"))
    E.append(edge("calls_json", "result", "fold", "calls_text"))
    E.append(edge("obs_text", "result", "fold", "observations"))
    read_vars(N, E, "fold", [("transcript", "transcript", ""), ("cycle", "cycle", 0)], 400, -600)
    N.append(W.set_vars("set_cycle", "Save cycle", 600, 0))
    E.append(edge("fold", "updates", "set_cycle", "updates"))

    # 5b. CONCLUDE — but drain the inbox ONE MORE TIME first (0.1.1). The
    # model was composing its answer for as long as a generation takes; a
    # steer that landed during it is unapplied, and finishing here would drop
    # it silently. Same node shape, same watermark var, so nothing is applied
    # twice.
    sl = code_node("steer_late", "Drain steer inbox (late)", STEER_LATE_CODE, 200, 380,
                   [pin("inbox", "inbox", "array"),
                    pin("steer_seen", "steer_seen", "number"),
                    pin("steering_notes", "steering_notes", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(sl)
    read_vars(N, E, "steer_late",
              [("inbox", "_runtime.inbox", []), ("steer_seen", "steer_seen", 0),
               ("steering_notes", "steering_notes", "")], 200, 120)
    N.append(W.set_vars("set_steer_late", "Apply late steering", 400, 380))
    E.append(edge("steer_late", "updates", "set_steer_late", "updates"))

    N.append(if_node("if_gate", "Human review?", 200, 620))
    read_pin(N, E, "if_gate", "condition", "wait_gating", False, 200, 320)

    gp = code_node("gate_prompt", "Compose review question", GATE_PROMPT_CODE, 400, 620,
                   [pin("response", "response", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("prompt_text", "prompt_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    gp["data"]["pinDefaults"].update({"prompt_text": GATE_PROMPT_TEXT})
    N.append(gp)
    E.append(edge("react_llm", "response", "gate_prompt", "response"))
    read_pin(N, E, "gate_prompt", "cycle", "cycle", 0, 400, 320)
    N.append(ask_user_node("gate", "GATE: accept the finish claim?", 600, 620))
    E.append(edge("gate_prompt", "prompt", "gate", "prompt"))

    gf = code_node("gate_fold", "Fold reviewer answer", GATE_FOLD_CODE, 800, 620,
                   [pin("answer", "answer", "string"),
                    pin("response", "response", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("transcript", "transcript", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("reject_entry_text", "reject_entry_text", "string"),
                    pin("empty_answer_text", "empty_answer_text", "string"),
                    pin("accept_reason", "accept_reason", "string"),
                    pin("revise_reason", "revise_reason", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    gf["data"]["pinDefaults"].update({"reject_entry_text": GATE_REJECT_ENTRY_TEXT,
                                      "empty_answer_text": EMPTY_ANSWER_TEXT,
                                      "accept_reason": "accepted-by-user",
                                      "revise_reason": "user-revision"})
    N.append(gf)
    E.append(edge("gate", "response", "gate_fold", "answer"))
    E.append(edge("react_llm", "response", "gate_fold", "response"))
    read_vars(N, E, "gate_fold",
              [("cycle", "cycle", 0), ("transcript", "transcript", ""),
               ("steering_notes", "steering_notes", "")], 800, 320)
    N.append(W.set_vars("set_gate", "Save review outcome", 1000, 620))
    E.append(edge("gate_fold", "updates", "set_gate", "updates"))

    ad = code_node("auto_done", "Finish (auto mode)", AUTO_DONE_CODE, 400, 980,
                   [pin("response", "response", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("steer_new", "steer_new", "number"),
                    pin("transcript", "transcript", "string"),
                    pin("stop_reason", "stop_reason", "string"),
                    pin("steer_reason", "steer_reason", "string"),
                    pin("steer_entry_text", "steer_entry_text", "string"),
                    pin("empty_answer_text", "empty_answer_text", "string"),
                    pin("empty_reason", "empty_reason", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    ad["data"]["pinDefaults"].update({"stop_reason": "model-stopped",
                                      "steer_reason": "steered-after-claim",
                                      "steer_entry_text": STEER_AFTER_CLAIM_ENTRY_TEXT,
                                      "empty_answer_text": EMPTY_ANSWER_TEXT,
                                      "empty_reason": "model-stopped-empty"})
    N.append(ad)
    E.append(edge("react_llm", "response", "auto_done", "response"))
    read_vars(N, E, "auto_done",
              [("cycle", "cycle", 0), ("steer_new", "steer_new", 0),
               ("transcript", "transcript", "")], 400, 700)
    N.append(W.set_vars("set_done", "Save final answer", 600, 980))
    E.append(edge("auto_done", "updates", "set_done", "updates"))

    # ---- after the loop: the deterministic verification (optional) ---------
    N.append(if_node("if_verify", "Verify command set?", 1200, 0))
    read_pin(N, E, "if_verify", "condition", "has_verify", False, 1200, -320)
    vc = code_node("verify_cmd", "Compose verify command", VERIFY_CMD_CODE, 1400, 0,
                   [pin("workspace_root", "workspace_root", "string"),
                    pin("verify_command", "verify_command", "string")],
                   outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    N.append(vc)
    read_vars(N, E, "verify_cmd",
              [("workspace_root", "workspace_root", ""),
               ("verify_command", "verify_command", "")], 1400, -320)
    N.append(call_tool_node("verify_call", "Run verification", ["execute_command"], 1600, 0))
    E.append(edge("verify_cmd", "tool_call", "verify_call", "tool_call"))
    vf = code_node("verify_fold", "Read verification result", VERIFY_FOLD_CODE, 1800, 0,
                   [pin("result", "result", "any")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(vf)
    E.append(edge("verify_call", "raw", "verify_fold", "result"))
    N.append(W.set_vars("set_verify", "Save verification", 2000, 0))
    E.append(edge("verify_fold", "updates", "set_verify", "updates"))

    # ---- the report --------------------------------------------------------
    rp = code_node("report", "Final report", REPORT_CODE, 2200, 0,
                   [pin("final_response", "final_response", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("done_flag", "done_flag", "boolean"),
                    pin("stopped_reason", "stopped_reason", "string"),
                    pin("has_verify", "has_verify", "boolean"),
                    pin("verified", "verified", "boolean"),
                    pin("verify_text", "verify_text", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("fallback_text", "fallback_text", "string"),
                    pin("budget_reason", "budget_reason", "string"),
                    pin("verify_ok_text", "verify_ok_text", "string"),
                    pin("verify_fail_text", "verify_fail_text", "string"),
                    pin("steering_summary_text", "steering_summary_text", "string"),
                    pin("footer_text", "footer_text", "string")],
                   outputs=[pin("report", "report", "string"),
                            pin("passed", "passed", "boolean"),
                            pin("ok", "ok", "boolean"),
                            pin("stopped", "stopped", "string"),
                            pin("cycles", "cycles", "number")], exec_pins=True)
    rp["data"]["pinDefaults"].update({
        "fallback_text": FALLBACK_REPORT_TEXT, "budget_reason": "budget-exhausted",
        "verify_ok_text": VERIFY_OK_TEXT, "verify_fail_text": VERIFY_FAIL_TEXT,
        "steering_summary_text": STEERING_SUMMARY_TEXT, "footer_text": REPORT_FOOTER_TEXT,
    })
    N.append(rp)
    read_vars(N, E, "report",
              [("final_response", "final_response", ""), ("cycle", "cycle", 0),
               ("max_cycles", "max_cycles", 12), ("done_flag", "done", False),
               ("stopped_reason", "stopped_reason", ""), ("has_verify", "has_verify", False),
               ("verified", "verified", False), ("verify_text", "verify_text", ""),
               ("steering_notes", "steering_notes", "")], 2200, -320)

    N.append(node("end", "on_flow_end", "Report", 2400, 0,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("passed", "passed", "boolean"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string"),
                          pin("cycles_used", "cycles_used", "number")],
                  pin_defaults={"report": "", "passed": False, "success": False,
                                "branch": "", "stopped_reason": "", "cycles_used": 0}))
    E.append(edge("report", "report", "end", "report"))
    E.append(edge("report", "passed", "end", "passed"))
    E.append(edge("report", "ok", "end", "success"))
    E.append(edge("report", "stopped", "end", "stopped_reason"))
    E.append(edge("report", "cycles", "end", "cycles_used"))

    # ---- the exec spine ----------------------------------------------------
    for src, tgt in (("start", "preflight"), ("preflight", "seed_vars"),
                     ("seed_vars", "if_preflight")):
        E.append(edge(src, "exec-out", tgt, "exec-in"))
    E.append(edge("if_preflight", "false", "end_pre", "exec-in"))
    E.append(edge("if_preflight", "true", "gating_line", "exec-in"))
    E.append(edge("gating_line", "exec-out", "gating_status", "exec-in"))
    E.append(edge("gating_status", "exec-out", "loop", "exec-in"))
    # loop body
    E.append(edge("loop", "loop", "steer_fold", "exec-in"))
    for src, tgt in (("steer_fold", "set_steer"), ("set_steer", "cycle_line"),
                     ("cycle_line", "cycle_status"), ("cycle_status", "prompt_compose"),
                     ("prompt_compose", "react_llm"), ("react_llm", "route")):
        E.append(edge(src, "exec-out", tgt, "exec-in"))
    E.append(edge("route", "true", "act", "exec-in"))
    E.append(edge("act", "exec-out", "fold", "exec-in"))
    E.append(edge("fold", "exec-out", "set_cycle", "exec-in"))
    E.append(edge("route", "false", "steer_late", "exec-in"))
    E.append(edge("steer_late", "exec-out", "set_steer_late", "exec-in"))
    E.append(edge("set_steer_late", "exec-out", "if_gate", "exec-in"))
    E.append(edge("if_gate", "true", "gate_prompt", "exec-in"))
    E.append(edge("gate_prompt", "exec-out", "gate", "exec-in"))
    E.append(edge("gate", "exec-out", "gate_fold", "exec-in"))
    E.append(edge("gate_fold", "exec-out", "set_gate", "exec-in"))
    E.append(edge("if_gate", "false", "auto_done", "exec-in"))
    E.append(edge("auto_done", "exec-out", "set_done", "exec-in"))
    # after the loop
    E.append(edge("loop", "done", "if_verify", "exec-in"))
    E.append(edge("if_verify", "true", "verify_cmd", "exec-in"))
    E.append(edge("verify_cmd", "exec-out", "verify_call", "exec-in"))
    E.append(edge("verify_call", "exec-out", "verify_fold", "exec-in"))
    E.append(edge("verify_fold", "exec-out", "set_verify", "exec-in"))
    E.append(edge("set_verify", "exec-out", "report", "exec-in"))
    E.append(edge("if_verify", "false", "report", "exec-in"))
    E.append(edge("report", "exec-out", "end", "exec-in"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def build_wrapper() -> dict:
    """agent.v1 wrapper — the picker-visible entrypoint. SAME seven start pins
    and SAME output contract as `multiagent-coder`, so the two orchestrations
    are swappable inputs-for-inputs in a benchmark harness."""
    f = base_flow(
        WRAPPER_FLOW_ID, "React coder — chat entry (llm_call + tool loop)",
        "Chat-agent entrypoint for the hand-wired ReAct coding loop (no agent node). Defaults to "
        "gating_mode=wait: an interactive client answers ONE ask_user gate when the model claims "
        "the task is done, and can steer the loop at any cycle boundary with the gateway's "
        "inject_guidance command. Unattended clients send gating_mode=auto and "
        "input_data._runtime.tool_policy = {\"auto_approve_max_risk_rank\": 2, "
        "\"auto_approve_tools\": [\"execute_command\", \"read_file\", \"write_file\", "
        "\"edit_file\", \"list_files\", \"search_files\", \"analyze_code\", \"browser_probe\"]}. "
        "workspace_root is required — an empty workspace is refused at the door.",
        interfaces=[AGENT_INTERFACE])
    N, E = f["nodes"], f["edges"]
    N.append(node("start", "on_flow_start", "Prompt", -900, 0,
                  outputs=[EXEC_OUT, pin("prompt", "prompt", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model"),
                           pin("tools", "tools", "array"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean")],
                  pin_defaults={"prompt": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": True}))
    N.append(subflow_node("build", "Run the react loop", ROOT_FLOW_ID, -220, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("gating_mode", "string"),
                                        ("provider", "provider_text"),
                                        ("model", "model"),
                                        ("browser_probe_available", "boolean")],
                          child_outputs=[("report", "string"),
                                         ("success", "boolean"),
                                         ("stopped_reason", "string"),
                                         ("cycles_used", "number")]))
    ans = code_node("answer", "Compose answer", WRAPPER_ANSWER_CODE, 500, 0,
                    [pin("report", "report", "string"),
                     pin("child_success", "child_success", "boolean"),
                     pin("stopped_reason", "stopped_reason", "string"),
                     pin("cycles_used", "cycles_used", "number"),
                     pin("child_result", "child_result", "object"),
                     pin("died_text", "died_text", "string"),
                     pin("unknown_error_text", "unknown_error_text", "string")],
                    outputs=[pin("response", "response", "string"),
                             pin("ok", "ok", "boolean"),
                             pin("meta", "meta", "object")], exec_pins=True)
    ans["data"]["pinDefaults"].update({"died_text": WRAPPER_DIED_TEXT,
                                       "unknown_error_text": WRAPPER_UNKNOWN_ERROR_TEXT})
    N.append(ans)
    N.append(node("end", "on_flow_end", "Answer", 860, 0,
                  inputs=[EXEC_IN, pin("response", "response", "string"),
                          pin("success", "success", "boolean"),
                          pin("meta", "meta", "object")],
                  pin_defaults={"response": "", "success": False, "meta": {}}))

    E.append(edge("start", "exec-out", "build", "exec-in"))
    E.append(edge("build", "exec-out", "answer", "exec-in"))
    E.append(edge("answer", "exec-out", "end", "exec-in"))
    E.append(edge("start", "prompt", "build", "request"))
    for pin_id in ("workspace_root", "gating_mode", "provider", "model",
                   "browser_probe_available"):
        E.append(edge("start", pin_id, "build", pin_id))
    E.append(edge("build", "report", "answer", "report"))
    E.append(edge("build", "success", "answer", "child_success"))
    E.append(edge("build", "stopped_reason", "answer", "stopped_reason"))
    E.append(edge("build", "cycles_used", "answer", "cycles_used"))
    E.append(edge("build", "output", "answer", "child_result"))
    E.append(edge("answer", "response", "end", "response"))
    E.append(edge("answer", "ok", "end", "success"))
    E.append(edge("answer", "meta", "end", "meta"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{WRAPPER_FLOW_ID}.json", f)
    return f


def _assert_no_state_blob(flow: dict) -> None:
    """No `set_var{name:"state"}`-shaped write anywhere: run vars are FLAT and
    top-level, so every read is a named Get Variable chip the canvas draws."""
    for n in flow["nodes"]:
        data = n["data"]
        if data.get("nodeType") != "set_var":
            continue
        name = (data.get("pinDefaults") or {}).get("name")
        raise AssertionError(
            f"{flow['id']}: node '{n['id']}' writes run var '{name}' with set_var — "
            "this family writes flat vars through set_vars only")


def _assert_steer_hook(flow: dict) -> None:
    """The mission's invariant, enforced at BUILD time: the loop READS
    `_runtime.inbox` and keeps a watermark. A refactor that drops the hook
    fails the build instead of shipping a loop nobody can steer."""
    getters = {(n["data"].get("pinDefaults") or {}).get("name")
               for n in flow["nodes"] if n["data"].get("nodeType") == "get_var"}
    assert "_runtime.inbox" in getters, f"{flow['id']}: no Get Variable reads _runtime.inbox"
    assert "steer_seen" in getters, f"{flow['id']}: no steer watermark read"
    bodies = "\n".join(str(n["data"].get("codeBody") or "") for n in flow["nodes"])
    assert "steer_seen" in bodies, f"{flow['id']}: nothing advances the steer watermark"


def _assert_progress_line(flow: dict) -> None:
    kinds = [n["data"].get("nodeType") for n in flow["nodes"]]
    assert kinds.count("answer_user") >= 2, (
        f"{flow['id']}: expected the gating line + a per-cycle progress line")


def main() -> int:
    root = build_root()
    wrapper = build_wrapper()
    for flow in (root, wrapper):
        _assert_no_state_blob(flow)
    _assert_steer_hook(root)
    _assert_progress_line(root)
    ok = True
    for fid, flow in ((ROOT_FLOW_ID, root), (WRAPPER_FLOW_ID, wrapper)):
        problems = validate_edges(flow)
        if problems:
            ok = False
            print(f"EDGE PROBLEMS ({fid}):")
            for p in problems:
                print("  " + p)
        overlaps = W.layout_overlap_findings(flow)
        if overlaps:
            ok = False
            print(f"LAYOUT OVERLAPS ({fid}): {len(overlaps)}")
            for finding in overlaps[:10]:
                print("  " + finding)
    if not ok:
        return 1
    print(f"Wrote {ROOT_FLOW_ID}.json ({len(root['nodes'])} nodes, {len(root['edges'])} edges)"
          f" + {WRAPPER_FLOW_ID}.json ({len(wrapper['nodes'])} nodes, agent.v1 entrypoint)")
    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        compile_check(WRAPPER_FLOW_ID, [ROOT_FLOW_ID, WRAPPER_FLOW_ID])
        out = pack_bundle(
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "react-coding",
                # Pin expressions (the two loop laws) require a runtime that
                # evaluates node.data.pinExpressions; the gate refuses an old
                # gateway loudly instead of silently exiting the loop at once.
                "min_runtime": "0.4.30",
                "requires_pin_expressions": True,
                "purpose": (
                    "ReAct coding loop with NO agent node: while(not done and cycle<max) { drain "
                    "_runtime.inbox -> steering, progress line, compose prompt (task + steering + "
                    "ACCUMULATED transcript), llm_call with tools, execute tool_calls, fold "
                    "observations }. Stops when the model answers without tool calls (wait mode "
                    "asks a human first) or the budget runs out; an optional verify_command "
                    "decides `passed` deterministically. Dual-interface: coding.v1 root "
                    "'react-coding' + agent.v1 wrapper 'react-coder' (picker-visible). Built to "
                    "benchmark 1:1 against multiagent-coder and ralph-coder — same wrapper inputs, "
                    "same response/success/meta contract."),
                "gating": {"pin": "gating_mode", "values": ["wait", "auto"], "default": "wait"},
                "steering": {"channel": "inject_guidance", "var": "_runtime.inbox",
                             "applied": "at every cycle boundary, deduped by the run-owned "
                                        "steer_seen watermark"},
                "outputs": ["report", "passed", "success", "stopped_reason", "cycles_used"],
                "auto_mode_requirement": (
                    "unattended runs must auto-approve the loop's tools: send "
                    "input_data._runtime.tool_policy = {\"auto_approve_max_risk_rank\": 2, "
                    "\"auto_approve_tools\": [\"execute_command\", \"read_file\", \"write_file\", "
                    "\"edit_file\", \"list_files\", \"search_files\", \"analyze_code\", "
                    "\"browser_probe\"]} or drive approvals externally, else the run parks on the "
                    "first tool the model asks for"),
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
