#!/usr/bin/env python3
"""Generator for the multi-agent coding workflow (operator directive, agora
c4710 relay). 14 steps: scouts(code+web) -> planner -> GATE1 -> backlog ->
git branch -> [build -> lint/format -> selfcheck refresh -> test(mounted
verify) -> doc -> PR -> GATE2]xN -> merge. Deterministic code handles git,
backlog, lint, selfcheck, PR plumbing and merge (no AI); agents handle scout,
plan, build, doc; two user gates (plan approval, merge approval).

Design + adversary history: docs/backlog/proposed/0152_multiagent_coding_workflow.md
(2 design cycles, 4 fable5 adversaries, 7 FATALs folded). Structural spine
mirrors build_coding_agent_workflow.py.

Cycle-3 invariants honored:
- NO backward exec edges: L1 plan loop + L2 build loop (`while` nodes);
  re-entry state = data in ONE fold per loop, stored in var `mw.state`.
- Pure-node double-fold guard: `next_state`/`gate1_parse`/... are consumed by
  exactly ONE set_var; every node running AFTER a set_var reads a fresh
  `get_var` pull, never the folding code node (volatile-pure re-entrancy).
- builder + verify INLINE in L2; ONLY coding-verify-gates is mounted (as a
  drift-pinned copy `multiagent-verify-gates`).
- gates behind wait-mode `if`s: gating_mode=auto executes ZERO ask_user nodes.
- split counters: gate-2 rejection resets fix_cycles, bumps review_rounds;
  verify failures bump fix_cycles; stall guard on normalized failure signature.
- merge requires green + approval in BOTH modes; merge is deterministic
  --no-ff with conflict-abort; PR degrades honestly without remote/gh.
- git safety: parent-repo guard (toplevel==pwd), GIT_CEILING_DIRECTORIES,
  baseline commit, injected identity, slug sanitization.
- preflight: skills_resolution + browser_probe posture, honest #FALLBACK
  advisories that ride into the final report.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W
from wf_common import (
    EXEC_IN, EXEC_OUT, pin, node, edge, base_flow, agent_node, code_node,
    get_var, set_var, while_node, subflow_node, write_file_node, get_node,
    validate_edges, write_json, FLOWS_DIR,
)

BUNDLE_ID = "multiagent-coding"
BUNDLE_VERSION = "0.0.3"
ROOT_FLOW_ID = "multiagent-coding"
VERIFY_FLOW_ID = "multiagent-verify-gates"
WRAPPER_FLOW_ID = "multiagent-coder"  # agent.v1 wrapper entrypoint (picker-visible)
STATE_VAR = "mw.state"
# The root is a strict CODING interface (request/workspace_root in, report
# out), NOT an agent.v1 chat surface: declaring agent.v1 here would invite
# chat clients to drive it with {prompt} and refuse every run at preflight -
# the exact false-contract coding-agent was burned for (its coder wrapper
# exists for that job). Cycle-3 adversary F1.
CODING_INTERFACE = "abstractcode.coding.v1"
AGENT_INTERFACE = "abstractcode.agent.v1"
# The wrapper's gating DEFAULT is "wait" (publication adversary, evidence-based
# reversal of the first "auto" choice): the primary picker client (abstractcode)
# is interactive and ANSWERS WaitReason.USER waits (react_shell _prompt_user),
# so the workflow's signature two-gate experience should be the default there;
# unattended clients (exec/serve refuse-policy) degrade NOISILY-and-bounded on
# ask_user (capped refusals then cancel), and can opt into gate-free runs by
# sending gating_mode="auto" through the DECLARED wrapper pin - no repack.
WRAPPER_GATING = "wait"


# --- extra node builders not in wf_common -----------------------------------
def call_tool(node_id, label, allowed, x, y):
    return node(node_id, "call_tool", label, x, y,
                inputs=[EXEC_IN, pin("tool_call", "tool_call", "object"),
                        pin("allowed_tools", "allowed_tools", "array")],
                outputs=[EXEC_OUT, pin("result", "result", "any"),
                         pin("success", "success", "boolean"),
                         pin("raw", "raw", "object")],
                pin_defaults={"allowed_tools": allowed},
                extra={"icon": "&#x1F527;", "headerColor": "#16A085"})


def if_node(node_id, label, x, y):
    return node(node_id, "if", label, x, y,
                inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
                outputs=[pin("true", "true", "execution"),
                         pin("false", "false", "execution")],
                extra={"icon": "&#x1F500;", "headerColor": "#F39C12"})


def ask_user(node_id, label, x, y, *, prompt_default=""):
    return node(node_id, "ask_user", label, x, y,
                inputs=[EXEC_IN, pin("prompt", "prompt", "string"),
                        pin("choices", "choices", "array")],
                outputs=[EXEC_OUT, pin("response", "response", "string")],
                pin_defaults={"prompt": prompt_default},
                extra={"icon": "&#x2753;", "headerColor": "#9B59B6"})


# ===========================================================================
# Deterministic code bodies (RestrictedPython: no imports, no chr(); string
# concatenation only). Every returned dict key is a pullable output handle.
# Shell quoting: POSIX close-quote escape  '\''  written as "'" + "\\" + "''".
# ===========================================================================

PREFLIGHT_CODE = r"""
req = str(request or "").strip()
ws = str(workspace_root or "").strip()
gating = str(gating_mode or "wait").strip().lower()
if gating not in ("wait", "auto"):
    gating = "wait"
# skills_resolution arrives from a get_var("_runtime.skills_resolution")
# node - the value the GATEWAY wrote after resolving input_data.skills -
# never from a caller-attested input pin (adversary F2: the pin always read
# {} and emitted false degrade advisories while the doc agent genuinely
# held the skill teaching).
sk = skills_resolution if isinstance(skills_resolution, dict) else {}
active = sk.get("active") if isinstance(sk.get("active"), list) else []
active = [str(x) for x in active]
need = skills if isinstance(skills, list) else []
need = [str(x) for x in need]
missing = []
for s in need:
    if s not in active:
        missing.append(s)
skills_degraded = len(missing) > 0
probe_ok = bool(browser_probe_available)
warnings = []
if skills_degraded:
    warnings.append("preflight: skills not active on this host: " + ", ".join(missing) + " - doc step runs on prompt guidance alone (#FALLBACK)")
if not probe_ok:
    warnings.append("preflight: browser_probe not mounted - verify certifies STATIC gates only; the human gate is the runtime/playability oracle (#FALLBACK)")
failures = []
if not req:
    failures.append("preflight: empty request")
if not ws:
    failures.append("preflight: no workspace_root (this workflow writes files + runs git; it needs an explicit workspace)")
ok = len(failures) == 0
state = {
    "gating_mode": gating,
    "accepted": False, "approved": False, "merged": False,
    "user_stopped": False, "last_gate2": "",
    "plan_revisions": 0, "fix_cycles": 0, "review_rounds": 0,
    "max_review_rounds": int(max_review_rounds or 2),
    "same_signature_count": 0, "failure_signature": "",
    "plan_feedback": "", "build_feedback": "", "rescout": False,
    "skills_degraded": skills_degraded, "probe_ok": probe_ok,
    "warnings": warnings, "scout_context": "",
    "plan": {}, "title": "", "branch": "", "branch_slug": "",
    "all_passed": False, "stopped_reason": "", "pr_path": "",
}
return {"preflight_ok": ok, "failures": failures, "state": state}
""".strip()

PRE_REPORT_CODE = r"""
fails = failures if isinstance(failures, list) else []
lines = ["# Multi-agent coding workflow: preflight failed", ""]
for f in fails:
    lines.append("- " + str(f))
# short token for the stopped_reason pin; the full document rides `report`
return {"report": "\n".join(lines), "reason": "preflight-failed"}
""".strip()

PLAN_COND_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
accepted = bool(s.get("accepted"))
revs = int(s.get("plan_revisions", 0) or 0)
maxrev = int(max_plan_revisions or 3)
wait_mode = str(s.get("gating_mode") or "wait") == "wait"
# scouts run on the first pass and again only on an explicit "research"
# choice; cached scout context feeds plain plan revisions for free
need_scout = (not str(s.get("scout_context") or "").strip()) or bool(s.get("rescout"))
return {"condition": (not accepted) and (revs < maxrev), "wait_mode": wait_mode,
        "need_scout": need_scout}
""".strip()

SCOUT_CODE_PROMPT = r"""
req = str(request or "").strip()
s = loop_state if isinstance(loop_state, dict) else {}
fb = str(s.get("plan_feedback") or "").strip()
extra = ("\n\nThe previous plan was sent back. Reviewer comments to address:\n" + fb) if fb else ""
p = ("You are the CODE+DOCS scout. Request:\n" + req +
     "\n\nMine ONLY the existing workspace: list folders, read/skim code and docs, search for prior art. "
     "Do NOT use the internet. Do NOT write anything. Return a compact findings list - for each: "
     "source path, the concrete fact, and why it matters for this request. If the workspace is empty, say so plainly." + extra)
return {"prompt": p}
""".strip()

SCOUT_WEB_PROMPT = r"""
req = str(request or "").strip()
s = loop_state if isinstance(loop_state, dict) else {}
fb = str(s.get("plan_feedback") or "").strip()
extra = ("\n\nThe previous plan was sent back. Reviewer comments to address:\n" + fb) if fb else ""
p = ("You are the INTERNET scout. Request:\n" + req +
     "\n\nMine ONLY the internet (web_search, fetch_url, skim). Do NOT read or write the workspace. "
     "Return a compact findings list - for each: source URL, the concrete claim, and why it matters. "
     "Prefer primary/reference sources over blogspam." + extra)
return {"prompt": p}
""".strip()

