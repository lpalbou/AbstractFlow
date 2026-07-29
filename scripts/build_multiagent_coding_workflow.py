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

THE BOUNDARY (0.0.8, 2026-07-27 — operator ruling): three tiers, one rule each.
- INLINE EXPRESSION for anything a reader takes in at a glance: trivial
  state reads (`vars.state.get("accepted", False)`), simple conditions,
  one-line string builds. Never a function for a plain variable read —
  "we already have get variable"; a name would only hide it.
- LIBRARY FUNCTION only where there is ACTUAL LOGIC TO TEST or FORMATTING
  TO DO: prompt composers, tool-command composers, parsers, state folders,
  loop laws. Named, drawer-visible, testable, single-value returns.
- CODE NODE where a computation has SEVERAL OUTPUTS consumed at different
  points — fan-out is graph structure the canvas must show (`Final report`,
  `Doc drift check`), plus the genuinely multi-wire folds (`Merge scout
  context`, `Parse gate-1`, `Fold verdict`).
- CONSTANTS are pin defaults (planner schema, gate-1 choices, PR.md path),
  not computed values.
- CONFIG FOLDS INTO STATE ONCE: `mw_preflight` seeds run var `state`, so
  every helper takes (state[, value]) and call sites stay short; reads use
  `vars.state` (attribute access; state always exists past the seed node).
- Old-runtime skew: pre-expression runtimes read neither `functions` nor
  `pinExpressions`; expression-only pins fall to their defaults (falsy ->
  bounded refusal at preflight, empty report) — bounded-safe, and the
  bundle declares `metadata.min_runtime` so the gateway's enforcement gate
  refuses loudly instead of degrading at all.

Cycle-3 invariants honored (unchanged by the migration):
- NO backward exec edges: L1 plan loop + L2 build loop (`while` nodes);
  re-entry state = data in ONE fold per loop, stored in run var `state`.
- Volatile freshness: expressions evaluate at input resolution, exactly
  when the old get_var pulls fired — loop conditions re-read state fresh.
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
    fn, get_var, set_var, while_node, subflow_node, write_file_node,
    validate_edges, write_json, FLOWS_DIR,
)

BUNDLE_ID = "multiagent-coding"
# 0.0.10 (2026-07-27): wave-B adversary P2 folds — the browser_probe grant
# and the probe-protocol prompt now FOLLOW browser_probe_available (a
# probe-less gateway no longer instructs the builder to call an unmounted
# tool: the tools pin adds the probe conditionally on state.probe_ok, and
# the prompt teaches the no-tool bounded protocol instead); shq keeps falsy
# non-None text (shq(0) is "0").
# 0.0.9 (2026-07-27): code-tui asks (commons c5871) folded on top of the
# boundary cleanup: (1) a "gating: wait|auto" answer_user line right after
# the preflight door so EVERY client sees the mode at run start; (2) bundle
# metadata gains a structured `gating` marker (pin/values/default) for
# catalog-level discoverability; (3) metadata.purpose corrected — it still
# said "auto gating" for the wrapper while the real default is WAIT;
# (4) browser_probe granted to the builder + the wrapper's hardcoded
# browser_probe_available=False became a DECLARED pin defaulting true, and
# the builder prompt teaches the probe protocol (port OWNERSHIP via nonce
# round-trip, timeouts in SECONDS, nonzero exit on failure).
# 0.0.8 (2026-07-27): the boundary cleanup (operator ruling + 3 adversary
# reviews): trivial reads inlined (no function for a plain variable access),
# multi-output dict bundles dissolved — `Final report` and `Doc drift check`
# restored as code nodes with LABELED output pins (fan-out visible on the
# canvas), prompt composers reshaped to single-value returns, constants
# demoted to pin defaults (planner schema, gate-1 choices, PR.md). 31
# functions -> 28, every one real logic or formatting.
# 0.0.7 (2026-07-27): live build-cycle progress line ("build cycle N of M").
# 0.0.6 (2026-07-27): fix budget 3 -> 6; cumulative repair history; stall
# stop 2 -> 3 with named stop reason at the review gate.
# 0.0.5 (2026-07-26): function-library migration — 33 pure code nodes -> 3.
# 0.0.11 (2026-07-28): operator layout pass — exec-depth auto-layout on the
# coding root (33 node overlaps -> clean audit); bundle version bump is
# load-bearing for immutable-by-sha catalog re-publish.
BUNDLE_VERSION = "0.0.12"
ROOT_FLOW_ID = "multiagent-coding"
VERIFY_FLOW_ID = "multiagent-verify-gates"
WRAPPER_FLOW_ID = "multiagent-coder"  # agent.v1 wrapper entrypoint (picker-visible)
# Flat run-var name (was nested "mw.state"): every expression call site reads
# `vars.get("state", {})` — short enough to stay readable in chips/tooltips.
STATE_VAR = "state"
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

# The one shared state read every downstream expression uses. Attribute
# access (not vars.get): `state` ALWAYS exists past the seed node, and a
# missing var should fail loudly naming itself, never dissolve into {}.
S = "vars.state"

# Inline dict for the mounted verify subflow input pin (replaces verify_input library fn).
VERIFY_INPUT_EXPR = (
    "{'request': str((" + S + " or {}).get('request') or ''), "
    "'workspace_root': str((" + S + " or {}).get('workspace_root') or ''), "
    "'build_command': str((" + S + " or {}).get('build_command') or ''), "
    "'run_command': str((" + S + " or {}).get('run_command') or ''), "
    "'round_index': int((" + S + " or {}).get('fix_cycles') or 0), "
    "'provider': (" + S + " or {}).get('provider'), "
    "'model': (" + S + " or {}).get('model')}"
)


# --- pin-expression forms (tier 1 migration, 2026-07-25) --------------------
# Faithful single-expression equivalents of the two accessor node classes the
# tier-1 migration collapsed. Kept as ONE helper each so every converted pin
# carries the same audited form (semantics notes below), never an ad-hoc
# variant. Still used by the wrapper + the verify copy.


def field_expr(key: str, default_literal: str) -> str:
    """`get` node equivalent for a WIRED object: field or default.

    `(value or {})` covers the None/falsy object (dead subflow child delivers
    None) exactly like data_get's _get_path(None) -> default. Divergence vs
    the get node, both unreachable for these producers: a non-dict TRUTHY
    object raises loudly (get returned default), and an explicit-None field
    yields None (get returned default) - every converted consumer either
    isinstance-guards its input or the producer can never emit None fields.
    """
    return '(value or {}).get("' + key + '", ' + default_literal + ')'


def var_expr(name: str, default_literal: str = "{}") -> str:
    """`get_var` node equivalent: dotted-path read with missing-at-any-level
    -> default (matches _get_by_path_with_found: a found-but-None LEAF stays
    None; a None/missing INTERMEDIATE falls to the default).

    vars.get("_runtime") is a method CALL, so leading-underscore names are
    fine here (the sandbox only blocks underscore ATTRIBUTE access like
    vars._runtime)."""
    parts = [p for p in name.split(".") if p]
    if len(parts) == 1:
        return 'vars.get("' + parts[0] + '", ' + default_literal + ')'
    expr = 'vars.get("' + parts[0] + '")'
    for p in parts[1:-1]:
        expr = '(' + expr + ' or {}).get("' + p + '")'
    return '(' + expr + ' or {}).get("' + parts[-1] + '", ' + default_literal + ')'


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
# THE FLOW FUNCTION LIBRARY (tier 2). Same RestrictedPython sandbox as code
# nodes: no imports, no chr(); string concatenation only. Functions can call
# each other (one shared namespace): text_of is the shared tool-envelope
# extractor (was FOUR inlined copies of _EXTRACT); compose_git_branch,
# record_branch and backlog_body reuse branch_slug.
# EVERY function returns ONE value (a prompt, a command object, a parsed
# list, a folded state dict, a boolean law) — a plain variable read is never
# a function (inline expressions do that), and anything with several outputs
# is a code NODE with labeled pins (operator ruling 2026-07-27).
# ===========================================================================

