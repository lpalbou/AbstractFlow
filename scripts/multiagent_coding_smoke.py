#!/usr/bin/env python3
"""Deterministic smoke tests for the multi-agent coding workflow logic.

Layers (0.0.8 boundary cleanup):
1. LIBRARY COMPILE: the emitted flow's `functions` compile through the REAL
   runtime function-library compiler (RestrictedPython, code-node policy).
2. NODE COMPILE: the five pure code-node bodies compile through the real
   code-node compiler (three multi-wire folds + the two restored
   multi-OUTPUT decisions, Final report and Doc drift check).
3. EMITTED EXPRESSIONS: every inline condition/composer call the flow ships
   is compiled and EVALUATED through the real pin-expression lane against
   representative state — the smoke tests what ships, not a copy of it.
4. LOGIC SCENARIOS: the behavioral pins carried since pre-0.0.5 (laws must
   not move when code moves between nodes, functions and expressions).
5. E2E REFUSAL: preflight refusal path through the real Runtime.
6. E2E FULL PATH: wait-mode run through the real Runtime with scripted
   agents/tools/gates — plan gate, build loop, doc-drift red cycle,
   review gate, merge. Asserts the terminal report, the branch, and the
   per-cycle progress line.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
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
from abstractruntime.visualflow_compiler.visual.pin_expressions import (  # noqa: E402
    compile_pin_expression,
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
    # ---- layer 0: shipped JSON layout + audit gate (all three family files) ----
    verify_script = Path(__file__).resolve().parent / "verify_multiagent_bundle.py"
    layout_proc = subprocess.run(
        [sys.executable, str(verify_script)],
        capture_output=True,
        text=True,
    )
    if layout_proc.returncode != 0:
        tail = (layout_proc.stdout or layout_proc.stderr or "").strip().splitlines()
        check("layout-gate", False, tail[-1] if tail else "verify_multiagent_bundle failed")
        print()
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1

    flow = json.loads((FLOWS / "multiagent-coding.json").read_text())
    by_id = {n["id"]: n for n in flow["nodes"]}
    edges = flow["edges"]

    # ---- layer 1: compile the FUNCTION LIBRARY through the real lane ----
    LIB = compile_function_library(flow.get("functions"))
    check("library-compiles", len(LIB) == len(flow.get("functions") or []),
          f"{len(LIB)}/{len(flow.get('functions') or [])}")
    # The boundary (operator ruling 2026-07-27): no function is a plain
    # variable read, and none returns a multi-field dict for per-pin
    # extraction. Multi-output folds are code NODES.
    fn_names = {f["name"] for f in flow.get("functions") or []}
    for gone in ("plan_again", "tail_check", "pr_fields", "backlog_fields",
                 "plan_accepted", "approved_and_green", "doc_drift", "final_report"):
        check(f"boundary-no-{gone}", gone not in fn_names,
              "trivial reads inline; multi-output folds are nodes")

    # ---- layer 2: compile the pure node bodies (3 folds + 2 decisions) ----
    bodies = {n["id"]: _generate_code_from_body(n["data"], "transform")
              for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
    pure_ids = sorted(bodies.keys())
    check("expected-code-nodes",
          pure_ids == ["doc_drift", "final_report", "gate1_parse", "next_state", "scout_merge"],
          f"pure code nodes: {pure_ids}")
    compiled = 0
    for nid, code in sorted(bodies.items()):
        try:
            create_code_handler(code, "transform")
            compiled += 1
        except Exception as e:  # noqa: BLE001
            check(f"compile:{nid}", False, str(e)[:200])
    check("sandbox-compile-all", compiled == len(bodies), f"{compiled}/{len(bodies)}")
    B = bodies

    # ---- layer 3: the EMITTED expressions + defaults + wires ----
    def fx(node_id: str, pin_id: str) -> str:
        return (by_id[node_id]["data"].get("pinExpressions") or {}).get(pin_id, "")

    def pd_of(node_id: str, pin_id: str):
        return (by_id[node_id]["data"].get("pinDefaults") or {}).get(pin_id)

    def evaluate(node_id: str, pin_id: str, *, value=None, state=None):
        expr = fx(node_id, pin_id)
        ev = compile_pin_expression(expr, node_label=node_id, pin_id=pin_id, library=LIB)
        return ev(value, {"state": state if state is not None else {}})

    seed_expr = fx("set_state0", "value")
    check("fx-seed-calls-mw-preflight", seed_expr == "mw_preflight(vars)", seed_expr[:80])
    mw_src = next(f["code"] for f in flow["functions"] if f["name"] == "mw_preflight")
    check("fx-seed-reads-runtime-skills",
          '(v.get("_runtime") or {}).get("skills_resolution")' in mw_src,
          "gateway-attested skills resolution must ride the seed (adversary F2)")

    # gate 1: composed prompt (expression), constant choices (pin default)
    check("gate1-prompt-composed", fx("gate1", "prompt") == "gate1_prompt(value)",
          fx("gate1", "prompt"))
    check("gate1-choices-constant", pd_of("gate1", "choices") == ["approve", "revise", "research"],
          str(pd_of("gate1", "choices")))
    check("gate1-choices-not-an-expression", fx("gate1", "choices") == "")
    # planner: composed prompt, CONSTANT schema
    check("planner-schema-constant",
          isinstance(pd_of("planner", "resp_schema"), dict)
          and pd_of("planner", "resp_schema").get("required") == ["title", "goal", "steps"],
          str(pd_of("planner", "resp_schema"))[:120])
    # PR.md path is a constant
    check("pr-path-constant", pd_of("pr_write", "file_path") == "PR.md")

    # end node: WIRED from the Final report node's four labeled pins
    end_wires = {e["targetHandle"]: (e["source"], e["sourceHandle"]) for e in edges
                 if e["target"] == "end" and e["targetHandle"] != "exec-in"}
    check("end-wired-from-final-report",
          end_wires == {"report": ("final_report", "report"),
                        "success": ("final_report", "success"),
                        "branch": ("final_report", "branch"),
                        "stopped_reason": ("final_report", "stopped_reason")},
          str(end_wires))
    check("end-has-no-expressions", not (by_id["end"]["data"].get("pinExpressions") or {}))

    # doc drift: one parse node, two labeled consequences
    dd_wires = {(e["source"], e["sourceHandle"], e["target"], e["targetHandle"])
                for e in edges if e["source"] == "doc_drift" or e["target"] == "doc_drift"}
    check("doc-drift-wiring",
          ("docguard_call", "raw", "doc_drift", "guard_text") in dd_wires
          and ("doc_drift", "ok", "if_docok", "condition") in dd_wires
          and ("doc_drift", "state", "set_state_docred", "value") in dd_wires,
          str(dd_wires))
    check("doc-drift-unwraps-envelope", fx("doc_drift", "guard_text") == "text_of(value)")

    # inline conditions: evaluate the SHIPPED text through the real lane
    check("cond-plan-loop-continues",
          evaluate("plan_while", "condition",
                   state={"accepted": False, "plan_revisions": 0, "max_plan_revisions": 3}) is True)
    check("cond-plan-loop-stops-accepted",
          evaluate("plan_while", "condition",
                   state={"accepted": True, "plan_revisions": 0, "max_plan_revisions": 3}) is False)
    check("cond-plan-loop-stops-budget",
          evaluate("plan_while", "condition",
                   state={"accepted": False, "plan_revisions": 3, "max_plan_revisions": 3}) is False)
    check("cond-scout-first-pass",
          evaluate("if_scout", "condition", state={"scout_context": ""}) is True)
    check("cond-scout-skip-on-revision",
          evaluate("if_scout", "condition",
                   state={"scout_context": "cached", "rescout": False}) is False)
    check("cond-scout-on-research",
          evaluate("if_scout", "condition",
                   state={"scout_context": "cached", "rescout": True}) is True)
    check("cond-wait-mode-g1",
          evaluate("if_g1", "condition", state={"wait_gating": True}) is True
          and evaluate("if_g1", "condition", state={"wait_gating": False}) is False)
    check("cond-wait-mode-g2",
          evaluate("if_g2", "condition", state={"wait_gating": True}) is True
          and evaluate("if_g2", "condition", state={"wait_gating": False}) is False)
    check("cond-accepted",
          evaluate("if_accepted", "condition", state={"accepted": True}) is True
          and evaluate("if_accepted", "condition", state={}) is False)
    check("cond-green",
          evaluate("if_green", "condition", state={"all_passed": True}) is True
          and evaluate("if_green", "condition", state={}) is False)
    check("cond-merge-needs-both",
          evaluate("if_approved", "condition", state={"approved": True, "all_passed": True}) is True
          and evaluate("if_approved", "condition", state={"approved": True, "all_passed": False}) is False
          and evaluate("if_approved", "condition", state={"approved": False, "all_passed": True}) is False)
    check("gate2-choices-follow-green",
          evaluate("gate2", "choices", state={"all_passed": True}) == ["approve", "request changes"]
          and evaluate("gate2", "choices", state={"all_passed": False}) == ["stop", "guide repairs"])

    # Run-start gating line (code-tui c5871): first user-visible line names
    # the mode; wired preflight-door -> gating_status -> plan loop.
    gs = by_id.get("gating_status")
    check("gating-status-node-exists", bool(gs) and gs["data"].get("nodeType") == "answer_user",
          f"gating_status: {gs and gs['data'].get('nodeType')}")
    check("gating-status-message",
          evaluate("gating_status", "message", state={"gating_mode": "wait"}) == "gating: wait"
          and evaluate("gating_status", "message", state={"gating_mode": "auto"}) == "gating: auto")
    door_to_gs = any(e["source"] == "if_preflight" and e.get("sourceHandle") == "true"
                     and e["target"] == "gating_status" for e in edges)
    gs_to_loop = any(e["source"] == "gating_status" and e["target"] == "plan_while" for e in edges)
    check("gating-status-wired-after-door", door_to_gs and gs_to_loop,
          f"door->gs={door_to_gs} gs->loop={gs_to_loop}")

    # browser_probe grant (code-tui c5871 + wave-B P2-2): the grant FOLLOWS
    # browser_probe_available — the tools pin adds the probe only when the
    # host mounts it (probe_ok), and the prompt teaches the matching protocol.
    base_tools = (by_id["builder"]["data"].get("pinDefaults") or {}).get("tools") or []
    check("builder-default-tools-probe-free", "browser_probe" not in base_tools, str(base_tools))
    tools_with = evaluate("builder", "tools", value=list(base_tools), state={"probe_ok": True})
    tools_without = evaluate("builder", "tools", value=list(base_tools), state={"probe_ok": False})
    check("builder-probe-follows-flag", "browser_probe" in tools_with
          and "browser_probe" not in tools_without
          and all(t in tools_with for t in base_tools),
          f"with={tools_with} without={tools_without}")
    for name, st_extra in (("first", {}), ("repair", {"fix_cycles": 1, "build_feedback": "delivery: x missing"})):
        p_ok = LIB["builder_prompt"]({"request": "r", "plan": {"goal": "g", "steps": []},
                                      "probe_ok": True, **st_extra})
        p_no = LIB["builder_prompt"]({"request": "r", "plan": {"goal": "g", "steps": []},
                                      "probe_ok": False, **st_extra})
        check(f"builder-prompt-probe-protocol-{name}",
              "browser_probe" in p_ok and "nonce" in p_ok and "SECONDS" in p_ok and "nonzero" in p_ok)
        check(f"builder-prompt-probe-honest-when-absent-{name}",
              "NOT available" in p_no and "browser_probe" in p_no and "nonce" in p_no)

    # Live progress line: "build cycle N of M" at the TOP of each cycle.
    cs = by_id.get("cycle_status")
    check("cycle-status-node-exists", bool(cs) and cs["data"].get("nodeType") == "answer_user",
          f"cycle_status: {cs and cs['data'].get('nodeType')}")
    check("cycle-status-message",
          evaluate("cycle_status", "message",
                   state={"fix_cycles": 0, "max_fix_cycles": 6}) == "build cycle 1 of 6"
          and evaluate("cycle_status", "message",
                       state={"fix_cycles": 2, "max_fix_cycles": 6}) == "build cycle 3 of 6")
    loop_to_cs = any(e["source"] == "build_while" and e.get("sourceHandle") == "loop"
                     and e["target"] == "cycle_status" for e in edges)
    cs_to_builder = any(e["source"] == "cycle_status" and e["target"] == "builder" for e in edges)
    check("cycle-status-wired-top-of-loop", loop_to_cs and cs_to_builder,
          f"loop->cs={loop_to_cs} cs->builder={cs_to_builder}")

    # wrapper spelling (unchanged by the cleanup)
    coder = json.loads((FLOWS / "multiagent-coder.json").read_text())
    coder_end = next(n for n in coder["nodes"] if n["id"] == "end")
    fx_keys = set(coder_end["data"].get("pinExpressions") or {})
    check("fx-wire-spelling-wrapper", fx_keys == {"response", "success"},
          f"multiagent-coder end.pinExpressions keys: {sorted(fx_keys)}")
    # wrapper probe passthrough: declared pin, default TRUE, honest override
    coder_start = next(n for n in coder["nodes"] if n["id"] == "start")
    check("wrapper-probe-pin-default-true",
          (coder_start["data"].get("pinDefaults") or {}).get("browser_probe_available") is True)
    coder_map = next(n for n in coder["nodes"] if n["id"] == "map_input")
    map_code = _generate_code_from_body(coder_map["data"], "transform")
    m1 = run_body(map_code, {"prompt": "p", "workspace_root": "/w", "gating_mode": "wait",
                             "browser_probe_available": None, "provider": None, "model": None})
    m2 = run_body(map_code, {"prompt": "p", "workspace_root": "/w", "gating_mode": "wait",
                             "browser_probe_available": False, "provider": None, "model": None})
    check("wrapper-probe-passthrough", m1["built"]["browser_probe_available"] is True
          and m2["built"]["browser_probe_available"] is False)

    # ---- layer 4: logic scenarios (behavioral pins carried across) ----
    def preflight(**vars_in):
        return LIB["mw_preflight"](vars_in)

    def seed_state(**over):
        base = preflight(request="build snake", workspace_root="/tmp/ws",
                         gating_mode="wait", provider="p", model="m")
        base.update(over)
        return base

    st = preflight(request="build snake", workspace_root="/tmp/ws", gating_mode="auto",
                   skills=["coredoc"], _runtime={"skills_resolution": {"active": []}},
                   max_fix_cycles=3, provider="p", model="m")
    check("preflight-ok", st["preflight_ok"] is True)
    check("preflight-auto", st["gating_mode"] == "auto" and st["wait_gating"] is False)
    check("preflight-skill-warn", any("skills not active" in w for w in st["warnings"]))
    check("preflight-probe-warn", any("browser_probe" in w for w in st["warnings"]))
    check("preflight-folds-config", st["request"] == "build snake"
          and st["workspace_root"] == "/tmp/ws" and st["max_fix_cycles"] == 3
          and st["provider"] == "p" and st["model"] == "m")
    st_bad = preflight(request="", workspace_root="", gating_mode="bogus", skills=[],
                       browser_probe_available=True)
    check("preflight-refuses-empty", st_bad["preflight_ok"] is False
          and len(st_bad["preflight_failures"]) == 2)
    check("preflight-bogus-gating-defaults-wait", st_bad["gating_mode"] == "wait"
          and st_bad["wait_gating"] is True)
    check("pre-report-names-failures", "empty request" in LIB["pre_report"](st_bad))
    st_def = preflight(request="r", workspace_root="/tmp/ws")
    check("preflight-default-fix-budget-6", st_def["max_fix_cycles"] == 6)
    check("preflight-seeds-empty-repair-history", st_def["repair_history"] == [])
    check("preflight-defaults-one-source", st_def["max_plan_revisions"] == 3
          and st_def["max_review_rounds"] == 2 and st_def["gating_mode"] == "wait"
          and st_def["skills_degraded"] is True)  # coredoc default, nothing active

    # gate1 parse (node): approve / revise; auto accept (library)
    st0 = {"gating_mode": "wait", "plan_revisions": 0}
    pd = {"title": "Snake Game", "goal": "g", "steps": ["a"]}
    out = run_body(B["gate1_parse"], {"response": "approve", "loop_state": st0, "planner_data": pd})
    check("gate1-approve", out["state"]["accepted"] is True and out["state"]["title"] == "Snake Game")
    out = run_body(B["gate1_parse"], {"response": "needs sound effects", "loop_state": st0, "planner_data": pd})
    check("gate1-revise", out["state"]["accepted"] is False
          and out["state"]["plan_revisions"] == 1
          and "sound" in out["state"]["plan_feedback"])
    out = run_body(B["gate1_parse"], {"response": "research: check WebAudio APIs",
                                      "loop_state": {"plan_revisions": 0}, "planner_data": {}})
    check("gate1-research-flag", out["state"]["rescout"] is True)
    s = LIB["auto_accept_plan"](st0, pd)
    check("gate1-auto-accepts", s["accepted"] is True)
    s = LIB["auto_accept_plan"]({"plan_revisions": 0}, {})
    check("gate1-auto-refuses-dead-plan", s["accepted"] is False
          and s["plan_revisions"] == 1 and "structured plan" in s["plan_feedback"])

    # gate1_prompt: single string; a dead planner ({}) still yields a
    # NON-EMPTY prompt so the wait-mode gate opens instead of failing the run.
    gp = LIB["gate1_prompt"]({"title": "Snake Game", "goal": "g", "steps": ["a", "b"]})
    check("gate1-prompt-formatted", "PLAN for your approval" in gp and "Snake Game" in gp)
    check("gate1-prompt-dead-planner-nonempty", LIB["gate1_prompt"]({}).strip() != "")

    # branch_slug: sanitization (injection-shaped title); backlog_body
    st = {"plan": {"title": "Fix; rm -rf / --EVIL name", "goal": "g", "steps": ["s1"],
                   "files": ["a.js"], "risks": []}, "title": ""}
    slug = LIB["branch_slug"](st)
    check("slug-safe", all(("a" <= c <= "z") or ("0" <= c <= "9") or c == "-" for c in slug), slug)
    check("slug-floor", LIB["branch_slug"]({}) == "task")
    body = LIB["backlog_body"]({"plan": {"title": "Snake Game", "goal": "eat apples",
                                         "steps": ["a"], "files": [], "risks": []}})
    check("backlog-body", body.startswith("# snake-game") and "eat apples" in body)
    check("backlog-path-inline",
          evaluate("backlog_write", "file_path",
                   state={"plan": {"title": "Snake Game"}}) == "docs/backlog/planned/snake-game.md")

    # git branch compose: quote-hostile workspace path; slug via branch_slug
    st = {"plan": {"title": "Snake Game", "goal": "g", "steps": ["s"]},
          "workspace_root": "/tmp/it's here"}
    cmd = LIB["compose_git_branch"](st)["arguments"]["command"]
    check("git-quote-escape", "it'\\''s" in cmd, cmd[:120])
    check("git-ceiling", "GIT_CEILING_DIRECTORIES" in cmd)
    check("git-toplevel-guard", "--show-toplevel" in cmd)
    check("git-slug-from-plan", "'snake-game'" in cmd, cmd[:200])
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
    d1 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": st})
    check("fold-verifier-death-named", any("verdict missing" in f for f in d1["state"]["last_verdict"]["failures"])
          and d1["state"]["all_passed"] is False and d1["state"]["failure_signature"] != "")
    d2 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": d1["state"]})
    d3 = run_body(B["next_state"], {"verify_verdict": {}, "verify_meta": {"success": False, "error": "child run failed"},
                                    "lint_out": [], "loop_state": d2["state"]})
    check("fold-verifier-death-latches-stall", d3["state"]["same_signature_count"] >= 2)
    m = run_body(B["next_state"], {"verify_verdict": verdict, "lint_out": [],
                                   "loop_state": seed_state(), "builder_response": "I wrote game.js using canvas polling"})
    check("repair-prompt-cites-attempt", "canvas polling" in LIB["builder_prompt"](m["state"]))

    # REPAIR HISTORY: each FAILED cycle appends {cycle, changed, failed};
    # the builder prompt shows the whole trail.
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
    # gate2_prompt: single string; the escalation names WHICH stop reason fired
    p = LIB["gate2_prompt"]({"all_passed": False, "branch": "b",
                             "last_verdict": {"failures": ["delivery: x missing"]},
                             "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-escalation", "BUILD STUCK" in p and "x missing" in p)
    p_stall = LIB["gate2_prompt"]({"all_passed": False, "branch": "b", "same_signature_count": 3,
                                   "last_verdict": {"failures": ["x"]}, "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-names-stall", "SAME failure" in p_stall)
    p_budget = LIB["gate2_prompt"]({"all_passed": False, "branch": "b", "same_signature_count": 0,
                                    "fix_cycles": 6, "max_fix_cycles": 6,
                                    "last_verdict": {"failures": ["x"]}, "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-names-budget", "fix budget" in p_budget)
    p = LIB["gate2_prompt"]({"all_passed": True, "branch": "b",
                             "review_rounds": 2, "max_review_rounds": 2})
    check("gate2-prompt-final-round-warning", "FINAL review round" in p)

    # build_again: budgets + stall + approval
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

    # tail_escalate: wait+red+exhausted/stalled only
    check("escalate-on-exhaustion", LIB["tail_escalate"]({"all_passed": False, "gating_mode": "wait",
                                                          "fix_cycles": 3, "same_signature_count": 0,
                                                          "max_fix_cycles": 3}) is True)
    check("escalate-on-stall", LIB["tail_escalate"]({"all_passed": False, "gating_mode": "wait",
                                                     "fix_cycles": 1, "same_signature_count": 3,
                                                     "max_fix_cycles": 6}) is True)
    check("no-escalate-in-auto", LIB["tail_escalate"]({"all_passed": False, "gating_mode": "auto",
                                                       "fix_cycles": 3, "same_signature_count": 0,
                                                       "max_fix_cycles": 3}) is False)
    check("no-escalate-mid-budget", LIB["tail_escalate"]({"all_passed": False, "gating_mode": "wait",
                                                          "fix_cycles": 1, "same_signature_count": 0,
                                                          "max_fix_cycles": 3}) is False)
    check("no-escalate-env-blocked", LIB["tail_escalate"]({"all_passed": False, "gating_mode": "wait",
                                                           "environment_blocked": True, "fix_cycles": 3,
                                                           "same_signature_count": 0, "max_fix_cycles": 3}) is False)
    check("no-escalate-green", LIB["tail_escalate"]({"all_passed": True, "gating_mode": "wait",
                                                     "fix_cycles": 3, "same_signature_count": 0,
                                                     "max_fix_cycles": 3}) is False)

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
    cmd = LIB["compose_merge"]({"branch": "b", "workspace_root": "/w"})["arguments"]["command"]
    check("merge-cmd-sentinel", "MERGED_OK" in cmd and "NO_MAINLINE_BRANCH" in cmd)
    # shq: ONE escape implementation shared by every command composer
    check("shq-escape", LIB["shq"]("it's") == "it'\\''s" and LIB["shq"](None) == ""
          and LIB["shq"](0) == "0")  # falsy non-None keeps its text (wave-B P2-3)
    cmd = LIB["compose_merge"]({"branch": "a'b", "workspace_root": "/tmp/it's ws"})["arguments"]["command"]
    check("shq-in-merge", "it'\\''s" in cmd and "a'\\''b" in cmd)

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

    # doc drift NODE: drift -> red with named feedback; clean/no-selfcheck -> ok
    def doc_drift(state, guard_raw):
        return run_body(B["doc_drift"], {"guard_text": LIB["text_of"](guard_raw),
                                         "loop_state": state})
    g = doc_drift({"all_passed": True},
                  {"results": [{"output": {"stdout": "DOC_DRIFT game.js\nDOC_DRIFT my file.py"}}]})
    check("docguard-drift-red", g["ok"] is False and g["state"]["all_passed"] is False
          and "game.js" in g["state"]["build_feedback"] and "my file.py" in g["state"]["build_feedback"])
    g = doc_drift({"all_passed": True}, {"results": [{"output": {"stdout": "DOC_GUARD_OK"}}]})
    check("docguard-clean-ok", g["ok"] is True and g["state"]["all_passed"] is True)
    g = doc_drift({"all_passed": True}, {"results": [{"output": {"stdout": "NO_SELFCHECK_TO_GUARD"}}]})
    check("docguard-no-selfcheck-ok", g["ok"] is True)
    cmd = LIB["compose_doc_guard"]({"workspace_root": "/w"})["arguments"]["command"]
    check("docguard-posix-no-procsub", "< <(" not in cmd)

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

    # final report NODE: reasons per state + evidence rendering
    def report(state):
        return run_body(B["final_report"], {"loop_state": state})
    out = report({"accepted": True, "approved": False,
                  "environment_blocked": True, "all_passed": False,
                  "last_verdict": {"failures": [],
                                   "environment_failures": ["missing Python executor"]}})
    check("report-env-blocked", "delivered-not-verifiable" in out["stopped_reason"]
          and "Environment" in out["report"])
    out = report({"accepted": False, "title": "Snake Game",
                  "plan_feedback": "too vague\nname the files"})
    check("report-plan-refused", "plan-not-accepted" in out["stopped_reason"])
    check("report-plan-evidence", "Snake Game" in out["report"] and "too vague" in out["report"])
    out = report({"accepted": True, "approved": True,
                  "merged": True, "all_passed": True, "branch": "b"})
    check("report-merged", out["stopped_reason"] == "approved-and-merged" and out["success"] is True)
    out = report({"accepted": True, "approved": False,
                  "all_passed": False, "same_signature_count": 3})
    check("report-stalled", "stalled" in out["stopped_reason"])
    out = report({"accepted": True, "approved": False,
                  "user_stopped": True, "all_passed": False})
    check("report-user-stop", "stopped-by-reviewer" in out["stopped_reason"])
    out = report({"accepted": True, "approved": False,
                  "all_passed": False, "last_gate2": "rejected",
                  "review_rounds": 3, "max_review_rounds": 2,
                  "build_feedback": "REVIEWER CHANGE REQUESTS (gate 2):\nfaster ship"})
    check("report-review-exhausted", "review-rounds-exhausted" in out["stopped_reason"]
          and "faster ship" in out["report"])
    out = report({"accepted": True, "approved": False,
                  "all_passed": False, "last_gate2": "rejected",
                  "review_rounds": 1, "max_review_rounds": 2, "fix_cycles": 3})
    check("report-budget-not-review", "review-rounds-exhausted" not in out["stopped_reason"])

    # pr_body + compose_pr_push: no-remote degrade text + quote safety
    st = {"title": "Snake", "plan": {"goal": "g"}, "branch": "snake-game",
          "last_verdict": {"all_passed": True}, "warnings": ["w1"],
          "workspace_root": "/tmp/it's ws"}
    body = LIB["pr_body"](st)
    check("pr-body", "# PR: Snake" in body and "snake-game" in body and "w1" in body)
    push = LIB["compose_pr_push"](st)
    check("pr-remote-degrade", "NO_REMOTE_LOCAL_PR_MD_ONLY" in push["arguments"]["command"])
    check("pr-quote-escape", "it'\\''s" in push["arguments"]["command"])
    check("pr-no-prompt-hang", "GIT_TERMINAL_PROMPT=0" in push["arguments"]["command"]
          and push["arguments"].get("timeout") == 120)

    # verify subflow input dict (inline on verify pin; fix_cycles rides as round_index)
    st = {"fix_cycles": 2, "request": "r", "workspace_root": "/w",
          "build_command": "", "run_command": "", "provider": "p", "model": "m"}
    out = eval(
        "{'request': str((st or {}).get('request') or ''), "
        "'workspace_root': str((st or {}).get('workspace_root') or ''), "
        "'build_command': str((st or {}).get('build_command') or ''), "
        "'run_command': str((st or {}).get('run_command') or ''), "
        "'round_index': int((st or {}).get('fix_cycles') or 0), "
        "'provider': (st or {}).get('provider'), "
        "'model': (st or {}).get('model')}",
        {"st": st},
    )
    check("verify-round-index", out["round_index"] == 2)
    check("verify-config-from-state", out["request"] == "r" and out["workspace_root"] == "/w"
          and out["provider"] == "p")

    # ---- layer 5: E2E preflight refusal through the real Runtime ----
    from abstractruntime import Runtime
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.core.runtime import EffectOutcome
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

    # ---- layer 6: E2E FULL PATH (wait mode, scripted agents/tools/gates).
    # Exercises: seed -> plan loop (scouts -> planner -> gate1 approve) ->
    # backlog -> git branch -> build loop cycle 1 (green verify, doc DRIFTS ->
    # red) -> cycle 2 (repair, clean doc) -> PR -> gate2 approve -> merge.
    ws = tempfile.mkdtemp(prefix="ma_smoke_ws_")
    agent_script = {
        "scout_code": {"response": "code findings: empty workspace"},
        "scout_web": {"response": "web findings: canvas API docs"},
        "planner": {"response": "planned",
                    "data": {"title": "Snake Game", "goal": "build snake",
                             "steps": ["write game.js"], "files": ["game.js"], "risks": []}},
        "builder": {"response": "built game.js with canvas"},
        "doc": {"response": "wrote README"},
    }
    tool_script: dict[str, list] = {}

    def set_tool(call_id: str, *stdouts: str) -> None:
        tool_script[call_id] = [
            {"results": [{"output": {"stdout": s}, "success": True}]} for s in stdouts
        ]

    set_tool("git-branch", "snake-game\n")
    set_tool("lint-format", "LINT_DONE\n", "LINT_DONE\n")
    set_tool("selfcheck-refresh", "REFRESHED\n", "REFRESHED\n")
    set_tool("git-commit", "COMMITTED\n", "COMMITTED\n")
    # 1st doc pass DRIFTS (exercises the Doc drift node's two consumers), 2nd clean
    set_tool("doc-guard", "DOC_DRIFT game.js\n", "DOC_GUARD_OK\n")
    set_tool("pr-create", "NO_REMOTE_LOCAL_PR_MD_ONLY\n")
    set_tool("git-merge", "Merge made by ort\nMERGED_OK main\n")
    progress_lines: list[str] = []

    def subworkflow_stub(run, effect, default_next_node):
        wf = str((effect.payload or {}).get("workflow_id") or "")
        for nid, resp in agent_script.items():
            if f"::{nid}" in wf or wf.endswith(nid):
                return EffectOutcome.completed(dict(resp))
        if "verify" in wf:
            return EffectOutcome.completed(
                {"sub_run_id": "stub", "output": {"verdict": {"all_passed": True, "failures": []}}})
        return EffectOutcome.completed({})

    def tool_calls_stub(run, effect, default_next_node):
        cid = None
        for c in (effect.payload or {}).get("tool_calls") or []:
            cid = c.get("call_id") or c.get("id")
        queue = tool_script.get(cid) or []
        res = queue.pop(0) if queue else {"results": [{"output": {"stdout": ""}, "success": True}]}
        return EffectOutcome.completed(res)

    def answer_user_stub(run, effect, default_next_node):
        progress_lines.append(str((effect.payload or {}).get("message") or ""))
        return EffectOutcome.completed({"delivered": True})

    def llm_call_stub(run, effect, default_next_node):
        # structured-output format pass for agent nodes with resp_schema
        return EffectOutcome.completed({"content": json.dumps(agent_script["planner"]["data"])})

    runtime2 = Runtime(
        run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.START_SUBWORKFLOW: subworkflow_stub,
            EffectType.TOOL_CALLS: tool_calls_stub,
            EffectType.ANSWER_USER: answer_user_stub,
            EffectType.LLM_CALL: llm_call_stub,
        },
    )
    run_id2 = runtime2.start(workflow=spec, vars={
        "request": "build a snake game", "workspace_root": ws, "gating_mode": "wait",
    })
    gate_answers = ["approve", "approve"]  # gate1 plan, gate2 merge
    final = None
    for _ in range(40):
        st_run = runtime2.tick(workflow=spec, run_id=run_id2, max_steps=300)
        if st_run.status == RunStatus.WAITING:
            if not gate_answers:
                raise RuntimeError("no scripted gate answer left")
            runtime2.resume(workflow=spec, run_id=run_id2,
                            wait_key=st_run.waiting.wait_key,
                            payload={"response": gate_answers.pop(0)}, max_steps=0)
            continue
        final = st_run
        break
    check("e2e-full-completes", final is not None and final.status == RunStatus.COMPLETED,
          f"status={final and final.status} error={final and getattr(final, 'error', None)}")
    out = (final.output or {}) if final else {}
    check("e2e-full-merged", out.get("success") is True
          and out.get("stopped_reason") == "approved-and-merged"
          and out.get("branch") == "snake-game", str(out)[:200])
    check("e2e-full-gating-line-first", progress_lines[:1] == ["gating: wait"],
          f"progress: {progress_lines}")
    check("e2e-full-doc-red-cycle-ran", [p for p in progress_lines if p.startswith("build cycle")]
          == ["build cycle 1 of 6", "build cycle 2 of 6"],
          f"progress: {progress_lines}")
    check("e2e-full-report-honest", "approved-and-merged" in str(out.get("report") or "")
          and "Merged: yes" in str(out.get("report") or ""), str(out.get("report") or "")[:200])

    # ---- layer 7: E2E AUTO MODE (zero gates). Exercises the deliberately
    # UNWIRED branches (if_g1 false -> auto-accept, if_g2 false ends the
    # iteration): the run must complete and merge without a single wait.
    set_tool("git-branch", "snake-game\n")
    set_tool("lint-format", "LINT_DONE\n")
    set_tool("selfcheck-refresh", "REFRESHED\n")
    set_tool("git-commit", "COMMITTED\n")
    set_tool("doc-guard", "DOC_GUARD_OK\n")
    set_tool("pr-create", "NO_REMOTE_LOCAL_PR_MD_ONLY\n")
    set_tool("git-merge", "Merge made by ort\nMERGED_OK main\n")
    progress_lines.clear()
    run_id3 = runtime2.start(workflow=spec, vars={
        "request": "build a snake game", "workspace_root": ws, "gating_mode": "auto",
    })
    st3 = runtime2.tick(workflow=spec, run_id=run_id3, max_steps=400)
    check("e2e-auto-completes-no-waits", st3.status == RunStatus.COMPLETED,
          f"status={st3.status} error={getattr(st3, 'error', None)}")
    out3 = st3.output or {}
    check("e2e-auto-merged", out3.get("success") is True
          and out3.get("stopped_reason") == "approved-and-merged", str(out3)[:200])
    check("e2e-auto-gating-line", progress_lines[:1] == ["gating: auto"],
          f"progress: {progress_lines}")

    # ---- layer 8: E2E AUTO-MODE STALL EXIT (correctness-adversary blind
    # spot): persistent identical failures in auto mode must exit on the
    # stall guard with an honest 'stalled' report — no gate, no merge.
    set_tool("git-branch", "snake-game\n")
    for cid in ("lint-format", "selfcheck-refresh", "git-commit"):
        set_tool(cid, *(["LINT_DONE\n" if cid == "lint-format" else "OK\n"] * 8))
    red_verdict = {"sub_run_id": "stub",
                   "output": {"verdict": {"all_passed": False,
                                          "failures": ["delivery: game.js missing - evidence x"]}}}

    def subworkflow_stub_red(run, effect, default_next_node):
        wf = str((effect.payload or {}).get("workflow_id") or "")
        for nid, resp in agent_script.items():
            if f"::{nid}" in wf or wf.endswith(nid):
                return EffectOutcome.completed(dict(resp))
        if "verify" in wf:
            return EffectOutcome.completed(dict(red_verdict))
        return EffectOutcome.completed({})

    runtime3 = Runtime(
        run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.START_SUBWORKFLOW: subworkflow_stub_red,
            EffectType.TOOL_CALLS: tool_calls_stub,
            EffectType.ANSWER_USER: answer_user_stub,
            EffectType.LLM_CALL: llm_call_stub,
        },
    )
    run_id4 = runtime3.start(workflow=spec, vars={
        "request": "build a snake game", "workspace_root": ws, "gating_mode": "auto",
    })
    st4 = runtime3.tick(workflow=spec, run_id=run_id4, max_steps=400)
    out4 = st4.output or {}
    check("e2e-auto-stall-exits", st4.status == RunStatus.COMPLETED
          and out4.get("success") is False
          and str(out4.get("stopped_reason") or "").startswith("stalled"),
          f"status={st4.status} out={str(out4)[:160]}")

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("SMOKE OK: all scenarios passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
