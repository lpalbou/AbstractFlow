#!/usr/bin/env python3
"""Generator for the RALPH-CODER family — the "run the same prompt in a loop"
technique, built as hand-wired llm_call + tool_calls (operator directive
2026-07-31; NO agent node anywhere in this family).

RALPH, HONESTLY. Ralph is not ReAct with a bigger budget. Its three claims:

  1. EVERY CYCLE SENDS THE SAME FIXED TASK PROMPT WITH FRESH CONTEXT. There is
     no conversation carried across cycles — each cycle is a new session that
     re-derives its situation. Here that is structural, not a promise: a cycle
     is a SUBFLOW call (`ralph-cycle`), and a child run has its own vars, so
     nothing from the previous cycle can leak in.
  2. MEMORY LIVES IN THE WORKSPACE. The model is told to read PLAN.md and
     PROGRESS.md first and to update PROGRESS.md last; those files ARE the
     loop's memory. The flow creates them once (deterministically, if absent)
     and never rewrites them — rewriting the model's memory file from the
     orchestrator is how a Ralph loop starts lying to itself.
  3. COMPLETION IS DETERMINISTIC, NEVER MODEL-CLAIMED. Each cycle ends with a
     shell check the flow runs itself: the configured verify command must exit
     0 AND PROGRESS.md must carry the promise marker (default "DONE:") with
     evidence. A model that says "finished" without both is simply given
     another cycle, up to max_cycles.

STEERING WITH FRESH CONTEXT. `Runtime.steer()` / the gateway's
`inject_guidance` command land in `_runtime.inbox`; the outer loop drains it
at every cycle boundary into the `steering_notes` run var (dedup by the
run-owned `steer_seen` watermark), and steering_notes is templated into EVERY
cycle's prompt. That is the only steering shape compatible with fresh context:
there is no conversation to append to, so the note has to be part of the
standing task. Honest latency: a steer sent mid-cycle is applied at the START
OF THE NEXT CYCLE, not inside the running one.

INTERFACES: `ralph-coding` (coding.v1 root) -> `ralph-cycle` (one fresh
session) + `ralph-coder` (the abstractcode.agent.v1 wrapper the TUI picker
shows). The wrapper takes the SAME seven start pins as `multiagent-coder` and
`react-coder` and returns the SAME response/success/meta contract, so all
three orchestrations benchmark 1:1.
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

BUNDLE_ID = "ralph-coding"
# 0.2.0 (2026-08-01, workflow-bench forensics: 109 llm calls for 32 KB output,
# ~5 of every 8 cycle steps re-deriving state):
#   1. WARM START — every cycle's prompt now mechanically embeds the tail of
#      PROGRESS.md (last `warm_entries` WHOLE entries — 0.2.1: the newest whole
#      entries up to the 50k-token window, see below — ADR-0026: never truncate
#      mid-entry, older entries are OMITTED with a stated note) plus a compact
#      depth-2 workspace listing, gathered by a deterministic execute_command
#      before the cycle composer. Context stays fresh (no transcript carry) but
#      the re-derivation tax dies: the model orients from the injected sections
#      instead of burning steps re-reading the workspace.
#   2. EARLY STOP (two-green rule) — after 2 CONSECUTIVE cycles with verify
#      exit 0 AND no file changes between them (change fingerprint: `find
#      -newer .ralph_fp.stamp`, memory files excluded), the loop concludes:
#      a loop that is done twice is done. Guarded by has_verify — with no
#      verify command, exit 0 is vacuous and must never stop the loop.
# 0.2.1 (2026-09-28, ADR-0026 operator ruling: no count/char caps on model
# inputs; replayed history = newest WHOLE messages up to 50,000 tokens):
#   1. The warm-start progress tail is the newest WHOLE entries up to the
#      runtime's 50,000-token history window (was: last 3 entries, clamped to
#      1..10, then a 6,000-char budget, and a 2,500-char tail for a progress
#      file without '## ' entries). `warm_entries` defaults to 0 = no count
#      bound; an author who wants one sets it explicitly (no upper clamp).
#   2. The per-cycle step trace has no default bound (`max_chars` 20000 -> 0),
#      the same rule react-coding's transcript already follows.
BUNDLE_VERSION = "0.2.1"
ROOT_FLOW_ID = "ralph-coding"
CYCLE_FLOW_ID = "ralph-cycle"
WRAPPER_FLOW_ID = "ralph-coder"
CODING_INTERFACE = "abstractcode.coding.v1"

CODER_TOOLS = [
    "read_file", "write_file", "edit_file", "list_files", "search_files",
    "analyze_code", "execute_command", "browser_probe",
]

# ---------------------------------------------------------------------------
# EDITABLE TEXT (pin defaults with {{slots}})
# ---------------------------------------------------------------------------
RALPH_SYSTEM = (
    "You are a coding agent working directly in a real workspace, in ONE cycle of a repeating "
    "loop. You have NO memory of previous cycles: everything you need is in the workspace.\n\n"
    "Rules:\n"
    "- START by reading the plan file and the progress file named in the task. They are the "
    "memory of every earlier cycle.\n"
    "- Do the SMALLEST next useful piece of work, then verify it.\n"
    "- FINISH the cycle by updating the progress file: what you did, what you verified, what is "
    "left, and — only when everything is truly complete and the verification command passes — "
    "the completion marker with evidence.\n"
    "- Never write the completion marker on a guess: an orchestrator re-runs the verification "
    "command independently, and a false claim just costs a cycle.\n"
    "- Every change happens through a tool call. When your work for this cycle is done, reply "
    "without tool calls with a two-line summary."
)

RALPH_TASK_TEXT = (
    "# STANDING TASK (identical every cycle — your context is fresh, the workspace is not)\n"
    "{{request}}\n\n"
    "WORKSPACE ROOT: {{workspace}}\n"
    "PLAN FILE: {{plan_file}}   PROGRESS FILE: {{progress_file}}\n"
    "This is cycle {{cycle}} of at most {{max}}.\n\n"
    "PROTOCOL FOR THIS CYCLE:\n"
    "1. Orient from the WORKSPACE SNAPSHOT and RECENT PROGRESS sections below — the orchestrator "
    "injects them fresh each cycle, so do NOT spend steps re-listing the workspace or re-reading "
    "{{progress_file}} for orientation. Open {{plan_file}} (or older progress history) only when "
    "those sections leave a real question. If {{plan_file}} is still a stub, write the plan into "
    "it first — the next cycle depends on it.\n"
    "2. Pick the next unfinished item and implement it.\n"
    "3. Verify what you changed.\n"
    "4. Append an entry to {{progress_file}} starting with a '## Cycle {{cycle}} — <short title>' "
    "heading line: what changed, what you verified, what is next.\n"
    "5. Only if the WHOLE task is complete and verified, add a line starting with "
    "\"{{marker}}\" followed by the evidence (what you ran and what it printed)."
)
RALPH_VERIFY_HINT_TEXT = (
    "VERIFICATION COMMAND (the orchestrator runs this itself after your cycle; it must exit 0 "
    "before the loop can end): `{{verify}}`"
)
RALPH_NO_VERIFY_TEXT = (
    "No verification command is configured, so completion rests on the marker plus the evidence "
    "you record. Write down exactly what you ran and what it printed."
)
RALPH_PROBE_HINT_TEXT = (
    "The `browser_probe` tool is mounted: load pages you produce and read back console errors "
    "instead of guessing. Give it a timeout in SECONDS and a port you own."
)
RALPH_STEERING_HEADER_TEXT = (
    "# OPERATOR STEERING (standing instructions added during this run — they amend the task and "
    "apply to every remaining cycle)"
)
RALPH_LAST_CHECK_TEXT = (
    "# LAST AUTOMATED CHECK (the orchestrator's own run of the verification command after the "
    "previous cycle — this is machine output, not a claim)\n{{tail}}"
)
# WARM START (0.2.0, ADR-0026). Both sections are injected MECHANICALLY by the
# cycle composer from a deterministic gather command — they are workspace
# memory, not conversation carry, so cycles stay fresh in the Ralph sense.
RALPH_WARM_LISTING_TEXT = (
    "# WORKSPACE SNAPSHOT (mechanical listing, depth 2, taken just before this cycle)\n"
    "{{listing}}"
)
RALPH_WARM_PROGRESS_TEXT = (
    "# RECENT PROGRESS (the newest entries of the progress file, injected verbatim by the "
    "orchestrator — orient from these instead of re-reading the file)\n{{tail}}"
)
RALPH_WARM_EMPTY_TEXT = (
    "# RECENT PROGRESS\n(no progress entries yet — if this is cycle 1, write the plan and record "
    "your first '## Cycle 1' entry at the end of the cycle)"
)
RALPH_WARM_OMITTED_TEXT = (
    "[older cycles omitted ({{omitted}} entr(y/ies)) — read the progress file for full history]"
)

CYCLE_STEP_SYSTEM = (
    "You are a coding agent executing ONE cycle of work in a real workspace. Think briefly, then "
    "either call tools or finish the cycle.\n\n"
    "- Every change happens through a tool call; never claim an edit you did not make.\n"
    "- The step trace below is what you already did IN THIS CYCLE.\n"
    "- When the cycle's work is done (including the progress-file update), reply without tool "
    "calls with a two-line summary."
)
CYCLE_TRACE_HEADER_TEXT = "# THIS CYCLE'S STEPS SO FAR"
CYCLE_FIRST_STEP_TEXT = "This is the first step of the cycle. Begin with the protocol above."
CYCLE_CLOSING_TEXT = (
    "Take the next step now: either call tools, or — if this cycle's work is complete — answer "
    "with the summary and make no tool calls."
)
CYCLE_ENTRY_TEXT = "--- step {{n}} ---\nTHOUGHT: {{thought}}\nACTIONS: {{calls}}\nOBSERVATIONS:\n{{obs}}"
CYCLE_TRIM_TEXT = "[...earlier steps of this cycle trimmed...]\n"
CYCLE_EMPTY_SUMMARY_TEXT = (
    "#FALLBACK the cycle ended without a summary; the progress file is the record of what "
    "actually happened."
)
CYCLE_BUDGET_SUMMARY_TEXT = (
    "#FALLBACK this cycle used its whole step budget without declaring itself finished; the "
    "workspace holds whatever it changed."
)

BOOTSTRAP_HEADER_PLAN = "# PLAN\n(stub — the first cycle fills this in)\n"
BOOTSTRAP_HEADER_PROGRESS = "# PROGRESS LOG\n(append one entry per cycle)\n"

RALPH_LINE_TEXT = "ralph cycle {{n}} of {{max}}: {{note}}"
RALPH_START_WORD = "fresh context, re-reading the workspace"
RALPH_STEER_WORD = "steering applied — "
CHECK_LINE_TEXT = "ralph check {{n}}: verify={{verify}} promise={{promise}} changes={{changes}}"
CHECK_WORD_OK = "pass"
CHECK_WORD_RED = "fail"
CHECK_WORD_SKIPPED = "not configured"
CHECK_WORD_FIRST = "baseline"
CHECK_SETTLED_WORD = " — settled: second consecutive green with no changes; concluding"

GATING_LINE_TEXT = "gating: {{mode}}"
GATING_WAIT_WORD = "wait"
GATING_AUTO_WORD = "auto"

GATE_PROMPT_TEXT = (
    "Cycle {{cycles}} passed the deterministic check (verification command exited 0 and the "
    "progress file carries the completion marker).\n\n{{evidence}}\n\n"
    "Reply 'accept' to finish, or describe what still needs to change (your words become standing "
    "operator steering for the next cycle)."
)
GATE_SETTLED_PROMPT_TEXT = (
    "Cycle {{cycles}} is the SECOND consecutive cycle where the verification command exited 0 "
    "with no workspace changes between the two (memory files excluded) — by the two-green rule "
    "the loop looks done, even though the completion marker was not written.\n\n{{evidence}}\n\n"
    "Reply 'accept' to finish, or describe what still needs to change (your words become standing "
    "operator steering for the next cycle)."
)

FALLBACK_REPORT_TEXT = (
    "#FALLBACK the cycle budget ({{max}}) ran out before the deterministic check passed. The "
    "workspace holds the work of every completed cycle and {{progress_file}} holds their own "
    "account; re-run to continue from there."
)
COMPLETE_REPORT_TEXT = (
    "The task passed the deterministic completion check after {{cycles}} cycle(s): the "
    "verification command exited 0 and {{progress_file}} carries the completion marker."
)
MARKER_ONLY_REPORT_TEXT = (
    "The loop stopped after {{cycles}} cycle(s) because {{progress_file}} carries the "
    "completion marker — but NO verification command was configured, so this completion "
    "is the model's own claim, not a verified fact. Configure verify_command to make "
    "completion deterministic."
)
SETTLED_REPORT_TEXT = (
    "The loop concluded after {{cycles}} cycle(s) by the two-green early-stop rule: the "
    "verification command exited 0 in two consecutive cycles and no files changed between them "
    "(memory files excluded from the fingerprint). A loop that is done twice is done — the "
    "remaining cycle budget was not burned. The completion marker was not written; "
    "{{progress_file}} holds the model's own account."
)
EVIDENCE_HEADER_TEXT = "EVIDENCE (tail of the progress file and the verification output):"
STEERING_SUMMARY_TEXT = "OPERATOR STEERING APPLIED DURING THIS RUN:"
REPORT_FOOTER_TEXT = "— ralph loop: {{cycles}} of {{max}} cycles used, stopped_reason={{stopped}}"
LAST_SUMMARY_HEADER_TEXT = "LAST CYCLE'S OWN SUMMARY:"

PREFLIGHT_EMPTY_REQUEST_TEXT = (
    "no coding request was provided (send `prompt` on the agent wrapper, or `request` on the root)"
)
PREFLIGHT_NO_WORKSPACE_TEXT = (
    "no workspace_root was provided; this workflow reads and writes real files, so it refuses to "
    "run against an unknown directory"
)
PREFLIGHT_REFUSAL_HEADER_TEXT = "REFUSED AT THE DOOR — the ralph coding loop did not start:"

WRAPPER_DIED_TEXT = (
    "The ralph coding run did not finish: {{error}}\n\nThe workspace and its progress file hold "
    "whatever the completed cycles did; the run's own trace holds the failing step."
)
WRAPPER_UNKNOWN_ERROR_TEXT = "the child run ended without producing a report"

# ---------------------------------------------------------------------------
# CODE BODIES
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
if budget > 30:
    budget = 30
try:
    steps = int(max_steps_per_cycle or 0)
except Exception:
    steps = 0
if steps < 1:
    steps = 1
if steps > 30:
    steps = 30
verify = str(verify_command or "").strip()
plan = str(plan_file or "PLAN.md").strip() or "PLAN.md"
progress = str(progress_file or "PROGRESS.md").strip() or "PROGRESS.md"
marker = str(done_marker or "DONE:").strip() or "DONE:"
# ADR-0026: 0 = no count bound (the 50k-token window alone applies); a
# positive value is an author's explicit bound.
try:
    warm = int(warm_entries or 0)
except Exception:
    warm = 0
if warm < 0:
    warm = 0
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
        "plan_file": plan,
        "progress_file": progress,
        "done_marker": marker,
        "max_cycles": budget,
        "max_steps_per_cycle": steps,
        "warm_entries": warm,
        "cycle": 0,
        "done": False,
        "complete": False,
        "verify_ok": False,
        "promise_done": False,
        "prev_verify_ok": False,
        "settled": False,
        "fp_changes": -1,
        "warm_progress": "",
        "warm_listing": "",
        "steering_notes": "",
        "steer_seen": 0,
        "steer_new": 0,
        "last_summary": "",
        "last_check": "",
        "evidence": "",
        "stopped_reason": "",
    },
    "report": "\n".join(lines),
}
""".strip()