FUNCTIONS = [
    fn("text_of", r"""
        def text_of(raw):
            # Recursive tool-envelope text extractor (ported from coding-agent
            # GATE5, live-hardened): the direct lane delivers the bare output
            # dict, older shapes are plain strings, durable compaction leaves
            # only *_preview, and the approval-resume lane nests
            # {mode, results:[...]} - a single-shape reader misses conflicts
            # and branch labels (cycle-3 adversary F3, proven live).
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
    """, kind="parser", description="Text from any tool-result envelope shape (recursive fold)."),

    fn("shq", r"""
        def shq(s):
            # Escape a value for embedding inside single quotes in a shell
            # command ('...' + shq(x) + '...'). ONE copy: the same escape was
            # inlined nine times across the command composers, and one
            # divergent copy is a command injection on a path with a quote.
            # None -> "" but falsy NON-None values keep their text (shq(0) is
            # "0" - `s or ""` would erase it; wave-B adversary P2-3).
            return ("" if s is None else str(s)).replace("'", "'" + "\\" + "''")
    """, kind="formatter", description="Shell single-quote escape for command composers (one copy, nine call sites)."),

    fn("mw_preflight", r"""
        def mw_preflight(v):
            # Seeds the ONE loop-state object from the run vars view (the
            # whole `vars` rides in as v). CONFIG FOLDS IN HERE (request,
            # workspace, budgets, commands, provider/model), so every later
            # function reads (state), call sites stay short, and every input
            # default lives in exactly ONE place - this function.
            req = str(v.get("request") or "").strip()
            ws = str(v.get("workspace_root") or "").strip()
            gating = str(v.get("gating_mode") or "wait").strip().lower()
            if gating not in ("wait", "auto"):
                gating = "wait"
            # skills_resolution is what the GATEWAY wrote after resolving
            # input_data.skills - never a caller-attested pin (adversary F2).
            sk = (v.get("_runtime") or {}).get("skills_resolution")
            sk = sk if isinstance(sk, dict) else {}
            active = sk.get("active") if isinstance(sk.get("active"), list) else []
            active = [str(x) for x in active]
            need = v.get("skills", ["coredoc"])
            need = [str(x) for x in need] if isinstance(need, list) else []
            missing = []
            for s in need:
                if s not in active:
                    missing.append(s)
            skills_degraded = len(missing) > 0
            probe_ok = bool(v.get("browser_probe_available", False))
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
            return {
                # -- config (immutable after seed) --
                "request": req, "workspace_root": ws, "gating_mode": gating,
                # wait_gating: the one derived gating fact both wait-mode `if`
                # pins read (normalization lives here, never re-derived).
                "wait_gating": gating == "wait",
                "max_plan_revisions": int(v.get("max_plan_revisions", 3) or 3),
                # Default fix budget is 6 (operator request 2026-07-27): give the
                # build loop room to converge by default; still overridable via
                # the max_fix_cycles run-start pin.
                "max_fix_cycles": int(v.get("max_fix_cycles", 6) or 6),
                "max_review_rounds": int(v.get("max_review_rounds", 2) or 2),
                "build_command": str(v.get("build_command") or ""),
                "run_command": str(v.get("run_command") or ""),
                "provider": v.get("provider"), "model": v.get("model"),
                # -- preflight verdict (the door reads these once) --
                "preflight_ok": ok, "preflight_failures": failures,
                # -- loop state --
                "accepted": False, "approved": False, "merged": False,
                "user_stopped": False, "last_gate2": "",
                "plan_revisions": 0, "fix_cycles": 0, "review_rounds": 0,
                "same_signature_count": 0, "failure_signature": "",
                "plan_feedback": "", "build_feedback": "", "rescout": False,
                # repair_history: one entry per failed build cycle, in order,
                # so the builder can see what it already tried and not repeat a
                # failed approach. Each entry: {cycle, changed, failed}.
                "repair_history": [],
                "skills_degraded": skills_degraded, "probe_ok": probe_ok,
                "warnings": warnings, "scout_context": "",
                "plan": {}, "title": "", "branch": "", "branch_slug": "",
                "all_passed": False,
            }
    """, kind="composer", description="Seed state from the run vars view: config + preflight posture in one object."),

    fn("pre_report", r"""
        def pre_report(state):
            s = state if isinstance(state, dict) else {}
            fails = s.get("preflight_failures") if isinstance(s.get("preflight_failures"), list) else []
            lines = ["# Multi-agent coding workflow: preflight failed", ""]
            for f in fails:
                lines.append("- " + str(f))
            return "\n".join(lines)
    """, kind="composer", description="Refusal report for a failed preflight."),

    fn("scout_code_prompt", r"""
        def scout_code_prompt(state):
            s = state if isinstance(state, dict) else {}
            req = str(s.get("request") or "").strip()
            fb = str(s.get("plan_feedback") or "").strip()
            extra = ("\n\nThe previous plan was sent back. Reviewer comments to address:\n" + fb) if fb else ""
            return ("You are the CODE+DOCS scout. Request:\n" + req +
                    "\n\nMine ONLY the existing workspace: list folders, read/skim code and docs, search for prior art. "
                    "Do NOT use the internet. Do NOT write anything. Return a compact findings list - for each: "
                    "source path, the concrete fact, and why it matters for this request. If the workspace is empty, say so plainly." + extra)
    """, kind="composer", description="Prompt for the workspace scout."),

    fn("scout_web_prompt", r"""
        def scout_web_prompt(state):
            s = state if isinstance(state, dict) else {}
            req = str(s.get("request") or "").strip()
            fb = str(s.get("plan_feedback") or "").strip()
            extra = ("\n\nThe previous plan was sent back. Reviewer comments to address:\n" + fb) if fb else ""
            return ("You are the INTERNET scout. Request:\n" + req +
                    "\n\nMine ONLY the internet (web_search, fetch_url, skim). Do NOT read or write the workspace. "
                    "Return a compact findings list - for each: source URL, the concrete claim, and why it matters. "
                    "Prefer primary/reference sources over blogspam." + extra)
    """, kind="composer", description="Prompt for the internet scout."),

    fn("planner_prompt", r"""
        def planner_prompt(state):
            s = state if isinstance(state, dict) else {}
            req = str(s.get("request") or "").strip()
            ctx = str(s.get("scout_context") or "").strip()
            fb = str(s.get("plan_feedback") or "").strip()
            extra = ("\n\nThe reviewer sent the previous plan back with these comments; address every one:\n" + fb) if fb else ""
            return ("You are the PLANNER. Do not write code; produce the plan only.\n\nRequest:\n" + req +
                    "\n\nEngineered context from the two scouts (code + internet):\n" + ctx +
                    "\n\nReturn JSON with: title (AT MOST 3 words, branch-name friendly), goal (one paragraph), "
                    "steps (ordered, concrete), files (paths you expect to create or change), risks (list)." + extra)
    """, kind="composer", description="Planner prompt (the response schema is a pin default on the planner node)."),

    fn("gate1_prompt", r"""
        def gate1_prompt(planner_data):
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
            return "\n".join(lines)
    """, kind="composer", description="Human plan-approval prompt from the planner's JSON (choices are a pin default)."),

    fn("auto_accept_plan", r"""
        def auto_accept_plan(state, planner_data):
            # Auto mode must not accept a DEAD plan: agent death does not fail
            # the parent, so planner death would flow {} into an unconditional
            # accept -> backlog slug "task", empty builder plan (adversary
            # finding). Missing title/steps re-plans within the same budget.
            s = state if isinstance(state, dict) else {}
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
            return s2
    """, kind="shaper", description="Auto-mode plan acceptance (rejects dead/empty plans)."),

    fn("branch_slug", r"""
        def branch_slug(state):
            # Branch-name-friendly slug from the accepted plan's title. The one
            # helper in this flow promoted for GENUINE reuse: compose_git_branch,
            # record_branch and the backlog-path expression all call it.
            s = state if isinstance(state, dict) else {}
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
            return slug
    """, kind="composer", description="Branch/backlog slug from the plan title (a-z 0-9 dashes, 40 max)."),

    fn("backlog_body", r"""
        def backlog_body(state):
            s = state if isinstance(state, dict) else {}
            pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
            goal = str(pd.get("goal") or "").strip()
            steps = pd.get("steps") if isinstance(pd.get("steps"), list) else []
            files = pd.get("files") if isinstance(pd.get("files"), list) else []
            risks = pd.get("risks") if isinstance(pd.get("risks"), list) else []
            def bullets(xs):
                out = ""
                for x in xs:
                    out = out + "- " + str(x) + "\n"
                return out if out else "- (none)\n"
            return ("# " + branch_slug(s) + "\n\n- Status: planned\n- Source: multi-agent coding workflow\n\n## Goal\n" +
                    (goal if goal else "(none)") + "\n\n## Steps\n" + bullets(steps) +
                    "\n## Files\n" + bullets(files) + "\n## Risks\n" + bullets(risks))
    """, kind="composer", description="Backlog item markdown body from the accepted plan."),

    fn("compose_git_branch", r"""
        def compose_git_branch(state):
            s = state if isinstance(state, dict) else {}
            slug = branch_slug(s)
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            parent = ws.rstrip("/").rsplit("/", 1)[0] if "/" in ws.rstrip("/") else "/"
            parent_q = shq(parent)
            # Branch FIRST, baseline-commit SECOND: the baseline (which sweeps
            # any uncommitted user work via add -A) lands on the WORK branch,
            # never on the user's current branch (adversary F7). A brand-new
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
    """, kind="composer", description="Tool call: init/branch/baseline-commit on the work branch."),

    fn("record_branch", r"""
        def record_branch(state, git_raw):
            s = state if isinstance(state, dict) else {}
            s2 = dict(s)
            txt = text_of(git_raw).strip()
            branch = txt.split("\n")[-1].strip() if txt else ""
            slug = branch_slug(s)
            s2["branch"] = branch if branch else (slug or "work")
            s2["branch_slug"] = slug or str(s.get("branch_slug") or "")
            return s2
    """, kind="shaper", description="Fold the git-branch result into state (branch + slug)."),

    fn("build_again", r"""
        def build_again(state):
            s = state if isinstance(state, dict) else {}
            approved = bool(s.get("approved"))
            stopped = bool(s.get("user_stopped"))
            env_blocked = bool(s.get("environment_blocked"))
            fix = int(s.get("fix_cycles", 0) or 0)
            rev = int(s.get("review_rounds", 0) or 0)
            maxfix = int(s.get("max_fix_cycles", 6) or 6)
            maxrev = int(s.get("max_review_rounds", 2) or 2)
            # Stop on repeated identical failures only after 3 in a row (was 2,
            # operator request 2026-07-27): with the repair history the builder
            # sees its past attempts and rarely repeats one, so this stall
            # guard should fire later, not sooner.
            stalled = int(s.get("same_signature_count", 0) or 0) >= 3
            # In wait mode, running out of fix cycles or stalling does not exit
            # the loop directly: the loop body sends those cases to gate 2 as an
            # escalation the human can act on (a comment resets the fix budget;
            # "stop" ends the run). Auto mode exits on the budgets. An
            # environment block (for example a missing command runner) exits
            # right away in both modes, because no builder edit can fix it.
            return ((not approved) and (not stopped) and (not env_blocked)
                    and (not stalled) and (fix < maxfix) and (rev <= maxrev))
    """, kind="checker", description="Build-loop law: continue while unapproved and within budgets."),

    fn("builder_prompt", r"""
        def builder_prompt(state):
            s = state if isinstance(state, dict) else {}
            req = str(s.get("request") or "").strip()
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
            # Build the repair history: every past failed cycle, in order, so
            # the builder can see what it already tried and not repeat a failed
            # approach. Show the last 8 to keep the prompt bounded; if there
            # were more, say how many earlier ones are omitted.
            hist = s.get("repair_history") if isinstance(s.get("repair_history"), list) else []
            trail = ""
            if hist:
                shown = hist[-8:]
                omitted = len(hist) - len(shown)
                trail = "\n\nRepair history so far (do not repeat an approach that already failed):\n"
                if omitted > 0:
                    trail = trail + "(" + str(omitted) + " earlier cycle(s) omitted)\n"
                for h in shown:
                    hc = h if isinstance(h, dict) else {}
                    trail = (trail + "- cycle " + str(hc.get("cycle")) + ": tried: "
                             + str(hc.get("changed") or "(no summary)")[:220]
                             + " | still failed: " + str(hc.get("failed") or "(unknown)")[:180] + "\n")
            # Probe protocol (code-tui c5871, the 8-hour-hang lesson): the
            # bounded browser_probe tool over hand-rolled server+headless
            # scripts; port OWNERSHIP proven by a nonce round-trip (the
            # incident's port WAS bound - by another process); explicit
            # timeouts in SECONDS; failed checks exit nonzero. The tool is
            # named ONLY when the host mounts it (probe_ok) - telling the
            # builder to call an unmounted tool is a trap (wave-B P2-2).
            if bool(s.get("probe_ok")):
                probe_rules = (
                    "Probe protocol: use the browser_probe tool to check web artifacts (bounded, ~90s) - never hand-roll "
                    "'start a server then drive a headless browser' scripts. If you serve something on a port, prove the port "
                    "is YOURS before testing against it: put a nonce in the page and fetch it back (a plain bind or 200 check "
                    "is NOT enough - the port may be owned by another process). Bound EVERY long-running command with an "
                    "explicit timeout in SECONDS, and make every check exit nonzero on failure.")
            else:
                probe_rules = (
                    "Probe protocol: browser_probe is NOT available on this host - keep artifact checks static and bounded. "
                    "If you must check a served artifact, prove the port is YOURS first: put a nonce in the page and fetch it "
                    "back (a plain bind or 200 check is NOT enough - the port may be owned by another process), bound EVERY "
                    "long-running command with an explicit timeout in SECONDS, make every check exit nonzero on failure, and "
                    "never leave a server running in the background.")
            if fix == 0 and not bf:
                return ("You are the BUILDER. You are on a dedicated git branch; implement this plan fully.\n\nRequest:\n" + req +
                        "\n\nPlan:\n" + plan_txt +
                        "\n\nEngineering rules: bound every loop and traversal; before writing logic over data, read a sample and verify its shape; "
                        "prefer small verifiable functions; start EVERY source file with a 1-2 line header comment stating its purpose; "
                        "self-probe your artifact before finishing (open it, run it, or trace the entry path). " + probe_rules + " "
                        "When done, write SELFCHECK.md: list each artifact with one line of evidence it works, and AFTER YOUR FINAL EDIT add one "
                        "'ARTIFACT-SHA256: <path> <sha>' line per artifact (compute with: shasum -a 256 <path>).")
            return ("You are the BUILDER in REPAIR mode on the existing branch. Fix ONLY what the failures below name. "
                    "Read before editing; make the smallest change that fixes the named defect; do NOT rewrite whole files with write_file; re-probe after fixing. "
                    + probe_rules + "\n\n"
                    "Failures to fix:\n" + (bf if bf else "(none recorded - re-verify your artifacts)") +
                    trail +
                    "\n\nAfter your FINAL edit, refresh SELFCHECK.md evidence and its ARTIFACT-SHA256 lines.")
    """, kind="composer", description="Builder prompt: full build first cycle, targeted repair after (with repair history)."),

    fn("compose_lint", r"""
        def compose_lint(state):
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            cmd = ("cd '" + ws_q + "' && "
                   "(command -v ruff >/dev/null 2>&1 && ruff check --fix . 2>&1 | tail -5 || true); "
                   "(command -v prettier >/dev/null 2>&1 && prettier --write . 2>&1 | tail -5 || true); "
                   "echo LINT_DONE")
            return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "lint-format"}
    """, kind="composer", description="Tool call: ruff --fix + prettier --write."),

    fn("parse_lint_residuals", r"""
        def parse_lint_residuals(lint_raw):
            # Residuals = DIAGNOSTIC-SHAPED lines only (path:line:col or a
            # syntax-error class token). Substring-'error' matching is a proven
            # false-red generator (adversary F1/F2, integration F5).
            text = text_of(lint_raw)
            def has_line_col(t):
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
                if "fixed" in low and "remaining" in low:
                    return False
                if "all checks passed" in low or "0 error" in low or "no error" in low:
                    return False
                if "syntaxerror" in low or "parse error" in low or "failed to parse" in low:
                    return True
                if low.startswith("[error]"):
                    return True
                if has_line_col(t):
                    return True
                return False
            residuals = []
            for ln in text.split("\n"):
                t = ln.strip()
                if t and is_diag(t):
                    residuals.append(t[:200])
            return residuals[:20]
    """, kind="parser", description="Real lint diagnostics only (path:line:col / syntax-error class)."),

    fn("compose_selfcheck_refresh", r"""
        def compose_selfcheck_refresh(state):
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            # Formatter may have rewritten bytes AFTER the builder hashed them;
            # refresh the ARTIFACT-SHA256 lines deterministically so G5 binds
            # to the shipped bytes (cycle-2 FATAL). Space-safe path handling:
            # iterate whole lines, never word-split (adversary F5).
            cmd = ("cd '" + ws_q + "' && if [ -f SELFCHECK.md ]; then "
                   "grep '^ARTIFACT-SHA256:' SELFCHECK.md > .sc_lines.tmp 2>/dev/null || true; "
                   "grep -v '^ARTIFACT-SHA256:' SELFCHECK.md > SELFCHECK.md.tmp 2>/dev/null || true; "
                   "while IFS= read -r line; do "
                   "rest=${line#ARTIFACT-SHA256: }; f=${rest% *}; "
                   "if [ -f \"$f\" ]; then echo \"ARTIFACT-SHA256: $f $(shasum -a 256 \"$f\" | awk '{print $1}')\" >> SELFCHECK.md.tmp; fi; "
                   "done < .sc_lines.tmp; rm -f .sc_lines.tmp; "
                   "mv SELFCHECK.md.tmp SELFCHECK.md; echo REFRESHED; else echo NO_SELFCHECK; fi")
            return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "selfcheck-refresh"}
    """, kind="composer", description="Tool call: refresh SELFCHECK.md ARTIFACT-SHA256 bindings."),

    fn("compose_commit", r"""
        def compose_commit(state):
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
                   "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'build cycle' >/dev/null 2>&1 || true; echo COMMITTED")
            return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "git-commit"}
    """, kind="composer", description="Tool call: commit the build cycle."),

    fn("tail_escalate", r"""
        def tail_escalate(state):
            # In wait mode, a stuck build (out of fix cycles, or the same
            # failure repeating, still not green) escalates to the human gate
            # instead of ending silently. Auto mode never escalates. An
            # environment block never escalates: no reviewer comment can fix a
            # missing command runner.
            s = state if isinstance(state, dict) else {}
            stuck = (int(s.get("same_signature_count", 0) or 0) >= 3
                     or int(s.get("fix_cycles", 0) or 0) >= int(s.get("max_fix_cycles", 6) or 6))
            return (str(s.get("gating_mode") or "wait") == "wait"
                    and not bool(s.get("all_passed"))
                    and not bool(s.get("environment_blocked"))
                    and stuck)
    """, kind="checker", description="Stuck build in wait mode? Escalate to the human gate instead of ending silently."),

    fn("doc_prompt", r"""
        def doc_prompt(state):
            # The documenter runs AFTER verify, so it must not mutate what was
            # verified (adversary F3, live-confirmed). Headers are the
            # BUILDER's job; the documenter owns README/docs only, and the
            # deterministic doc guard re-checks the bound artifacts after.
            s = state if isinstance(state, dict) else {}
            pd = s.get("plan") if isinstance(s.get("plan"), dict) else {}
            goal = str(pd.get("goal") or s.get("request") or "").strip()
            deg = bool(s.get("skills_degraded"))
            p = ("You are the DOCUMENTER. The build passed its verification gates on this branch.\n"
                 "STRICT RULE: do NOT modify any source/code file - the verified bytes must ship exactly as tested. "
                 "You write DOCUMENTATION FILES ONLY: README.md and files under docs/.\n\nTasks:\n"
                 "1. Write or update README.md: what this delivers, how to run it, controls/usage, structure.\n"
                 "2. Keep docs truthful to the CURRENT code - read the source before describing it; never invent features.\n\n"
                 "What was built:\n" + goal)
            if deg:
                p = p + "\n\n(coredoc skill not active on this host - follow the rules above on your own judgment. #FALLBACK)"
            return p
    """, kind="composer", description="Documenter prompt (docs only; verified source is untouchable)."),

    fn("compose_doc_guard", r"""
        def compose_doc_guard(state):
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            # POSIX-safe: no process substitution (execute_command may run sh,
            # not bash); a temp file keeps the drift flag in the same shell.
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
    """, kind="composer", description="Tool call: post-doc hash guard over SELFCHECK-bound artifacts."),

    fn("pr_body", r"""
        def pr_body(state):
            s = state if isinstance(state, dict) else {}
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
            return "\n".join(lines)
    """, kind="composer", description="PR.md markdown body (the PR.md path is a pin default)."),

    fn("compose_pr_push", r"""
        def compose_pr_push(state):
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            branch = str(s.get("branch") or s.get("branch_slug") or "work")
            branch_q = shq(branch)
            # GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=true: a credentialed https
            # remote must fail fast, never sit on a hidden credential prompt
            # (adversary F6 - unattended runs).
            cmd = ("cd '" + ws_q + "' && export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true; "
                   "if git remote get-url origin >/dev/null 2>&1; then "
                   "if command -v gh >/dev/null 2>&1; then "
                   "git push -u origin '" + branch_q + "' 2>&1 | tail -2; "
                   "GH_PROMPT_DISABLED=1 gh pr create --fill --head '" + branch_q + "' 2>&1 | tail -2 || echo PR_EXISTS_OR_FAILED; "
                   "else echo GH_UNAVAILABLE_LOCAL_PR_MD_ONLY; fi; "
                   "else echo NO_REMOTE_LOCAL_PR_MD_ONLY; fi")
            return {"name": "execute_command", "arguments": {"command": cmd, "timeout": 120}, "call_id": "pr-create"}
    """, kind="composer", description="Tool call: push branch + gh pr create (degrades honestly without remote)."),

    fn("gate2_prompt", r"""
        def gate2_prompt(state):
            # Gate-2 serves TWO cases, composed from state: green = merge
            # approval; red = ESCALATION of a stuck build (G4 second half).
            s = state if isinstance(state, dict) else {}
            branch = str(s.get("branch") or "work")
            green = bool(s.get("all_passed"))
            v = s.get("last_verdict") if isinstance(s.get("last_verdict"), dict) else {}
            fails = v.get("failures") if isinstance(v.get("failures"), list) else []
            warns = s.get("warnings") if isinstance(s.get("warnings"), list) else []
            rev = int(s.get("review_rounds", 0) or 0)
            maxrev = int(s.get("max_review_rounds", 2) or 2)
            fix = int(s.get("fix_cycles", 0) or 0)
            maxfix = int(s.get("max_fix_cycles", 6) or 6)
            stalled = int(s.get("same_signature_count", 0) or 0) >= 3
            lines = []
            if green:
                lines.append("REVIEW GATE: the build is green on branch '" + branch + "' and PR.md summarizes it.")
                lines.append("Test the artifact yourself now (the gates are static checks; runtime behavior is yours to judge).")
            else:
                # Say WHICH stop reason fired: the same failure repeating means
                # more cycles alone will not help (the approach must change);
                # running out of cycles just means it needs more room or a hint.
                if stalled:
                    lines.append("BUILD STUCK on branch '" + branch + "': the SAME failure repeated " + str(int(s.get("same_signature_count", 0) or 0) + 1) + " times in a row. More cycles alone will not help - the approach needs to change.")
                else:
                    lines.append("BUILD STUCK on branch '" + branch + "': used up the fix budget (" + str(fix) + " of " + str(maxfix) + " cycles) without going green.")
                lines.append("Open failures:")
                for f in fails[:12]:
                    lines.append("- " + str(f))
                lines.append("Comment to guide further repairs (this resets the fix budget), or reply 'stop' to end the run unmerged.")
            for w in warns:
                lines.append("- advisory: " + str(w))
            if rev >= maxrev:
                lines.append("")
                lines.append("NOTE: this is the FINAL review round - a rejection ends the run unmerged.")
            lines.append("")
            if green:
                lines.append("Reply 'approve' to merge into main, or anything else as CHANGE REQUESTS sent back to the builder.")
            return "\n".join(lines)
    """, kind="composer", description="Merge-review / escalation prompt from state (choices are an inline conditional)."),

    fn("parse_gate2", r"""
        def parse_gate2(state, response):
            s = state if isinstance(state, dict) else {}
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
                s2["approved"] = False
                s2["user_stopped"] = True
                s2["last_gate2"] = "stopped"
            else:
                # change requests / repair guidance (an 'approve' on a RED
                # build is NOT a merge - merge requires green in both modes)
                s2["approved"] = False
                s2["review_rounds"] = int(s.get("review_rounds", 0) or 0) + 1
                s2["fix_cycles"] = 0
                s2["same_signature_count"] = 0
                s2["failure_signature"] = ""
                s2["all_passed"] = False
                s2["last_gate2"] = "rejected" if green else "escalated"
                s2["build_feedback"] = ("REVIEWER CHANGE REQUESTS (gate 2):\n" +
                                        (resp if resp else "(no comment - reviewer rejected; improve robustness and polish)"))
            return s2
    """, kind="shaper", description="Fold the reviewer's gate-2 answer into state."),

    fn("compose_merge", r"""
        def compose_merge(state):
            # Merge success is proven by a POSITIVE sentinel (MERGED_OK), never
            # by the absence of a failure token (adversary F4, proven on a
            # trunk-default repo).
            s = state if isinstance(state, dict) else {}
            ws = str(s.get("workspace_root") or "").strip()
            ws_q = shq(ws)
            branch = shq(s.get("branch") or "work")
            cmd = ("cd '" + ws_q + "' && git -c user.name='workflow' -c user.email='workflow@local' add -A >/dev/null 2>&1; "
                   "git -c user.name='workflow' -c user.email='workflow@local' commit -m 'final: docs + PR' >/dev/null 2>&1 || true; "
                   "if git checkout main 2>/dev/null || git checkout master 2>/dev/null; then "
                   "if git -c user.name='workflow' -c user.email='workflow@local' merge --no-ff '" + branch + "' -m 'merge: " + branch + "' 2>&1; then "
                   "echo MERGED_OK $(git rev-parse --abbrev-ref HEAD); "
                   "else git merge --abort 2>/dev/null; echo MERGE_CONFLICT_ABORTED; fi; "
                   "else echo NO_MAINLINE_BRANCH; fi")
            return {"name": "execute_command", "arguments": {"command": cmd}, "call_id": "git-merge"}
    """, kind="composer", description="Tool call: --no-ff merge with conflict abort + positive sentinel."),

    fn("record_merge", r"""
        def record_merge(state, merge_raw):
            s = state if isinstance(state, dict) else {}
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
            return s2
    """, kind="shaper", description="Fold the merge result into state (positive sentinel only)."),

]