SCOUT_MERGE_CODE = r"""
c = str(code_findings or "").strip()
w = str(web_findings or "").strip()
parts = []
parts.append("## Code + documentation findings\n" + (c if c else "(scout returned nothing) #FALLBACK"))
parts.append("## Internet findings\n" + (w if w else "(scout returned nothing) #FALLBACK"))
blob = "\n\n".join(parts)
if len(blob) > 12000:
    blob = blob[:12000] + "\n\n[...scout context truncated at 12000 chars #TRUNCATION]"
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
s2["scout_context"] = blob
return {"state": s2}
""".strip()

PLANNER_PROMPT_CODE = r"""
req = str(request or "").strip()
s = loop_state if isinstance(loop_state, dict) else {}
ctx = str(s.get("scout_context") or "").strip()
fb = str(s.get("plan_feedback") or "").strip()
extra = ("\n\nThe reviewer sent the previous plan back with these comments; address every one:\n" + fb) if fb else ""
p = ("You are the PLANNER. Do not write code; produce the plan only.\n\nRequest:\n" + req +
     "\n\nEngineered context from the two scouts (code + internet):\n" + ctx +
     "\n\nReturn JSON with: title (AT MOST 3 words, branch-name friendly), goal (one paragraph), "
     "steps (ordered, concrete), files (paths you expect to create or change), risks (list)." + extra)
schema = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "goal": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}},
        "files": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["title", "goal", "steps"],
}
return {"prompt": p, "schema": schema}
""".strip()

GATE1_PROMPT_CODE = r"""
pd = planner_data if isinstance(planner_data, dict) else {}
title = str(pd.get("title") or "").strip()
goal = str(pd.get("goal") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
lines = ["PLAN for your approval.", "", "Title: " + (title or "(untitled)"), "", goal, "", "Steps:"]
i = 1
for st in steps:
    lines.append(str(i) + ". " + str(st))
    i = i + 1
lines.append("")
lines.append("Reply 'approve' to build, 'research: <what to dig deeper>' to re-scout, or anything else as revision comments for the planner.")
return {"prompt": "\n".join(lines), "choices": ["approve", "revise", "research"]}
""".strip()

GATE1_PARSE_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
resp = str(response or "").strip()
low = resp.lower()
pd = planner_data if isinstance(planner_data, dict) else {}
if low.startswith("approve") or low in ("yes", "ok", "lgtm"):
    s2["accepted"] = True
    s2["plan"] = pd
    s2["title"] = str(pd.get("title") or "").strip()
    s2["plan_feedback"] = ""
    s2["rescout"] = False
else:
    s2["accepted"] = False
    s2["plan_revisions"] = int(s.get("plan_revisions", 0) or 0) + 1
    s2["plan_feedback"] = resp if resp else "(reviewer gave no comment; produce a better, more concrete plan)"
    # re-scout is the human's EXPLICIT choice ("research: ..."), never a tax
    # on every plan revision (design A-R5; both cycle-3 adversaries flagged
    # the unconditional re-scout as a 2-subrun tax per comment).
    s2["rescout"] = low.startswith("research")
return {"state": s2}
""".strip()

# Auto mode must not accept a DEAD plan: agent death does not fail the parent
# (the agent node's success pin is unwired), so planner death would flow
# {} into an unconditional accept -> backlog slug "task", empty builder plan
# (adversary finding). Missing title/steps re-plans within the same budget.
GATE1_AUTO_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
pd = planner_data if isinstance(planner_data, dict) else {}
title = str(pd.get("title") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
if title and steps:
    s2["accepted"] = True
    s2["plan"] = pd
    s2["title"] = title
    s2["plan_feedback"] = ""
    s2["rescout"] = False
else:
    s2["accepted"] = False
    s2["plan_revisions"] = int(s.get("plan_revisions", 0) or 0) + 1
    s2["plan_feedback"] = "(planner returned no structured plan - emit valid JSON with title, goal and steps)"
    s2["rescout"] = False
return {"state": s2}
""".strip()

PLAN_DONE_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
return {"accepted": bool(s.get("accepted"))}
""".strip()

BACKLOG_FIELDS_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
title = str(pd.get("title") or s.get("title") or "task").strip().lower()
slug = ""
prev_dash = False
for ch in title:
    if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
        slug = slug + ch
        prev_dash = False
    elif not prev_dash and slug:
        slug = slug + "-"
        prev_dash = True
slug = slug.strip("-")[:40]
if not slug:
    slug = "task"
goal = str(pd.get("goal") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
files = pd.get("files") if isinstance(pd.get("files"), list) else []
risks = pd.get("risks") if isinstance(pd.get("risks"), list) else []
def bullets(xs):
    out = ""
    for x in xs:
        out = out + "- " + str(x) + "\n"
    return out if out else "- (none)\n"
body = ("# " + slug + "\n\n- Status: planned\n- Source: multi-agent coding workflow\n\n## Goal\n" +
        (goal if goal else "(none)") + "\n\n## Steps\n" + bullets(steps) +
        "\n## Files\n" + bullets(files) + "\n## Risks\n" + bullets(risks))
return {"slug": slug, "file_path": "docs/backlog/planned/" + slug + ".md", "content": body}
""".strip()

GIT_BRANCH_ARGS_CODE = r"""
slug = str(branch_slug or "task")
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
parent = ws.rstrip("/").rsplit("/", 1)[0] if "/" in ws.rstrip("/") else "/"
parent_q = parent.replace("'", "'" + "\\" + "''")
# Branch FIRST, baseline-commit SECOND: the baseline (which sweeps any
# uncommitted user work via add -A) lands on the WORK branch, never on the
# user's current branch (adversary F7 - pointing the workflow at an existing
# repo with uncommitted changes must not mutate their branch). A brand-new
# init has no commits, so checkout -b works there too.
cmd = (
    "export GIT_CEILING_DIRECTORIES='" + parent_q + "'; cd '" + ws_q + "' && "
    "top=$(git rev-parse --show-toplevel 2>/dev/null || echo NONE); "
    "if [ \"$top\" != \"$(pwd)\" ]; then git init -b main >/dev/null 2>&1 || git init >/dev/null 2>&1; fi; "
    "git checkout -b '" + slug + "' 2>/dev/null || git checkout '" + slug + "' 2>/dev/null || true; "
    "git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
    "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'baseline: pre-build workspace' >/dev/null 2>&1 || true; "
    "git rev-parse --abbrev-ref HEAD"
)
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "git-branch"}
""".strip()

# Shared raw-result text extractor used by folds. RECURSIVE envelope fold
# (ported from coding-agent GATE5, live-hardened across three 0.2.4 runs):
# the direct lane delivers the bare output dict, older shapes are plain
# strings, durable compaction leaves only *_preview, and the approval-resume
# lane nests {mode, results:[...]} — a single-shape reader misses conflicts
# and branch labels (cycle-3 adversary F3, proven live-shape misses).
_EXTRACT = r"""
def text_of(raw):
    parts = []
    stack = [raw]
    depth = 0
    while stack and depth < 400:
        depth = depth + 1
        cur = stack.pop()
        if isinstance(cur, str):
            if cur:
                parts.append(cur)
            continue
        if isinstance(cur, dict):
            for k in ("stdout", "stderr", "stdout_preview", "stderr_preview"):
                v = cur.get(k)
                if isinstance(v, str) and v:
                    parts.append(v)
            for k in ("output", "result", "results", "payload"):
                if k in cur:
                    stack.append(cur.get(k))
            continue
        if isinstance(cur, list):
            for item in cur:
                stack.append(item)
    return "\n".join(parts)
"""