# WARM-START GATHER (0.2.0): one deterministic execute_command per cycle,
# BEFORE the prompt composer — never an llm call. Sentinels bracket the two
# sections so the fold can split them apart without guessing.
WARM_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
prog_q = shq(str(progress_file or "PROGRESS.md"))
cmd = ("cd '" + ws_q + "' && echo '---RALPH-LISTING---'; "
       # ADR-0026: no `head -n 120` — the coder reads this listing and a hidden
       # tail is a file it re-creates.
       "find . -maxdepth 2 -name .git -prune -o -print 2>/dev/null | sort; "
       "echo '---RALPH-PROGRESS---'; cat '" + prog_q + "' 2>/dev/null; "
       "echo; echo '---RALPH-WARM-END---'")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 60},
                      "call_id": "ralph-warm"}}
""".strip()

# ADR-0026: the progress tail is replayed history, so it follows the runtime's
# history rule: the newest WHOLE entries up to HISTORY_REPLAY_MAX_TOKENS
# (50,000 estimated tokens, ~4 chars/token — the runtime's fallback estimate).
# An entry starts at a '## ' heading (the protocol tells the model to head each
# cycle's entry '## Cycle N — <title>'). Older entries past the window (or past
# an explicit warm_entries bound) are OMITTED with the omission STATED, never
# clipped mid-entry; the newest entry is always injected whole. A progress file
# with no '## ' structure is one document and is injected whole.
WARM_FOLD_CODE = r"""
txt = text_of(result)
listing = ""
progress = ""
if "---RALPH-LISTING---" in txt:
    after = txt.split("---RALPH-LISTING---", 1)[1]
    if "---RALPH-PROGRESS---" in after:
        parts2 = after.split("---RALPH-PROGRESS---", 1)
        listing = parts2[0]
        progress = parts2[1]
    else:
        listing = after
if "---RALPH-WARM-END---" in progress:
    progress = progress.split("---RALPH-WARM-END---", 1)[0]
lines = []
for ln in listing.splitlines():
    s = ln.strip()
    if s and s != "." and ".ralph_" not in s:
        lines.append(s)
# ADR-0026: the workspace listing the coder reads is WHOLE. A 100-path slice
# sat here and hid files the model then "created" a second time.
listing_out = "\n".join(lines)
try:
    n = int(warm_entries or 0)
except Exception:
    n = 0
window_tokens = 50000
entries = []
cur = []
in_entry = False
for ln in progress.splitlines():
    if ln.startswith("## "):
        if in_entry:
            entries.append("\n".join(cur).strip())
        cur = [ln]
        in_entry = True
    else:
        if in_entry:
            cur.append(ln)