# The planner's structured-output schema is a CONSTANT — it rides the
# resp_schema pin as a plain default, never a computed value.
PLANNER_SCHEMA = {
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


# ===========================================================================
# The FIVE code bodies that stay as canvas nodes. Three are multi-wire folds
# (a pin holds one wire; these each need 2+ producer wires). Two are
# multi-OUTPUT decisions (Final report, Doc drift check): several results
# consumed at different points — that fan-out is graph structure the canvas
# must show, so each output is a LABELED PIN with its own wire (operator
# ruling 2026-07-27; the 0.0.5 migration had hidden them in dict-returning
# functions re-read per pin).
# ===========================================================================

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
    # on every plan revision (design A-R5).
    s2["rescout"] = low.startswith("research")
return {"state": s2}
""".strip()

NEXT_STATE_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
v = verify_verdict if isinstance(verify_verdict, dict) else {}
all_passed = bool(v.get("all_passed"))
fails = v.get("failures") if isinstance(v.get("failures"), list) else []
fails = [str(x) for x in fails]
# Verifier DEATH is not "no failures": when the verify child run dies, the
# mapped output is None -> verdict {} with no all_passed key (adversary
# finding: delivered != failed must survive verifier death).
meta = verify_meta if isinstance(verify_meta, dict) else {}
if "all_passed" not in v:
    all_passed = False
    err = str(meta.get("error") or "verify child run died or returned no verdict")
    fails.append("verify: verdict missing - " + err[:160] + " (#FALLBACK)")
# ENVIRONMENT failures are not fixable by the builder: fail-soft to
# "delivered, not verifiable" (coding-agent 0.2.2 precedent).
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
# lowercase, strip STANDALONE digit runs (digits fused to identifiers kept).
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
this_cycle = int(s.get("fix_cycles", 0) or 0) + 1
s2["failure_signature"] = sig
s2["same_signature_count"] = same
s2["fix_cycles"] = this_cycle
s2["build_feedback"] = "\n".join(fails)
s2["all_passed"] = all_passed
s2["last_verdict"] = {"all_passed": all_passed, "failures": fails[:30],
                      "environment_failures": env_fails[:15]}
# environment-blocked: nothing fixable remains and the environment cannot
# verify - stop the loop honestly instead of burning the remaining budget
if env_fails and not fails and not all_passed:
    s2["environment_blocked"] = True
br = str(builder_response or "").strip()
# repair history: append one entry per FAILED cycle (cycle number, a short
# summary of what the builder said it did, and the failure that remained), so
# the next repair prompt shows the whole trail and the builder does not repeat
# an approach that already failed. Append-only, capped at 24 entries.
if not all_passed:
    hist = s.get("repair_history") if isinstance(s.get("repair_history"), list) else []
    hist = list(hist)
    changed = br[:400] if br else "(builder gave no summary)"
    failed_short = sig if sig else "; ".join(fails[:3])
    hist.append({"cycle": this_cycle, "changed": changed, "failed": failed_short[:300]})
    if len(hist) > 24:
        hist = hist[-24:]
    s2["repair_history"] = hist
# auto mode: green means approved (no human gate by explicit operator choice)
if all_passed and str(s.get("gating_mode") or "wait") == "auto":
    s2["approved"] = True
return {"state": s2}
""".strip()

# Doc drift check: ONE parse, TWO consequences (route + state write) at two
# different execution points. guard_text arrives pre-extracted (the pin
# expression `text_of(value)` unwraps the tool envelope on the wire).
DOC_DRIFT_CODE = r"""
s = loop_state if isinstance(loop_state, dict) else {}
s2 = dict(s)
txt = str(guard_text or "")
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
return {"ok": ok, "state": s2}
""".strip()

# Final report: one fold of terminal state into FOUR results (report, success,
# stopped_reason, branch), each a labeled pin wired to the end node.
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
stalled = int(s.get("same_signature_count", 0) or 0) >= 3
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
    f = base_flow(ROOT_FLOW_ID, "Multi-agent coding — main pipeline (edit on canvas)",
                  "Scouts (code+web) -> planner -> plan gate -> backlog -> git branch -> "
                  "[build -> lint -> selfcheck -> verify -> doc -> PR -> review gate]xN -> merge. "
                  "Deterministic git/lint/PR/merge via the flow FUNCTION LIBRARY (see the "
                  "Functions panel); two user gates (gating_mode=auto skips both; auto mode "
                  "needs input_data._runtime.tool_policy auto-approving execute_command "
                  "or an approving driver, else tool approvals park the run).",
                  interfaces=[CODING_INTERFACE],
                  functions=FUNCTIONS)
    N = f["nodes"]
    E = f["edges"]

    # Seed state from the whole run-vars view: one argument, every input
    # default lives inside mw_preflight (one source, no mirrored 13-arg call).
    seed_expr = "mw_preflight(vars)"

    # ---------------- nodes ----------------
    N.append(node("start", "on_flow_start", "Coding request", -2280, 0,
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
                                "max_fix_cycles": 6, "max_review_rounds": 2,
                                "skills": ["coredoc"],
                                "browser_probe_available": False,
                                "build_command": "", "run_command": ""}))
    N.append(node("set_state0", "set_var", "Seed state", -2000, 0,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  pin_expressions={"value": seed_expr},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))
    N.append(W.with_expressions(
        if_node("if_preflight", "Preflight ok?", -1720, 0),
        {"condition": S + '.get("preflight_ok", False)'}))
    N.append(node("end_pre", "on_flow_end", "Refused (preflight)", -1720, 260,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("stopped_reason", "stopped_reason", "string")],
                  pin_defaults={"success": False,
                                "stopped_reason": "preflight-failed"},
                  pin_expressions={"report": "pre_report(" + S + ")"}))

    # Run-start gating line (code-tui c5871): the FIRST user-visible line of
    # every run names the mode — "gating: wait" or "gating: auto" — so any
    # client renders it without knowing this workflow's shape. Stable prefix,
    # same contract as the "build cycle N of M" line.
    N.append(W.with_expressions(
        node("gating_status", "answer_user", "Gating mode", -1580, -200,
             inputs=[EXEC_IN, pin("message", "message", "string"),
                     pin("level", "level", "string")],
             outputs=[EXEC_OUT, pin("message", "message", "string")],
             pin_defaults={"level": "message"},
             extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"}),
        {"message": '"gating: " + ' + S + '.get("gating_mode", "wait")'}))

    # ---- L1: plan loop ----
    # Loop conditions carry the expression AND a FALSE pin default: on a
    # pre-expression runtime the expression is unread and the pin falls to
    # its default — False exits immediately (bounded refusal), while the
    # wf_common while_node default of True would spin the loop to its cap
    # executing agent calls. The min_runtime gate already refuses the bundle
    # on old gateways; this is defense-in-depth behind it.
    plan_while = while_node("plan_while", "Plan loop", -1440, 0)
    plan_while["data"]["pinDefaults"]["condition"] = False
    N.append(W.with_expressions(
        plan_while,
        {"condition": "not " + S + '.get("accepted") and '
                      + S + '.get("plan_revisions", 0) < ' + S + '.get("max_plan_revisions", 3)'}))
    # scouts run on the first pass and again only on an explicit "research"
    # choice; cached scout context feeds plain plan revisions for free
    N.append(W.with_expressions(
        if_node("if_scout", "Need scouting?", -1440, -280),
        {"condition": "not (" + S + '.get("scout_context") or "").strip() or bool(' + S + '.get("rescout"))'}))
    N.append(W.with_expressions(
        agent_node("scout_code", "Scout: code+docs", -1160, -420,
                   pin_defaults={"tools": ["read_file", "list_files", "search_files",
                                           "skim_files", "skim_folders", "analyze_code"],
                                 "max_iterations": 12, "temperature": 0.2}),
        {"prompt": "scout_code_prompt(" + S + ")",
         "provider": S + '.get("provider")', "model": S + '.get("model")'}))
    N.append(W.with_expressions(
        agent_node("scout_web", "Scout: internet", -860, -420,
                   pin_defaults={"tools": ["web_search", "fetch_url", "skim_websearch", "skim_url"],
                                 "max_iterations": 12, "temperature": 0.2}),
        {"prompt": "scout_web_prompt(" + S + ")",
         "provider": S + '.get("provider")', "model": S + '.get("model")'}))
    N.append(W.with_expressions(
        code_node("scout_merge", "Merge scout context", SCOUT_MERGE_CODE, -560, -480,
                  [pin("code_findings", "code_findings", "string"),
                   pin("web_findings", "web_findings", "string"),
                   pin("loop_state", "loop_state", "object")],
                  outputs=[pin("state", "state", "object")]),
        {"loop_state": S}))
    N.append(set_var("set_state_scout", "Cache scout context", STATE_VAR, -560, -280))
    N.append(W.with_expressions(
        agent_node("planner", "Planner", -280, -420,
                   pin_defaults={"tools": [], "max_iterations": 6, "temperature": 0.2,
                                 # the structured-output schema is a constant,
                                 # not a computed value
                                 "resp_schema": PLANNER_SCHEMA}),
        {"prompt": "planner_prompt(" + S + ")",
         "provider": S + '.get("provider")', "model": S + '.get("model")'}))
    N.append(W.with_expressions(
        if_node("if_g1", "Wait mode?", 0, -420),
        {"condition": S + '.get("wait_gating", True)'}))
    # gate1's prompt is COMPOSED from the planner's data by the gate1_prompt
    # library function (the planner dict rides the pin wire as `value`).
    # Wiring planner.data straight into ask_user.prompt would show the raw
    # dict repr, and a dead planner ({} — falsy) would fail the whole run at
    # the ask_user "requires payload.prompt" guard instead of recycling
    # through the bounded revision loop (migration adversary F1). The
    # choices are a constant pin default.
    gate1 = ask_user("gate1", "GATE 1: approve plan?", 280, -520)
    # The prompt is ALWAYS composed by the expression (a dead planner still
    # yields a non-empty prompt), so a literal prompt default is unreachable.
    gate1["data"]["pinDefaults"].pop("prompt", None)
    gate1["data"]["pinDefaults"]["choices"] = ["approve", "revise", "research"]
    N.append(W.with_expressions(gate1, {"prompt": "gate1_prompt(value)"}))
    N.append(W.with_expressions(
        code_node("gate1_parse", "Parse gate-1", GATE1_PARSE_CODE, 560, -640,
                  [pin("response", "response", "string"),
                   pin("loop_state", "loop_state", "object"),
                   pin("planner_data", "planner_data", "object")],
                  outputs=[pin("state", "state", "object")]),
        {"loop_state": S}))
    N.append(set_var("set_state_plan", "Record decision", STATE_VAR, 560, -420))
    # auto mode: deterministic accept - the fold is a library function; the
    # planner's data rides the pin wire as `value`.
    N.append(node("set_state_plan_auto", "set_var", "Record auto-accept", 280, -220,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  pin_expressions={"value": "auto_accept_plan(" + S + ", value)"},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))

    # ---- accepted? -> backlog + git ----
    N.append(W.with_expressions(
        if_node("if_accepted", "Accepted?", -1160, 260),
        {"condition": S + '.get("accepted", False)'}))
    N.append(W.with_expressions(
        write_file_node("backlog_write", "Write planned item", -880, 260),
        {"file_path": '"docs/backlog/planned/" + branch_slug(' + S + ') + ".md"',
         "content": "backlog_body(" + S + ")"}))
    N.append(W.with_expressions(
        call_tool("git_call", "Git init+branch", ["execute_command"], -600, 260),
        {"tool_call": "compose_git_branch(" + S + ")"}))
    N.append(node("set_state_git", "set_var", "Record branch state", -320, 260,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  pin_expressions={"value": "record_branch(" + S + ", value)"},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))

    # ---- L2: build loop ----
    build_while = while_node("build_while", "Build loop", -40, 260)
    build_while["data"]["pinDefaults"]["condition"] = False  # skew belt (see plan_while)
    N.append(W.with_expressions(
        build_while,
        {"condition": "build_again(" + S + ")"}))
    # Progress line at the TOP of each build cycle (operator "never a surprise"
    # request, relayed by code-tui c5833). A plain "build cycle N of M" status
    # with a STABLE leading token so a client strip renders it without guessing
    # the loop shape. N = cycles already done + 1 (the one about to run); M =
    # the fix budget for this review round. This is a fresh number each
    # iteration because the message rides the user-visible answer channel.
    N.append(W.with_expressions(
        node("cycle_status", "answer_user", "Build cycle progress", 100, 20,
             inputs=[EXEC_IN, pin("message", "message", "string"),
                     pin("level", "level", "string")],
             outputs=[EXEC_OUT, pin("message", "message", "string")],
             pin_defaults={"level": "message"},
             extra={"icon": "&#x1F4AC;", "headerColor": "#9B59B6"}),
        {"message": ('"build cycle " + str((' + S + '.get("fix_cycles", 0) or 0) + 1) '
                     '+ " of " + str(' + S + '.get("max_fix_cycles", 6) or 6)')}))
    # browser_probe (code-tui c5871): the bounded registered probe replaces
    # hand-rolled server+headless scripts that hung a live run for 8 hours.
    # Granted ONLY when the host mounts it (probe_ok) — the tools pin carries
    # the conditional; the pin DEFAULT stays the probe-less base list (skew
    # belt: a pre-expression runtime grants the safe set).
    builder_base_tools = ["read_file", "write_file", "edit_file",
                          "list_files", "search_files", "analyze_code",
                          "execute_command"]
    N.append(W.with_expressions(
        agent_node("builder", "Builder", 240, 140,
                   pin_defaults={"tools": builder_base_tools,
                                 "max_iterations": 40, "temperature": 0.2}),
        {"prompt": "builder_prompt(" + S + ")",
         "tools": ("value + ([\"browser_probe\"] if " + S + '.get("probe_ok") else [])'),
         "provider": S + '.get("provider")', "model": S + '.get("model")'}))
    N.append(W.with_expressions(
        call_tool("lint_call", "Lint + format (fix)", ["execute_command"], 540, 140),
        {"tool_call": "compose_lint(" + S + ")"}))
    N.append(W.with_expressions(
        call_tool("selfcheck_call", "Refresh SELFCHECK hashes", ["execute_command"], 820, 140),
        {"tool_call": "compose_selfcheck_refresh(" + S + ")"}))
    N.append(W.with_expressions(
        call_tool("commit_call", "Commit cycle", ["execute_command"], 1100, 140),
        {"tool_call": "compose_commit(" + S + ")"}))
    N.append(W.with_expressions(
        subflow_node("verify", "Test: mounted gates", VERIFY_FLOW_ID, 1380, 140),
        {"input": VERIFY_INPUT_EXPR}))
    # Fold verdict is a genuinely multi-wire node: verify output + child meta
    # + builder response + lint raw. Its lint_out pin extracts residuals from
    # the raw lint envelope via the library (`parse_lint_residuals(value)`);
    # verify_verdict extracts the verdict field from the child's output.
    N.append(W.with_expressions(
        code_node("next_state", "Fold verdict", NEXT_STATE_CODE, 1660, 320,
                  [pin("verify_verdict", "verify_verdict", "object"),
                   pin("verify_meta", "verify_meta", "object"),
                   pin("builder_response", "builder_response", "string"),
                   pin("lint_out", "lint_out", "array"),
                   pin("loop_state", "loop_state", "object")],
                  outputs=[pin("state", "state", "object")]),
        {"verify_verdict": field_expr("verdict", "{}"),
         "lint_out": "parse_lint_residuals(value)",
         "loop_state": S}))
    N.append(set_var("set_state_build", "Record build state", STATE_VAR, 1660, 140))

    # ---- loop tail: green -> doc -> guard -> PR -> gate2 / escalate / red ----
    N.append(W.with_expressions(
        if_node("if_green", "Gates green?", 1940, 140),
        {"condition": S + '.get("all_passed", False)'}))
    # if_escalate's FALSE branch is deliberately unwired: a red iteration with
    # no escalation simply ends (an unwired branch inside an active while
    # completes the iteration cleanly — same mechanism the dangling exec-outs
    # of the set_state nodes rely on). The old identity-write set_var here
    # was a no-op node.
    N.append(W.with_expressions(
        if_node("if_escalate", "Stuck: ask human?", 1940, 420),
        {"condition": "tail_escalate(" + S + ")"}))
    N.append(W.with_expressions(
        agent_node("doc", "Documenter", 2220, 20,
                   pin_defaults={"tools": ["read_file", "write_file", "edit_file",
                                           "list_files", "search_files"],
                                 "max_iterations": 15, "temperature": 0.2}),
        {"prompt": "doc_prompt(" + S + ")",
         "provider": S + '.get("provider")', "model": S + '.get("model")'}))
    N.append(W.with_expressions(
        call_tool("docguard_call", "Doc guard (hash check)", ["execute_command"], 2520, 20),
        {"tool_call": "compose_doc_guard(" + S + ")"}))
    # Doc drift check: one parse, two labeled outputs at two execution points
    # (ok -> route, state -> red write). A code node so the fan-out is VISIBLE
    # wiring, not a function re-read behind two pins.
    N.append(W.with_expressions(
        code_node("doc_drift", "Doc drift check", DOC_DRIFT_CODE, 2660, -200,
                  [pin("guard_text", "guard_text", "string"),
                   pin("loop_state", "loop_state", "object")],
                  outputs=[pin("ok", "ok", "boolean"),
                           pin("state", "state", "object")]),
        {"guard_text": "text_of(value)", "loop_state": S}))
    N.append(if_node("if_docok", "Source untouched?", 2800, 20))
    N.append(node("set_state_docred", "set_var", "Doc broke it (red)", 2800, -400,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))
    pr_write = write_file_node("pr_write", "Write PR.md", 3080, 20)
    pr_write["data"].setdefault("pinDefaults", {})["file_path"] = "PR.md"
    N.append(W.with_expressions(pr_write, {"content": "pr_body(" + S + ")"}))
    N.append(W.with_expressions(
        call_tool("pr_call", "Push + PR (if remote)", ["execute_command"], 3360, 20),
        {"tool_call": "compose_pr_push(" + S + ")"}))
    N.append(W.with_expressions(
        if_node("if_g2", "Wait mode?", 3640, 20),
        {"condition": S + '.get("wait_gating", True)'}))
    gate2 = ask_user("gate2", "GATE 2: approve merge?", 3920, 100)
    gate2["data"]["pinDefaults"].pop("prompt", None)  # always composed (see gate1)
    N.append(W.with_expressions(
        gate2,
        {"prompt": "gate2_prompt(" + S + ")",
         "choices": '["approve", "request changes"] if ' + S + '.get("all_passed") else ["stop", "guide repairs"]'}))
    # if_g2's FALSE branch (auto mode) is deliberately unwired: green in auto
    # mode was already auto-approved by the verdict fold, so the iteration
    # just ends and the loop condition exits. The old identity-write set_var
    # here was a no-op node.
    N.append(node("set_state_g2", "set_var", "Record review", 4200, 100,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  pin_expressions={"value": "parse_gate2(" + S + ", value)"},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))

    # ---- post-loop: merge + report ----
    N.append(W.with_expressions(
        if_node("if_approved", "Merge?", -40, 640),
        {"condition": S + '.get("approved", False) and ' + S + '.get("all_passed", False)'}))
    N.append(W.with_expressions(
        call_tool("merge_call", "Merge --no-ff to main", ["execute_command"], 240, 640),
        {"tool_call": "compose_merge(" + S + ")"}))
    N.append(node("set_state_merge", "set_var", "Record merge state", 520, 640,
                  inputs=[EXEC_IN, pin("name", "name", "string"),
                          pin("value", "value", "object")],
                  outputs=[EXEC_OUT],
                  pin_defaults={"name": STATE_VAR},
                  pin_expressions={"value": "record_merge(" + S + ", value)"},
                  extra={"icon": "&#x1F4E5;", "headerColor": "#8E44AD"}))
    # Final report: ONE fold, FOUR labeled outputs wired to the end node —
    # the fan-out is visible graph structure (multi-output helpers are nodes).
    N.append(W.with_expressions(
        code_node("final_report", "Final report", FINAL_REPORT_CODE, 520, 860,
                  [pin("loop_state", "loop_state", "object")],
                  outputs=[pin("report", "report", "string"),
                           pin("success", "success", "boolean"),
                           pin("stopped_reason", "stopped_reason", "string"),
                           pin("branch", "branch", "string")]),
        {"loop_state": S}))
    N.append(node("end", "on_flow_end", "Result", 800, 640,
                  inputs=[EXEC_IN, pin("report", "report", "string"),
                          pin("success", "success", "boolean"),
                          pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string")]))

    # ---------------- edges ----------------
    def ex(a, b, *, src="exec-out", dst="exec-in"):
        E.append(edge(a, src, b, dst))

    def data(a, ah, b, bh):
        E.append(edge(a, ah, b, bh))

    # start -> seed state -> preflight door
    ex("start", "set_state0")
    ex("set_state0", "if_preflight")
    ex("if_preflight", "end_pre", src="false")

    # L1 plan loop (through the run-start gating line)
    ex("if_preflight", "gating_status", src="true")
    ex("gating_status", "plan_while")
    ex("plan_while", "if_scout", src="loop")
    ex("if_scout", "scout_code", src="true")
    ex("if_scout", "planner", src="false")
    ex("scout_code", "scout_web")
    ex("scout_web", "set_state_scout")
    data("scout_code", "response", "scout_merge", "code_findings")
    data("scout_web", "response", "scout_merge", "web_findings")
    data("scout_merge", "state", "set_state_scout", "value")
    ex("set_state_scout", "planner")
    ex("planner", "if_g1")
    # wait mode: human gate. planner.data rides the prompt wire so the
    # gate1_prompt(value) expression sees it as `value`; choices are a
    # constant pin default.
    ex("if_g1", "gate1", src="true")
    data("planner", "data", "gate1", "prompt")
    ex("gate1", "set_state_plan")
    data("gate1", "response", "gate1_parse", "response")
    data("planner", "data", "gate1_parse", "planner_data")
    data("gate1_parse", "state", "set_state_plan", "value")
    # auto mode: deterministic accept (planner data rides the value wire)
    ex("if_g1", "set_state_plan_auto", src="false")
    data("planner", "data", "set_state_plan_auto", "value")

    # plan done -> accepted?
    ex("plan_while", "if_accepted", src="done")
    ex("if_accepted", "end", src="false")
    # backlog + git
    ex("if_accepted", "backlog_write", src="true")
    ex("backlog_write", "git_call")
    ex("git_call", "set_state_git")
    data("git_call", "raw", "set_state_git", "value")

    # L2 build loop
    ex("set_state_git", "build_while")
    ex("build_while", "cycle_status", src="loop")
    ex("cycle_status", "builder")
    ex("builder", "lint_call")
    ex("lint_call", "selfcheck_call")
    ex("selfcheck_call", "commit_call")
    ex("commit_call", "verify")
    ex("verify", "set_state_build")
    data("verify", "output", "next_state", "verify_verdict")
    # child_output is RUNTIME-PROVIDED on subflow nodes: None on a healthy
    # child, {success:false, error} when the child run DIES.
    data("verify", "child_output", "next_state", "verify_meta")
    data("builder", "response", "next_state", "builder_response")
    data("lint_call", "raw", "next_state", "lint_out")
    data("next_state", "state", "set_state_build", "value")

    # tail-in-loop
    ex("set_state_build", "if_green")
    ex("if_green", "if_escalate", src="false")
    ex("if_escalate", "gate2", src="true")
    # if_escalate false: unwired — red iteration ends, loop re-evaluates
    ex("if_green", "doc", src="true")
    ex("doc", "docguard_call")
    ex("docguard_call", "if_docok")
    # one parse, two labeled consequences: ok routes, state carries the red fold
    data("docguard_call", "raw", "doc_drift", "guard_text")
    data("doc_drift", "ok", "if_docok", "condition")
    ex("if_docok", "set_state_docred", src="false")
    data("doc_drift", "state", "set_state_docred", "value")
    ex("if_docok", "pr_write", src="true")
    ex("pr_write", "pr_call")
    ex("pr_call", "if_g2")
    ex("if_g2", "gate2", src="true")
    ex("gate2", "set_state_g2")
    data("gate2", "response", "set_state_g2", "value")
    # if_g2 false (auto mode): unwired — iteration ends, loop exits on approval

    # post-loop: merge decision
    ex("build_while", "if_approved", src="done")
    ex("if_approved", "merge_call", src="true")
    ex("merge_call", "set_state_merge")
    data("merge_call", "raw", "set_state_merge", "value")
    ex("set_state_merge", "end")
    ex("if_approved", "end", src="false")
    # terminal fold: four labeled results, four visible wires
    data("final_report", "report", "end", "report")
    data("final_report", "success", "end", "success")
    data("final_report", "branch", "end", "branch")
    data("final_report", "stopped_reason", "end", "stopped_reason")

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{ROOT_FLOW_ID}.json", f)
    return f


def _collapse_read_verdict(flow: dict) -> None:
    """Tier-1 migration applied to the PINNED COPY only: the source flow
    (coding-verify-gates) belongs to the coding-agent bundle and stays
    byte-untouched; this copy collapses its one single-consumer accessor,
    the get_var `read_verdict` (vg.verdict, default {}), into a pin
    expression on its sole consumer pin end.verdict.

    Every expectation is HARD-asserted: if the source drifts (node renamed,
    var renamed, a second consumer added), the build fails LOUDLY instead of
    emitting a silently mis-converted copy - the copy is drift-pinned, never
    drift-tolerant."""
    by_id = {n["id"]: n for n in flow["nodes"]}
    rv = by_id.get("read_verdict")
    if rv is None or rv["data"].get("nodeType") != "get_var":
        raise AssertionError("verify copy drifted: get_var node 'read_verdict' not found")
    pd = rv["data"].get("pinDefaults") or {}
    if pd.get("name") != "vg.verdict" or pd.get("default") != {}:
        raise AssertionError(f"verify copy drifted: read_verdict pinDefaults changed: {pd}")
    outs = [e for e in flow["edges"] if e["source"] == "read_verdict"]
    ins = [e for e in flow["edges"] if e["target"] == "read_verdict"]
    if ins or len(outs) != 1:
        raise AssertionError(
            f"verify copy drifted: read_verdict edges changed (in={len(ins)}, out={len(outs)})")
    only = outs[0]
    if (only["sourceHandle"], only["target"], only["targetHandle"]) != ("value", "end", "verdict"):
        raise AssertionError(f"verify copy drifted: read_verdict consumer changed: {only}")
    end = by_id.get("end") or {}
    end_inputs = {p.get("id") for p in (end.get("data", {}).get("inputs") or [])}
    if "verdict" not in end_inputs:
        raise AssertionError("verify copy drifted: end node has no 'verdict' input pin")
    if "verdict" in (end["data"].get("pinExpressions") or {}):
        raise AssertionError("verify copy drifted: end.verdict already carries an expression")
    flow["nodes"] = [n for n in flow["nodes"] if n["id"] != "read_verdict"]
    flow["edges"] = [e for e in flow["edges"]
                     if e["source"] != "read_verdict" and e["target"] != "read_verdict"]
    end["data"].setdefault("pinExpressions", {})["verdict"] = var_expr("vg.verdict")


def build_verify_copy() -> dict:
    """Drift-pinned copy of coding-verify-gates as multiagent-verify-gates."""
    src = json.loads((FLOWS_DIR / "coding-verify-gates.json").read_text())
    src["id"] = VERIFY_FLOW_ID
    src["name"] = "Multi-agent verify gates — embedded subflow (auto-managed)"
    _collapse_read_verdict(src)
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
    "# browser_probe rides through as a DECLARED pin defaulting TRUE (code-tui\n"
    "# c5871: the tool is registered on the shipped gateway and bounded; the\n"
    "# old hardcoded False made every report claim static-only verification).\n"
    "# A probe-less gateway sends browser_probe_available=false.\n"
    "probe = True if browser_probe_available is None else bool(browser_probe_available)\n"
    "built = {\n"
    "    \"request\": p,\n"
    "    \"workspace_root\": ws,\n"
    "    \"provider\": provider,\n"
    "    \"model\": model,\n"
    "    \"gating_mode\": g,\n"
    "    \"browser_probe_available\": probe,\n"
    "}\n"
    "return {\"built\": built}"
)


def build_wrapper() -> dict:
    """agent.v1 wrapper (mirrors `coder`): {prompt} -> multiagent-coding root
    -> {response, success, meta}. This is the entrypoint that appears in the
    app agent-workflow picker; the strict coding.v1 root does not (by design)."""
    f = base_flow(WRAPPER_FLOW_ID, "Multi-agent coder — chat entry (runs pipeline)",
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
                           pin("gating_mode", "gating_mode", "string"),
                           pin("browser_probe_available", "browser_probe_available", "boolean")],
                  pin_defaults={"prompt": "", "workspace_root": "",
                                "gating_mode": WRAPPER_GATING,
                                "browser_probe_available": True}))
    N.append(code_node("map_input", "Map prompt -> request", WRAPPER_MAP_CODE, -560, 0,
                       [pin("prompt", "prompt", "string"),
                        pin("workspace_root", "workspace_root", "string"),
                        pin("gating_mode", "gating_mode", "string"),
                        pin("browser_probe_available", "browser_probe_available", "boolean"),
                        pin("provider", "provider", "provider_text"),
                        pin("model", "model", "model")]))
    N.append(subflow_node("build", "Run multi-agent coding", ROOT_FLOW_ID, -220, 0))
    # Field extraction rides pin EXPRESSIONS on the consumers (tier-1
    # migration): build.output wires straight to each consumer pin and the
    # expression reads one field off it - the four single-consumer get nodes
    # (get_report/get_success/get_branch/get_reason) collapsed here. A dead
    # child delivers output=None; `(value or {})` keeps the get-node default
    # semantics for that case.
    N.append(node("meta_obj", "make_object", "Build meta", 500, 40,
                  inputs=[pin("branch", "branch", "string"),
                          pin("stopped_reason", "stopped_reason", "string")],
                  outputs=[pin("result", "result", "object")],
                  pin_expressions={
                      "branch": field_expr("branch", '""'),
                      "stopped_reason": field_expr("stopped_reason", '""'),
                  }))
    N.append(node("end", "on_flow_end", "Answer", 860, 0,
                  inputs=[EXEC_IN, pin("response", "response", "string"),
                          pin("success", "success", "boolean"),
                          pin("meta", "meta", "object")],
                  pin_expressions={
                      "response": field_expr("report", '""'),
                      "success": field_expr("success", "False"),
                  }))

    E.append(edge("start", "exec-out", "build", "exec-in"))
    E.append(edge("build", "exec-out", "end", "exec-in"))
    E.append(edge("start", "prompt", "map_input", "prompt"))
    E.append(edge("start", "workspace_root", "map_input", "workspace_root"))
    E.append(edge("start", "gating_mode", "map_input", "gating_mode"))
    E.append(edge("start", "browser_probe_available", "map_input", "browser_probe_available"))
    E.append(edge("start", "provider", "map_input", "provider"))
    E.append(edge("start", "model", "map_input", "model"))
    E.append(edge("map_input", "built", "build", "input"))
    # the whole child output object feeds each extracting pin directly
    E.append(edge("build", "output", "end", "response"))
    E.append(edge("build", "output", "end", "success"))
    E.append(edge("build", "output", "meta_obj", "branch"))
    E.append(edge("build", "output", "meta_obj", "stopped_reason"))
    E.append(edge("meta_obj", "result", "end", "meta"))

    W.apply_flow_layout(f)
    write_json(FLOWS_DIR / f"{WRAPPER_FLOW_ID}.json", f)
    return f


def _assert_seed_precedes_state_reads(flow: dict) -> None:
    """Structural pin (correctness-adversary blind spot 5): every `vars.state`
    expression evaluates strictly AFTER the seed node ran. Enforced by shape:
    the start node's ONLY exec successor is set_state0, so every downstream
    node passes through the seed. A future exec-reorder that breaks this
    fails the BUILD, not a live run with a KeyError."""
    start_exec = [e for e in flow["edges"]
                  if e["source"] == "start" and e.get("sourceHandle") == "exec-out"]
    if len(start_exec) != 1 or start_exec[0]["target"] != "set_state0":
        raise AssertionError(
            f"seed-before-reads broken: start exec edges {[(e['target']) for e in start_exec]} "
            "(must be exactly [set_state0] — vars.state expressions assume the seed ran)")
    for n in flow["nodes"]:
        if n["id"] in ("start", "set_state0"):
            exprs = n["data"].get("pinExpressions") or {}
            for pin_id, expr in exprs.items():
                if "vars.state" in str(expr):
                    raise AssertionError(
                        f"seed-before-reads broken: {n['id']}.{pin_id} reads vars.state "
                        "before/at the seed node")


def main() -> int:
    verify = build_verify_copy()
    root = build_root()
    wrapper = build_wrapper()
    _assert_seed_precedes_state_reads(root)
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
    for fid, flow in ((ROOT_FLOW_ID, root), (VERIFY_FLOW_ID, verify), (WRAPPER_FLOW_ID, wrapper)):
        overlaps = W.layout_overlap_findings(flow)
        if overlaps:
            ok = False
            print(f"LAYOUT OVERLAPS ({fid}): {len(overlaps)}")
            for finding in overlaps[:10]:
                print("  " + finding)
            if len(overlaps) > 10:
                print(f"  ... and {len(overlaps) - 10} more")
    if not ok:
        return 1
    pure = [n for n in root["nodes"]
            if n["data"].get("nodeType") == "code"
            and "exec-in" not in {p["id"] for p in (n["data"].get("inputs") or [])}]
    print(f"Wrote {ROOT_FLOW_ID}.json ({len(root['nodes'])} nodes, {len(root['edges'])} edges, "
          f"{len(pure)} pure code nodes, {len(root.get('functions') or [])} library functions)"
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
            root_flow_id=WRAPPER_FLOW_ID, bundle_id=BUNDLE_ID,
            bundle_version=BUNDLE_VERSION,
            # TWO entrypoints (coding-agent precedent): strict coding.v1 root
            # (default) + agent.v1 wrapper (picker-visible).
            entrypoints=[ROOT_FLOW_ID, WRAPPER_FLOW_ID],
            metadata={
                "family": "multiagent-coding",
                # This bundle uses PIN EXPRESSIONS + the flow FUNCTION LIBRARY
                # (0.0.5 migration): it REQUIRES a runtime that evaluates
                # node.data.pinExpressions and compiles flow.functions. An
                # older runtime ignores both; expression-only pins fall to
                # their defaults (falsy -> bounded refusal), wired+expression
                # pins pass raw objects. The min_runtime gate makes an old
                # gateway refuse LOUDLY instead of degrading at all.
                "min_runtime": "0.4.30",
                "requires_pin_expressions": True,
                "requires_flow_functions": True,
                "purpose": ("14-step multi-agent coding pipeline: scouts(code+web) -> planner -> "
                            "plan gate -> backlog -> git branch -> [build -> lint -> selfcheck -> "
                            "mounted verify -> doc guard -> PR -> review gate]xN -> deterministic merge. "
                            "Dual-interface: coding.v1 strict root (request/workspace_root in) + "
                            "agent.v1 wrapper 'multiagent-coder' (prompt in, picker-visible). Both "
                            "default to gating_mode=wait (two human gates); send gating_mode=auto "
                            "for unattended runs."),
                # Catalog-level gating discoverability (code-tui c5871): a
                # client detects that this workflow is gating-capable from the
                # catalog entry instead of matching the bundle id by name.
                "gating": {"pin": "gating_mode", "values": ["wait", "auto"],
                           "default": WRAPPER_GATING},
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