GIT_BRANCH_FOLD_CODE = (_EXTRACT + r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
txt = text_of(git_raw).strip()
branch = txt.split("\n")[-1].strip() if txt else ""
s2["branch"] = branch if branch else str(s.get("branch_slug") or "work")
s2["branch_slug"] = str(slug or s.get("branch_slug") or "")
return {"state": s2}
""").strip()

BUILD_COND_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
approved = bool(s.get("approved"))
stopped = bool(s.get("user_stopped"))
env_blocked = bool(s.get("environment_blocked"))
fix = int(s.get("fix_cycles", 0) or 0)
rev = int(s.get("review_rounds", 0) or 0)
maxfix = int(max_fix_cycles or 3)
maxrev = int(max_review_rounds or 2)
stalled = int(s.get("same_signature_count", 0) or 0) >= 2
# In wait mode, fix-exhaustion/stall never exits directly: the loop body
# routes those cases to gate-2 as an ESCALATION (human comments reset the
# fix budget; "stop" sets user_stopped) - design G4's second half. Auto
# mode exits on budgets as before. environment_blocked exits IMMEDIATELY in
# both modes: no builder edit can install a missing executor (fail-soft,
# coding-agent 0.2.2 precedent).
cont = ((not approved) and (not stopped) and (not env_blocked)
        and (not stalled) and (fix < maxfix) and (rev <= maxrev))
return {"condition": cont}
""".strip()

BUILDER_PROMPT_CODE = r"""
req = str(request or "").strip()
s = loop_state if isinstance(loop_state, dict) else {}
pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
goal = str(pd.get("goal") or "").strip()
steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
plan_txt = goal
i = 1
for st in steps:
    plan_txt = plan_txt + "\n" + str(i) + ". " + str(st)
    i = i + 1
bf = str(s.get("build_feedback") or "").strip()
fix = int(s.get("fix_cycles", 0) or 0)
last = str(s.get("last_attempt_summary") or "").strip()
if fix == 0 and not bf:
    p = ("You are the BUILDER. You are on a dedicated git branch; implement this plan fully.\n\nRequest:\n" + req +
         "\n\nPlan:\n" + plan_txt +
         "\n\nEngineering rules: bound every loop and traversal; before writing logic over data, read a sample and verify its shape; "
         "prefer small verifiable functions; start EVERY source file with a 1-2 line header comment stating its purpose; "
         "self-probe your artifact before finishing (open it, run it, or trace the entry path). "
         "When done, write SELFCHECK.md: list each artifact with one line of evidence it works, and AFTER YOUR FINAL EDIT add one "
         "'ARTIFACT-SHA256: <path> <sha>' line per artifact (compute with: shasum -a 256 <path>).")
else:
    p = ("You are the BUILDER in REPAIR mode on the existing branch. Fix ONLY what the failures below name. "
         "Read before editing; make the smallest change that fixes the named defect; do NOT rewrite whole files with write_file; re-probe after fixing.\n\n"
         "Failures to fix:\n" + (bf if bf else "(none recorded - re-verify your artifacts)") +
         ("\n\nWhat you reported doing last cycle (do not repeat a failed approach unchanged):\n" + last if last else "") +
         "\n\nAfter your FINAL edit, refresh SELFCHECK.md evidence and its ARTIFACT-SHA256 lines.")
return {"prompt": p}
""".strip()

LINT_ARGS_CODE = r"""
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
cmd = ("cd '" + ws_q + "' && "
       "(command -v ruff >/dev/null 2>&1 && ruff check --fix . 2>&1 | tail -5 || true); "
       "(command -v prettier >/dev/null 2>&1 && prettier --write . 2>&1 | tail -5 || true); "
       "echo LINT_DONE")
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "lint-format"}
""".strip()

# Residuals = DIAGNOSTIC-SHAPED lines only (path:line:col or a syntax-error
# class token). Substring-'error' matching is a proven false-red generator:
# ruff's own success summary is "Found N errors (N fixed, 0 remaining)." and
# formatter output echoes touched paths, so a file named error_handler.py or
# any auto-fixed run would permanently red the build (adversary F1/F2,
# integration F5 - the stall signature is stable, so the run reports
# 'stalled' and never merges).
LINT_PARSE_CODE = (_EXTRACT + r"""
text = text_of(lint_raw)
def has_line_col(t):
    # ruff diagnostic grammar: <path>:<line>:<col>: <CODE> <msg>
    # (no all()/any() in the sandbox builtins - manual digit scan)
    i = t.find(":")
    while i >= 0:
        j = t.find(":", i + 1)
        if j > i + 1:
            seg = t[i+1:j]
            digits = len(seg) > 0
            for c in seg:
                if not ("0" <= c <= "9"):
                    digits = False
                    break
            if digits:
                return True
        i = t.find(":", i + 1)
    return False
def is_diag(t):
    low = t.lower()
    # summary/success lines are never residuals ("Found N errors (N fixed,
    # 0 remaining).", "All checks passed!")
    if "fixed" in low and "remaining" in low:
        return False
    if "all checks passed" in low or "0 error" in low or "no error" in low:
        return False
    # syntax-error class tokens are real even without a location
    if "syntaxerror" in low or "parse error" in low or "failed to parse" in low:
        return True
    # prettier failure lines: "[error] path: ..."
    if low.startswith("[error]"):
        return True
    # ruff residual diagnostics carry path:line:col (an error-named PATH is
    # still a real diagnostic; the false-positive class was summary lines
    # and bare touched-file echoes, both excluded above)
    if has_line_col(t):
        return True
    return False
residuals = []
for ln in text.split("\n"):
    t = ln.strip()
    if t and is_diag(t):
        residuals.append(t[:200])
return {"residuals": residuals[:20]}
""").strip()

SELFCHECK_ARGS_CODE = r"""
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
# Formatter may have rewritten bytes AFTER the builder hashed them; refresh the
# ARTIFACT-SHA256 lines deterministically so G5 binds to the shipped bytes
# (cycle-2 FATAL: formatter-breaks-G5).
# Space-safe path handling: iterate whole lines and strip the trailing hash
# field, never `for f in $(awk '{print $2}')` - word-splitting silently
# DELETED the binding line for any path with a space (adversary F5: the
# refresh destroyed what the mounted G5 gate deliberately parses).
cmd = ("cd '" + ws_q + "' && if [ -f SELFCHECK.md ]; then "
       "grep '^ARTIFACT-SHA256:' SELFCHECK.md > .sc_lines.tmp 2>/dev/null || true; "
       "grep -v '^ARTIFACT-SHA256:' SELFCHECK.md > SELFCHECK.md.tmp 2>/dev/null || true; "
       "while IFS= read -r line; do "
       "rest=${line#ARTIFACT-SHA256: }; f=${rest% *}; "
       "if [ -f \"$f\" ]; then echo \"ARTIFACT-SHA256: $f $(shasum -a 256 \"$f\" | awk '{print $1}')\" >> SELFCHECK.md.tmp; fi; "
       "done < .sc_lines.tmp; rm -f .sc_lines.tmp; "
       "mv SELFCHECK.md.tmp SELFCHECK.md; echo REFRESHED; else echo NO_SELFCHECK; fi")
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "selfcheck-refresh"}
""".strip()

COMMIT_ARGS_CODE = r"""
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'build cycle' >/dev/null 2>&1 || true; echo COMMITTED")
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "git-commit"}
""".strip()

VERIFY_INPUT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
return {"input": {
    "request": str(request or ""),
    "workspace_root": str(workspace_root or ""),
    "build_command": str(build_command or ""),
    "run_command": str(run_command or ""),
    "round_index": int(s.get("fix_cycles", 0) or 0),
    "provider": provider,
    "model": model,
}}
""".strip()

NEXT_STATE_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
v = verify_verdict if isinstance(verify_verdict, dict) else {}
all_passed = bool(v.get("all_passed"))
fails = v.get("failures") if isinstance(v.get("failures"), list) else []
fails = [str(x) for x in fails]
# Verifier DEATH is not "no failures": when the verify child run dies, the
# mapped output is None -> verdict {} with no all_passed key, and an empty
# failure list would blind the stall guard (empty signature never latches)
# while the report claims "budgets exhausted" with nothing to show
# (adversary finding: delivered != failed must survive verifier death).
meta = verify_meta if isinstance(verify_meta, dict) else {}
if "all_passed" not in v:
    all_passed = False
    err = str(meta.get("error") or "verify child run died or returned no verdict")
    fails.append("verify: verdict missing - " + err[:160] + " (#FALLBACK)")
# ENVIRONMENT failures are not fixable by the builder (missing executors,
# unavailable command execution): burning fix cycles on them is waste and the
# terminal lies ("budgets exhausted"). coding-agent 0.2.2 precedent: fail-soft
# to "delivered, not verifiable". Primary lane: the verify verdict's own
# environment_failures list; belt: executor/environment phrasing that the
# verify occasionally emits inside `failures` (live 2026-07-23: "missing
# Python executor" arrived there).
env_fails = v.get("environment_failures") if isinstance(v.get("environment_failures"), list) else []
env_fails = [str(x) for x in env_fails]
moved = []
for f in fails:
    low = str(f).lower()
    if ("missing" in low and "executor" in low) or ("execution not available" in low) or ("not available in this environment" in low):
        moved.append(f)
for f in moved:
    fails.remove(f)
    env_fails.append(f)
lint_res = lint_out if isinstance(lint_out, list) else []
for x in lint_res:
    fails.append("lint: " + str(x))
if lint_res:
    all_passed = False
# normalized failure signature: drop volatile evidence tail (first " - "),
# lowercase, strip STANDALONE digit runs (digits fused to identifiers kept -
# level2.js stays distinct from level3.js).
ident = "abcdefghijklmnopqrstuvwxyz_."
norm = []
for f in fails:
    t = str(f).strip().lower()
    d = t.find(" - ")
    if d >= 0:
        t = t[:d]
    out = ""
    i = 0
    n = len(t)
    while i < n:
        ch = t[i]
        if "0" <= ch <= "9":
            j = i
            while j < n and "0" <= t[j] <= "9":
                j = j + 1
            before = t[i-1] if i > 0 else ""
            after = t[j] if j < n else ""
            if (before in ident) or (after in ident):
                out = out + t[i:j]
            i = j
        else:
            out = out + ch
            i = i + 1
    norm.append(out.strip())
sig = "|".join(sorted(set(norm)))
prev_sig = str(s.get("failure_signature") or "")
same = int(s.get("same_signature_count", 0) or 0)
if sig and prev_sig and sig == prev_sig:
    same = same + 1
else:
    same = 0
s2["failure_signature"] = sig
s2["same_signature_count"] = same
s2["fix_cycles"] = int(s.get("fix_cycles", 0) or 0) + 1
s2["build_feedback"] = "\n".join(fails)
s2["all_passed"] = all_passed
s2["last_verdict"] = {"all_passed": all_passed, "failures": fails[:30],
                      "environment_failures": env_fails[:15]}
# environment-blocked: nothing fixable remains and the environment cannot
# verify - stop the loop honestly instead of burning the remaining budget
if env_fails and not fails and not all_passed:
    s2["environment_blocked"] = True
# attempt memory: the repair prompt cites what the builder SAID it did last
# cycle, so a repair round argues against the actual prior approach instead
# of rediscovering it (coding-agent R1 lesson: discarding builder.response
# loses the only record of the attempt).
br = str(builder_response or "").strip()
if br:
    s2["last_attempt_summary"] = br[-800:]
# auto mode: green means approved (no human gate by explicit operator choice)
if all_passed and str(s.get("gating_mode") or "wait") == "auto":
    s2["approved"] = True
return {"state": s2}
""".strip()

TAIL_CHECK_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
green = bool(s.get("all_passed"))
wait_mode = str(s.get("gating_mode") or "wait") == "wait"
env_blocked = bool(s.get("environment_blocked"))
fix = int(s.get("fix_cycles", 0) or 0)
maxfix = int(max_fix_cycles or 3)
stalled = int(s.get("same_signature_count", 0) or 0) >= 2
# G4 second half: in WAIT mode a stuck build (budget exhausted or stalled,
# still red) escalates to the human gate instead of dying silently - the
# reviewer's comments reset the fix budget; "stop" ends the run. Auto mode
# never escalates (budgets exit the loop). environment_blocked never
# escalates: no reviewer comment installs a missing executor.
escalate = wait_mode and (not green) and (not env_blocked) and (stalled or fix >= maxfix)
# in auto mode the fold already approved on green; the tail (doc+PR) still
# runs so the delivered branch carries docs and a PR/PR.md.
return {"green": green, "wait_mode": wait_mode, "escalate": escalate}
""".strip()

# The documenter runs AFTER verify, so it must not mutate what was verified:
# source-file edits here would merge unverified bytes (adversary F3,
# live-confirmed: the doc pass added a header to solution.py post-verify).
# Headers are the BUILDER's job (verified path); the documenter owns
# README/docs only, and a deterministic hash guard (docguard) re-checks the
# SELFCHECK-bound artifacts after this pass.
DOC_PROMPT_CODE = r"""
req = str(request or "").strip()
s = loop_state if isinstance(loop_state, dict) else {}
pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
goal = str(pd.get("goal") or req).strip()
deg = bool(s.get("skills_degraded"))
p = ("You are the DOCUMENTER. The build passed its verification gates on this branch.\n"
     "STRICT RULE: do NOT modify any source/code file - the verified bytes must ship exactly as tested. "
     "You write DOCUMENTATION FILES ONLY: README.md and files under docs/.\n\nTasks:\n"
     "1. Write or update README.md: what this delivers, how to run it, controls/usage, structure.\n"
     "2. Keep docs truthful to the CURRENT code - read the source before describing it; never invent features.\n\n"
     "What was built:\n" + goal)
if deg:
    p = p + "\n\n(coredoc skill not active on this host - follow the rules above on your own judgment. #FALLBACK)"
return {"prompt": p}
""".strip()

# Deterministic post-doc hash guard: recompute the SELFCHECK-bound artifact
# hashes after the documenter ran; any drift = the doc pass touched verified
# source, and the iteration goes red with a named failure instead of merging
# unverified bytes. Space-safe line loop (never word-split paths).
DOCGUARD_ARGS_CODE = r"""
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
# POSIX-safe: no process substitution (execute_command may run sh, not
# bash); a temp file keeps the drift flag in the same shell as the loop.
cmd = ("cd '" + ws_q + "' && if [ -f SELFCHECK.md ]; then "
       "grep '^ARTIFACT-SHA256:' SELFCHECK.md > .docguard.tmp 2>/dev/null || true; "
       "drift=0; while IFS= read -r line; do "
       "rest=${line#ARTIFACT-SHA256: }; sha=${rest##* }; f=${rest% *}; "
       "if [ -f \"$f\" ]; then now=$(shasum -a 256 \"$f\" | awk '{print $1}'); "
       "if [ \"$now\" != \"$sha\" ]; then echo \"DOC_DRIFT $f\"; drift=1; fi; "
       "else echo \"DOC_DRIFT $f (deleted)\"; drift=1; fi; "
       "done < .docguard.tmp; rm -f .docguard.tmp; "
       "if [ $drift -eq 0 ]; then echo DOC_GUARD_OK; fi; "
       "else echo NO_SELFCHECK_TO_GUARD; fi")
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "doc-guard"}
""".strip()

DOCGUARD_FOLD_CODE = (_EXTRACT + r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
txt = text_of(guard_raw)
drifted = []
for ln in txt.split("\n"):
    t = ln.strip()
    if t.startswith("DOC_DRIFT "):
        drifted.append(t[10:])
ok = ("DOC_GUARD_OK" in txt) or ("NO_SELFCHECK_TO_GUARD" in txt and not drifted)
if drifted:
    ok = False
    s2["all_passed"] = False
    s2["build_feedback"] = ("doc: the documentation pass modified verified source files: " +
                            ", ".join(drifted[:10]) +
                            " - restore or re-verify them and refresh SELFCHECK.md hashes")
return {"ok": ok, "state": s2, "drifted": drifted}
""").strip()