if in_entry:
    entries.append("\n".join(cur).strip())
omitted = 0
warm = ""
if entries:
    keep = entries
    if n > 0 and len(keep) > n:
        omitted = len(keep) - n
        keep = keep[len(keep) - n:]
    total = 0
    for e in keep:
        total = total + max(1, int(len(e) / 4))
    while len(keep) > 1 and total > window_tokens:
        total = total - max(1, int(len(keep[0]) / 4))
        omitted = omitted + 1
        keep = keep[1:]
    warm = "\n\n".join(keep)
    if omitted > 0:
        warm = str(omitted_text or "").replace("{{omitted}}", str(omitted)) + "\n\n" + warm
else:
    warm = progress.strip()
return {"updates": {"warm_listing": listing_out, "warm_progress": warm}}
""".strip()

# Create the two memory files ONCE, only if absent. `printf '%s'` with the
# header on its own quoted argument keeps the content out of the format
# string (a stray % in an edited header would otherwise eat the next word).
BOOTSTRAP_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
plan_q = shq(str(plan_file or "PLAN.md"))
prog_q = shq(str(progress_file or "PROGRESS.md"))
plan_head = shq(str(plan_header or ""))
prog_head = shq(str(progress_header or ""))
cmd = ("cd '" + ws_q + "' && "
       "[ -f '" + plan_q + "' ] || printf '%s' '" + plan_head + "' > '" + plan_q + "'; "
       "[ -f '" + prog_q + "' ] || printf '%s' '" + prog_head + "' > '" + prog_q + "'; "
       "echo RALPH_MEMORY_READY")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 60},
                      "call_id": "ralph-bootstrap"}}
""".strip()

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

# THE LATE DRAIN (0.1.1, found on the live gateway run 07989c5d): a cycle can
# take minutes, and the deterministic check can pass on the FIRST one. A steer
# that arrived during that cycle would then never be applied — the run would
# end having never seen the operator's words. So the inbox is drained again
# after the check and BEFORE the completion decision, and fresh steering
# RE-OPENS a completion: the loop owes the operator one more cycle. Same
# watermark var as the cycle-top fold, so nothing is applied twice.
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
still_complete = bool(complete) and added == 0
return {"updates": {"steering_notes": notes, "steer_seen": len(items),
                    "steer_new": added, "complete": still_complete}}
""".strip()

CYCLE_LINE_CODE = r"""
n = int(cycle or 0) + 1
mx = int(max_cycles or 0)
note = str(last_summary or "").strip().replace("\n", " ")
# DISPLAY ONLY: `note` feeds the one-line "ralph cycle N of M" progress message
# (answer_user); no model reads it, and the whole summary stays in the run.
if len(note) > 120:
    note = note[:120] + "… (truncated)"  #[WARNING:TRUNCATION] labeled progress-line preview
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

# THE FIXED PROMPT. Everything that varies between cycles is deliberately
# NOT conversation: the cycle counter, the standing operator steering, and the
# orchestrator's own machine-generated check output. The model's own words
# from the previous cycle are absent by design — they live in the progress
# file, where the model has to go and read them.
CYCLE_PROMPT_CODE = r"""
n = int(cycle or 0) + 1
mx = int(max_cycles or 0)
plan = str(plan_file or "PLAN.md")
progress = str(progress_file or "PROGRESS.md")
head = str(task_text or "")
head = head.replace("{{request}}", str(request or ""))
head = head.replace("{{workspace}}", str(workspace_root or ""))
head = head.replace("{{plan_file}}", plan).replace("{{progress_file}}", progress)
head = head.replace("{{marker}}", str(done_marker or "DONE:"))
head = head.replace("{{cycle}}", str(n)).replace("{{max}}", str(mx))
parts = [head]
# WARM START (0.2.0): both sections are mechanical workspace memory, injected
# every cycle so the model does not burn steps re-deriving its situation.
wl = str(warm_listing or "").strip()
if wl:
    parts.append(str(warm_listing_text or "").replace("{{listing}}", wl))
wp = str(warm_progress or "").strip()
if wp:
    parts.append(str(warm_progress_text or "").replace("{{tail}}", wp))
else:
    parts.append(str(warm_empty_text or ""))
verify = str(verify_command or "").strip()
if verify:
    parts.append(str(verify_hint or "").replace("{{verify}}", verify))
else:
    parts.append(str(no_verify_text or ""))
if bool(probe_ok):
    parts.append(str(probe_hint or ""))
notes = str(steering_notes or "").strip()
if notes:
    parts.append(str(steering_header or "") + "\n" + notes)
check = str(last_check or "").strip()
if check:
    parts.append(str(last_check_text or "").replace("{{tail}}", check))
return {"prompt": "\n\n".join(parts)}
""".strip()

# The deterministic completion check — the whole point of the family. The exit
# code is captured BEFORE any pipe (a pipe reports tail's status: the classic
# false green). The promise marker is matched with a fixed-string grep so a
# marker containing regex characters still means itself.
CHECK_CMD_CODE = r"""
ws_q = shq(str(workspace_root or "").strip())
prog_q = shq(str(progress_file or "PROGRESS.md"))
plan_q = shq(str(plan_file or "PLAN.md"))
marker_q = shq(str(done_marker or "DONE:"))
verify = str(verify_command or "").strip()
if not verify:
    verify = "true"
# CHANGE FINGERPRINT (0.2.0): files newer than the stamp touched at the END of
# the previous check = what this cycle actually changed. Memory files (plan,
# progress) and the check's own artifacts are excluded — appending the progress
# entry is the loop's bookkeeping, not work. First check prints FP_NO_BASELINE.
cmd = ("cd '" + ws_q + "' && ( " + verify + " ) > .ralph_verify.log 2>&1; "
       "echo \"VERIFY_EXIT=$?\"; "
       "if grep -qF '" + marker_q + "' '" + prog_q + "' 2>/dev/null; then echo PROMISE=1; "
       "else echo PROMISE=0; fi; "
       "echo '---CHANGES---'; "
       "if [ -f .ralph_fp.stamp ]; then "
       "find . -name .git -prune -o -type f "
       "! -path './" + prog_q + "' ! -path './" + plan_q + "' "
       "! -name .ralph_verify.log ! -name .ralph_fp.stamp "
       "-newer .ralph_fp.stamp -print 2>/dev/null; "  # ADR-0026: no head -n 20
       "else echo FP_NO_BASELINE; fi; "
       "touch .ralph_fp.stamp; "
       # ADR-0026: whole files. `tail -n 30` clipped the head of every verify log
       # (the first compiler error) before the next cycle's prompt could read it.
       "echo '---PROGRESS-TAIL---'; cat '" + prog_q + "' 2>/dev/null; "
       "echo '---VERIFY-TAIL---'; cat .ralph_verify.log 2>/dev/null")
return {"tool_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 300},
                      "call_id": "ralph-check"}}
""".strip()

CHECK_FOLD_CODE = r"""
txt = text_of(result)
verify_ok = "VERIFY_EXIT=0" in txt
promise = "PROMISE=1" in txt
seg = ""
if "---CHANGES---" in txt:
    seg = txt.split("---CHANGES---", 1)[1]
    if "---PROGRESS-TAIL---" in seg:
        seg = seg.split("---PROGRESS-TAIL---", 1)[0]
changed_files = []
baseline = True
for ln in seg.splitlines():
    s = ln.strip()
    if not s:
        continue
    if s == "FP_NO_BASELINE":
        baseline = False
    else:
        changed_files.append(s)
quiet = baseline and len(changed_files) == 0
# EARLY STOP (0.2.0, two-green rule): two CONSECUTIVE verify-green cycles with
# NO file changes between them conclude the run — a loop that is done twice is
# done. Guarded by has_verify: with no verify command the exit code is a
# constant 0 and must never stop the loop on its own.
settled = bool(has_verify) and verify_ok and bool(prev_verify_ok) and quiet
n = int(cycle or 0) + 1
# ADR-0026: `evidence`/`last_check` are read by the NEXT cycle's coder prompt —
# a silent 3000-char tail clip sat here, dropping the head of every verify log
# (the compiler's first error) with no marker at all.
evidence = txt
summary = str(cycle_summary or "").strip()
fp = len(changed_files) if baseline else -1
return {"updates": {"cycle": n, "verify_ok": verify_ok, "promise_done": promise,
                    "complete": (verify_ok and promise) or settled,
                    "settled": settled, "prev_verify_ok": verify_ok, "fp_changes": fp,
                    "evidence": evidence,
                    "last_check": evidence, "last_summary": summary, "steer_new": 0}}
""".strip()

CHECK_LINE_CODE = r"""
n = int(cycle or 0)
vword = str(skipped_word or "")
if bool(has_verify):
    vword = str(ok_word or "") if bool(verify_ok) else str(red_word or "")
pword = str(ok_word or "") if bool(promise_done) else str(red_word or "")
try:
    fp = int(fp_changes)
except Exception:
    fp = -1
cword = str(first_word or "") if fp < 0 else str(fp)
msg = str(line_text or "")
msg = msg.replace("{{n}}", str(n)).replace("{{verify}}", vword).replace("{{promise}}", pword)
msg = msg.replace("{{changes}}", cword)
if bool(settled):
    msg = msg + str(settled_word or "")
return {"message": msg}
""".strip()

