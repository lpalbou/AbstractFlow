#!/usr/bin/env python3
"""Deterministic smoke tests for the multi-agent coding workflow logic.

Three layers (0.0.5 function-library migration):
1. LIBRARY COMPILE: the emitted flow's `functions` compile through the REAL
   runtime function-library compiler (RestrictedPython, code-node policy) —
   catches chr()/import/name violations before any live run.
2. NODE COMPILE: the three remaining pure code-node bodies compile through
   the real code-node compiler (same lane the runtime uses).
3. LOGIC SCENARIOS: run the load-bearing functions/bodies against
   representative payloads, including the live-found envelope shapes from
   coding-agent 0.2.4 (dict execute_command output, *_preview compaction)
   and quoting adversaries (workspace path with a single quote).

The scenarios are the SAME behavioral pins the pre-migration smoke carried —
the migration moved code from nodes into the library; the laws must not move.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from abstractruntime.visualflow_compiler.visual.code_executor import (  # noqa: E402
    create_code_handler,
)
from abstractruntime.visualflow_compiler.visual.executor import (  # noqa: E402
    _generate_code_from_body,
)
from abstractruntime.visualflow_compiler.visual.function_library import (  # noqa: E402
    compile_function_library,
)

FLOWS = ROOT / "abstractflow" / "examples" / "flows"

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


_HANDLERS: dict[str, object] = {}


def run_body(wrapped_code: str, inputs: dict) -> dict:
    """Execute a node body through the SAME wrap+compile lane the runtime uses."""
    handler = _HANDLERS.get(wrapped_code)
    if handler is None:
        handler = create_code_handler(wrapped_code, "transform")
        _HANDLERS[wrapped_code] = handler
    out = handler(inputs)
    if not isinstance(out, dict):
        raise RuntimeError(f"code body returned non-dict: {type(out)}")
    return out


def main() -> int:
    flow = json.loads((FLOWS / "multiagent-coding.json").read_text())

    # ---- layer 1: compile the FUNCTION LIBRARY through the real lane ----
    LIB = compile_function_library(flow.get("functions"))
    check("library-compiles", len(LIB) == len(flow.get("functions") or []),
          f"{len(LIB)}/{len(flow.get('functions') or [])}")

    # ---- layer 2: compile the remaining pure node bodies ----
    bodies = {n["id"]: _generate_code_from_body(n["data"], "transform")
              for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
    pure_ids = sorted(bodies.keys())
    check("only-multiwire-nodes-remain", pure_ids == ["gate1_parse", "next_state", "scout_merge"],
          f"pure code nodes: {pure_ids}")
    compiled = 0
    for nid, code in sorted(bodies.items()):
        try:
            create_code_handler(code, "transform")
            compiled += 1
        except Exception as e:  # noqa: BLE001
            check(f"compile:{nid}", False, str(e)[:200])
    check("sandbox-compile-all", compiled == len(bodies), f"{compiled}/{len(bodies)}")

    # ---- layer 0: expression wiring pins on the emitted flow ----
    by_id = {n["id"]: n for n in flow["nodes"]}
    seed_expr = (by_id["set_state0"]["data"].get("pinExpressions") or {}).get("value", "")
    check("fx-seed-calls-mw-preflight", seed_expr.startswith("mw_preflight("), seed_expr[:80])
    check("fx-seed-reads-runtime-skills",
          '(vars.get("_runtime") or {}).get("skills_resolution")' in seed_expr,
          "gateway-attested skills resolution must ride the seed (adversary F2)")
    check("fx-end-reads-final-report",
          (by_id["end"]["data"].get("pinExpressions") or {}).get("success", "").startswith("final_report("))
    coder = json.loads((FLOWS / "multiagent-coder.json").read_text())
    coder_end = next(n for n in coder["nodes"] if n["id"] == "end")
    fx_keys = set(coder_end["data"].get("pinExpressions") or {})
    check("fx-wire-spelling-wrapper", fx_keys == {"response", "success"},
          f"multiagent-coder end.pinExpressions keys: {sorted(fx_keys)}")

    # Live progress line (operator "never a surprise"): a "build cycle N of M"
    # answer_user fires at the TOP of each build cycle with a STABLE prefix the
    # client strip keys on. Pin the node, the stable token, and the wiring
    # (loop -> cycle_status -> builder).
    cs = by_id.get("cycle_status")
    check("cycle-status-node-exists", bool(cs) and cs["data"].get("nodeType") == "answer_user",
          f"cycle_status: {cs and cs['data'].get('nodeType')}")
    csx = (cs or {}).get("data", {}).get("pinExpressions", {}) if cs else {}
    check("cycle-status-stable-prefix", '"build cycle "' in csx.get("message", "")
          and "fix_cycles" in csx.get("message", "") and "max_fix_cycles" in csx.get("message", ""),
          f"cycle_status.message: {csx.get('message')}")
    edges = flow["edges"]
    loop_to_cs = any(e["source"] == "build_while" and e.get("sourceHandle") == "loop"
                     and e["target"] == "cycle_status" for e in edges)
    cs_to_builder = any(e["source"] == "cycle_status" and e["target"] == "builder" for e in edges)
    check("cycle-status-wired-top-of-loop", loop_to_cs and cs_to_builder,
          f"loop->cs={loop_to_cs} cs->builder={cs_to_builder}")

    # F1 REGRESSION (migration adversary): gate1's prompt+choices MUST be
    # COMPUTED by gate1_prompt, not the raw planner dict. The library defined
    # gate1_prompt but nothing called it, so the wait-mode plan gate showed a
    # dict repr with no choices and a dead planner failed the whole run.
    g1x = by_id["gate1"]["data"].get("pinExpressions") or {}
    check("gate1-prompt-wired", "gate1_prompt(" in g1x.get("prompt", "")
          and "gate1_prompt(" in g1x.get("choices", ""),
          f"gate1 pinExpressions: {g1x}")

    # ---- layer 3: logic scenarios (behavioral pins carried across the
    # migration; every law asserted pre-0.0.5 is asserted here) ----
    B = bodies

    def seed_state(**over):
        base = LIB["mw_preflight"]("build snake", "/tmp/ws", "wait", ["coredoc"],
                                   {"active": []}, 3, 3, 2, "", "", "p", "m", False)
        base.update(over)
        return base

    # mw_preflight: happy path + missing workspace + skills degrade + config fold
    st = LIB["mw_preflight"]("build snake", "/tmp/ws", "auto", ["coredoc"],
                             {"active": []}, 3, 3, 2, "", "", "p", "m", False)
    check("preflight-ok", st["preflight_ok"] is True)
    check("preflight-auto", st["gating_mode"] == "auto")
    check("preflight-skill-warn", any("skills not active" in w for w in st["warnings"]))
    check("preflight-probe-warn", any("browser_probe" in w for w in st["warnings"]))
    check("preflight-folds-config", st["request"] == "build snake"
          and st["workspace_root"] == "/tmp/ws" and st["max_fix_cycles"] == 3
          and st["provider"] == "p" and st["model"] == "m")
    st_bad = LIB["mw_preflight"]("", "", "bogus", [], {}, 3, 3, 2, "", "", None, None, True)
    check("preflight-refuses-empty", st_bad["preflight_ok"] is False
          and len(st_bad["preflight_failures"]) == 2)
    check("preflight-bogus-gating-defaults-wait", st_bad["gating_mode"] == "wait")
    check("pre-report-names-failures", "empty request" in LIB["pre_report"](st_bad))
    # Default fix budget is 6 when the caller passes nothing (operator request).
    st_def = LIB["mw_preflight"]("r", "/tmp/ws", "wait", [], {}, 0, 0, 0, "", "", "p", "m", False)
    check("preflight-default-fix-budget-6", st_def["max_fix_cycles"] == 6)
    check("preflight-seeds-empty-repair-history", st_def["repair_history"] == [])

    # gate1 parse (node): approve / revise; auto accept (library)
    st0 = {"gating_mode": "wait", "plan_revisions": 0}
    pd = {"title": "Snake Game", "goal": "g", "steps": ["a"]}
    out = run_body(B["gate1_parse"], {"response": "approve", "loop_state": st0, "planner_data": pd})
    check("gate1-approve", out["state"]["accepted"] is True and out["state"]["title"] == "Snake Game")
    out = run_body(B["gate1_parse"], {"response": "needs sound effects", "loop_state": st0, "planner_data": pd})
    check("gate1-revise", out["state"]["accepted"] is False
          and out["state"]["plan_revisions"] == 1
          and "sound" in out["state"]["plan_feedback"])
    s = LIB["auto_accept_plan"](st0, pd)
    check("gate1-auto-accepts", s["accepted"] is True)
    s = LIB["auto_accept_plan"]({"plan_revisions": 0}, {})
    check("gate1-auto-refuses-dead-plan", s["accepted"] is False
          and s["plan_revisions"] == 1 and "structured plan" in s["plan_feedback"])

    # gate1_prompt formats the approval prompt + 3 choices from the planner's
    # data (F1: this function must actually run — see gate1-prompt-wired). A
    # dead planner ({}) still yields a NON-EMPTY prompt so the wait-mode gate
    # opens (user sends it back) instead of failing the run.
    gp = LIB["gate1_prompt"]({"title": "Snake Game", "goal": "g", "steps": ["a", "b"]})
    check("gate1-prompt-formatted", "PLAN for your approval" in gp["prompt"]
          and "Snake Game" in gp["prompt"] and gp["choices"] == ["approve", "revise", "research"])
    gp0 = LIB["gate1_prompt"]({})
    check("gate1-prompt-dead-planner-nonempty", gp0["prompt"].strip() != ""
          and len(gp0["choices"]) == 3, f"dead-planner prompt: {gp0}")

    # backlog fields: slug sanitization (injection-shaped title)
    st = {"plan": {"title": "Fix; rm -rf / --EVIL name", "goal": "g", "steps": ["s1"],
                   "files": ["a.js"], "risks": []}, "title": ""}
    out = LIB["backlog_fields"](st)
    slug = out["slug"]
    check("backlog-slug-safe", all(("a" <= c <= "z") or ("0" <= c <= "9") or c == "-" for c in slug), slug)
    check("backlog-path", out["file_path"] == f"docs/backlog/planned/{slug}.md")

    # git branch compose: quote-hostile workspace path stays inside single
    # quotes; slug derives from the plan via the SHARED backlog_fields
    st = {"plan": {"title": "Snake Game", "goal": "g", "steps": ["s"]},
          "workspace_root": "/tmp/it's here"}
    cmd = LIB["compose_git_branch"](st)["arguments"]["command"]
    check("git-quote-escape", "it'\\''s" in cmd, cmd[:120])
    check("git-ceiling", "GIT_CEILING_DIRECTORIES" in cmd)
    check("git-toplevel-guard", "--show-toplevel" in cmd)
    check("git-slug-from-plan", "'snake-game'" in cmd, cmd[:200])
    # baseline commit lands on the WORK branch, never the user's current
    # branch (adversary F7): checkout -b must precede add -A/commit
    check("git-branch-before-baseline", cmd.find("checkout -b") < cmd.find("add -A"))

    # record_branch: dict output shape + preview fallback (shared text_of)
    raw = {"mode": "results", "results": [{"output": {"stdout": "hint\nsnake-game\n"}}]}
    s = LIB["record_branch"](st, raw)
    check("git-fold-branch", s["branch"] == "snake-game")
    raw = {"results": [{"output": {"stdout_preview": "snake-game"}}]}
    s = LIB["record_branch"](st, raw)
    check("git-fold-preview", s["branch"] == "snake-game")

    # next_state (node): failure signature + stall + split counters + auto-approve
    st = {"gating_mode": "wait", "fix_cycles": 0, "failure_signature": "", "same_signature_count": 0}
    verdict = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: ls shows 3 files",
        "integration: 12 errors found - see log line 88",
    ]}
    out1 = run_body(B["next_state"], {"verify_verdict": verdict, "lint_out": [], "loop_state": st})
    s1 = out1["state"]
    check("fold-counts", s1["fix_cycles"] == 1 and s1["all_passed"] is False)
    check("fold-sig-keeps-fused-digits", "level2.js" in s1["failure_signature"])
    check("fold-sig-drops-standalone-digits", " 12 " not in s1["failure_signature"])
    verdict2 = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: totally different words now",
        "integration: 12 errors found - other log",
    ]}
    out2 = run_body(B["next_state"], {"verify_verdict": verdict2, "lint_out": [], "loop_state": s1})
    check("fold-stall-counts", out2["state"]["same_signature_count"] == 1)
    out3 = run_body(B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                      "lint_out": [], "loop_state": {"gating_mode": "auto"}})
    check("fold-auto-approves-green", out3["state"]["approved"] is True)
    out4 = run_body(B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                      "lint_out": [], "loop_state": {"gating_mode": "wait"}})
    check("fold-wait-needs-gate", not out4["state"].get("approved"))
    out5 = run_body(B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                      "lint_out": ["syntax error in x.py"], "loop_state": {"gating_mode": "auto"}})
    check("fold-lint-blocks-green", out5["state"]["all_passed"] is False and not out5["state"].get("approved"))
    # VERIFIER DEATH: verdict {} (dead child) -> named failure, latching signature
    d1 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": st})
    check("fold-verifier-death-named", any("verdict missing" in f for f in d1["state"]["last_verdict"]["failures"])
          and d1["state"]["all_passed"] is False and d1["state"]["failure_signature"] != "")
    d2 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": d1["state"]})
    d3 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": d2["state"]})
    check("fold-verifier-death-latches-stall", d3["state"]["same_signature_count"] >= 2)
    # attempt memory rides into the repair prompt (via state -> builder_prompt)
    m = run_body(B["next_state"], {"verify_verdict": verdict, "lint_out": [],
                                   "loop_state": seed_state(), "builder_response": "I wrote game.js using canvas polling"})
    check("fold-attempt-memory", "canvas polling" in m["state"].get("last_attempt_summary", ""))
    check("repair-prompt-cites-attempt", "canvas polling" in LIB["builder_prompt"](m["state"]))

    # REPAIR HISTORY (operator request): each FAILED cycle appends a structured
    # entry {cycle, changed, failed}; the builder prompt shows the whole trail
    # so the builder does not repeat an approach that already failed.
    h1 = run_body(B["next_state"], {"verify_verdict": {"all_passed": False, "failures": ["delivery: a.js missing"]},
                                    "lint_out": [], "loop_state": seed_state(), "builder_response": "attempt one: added a.js"})
    hist1 = h1["state"]["repair_history"]
    check("repair-history-appends", len(hist1) == 1 and hist1[0]["cycle"] == 1
          and "attempt one" in hist1[0]["changed"] and hist1[0]["failed"], f"hist: {hist1}")
    h2 = run_body(B["next_state"], {"verify_verdict": {"all_passed": False, "failures": ["integration: broke b.js"]},
                                    "lint_out": [], "loop_state": h1["state"], "builder_response": "attempt two: rewrote b.js"})
    hist2 = h2["state"]["repair_history"]
    check("repair-history-accumulates", len(hist2) == 2 and hist2[1]["cycle"] == 2)
    prompt2 = LIB["builder_prompt"](h2["state"])
    check("repair-prompt-shows-whole-trail",
          "attempt one" in prompt2 and "attempt two" in prompt2 and "Repair history" in prompt2)
    # A green cycle appends NOTHING (repair history is failed cycles only).
    hg = run_body(B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                    "lint_out": [], "loop_state": h2["state"], "builder_response": "fixed it"})
    check("repair-history-not-on-green", len(hg["state"]["repair_history"]) == 2)

    # parse_gate2: approve / reject resets fix counters, bumps review
    st = {"gating_mode": "wait", "fix_cycles": 3, "review_rounds": 0,
          "same_signature_count": 2, "failure_signature": "x", "all_passed": True}
    s = LIB["parse_gate2"](st, "approve")
    check("gate2-approve", s["approved"] is True and s["last_gate2"] == "approved")
    s = LIB["parse_gate2"](st, "the ship should shoot faster")
    check("gate2-reject-resets", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["same_signature_count"] == 0
          and s["all_passed"] is False and "shoot faster" in s["build_feedback"]
          and s["last_gate2"] == "rejected")
    # ESCALATION semantics (red build): comments = guidance; stop = end; approve-on-red = guidance
    red = {"gating_mode": "wait", "fix_cycles": 3, "review_rounds": 0,
           "same_signature_count": 2, "all_passed": False}
    s = LIB["parse_gate2"](red, "try a state machine for levels")
    check("gate2-escalation-guides", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["last_gate2"] == "escalated"
          and "state machine" in s["build_feedback"])
    s = LIB["parse_gate2"](red, "stop")
    check("gate2-escalation-stop", s["user_stopped"] is True and s["approved"] is False)
    s = LIB["parse_gate2"](red, "approve")
    check("gate2-red-approve-refused", s["approved"] is False,
          "approve on a red build must not merge")
    # escalation prompt names failures + stop option; green prompt offers approve
    p = LIB["gate2_prompt"]({"all_passed": False, "branch": "b",
                             "last_verdict": {"failures": ["delivery: x missing"]},
                             "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-escalation", "BUILD STUCK" in p["prompt"] and "stop" in json.dumps(p["choices"]))
    # The escalation message must say WHICH reason stopped it (operator request):
    # same-failure-repeating vs out-of-cycles read differently for the human.
    p_stall = LIB["gate2_prompt"]({"all_passed": False, "branch": "b", "same_signature_count": 3,
                                   "last_verdict": {"failures": ["x"]}, "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-names-stall", "SAME failure" in p_stall["prompt"])
    p_budget = LIB["gate2_prompt"]({"all_passed": False, "branch": "b", "same_signature_count": 0,
                                    "fix_cycles": 6, "max_fix_cycles": 6,
                                    "last_verdict": {"failures": ["x"]}, "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-names-budget", "fix budget" in p_budget["prompt"])
    p = LIB["gate2_prompt"]({"all_passed": True, "branch": "b",
                             "review_rounds": 2, "max_review_rounds": 2})
    check("gate2-prompt-final-round-warning", "FINAL review round" in p["prompt"])

    # build_again: budgets + stall + approval (budgets from state now)
    check("cond-continues", LIB["build_again"]({"approved": False, "fix_cycles": 0, "review_rounds": 0,
                                                "same_signature_count": 0,
                                                "max_fix_cycles": 3, "max_review_rounds": 2}) is True)
    check("cond-stops-approved", LIB["build_again"]({"approved": True}) is False)
    check("cond-continues-at-2-repeats", LIB["build_again"]({"approved": False, "same_signature_count": 2,
                                                             "max_fix_cycles": 6}) is True)
    check("cond-stops-stalled", LIB["build_again"]({"approved": False, "same_signature_count": 3}) is False)
    check("cond-stops-budget", LIB["build_again"]({"approved": False, "fix_cycles": 3,
                                                   "max_fix_cycles": 3}) is False)
    check("cond-stops-user-stop", LIB["build_again"]({"approved": False, "user_stopped": True}) is False)
    check("cond-stops-env-blocked", LIB["build_again"]({"approved": False, "environment_blocked": True}) is False)

    # record_merge: POSITIVE sentinel required (adversary F4)
    raw = {"results": [{"output": {"stdout": "Auto-merging...\nMERGE_CONFLICT_ABORTED"}}]}
    s = LIB["record_merge"]({"approved": True}, raw)
    check("merge-conflict-honest", s["merged"] is False
          and any("conflict" in w for w in s["warnings"]))
    raw = {"results": [{"output": {"stdout": "Merge made by ort\nMERGED_OK main"}}]}
    s = LIB["record_merge"]({"approved": True}, raw)
    check("merge-green", s["merged"] is True)
    raw = {"results": [{"output": {"stdout": "NO_MAINLINE_BRANCH"}}]}
    s = LIB["record_merge"]({"approved": True}, raw)
    check("merge-no-mainline-honest", s["merged"] is False
          and any("no main/master" in w for w in s["warnings"]))
    raw = {"results": [{"output": {"stdout": "something odd happened"}}]}
    s = LIB["record_merge"]({"approved": True}, raw)
    check("merge-missing-sentinel-honest", s["merged"] is False)
    # recursive extractor: direct-lane bare dict, nested envelope, plain
    # string, stderr-only (the shapes GATE5 was hardened for; adversary F3)
    shapes = [
        {"results": [{"output": {"stdout": "MERGED_OK main"}}]},
        {"mode": "results", "results": [{"output": {"results": [{"output": {"stdout_preview": "MERGED_OK main"}}]}}]},
        {"results": [{"output": "MERGED_OK main"}]},
        {"results": [{"output": {"stderr": "MERGED_OK main"}}]},
    ]
    ok_shapes = 0
    for raw in shapes:
        if LIB["record_merge"]({"approved": True}, raw)["merged"] is True:
            ok_shapes += 1
    check("extractor-recursive-shapes", ok_shapes == len(shapes), f"{ok_shapes}/{len(shapes)}")
    # merge command: sentinel only on the success path; loud no-mainline branch
    cmd = LIB["compose_merge"]({"branch": "b", "workspace_root": "/w"})["arguments"]["command"]
    check("merge-cmd-sentinel", "MERGED_OK" in cmd and "NO_MAINLINE_BRANCH" in cmd)

    # lint parser: diagnostic grammar only (adversary F1/F2 false-red class)
    def lint_res(text):
        return LIB["parse_lint_residuals"]({"results": [{"output": {"stdout": text}}]})
    check("lint-ignores-ruff-success-summary", lint_res("Found 12 errors (12 fixed, 0 remaining).") == [])
    check("lint-ignores-all-checks-passed", lint_res("All checks passed!") == [])
    check("lint-ignores-filename-echo", lint_res("src/error-modal.js 12ms") == [])
    check("lint-catches-ruff-diagnostic", lint_res("src/game.js:12:5: E501 line too long") != [])
    check("lint-catches-diag-in-error-named-file", lint_res("src/error_handler.py:3:1: F401 unused import") != [])
    check("lint-catches-prettier-error", lint_res("[error] src/app.js: SyntaxError: Unexpected token (5:12)") != [])
    check("lint-catches-bare-syntaxerror", lint_res("SyntaxError: invalid syntax in solution.py") != [])

    # doc guard: drift -> red with named feedback; clean + no-selfcheck -> ok
    g = LIB["doc_drift"]({"all_passed": True},
                         {"results": [{"output": {"stdout": "DOC_DRIFT game.js\nDOC_DRIFT my file.py"}}]})
    check("docguard-drift-red", g["ok"] is False and g["state"]["all_passed"] is False
          and "game.js" in g["state"]["build_feedback"] and "my file.py" in g["drifted"][1])
    g = LIB["doc_drift"]({"all_passed": True}, {"results": [{"output": {"stdout": "DOC_GUARD_OK"}}]})
    check("docguard-clean-ok", g["ok"] is True and g["state"]["all_passed"] is True)
    g = LIB["doc_drift"]({"all_passed": True}, {"results": [{"output": {"stdout": "NO_SELFCHECK_TO_GUARD"}}]})
    check("docguard-no-selfcheck-ok", g["ok"] is True)
    cmd = LIB["compose_doc_guard"]({"workspace_root": "/w"})["arguments"]["command"]
    check("docguard-posix-no-procsub", "< <(" not in cmd)

    # plan_again: scouts on first pass + explicit research only
    out = LIB["plan_again"]({"scout_context": "", "accepted": False, "max_plan_revisions": 3})
    check("scout-first-pass", out["need_scout"] is True)
    out = LIB["plan_again"]({"scout_context": "cached", "rescout": False, "accepted": False,
                             "max_plan_revisions": 3})
    check("scout-skip-on-revision", out["need_scout"] is False)
    out = LIB["plan_again"]({"scout_context": "cached", "rescout": True, "accepted": False,
                             "max_plan_revisions": 3})
    check("scout-on-research", out["need_scout"] is True)
    out = run_body(B["gate1_parse"], {"response": "research: check WebAudio APIs",
                                      "loop_state": {"plan_revisions": 0}, "planner_data": {}})
    check("gate1-research-flag", out["state"]["rescout"] is True)

    # tail_check: escalation trigger (wait+red+exhausted/stalled only)
    out = LIB["tail_check"]({"all_passed": False, "gating_mode": "wait",
                             "fix_cycles": 3, "same_signature_count": 0, "max_fix_cycles": 3})
    check("escalate-on-exhaustion", out["escalate"] is True)
    out = LIB["tail_check"]({"all_passed": False, "gating_mode": "auto",
                             "fix_cycles": 3, "same_signature_count": 0, "max_fix_cycles": 3})
    check("no-escalate-in-auto", out["escalate"] is False)
    out = LIB["tail_check"]({"all_passed": False, "gating_mode": "wait",
                             "fix_cycles": 1, "same_signature_count": 0, "max_fix_cycles": 3})
    check("no-escalate-mid-budget", out["escalate"] is False)
    out = LIB["tail_check"]({"all_passed": False, "gating_mode": "wait", "environment_blocked": True,
                             "fix_cycles": 3, "same_signature_count": 0, "max_fix_cycles": 3})
    check("no-escalate-env-blocked", out["escalate"] is False)

    # ENVIRONMENT fail-soft (coding-agent 0.2.2 precedent; live 2026-07-23)
    st0 = {"gating_mode": "auto", "fix_cycles": 0, "failure_signature": "", "same_signature_count": 0}
    out = run_body(B["next_state"], {"verify_verdict": {"all_passed": False,
                                                        "failures": ["Build step failed: missing Python executor."],
                                                        "environment_failures": []},
                                     "lint_out": [], "loop_state": st0})
    s = out["state"]
    check("env-belt-classifies", s.get("environment_blocked") is True
          and s["last_verdict"]["environment_failures"] != []
          and s["last_verdict"]["failures"] == [])
    out = run_body(B["next_state"], {"verify_verdict": {"all_passed": False, "failures": [],
                                                        "environment_failures": ["no shell executor available"]},
                                     "lint_out": [], "loop_state": st0})
    check("env-primary-lane", out["state"].get("environment_blocked") is True)
    out = run_body(B["next_state"], {"verify_verdict": {"all_passed": False,
                                                        "failures": ["delivery: main.js missing",
                                                                     "Execution step failed: missing Python executor."],
                                                        "environment_failures": []},
                                     "lint_out": [], "loop_state": st0})
    check("env-mixed-keeps-fixing", not out["state"].get("environment_blocked")
          and "main.js" in out["state"]["build_feedback"]
          and "executor" not in out["state"]["build_feedback"])
    out = LIB["final_report"]({"accepted": True, "approved": False,
                               "environment_blocked": True, "all_passed": False,
                               "last_verdict": {"failures": [],
                                                "environment_failures": ["missing Python executor"]}})
    check("report-env-blocked", "delivered-not-verifiable" in out["stopped_reason"]
          and "Environment" in out["report"])

    # final report: reasons per state + evidence rendering
    out = LIB["final_report"]({"accepted": False, "title": "Snake Game",
                               "plan_feedback": "too vague\nname the files"})
    check("report-plan-refused", "plan-not-accepted" in out["stopped_reason"])
    check("report-plan-evidence", "Snake Game" in out["report"] and "too vague" in out["report"])
    out = LIB["final_report"]({"accepted": True, "approved": True,
                               "merged": True, "all_passed": True, "branch": "b"})
    check("report-merged", out["stopped_reason"] == "approved-and-merged" and out["success"] is True)
    out = LIB["final_report"]({"accepted": True, "approved": False,
                               "all_passed": False, "same_signature_count": 3})
    check("report-stalled", "stalled" in out["stopped_reason"])
    out = LIB["final_report"]({"accepted": True, "approved": False,
                               "user_stopped": True, "all_passed": False})
    check("report-user-stop", "stopped-by-reviewer" in out["stopped_reason"])
    out = LIB["final_report"]({"accepted": True, "approved": False,
                               "all_passed": False, "last_gate2": "rejected",
                               "review_rounds": 3, "max_review_rounds": 2,
                               "build_feedback": "REVIEWER CHANGE REQUESTS (gate 2):\nfaster ship"})
    check("report-review-exhausted", "review-rounds-exhausted" in out["stopped_reason"]
          and "faster ship" in out["report"])
    out = LIB["final_report"]({"accepted": True, "approved": False,
                               "all_passed": False, "last_gate2": "rejected",
                               "review_rounds": 1, "max_review_rounds": 2, "fix_cycles": 3})
    check("report-budget-not-review", "review-rounds-exhausted" not in out["stopped_reason"])

    # pr fields: no-remote degrade text + quote safety (config from state)
    st = {"title": "Snake", "plan": {"goal": "g"}, "branch": "snake-game",
          "last_verdict": {"all_passed": True}, "warnings": ["w1"],
          "workspace_root": "/tmp/it's ws"}
    out = LIB["pr_fields"](st)
    check("pr-md-path", out["pr_path"] == "PR.md")
    check("pr-remote-degrade", "NO_REMOTE_LOCAL_PR_MD_ONLY" in out["gh_call"]["arguments"]["command"])
    check("pr-quote-escape", "it'\\''s" in out["gh_call"]["arguments"]["command"])
    check("pr-no-prompt-hang", "GIT_TERMINAL_PROMPT=0" in out["gh_call"]["arguments"]["command"]
          and out["gh_call"]["arguments"].get("timeout") == 120)

    # verify_input: fix_cycles rides as round_index; config from state
    out = LIB["verify_input"]({"fix_cycles": 2, "request": "r", "workspace_root": "/w",
                               "build_command": "", "run_command": "", "provider": "p", "model": "m"})
    check("verify-round-index", out["round_index"] == 2)
    check("verify-config-from-state", out["request"] == "r" and out["workspace_root"] == "/w"
          and out["provider"] == "p")

    # ---- layer 4: END-TO-END through the real Runtime (no LLM needed): the
    # preflight refusal path exercises the whole expression stack live —
    # library compile at flow build, seed expression on set_var, door
    # condition, end-pin extraction from final_report/pre_report ----
    from abstractruntime import Runtime
    from abstractruntime.core.models import RunStatus
    from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
    from abstractruntime.visualflow_compiler import compile_visualflow

    spec = compile_visualflow(flow)
    runtime = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())
    run_id = runtime.start(workflow=spec, vars={"request": "", "workspace_root": ""})
    state_run = runtime.tick(workflow=spec, run_id=run_id, max_steps=50)
    check("e2e-refusal-completes", state_run.status == RunStatus.COMPLETED,
          f"status={state_run.status}")
    out = state_run.output or {}
    check("e2e-refusal-honest", out.get("success") is False
          and out.get("stopped_reason") == "preflight-failed"
          and "empty request" in str(out.get("report") or ""),
          str(out)[:200])

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("SMOKE OK: all scenarios passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