PR_FIELDS_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
title = str(s.get("title") or pd.get("title") or "work").strip()
goal = str(pd.get("goal") or "").strip()
branch = str(s.get("branch") or s.get("branch_slug") or "work")
v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
warns = s.get("warnings") if isinstance(s.get("warnings"), list) else []
lines = ["# PR: " + title, "", "Branch: " + branch, "", "## Goal", goal, "", "## Verification"]
lines.append("- gates: " + ("green" if bool(v.get("all_passed")) else "NOT GREEN"))
for w in warns:
    lines.append("- advisory: " + str(w))
body = "\n".join(lines)
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
branch_q = branch.replace("'", "'" + "\\" + "''")
# GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=true: a credentialed https remote must
# fail fast, never sit on a hidden credential prompt for the full command
# timeout (adversary F6 - unattended runs). timeout arg tightens the cap.
cmd = ("cd '" + ws_q + "' && export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true; "
       "if git remote get-url origin >/dev/null 2>&1; then "
       "if command -v gh >/dev/null 2>&1; then "
       "git push -u origin '" + branch_q + "' 2>&1 | tail -2; "
       "GH_PROMPT_DISABLED=1 gh pr create --fill --head '" + branch_q + "' 2>&1 | tail -2 || echo PR_EXISTS_OR_FAILED; "
       "else echo GH_UNAVAILABLE_LOCAL_PR_MD_ONLY; fi; "
       "else echo NO_REMOTE_LOCAL_PR_MD_ONLY; fi")
return {"pr_path": "PR.md", "pr_body": body,
        "gh_call": {"name": "execute_command", "arguments": {"command": cmd, "timeout": 120}, "call_id": "pr-create"}}
""".strip()

# Gate-2 serves TWO cases, composed from state: green = merge approval;
# red = ESCALATION of a stuck build (G4 second half - fix budget exhausted
# or stalled in wait mode). The prompt says which, warns when this is the
# final fundable review, and the parse keeps merge green-only.
GATE2_PROMPT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
branch = str(s.get("branch") or "work")
green = bool(s.get("all_passed"))
v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
fails = v.get("failures") if isinstance(v.get("failures"), list) else []
warns = s.get("warnings") if isinstance(s.get("warnings"), list) else []
rev = int(s.get("review_rounds", 0) or 0)
maxrev = int(s.get("max_review_rounds", 2) or 2)
lines = []
if green:
    lines.append("REVIEW GATE: the build is green on branch '" + branch + "' and PR.md summarizes it.")
    lines.append("Test the artifact yourself now (the gates are static checks; runtime behavior is yours to judge).")
    choices = ["approve", "request changes"]
else:
    lines.append("BUILD STUCK on branch '" + branch + "': the fix budget is exhausted (or the same failures repeat).")
    lines.append("Open failures:")
    for f in fails[:12]:
        lines.append("- " + str(f))
    lines.append("Comment to guide further repairs (resets the fix budget), or reply 'stop' to end the run unmerged.")
    choices = ["stop", "guide repairs"]
for w in warns:
    lines.append("- advisory: " + str(w))
if rev >= maxrev:
    lines.append("")
    lines.append("NOTE: this is the FINAL review round - a rejection ends the run unmerged.")
lines.append("")
if green:
    lines.append("Reply 'approve' to merge into main, or anything else as CHANGE REQUESTS sent back to the builder.")
return {"prompt": "\n".join(lines), "choices": choices}
""".strip()

GATE2_PARSE_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
green = bool(s.get("all_passed"))
resp = str(response or "").strip()
low = resp.lower()
approve = low.startswith("approve") or low in ("yes", "ok", "lgtm", "merge")
stop = low == "stop" or low.startswith("stop")
if green and approve:
    s2["approved"] = True
    s2["last_gate2"] = "approved"
elif stop:
    # escalation (or a green review) answered 'stop': end unmerged, honestly
    s2["approved"] = False
    s2["user_stopped"] = True
    s2["last_gate2"] = "stopped"
else:
    # change requests / repair guidance (an 'approve' on a RED build is NOT a
    # merge - merge requires green in both modes; treat it as guidance)
    s2["approved"] = False
    s2["review_rounds"] = int(s.get("review_rounds", 0) or 0) + 1
    s2["fix_cycles"] = 0
    s2["same_signature_count"] = 0
    s2["failure_signature"] = ""
    s2["all_passed"] = False
    s2["last_gate2"] = "rejected" if green else "escalated"
    s2["build_feedback"] = ("REVIEWER CHANGE REQUESTS (gate 2):\n" +
                            (resp if resp else "(no comment - reviewer rejected; improve robustness and polish)"))
return {"state": s2}
""".strip()

DONE_CHECK_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
return {"approved": bool(s.get("approved")) and bool(s.get("all_passed"))}
""".strip()