GATE_PROMPT_CODE = r"""
text = str(prompt_text or "")
# Two-green completion without the marker gets its OWN words: the standard
# text would claim a marker that was never written.
if bool(settled) and not bool(promise_done):
    alt = str(settled_prompt_text or "")
    if alt:
        text = alt
text = text.replace("{{cycles}}", str(int(cycle or 0)))
text = text.replace("{{evidence}}", str(evidence or "").strip())
return {"prompt": text}
""".strip()

GATE_FOLD_CODE = r"""
ans = str(answer or "").strip()
low = ans.lower()
accepted = (not low) or low.startswith("accept") or low.startswith("approve") or low == "ok" or low == "yes"
if accepted:
    return {"updates": {"done": True, "stopped_reason": str(accept_reason or "")}}
notes = str(steering_notes or "")
notes = notes + ("\n" if notes else "") + "- " + ans
return {"updates": {"done": False, "complete": False, "steering_notes": notes,
                    "stopped_reason": str(revise_reason or ""), "steer_new": 1}}
""".strip()

AUTO_DONE_CODE = r"""
# Honesty split (workflow-bench forensics 2026-08-01): with verify_command
# empty, the deterministic check degenerates to `grep DONE: PROGRESS.md` — a
# model-written string. ralph-3 wrote DONE: at exactly cycle 8/8 while its own
# progress entry still listed the remaining work. A marker-only completion is
# not a verified one and must not claim to be.
reason = str(stop_reason or "")
if not bool(has_verify) and reason == "verified-complete":
    reason = "marker-only-unverified"
elif bool(settled) and not bool(promise_done):
    # 0.2.0 two-green rule: the loop concluded because verify passed twice in
    # a row with no changes between — the marker was NOT written, and the
    # stopped_reason must say which rule ended the run.
    reason = "settled-two-green"
return {"updates": {"done": True, "stopped_reason": reason}}
""".strip()

REPORT_CODE = r"""
n = int(cycle or 0)
mx = int(max_cycles or 0)
progress = str(progress_file or "PROGRESS.md")
complete = bool(complete_flag)
stopped = str(stopped_reason or "")
if complete:
    if stopped == "marker-only-unverified":
        head = str(marker_only_text or "")
    elif stopped == "settled-two-green":
        head = str(settled_text or "")
    else:
        head = str(complete_text or "")
    head = head.replace("{{cycles}}", str(n)).replace("{{progress_file}}", progress)
    if not stopped:
        stopped = str(complete_reason or "")
else:
    head = str(fallback_text or "")
    head = head.replace("{{max}}", str(mx)).replace("{{progress_file}}", progress)
    stopped = str(budget_reason or "")
lines = [head]
summary = str(last_summary or "").strip()
if summary:
    lines.append(str(summary_header or "") + "\n" + summary)
ev = str(evidence or "").strip()
if ev:
    lines.append(str(evidence_header or "") + "\n" + ev)
notes = str(steering_notes or "").strip()
if notes:
    lines.append(str(steering_summary_text or "") + "\n" + notes)
foot = str(footer_text or "")
foot = foot.replace("{{cycles}}", str(n)).replace("{{max}}", str(mx)).replace("{{stopped}}", stopped)
lines.append(foot)
return {"report": "\n\n".join(lines), "passed": complete, "ok": complete,
        "stopped": stopped, "cycles": n}
""".strip()

# --- the per-cycle session (child flow) ------------------------------------
STEP_PROMPT_CODE = r"""
n = int(step or 0) + 1
parts = [str(task_prompt or "")]
trace = str(transcript or "").strip()
if trace:
    parts.append(str(trace_header or "") + "\n" + trace)
else:
    parts.append(str(first_step_text or ""))
parts.append(str(closing_text or "").replace("{{n}}", str(n)))
return {"prompt": "\n\n".join(parts)}
""".strip()

STEP_FOLD_CODE = r"""
n = int(step or 0) + 1
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
return {"updates": {"transcript": trace, "step": n}}
""".strip()

STEP_DONE_CODE = r"""
resp = str(response or "").strip()
if not resp:
    resp = str(empty_text or "")
return {"updates": {"summary": resp, "step_done": True, "step": int(step or 0) + 1}}
""".strip()

CYCLE_RESULT_CODE = r"""
summary = str(cycle_summary or "").strip()
finished = bool(step_done)
if not summary:
    summary = str(budget_text or "") if not finished else str(empty_text or "")
return {"summary": summary, "steps": int(step or 0), "ok": finished}
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
             "orchestration": "ralph"},
}
""".strip()

SEED_VARS = {
    "preflight_ok": False,
    "wait_gating": True,
    "request": "",
    "workspace_root": "",
    "verify_command": "",
    "has_verify": False,
    "probe_ok": False,
    "plan_file": "PLAN.md",
    "progress_file": "PROGRESS.md",
    "done_marker": "DONE:",
    "max_cycles": 8,
    "max_steps_per_cycle": 8,
    "warm_entries": 0,
    "cycle": 0,
    "done": False,
    "complete": False,
    "verify_ok": False,
    "promise_done": False,
    "prev_verify_ok": False,
    "settled": False,
    "fp_changes": -1,
    "warm_progress": "",
    "warm_listing": "",
    "steering_notes": "",
    "steer_seen": 0,
    "steer_new": 0,
    "last_summary": "",
    "last_check": "",
    "evidence": "",
    "stopped_reason": "",
}

CYCLE_SEED_VARS = {
    "step": 0,
    "step_done": False,
    "transcript": "",
    "summary": "",
    "max_steps": 8,
}

# Loop laws (derivations, never access): outer cycles until the DETERMINISTIC
# check says complete (or a reviewer accepts); inner steps until the model
# stops calling tools. Both pin defaults are False so a pre-expression runtime
# exits immediately instead of spinning to the cap.
OUTER_LAW = "not vars.done and vars.cycle < vars.max_cycles"
INNER_LAW = "not vars.step_done and vars.step < vars.max_steps"


