#!/usr/bin/env python3
"""Deterministic smoke tests for the multi-agent coding workflow code nodes.

Two layers:
1. SANDBOX COMPILE: every `code` node body in the emitted flow must compile
   through the real RestrictedPython code-node compiler (catches chr()/import/
   naming violations before any live run — the co-scientist chr() lesson).
2. LOGIC SCENARIOS: run the load-bearing bodies (state folds, gate parses,
   shell composition) against representative payloads, including the
   live-found envelope shapes from coding-agent 0.2.4 (dict execute_command
   output, *_preview compaction) and quoting adversaries (workspace path with
   a single quote).
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

FLOWS = ROOT / "abstractflow" / "examples" / "flows"

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


_HANDLERS: dict[str, object] = {}


def run_body(_ex_unused, wrapped_code: str, inputs: dict) -> dict:
    """Execute a node through the SAME wrap+compile lane the runtime uses."""
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
    # Wrap every codeBody exactly as the runtime does (pin extraction +
    # def transform(_input) header) so compile results mirror live behavior.
    bodies = {n["id"]: _generate_code_from_body(n["data"], "transform")
              for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
    ex = None

    # ---- layer 1: sandbox-COMPILE every body through the real restricted
    # compiler (create_code_handler compiles eagerly; catches chr()/imports) ----
    compiled = 0
    for nid, code in sorted(bodies.items()):
        try:
            create_code_handler(code, "transform")
            compiled += 1
        except Exception as e:  # noqa: BLE001
            check(f"compile:{nid}", False, str(e)[:200])
    check("sandbox-compile-all", compiled == len(bodies), f"{compiled}/{len(bodies)}")

    # ---- layer 2: logic scenarios ----
    B = bodies

    # preflight: happy path + missing workspace + skills degrade
    out = run_body(ex, B["preflight"], {
        "request": "build snake", "workspace_root": "/tmp/ws",
        "gating_mode": "auto", "skills": ["coredoc"],
        "skills_resolution": {"active": []}, "browser_probe_available": False,
    })
    check("preflight-ok", out["preflight_ok"] is True)
    check("preflight-auto", out["state"]["gating_mode"] == "auto")
    check("preflight-skill-warn", any("skills not active" in w for w in out["state"]["warnings"]))
    check("preflight-probe-warn", any("browser_probe" in w for w in out["state"]["warnings"]))
    out = run_body(ex, B["preflight"], {
        "request": "", "workspace_root": "", "gating_mode": "bogus",
        "skills": [], "skills_resolution": {}, "browser_probe_available": True,
    })
    check("preflight-refuses-empty", out["preflight_ok"] is False and len(out["failures"]) == 2)
    check("preflight-bogus-gating-defaults-wait", out["state"]["gating_mode"] == "wait")

    # gate1 parse: approve / revise / auto
    st0 = {"gating_mode": "wait", "plan_revisions": 0}
    pd = {"title": "Snake Game", "goal": "g", "steps": ["a"]}
    out = run_body(ex, B["gate1_parse"], {"response": "approve", "loop_state": st0, "planner_data": pd})
    check("gate1-approve", out["state"]["accepted"] is True and out["state"]["title"] == "Snake Game")
    out = run_body(ex, B["gate1_parse"], {"response": "needs sound effects", "loop_state": st0, "planner_data": pd})
    check("gate1-revise", out["state"]["accepted"] is False
          and out["state"]["plan_revisions"] == 1
          and "sound" in out["state"]["plan_feedback"])
    out = run_body(ex, B["gate1_auto"], {"loop_state": st0, "planner_data": pd})
    check("gate1-auto-accepts", out["state"]["accepted"] is True)

    # backlog fields: slug sanitization (injection-shaped title)
    st = {"plan": {"title": "Fix; rm -rf / --EVIL name", "goal": "g", "steps": ["s1"],
                   "files": ["a.js"], "risks": []}, "title": ""}
    out = run_body(ex, B["backlog_fields"], {"loop_state": st})
    slug = out["slug"]
    check("backlog-slug-safe", all(("a" <= c <= "z") or ("0" <= c <= "9") or c == "-" for c in slug), slug)
    check("backlog-path", out["file_path"] == f"docs/backlog/planned/{slug}.md")

    # git args: quote-hostile workspace path stays inside single quotes
    out = run_body(ex, B["git_args"], {"branch_slug": "snake-game",
                                       "workspace_root": "/tmp/it's here"})
    cmd = out["arguments"]["command"]
    check("git-quote-escape", "it'\\''s" in cmd, cmd[:120])
    check("git-ceiling", "GIT_CEILING_DIRECTORIES" in cmd)
    check("git-toplevel-guard", "--show-toplevel" in cmd)
    # baseline commit lands on the WORK branch, never the user's current
    # branch (adversary F7): checkout -b must precede add -A/commit
    check("git-branch-before-baseline", cmd.find("checkout -b") < cmd.find("add -A"))

    # git fold: dict output shape + preview fallback
    raw = {"mode": "results", "results": [{"output": {"stdout": "hint\nsnake-game\n"}}]}
    out = run_body(ex, B["git_fold"], {"git_raw": raw, "slug": "snake-game", "loop_state": {}})
    check("git-fold-branch", out["state"]["branch"] == "snake-game")
    raw = {"results": [{"output": {"stdout_preview": "snake-game"}}]}
    out = run_body(ex, B["git_fold"], {"git_raw": raw, "slug": "s", "loop_state": {}})
    check("git-fold-preview", out["state"]["branch"] == "snake-game")

    # next_state: failure signature + stall + split counters + auto-approve
    st = {"gating_mode": "wait", "fix_cycles": 0, "failure_signature": "", "same_signature_count": 0}
    verdict = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: ls shows 3 files",
        "integration: 12 errors found - see log line 88",
    ]}
    out1 = run_body(ex, B["next_state"], {"verify_verdict": verdict, "lint_out": [], "loop_state": st})
    s1 = out1["state"]
    check("fold-counts", s1["fix_cycles"] == 1 and s1["all_passed"] is False)
    check("fold-sig-keeps-fused-digits", "level2.js" in s1["failure_signature"])
    check("fold-sig-drops-standalone-digits", " 12 " not in s1["failure_signature"])
    # same failures again (different evidence tails) -> same signature counts up
    verdict2 = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: totally different words now",
        "integration: 12 errors found - other log",
    ]}
    out2 = run_body(ex, B["next_state"], {"verify_verdict": verdict2, "lint_out": [], "loop_state": s1})
    check("fold-stall-counts", out2["state"]["same_signature_count"] == 1)
    # green in auto mode -> approved
    out3 = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                          "lint_out": [], "loop_state": {"gating_mode": "auto"}})
    check("fold-auto-approves-green", out3["state"]["approved"] is True)
    # green in wait mode -> NOT auto approved
    out4 = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                          "lint_out": [], "loop_state": {"gating_mode": "wait"}})
    check("fold-wait-needs-gate", not out4["state"].get("approved"))
    # lint residuals make it red
    out5 = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": True, "failures": []},
                                          "lint_out": ["syntax error in x.py"], "loop_state": {"gating_mode": "auto"}})
    check("fold-lint-blocks-green", out5["state"]["all_passed"] is False and not out5["state"].get("approved"))
    # VERIFIER DEATH: verdict {} (dead child) -> named failure, latching signature
    d1 = run_body(ex, B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                        "lint_out": [], "loop_state": st})
    check("fold-verifier-death-named", any("verdict missing" in f for f in d1["state"]["last_verdict"]["failures"])
          and d1["state"]["all_passed"] is False and d1["state"]["failure_signature"] != "")
    d2 = run_body(ex, B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                        "lint_out": [], "loop_state": d1["state"]})
    d3 = run_body(ex, B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                        "lint_out": [], "loop_state": d2["state"]})
    check("fold-verifier-death-latches-stall", d3["state"]["same_signature_count"] >= 2)
    # attempt memory rides into repair prompt
    m = run_body(ex, B["next_state"], {"verify_verdict": verdict, "lint_out": [],
                                       "loop_state": st, "builder_response": "I wrote game.js using canvas polling"})
    check("fold-attempt-memory", "canvas polling" in m["state"].get("last_attempt_summary", ""))
    bp = run_body(ex, B["builder_prompt"], {"request": "r", "loop_state": m["state"]})
    check("repair-prompt-cites-attempt", "canvas polling" in bp["prompt"])

    # gate2 parse: approve / reject resets fix counters, bumps review
    st = {"gating_mode": "wait", "fix_cycles": 3, "review_rounds": 0,
          "same_signature_count": 2, "failure_signature": "x", "all_passed": True}
    out = run_body(ex, B["gate2_parse"], {"response": "approve", "loop_state": st})
    check("gate2-approve", out["state"]["approved"] is True and out["state"]["last_gate2"] == "approved")
    out = run_body(ex, B["gate2_parse"], {"response": "the ship should shoot faster", "loop_state": st})
    s = out["state"]
    check("gate2-reject-resets", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["same_signature_count"] == 0
          and s["all_passed"] is False and "shoot faster" in s["build_feedback"]
          and s["last_gate2"] == "rejected")
    # ESCALATION semantics (red build): comments = guidance; stop = end; approve-on-red = guidance
    red = {"gating_mode": "wait", "fix_cycles": 3, "review_rounds": 0,
           "same_signature_count": 2, "all_passed": False}
    out = run_body(ex, B["gate2_parse"], {"response": "try a state machine for levels", "loop_state": red})
    s = out["state"]
    check("gate2-escalation-guides", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["last_gate2"] == "escalated"
          and "state machine" in s["build_feedback"])
    out = run_body(ex, B["gate2_parse"], {"response": "stop", "loop_state": red})
    check("gate2-escalation-stop", out["state"]["user_stopped"] is True and out["state"]["approved"] is False)
    out = run_body(ex, B["gate2_parse"], {"response": "approve", "loop_state": red})
    check("gate2-red-approve-refused", out["state"]["approved"] is False,
          "approve on a red build must not merge")
    # escalation prompt names failures + stop option; green prompt offers approve
    p = run_body(ex, B["gate2_prompt"], {"loop_state": {"all_passed": False, "branch": "b",
                                                        "last_verdict": {"failures": ["delivery: x missing"]},
                                                        "review_rounds": 0, "max_review_rounds": 2}})
    check("gate2-prompt-escalation", "BUILD STUCK" in p["prompt"] and "stop" in json.dumps(p["choices"]))
    p = run_body(ex, B["gate2_prompt"], {"loop_state": {"all_passed": True, "branch": "b",
                                                        "review_rounds": 2, "max_review_rounds": 2}})
    check("gate2-prompt-final-round-warning", "FINAL review round" in p["prompt"])

    # build_cond: budgets + stall + approval
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": False, "fix_cycles": 0, "review_rounds": 0,
                                                        "same_signature_count": 0},
                                         "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-continues", out["condition"] is True)
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": True}, "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-stops-approved", out["condition"] is False)
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": False, "same_signature_count": 2},
                                         "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-stops-stalled", out["condition"] is False)
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": False, "fix_cycles": 3},
                                         "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-stops-budget", out["condition"] is False)

    # merge: POSITIVE sentinel required; conflict + no-mainline + missing
    # sentinel are all honest-unmerged (adversary F4: absence-of-token folds
    # reported "approved-and-merged" over an unmerged trunk-default repo)
    raw = {"results": [{"output": {"stdout": "Auto-merging...\nMERGE_CONFLICT_ABORTED"}}]}
    out = run_body(ex, B["merge_fold"], {"merge_raw": raw, "loop_state": {"approved": True}})
    check("merge-conflict-honest", out["state"]["merged"] is False
          and any("conflict" in w for w in out["state"]["warnings"]))
    raw = {"results": [{"output": {"stdout": "Merge made by ort\nMERGED_OK main"}}]}
    out = run_body(ex, B["merge_fold"], {"merge_raw": raw, "loop_state": {"approved": True}})
    check("merge-green", out["state"]["merged"] is True)
    raw = {"results": [{"output": {"stdout": "NO_MAINLINE_BRANCH"}}]}
    out = run_body(ex, B["merge_fold"], {"merge_raw": raw, "loop_state": {"approved": True}})
    check("merge-no-mainline-honest", out["state"]["merged"] is False
          and any("no main/master" in w for w in out["state"]["warnings"]))
    raw = {"results": [{"output": {"stdout": "something odd happened"}}]}
    out = run_body(ex, B["merge_fold"], {"merge_raw": raw, "loop_state": {"approved": True}})
    check("merge-missing-sentinel-honest", out["state"]["merged"] is False)
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
        out = run_body(ex, B["merge_fold"], {"merge_raw": raw, "loop_state": {"approved": True}})
        if out["state"]["merged"] is True:
            ok_shapes += 1
    check("extractor-recursive-shapes", ok_shapes == len(shapes), f"{ok_shapes}/{len(shapes)}")
    # merge command: sentinel only on the success path; loud no-mainline branch
    cmd = run_body(ex, B["merge_args"], {"loop_state": {"branch": "b"}, "workspace_root": "/w"})["arguments"]["command"]
    check("merge-cmd-sentinel", "MERGED_OK" in cmd and "NO_MAINLINE_BRANCH" in cmd)

    # lint parser: diagnostic grammar only (adversary F1/F2 false-red class)
    def lint_res(text):
        return run_body(ex, B["lint_parse"], {"lint_raw": {"results": [{"output": {"stdout": text}}]}})["residuals"]
    check("lint-ignores-ruff-success-summary", lint_res("Found 12 errors (12 fixed, 0 remaining).") == [])
    check("lint-ignores-all-checks-passed", lint_res("All checks passed!") == [])
    check("lint-ignores-filename-echo", lint_res("src/error-modal.js 12ms") == [])
    check("lint-catches-ruff-diagnostic", lint_res("src/game.js:12:5: E501 line too long") != [])
    check("lint-catches-diag-in-error-named-file", lint_res("src/error_handler.py:3:1: F401 unused import") != [])
    check("lint-catches-prettier-error", lint_res("[error] src/app.js: SyntaxError: Unexpected token (5:12)") != [])
    check("lint-catches-bare-syntaxerror", lint_res("SyntaxError: invalid syntax in solution.py") != [])

    # doc guard: drift -> red with named feedback; clean + no-selfcheck -> ok
    g = run_body(ex, B["docguard_fold"], {"guard_raw": {"results": [{"output": {"stdout": "DOC_DRIFT game.js\nDOC_DRIFT my file.py"}}]},
                                          "loop_state": {"all_passed": True}})
    check("docguard-drift-red", g["ok"] is False and g["state"]["all_passed"] is False
          and "game.js" in g["state"]["build_feedback"] and "my file.py" in g["drifted"][1])
    g = run_body(ex, B["docguard_fold"], {"guard_raw": {"results": [{"output": {"stdout": "DOC_GUARD_OK"}}]},
                                          "loop_state": {"all_passed": True}})
    check("docguard-clean-ok", g["ok"] is True and g["state"]["all_passed"] is True)
    g = run_body(ex, B["docguard_fold"], {"guard_raw": {"results": [{"output": {"stdout": "NO_SELFCHECK_TO_GUARD"}}]},
                                          "loop_state": {"all_passed": True}})
    check("docguard-no-selfcheck-ok", g["ok"] is True)
    cmd = run_body(ex, B["docguard_args"], {"workspace_root": "/w"})["arguments"]["command"]
    check("docguard-posix-no-procsub", "< <(" not in cmd)

    # gate1_auto: dead plan -> bounded re-plan, never blind accept
    out = run_body(ex, B["gate1_auto"], {"loop_state": {"plan_revisions": 0}, "planner_data": {}})
    check("gate1-auto-refuses-dead-plan", out["state"]["accepted"] is False
          and out["state"]["plan_revisions"] == 1 and "structured plan" in out["state"]["plan_feedback"])

    # plan_cond: scouts on first pass + explicit research only
    out = run_body(ex, B["plan_cond"], {"loop_state": {"scout_context": "", "accepted": False},
                                        "max_plan_revisions": 3})
    check("scout-first-pass", out["need_scout"] is True)
    out = run_body(ex, B["plan_cond"], {"loop_state": {"scout_context": "cached", "rescout": False,
                                                       "accepted": False}, "max_plan_revisions": 3})
    check("scout-skip-on-revision", out["need_scout"] is False)
    out = run_body(ex, B["plan_cond"], {"loop_state": {"scout_context": "cached", "rescout": True,
                                                       "accepted": False}, "max_plan_revisions": 3})
    check("scout-on-research", out["need_scout"] is True)
    out = run_body(ex, B["gate1_parse"], {"response": "research: check WebAudio APIs",
                                          "loop_state": {"plan_revisions": 0}, "planner_data": {}})
    check("gate1-research-flag", out["state"]["rescout"] is True)

    # tail_check: escalation trigger (wait+red+exhausted/stalled only)
    out = run_body(ex, B["tail_check"], {"loop_state": {"all_passed": False, "gating_mode": "wait",
                                                        "fix_cycles": 3, "same_signature_count": 0},
                                         "max_fix_cycles": 3})
    check("escalate-on-exhaustion", out["escalate"] is True)
    out = run_body(ex, B["tail_check"], {"loop_state": {"all_passed": False, "gating_mode": "auto",
                                                        "fix_cycles": 3, "same_signature_count": 0},
                                         "max_fix_cycles": 3})
    check("no-escalate-in-auto", out["escalate"] is False)
    out = run_body(ex, B["tail_check"], {"loop_state": {"all_passed": False, "gating_mode": "wait",
                                                        "fix_cycles": 1, "same_signature_count": 0},
                                         "max_fix_cycles": 3})
    check("no-escalate-mid-budget", out["escalate"] is False)

    # build_cond: user stop exits
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": False, "user_stopped": True},
                                         "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-stops-user-stop", out["condition"] is False)

    # ENVIRONMENT fail-soft (coding-agent 0.2.2 precedent; live 2026-07-23:
    # "missing Python executor" burned 3 fix cycles): env failures never burn
    # the fix budget, exit the loop immediately, and report honestly.
    st0 = {"gating_mode": "auto", "fix_cycles": 0, "failure_signature": "", "same_signature_count": 0}
    out = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": False,
                                                            "failures": ["Build step failed: missing Python executor."],
                                                            "environment_failures": []},
                                         "lint_out": [], "loop_state": st0})
    s = out["state"]
    check("env-belt-classifies", s.get("environment_blocked") is True
          and s["last_verdict"]["environment_failures"] != []
          and s["last_verdict"]["failures"] == [])
    out = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": False, "failures": [],
                                                            "environment_failures": ["no shell executor available"]},
                                         "lint_out": [], "loop_state": st0})
    check("env-primary-lane", out["state"].get("environment_blocked") is True)
    # a FIXABLE failure alongside env lines keeps the loop repairing
    out = run_body(ex, B["next_state"], {"verify_verdict": {"all_passed": False,
                                                            "failures": ["delivery: main.js missing",
                                                                         "Execution step failed: missing Python executor."],
                                                            "environment_failures": []},
                                         "lint_out": [], "loop_state": st0})
    check("env-mixed-keeps-fixing", not out["state"].get("environment_blocked")
          and "main.js" in out["state"]["build_feedback"]
          and "executor" not in out["state"]["build_feedback"])
    out = run_body(ex, B["build_cond"], {"loop_state": {"approved": False, "environment_blocked": True},
                                         "max_fix_cycles": 3, "max_review_rounds": 2})
    check("cond-stops-env-blocked", out["condition"] is False)
    out = run_body(ex, B["tail_check"], {"loop_state": {"all_passed": False, "gating_mode": "wait",
                                                        "environment_blocked": True, "fix_cycles": 3,
                                                        "same_signature_count": 0},
                                         "max_fix_cycles": 3})
    check("no-escalate-env-blocked", out["escalate"] is False)
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": False,
                                                          "environment_blocked": True, "all_passed": False,
                                                          "last_verdict": {"failures": [],
                                                                           "environment_failures": ["missing Python executor"]}}})
    check("report-env-blocked", "delivered-not-verifiable" in out["stopped_reason"]
          and "Environment" in out["report"])

    # final report: reasons per state + evidence rendering
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": False, "title": "Snake Game",
                                                          "plan_feedback": "too vague\nname the files"}})
    check("report-plan-refused", "plan-not-accepted" in out["stopped_reason"])
    check("report-plan-evidence", "Snake Game" in out["report"] and "too vague" in out["report"])
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": True,
                                                          "merged": True, "all_passed": True, "branch": "b"}})
    check("report-merged", out["stopped_reason"] == "approved-and-merged" and out["success"] is True)
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": False,
                                                          "all_passed": False, "same_signature_count": 2}})
    check("report-stalled", "stalled" in out["stopped_reason"])
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": False,
                                                          "user_stopped": True, "all_passed": False}})
    check("report-user-stop", "stopped-by-reviewer" in out["stopped_reason"])
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": False,
                                                          "all_passed": False, "last_gate2": "rejected",
                                                          "review_rounds": 3, "max_review_rounds": 2,
                                                          "build_feedback": "REVIEWER CHANGE REQUESTS (gate 2):\nfaster ship"}})
    check("report-review-exhausted", "review-rounds-exhausted" in out["stopped_reason"]
          and "faster ship" in out["report"])
    # a past rejection with budget REMAINING must not claim review-exhausted
    out = run_body(ex, B["final_report"], {"loop_state": {"accepted": True, "approved": False,
                                                          "all_passed": False, "last_gate2": "rejected",
                                                          "review_rounds": 1, "max_review_rounds": 2,
                                                          "fix_cycles": 3}})
    check("report-budget-not-review", "review-rounds-exhausted" not in out["stopped_reason"])
    # preflight refusal carries a short reason token, not the whole document
    out = run_body(ex, B["pre_report"], {"failures": ["preflight: empty request"]})
    check("pre-report-token", out["reason"] == "preflight-failed" and "\n" not in out["reason"])

    # pr fields: no-remote degrade text + quote safety
    st = {"title": "Snake", "plan": {"goal": "g"}, "branch": "snake-game",
          "last_verdict": {"all_passed": True}, "warnings": ["w1"]}
    out = run_body(ex, B["pr_fields"], {"loop_state": st, "workspace_root": "/tmp/it's ws"})
    check("pr-md-path", out["pr_path"] == "PR.md")
    check("pr-remote-degrade", "NO_REMOTE_LOCAL_PR_MD_ONLY" in out["gh_call"]["arguments"]["command"])
    check("pr-quote-escape", "it'\\''s" in out["gh_call"]["arguments"]["command"])
    # credential prompts must fail fast, never hang unattended (adversary F6)
    check("pr-no-prompt-hang", "GIT_TERMINAL_PROMPT=0" in out["gh_call"]["arguments"]["command"]
          and out["gh_call"]["arguments"].get("timeout") == 120)

    # verify_input: fix_cycles rides as round_index
    out = run_body(ex, B["verify_input"], {"loop_state": {"fix_cycles": 2}, "request": "r",
                                           "workspace_root": "/w", "build_command": "",
                                           "run_command": "", "provider": "p", "model": "m"})
    check("verify-round-index", out["input"]["round_index"] == 2)

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("SMOKE OK: all scenarios passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