# Merge success is proven by a POSITIVE sentinel (MERGED_OK), never by the
# absence of a failure token: with a default branch that is neither main nor
# master both checkouts fail, the merge never runs, no token prints, and an
# absence-based fold would report "approved-and-merged" over an unmerged
# branch (adversary F4, proven end-to-end on a trunk-default repo).
MERGE_ARGS_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
ws = str(workspace_root or "").strip()
ws_q = ws.replace("'", "'" + "\\" + "''")
branch = str(s.get("branch") or "work").replace("'", "'" + "\\" + "''")
cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
       "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'final: docs + PR' >/dev/null 2>&1 || true; "
       "if git checkout main 2>/dev/null || git checkout master 2>/dev/null; then "
       "if git -c user.name='workflow' -c user.email='workflow@local' merge --no-ff '" + branch + "' -m 'merge: " + branch + "' 2>&1; then "
       "echo MERGED_OK $(git rev-parse --abbrev-ref HEAD); "
       "else git merge --abort 2>/dev/null; echo MERGE_CONFLICT_ABORTED; fi; "
       "else echo NO_MAINLINE_BRANCH; fi")
return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "git-merge"}
""".strip()

MERGE_FOLD_CODE = (_EXTRACT + r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
txt = text_of(merge_raw)
merged_ok = "MERGED_OK" in txt
conflict = "MERGE_CONFLICT_ABORTED" in txt
no_mainline = "NO_MAINLINE_BRANCH" in txt
s2["merged"] = merged_ok and bool(s.get("approved"))
warns = s2.get("warnings") if isinstance(s2.get("warnings"), list) else []
warns = list(warns)
if conflict:
    warns.append("merge: conflict - merge aborted; branch left unmerged (#FALLBACK)")
elif no_mainline:
    warns.append("merge: no main/master branch found - merge skipped; branch left unmerged (#FALLBACK)")
elif not merged_ok:
    warns.append("merge: no MERGED_OK confirmation in output - treating as unmerged (#FALLBACK)")
s2["warnings"] = warns
return {"state": s2}
""").strip()

FINAL_REPORT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
accepted = bool(s.get("accepted"))
approved = bool(s.get("approved"))
merged = bool(s.get("merged"))
passed = bool(s.get("all_passed"))
stopped = bool(s.get("user_stopped"))
last_g2 = str(s.get("last_gate2") or "")
branch = str(s.get("branch") or "")
warns = s.get("warnings") if isinstance(s.get("warnings"), list) else []
v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
fails = v.get("failures") if isinstance(v.get("failures"), list) else []
bf = str(s.get("build_feedback") or "").strip()
stalled = int(s.get("same_signature_count", 0) or 0) >= 2
env_blocked = bool(s.get("environment_blocked"))
if not accepted:
    reason = "plan-not-accepted (plan revisions exhausted without approval)"
elif merged:
    reason = "approved-and-merged"
elif approved:
    reason = "approved-merge-failed"
elif env_blocked:
    reason = "delivered-not-verifiable (environment cannot run the verification steps)"
elif stopped:
    reason = "stopped-by-reviewer (run ended unmerged at the review gate)"
elif (last_g2 in ("rejected", "escalated")
      and int(s.get("review_rounds", 0) or 0) > int(s.get("max_review_rounds", 2) or 2)):
    reason = "review-rounds-exhausted (last reviewer change requests unaddressed)"
elif passed:
    reason = "green-pending-approval"
elif stalled:
    reason = "stalled (same failures repeated; needs a different approach or human help)"
else:
    reason = "stopped-open-failures (budgets exhausted)"
lines = ["# Multi-agent coding workflow result", ""]
lines.append("Outcome: " + reason)
lines.append("Branch: " + (branch if branch else "(none)"))
lines.append("Gates: " + ("green" if passed else "not green"))
lines.append("Merged: " + ("yes" if merged else "no"))
lines.append("Plan revisions: " + str(int(s.get("plan_revisions", 0) or 0)) +
             " | fix cycles: " + str(int(s.get("fix_cycles", 0) or 0)) +
             " | review rounds: " + str(int(s.get("review_rounds", 0) or 0)))
if not accepted:
    # plan-exhaustion evidence: the last plan + the reviewer comments that
    # sent it back (an empty terminal hides why planning failed)
    pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
    pf = str(s.get("plan_feedback") or "").strip()
    lines.append("")
    lines.append("Last plan title: " + (str(s.get("title") or pd.get("title") or "").strip() or "(none)"))
    if pf:
        lines.append("Last reviewer comments on the plan:")
        for ln in pf.split("\n")[:8]:
            lines.append("  " + ln)
if reason.startswith("review-rounds-exhausted") and bf:
    lines.append("")
    lines.append("Unaddressed reviewer change requests:")
    for ln in bf.split("\n")[:10]:
        lines.append("  " + ln)
if fails:
    lines.append("")
    lines.append("Open failures:")
    for f in fails[:15]:
        lines.append("- " + str(f))
envf = v.get("environment_failures") if isinstance(v.get("environment_failures"), list) else []
if envf:
    lines.append("")
    lines.append("Environment (not fixable by the builder; artifacts delivered unverified):")
    for f in envf[:10]:
        lines.append("- " + str(f))
if warns:
    lines.append("")
    lines.append("Advisories:")
    for w in warns:
        lines.append("- " + str(w))
report = "\n".join(lines)
return {"report": report, "success": merged or (passed and approved),
        "stopped_reason": reason, "branch": branch}