def build_cycle() -> dict:
    """ONE fresh session. A child run has its OWN vars, so 'fresh context per
    cycle' is structural here rather than a discipline the prompt asks for."""
    f = base_flow(
        CYCLE_FLOW_ID, "Ralph cycle — one fresh session (llm_call + tool loop)",
        "One Ralph cycle: a bounded llm_call + tool_calls loop over a FIXED task prompt supplied "
        "by the parent. Accumulates only WITHIN the cycle; the child run's vars die with it, "
        "which is what makes the parent's context fresh every cycle. Returns the cycle's own "
        "summary, the steps used, and whether it finished inside its step budget.",
        interfaces=[])
    N, E = f["nodes"], f["edges"]
    N.append(node("start", "on_flow_start", "Cycle task", -800, 0,
                  outputs=[EXEC_OUT,
                           pin("task_prompt", "task_prompt", "string"),
                           pin("max_steps", "max_steps", "number"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  pin_defaults={"task_prompt": "", "max_steps": 8}))
    N.append(W.set_vars("seed_cycle", "Seed cycle variables", -600, 0, seed=CYCLE_SEED_VARS))
    seed = code_node("cycle_seed", "Cycle seed", r"""
try:
    steps = int(max_steps or 0)
except Exception:
    steps = 0
if steps < 1:
    steps = 1
if steps > 30:
    steps = 30
return {"updates": {"step": 0, "step_done": False, "transcript": "", "summary": "",
                    "max_steps": steps}}
""".strip(), -700, 0, [pin("max_steps", "max_steps", "number")],
                     outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(seed)
    E.append(edge("start", "max_steps", "cycle_seed", "max_steps"))
    E.append(edge("cycle_seed", "updates", "seed_cycle", "updates"))

    loop = while_node("steps", "CYCLE STEP LOOP", -400, 0)
    loop["data"]["pinDefaults"] = {"condition": False}
    N.append(W.with_expressions(loop, {"condition": INNER_LAW}))

    sp = code_node("step_prompt", "Compose step prompt", STEP_PROMPT_CODE, -200, 0,
                   [pin("task_prompt", "task_prompt", "string"),
                    pin("transcript", "transcript", "string"),
                    pin("step", "step", "number"),
                    pin("trace_header", "trace_header", "string"),
                    pin("first_step_text", "first_step_text", "string"),
                    pin("closing_text", "closing_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    sp["data"]["pinDefaults"].update({"trace_header": CYCLE_TRACE_HEADER_TEXT,
                                      "first_step_text": CYCLE_FIRST_STEP_TEXT,
                                      "closing_text": CYCLE_CLOSING_TEXT})
    N.append(sp)
    E.append(edge("start", "task_prompt", "step_prompt", "task_prompt"))
    read_vars(N, E, "step_prompt",
              [("transcript", "transcript", ""), ("step", "step", 0)], -200, -320)

    N.append(llm_node("step_llm", "REASON + ACT", 0, 0,
                      pin_defaults={"system": CYCLE_STEP_SYSTEM, "tools": CODER_TOOLS,
                                    "temperature": 0.2}))
    E.append(edge("step_prompt", "prompt", "step_llm", "prompt"))
    E.append(edge("start", "provider", "step_llm", "provider"))
    E.append(edge("start", "model", "step_llm", "model"))

    N.append(has_tools_node("has_calls", "Wants tools?", 200, -320))
    E.append(edge("step_llm", "tool_calls", "has_calls", "array"))
    N.append(if_node("route", "Act or finish cycle", 200, 0))
    E.append(edge("has_calls", "result", "route", "condition"))

    N.append(tool_calls_node("act", "EXECUTE TOOL CALLS", CODER_TOOLS, 400, 0))
    E.append(edge("step_llm", "tool_calls", "act", "tool_calls"))
    N.append(stringify_json_node("calls_json", "Calls to text", 400, -320))
    E.append(edge("step_llm", "tool_calls", "calls_json", "value"))
    N.append(format_tool_results_node("obs_text", "Observations", 600, -320))
    E.append(edge("act", "results", "obs_text", "results"))

    fold = code_node("fold", "Fold step into trace", STEP_FOLD_CODE, 600, 0,
                     [pin("transcript", "transcript", "string"),
                      pin("step", "step", "number"),
                      pin("thought", "thought", "string"),
                      pin("calls_text", "calls_text", "string"),
                      pin("observations", "observations", "string"),
                      pin("entry_text", "entry_text", "string"),
                      pin("trim_marker", "trim_marker", "string"),
                      pin("max_chars", "max_chars", "number")],
                     outputs=[pin("updates", "updates", "object")], exec_pins=True)
    fold["data"]["pinDefaults"].update({"entry_text": CYCLE_ENTRY_TEXT,
                                        "trim_marker": CYCLE_TRIM_TEXT,
                                        # ADR-0026: NO default step-trace bound
                                        # (20000 shipped here). 0 = unbounded;
                                        # an explicit bound carries the loud
                                        # trim marker in-band.
                                        "max_chars": 0})
    N.append(fold)
    E.append(edge("step_llm", "response", "fold", "thought"))
    E.append(edge("calls_json", "result", "fold", "calls_text"))
    E.append(edge("obs_text", "result", "fold", "observations"))
    read_vars(N, E, "fold", [("transcript", "transcript", ""), ("step", "step", 0)], 600, -600)
    N.append(W.set_vars("set_step", "Save step", 800, 0))
    E.append(edge("fold", "updates", "set_step", "updates"))

    sd = code_node("step_done", "Cycle finished", STEP_DONE_CODE, 400, 400,
                   [pin("response", "response", "string"),
                    pin("step", "step", "number"),
                    pin("empty_text", "empty_text", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    sd["data"]["pinDefaults"].update({"empty_text": CYCLE_EMPTY_SUMMARY_TEXT})
    N.append(sd)
    E.append(edge("step_llm", "response", "step_done", "response"))
    read_pin(N, E, "step_done", "step", "step", 0, 400, 120)
    N.append(W.set_vars("set_done", "Save cycle summary", 600, 400))
    E.append(edge("step_done", "updates", "set_done", "updates"))

    res = code_node("cycle_result", "Cycle result", CYCLE_RESULT_CODE, 1000, 0,
                    [pin("cycle_summary", "cycle_summary", "string"),
                     pin("step", "step", "number"),
                     pin("step_done", "step_done", "boolean"),
                     pin("budget_text", "budget_text", "string"),
                     pin("empty_text", "empty_text", "string")],
                    outputs=[pin("summary", "summary", "string"),
                             pin("steps", "steps", "number"),
                             pin("ok", "ok", "boolean")], exec_pins=True)
    res["data"]["pinDefaults"].update({"budget_text": CYCLE_BUDGET_SUMMARY_TEXT,
                                       "empty_text": CYCLE_EMPTY_SUMMARY_TEXT})
    N.append(res)
    read_vars(N, E, "cycle_result",
              [("cycle_summary", "summary", ""), ("step", "step", 0),
               ("step_done", "step_done", False)], 1000, -320)

    N.append(node("end", "on_flow_end", "Cycle done", 1200, 0,
                  inputs=[EXEC_IN, pin("summary", "summary", "string"),
                          pin("steps_used", "steps_used", "number"),
                          pin("success", "success", "boolean")],
                  pin_defaults={"summary": "", "steps_used": 0, "success": False}))
    E.append(edge("cycle_result", "summary", "end", "summary"))
    E.append(edge("cycle_result", "steps", "end", "steps_used"))
    E.append(edge("cycle_result", "ok", "end", "success"))

    E.append(edge("start", "exec-out", "cycle_seed", "exec-in"))
    E.append(edge("cycle_seed", "exec-out", "seed_cycle", "exec-in"))
    E.append(edge("seed_cycle", "exec-out", "steps", "exec-in"))
    E.append(edge("steps", "loop", "step_prompt", "exec-in"))
    E.append(edge("step_prompt", "exec-out", "step_llm", "exec-in"))
    E.append(edge("step_llm", "exec-out", "route", "exec-in"))
    E.append(edge("route", "true", "act", "exec-in"))
    E.append(edge("act", "exec-out", "fold", "exec-in"))
    E.append(edge("fold", "exec-out", "set_step", "exec-in"))
    E.append(edge("route", "false", "step_done", "exec-in"))
    E.append(edge("step_done", "exec-out", "set_done", "exec-in"))
    E.append(edge("steps", "done", "cycle_result", "exec-in"))
    E.append(edge("cycle_result", "exec-out", "end", "exec-in"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{CYCLE_FLOW_ID}.json", f)
    return f


def build_root() -> dict:
    f = base_flow(
        ROOT_FLOW_ID, "Ralph coder — same prompt, fresh context, every cycle",
        "The Ralph loop: every cycle sends the SAME fixed task prompt to a FRESH session "
        "(`ralph-cycle` subflow — a child run has its own vars, so nothing carries over). Memory "
        "lives in the workspace: the model reads PLAN.md/PROGRESS.md and updates PROGRESS.md each "
        "cycle. Completion is DETERMINISTIC, never model-claimed — the configured verify command "
        "must exit 0 AND the progress file must carry the completion marker; otherwise the loop "
        "runs another cycle up to max_cycles. Steering (`_runtime.inbox`) is folded into a "
        "steering_notes var that is templated into every cycle's prompt.",
        interfaces=[CODING_INTERFACE])
    N, E = f["nodes"], f["edges"]

    N.append(node("start", "on_flow_start", "Coding request", -2600, 0,
                  outputs=[EXEC_OUT,
                           pin("request", "request", "string"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("max_cycles", "max_cycles", "number"),
                           pin("max_steps_per_cycle", "max_steps_per_cycle", "number"),
                           pin("warm_entries", "warm_entries", "number"),
                           pin("verify_command", "verify_command", "string"),
                           pin("plan_file", "plan_file", "string"),
                           pin("progress_file", "progress_file", "string"),
                           pin("done_marker", "done_marker", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  pin_defaults={"request": "", "workspace_root": "", "gating_mode": "wait",
                                "max_cycles": 8, "max_steps_per_cycle": 16,
                                "warm_entries": 0,
                                "verify_command": "", "plan_file": "PLAN.md",
                                "progress_file": "PROGRESS.md", "done_marker": "DONE:",
                                "browser_probe_available": False}))

    pf = code_node("preflight", "Preflight", PREFLIGHT_CODE, -2400, 0,
                   [pin("request", "request", "string"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("gating_mode", "gating_mode", "string"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("max_steps_per_cycle", "max_steps_per_cycle", "number"),
                    pin("warm_entries", "warm_entries", "number"),
                    pin("verify_command", "verify_command", "string"),
                    pin("plan_file", "plan_file", "string"),
                    pin("progress_file", "progress_file", "string"),
                    pin("done_marker", "done_marker", "string"),
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
                   "max_steps_per_cycle", "warm_entries", "verify_command", "plan_file",
                   "progress_file", "done_marker", "browser_probe_available"):
        E.append(edge("start", pin_id, "preflight", pin_id))

    N.append(W.set_vars("seed_vars", "Seed run variables", -2200, 0, seed=SEED_VARS))
    E.append(edge("preflight", "updates", "seed_vars", "updates"))
    N.append(if_node("if_preflight", "Preflight ok?", -2000, 0))
    read_pin(N, E, "if_preflight", "condition", "preflight_ok", False, -2000, -320)
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", -2000, 300,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("passed", "passed", "boolean"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string"),
                          pin("cycles_used", "cycles_used", "number")],
                  pin_defaults={"passed": False, "success": False, "branch": "",
                                "stopped_reason": "preflight-failed", "cycles_used": 0}))
    E.append(edge("preflight", "report", "end_pre", "report"))

    gl = code_node("gating_line", "Compose gating line", GATING_LINE_CODE, -1800, -200,
                   [pin("wait_gating", "wait_gating", "boolean"),
                    pin("line_text", "line_text", "string"),
                    pin("wait_word", "wait_word", "string"),
                    pin("auto_word", "auto_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    gl["data"]["pinDefaults"].update({"line_text": GATING_LINE_TEXT,
                                      "wait_word": GATING_WAIT_WORD,
                                      "auto_word": GATING_AUTO_WORD})
    N.append(gl)
    read_pin(N, E, "gating_line", "wait_gating", "wait_gating", True, -1800, -520)
    N.append(answer_user_node("gating_status", "Gating mode", -1800, 0))
    E.append(edge("gating_line", "message", "gating_status", "message"))

    # ---- workspace memory bootstrap (once, only if absent) -----------------
    bc = code_node("bootstrap_cmd", "Compose memory bootstrap", BOOTSTRAP_CMD_CODE, -1600, 0,
                   [pin("workspace_root", "workspace_root", "string"),
                    pin("plan_file", "plan_file", "string"),
                    pin("progress_file", "progress_file", "string"),
                    pin("plan_header", "plan_header", "string"),
                    pin("progress_header", "progress_header", "string")],
                   outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    bc["data"]["pinDefaults"].update({"plan_header": BOOTSTRAP_HEADER_PLAN,
                                      "progress_header": BOOTSTRAP_HEADER_PROGRESS})
    N.append(bc)
    read_vars(N, E, "bootstrap_cmd",
              [("workspace_root", "workspace_root", ""), ("plan_file", "plan_file", "PLAN.md"),
               ("progress_file", "progress_file", "PROGRESS.md")], -1600, -320)
    N.append(call_tool_node("bootstrap_call", "Create plan/progress files",
                            ["execute_command"], -1400, 0))
    E.append(edge("bootstrap_cmd", "tool_call", "bootstrap_call", "tool_call"))

    # ---- THE RALPH LOOP ----------------------------------------------------
    loop = while_node("loop", "RALPH LOOP", -1200, 0)
    loop["data"]["pinDefaults"] = {"condition": False}
    N.append(W.with_expressions(loop, {"condition": OUTER_LAW}))

    sf = code_node("steer_fold", "Drain steer inbox", STEER_FOLD_CODE, -1000, 0,
                   [pin("inbox", "inbox", "array"),
                    pin("steer_seen", "steer_seen", "number"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("steer_new", "steer_new", "number")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(sf)
    read_vars(N, E, "steer_fold",
              [("inbox", "_runtime.inbox", []), ("steer_seen", "steer_seen", 0),
               ("steering_notes", "steering_notes", ""),
               ("steer_new", "steer_new", 0)], -1000, -320)
    N.append(W.set_vars("set_steer", "Apply steering", -800, 0))
    E.append(edge("steer_fold", "updates", "set_steer", "updates"))

    cl = code_node("cycle_line", "Compose cycle line", CYCLE_LINE_CODE, -600, 0,
                   [pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("steer_new", "steer_new", "number"),
                    pin("last_summary", "last_summary", "string"),
                    pin("line_text", "line_text", "string"),
                    pin("start_word", "start_word", "string"),
                    pin("steer_word", "steer_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    cl["data"]["pinDefaults"].update({"line_text": RALPH_LINE_TEXT,
                                      "start_word": RALPH_START_WORD,
                                      "steer_word": RALPH_STEER_WORD})
    N.append(cl)
    read_vars(N, E, "cycle_line",
              [("cycle", "cycle", 0), ("max_cycles", "max_cycles", 8),
               ("steer_new", "steer_new", 0), ("last_summary", "last_summary", "")], -600, -320)
    N.append(answer_user_node("cycle_status", "Cycle progress", -400, 0))
    E.append(edge("cycle_line", "message", "cycle_status", "message"))

    # ---- WARM-START GATHER (0.2.0): one deterministic command per cycle ----
    wc = code_node("warm_cmd", "Compose warm-start gather", WARM_CMD_CODE, -340, 0,
                   [pin("workspace_root", "workspace_root", "string"),
                    pin("progress_file", "progress_file", "string")],
                   outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    N.append(wc)
    read_vars(N, E, "warm_cmd",
              [("workspace_root", "workspace_root", ""),
               ("progress_file", "progress_file", "PROGRESS.md")], -340, -320)
    N.append(call_tool_node("warm_call", "Gather listing + progress tail",
                            ["execute_command"], -300, 0))
    E.append(edge("warm_cmd", "tool_call", "warm_call", "tool_call"))
    wfold = code_node("warm_fold", "Fold warm context (whole entries)", WARM_FOLD_CODE,
                      -260, 0,
                      [pin("result", "result", "any"),
                       pin("warm_entries", "warm_entries", "number"),
                       pin("omitted_text", "omitted_text", "string")],
                      outputs=[pin("updates", "updates", "object")], exec_pins=True)
    wfold["data"]["pinDefaults"].update({"omitted_text": RALPH_WARM_OMITTED_TEXT})
    N.append(wfold)
    E.append(edge("warm_call", "raw", "warm_fold", "result"))
    read_pin(N, E, "warm_fold", "warm_entries", "warm_entries", 0, -260, -320)
    N.append(W.set_vars("set_warm", "Save warm context", -230, 0))
    E.append(edge("warm_fold", "updates", "set_warm", "updates"))

    cp = code_node("cycle_prompt", "Compose the FIXED cycle prompt", CYCLE_PROMPT_CODE, -200, 0,
                   [pin("request", "request", "string"),
                    pin("workspace_root", "workspace_root", "string"),
                    pin("plan_file", "plan_file", "string"),
                    pin("progress_file", "progress_file", "string"),
                    pin("done_marker", "done_marker", "string"),
                    pin("verify_command", "verify_command", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("last_check", "last_check", "string"),
                    pin("warm_listing", "warm_listing", "string"),
                    pin("warm_progress", "warm_progress", "string"),
                    pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("probe_ok", "probe_ok", "boolean"),
                    pin("task_text", "task_text", "string"),
                    pin("verify_hint", "verify_hint", "string"),
                    pin("no_verify_text", "no_verify_text", "string"),
                    pin("probe_hint", "probe_hint", "string"),
                    pin("steering_header", "steering_header", "string"),
                    pin("last_check_text", "last_check_text", "string"),
                    pin("warm_listing_text", "warm_listing_text", "string"),
                    pin("warm_progress_text", "warm_progress_text", "string"),
                    pin("warm_empty_text", "warm_empty_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    cp["data"]["pinDefaults"].update({
        "task_text": RALPH_TASK_TEXT, "verify_hint": RALPH_VERIFY_HINT_TEXT,
        "no_verify_text": RALPH_NO_VERIFY_TEXT, "probe_hint": RALPH_PROBE_HINT_TEXT,
        "steering_header": RALPH_STEERING_HEADER_TEXT,
        "last_check_text": RALPH_LAST_CHECK_TEXT,
        "warm_listing_text": RALPH_WARM_LISTING_TEXT,
        "warm_progress_text": RALPH_WARM_PROGRESS_TEXT,
        "warm_empty_text": RALPH_WARM_EMPTY_TEXT,
    })
    N.append(cp)
    read_vars(N, E, "cycle_prompt",
              [("request", "request", ""), ("workspace_root", "workspace_root", ""),
               ("plan_file", "plan_file", "PLAN.md"),
               ("progress_file", "progress_file", "PROGRESS.md"),
               ("done_marker", "done_marker", "DONE:"),
               ("verify_command", "verify_command", ""),
               ("steering_notes", "steering_notes", ""), ("last_check", "last_check", ""),
               ("warm_listing", "warm_listing", ""),
               ("warm_progress", "warm_progress", ""),
               ("cycle", "cycle", 0), ("max_cycles", "max_cycles", 8),
               ("probe_ok", "probe_ok", False)], -200, -320)

    # THE FRESH SESSION. A subflow call, so the cycle's conversation lives and
    # dies in a child run — the parent never accumulates one.
    N.append(subflow_node("session", "Run one fresh cycle", CYCLE_FLOW_ID, 0, 0,
                          child_inputs=[("task_prompt", "string"),
                                        ("max_steps", "number"),
                                        ("provider", "provider_text"),
                                        ("model", "model")],
                          child_outputs=[("summary", "string"),
                                         ("steps_used", "number"),
                                         ("success", "boolean")]))
    E.append(edge("cycle_prompt", "prompt", "session", "task_prompt"))
    read_pin(N, E, "session", "max_steps", "max_steps_per_cycle", 8, 0, -320)
    read_pin(N, E, "session", "provider", "provider", None, 0, -460, chip="session_provider")
    read_pin(N, E, "session", "model", "model", None, 0, -600, chip="session_model")

    # ---- THE DETERMINISTIC CHECK ------------------------------------------
    cc = code_node("check_cmd", "Compose completion check", CHECK_CMD_CODE, 200, 0,
                   [pin("workspace_root", "workspace_root", "string"),
                    pin("progress_file", "progress_file", "string"),
                    pin("plan_file", "plan_file", "string"),
                    pin("done_marker", "done_marker", "string"),
                    pin("verify_command", "verify_command", "string")],
                   outputs=[pin("tool_call", "tool_call", "object")], exec_pins=True)
    N.append(cc)
    read_vars(N, E, "check_cmd",
              [("workspace_root", "workspace_root", ""),
               ("progress_file", "progress_file", "PROGRESS.md"),
               ("plan_file", "plan_file", "PLAN.md"),
               ("done_marker", "done_marker", "DONE:"),
               ("verify_command", "verify_command", "")], 200, -320)
    N.append(call_tool_node("check_call", "Run completion check", ["execute_command"], 400, 0))
    E.append(edge("check_cmd", "tool_call", "check_call", "tool_call"))

    cf = code_node("check_fold", "Read the check", CHECK_FOLD_CODE, 600, 0,
                   [pin("result", "result", "any"),
                    pin("cycle", "cycle", "number"),
                    pin("cycle_summary", "cycle_summary", "string"),
                    pin("has_verify", "has_verify", "boolean"),
                    pin("prev_verify_ok", "prev_verify_ok", "boolean")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(cf)
    E.append(edge("check_call", "raw", "check_fold", "result"))
    E.append(edge("session", "summary", "check_fold", "cycle_summary"))
    read_vars(N, E, "check_fold",
              [("cycle", "cycle", 0), ("has_verify", "has_verify", False),
               ("prev_verify_ok", "prev_verify_ok", False)], 600, -320)
    N.append(W.set_vars("set_check", "Save check result", 800, 0))
    E.append(edge("check_fold", "updates", "set_check", "updates"))

    kl = code_node("check_line", "Compose check line", CHECK_LINE_CODE, 1000, 0,
                   [pin("cycle", "cycle", "number"),
                    pin("has_verify", "has_verify", "boolean"),
                    pin("verify_ok", "verify_ok", "boolean"),
                    pin("promise_done", "promise_done", "boolean"),
                    pin("fp_changes", "fp_changes", "number"),
                    pin("settled", "settled", "boolean"),
                    pin("line_text", "line_text", "string"),
                    pin("ok_word", "ok_word", "string"),
                    pin("red_word", "red_word", "string"),
                    pin("skipped_word", "skipped_word", "string"),
                    pin("first_word", "first_word", "string"),
                    pin("settled_word", "settled_word", "string")],
                   outputs=[pin("message", "message", "string")], exec_pins=True)
    kl["data"]["pinDefaults"].update({"line_text": CHECK_LINE_TEXT, "ok_word": CHECK_WORD_OK,
                                      "red_word": CHECK_WORD_RED,
                                      "skipped_word": CHECK_WORD_SKIPPED,
                                      "first_word": CHECK_WORD_FIRST,
                                      "settled_word": CHECK_SETTLED_WORD})
    N.append(kl)
    read_vars(N, E, "check_line",
              [("cycle", "cycle", 0), ("has_verify", "has_verify", False),
               ("verify_ok", "verify_ok", False),
               ("promise_done", "promise_done", False),
               ("fp_changes", "fp_changes", -1),
               ("settled", "settled", False)], 1000, -320)
    N.append(answer_user_node("check_status", "Check result", 1200, 0))
    E.append(edge("check_line", "message", "check_status", "message"))

    # THE LATE DRAIN — before the completion decision, never after it.
    sl = code_node("steer_late", "Drain steer inbox (late)", STEER_LATE_CODE, 1300, 0,
                   [pin("inbox", "inbox", "array"),
                    pin("steer_seen", "steer_seen", "number"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("complete", "complete", "boolean")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    N.append(sl)
    read_vars(N, E, "steer_late",
              [("inbox", "_runtime.inbox", []), ("steer_seen", "steer_seen", 0),
               ("steering_notes", "steering_notes", ""), ("complete", "complete", False)],
              1300, -320)
    N.append(W.set_vars("set_steer_late", "Apply late steering", 1350, 0))
    E.append(edge("steer_late", "updates", "set_steer_late", "updates"))

    # complete? -> (wait mode) human accept, (auto) finish. Not complete: the
    # branch simply ends and the while node runs another cycle.
    N.append(if_node("if_complete", "Deterministically complete?", 1400, 0))
    read_pin(N, E, "if_complete", "condition", "complete", False, 1400, -320)
    N.append(if_node("if_gate", "Human review?", 1600, 0))
    read_pin(N, E, "if_gate", "condition", "wait_gating", False, 1600, -320)

    gp = code_node("gate_prompt", "Compose review question", GATE_PROMPT_CODE, 1800, 0,
                   [pin("cycle", "cycle", "number"),
                    pin("evidence", "evidence", "string"),
                    pin("settled", "settled", "boolean"),
                    pin("promise_done", "promise_done", "boolean"),
                    pin("prompt_text", "prompt_text", "string"),
                    pin("settled_prompt_text", "settled_prompt_text", "string")],
                   outputs=[pin("prompt", "prompt", "string")], exec_pins=True)
    gp["data"]["pinDefaults"].update({"prompt_text": GATE_PROMPT_TEXT,
                                      "settled_prompt_text": GATE_SETTLED_PROMPT_TEXT})
    N.append(gp)
    read_vars(N, E, "gate_prompt",
              [("cycle", "cycle", 0), ("evidence", "evidence", ""),
               ("settled", "settled", False),
               ("promise_done", "promise_done", False)], 1800, -320)
    N.append(ask_user_node("gate", "GATE: accept the verified result?", 2000, 0))
    E.append(edge("gate_prompt", "prompt", "gate", "prompt"))

    gf = code_node("gate_fold", "Fold reviewer answer", GATE_FOLD_CODE, 2200, 0,
                   [pin("answer", "answer", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("accept_reason", "accept_reason", "string"),
                    pin("revise_reason", "revise_reason", "string")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    gf["data"]["pinDefaults"].update({"accept_reason": "verified-and-accepted",
                                      "revise_reason": "user-revision"})
    N.append(gf)
    E.append(edge("gate", "response", "gate_fold", "answer"))
    read_pin(N, E, "gate_fold", "steering_notes", "steering_notes", "", 2200, -320)
    N.append(W.set_vars("set_gate", "Save review outcome", 2400, 0))
    E.append(edge("gate_fold", "updates", "set_gate", "updates"))

    ad = code_node("auto_done", "Finish (auto mode)", AUTO_DONE_CODE, 1800, 400,
                   [pin("stop_reason", "stop_reason", "string"),
                    pin("has_verify", "has_verify", "boolean"),
                    pin("settled", "settled", "boolean"),
                    pin("promise_done", "promise_done", "boolean")],
                   outputs=[pin("updates", "updates", "object")], exec_pins=True)
    ad["data"]["pinDefaults"].update({"stop_reason": "verified-complete"})
    N.append(ad)
    read_vars(N, E, "auto_done",
              [("has_verify", "has_verify", False), ("settled", "settled", False),
               ("promise_done", "promise_done", False)], 1700, 560)
    N.append(W.set_vars("set_done", "Save completion", 2000, 400))
    E.append(edge("auto_done", "updates", "set_done", "updates"))

    # ---- the report --------------------------------------------------------
    rp = code_node("report", "Final report", REPORT_CODE, 2600, 0,
                   [pin("cycle", "cycle", "number"),
                    pin("max_cycles", "max_cycles", "number"),
                    pin("complete_flag", "complete_flag", "boolean"),
                    pin("stopped_reason", "stopped_reason", "string"),
                    pin("progress_file", "progress_file", "string"),
                    pin("last_summary", "last_summary", "string"),
                    pin("evidence", "evidence", "string"),
                    pin("steering_notes", "steering_notes", "string"),
                    pin("complete_text", "complete_text", "string"),
                    pin("marker_only_text", "marker_only_text", "string"),
                    pin("settled_text", "settled_text", "string"),
                    pin("fallback_text", "fallback_text", "string"),
                    pin("summary_header", "summary_header", "string"),
                    pin("evidence_header", "evidence_header", "string"),
                    pin("steering_summary_text", "steering_summary_text", "string"),
                    pin("footer_text", "footer_text", "string"),
                    pin("complete_reason", "complete_reason", "string"),
                    pin("budget_reason", "budget_reason", "string")],
                   outputs=[pin("report", "report", "string"),
                            pin("passed", "passed", "boolean"),
                            pin("ok", "ok", "boolean"),
                            pin("stopped", "stopped", "string"),
                            pin("cycles", "cycles", "number")], exec_pins=True)
    rp["data"]["pinDefaults"].update({
        "complete_text": COMPLETE_REPORT_TEXT,
        "marker_only_text": MARKER_ONLY_REPORT_TEXT,
        "settled_text": SETTLED_REPORT_TEXT,
        "fallback_text": FALLBACK_REPORT_TEXT,
        "summary_header": LAST_SUMMARY_HEADER_TEXT, "evidence_header": EVIDENCE_HEADER_TEXT,
        "steering_summary_text": STEERING_SUMMARY_TEXT, "footer_text": REPORT_FOOTER_TEXT,
        "complete_reason": "verified-complete", "budget_reason": "budget-exhausted",
    })
    N.append(rp)
    read_vars(N, E, "report",
              [("cycle", "cycle", 0), ("max_cycles", "max_cycles", 8),
               ("complete_flag", "complete", False), ("stopped_reason", "stopped_reason", ""),
               ("progress_file", "progress_file", "PROGRESS.md"),
               ("last_summary", "last_summary", ""), ("evidence", "evidence", ""),
               ("steering_notes", "steering_notes", "")], 2600, -320)

    N.append(node("end", "on_flow_end", "Report", 2800, 0,
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

    # ---- exec spine --------------------------------------------------------
    for src, tgt in (("start", "preflight"), ("preflight", "seed_vars"),
                     ("seed_vars", "if_preflight")):
        E.append(edge(src, "exec-out", tgt, "exec-in"))
    E.append(edge("if_preflight", "false", "end_pre", "exec-in"))
    E.append(edge("if_preflight", "true", "gating_line", "exec-in"))
    for src, tgt in (("gating_line", "gating_status"), ("gating_status", "bootstrap_cmd"),
                     ("bootstrap_cmd", "bootstrap_call"), ("bootstrap_call", "loop")):
        E.append(edge(src, "exec-out", tgt, "exec-in"))
    E.append(edge("loop", "loop", "steer_fold", "exec-in"))
    for src, tgt in (("steer_fold", "set_steer"), ("set_steer", "cycle_line"),
                     ("cycle_line", "cycle_status"), ("cycle_status", "warm_cmd"),
                     ("warm_cmd", "warm_call"), ("warm_call", "warm_fold"),
                     ("warm_fold", "set_warm"), ("set_warm", "cycle_prompt"),
                     ("cycle_prompt", "session"), ("session", "check_cmd"),
                     ("check_cmd", "check_call"), ("check_call", "check_fold"),
                     ("check_fold", "set_check"), ("set_check", "check_line"),
                     ("check_line", "check_status"), ("check_status", "steer_late"),
                     ("steer_late", "set_steer_late"), ("set_steer_late", "if_complete")):
        E.append(edge(src, "exec-out", tgt, "exec-in"))
    E.append(edge("if_complete", "true", "if_gate", "exec-in"))
    E.append(edge("if_gate", "true", "gate_prompt", "exec-in"))
    E.append(edge("gate_prompt", "exec-out", "gate", "exec-in"))
    E.append(edge("gate", "exec-out", "gate_fold", "exec-in"))
    E.append(edge("gate_fold", "exec-out", "set_gate", "exec-in"))
    E.append(edge("if_gate", "false", "auto_done", "exec-in"))
    E.append(edge("auto_done", "exec-out", "set_done", "exec-in"))
    # if_complete FALSE is deliberately unwired: the cycle branch ends and the
    # while node schedules the next cycle (no backward exec edge exists in this
    # family). The control adapter returns to the innermost open frame — the
    # loop — exactly as it does for every other branch that runs out of nodes.
    E.append(edge("loop", "done", "report", "exec-in"))
    E.append(edge("report", "exec-out", "end", "exec-in"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def build_wrapper() -> dict:
    f = base_flow(
        WRAPPER_FLOW_ID, "Ralph coder — chat entry (same prompt, fresh context)",
        "Chat-agent entrypoint for the Ralph coding loop (no agent node). Every cycle re-sends the "
        "same task to a fresh session; memory is PLAN.md/PROGRESS.md in the workspace; completion "
        "is decided by a deterministic check (verify command exit 0 + completion marker), never by "
        "the model's claim. Defaults to gating_mode=wait: an interactive client answers ONE "
        "ask_user gate once the check passes, and can steer any cycle with the gateway's "
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
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           # Pass-through of the loop's own control pins
                           # (workflow-bench forensics 2026-08-01): the wrapper
                           # physically could not carry a verify_command, so
                           # EVERY chat-entry run got the degenerate marker-only
                           # completion check, and max_steps_per_cycle stayed at
                           # a value that provably starves the read->work->record
                           # protocol (~5 of 8 steps went to fresh-context
                           # re-derivation; PROGRESS.md froze at Cycle 1).
                           pin("verify_command", "verify_command", "string"),
                           pin("max_cycles", "max_cycles", "number"),
                           pin("max_steps_per_cycle", "max_steps_per_cycle", "number"),
                           pin("warm_entries", "warm_entries", "number"),
                           pin("plan_file", "plan_file", "string"),
                           pin("progress_file", "progress_file", "string"),
                           pin("done_marker", "done_marker", "string")],
                  pin_defaults={"prompt": "", "workspace_root": "", "gating_mode": "wait",
                                "browser_probe_available": True,
                                "verify_command": "", "max_cycles": 8,
                                "max_steps_per_cycle": 16, "warm_entries": 0,
                                "plan_file": "PLAN.md",
                                "progress_file": "PROGRESS.md", "done_marker": "DONE:"}))
    N.append(subflow_node("build", "Run the ralph loop", ROOT_FLOW_ID, -220, 0,
                          child_inputs=[("request", "string"),
                                        ("workspace_root", "string"),
                                        ("gating_mode", "string"),
                                        ("provider", "provider_text"),
                                        ("model", "model"),
                                        ("browser_probe_available", "boolean"),
                                        ("verify_command", "string"),
                                        ("max_cycles", "number"),
                                        ("max_steps_per_cycle", "number"),
                                        ("warm_entries", "number"),
                                        ("plan_file", "string"),
                                        ("progress_file", "string"),
                                        ("done_marker", "string")],
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
                   "browser_probe_available", "verify_command", "max_cycles",
                   "max_steps_per_cycle", "warm_entries", "plan_file",
                   "progress_file", "done_marker"):
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
    for n in flow["nodes"]:
        if n["data"].get("nodeType") == "set_var":
            raise AssertionError(
                f"{flow['id']}: node '{n['id']}' uses set_var — this family writes flat run vars "
                "through set_vars only")


def _assert_steer_hook(flow: dict) -> None:
    getters = {(n["data"].get("pinDefaults") or {}).get("name")
               for n in flow["nodes"] if n["data"].get("nodeType") == "get_var"}
    assert "_runtime.inbox" in getters, f"{flow['id']}: no Get Variable reads _runtime.inbox"
    assert "steer_seen" in getters, f"{flow['id']}: no steer watermark read"


def _assert_fresh_context(root: dict, cycle: dict) -> None:
    """RALPH'S DEFINING PROPERTY, enforced at build time.

    The parent must hold NO conversation var: if a `transcript` ever appeared
    in the root's seed, cycles would stop being fresh and this family would
    silently become a slower ReAct. The transcript lives in the CHILD only."""
    seed = None
    for n in root["nodes"]:
        if n["id"] == "seed_vars":
            seed = (n["data"].get("pinDefaults") or {}).get("updates") or {}
    assert seed is not None, "root has no seed_vars node"
    assert "transcript" not in seed, (
        "ralph-coding seeds a `transcript` run var — the parent must carry NO conversation "
        "across cycles (that is the whole difference from react-coding)")
    child_seed = None
    for n in cycle["nodes"]:
        if n["id"] == "seed_cycle":
            child_seed = (n["data"].get("pinDefaults") or {}).get("updates") or {}
    assert child_seed is not None and "transcript" in child_seed, (
        "ralph-cycle must accumulate WITHIN the cycle")


def main() -> int:
    cycle = build_cycle()
    root = build_root()
    wrapper = build_wrapper()
    for flow in (root, cycle, wrapper):
        _assert_no_state_blob(flow)
    _assert_steer_hook(root)
    _assert_fresh_context(root, cycle)
    ok = True
    for fid, flow in ((ROOT_FLOW_ID, root), (CYCLE_FLOW_ID, cycle), (WRAPPER_FLOW_ID, wrapper)):
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
          f" + {CYCLE_FLOW_ID}.json ({len(cycle['nodes'])} nodes)"
          f" + {WRAPPER_FLOW_ID}.json ({len(wrapper['nodes'])} nodes, agent.v1 entrypoint)")
    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        compile_check(WRAPPER_FLOW_ID, [ROOT_FLOW_ID, CYCLE_FLOW_ID, WRAPPER_FLOW_ID])
        out = pack_bundle(
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "ralph-coding",
                "min_runtime": "0.4.30",
                "requires_pin_expressions": True,
                "purpose": (
                    "Ralph coding loop with NO agent node: while(not done and cycle<max) { drain "
                    "_runtime.inbox -> standing steering, progress line, WARM-START gather "
                    "(deterministic: depth-2 listing + the newest WHOLE progress entries up to the "
                    "50k-token history window, ADR-0026, injected into the prompt so fresh context stops re-deriving state), "
                    "compose the SAME fixed task prompt, run one FRESH session (ralph-cycle "
                    "subflow: llm_call + tool_calls, own vars), then a DETERMINISTIC check — "
                    "verify command exit 0 AND the completion marker in the progress file, plus a "
                    "change fingerprint (find -newer stamp): TWO consecutive green cycles with no "
                    "file changes between them conclude the run early (settled-two-green) }. "
                    "Memory is the workspace (PLAN.md/PROGRESS.md), never a carried conversation. "
                    "Dual-interface: coding.v1 root 'ralph-coding' + agent.v1 wrapper "
                    "'ralph-coder' (picker-visible). Built to benchmark 1:1 against react-coder "
                    "and multiagent-coder — same wrapper inputs, same response/success/meta "
                    "contract."),
                "gating": {"pin": "gating_mode", "values": ["wait", "auto"], "default": "wait"},
                "steering": {"channel": "inject_guidance", "var": "_runtime.inbox",
                             "applied": "at every cycle boundary, deduped by the run-owned "
                                        "steer_seen watermark, templated into every cycle's "
                                        "prompt (fresh context carries no conversation)"},
                "outputs": ["report", "passed", "success", "stopped_reason", "cycles_used"],
                "auto_mode_requirement": (
                    "unattended runs must auto-approve the loop's tools: send "
                    "input_data._runtime.tool_policy = {\"auto_approve_max_risk_rank\": 2, "
                    "\"auto_approve_tools\": [\"execute_command\", \"read_file\", \"write_file\", "
                    "\"edit_file\", \"list_files\", \"search_files\", \"analyze_code\", "
                    "\"browser_probe\"]} or drive approvals externally, else the run parks on the "
                    "bootstrap command or the first tool the model asks for"),
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