""".strip()


def build_root() -> dict:
    f = base_flow(ROOT_FLOW_ID, "Multi-agent coding workflow",
                  "Scouts (code+web) -> planner -> plan gate -> backlog -> git branch -> "
                  "[build -> lint -> selfcheck -> verify -> doc -> PR -> review gate]xN -> merge. "
                  "Deterministic git/lint/PR/merge; two user gates (gating_mode=auto skips both; "
                  "auto mode needs input_data._runtime.tool_policy auto-approving execute_command "
                  "or an approving driver, else tool approvals park the run).",
                  interfaces=[CODING_INTERFACE])
    N = f["nodes"]
    E = f["edges"]

    # ---------------- nodes ----------------
    N.append(node("start", "on_flow_start", "Coding request", -2300, 0,
                  outputs=[EXEC_OUT,
                           pin("request", "request", "string"),
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string"),
                           pin("max_plan_revisions", "max_plan_revisions", "number"),
                           pin("max_fix_cycles", "max_fix_cycles", "number"),
                           pin("max_review_rounds", "max_review_rounds", "number"),
                           pin("skills", "skills", "array"),
                           pin("browser_probe_available", "browser_probe_available", "boolean"),
                           pin("build_command", "build_command", "string"),
                           pin("run_command", "run_command", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model")],
                  pin_defaults={"gating_mode": "wait", "max_plan_revisions": 3,
                                "max_fix_cycles": 3, "max_review_rounds": 2,
                                "skills": ["coredoc"],
                                "browser_probe_available": False,
                                "build_command": "", "run_command": ""}))

    # the gateway writes the REAL skills resolution to _runtime.skills_resolution
    # after resolving input_data.skills; get_var reads it (dotted paths + no
    # underscore restriction on reads - only set_var rejects leading underscores)
    N.append(get_var("get_skills_res", "_runtime.skills_resolution", {}, -2300, -540))
    N.append(code_node("preflight", "Preflight posture", PREFLIGHT_CODE, -1940, -540,
                       [pin("request", "request", "string"),
                        pin("workspace_root", "workspace_root", "string"),
                        pin("gating_mode", "gating_mode", "string"),
                        pin("skills", "skills", "array"),
                        pin("skills_resolution", "skills_resolution", "object"),
                        pin("max_review_rounds", "max_review_rounds", "number"),
                        pin("browser_probe_available", "browser_probe_available", "boolean")]))
    N.append(set_var("set_state0", "Seed state", STATE_VAR, -1940, 0))
    N.append(if_node("if_preflight", "Preflight ok?", -1580, 0))
    N.append(code_node("pre_report", "Preflight report", PRE_REPORT_CODE, -1580, -220,
                       [pin("failures", "failures", "array")]))
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", -1580, 260,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("stopped_reason", "stopped_reason", "string")]))

    # ---- L1: plan loop ----
    N.append(get_var("get_state_p", STATE_VAR, {}, -1220, 320))
    N.append(code_node("plan_cond", "Plan again?", PLAN_COND_CODE, -1220, 540,
                       [pin("loop_state", "loop_state", "object"),
                        pin("max_plan_revisions", "max_plan_revisions", "number")]))
    N.append(while_node("plan_while", "Plan loop", -1220, 0))
    N.append(if_node("if_scout", "Need scouting?", -1220, -440))

    N.append(code_node("scout_code_prompt", "Scout(code) prompt", SCOUT_CODE_PROMPT, -860, -440,
                       [pin("request", "request", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("scout_code", "Scout: code+docs", -860, -220,
                        pin_defaults={"tools": ["read_file", "list_files", "search_files",
                                                "skim_files", "skim_folders", "analyze_code"],
                                      "max_iterations": 12, "temperature": 0.2}))
    N.append(code_node("scout_web_prompt", "Scout(web) prompt", SCOUT_WEB_PROMPT, -500, -440,
                       [pin("request", "request", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("scout_web", "Scout: internet", -500, -220,
                        pin_defaults={"tools": ["web_search", "fetch_url", "skim_websearch", "skim_url"],
                                      "max_iterations": 12, "temperature": 0.2}))
    N.append(code_node("scout_merge", "Merge scout context", SCOUT_MERGE_CODE, -140, -440,
                       [pin("code_findings", "code_findings", "string"),
                        pin("web_findings", "web_findings", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state_scout", "Cache scout context", STATE_VAR, -140, -220))

    N.append(code_node("planner_prompt", "Planner prompt", PLANNER_PROMPT_CODE, 220, -440,
                       [pin("request", "request", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("planner", "Planner", 220, -220,
                        pin_defaults={"tools": [], "max_iterations": 6, "temperature": 0.2}))
    N.append(if_node("if_g1", "Wait mode?", 580, -220))
    N.append(code_node("gate1_prompt", "Gate-1 prompt", GATE1_PROMPT_CODE, 580, -440,
                       [pin("planner_data", "planner_data", "object")]))
    N.append(ask_user("gate1", "GATE 1: approve plan?", 940, -320,
                      prompt_default="Approve the plan?"))
    N.append(code_node("gate1_parse", "Parse gate-1", GATE1_PARSE_CODE, 1300, -440,
                       [pin("response", "response", "string"),
                        pin("loop_state", "loop_state", "object"),
                        pin("planner_data", "planner_data", "object")]))
    N.append(set_var("set_state_plan", "Record decision", STATE_VAR, 1300, -220))
    N.append(code_node("gate1_auto", "Auto-accept plan", GATE1_AUTO_CODE, 940, 40,
                       [pin("loop_state", "loop_state", "object"),
                        pin("planner_data", "planner_data", "object")]))
    N.append(set_var("set_state_plan_auto", "Record auto-accept", STATE_VAR, 1300, 40))

    # ---- accepted? -> backlog + git ----
    N.append(code_node("plan_done_check", "Plan accepted?", PLAN_DONE_CODE, -860, 540,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(if_node("if_accepted", "Accepted?", -860, 320))
    N.append(code_node("backlog_fields", "Backlog item fields", BACKLOG_FIELDS_CODE, -500, 100,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(write_file_node("backlog_write", "Write planned item", -500, 320))
    N.append(code_node("git_args", "Compose git branch", GIT_BRANCH_ARGS_CODE, -140, 100,
                       [pin("branch_slug", "branch_slug", "string"),
                        pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("git_call", "Git init+branch", ["execute_command"], -140, 320))
    N.append(code_node("git_fold", "Record branch", GIT_BRANCH_FOLD_CODE, 220, 100,
                       [pin("git_raw", "git_raw", "object"),
                        pin("slug", "slug", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state_git", "Record branch state", STATE_VAR, 220, 320))

    # ---- L2: build loop ----
    N.append(get_var("get_state_b", STATE_VAR, {}, 580, 540))
    N.append(code_node("build_cond", "Build again?", BUILD_COND_CODE, 580, 760,
                       [pin("loop_state", "loop_state", "object"),
                        pin("max_fix_cycles", "max_fix_cycles", "number"),
                        pin("max_review_rounds", "max_review_rounds", "number")]))
    N.append(while_node("build_while", "Build loop", 580, 320))

    N.append(code_node("builder_prompt", "Builder prompt", BUILDER_PROMPT_CODE, 940, 540,
                       [pin("request", "request", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("builder", "Builder", 940, 760,
                        pin_defaults={"tools": ["read_file", "write_file", "edit_file",
                                                "list_files", "search_files", "analyze_code",
                                                "execute_command"],
                                      "max_iterations": 40, "temperature": 0.2}))
    N.append(code_node("lint_args", "Compose lint+format", LINT_ARGS_CODE, 1300, 540,
                       [pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("lint_call", "Lint + format (fix)", ["execute_command"], 1300, 760))
    N.append(code_node("lint_parse", "Parse lint residuals", LINT_PARSE_CODE, 1660, 540,
                       [pin("lint_raw", "lint_raw", "object")]))
    N.append(code_node("selfcheck_args", "Compose SELFCHECK refresh", SELFCHECK_ARGS_CODE, 1660, 980,
                       [pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("selfcheck_call", "Refresh SELFCHECK hashes", ["execute_command"], 1660, 760))
    N.append(code_node("commit_args", "Compose commit", COMMIT_ARGS_CODE, 2020, 980,
                       [pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("commit_call", "Commit cycle", ["execute_command"], 2020, 760))
    N.append(code_node("verify_input", "Verify input", VERIFY_INPUT_CODE, 2380, 380,
                       [pin("loop_state", "loop_state", "object"),
                        pin("request", "request", "string"),
                        pin("workspace_root", "workspace_root", "string"),
                        pin("build_command", "build_command", "string"),
                        pin("run_command", "run_command", "string"),
                        pin("provider", "provider", "provider_text"),
                        pin("model", "model", "model")]))
    N.append(subflow_node("verify", "Test: mounted gates", VERIFY_FLOW_ID, 2380, 760))
    N.append(get_node("get_verdict", "verdict", {}, 2740, 540))
    N.append(code_node("next_state", "Fold verdict", NEXT_STATE_CODE, 2740, 980,
                       [pin("verify_verdict", "verify_verdict", "object"),
                        pin("verify_meta", "verify_meta", "object"),
                        pin("builder_response", "builder_response", "string"),
                        pin("lint_out", "lint_out", "array"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state_build", "Record build state", STATE_VAR, 2740, 760))

    N.append(get_var("get_state_tail", STATE_VAR, {}, 3100, 540))
    N.append(code_node("tail_check", "Green / escalate?", TAIL_CHECK_CODE, 3100, 980,
                       [pin("loop_state", "loop_state", "object"),
                        pin("max_fix_cycles", "max_fix_cycles", "number")]))
    N.append(if_node("if_green", "Gates green?", 3100, 760))
    N.append(if_node("if_escalate", "Stuck: ask human?", 3100, 1200))
    N.append(set_var("set_state_noop", "Iteration ends (red)", STATE_VAR, 3460, 1200))

    N.append(code_node("doc_prompt", "Documenter prompt", DOC_PROMPT_CODE, 3460, 540,
                       [pin("request", "request", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(agent_node("doc", "Documenter", 3460, 760,
                        pin_defaults={"tools": ["read_file", "write_file", "edit_file",
                                                "list_files", "search_files"],
                                      "max_iterations": 15, "temperature": 0.2}))
    N.append(code_node("docguard_args", "Compose doc guard", DOCGUARD_ARGS_CODE, 3820, 300,
                       [pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("docguard_call", "Doc guard (hash check)", ["execute_command"], 3820, 540))
    N.append(code_node("docguard_fold", "Doc drift?", DOCGUARD_FOLD_CODE, 3820, 980,
                       [pin("guard_raw", "guard_raw", "object"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(if_node("if_docok", "Source untouched?", 4180, 540))
    N.append(set_var("set_state_docred", "Doc broke it (red)", STATE_VAR, 4180, 300))
    N.append(code_node("pr_fields", "PR body + gh command", PR_FIELDS_CODE, 4180, 980,
                       [pin("loop_state", "loop_state", "object"),
                        pin("workspace_root", "workspace_root", "string")]))
    N.append(write_file_node("pr_write", "Write PR.md", 4540, 980))
    N.append(call_tool("pr_call", "Push + PR (if remote)", ["execute_command"], 4900, 980))
    N.append(if_node("if_g2", "Wait mode?", 5260, 980))
    N.append(code_node("gate2_prompt", "Gate-2 prompt", GATE2_PROMPT_CODE, 5260, 540,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(ask_user("gate2", "GATE 2: approve merge?", 5620, 760,
                      prompt_default="Test the build; approve the merge?"))
    N.append(code_node("gate2_parse", "Parse gate-2", GATE2_PARSE_CODE, 5980, 540,
                       [pin("response", "response", "string"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state_g2", "Record review", STATE_VAR, 5980, 760))
    N.append(set_var("set_state_g2auto", "Auto mode: end iteration", STATE_VAR, 5620, 1200))

    # ---- post-loop: merge + report ----
    N.append(get_var("get_state_done", STATE_VAR, {}, 940, 1420))
    N.append(code_node("done_check", "Approved + green?", DONE_CHECK_CODE, 940, 1640,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(if_node("if_approved", "Merge?", 940, 1200))
    N.append(code_node("merge_args", "Compose merge", MERGE_ARGS_CODE, 1300, 1420,
                       [pin("loop_state", "loop_state", "object"),
                        pin("workspace_root", "workspace_root", "string")]))
    N.append(call_tool("merge_call", "Merge --no-ff to main", ["execute_command"], 1300, 1200))
    N.append(code_node("merge_fold", "Record merge", MERGE_FOLD_CODE, 1660, 1420,
                       [pin("merge_raw", "merge_raw", "object"),
                        pin("loop_state", "loop_state", "object")]))
    N.append(set_var("set_state_merge", "Record merge state", STATE_VAR, 1660, 1200))

    N.append(get_var("get_state_final", STATE_VAR, {}, 2020, 1420))
    N.append(code_node("final_report", "Final report", FINAL_REPORT_CODE, 2020, 1640,
                       [pin("loop_state", "loop_state", "object")]))
    N.append(node("end", "on_flow_end", "Result", 2380, 1200,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string")]))

    # ---------------- edges ----------------
    def ex(a, b, *, src="exec-out", dst="exec-in"):
        E.append(edge(a, src, b, dst))

    def data(a, ah, b, bh):
        E.append(edge(a, ah, b, bh))

    # start -> seed state -> preflight branch
    ex("start", "set_state0")
    data("preflight", "state", "set_state0", "value")
    data("start", "request", "preflight", "request")
    data("start", "workspace_root", "preflight", "workspace_root")
    data("start", "gating_mode", "preflight", "gating_mode")
    data("start", "skills", "preflight", "skills")
    data("get_skills_res", "value", "preflight", "skills_resolution")
    data("start", "max_review_rounds", "preflight", "max_review_rounds")
    data("start", "browser_probe_available", "preflight", "browser_probe_available")
    ex("set_state0", "if_preflight")
    data("preflight", "preflight_ok", "if_preflight", "condition")
    ex("if_preflight", "end_pre", src="false")
    data("preflight", "failures", "pre_report", "failures")
    data("pre_report", "report", "end_pre", "report")
    data("preflight", "preflight_ok", "end_pre", "success")
    data("pre_report", "reason", "end_pre", "stopped_reason")

    # L1 plan loop
    ex("if_preflight", "plan_while", src="true")
    data("get_state_p", "value", "plan_cond", "loop_state")
    data("start", "max_plan_revisions", "plan_cond", "max_plan_revisions")
    data("plan_cond", "condition", "plan_while", "condition")

    # scouts run behind an if: first pass + explicit "research" only (cached
    # scout context feeds plain plan revisions without re-paying two subruns)
    ex("plan_while", "if_scout", src="loop")
    data("plan_cond", "need_scout", "if_scout", "condition")
    ex("if_scout", "scout_code", src="true")
    ex("if_scout", "planner", src="false")
    data("start", "request", "scout_code_prompt", "request")
    data("get_state_p", "value", "scout_code_prompt", "loop_state")
    data("scout_code_prompt", "prompt", "scout_code", "prompt")
    data("start", "provider", "scout_code", "provider")
    data("start", "model", "scout_code", "model")
    ex("scout_code", "scout_web")
    data("start", "request", "scout_web_prompt", "request")
    data("get_state_p", "value", "scout_web_prompt", "loop_state")
    data("scout_web_prompt", "prompt", "scout_web", "prompt")
    data("start", "provider", "scout_web", "provider")
    data("start", "model", "scout_web", "model")
    ex("scout_web", "set_state_scout")
    data("scout_code", "response", "scout_merge", "code_findings")
    data("scout_web", "response", "scout_merge", "web_findings")
    data("get_state_p", "value", "scout_merge", "loop_state")
    data("scout_merge", "state", "set_state_scout", "value")
    ex("set_state_scout", "planner")
    data("start", "request", "planner_prompt", "request")
    data("get_state_p", "value", "planner_prompt", "loop_state")
    data("planner_prompt", "prompt", "planner", "prompt")
    data("planner_prompt", "schema", "planner", "resp_schema")
    data("start", "provider", "planner", "provider")
    data("start", "model", "planner", "model")
    ex("planner", "if_g1")
    data("plan_cond", "wait_mode", "if_g1", "condition")
    # wait mode: human gate
    ex("if_g1", "gate1", src="true")
    data("planner", "data", "gate1_prompt", "planner_data")
    data("gate1_prompt", "prompt", "gate1", "prompt")
    data("gate1_prompt", "choices", "gate1", "choices")
    ex("gate1", "set_state_plan")
    data("gate1", "response", "gate1_parse", "response")
    data("get_state_p", "value", "gate1_parse", "loop_state")
    data("planner", "data", "gate1_parse", "planner_data")
    data("gate1_parse", "state", "set_state_plan", "value")
    # auto mode: deterministic accept
    ex("if_g1", "set_state_plan_auto", src="false")
    data("get_state_p", "value", "gate1_auto", "loop_state")
    data("planner", "data", "gate1_auto", "planner_data")
    data("gate1_auto", "state", "set_state_plan_auto", "value")

    # plan done -> accepted?
    ex("plan_while", "if_accepted", src="done")
    data("get_state_p", "value", "plan_done_check", "loop_state")
    data("plan_done_check", "accepted", "if_accepted", "condition")
    ex("if_accepted", "end", src="false")
    # backlog + git
    ex("if_accepted", "backlog_write", src="true")
    data("get_state_p", "value", "backlog_fields", "loop_state")
    data("backlog_fields", "file_path", "backlog_write", "file_path")
    data("backlog_fields", "content", "backlog_write", "content")
    ex("backlog_write", "git_call")
    data("backlog_fields", "slug", "git_args", "branch_slug")
    data("start", "workspace_root", "git_args", "workspace_root")
    data("git_args", "output", "git_call", "tool_call")
    ex("git_call", "set_state_git")
    data("git_call", "raw", "git_fold", "git_raw")
    data("backlog_fields", "slug", "git_fold", "slug")
    data("get_state_p", "value", "git_fold", "loop_state")
    data("git_fold", "state", "set_state_git", "value")

    # L2 build loop
    ex("set_state_git", "build_while")
    data("get_state_b", "value", "build_cond", "loop_state")
    data("start", "max_fix_cycles", "build_cond", "max_fix_cycles")
    data("start", "max_review_rounds", "build_cond", "max_review_rounds")
    data("build_cond", "condition", "build_while", "condition")

    ex("build_while", "builder", src="loop")
    data("start", "request", "builder_prompt", "request")
    data("get_state_b", "value", "builder_prompt", "loop_state")
    data("builder_prompt", "prompt", "builder", "prompt")
    data("start", "provider", "builder", "provider")
    data("start", "model", "builder", "model")
    ex("builder", "lint_call")
    data("start", "workspace_root", "lint_args", "workspace_root")
    data("lint_args", "output", "lint_call", "tool_call")
    ex("lint_call", "selfcheck_call")
    data("lint_call", "raw", "lint_parse", "lint_raw")
    data("start", "workspace_root", "selfcheck_args", "workspace_root")
    data("selfcheck_args", "output", "selfcheck_call", "tool_call")
    ex("selfcheck_call", "commit_call")
    data("start", "workspace_root", "commit_args", "workspace_root")
    data("commit_args", "output", "commit_call", "tool_call")
    ex("commit_call", "verify")
    data("get_state_b", "value", "verify_input", "loop_state")
    data("start", "request", "verify_input", "request")
    data("start", "workspace_root", "verify_input", "workspace_root")
    data("start", "build_command", "verify_input", "build_command")
    data("start", "run_command", "verify_input", "run_command")
    data("start", "provider", "verify_input", "provider")
    data("start", "model", "verify_input", "model")
    data("verify_input", "input", "verify", "input")
    ex("verify", "set_state_build")
    data("verify", "output", "get_verdict", "object")
    data("get_verdict", "value", "next_state", "verify_verdict")
    # child_output is RUNTIME-PROVIDED on subflow nodes: None on a healthy
    # child (the mapped `output` carries the verdict), {success:false, error}
    # when the child run DIES - the verifier-death detector (coding-agent R1)
    data("verify", "child_output", "next_state", "verify_meta")
    data("builder", "response", "next_state", "builder_response")
    data("lint_parse", "residuals", "next_state", "lint_out")
    data("get_state_b", "value", "next_state", "loop_state")
    data("next_state", "state", "set_state_build", "value")

    # tail-in-loop: green -> doc -> docguard -> PR -> gate2 / stuck+wait ->
    # gate2 escalation / red -> iteration ends
    ex("set_state_build", "if_green")
    data("tail_check", "green", "if_green", "condition")
    data("get_state_tail", "value", "tail_check", "loop_state")
    data("start", "max_fix_cycles", "tail_check", "max_fix_cycles")
    ex("if_green", "if_escalate", src="false")
    data("tail_check", "escalate", "if_escalate", "condition")
    ex("if_escalate", "gate2", src="true")
    ex("if_escalate", "set_state_noop", src="false")
    data("get_state_tail", "value", "set_state_noop", "value")
    ex("if_green", "doc", src="true")
    data("start", "request", "doc_prompt", "request")
    data("get_state_tail", "value", "doc_prompt", "loop_state")
    data("doc_prompt", "prompt", "doc", "prompt")
    data("start", "provider", "doc", "provider")
    data("start", "model", "doc", "model")
    # deterministic post-doc hash guard: doc must not have touched verified
    # source; drift -> red iteration, no PR/gate this cycle
    ex("doc", "docguard_call")
    data("start", "workspace_root", "docguard_args", "workspace_root")
    data("docguard_args", "output", "docguard_call", "tool_call")
    ex("docguard_call", "if_docok")
    data("docguard_call", "raw", "docguard_fold", "guard_raw")
    data("get_state_tail", "value", "docguard_fold", "loop_state")
    data("docguard_fold", "ok", "if_docok", "condition")
    ex("if_docok", "set_state_docred", src="false")
    data("docguard_fold", "state", "set_state_docred", "value")
    ex("if_docok", "pr_write", src="true")
    data("get_state_tail", "value", "pr_fields", "loop_state")
    data("start", "workspace_root", "pr_fields", "workspace_root")
    data("pr_fields", "pr_path", "pr_write", "file_path")
    data("pr_fields", "pr_body", "pr_write", "content")
    ex("pr_write", "pr_call")
    data("pr_fields", "gh_call", "pr_call", "tool_call")
    ex("pr_call", "if_g2")
    data("tail_check", "wait_mode", "if_g2", "condition")
    ex("if_g2", "gate2", src="true")
    data("gate2_prompt", "prompt", "gate2", "prompt")
    data("gate2_prompt", "choices", "gate2", "choices")
    data("get_state_tail", "value", "gate2_prompt", "loop_state")
    ex("gate2", "set_state_g2")
    data("gate2", "response", "gate2_parse", "response")
    data("get_state_tail", "value", "gate2_parse", "loop_state")
    data("gate2_parse", "state", "set_state_g2", "value")
    ex("if_g2", "set_state_g2auto", src="false")
    data("get_state_tail", "value", "set_state_g2auto", "value")

    # post-loop: merge decision
    ex("build_while", "if_approved", src="done")
    data("get_state_done", "value", "done_check", "loop_state")
    data("done_check", "approved", "if_approved", "condition")
    ex("if_approved", "merge_call", src="true")
    data("get_state_done", "value", "merge_args", "loop_state")
    data("start", "workspace_root", "merge_args", "workspace_root")
    data("merge_args", "output", "merge_call", "tool_call")
    ex("merge_call", "set_state_merge")
    data("merge_call", "raw", "merge_fold", "merge_raw")
    data("get_state_done", "value", "merge_fold", "loop_state")
    data("merge_fold", "state", "set_state_merge", "value")
    ex("set_state_merge", "end")
    ex("if_approved", "end", src="false")
    data("get_state_final", "value", "final_report", "loop_state")
    data("final_report", "report", "end", "report")
    data("final_report", "success", "end", "success")
    data("final_report", "branch", "end", "branch")
    data("final_report", "stopped_reason", "end", "stopped_reason")

    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def build_verify_copy() -> dict:
    """Drift-pinned copy of coding-verify-gates as multiagent-verify-gates."""
    src = json.loads((FLOWS_DIR / "coding-verify-gates.json").read_text())
    src["id"] = VERIFY_FLOW_ID
    src["name"] = "Multi-agent verify gates (pinned copy of coding-verify-gates)"
    write_json(FLOWS_DIR / f"{VERIFY_FLOW_ID}.json", src)
    return src


# The agent.v1 code node that maps a chat {prompt} into the coding.v1 root's
# input object. workspace_root and gating_mode are DECLARED wrapper start pins
# (agent.v1 validation requires {prompt, provider, model, tools} only as a
# SUBSET): on_flow_start resolves declared pins input-first from run vars, so
# workspace_root picks up abstractcode's session-workspace var sync (or
# input_data.workspace_root on the gateway) and multiagent-coding's preflight
# - which REQUIRES a workspace - is satisfied when the client provides one,
# and refuses honestly when it does not.
WRAPPER_MAP_CODE = (
    "p = str(prompt or \"\").strip()\n"
    "ws = str(workspace_root or \"\").strip()\n"
    "g = str(gating_mode or \"" + WRAPPER_GATING + "\").strip().lower()\n"
    "if g not in (\"wait\", \"auto\"):\n"
    "    g = \"" + WRAPPER_GATING + "\"\n"
    "built = {\n"
    "    \"request\": p,\n"
    "    \"workspace_root\": ws,\n"
    "    \"provider\": provider,\n"
    "    \"model\": model,\n"
    "    \"gating_mode\": g,\n"
    "    \"browser_probe_available\": False,\n"
    "}\n"
    "return {\"built\": built}"
)


def build_wrapper() -> dict:
    """agent.v1 wrapper (mirrors `coder`): {prompt} -> multiagent-coding root
    -> {response, success, meta}. This is the entrypoint that appears in the
    app agent-workflow picker; the strict coding.v1 root does not (by design)."""
    f = base_flow(WRAPPER_FLOW_ID, "Multi-agent coder",
                  "Chat-agent entrypoint for the multi-agent coding pipeline (scouts -> "
                  "plan -> gates -> build/verify loop -> docs -> PR -> merge). Defaults "
                  "to gating_mode=wait: interactive clients answer TWO ask_user gates "
                  "(plan approval, merge approval). Unattended clients must send "
                  "gating_mode=auto and input_data._runtime.tool_policy = "
                  "{\"auto_approve_tools\": [\"execute_command\"]} (or drive approvals "
                  "externally). workspace_root resolves from the session workspace var "
                  "or input_data; an empty workspace is refused at preflight (this "
                  "workflow writes files and runs git).",
                  interfaces=[AGENT_INTERFACE])
    N, E = f["nodes"], f["edges"]
    N.append(node("start", "on_flow_start", "Prompt", -900, 0,
                  outputs=[EXEC_OUT, pin("prompt", "prompt", "string"),
                           pin("provider", "provider", "provider_text"),
                           pin("model", "model", "model"),
                           pin("tools", "tools", "array"),
                           # extra pins (legal: agent.v1 validates a SUBSET) -
                           # input-first resolution picks these up from run
                           # vars/input_data; defaults keep the contract honest
                           pin("workspace_root", "workspace_root", "string"),
                           pin("gating_mode", "gating_mode", "string")],
                  pin_defaults={"prompt": "", "workspace_root": "",
                                "gating_mode": WRAPPER_GATING}))
    N.append(code_node("map_input", "Map prompt -> request", WRAPPER_MAP_CODE, -560, 0,
                       [pin("prompt", "prompt", "string"),
                        pin("workspace_root", "workspace_root", "string"),
                        pin("gating_mode", "gating_mode", "string"),
                        pin("provider", "provider", "provider_text"),
                        pin("model", "model", "model")]))
    N.append(subflow_node("build", "Run multi-agent coding", ROOT_FLOW_ID, -220, 0))
    N.append(get_node("get_report", "report", "", 140, -160))
    N.append(get_node("get_success", "success", False, 140, 40))
    N.append(get_node("get_branch", "branch", "", 140, 240))
    N.append(get_node("get_reason", "stopped_reason", "", 500, 240))
    N.append(node("meta_obj", "make_object", "Build meta", 500, 40,
                  inputs=[pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string")],
                  outputs=[pin("result", "result", "object")]))
    N.append(node("end", "on_flow_end", "Answer", 860, 0,
                  inputs=[EXEC_IN, pin("response", "response", "string"),
                          pin("success", "success", "boolean"),
                          pin("meta", "meta", "object")]))

    E.append(edge("start", "exec-out", "build", "exec-in"))
    E.append(edge("build", "exec-out", "end", "exec-in"))
    E.append(edge("start", "prompt", "map_input", "prompt"))
    E.append(edge("start", "workspace_root", "map_input", "workspace_root"))
    E.append(edge("start", "gating_mode", "map_input", "gating_mode"))
    E.append(edge("start", "provider", "map_input", "provider"))
    E.append(edge("start", "model", "map_input", "model"))
    E.append(edge("map_input", "built", "build", "input"))
    for g in ("get_report", "get_success", "get_branch", "get_reason"):
        E.append(edge("build", "output", g, "object"))
    E.append(edge("get_branch", "value", "meta_obj", "branch"))
    E.append(edge("get_reason", "value", "meta_obj", "stopped_reason"))
    E.append(edge("get_report", "value", "end", "response"))
    E.append(edge("get_success", "value", "end", "success"))
    E.append(edge("meta_obj", "result", "end", "meta"))

    write_json(FLOWS_DIR / f"{WRAPPER_FLOW_ID}.json", f)
    return f


def main() -> int:
    verify = build_verify_copy()
    root = build_root()
    wrapper = build_wrapper()
    ok = True
    for fid, flow in ((ROOT_FLOW_ID, root), (VERIFY_FLOW_ID, verify), (WRAPPER_FLOW_ID, wrapper)):
        problems = validate_edges(flow)
        if problems:
            ok = False
            print(f"EDGE PROBLEMS ({fid}):")
            for p in problems:
                print("  " + p)
    if not ok:
        return 1
    print(f"Wrote {ROOT_FLOW_ID}.json ({len(root['nodes'])} nodes, {len(root['edges'])} edges)"
          f" + {VERIFY_FLOW_ID}.json ({len(verify['nodes'])} nodes)"
          f" + {WRAPPER_FLOW_ID}.json ({len(wrapper['nodes'])} nodes, agent.v1 entrypoint)")
    if "--pack" in sys.argv:
        from wf_common import compile_check, pack_bundle
        # compile the whole tree reachable from BOTH entrypoints
        compile_check(WRAPPER_FLOW_ID, [ROOT_FLOW_ID, VERIFY_FLOW_ID, WRAPPER_FLOW_ID])
        out = pack_bundle(
            # WALK ROOT = the wrapper: the packer collects flows reachable FROM
            # the walk root, and the wrapper references the coding root (which
            # references the verify copy), so starting here collects all three.
            # Starting from the coding root would miss the wrapper (nothing
            # references it) - exactly the coding-agent `root_flow_json=coder`
            # precedent. default_entrypoint stays the strict coding root
            # (entrypoints[0]).
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            # TWO entrypoints (coding-agent precedent): strict coding.v1 root
            # (default) + agent.v1 wrapper (picker-visible). The packer reads
            # each entrypoint flow's own `interfaces`, so the wrapper's
            # agent.v1 is served independently of the root's coding.v1.
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "multiagent-coding",
                "purpose": ("14-step multi-agent coding pipeline: scouts(code+web) -> planner -> "
                            "plan gate -> backlog -> git branch -> [build -> lint -> selfcheck -> "
                            "mounted verify -> doc guard -> PR -> review gate]xN -> deterministic merge. "
                            "Dual-interface: coding.v1 strict root (gated, request/workspace_root in) + "
                            "agent.v1 wrapper 'multiagent-coder' (prompt in, auto gating, picker-visible)."),
                "outputs": ["report", "success", "branch", "stopped_reason"],
                "auto_mode_requirement": ("unattended runs must auto-approve gated tools: send "
                                          "input_data._runtime.tool_policy = {\"auto_approve_tools\": "
                                          "[\"execute_command\"]} or drive approvals externally, "
                                          "else the run parks on the first tool approval"),
            })
        print(f"Packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
