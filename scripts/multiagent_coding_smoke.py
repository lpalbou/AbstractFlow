#!/usr/bin/env python3
"""Deterministic smoke tests for the multi-agent coding workflow logic.

Layers (0.0.8 boundary cleanup):
1. LIBRARY COMPILE: the emitted flow's `functions` compile through the REAL
   runtime function-library compiler (RestrictedPython, code-node policy).
2. NODE COMPILE: the five code-node bodies compile through the real
   code-node compiler (three multi-wire folds + the two multi-OUTPUT
   decisions, Final report and Doc drift check). All five are on the
   EXECUTION lane (operator ruling 2026-07-30).
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
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from abstractruntime.visualflow_compiler.visual.code_executor import (  # noqa: E402
    create_code_handler,
    sandbox_helper_globals,
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

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


_HANDLERS: dict[str, object] = {}


def getter_for_pin(flow: dict, by_id: dict, node_id: str, pin_id: str):
    """(name, default) of the Get Variable chip feeding node_id.pin_id, else None."""
    for e in flow["edges"]:
        if e["target"] == node_id and e.get("targetHandle") == pin_id:
            src = by_id.get(e["source"])
            if src and src["data"].get("nodeType") == "get_var":
                pd = src["data"].get("pinDefaults") or {}
                return pd.get("name"), pd.get("default")
    return None


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
    SANDBOX = sandbox_helper_globals()
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

    # ---- layer 2: compile the code-node bodies ----
    # 0.0.14: fourteen single-use library functions became canvas nodes. Every
    # prompt/report/advisory/markdown body a human or an agent reads is now
    # composed by a node whose sentences are EDITABLE PIN DEFAULTS.
    bodies = {n["id"]: _generate_code_from_body(n["data"], "transform")
              for n in flow["nodes"] if n["data"].get("nodeType") == "code"}
    code_ids = sorted(bodies.keys())
    REQUIRED_CODE_NODES = ["backlog_body", "branch_fold", "builder_prompt", "doc_drift",
                           "doc_prompt", "final_report", "gate1_parse", "gate1_prompt",
                           "gate2_fold", "gate2_prompt", "lint_parse", "merge_fold",
                           "next_state", "plan_auto", "planner_prompt", "pr_body",
                           "preflight", "scout_merge", "scout_prompts"]
    missing_code = [n for n in REQUIRED_CODE_NODES if n not in code_ids]
    check("expected-code-nodes", not missing_code, f"missing: {missing_code} (have {code_ids})")
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

    def evaluate(node_id: str, pin_id: str, *, value=None, run_vars=None):
        """Evaluate a SHIPPED pin expression against FLAT run vars.

        The blob is gone (0.0.15): run vars are top-level names, so the test
        environment is the var map itself — `{"accepted": False, ...}` — not
        `{"state": {...}}`. Attribute access in an expression raises on a
        missing name by design, so a scenario that forgets a var fails loudly
        here instead of silently defaulting.
        """
        expr = fx(node_id, pin_id)
        ev = compile_pin_expression(expr, node_label=node_id, pin_id=pin_id, library=LIB)
        return ev(value, dict(run_vars or {}))

    def chips_of(node_id: str) -> dict:
        """{pin_id: (var_name, default)} for every Get Variable chip feeding a node.

        THE ANTI-BLOB CONTRACT, read off the shipped graph: these chips ARE the
        list of run vars the node uses. Scenarios below drive nodes through
        this map, so a wrong/missing chip fails the behavioral test too — the
        wiring and the behaviour cannot drift apart.
        """
        out = {}
        for e in edges:
            if e["target"] != node_id:
                continue
            src = by_id.get(e["source"])
            if src and src["data"].get("nodeType") == "get_var":
                pdf = src["data"].get("pinDefaults") or {}
                out[e.get("targetHandle")] = (pdf.get("name"), pdf.get("default"))
        return out

    def var_at(run_vars: dict, path: str, default):
        """`get_var` semantics: walk the dotted path, fall back to the default."""
        cur = run_vars
        for seg in str(path).split("."):
            if isinstance(cur, dict) and seg in cur:
                cur = cur[seg]
            else:
                return default
        return cur

    def defaults_of(node_id: str) -> dict:
        return dict(by_id[node_id]["data"].get("pinDefaults") or {})

    def node_out(node_id: str, **inputs):
        return run_body(B[node_id], {**defaults_of(node_id), **inputs})

    def node_from_vars(node_id: str, run_vars: dict, **wires):
        """Drive a node exactly as the runtime does: each declared Get Variable
        chip resolves against the flat run vars, wires override, shipped pin
        defaults fill the rest. Because the chips are read OFF THE SHIPPED
        GRAPH, a wrong chip fails the behavioral assertion too."""
        pins = defaults_of(node_id)
        for pin_id, (name, dflt) in chips_of(node_id).items():
            pins[pin_id] = var_at(run_vars, name, dflt)
        pins.update(wires)
        return run_body(B[node_id], pins)

    def applied(run_vars: dict, out: dict) -> dict:
        """`set_vars` semantics: write the named keys, leave the rest alone."""
        merged = dict(run_vars)
        merged.update(out.get("updates") or {})
        return merged

    def wire_into(node_id: str, pin_id: str):
        """(source_node, source_pin) of the data edge feeding node_id.pin_id."""
        for e in edges:
            if e["target"] == node_id and e.get("targetHandle") == pin_id:
                return (e["source"], e.get("sourceHandle"))
        return None

    # ---- THE ANTI-BLOB GATE (operator ruling, 0.0.15) ----------------------
    # "the state blob ... is opaque and then we never see on the visual
    # authoring which variable is actually used ... I would completely break /
    # remove the state blob." Nothing named `state` may write, read, or appear
    # in an expression anywhere in the family.
    blob_findings: list[str] = []
    for fname in ("multiagent-coding.json", "multiagent-coder.json",
                  "multiagent-verify-gates.json"):
        doc = json.loads((FLOWS / fname).read_text())
        for n in doc.get("nodes") or []:
            d = n.get("data") or {}
            if d.get("nodeType") in ("set_var", "get_var"):
                nm = str((d.get("pinDefaults") or {}).get("name") or "")
                if nm == "state" or nm.startswith("state."):
                    blob_findings.append(f"{fname}:{n['id']} {d['nodeType']} name={nm!r}")
            for pin_id, expr in (d.get("pinExpressions") or {}).items():
                t = str(expr)
                if "vars.state" in t or 'vars["state"]' in t or "vars['state']" in t:
                    blob_findings.append(f"{fname}:{n['id']}.{pin_id} = {t[:70]}")
        for entry in doc.get("functions") or []:
            if "vars.state" in str(entry.get("code") or ""):
                blob_findings.append(f"{fname}:function {entry.get('name')}")
    check("no-state-blob-anywhere", not blob_findings, str(blob_findings[:5]))
    # On the coding root every write is a MULTI-variable fold, so `set_vars` is
    # the only legal writer: a lone `set_var` is a container waiting to happen.
    root_set_vars = [n["id"] for n in flow["nodes"] if n["data"].get("nodeType") == "set_var"]
    check("root-writes-are-set_vars", not root_set_vars, str(root_set_vars))
    # 0.0.18: ten writers — the greenfield fast-path added `set_green`.
    check("root-has-ten-set_vars-writers",
          len([n for n in flow["nodes"] if n["data"].get("nodeType") == "set_vars"]) == 10,
          str([n["id"] for n in flow["nodes"] if n["data"].get("nodeType") == "set_vars"]))

    # PREFLIGHT is the door AND the only place run vars are born. 0.0.15: it no
    # longer COPIES CONFIG into a container — only the five inputs it inspects
    # cross as wires; the other seven start pins are already run vars and are
    # read where they are used.
    check("seed-wired-from-preflight-node",
          wire_into("seed_vars", "updates") == ("preflight", "updates"),
          str(wire_into("seed_vars", "updates")))
    check("seed-has-no-expression", fx("seed_vars", "updates") == "")
    check("seed-is-a-set_vars-node",
          by_id["seed_vars"]["data"].get("nodeType") == "set_vars",
          str(by_id["seed_vars"]["data"].get("nodeType")))
    # The seed's `updates` pin DEFAULT carries the whole run-var inventory, so
    # the vocabulary is visible/editable on one node (and collectDeclaredVarNames
    # picks the names up) — and it is fail-closed if the wire ever went missing.
    seed_default = pd_of("seed_vars", "updates")
    check("seed-default-is-the-var-inventory",
          isinstance(seed_default, dict) and len(seed_default) >= 25
          and seed_default.get("preflight_ok") is False,
          f"{type(seed_default).__name__} n={len(seed_default or {})}")
    # The two halves of the run-var inventory, read off the SHIPPED graph:
    # config lives on the start pins (defaults included), progress/posture is
    # what the seed writes. Nothing is in both halves — that is the property
    # the blob destroyed.
    START_DEFAULTS = dict(pd_of("start", "gating_mode") is not None and
                          (by_id["start"]["data"].get("pinDefaults") or {}) or {})
    START_SEED_NAMES = sorted(seed_default or {})
    # The two halves are disjoint EXCEPT `gating_mode`, which the door
    # deliberately normalizes and writes back so every downstream reader sees
    # exactly "wait" or "auto" (one source of truth for the enum).
    # Config lives on the start pins; progress/posture is what the seed writes.
    # The overlap is EXACTLY the four values the door normalizes/types and
    # writes back — the gating enum plus the three budgets the loop laws read
    # by name in a pure expression (a start pin the caller omits never reaches
    # run.vars, measured, so a name-read would raise).
    overlap = sorted(set(START_DEFAULTS) & set(START_SEED_NAMES))
    check("config-and-progress-overlap-is-the-typed-budgets",
          overlap == ["max_fix_cycles", "max_plan_revisions", "max_review_rounds"],
          str(overlap))
    door_inputs = ("request", "workspace_root", "gating_mode", "skills",
                   "browser_probe_available")
    unwired = [p for p in door_inputs if wire_into("preflight", p) != ("start", p)]
    check("preflight-door-inputs-are-wires", not unwired,
          f"not wired from start: {unwired}")
    pf_pins = {q["id"] for q in by_id["preflight"]["data"]["inputs"]}
    copied = [p for p in ("build_command", "run_command", "provider", "model")
              if p in pf_pins]
    check("preflight-does-not-copy-config", not copied,
          f"config still folded into the seed: {copied}")
    # The three budgets DO cross: they are the only config a pure expression
    # reads by NAME, and a start pin the caller omits never reaches run.vars.
    typed = [p for p in ("max_plan_revisions", "max_fix_cycles", "max_review_rounds")
             if p in pf_pins]
    check("preflight-types-the-three-budgets", len(typed) == 3, str(typed))
    check("preflight-reads-runtime-skills-via-getter",
          getter_for_pin(flow, by_id, "preflight", "skills_resolution")
          == ("_runtime.skills_resolution", {}),
          str(getter_for_pin(flow, by_id, "preflight", "skills_resolution")))
    check("preflight-refusal-report-is-a-wire",
          wire_into("end_pre", "report") == ("preflight", "report")
          and fx("end_pre", "report") == "",
          str(wire_into("end_pre", "report")))

    # gate 1: prompt composed BY A NODE, constant choices (pin default)
    check("gate1-prompt-composed",
          wire_into("gate1", "prompt") == ("gate1_prompt", "prompt")
          and fx("gate1", "prompt") == "",
          str(wire_into("gate1", "prompt")))
    check("gate1-prompt-reads-planner-data",
          wire_into("gate1_prompt", "planner_data") == ("planner", "data"))
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
                        # `merged_ok`, not `success`: final_report is on the
                        # EXEC lane now, and the executor overwrites a code
                        # node's `success` output key with its own handler
                        # flag (True unless the body raised). A pin named
                        # `success` here reported every refusal as a success.
                        "success": ("final_report", "merged_ok"),
                        "branch": ("final_report", "branch"),
                        "stopped_reason": ("final_report", "stopped_reason"),
                        # coding.v1 `passed` (backlog 0890): the run var
                        # all_passed, through the chip the final report reads.
                        "passed": ("final_report_all_passed", "value")},
          str(end_wires))
    # Doctrine gate: no exec-lane code node may declare an output pin whose
    # name the executor's own output record owns. wf_common refuses this at
    # build time; this pins it at the artifact level too.
    reserved = {"success", "output", "result", "error", "execution"}
    exec_code_clashes = [
        f"{n['id']}.{p['id']}" for n in flow["nodes"]
        if n["data"].get("nodeType") == "code"
        and "exec-in" in {q["id"] for q in (n["data"].get("inputs") or [])}
        for p in (n["data"].get("outputs") or [])
        if p["id"] in reserved and p["type"] != "execution"
    ]
    check("exec-code-nodes-avoid-reserved-output-pins", not exec_code_clashes,
          str(exec_code_clashes))
    # Operator ruling 2026-07-30: a code node has execution pins, otherwise it
    # is a pure function or a variable access.
    execless_code = [n["id"] for n in flow["nodes"]
                     if n["data"].get("nodeType") == "code"
                     and "exec-in" not in {q["id"] for q in (n["data"].get("inputs") or [])}]
    check("code-nodes-are-on-the-exec-lane", not execless_code, str(execless_code))
    check("end-has-no-expressions", not (by_id["end"]["data"].get("pinExpressions") or {}))

    # doc drift: one parse node, two labeled consequences
    dd_wires = {(e["source"], e["sourceHandle"], e["target"], e["targetHandle"])
                for e in edges if e["source"] == "doc_drift" or e["target"] == "doc_drift"}
    check("doc-drift-wiring",
          ("docguard_call", "raw", "doc_drift", "guard_text") in dd_wires
          and ("doc_drift", "ok", "if_docok", "condition") in dd_wires
          and ("doc_drift", "updates", "set_doc_red", "updates") in dd_wires,
          str(dd_wires))
    check("doc-drift-unwraps-envelope", fx("doc_drift", "guard_text") == "text_of(value)")

    # inline conditions: evaluate the SHIPPED text through the real lane
    check("cond-plan-loop-continues",
          evaluate("plan_while", "condition",
                   run_vars={"accepted": False, "plan_revisions": 0, "max_plan_revisions": 3}) is True)
    check("cond-plan-loop-stops-accepted",
          evaluate("plan_while", "condition",
                   run_vars={"accepted": True, "plan_revisions": 0, "max_plan_revisions": 3}) is False)
    check("cond-plan-loop-stops-budget",
          evaluate("plan_while", "condition",
                   run_vars={"accepted": False, "plan_revisions": 3, "max_plan_revisions": 3}) is False)
    check("cond-scout-first-pass",
          evaluate("if_scout", "condition",
                   run_vars={"scout_context": "", "rescout": False}) is True)
    check("cond-scout-skip-on-revision",
          evaluate("if_scout", "condition",
                   run_vars={"scout_context": "cached", "rescout": False}) is False)
    check("cond-scout-on-research",
          evaluate("if_scout", "condition",
                   run_vars={"scout_context": "cached", "rescout": True}) is True)
    # Every loop/branch law NAMES the variables it weighs — that is the whole
    # point of the flat migration. A missing name would raise here.
    check("cond-build-loop-names-its-vars",
          evaluate("build_while", "condition", run_vars={
              "approved": False, "user_stopped": False, "environment_blocked": False,
              "same_signature_count": 0, "fix_cycles": 0, "max_fix_cycles": 6,
              "review_rounds": 0, "max_review_rounds": 2}) is True)
    check("cond-build-loop-stops-approved",
          evaluate("build_while", "condition", run_vars={
              "approved": True, "user_stopped": False, "environment_blocked": False,
              "same_signature_count": 0, "fix_cycles": 0, "max_fix_cycles": 6,
              "review_rounds": 0, "max_review_rounds": 2}) is False)
    check("cond-escalate-names-its-vars",
          evaluate("if_escalate", "condition", run_vars={
              "wait_gating": True, "all_passed": False, "environment_blocked": False,
              "same_signature_count": 0, "fix_cycles": 3, "max_fix_cycles": 3}) is True)
    check("cond-escalate-not-in-auto",
          evaluate("if_escalate", "condition", run_vars={
              "wait_gating": False, "all_passed": False, "environment_blocked": False,
              "same_signature_count": 0, "fix_cycles": 3, "max_fix_cycles": 3}) is False)
    # The plain-read conditions are GET VARIABLE NODES now, not expressions
    # (operator ruling 2026-07-30: a single variable access is never a pure
    # function or an expression). Assert the wiring and the getter's config —
    # `get_var` walks the dotted path and returns `default` when any segment is
    # missing, which is exactly `state.get(key, default)`. The behaviour of the
    # wired form is covered end to end by the e2e-full-* / e2e-auto-* scenarios.
    def getter_for(node_id: str, pin_id: str):
        return getter_for_pin(flow, by_id, node_id, pin_id)

    def check_read_pin(name: str, node_id: str, pin_id: str, var_name: str, default):
        got = getter_for(node_id, pin_id)
        check(name, got == (var_name, default),
              f"{node_id}.{pin_id} <- {got!r}, expected {(var_name, default)!r}")
        check(f"{name}-not-an-expression", fx(node_id, pin_id) == "",
              f"{node_id}.{pin_id} still carries an expression")

    # wait_gating defaults TRUE: a missing key must keep the human gates SHOWN.
    # This is the fail-dangerous case the `default` pin exists for — without it
    # the getter yields None (falsy) and both approval gates silently vanish.
    check_read_pin("cond-wait-mode-g1", "if_g1", "condition", "wait_gating", True)
    check_read_pin("cond-wait-mode-g2", "if_g2", "condition", "wait_gating", True)
    check_read_pin("cond-accepted", "if_accepted", "condition", "accepted", False)
    check_read_pin("cond-green", "if_green", "condition", "all_passed", False)
    check_read_pin("cond-preflight", "if_preflight", "condition", "preflight_ok", False)
    # Every agent reads provider/model from its own local chip, never from a pin
    # expression — the reads are visible wiring on the canvas.
    for agent_id in ("scout_code", "scout_web", "planner", "builder", "doc"):
        for cfg in ("provider", "model"):
            check_read_pin(f"agent-{agent_id}-{cfg}", agent_id, cfg, cfg, None)
    # THE CANVAS ANSWERS "WHICH VARIABLE DOES THIS NODE USE". Every fold and
    # composer now reads NAMED run vars through per-variable Get Variable chips
    # — no node takes a `loop_state` container, and three of them read nothing
    # at all. This table is the shipped answer, asserted exactly.
    EXPECTED_CHIPS = {
        "scout_prompts": {"request": ("request", ""),
                          "plan_feedback": ("plan_feedback", "")},
        "scout_merge": {},
        "planner_prompt": {"request": ("request", ""),
                           "scout_context": ("scout_context", ""),
                           "plan_feedback": ("plan_feedback", "")},
        "gate1_parse": {"plan_revisions": ("plan_revisions", 0)},
        "plan_auto": {"plan_revisions": ("plan_revisions", 0)},
        "backlog_body": {"plan_goal": ("plan.goal", ""), "plan_steps": ("plan.steps", []),
                         "plan_files": ("plan.files", []), "plan_risks": ("plan.risks", [])},
        "branch_fold": {},
        "doc_drift": {},
        "builder_prompt": {"request": ("request", ""), "plan_goal": ("plan.goal", ""),
                           "plan_steps": ("plan.steps", []),
                           "build_feedback": ("build_feedback", ""),
                           "fix_cycles": ("fix_cycles", 0),
                           "repair_history": ("repair_history", []),
                           "probe_ok": ("probe_ok", False)},
        "next_state": {"failure_signature": ("failure_signature", ""),
                       "same_signature_count": ("same_signature_count", 0),
                       "fix_cycles": ("fix_cycles", 0),
                       "repair_history": ("repair_history", []),
                       "wait_gating": ("wait_gating", True)},
        "doc_prompt": {"plan_goal": ("plan.goal", ""), "request": ("request", ""),
                       "skills_degraded": ("skills_degraded", False)},
        "pr_body": {"title": ("title", ""), "branch": ("branch", ""),
                    "plan_goal": ("plan.goal", ""), "all_passed": ("all_passed", False),
                    "warnings": ("warnings", [])},
        "gate2_prompt": {"branch": ("branch", "work"), "all_passed": ("all_passed", False),
                         "failures": ("last_verdict.failures", []),
                         "warnings": ("warnings", []),
                         "review_rounds": ("review_rounds", 0),
                         "max_review_rounds": ("max_review_rounds", 2),
                         "same_signature_count": ("same_signature_count", 0),
                         "fix_cycles": ("fix_cycles", 0),
                         "max_fix_cycles": ("max_fix_cycles", 6)},
        "gate2_fold": {"all_passed": ("all_passed", False),
                       "review_rounds": ("review_rounds", 0)},
        "merge_fold": {"approved": ("approved", False), "warnings": ("warnings", [])},
        "final_report": {"accepted": ("accepted", False), "approved": ("approved", False),
                         "merged": ("merged", False), "all_passed": ("all_passed", False),
                         "user_stopped": ("user_stopped", False),
                         "environment_blocked": ("environment_blocked", False),
                         "last_gate2": ("last_gate2", ""), "branch": ("branch", ""),
                         "title": ("title", ""), "plan_feedback": ("plan_feedback", ""),
                         "build_feedback": ("build_feedback", ""),
                         "warnings": ("warnings", []),
                         "failures": ("last_verdict.failures", []),
                         "env_failures": ("last_verdict.environment_failures", []),
                         "plan_revisions": ("plan_revisions", 0),
                         "fix_cycles": ("fix_cycles", 0),
                         "review_rounds": ("review_rounds", 0),
                         "max_review_rounds": ("max_review_rounds", 2),
                         "same_signature_count": ("same_signature_count", 0),
                         "greenfield": ("greenfield", False)},
        # 0.0.16: the chips wire STRAIGHT INTO the subflow node's declared
        # per-field input pins — no `make_object` between them any more.
        "verify": {"request": ("request", ""),
                   "workspace_root": ("workspace_root", ""),
                   "build_command": ("build_command", ""),
                   "run_command": ("run_command", ""),
                   "round_index": ("fix_cycles", 0),
                   "provider": ("provider", None), "model": ("model", None)},
    }
    for node_id, expected in EXPECTED_CHIPS.items():
        check(f"chips-{node_id}", chips_of(node_id) == expected,
              f"{node_id} chips {chips_of(node_id)!r} != {expected!r}")
    no_loop_state = [n["id"] for n in flow["nodes"]
                     if "loop_state" in {q["id"] for q in (n["data"].get("inputs") or [])}]
    check("no-node-takes-a-loop-state-container", not no_loop_state, str(no_loop_state))
    # THE PERMANENT PINS-NOT-BLOBS GATE (operator ruling 2026-07-30): no
    # subflow node in the family may carry a one-object `input` pin when its
    # child's interface is known. Each declared input pin must (a) name a real
    # on_flow_start field of the child, and (b) be WIRED — a declared pin that
    # nothing feeds is either dead ink or, worse, a None that would shadow the
    # child's own start-pin default.
    family_flows = {"multiagent-coding": flow}
    for _fid in ("multiagent-coder", "multiagent-verify-gates"):
        family_flows[_fid] = json.loads((FLOWS / f"{_fid}.json").read_text())
    child_input_pins = {
        fid: [p["id"] for p in next(n for n in f["nodes"] if n["type"] == "on_flow_start")
              ["data"].get("outputs", []) if p["type"] != "execution"]
        for fid, f in family_flows.items()
    }
    blob_calls, unknown_pins, unwired_pins = [], [], []
    for fid, f in family_flows.items():
        wired = {(e["target"], e.get("targetHandle")) for e in f["edges"]}
        for n in f["nodes"]:
            if n["data"].get("nodeType") != "subflow":
                continue
            child = str(n["data"].get("subflowId") or "")
            known = child_input_pins.get(child)
            declared = [p["id"] for p in n["data"].get("inputs", [])
                        if p["type"] != "execution" and p["id"] != "inherit_context"]
            if known is None:
                continue  # child outside the family: contract not knowable here
            if "input" in declared:
                blob_calls.append(f"{fid}:{n['id']} -> {child} still takes one `input` object")
            unknown_pins += [f"{fid}:{n['id']}.{p}" for p in declared if p not in known]
            unwired_pins += [f"{fid}:{n['id']}.{p}" for p in declared
                             if (n["id"], p) not in wired]
    check("no-subflow-call-hides-its-contract-in-one-object", not blob_calls, str(blob_calls))
    check("every-declared-subflow-pin-names-a-real-child-field", not unknown_pins,
          str(unknown_pins))
    check("every-declared-subflow-pin-is-wired", not unwired_pins, str(unwired_pins))
    # And the meta nodes that used to build those objects are GONE.
    check("no-make_object-meta-node-feeds-a-subflow",
          not [n["id"] for f in family_flows.values() for n in f["nodes"]
               if n["data"].get("nodeType") == "make_object"],
          "a make_object survived the pins-not-blobs pass")
    check("verify-chips-wire-straight-into-the-subflow",
          wire_into("verify", "request") == ("verify_request", "value")
          and wire_into("verify", "round_index") == ("verify_round_index", "value")
          and fx("verify", "request") == "",
          str(wire_into("verify", "request")))
    # Doctrine gate: no expression anywhere may be a bare variable read.
    trivial = [f"{n['id']}.{p}"
               for n in flow["nodes"]
               for p, e in ((n["data"].get("pinExpressions") or {}).items())
               if re.match(r'^\s*vars(\.[A-Za-z_]\w*)+(\s*\.\s*get\([^()]*\))?\s*$', e)]
    check("no-trivial-read-expressions", not trivial, f"still expressions: {trivial}")

    # ---- doctrine gate: NO ACCESS EXPRESSION anywhere in the family --------
    # Operator ruling 2026-07-30: a plain variable read is a Get Variable node,
    # and a field read off a wire is a declared pin upstream — never invisible
    # text on a pin. Enforced with the AUDITOR'S OWN predicates over all three
    # shipped files, so the gate cannot drift away from `--policy` P1/P2.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import audit_flow_graph as AUDIT  # noqa: E402

    # AUDITOR GAP, closed here: `TRIVIAL_VAR_READ` matches the ATTRIBUTE form
    # (`vars.state.get("x")`) but not the METHOD form
    # (`(vars.get("vg") or {}).get("verdict", {})`) — which is how the tier-1
    # `var_expr()` helper spelled a collapsed Get Variable node. That is the
    # same defect wearing different syntax, so this gate matches both. (The
    # auditor's own P1 pattern should grow the method form too; not edited here
    # because audit_flow_graph.py is under concurrent change.)
    METHOD_FORM_VAR_READ = re.compile(
        r'^\s*\(?\s*vars\s*\.\s*get\(\s*["\'][^"\']+["\']\s*(,[^()]*)?\)'
        r'(\s*or\s*(\{\}|\[\]|""|None)\s*\))?'
        r'(\s*\.\s*get\(\s*["\'][^"\']+["\']\s*(,[^()]*)?\)|\s*or\s*\{\}\s*\))*\s*$')
    access_findings: list[str] = []
    for fname in ("multiagent-coding.json", "multiagent-coder.json",
                  "multiagent-verify-gates.json"):
        doc = json.loads((FLOWS / fname).read_text())
        for n in doc.get("nodes") or []:
            for pin_id, expr in AUDIT.pin_expressions(n).items():
                if AUDIT.TRIVIAL_VAR_READ.match(expr) or METHOD_FORM_VAR_READ.match(expr):
                    access_findings.append(f"P1 {fname}:{n['id']}.{pin_id} = {expr}")
                elif AUDIT.TRIVIAL_FIELD_EXTRACT.match(expr):
                    access_findings.append(f"P2 {fname}:{n['id']}.{pin_id} = {expr}")
    check("no-access-expressions-in-the-family", not access_findings,
          f"{len(access_findings)}: {access_findings[:4]}")
    # The mounted verify copy is a PURE RENAME of the coding-agent bundle's
    # coding-verify-gates: id + name only, nothing transformed. A prior wave
    # deleted its `read_verdict` Get Variable node in the copy and replaced it
    # with a `vars.get("vg")...` pin expression — the exact ACCESS form the
    # operator ruled out, invisible to P1's attribute-only pattern.
    src_gates = json.loads((FLOWS / "coding-verify-gates.json").read_text())
    copy_gates = json.loads((FLOWS / "multiagent-verify-gates.json").read_text())
    diff_keys = sorted(k for k in set(src_gates) | set(copy_gates)
                       if src_gates.get(k) != copy_gates.get(k))
    check("verify-copy-is-a-pure-rename", diff_keys == ["id", "name"], str(diff_keys))
    copy_getter = getter_for_pin(copy_gates, {n["id"]: n for n in copy_gates["nodes"]},
                                 "end", "verdict")
    check("verify-copy-keeps-the-verdict-getter-node", copy_getter == ("vg.verdict", {}),
          str(copy_getter))

    # ---- doctrine gate: PROSE LIVES IN EDITABLE PIN DEFAULTS ---------------
    # "system and prompt texts should be very easily editable directly by users
    # and agents" — every sentence a human or an agent reads is a pin default
    # on a canvas node, never a Python string in the function library.
    PROSE_PINS = {
        "preflight": ("skills_missing_text", "probe_absent_text", "empty_request_text",
                      "no_workspace_text", "refusal_header_text"),
        "scout_prompts": ("code_brief_text", "web_brief_text", "feedback_text"),
        "planner_prompt": ("brief_text", "feedback_text"),
        "gate1_prompt": ("head_text", "untitled_text", "footer_text"),
        "plan_auto": ("no_plan_text",),
        "backlog_body": ("template_text", "empty_goal_text", "no_items_text"),
        "doc_prompt": ("brief_text", "degraded_text"),
        "pr_body": ("template_text", "gates_green_text", "gates_red_text", "advisory_text"),
        "gate2_fold": ("change_request_text", "no_comment_text"),
        "merge_fold": ("conflict_text", "no_mainline_text", "no_confirm_text"),
        "builder_prompt": ("first_build_text", "repair_text",
                           "probe_available_text", "probe_absent_text"),
        "gate2_prompt": ("green_text", "green_footer_text", "stalled_text",
                         "budget_text", "red_footer_text", "final_round_text"),
    }
    missing_prose = [
        f"{nid}.{p}" for nid, pins in PROSE_PINS.items() for p in pins
        if not (isinstance(pd_of(nid, p), str) and pd_of(nid, p).strip())
    ]
    check("prose-lives-in-editable-pin-defaults", not missing_prose, str(missing_prose))

    # ---- doctrine gate: EVERY AGENT CARRIES A ROLE CHARTER ON `system` -----
    # Operator observation 2026-07-30: "i am surprised to see agents without
    # system prompt". All five agents had an UNSET `system` pin and every scrap
    # of role framing lived in `prompt`, mixed with the per-iteration task.
    # `system` rides `_runtime.system_prompt_extra` into the provider prompt
    # PREFIX (compiler `_create_visual_agent_effect_handler` -> abstractagent
    # `PROMPT_SLOTS`), so it must be (a) present, (b) a plain editable pin
    # default, and (c) CONSTANT — a prefix that varies per iteration defeats
    # prompt caching, which is why no {{slot}} and no pin expression is allowed.
    AGENTS = ("scout_code", "scout_web", "planner", "builder", "doc")
    no_charter = [a for a in AGENTS
                  if not (isinstance(pd_of(a, "system"), str) and pd_of(a, "system").strip())]
    check("every-agent-has-a-system-charter", not no_charter, str(no_charter))
    varying = [
        a for a in AGENTS
        if "{{" in str(pd_of(a, "system") or "")
        or "system" in ((by_id.get(a, {}).get("data", {}) or {}).get("pinExpressions") or {})
    ]
    check("agent-system-charter-is-constant", not varying, f"per-iteration system: {varying}")

    # The split moved text between messages; it must not have DROPPED a rule.
    # Composed corpus per agent = its `system` charter + every prompt-template
    # pin that can reach its `prompt`. Each named rule the old single-blob
    # prompt carried must still appear somewhere in that corpus.
    AGENT_CORPUS = {
        "scout_code": (("scout_code", "system"), ("scout_prompts", "code_brief_text")),
        "scout_web": (("scout_web", "system"), ("scout_prompts", "web_brief_text")),
        "planner": (("planner", "system"), ("planner_prompt", "brief_text")),
        "builder": (("builder", "system"), ("builder_prompt", "first_build_text"),
                    ("builder_prompt", "repair_text"),
                    ("builder_prompt", "probe_available_text"),
                    ("builder_prompt", "probe_absent_text")),
        "doc": (("doc", "system"), ("doc_prompt", "brief_text")),
    }
    CHARTER_RULES = {
        "scout_code": ("CODE+DOCS", "do not use the internet", "source path"),
        "scout_web": ("INTERNET", "only the internet", "source URL", "blogspam"),
        # the planner's JSON contract, which its resp_schema enforces downstream
        "planner": ("PLANNER", "not write code", "at most 3 words", "branch-name friendly",
                    "steps", "files", "risks", "JSON"),
        # the probe protocol + the SELFCHECK/ARTIFACT-SHA256 discipline that
        # gate G5 re-hashes, + repair-mode framing
        "builder": ("BUILDER", "bound every loop", "header comment", "self-probe",
                    "SELFCHECK.md", "ARTIFACT-SHA256", "shasum -a 256", "REPAIR",
                    "smallest change", "browser_probe", "nonce", "nonzero"),
        "doc": ("DOCUMENTER", "do not modify any source", "README.md", "docs/",
                "read the source", "never invent"),
    }
    lost_rules = []
    for agent, pins in AGENT_CORPUS.items():
        corpus = " ".join(str(pd_of(n, p) or "") for n, p in pins).replace("\n", " ").lower()
        for rule in CHARTER_RULES[agent]:
            if rule.lower() not in corpus:
                lost_rules.append(f"{agent}:{rule!r}")
    check("charter-split-preserves-every-rule", not lost_rules, str(lost_rules))
    # ...and no surviving library function composes reader-facing prose: what
    # is left is parse/format/transform helpers, loop laws, and shell commands.
    ALLOWED_FUNCTIONS = {"branch_slug", "build_again", "tail_escalate",
                         # the seven shell composers are code NODES now (sibling
                         # wave); tolerated here while that wave lands
                         "compose_git_branch", "compose_lint", "compose_selfcheck_refresh",
                         "compose_commit", "compose_doc_guard", "compose_pr_push",
                         "compose_merge"}
    check("library-is-helpers-only",
          fn_names <= ALLOWED_FUNCTIONS
          and {"branch_slug", "build_again", "tail_escalate"} <= fn_names,
          f"functions: {sorted(fn_names)}")
    # text_of / shq are RUNTIME SANDBOX BUILTINS now: the library compiler
    # refuses a flow function that shadows one, and the call sites resolve to
    # the runtime's copies.
    check("envelope-and-escape-helpers-are-runtime-builtins",
          "text_of" not in fn_names and "shq" not in fn_names
          and "text_of" in SANDBOX and "shq" in SANDBOX,
          f"functions: {sorted(fn_names)}")
    # The three genuinely-reused helpers must stay reused: a helper that drops
    # to one call site is one-off logic wearing a library badge.
    # Expressions + library functions + CODE-NODE BODIES: `shq` moved into the
    # shell-composer nodes when they left the library, so a call-site count that
    # only reads expressions would report zero.
    all_expr_text = "\n".join(
        e for n in flow["nodes"] for e in (n["data"].get("pinExpressions") or {}).values()
    ) + "\n" + "\n".join(str(f.get("code") or "") for f in flow.get("functions") or []) \
        + "\n" + "\n".join(str(n["data"].get("codeBody") or "") for n in flow["nodes"])
    # branch_slug is the one genuinely-reused FLOW helper left; a helper that
    # drops to one call site is one-off logic wearing a library badge.
    slug_sites = len(re.findall(r"\bbranch_slug\s*\(", all_expr_text)) - 1  # minus its own def
    check("helper-branch_slug-still-reused", slug_sites >= 4, f"{slug_sites} call sites")
    for builtin, minimum in (("text_of", 4), ("shq", 7)):
        sites = len(re.findall(r"\b" + builtin + r"\s*\(", all_expr_text))
        check(f"builtin-{builtin}-still-reused", sites >= minimum, f"{sites} call sites")
    check("cond-merge-needs-both",
          evaluate("if_approved", "condition", run_vars={"approved": True, "all_passed": True}) is True
          and evaluate("if_approved", "condition", run_vars={"approved": True, "all_passed": False}) is False
          and evaluate("if_approved", "condition", run_vars={"approved": False, "all_passed": True}) is False)
    check("gate2-choices-are-a-wire",
          wire_into("gate2", "choices") == ("gate2_prompt", "choices")
          and fx("gate2", "choices") == "",
          str(wire_into("gate2", "choices")))

    # Run-start gating line (code-tui c5871): first user-visible line names
    # the mode; wired preflight-door -> gating_status -> plan loop.
    gs = by_id.get("gating_status")
    check("gating-status-node-exists", bool(gs) and gs["data"].get("nodeType") == "answer_user",
          f"gating_status: {gs and gs['data'].get('nodeType')}")
    # SMELL 1 (operator: "why don't you use a variable enum and do a switch on
    # gating_mode instead of again, a pure function?"). The switch is REFUSED
    # (exec-lane fork + one Answer User per case + a duplicated prefix, and it
    # fails OPEN on an unenumerated value); what the ask is right about — two
    # cases a human can read and edit — is delivered by the flow's own
    # prose-composer shape. No expression on either node; the two words and the
    # sentence are pin defaults; the read is a named chip.
    gl_data = (by_id.get("gating_line") or {}).get("data") or {}
    check("gating-line-is-a-wire-not-an-expression",
          wire_into("gating_status", "message") == ("gating_line", "message")
          and fx("gating_status", "message") == ""
          and not (gl_data.get("pinExpressions") or {}),
          str(wire_into("gating_status", "message")))
    gl_defaults = gl_data.get("pinDefaults") or {}
    check("gating-line-words-are-editable-pin-defaults",
          gl_defaults.get("line_text") == "gating: {{mode}}"
          and gl_defaults.get("wait_word") == "wait"
          and gl_defaults.get("auto_word") == "auto"
          and getter_for_pin(flow, by_id, "gating_line", "wait_gating") == ("wait_gating", True),
          f"{gl_defaults} / {getter_for_pin(flow, by_id, 'gating_line', 'wait_gating')}")
    # ... and it still renders both cases, driven through the SHIPPED chips.
    check("gating-line-renders-both-cases",
          node_from_vars("gating_line", {"wait_gating": True})["message"] == "gating: wait"
          and node_from_vars("gating_line", {"wait_gating": False})["message"] == "gating: auto")
    # Same treatment, same reasons, for the build-cycle line — N is 1-based for
    # the reader while `fix_cycles` counts completed cycles.
    check("cycle-line-is-a-wire-not-an-expression",
          wire_into("cycle_status", "message") == ("cycle_line", "message")
          and fx("cycle_status", "message") == "",
          str(wire_into("cycle_status", "message")))
    check("cycle-line-renders-1-based",
          node_out("cycle_line", fix_cycles=0, max_fix_cycles=6)["message"] == "build cycle 1 of 6"
          and node_out("cycle_line", fix_cycles=2, max_fix_cycles=3)["message"] == "build cycle 3 of 3")
    door_to_line = any(e["source"] == "if_preflight" and e.get("sourceHandle") == "true"
                       and e["target"] == "gating_line" for e in edges)
    line_to_gs = any(e["source"] == "gating_line" and e["target"] == "gating_status"
                     for e in edges)
    # 0.0.18: the greenfield probe sits between the gating line and the plan
    # loop — gating_status feeds the probe composer, and the probe's own
    # status line feeds plan_while.
    gs_to_probe = any(e["source"] == "gating_status" and e["target"] == "green_cmd"
                      for e in edges)
    probe_to_loop = any(e["source"] == "green_status" and e["target"] == "plan_while"
                        for e in edges)
    check("gating-status-wired-after-door",
          door_to_line and line_to_gs and gs_to_probe and probe_to_loop,
          f"door->line={door_to_line} line->gs={line_to_gs} "
          f"gs->probe={gs_to_probe} probe->loop={probe_to_loop}")

    # browser_probe grant (code-tui c5871 + wave-B P2-2): the grant FOLLOWS
    # browser_probe_available — the tools pin adds the probe only when the
    # host mounts it (probe_ok), and the prompt teaches the matching protocol.
    base_tools = (by_id["builder"]["data"].get("pinDefaults") or {}).get("tools") or []
    check("builder-default-tools-probe-free", "browser_probe" not in base_tools, str(base_tools))
    tools_with = evaluate("builder", "tools", value=list(base_tools), run_vars={"probe_ok": True})
    tools_without = evaluate("builder", "tools", value=list(base_tools), run_vars={"probe_ok": False})
    check("builder-probe-follows-flag", "browser_probe" in tools_with
          and "browser_probe" not in tools_without
          and all(t in tools_with for t in base_tools),
          f"with={tools_with} without={tools_without}")
    # The builder prompt is a NODE now, and every literal block is a PIN
    # DEFAULT (operator ruling: prompt text must be editable by users and
    # agents without opening Python). Run it exactly as the runtime does:
    # the node body with its own declared defaults.
    _bp_defaults = by_id["builder_prompt"]["data"].get("pinDefaults") or {}
    for _slot in ("first_build_text", "repair_text",
                  "probe_available_text", "probe_absent_text"):
        check(f"builder-prompt-text-is-a-pin-default-{_slot}",
              isinstance(_bp_defaults.get(_slot), str) and len(_bp_defaults[_slot]) > 80,
              f"{_slot}={str(_bp_defaults.get(_slot))[:60]!r}")

    def builder_prompt(state):
        return node_from_vars("builder_prompt", state)["prompt"]

    for name, st_extra in (("first", {}), ("repair", {"fix_cycles": 1, "build_feedback": "delivery: x missing"})):
        p_ok = builder_prompt({"request": "r", "plan": {"goal": "g", "steps": []},
                               "probe_ok": True, **st_extra})
        p_no = builder_prompt({"request": "r", "plan": {"goal": "g", "steps": []},
                               "probe_ok": False, **st_extra})
        check(f"builder-prompt-probe-protocol-{name}",
              "browser_probe" in p_ok and "nonce" in p_ok and "SECONDS" in p_ok and "nonzero" in p_ok)
        check(f"builder-prompt-probe-honest-when-absent-{name}",
              "NOT available" in p_no and "browser_probe" in p_no and "nonce" in p_no)

    # Live progress line: "build cycle N of M" at the TOP of each cycle.
    cs = by_id.get("cycle_status")
    check("cycle-status-node-exists", bool(cs) and cs["data"].get("nodeType") == "answer_user",
          f"cycle_status: {cs and cs['data'].get('nodeType')}")
    # The message is composed by `cycle_line` (see the SMELL 1 block above);
    # drive it through the SHIPPED chips so wiring and behaviour cannot drift.
    check("cycle-status-message",
          node_from_vars("cycle_line",
                         {"fix_cycles": 0, "max_fix_cycles": 6})["message"] == "build cycle 1 of 6"
          and node_from_vars("cycle_line",
                             {"fix_cycles": 2, "max_fix_cycles": 6})["message"] == "build cycle 3 of 6")
    loop_to_cs = any(e["source"] == "build_while" and e.get("sourceHandle") == "loop"
                     and e["target"] == "cycle_line" for e in edges)
    # cycle_status -> builder_prompt -> builder: the prompt composer is now a
    # node ON the exec lane between the progress line and the agent.
    cs_to_bp = any(e["source"] == "cycle_status" and e["target"] == "builder_prompt"
                   for e in edges)
    bp_to_builder = any(e["source"] == "builder_prompt" and e["target"] == "builder"
                        and e.get("targetHandle") == "exec-in" for e in edges)
    bp_feeds_prompt = any(e["source"] == "builder_prompt" and e.get("sourceHandle") == "prompt"
                          and e["target"] == "builder" and e.get("targetHandle") == "prompt"
                          for e in edges)
    check("cycle-status-wired-top-of-loop",
          loop_to_cs and cs_to_bp and bp_to_builder and bp_feeds_prompt,
          f"loop->cs={loop_to_cs} cs->bp={cs_to_bp} bp->builder={bp_to_builder} "
          f"prompt-wire={bp_feeds_prompt}")
    check("builder-prompt-not-an-expression",
          not (by_id["builder"]["data"].get("pinExpressions") or {}).get("prompt"))

    # WRAPPER: the four child fields are DECLARED output pins on the subflow
    # node and cross on plain wires. They used to be four
    # `(value or {}).get("<field>", <default>)` expressions on the consumers —
    # the P2 class the operator called out ("why can't we use a simple get
    # variable node for this?"). A field read off a wire is a declared pin
    # upstream; the wrapper now carries ZERO expressions.
    coder = json.loads((FLOWS / "multiagent-coder.json").read_text())
    coder_by_id = {n["id"]: n for n in coder["nodes"]}
    coder_exprs = {f"{n['id']}.{p}" for n in coder["nodes"]
                   for p in (n["data"].get("pinExpressions") or {})}
    check("wrapper-has-no-expressions", not coder_exprs, f"expressions: {sorted(coder_exprs)}")
    build_out_pins = [p["id"] for p in coder_by_id["build"]["data"]["outputs"]
                      if p["type"] != "execution"]
    check("wrapper-subflow-declares-child-fields",
          build_out_pins == ["output", "child_output", "report", "success",
                             "branch", "stopped_reason"],
          str(build_out_pins))
    coder_wires = {(e["target"], e.get("targetHandle")): (e["source"], e.get("sourceHandle"))
                   for e in coder["edges"] if e.get("targetHandle") != "exec-in"}
    check("wrapper-child-fields-are-wires",
          coder_wires.get(("answer", "report")) == ("build", "report")
          and coder_wires.get(("answer", "child_success")) == ("build", "success")
          and coder_wires.get(("answer", "branch")) == ("build", "branch")
          and coder_wires.get(("answer", "stopped_reason")) == ("build", "stopped_reason")
          # the death reason rides `output` (the one pin the runtime's
          # output_pins spread skips), never `child_output` — which that same
          # spread nulls on exactly the dead run it is supposed to describe
          and coder_wires.get(("answer", "child_result")) == ("build", "output")
          and coder_wires.get(("end", "response")) == ("answer", "response")
          and coder_wires.get(("end", "success")) == ("answer", "ok")
          and coder_wires.get(("end", "meta")) == ("answer", "meta"),
          str(coder_wires))
    # THE DEAD-CHILD FLOOR. A declared pin can only carry a field the child
    # RETURNED, so a child that dies before any on_flow_end delivers None where
    # the old `(value or {}).get(k, "")` expressions delivered "". Observed live
    # on the gateway (a provider failure inside the child made this wrapper
    # answer `{"response": null, "success": null, "meta": {}}`). The `answer`
    # node types the result AND says what happened.
    answer_code = _generate_code_from_body(coder_by_id["answer"]["data"], "transform")
    answer_defaults = coder_by_id["answer"]["data"].get("pinDefaults") or {}

    def wrapper_answer(**pins):
        return run_body(answer_code, {**answer_defaults, **pins})

    live = wrapper_answer(report="# done", child_success=True, branch="b",
                          stopped_reason="approved-and-merged",
                          child_result={"report": "# done", "success": True})
    check("wrapper-answer-passes-a-live-child-through",
          live == {"response": "# done", "ok": True,
                   "meta": {"branch": "b", "stopped_reason": "approved-and-merged"}},
          str(live))
    dead = wrapper_answer(report=None, child_success=None, branch=None,
                          stopped_reason=None,
                          child_result={"success": False, "error": "LMStudio API error (400)"})
    check("wrapper-answer-types-a-dead-child",
          isinstance(dead["response"], str) and dead["ok"] is False
          and dead["meta"] == {"branch": "", "stopped_reason": ""},
          str(dead))
    check("wrapper-answer-names-the-cause",
          "LMStudio API error (400)" in dead["response"]
          and "did not finish" in dead["response"], dead["response"][:160])
    blind = wrapper_answer(report=None, child_success=None, branch=None,
                           stopped_reason=None, child_result=None)
    check("wrapper-answer-honest-without-a-cause",
          isinstance(blind["response"], str) and blind["response"].strip()
          and blind["ok"] is False, str(blind))
    # Same treatment on the root: the verify child's verdict is a declared pin.
    verify_out_pins = [p["id"] for p in by_id["verify"]["data"]["outputs"]
                       if p["type"] != "execution"]
    check("verify-subflow-declares-verdict",
          verify_out_pins == ["output", "child_output", "verdict"], str(verify_out_pins))
    check("verify-verdict-is-a-wire",
          wire_into("next_state", "verify_verdict") == ("verify", "verdict")
          and fx("next_state", "verify_verdict") == "",
          str(wire_into("next_state", "verify_verdict")))
    # The verifier-death cause must NOT ride `child_output`: the runtime's
    # output_pins spread nulls that pin on exactly the dead run it describes,
    # so the fold could never see the child's error. `output` survives it.
    check("verify-death-reason-rides-output",
          wire_into("next_state", "verify_meta") == ("verify", "output"),
          str(wire_into("next_state", "verify_meta")))
    clobbered = [f"{n['id']}.{e.get('targetHandle')}"
                 for e in edges
                 for n in [by_id.get(e["source"]) or {}]
                 if (n.get("data") or {}).get("nodeType") == "subflow"
                 and e.get("sourceHandle") == "child_output"]
    check("no-flow-relies-on-the-clobbered-child_output-pin", not clobbered, str(clobbered))
    # wrapper probe passthrough: declared pin, default TRUE, honest override.
    # 0.0.16: the pin default IS the passthrough — the `map_input` code node
    # that used to re-derive it is gone, and `browser_probe_available` rides a
    # plain wire from `start` into the subflow node's declared pin. A
    # probe-less gateway sending `false` still reaches the child's door as
    # false, and an omitted pin resolves to this default (measured: an omitted
    # on_flow_start pin takes its default; only an explicit null shadows it).
    coder_start = next(n for n in coder["nodes"] if n["id"] == "start")
    check("wrapper-probe-pin-default-true",
          (coder_start["data"].get("pinDefaults") or {}).get("browser_probe_available") is True)
    # THE WRAPPER IS PURE WIRING (operator ruling 2026-07-30: "whenever you are
    # NOT using the pins, it means you are HIDING something"). `map_input` —
    # the code node that built the child's whole input as one object — is
    # DELETED: every coercion it did (strip request/workspace_root, normalize
    # + allowlist gating_mode, floor the probe flag) is done by the CHILD's
    # preflight door, on the run that actually uses it.
    check("wrapper-has-no-input-mapping-code-node",
          "map_input" not in coder_by_id
          and [n["id"] for n in coder["nodes"] if n["data"].get("nodeType") == "code"]
          == ["answer"],
          str([n["id"] for n in coder["nodes"]]))
    check("wrapper-exec-spine-is-start-build-answer-end",
          [(e["source"], e["target"]) for e in coder["edges"]
           if e.get("sourceHandle") == "exec-out"]
          == [("start", "build"), ("build", "answer"), ("answer", "end")],
          str([(e["source"], e["target"]) for e in coder["edges"]
               if e.get("sourceHandle") == "exec-out"]))
    build_in_pins = [p["id"] for p in coder_by_id["build"]["data"]["inputs"]
                     if p["type"] != "execution"]
    check("wrapper-subflow-declares-child-input-fields",
          build_in_pins == ["inherit_context", "request", "workspace_root", "gating_mode",
                            "provider", "model", "browser_probe_available"],
          str(build_in_pins))
    check("wrapper-child-inputs-are-wires-from-start",
          coder_wires.get(("build", "request")) == ("start", "prompt")
          and coder_wires.get(("build", "workspace_root")) == ("start", "workspace_root")
          and coder_wires.get(("build", "gating_mode")) == ("start", "gating_mode")
          and coder_wires.get(("build", "provider")) == ("start", "provider")
          and coder_wires.get(("build", "model")) == ("start", "model")
          and coder_wires.get(("build", "browser_probe_available"))
          == ("start", "browser_probe_available"),
          str({k: v for k, v in coder_wires.items() if k[0] == "build"}))
    # The child's OTHER six start fields are deliberately NOT declared here:
    # the wrapper has no opinion on them, and a declared-but-unwired pin would
    # be either dead ink or a None shadowing the child's own default.
    root_start_pins = {p["id"] for p in by_id["start"]["data"]["outputs"]
                       if p["type"] != "execution"}
    check("wrapper-leaves-the-childs-other-defaults-alone",
          root_start_pins - set(build_in_pins)
          == {"max_plan_revisions", "max_fix_cycles", "max_review_rounds",
              "skills", "build_command", "run_command"},
          str(sorted(root_start_pins - set(build_in_pins))))
    # Every coercion `map_input` used to do is done by the CHILD's door — the
    # SHIPPED preflight body, driven here through the real compile lane.
    for raw_gating, want_wait in (("wait", True), ("AUTO", False), ("  Auto ", False),
                                  ("banana", True), ("", True), (None, True)):
        got = node_out("preflight", request=" r ", workspace_root=" /w ",
                       gating_mode=raw_gating, skills=["coredoc"],
                       skills_resolution={"active": ["coredoc"]},
                       browser_probe_available=True)["updates"]
        check(f"child-door-normalizes-gating-{raw_gating!r}",
              got["wait_gating"] is want_wait and got["preflight_ok"] is True, str(got)[:160])
    stripped = node_out("preflight", request="   ", workspace_root="   ",
                        gating_mode="wait", skills=["coredoc"],
                        skills_resolution={"active": ["coredoc"]},
                        browser_probe_available=True)["updates"]
    check("child-door-strips-request-and-workspace",
          stripped["preflight_ok"] is False and len(stripped["preflight_failures"]) == 2,
          str(stripped["preflight_failures"]))
    check("child-door-floors-the-probe-flag",
          node_out("preflight", request="r", workspace_root="/w", gating_mode="wait",
                   skills=["coredoc"], skills_resolution={"active": ["coredoc"]},
                   browser_probe_available=None)["updates"]["probe_ok"] is False
          and node_out("preflight", request="r", workspace_root="/w", gating_mode="wait",
                       skills=["coredoc"], skills_resolution={"active": ["coredoc"]},
                       browser_probe_available=True)["updates"]["probe_ok"] is True)

    # ---- layer 4: logic scenarios (behavioral pins carried across) ----
    # Each converted node is exercised through the SAME wrap+compile lane the
    # runtime uses, seeded with its OWN shipped pin defaults — so the assertion
    # covers the text that actually ships, not a copy of it.
    def preflight(**vars_in):
        # `_runtime` rides the skills_resolution chip; the five door inputs are
        # start-pin wires, so the smoke passes them exactly as the runtime does.
        rt = vars_in.pop("_runtime", None) or {}
        pins = {"skills_resolution": rt.get("skills_resolution")}
        pins.update(vars_in)
        return node_out("preflight", **pins)["updates"]

    def seed_state(**over):
        """The run vars right after the seed: what preflight WRITES, plus the
        config that is already a run var because it is a start pin."""
        base = dict(START_DEFAULTS)
        base.update({"request": "build snake", "workspace_root": "/tmp/ws",
                     "provider": "p", "model": "m"})
        base.update(preflight(request="build snake", workspace_root="/tmp/ws",
                              gating_mode="wait"))
        base.update(over)
        return base

    st = preflight(request="build snake", workspace_root="/tmp/ws", gating_mode="auto",
                   skills=["coredoc"], _runtime={"skills_resolution": {"active": []}},
                   max_fix_cycles=3, provider="p", model="m")
    check("preflight-ok", st["preflight_ok"] is True)
    check("preflight-auto", st["wait_gating"] is False)
    check("preflight-skill-warn", any("skills not active" in w for w in st["warnings"]))
    check("preflight-probe-warn", any("browser_probe" in w for w in st["warnings"]))
    # THE COPIES ARE GONE: preflight writes ONLY derived facts + the mutable
    # progress seeds. Config is already a run var (a start pin), so folding it
    # into the seed would be the blob coming back one key at a time.
    leaked_config = sorted(k for k in st if k in
                           ("request", "workspace_root", "provider", "model",
                            "build_command", "run_command", "skills", "gating_mode"))
    check("preflight-does-not-re-seed-config", not leaked_config, str(leaked_config))
    check("preflight-types-the-budgets", st["max_fix_cycles"] == 3
          and st["max_plan_revisions"] == 3 and st["max_review_rounds"] == 2,
          f"{st['max_fix_cycles']}/{st['max_plan_revisions']}/{st['max_review_rounds']}")
    check("preflight-seeds-flat-names", set(st) == set(START_SEED_NAMES),
          f"missing={sorted(set(START_SEED_NAMES) - set(st))} "
          f"extra={sorted(set(st) - set(START_SEED_NAMES))}")
    st_bad = preflight(request="", workspace_root="", gating_mode="bogus", skills=[],
                       browser_probe_available=True)
    check("preflight-refuses-empty", st_bad["preflight_ok"] is False
          and len(st_bad["preflight_failures"]) == 2)
    check("preflight-bogus-gating-defaults-wait", st_bad["wait_gating"] is True)
    check("pre-report-names-failures",
          "empty request" in node_out("preflight", request="", workspace_root="",
                                      browser_probe_available=True)["report"])
    st_def = preflight(request="r", workspace_root="/tmp/ws")
    check("preflight-seeds-empty-repair-history", st_def["repair_history"] == [])
    check("preflight-defaults-one-source", st_def["wait_gating"] is True
          and st_def["skills_degraded"] is True)  # coredoc default, nothing active
    # The BUDGETS are start-pin defaults now (one source, no second copy).
    check("budget-defaults-live-on-the-start-pins",
          START_DEFAULTS["max_fix_cycles"] == 6 and START_DEFAULTS["max_plan_revisions"] == 3
          and START_DEFAULTS["max_review_rounds"] == 2 and START_DEFAULTS["gating_mode"] == "wait"
          and START_DEFAULTS["request"] == "" and START_DEFAULTS["workspace_root"] == "",
          str(START_DEFAULTS))

    # gate1 parse (node): approve / revise; auto accept
    st0 = {"plan_revisions": 0}
    pd = {"title": "Snake Game", "goal": "g", "steps": ["a"]}
    out = node_from_vars("gate1_parse", st0, response="approve", planner_data=pd)
    check("gate1-approve", out["updates"]["accepted"] is True
          and out["updates"]["title"] == "Snake Game")
    out = node_from_vars("gate1_parse", st0, response="needs sound effects", planner_data=pd)
    check("gate1-revise", out["updates"]["accepted"] is False
          and out["updates"]["plan_revisions"] == 1
          and "sound" in out["updates"]["plan_feedback"])
    out = node_from_vars("gate1_parse", {"plan_revisions": 0},
                         response="research: check WebAudio APIs", planner_data={})
    check("gate1-research-flag", out["updates"]["rescout"] is True)
    s = node_from_vars("plan_auto", st0, planner_data=pd)["updates"]
    check("gate1-auto-accepts", s["accepted"] is True)
    s = node_from_vars("plan_auto", {"plan_revisions": 0}, planner_data={})["updates"]
    check("gate1-auto-refuses-dead-plan", s["accepted"] is False
          and s["plan_revisions"] == 1 and "no usable plan" in s["plan_feedback"])
    # The feedback must not ASSERT a cause it cannot know. An empty planner_data
    # is produced both by a live planner emitting bad JSON and by a planner whose
    # llm_call died (agent death does not fail the parent) — observed live
    # against a `credit balance is too low` 400, where "emit valid JSON" was
    # wrong advice and the loop burned every revision on an unretryable error.
    check("gate1-dead-plan-feedback-does-not-blame-json",
          "emit valid JSON" not in s["plan_feedback"]
          and "provider" in s["plan_feedback"],
          s["plan_feedback"][:140])

    # gate1_prompt NODE: single string; a dead planner ({}) still yields a
    # NON-EMPTY prompt so the wait-mode gate opens instead of failing the run.
    gp = node_out("gate1_prompt",
                  planner_data={"title": "Snake Game", "goal": "g", "steps": ["a", "b"]})["prompt"]
    check("gate1-prompt-formatted", "PLAN for your approval" in gp and "Snake Game" in gp)
    check("gate1-prompt-dead-planner-nonempty",
          node_out("gate1_prompt", planner_data={})["prompt"].strip() != "")

    # branch_slug: sanitization (injection-shaped title); backlog_body NODE
    slug = LIB["branch_slug"]("Fix; rm -rf / --EVIL name")
    check("slug-safe", all(("a" <= c <= "z") or ("0" <= c <= "9") or c == "-" for c in slug), slug)
    check("slug-floor", LIB["branch_slug"]("") == "task" and LIB["branch_slug"](None) == "task")
    body = node_from_vars("backlog_body",
                          {"plan": {"title": "Snake Game", "goal": "eat apples",
                                    "steps": ["a"], "files": [], "risks": []}},
                          slug="snake-game")["content"]
    check("backlog-body", body.startswith("# snake-game") and "eat apples" in body)
    check("backlog-body-slug-is-the-shared-transform",
          fx("backlog_body", "slug") == "branch_slug(vars.title)", fx("backlog_body", "slug"))
    check("backlog-path-inline",
          evaluate("backlog_write", "file_path",
                   run_vars={"title": "Snake Game"}) == "docs/backlog/planned/snake-game.md")

    # git branch compose: quote-hostile workspace path; slug via branch_slug
    def cmd_of(node_id, run_vars, **wires):
        """The shell composers are CODE NODES now (sibling wave): drive them
        through their own chips exactly as the runtime does."""
        return node_from_vars(node_id, run_vars, **wires)["tool_call"]["arguments"]["command"]

    cmd = cmd_of("git_branch_cmd", {"workspace_root": "/tmp/it's here", "title": "Snake Game"},
                 slug=LIB["branch_slug"]("Snake Game"))
    check("git-quote-escape", "it'\\''s" in cmd, cmd[:120])
    check("git-ceiling", "GIT_CEILING_DIRECTORIES" in cmd)
    check("git-toplevel-guard", "--show-toplevel" in cmd)
    check("git-slug-from-plan", "'snake-game'" in cmd, cmd[:200])
    # Two-sided bootstrap ordering (live find fb548675, 2026-07-31):
    # FRESH INIT — baseline commit (--allow-empty) INSIDE the init `if` block,
    # BEFORE checkout, so `main` is born and the merge step has a target
    # (checkout -b off an unborn HEAD moves the ref; main never materialized).
    # EXISTING repo — checkout -b BEFORE the sweep add -A, so uncommitted user
    # work lands on the WORK branch, never the user's branch (adversary F7).
    fi_pos = cmd.find("fi; ")
    check("git-fresh-init-births-main",
          0 < cmd.find("--allow-empty") < fi_pos, cmd[:260])
    check("git-branch-before-baseline-sweep",
          fi_pos < cmd.find("checkout -b") < cmd.rfind("add -A"), cmd[:260])

    # branch_fold NODE: last line wins; the raw envelope is unwrapped by the
    # shared text_of transform ON THE WIRE, so the node body stays 8 lines.
    check("branch-fold-unwraps-envelope", fx("branch_fold", "git_text") == "text_of(value)")
    check("branch-fold-slug-is-the-shared-transform",
          fx("branch_fold", "slug") == "branch_slug(vars.title)")

    def branch_fold(state, raw):
        return node_from_vars("branch_fold", state, git_text=SANDBOX["text_of"](raw),
                              slug=LIB["branch_slug"](state.get("title")))["updates"]

    st = {"title": "Snake Game", "workspace_root": "/tmp/it's here"}
    raw = {"mode": "results", "results": [{"output": {"stdout": "hint\nsnake-game\n"}}]}
    check("git-fold-branch", branch_fold(st, raw)["branch"] == "snake-game")
    raw = {"results": [{"output": {"stdout_preview": "snake-game"}}]}
    check("git-fold-preview", branch_fold(st, raw)["branch"] == "snake-game")

    # next_state (node): failure signature + stall + split counters + auto-approve
    st = {"wait_gating": True, "fix_cycles": 0, "failure_signature": "",
          "same_signature_count": 0, "repair_history": []}
    verdict = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: ls shows 3 files",
        "integration: 12 errors found - see log line 88",
    ]}
    out1 = node_from_vars("next_state", st, verify_verdict=verdict, lint_out=[])
    s1 = applied(st, out1)
    check("fold-counts", s1["fix_cycles"] == 1 and s1["all_passed"] is False)
    check("fold-sig-keeps-fused-digits", "level2.js" in s1["failure_signature"])
    check("fold-sig-drops-standalone-digits", " 12 " not in s1["failure_signature"])
    verdict2 = {"all_passed": False, "failures": [
        "delivery: level2.js missing - evidence: totally different words now",
        "integration: 12 errors found - other log",
    ]}
    out2 = node_from_vars("next_state", s1, verify_verdict=verdict2, lint_out=[])
    check("fold-stall-counts", out2["updates"]["same_signature_count"] == 1)
    out3 = node_from_vars("next_state", {"wait_gating": False},
                          verify_verdict={"all_passed": True, "failures": []}, lint_out=[])
    check("fold-auto-approves-green", out3["updates"]["approved"] is True)
    out4 = node_from_vars("next_state", {"wait_gating": True},
                          verify_verdict={"all_passed": True, "failures": []}, lint_out=[])
    check("fold-wait-needs-gate", "approved" not in out4["updates"])
    out5 = node_from_vars("next_state", {"wait_gating": False},
                          verify_verdict={"all_passed": True, "failures": []},
                          lint_out=["syntax error in x.py"])
    check("fold-lint-blocks-green", out5["updates"]["all_passed"] is False
          and "approved" not in out5["updates"])
    d1 = node_from_vars("next_state", st, verify_verdict={},
                        verify_meta={"success": False, "error": "child run failed"}, lint_out=[])
    check("fold-verifier-death-named", any("verdict missing" in f for f in d1["updates"]["last_verdict"]["failures"])
          and d1["updates"]["all_passed"] is False and d1["updates"]["failure_signature"] != "")
    # The CAUSE must reach the report, not just the generic fallback — that is
    # the whole point of routing the death channel through `output`.
    check("fold-verifier-death-names-the-cause",
          any("child run failed" in f for f in d1["updates"]["last_verdict"]["failures"]),
          str(d1["updates"]["last_verdict"]["failures"])[:200])
    # ADR-0026 (operator ruling 2026-09-28): the cause reaches the fixer
    # WHOLE — a 160-char cut used to hide the decisive tail of the error.
    long_cause = "child run failed: " + "x" * 300 + " DECISIVE-TAIL"
    d_long = node_from_vars("next_state", st, verify_verdict={},
                            verify_meta={"success": False, "error": long_cause}, lint_out=[])
    check("fold-verifier-death-cause-whole",
          any(long_cause in f for f in d_long["updates"]["last_verdict"]["failures"]),
          str(d_long["updates"]["last_verdict"]["failures"])[:200])
    death = {"success": False, "error": "child run failed"}
    v1 = applied(st, d1)
    d2 = node_from_vars("next_state", v1, verify_verdict={}, verify_meta=death, lint_out=[])
    v2 = applied(v1, d2)
    d3 = node_from_vars("next_state", v2, verify_verdict={}, verify_meta=death, lint_out=[])
    check("fold-verifier-death-latches-stall", d3["updates"]["same_signature_count"] >= 2)
    seeded = seed_state()
    m = node_from_vars("next_state", seeded, verify_verdict=verdict, lint_out=[],
                       builder_response="I wrote game.js using canvas polling")
    check("repair-prompt-cites-attempt",
          "canvas polling" in builder_prompt(applied(seeded, m)))

    # REPAIR HISTORY: each FAILED cycle appends {cycle, changed, failed};
    # the builder prompt shows the whole trail.
    base = seed_state()
    h1 = node_from_vars("next_state", base,
                        verify_verdict={"all_passed": False, "failures": ["delivery: a.js missing"]},
                        lint_out=[], builder_response="attempt one: added a.js")
    v_h1 = applied(base, h1)
    hist1 = v_h1["repair_history"]
    check("repair-history-appends", len(hist1) == 1 and hist1[0]["cycle"] == 1
          and "attempt one" in hist1[0]["changed"] and hist1[0]["failed"], f"hist: {hist1}")
    h2 = node_from_vars("next_state", v_h1,
                        verify_verdict={"all_passed": False, "failures": ["integration: broke b.js"]},
                        lint_out=[], builder_response="attempt two: rewrote b.js")
    v_h2 = applied(v_h1, h2)
    hist2 = v_h2["repair_history"]
    check("repair-history-accumulates", len(hist2) == 2 and hist2[1]["cycle"] == 2)
    prompt2 = builder_prompt(v_h2)
    check("repair-prompt-shows-whole-trail",
          "attempt one" in prompt2 and "attempt two" in prompt2 and "Repair history" in prompt2)
    hg = node_from_vars("next_state", v_h2, verify_verdict={"all_passed": True, "failures": []},
                        lint_out=[], builder_response="fixed it")
    # a GREEN cycle writes no repair_history key at all — set_vars leaves the
    # trail exactly as it was (the blob-era fold had to copy it forward)
    check("repair-history-not-on-green", "repair_history" not in hg["updates"]
          and len(applied(v_h2, hg)["repair_history"]) == 2)

    # gate2_fold NODE: approve / reject resets fix counters, bumps review
    def gate2_fold(state, response):
        return applied(state, node_from_vars("gate2_fold", state, response=response))

    st = {"wait_gating": True, "fix_cycles": 3, "review_rounds": 0,
          "same_signature_count": 2, "failure_signature": "x", "all_passed": True}
    s = gate2_fold(st, "approve")
    check("gate2-approve", s["approved"] is True and s["last_gate2"] == "approved")
    s = gate2_fold(st, "the ship should shoot faster")
    check("gate2-reject-resets", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["same_signature_count"] == 0
          and s["all_passed"] is False and "shoot faster" in s["build_feedback"]
          and s["last_gate2"] == "rejected")
    red = {"wait_gating": True, "fix_cycles": 3, "review_rounds": 0,
           "same_signature_count": 2, "all_passed": False}
    s = gate2_fold(red, "try a state machine for levels")
    check("gate2-escalation-guides", s["approved"] is False and s["fix_cycles"] == 0
          and s["review_rounds"] == 1 and s["last_gate2"] == "escalated"
          and "state machine" in s["build_feedback"])
    s = gate2_fold(red, "stop")
    check("gate2-escalation-stop", s["user_stopped"] is True and s["approved"] is False)
    s = gate2_fold(red, "approve")
    check("gate2-red-approve-refused", s["approved"] is False,
          "approve on a red build must not merge")
    check("gate2-no-comment-fallback",
          "improve robustness" in gate2_fold(red, "")["build_feedback"])
    # gate2_prompt: a NODE whose prose sits in pin defaults; the escalation
    # names WHICH stop reason fired.
    _g2_defaults = by_id["gate2_prompt"]["data"].get("pinDefaults") or {}
    for _slot in ("green_text", "green_footer_text", "stalled_text", "budget_text",
                  "red_footer_text", "final_round_text"):
        check(f"gate2-prompt-text-is-a-pin-default-{_slot}",
              isinstance(_g2_defaults.get(_slot), str) and len(_g2_defaults[_slot]) > 40,
              f"{_slot}={str(_g2_defaults.get(_slot))[:60]!r}")

    def gate2_prompt(state):
        return node_from_vars("gate2_prompt", state)["prompt"]

    check("gate2-prompt-not-an-expression",
          not (by_id["gate2"]["data"].get("pinExpressions") or {}).get("prompt"))
    p = gate2_prompt({"all_passed": False, "branch": "b",
                      "last_verdict": {"failures": ["delivery: x missing"]},
                      "review_rounds": 0, "max_review_rounds": 2})
    check("gate2-prompt-escalation", "BUILD STUCK" in p and "x missing" in p)
    p_stall = gate2_prompt({"all_passed": False, "branch": "b", "same_signature_count": 3,
                            "last_verdict": {"failures": ["x"]}, "review_rounds": 0,
                            "max_review_rounds": 2})
    check("gate2-prompt-names-stall", "SAME failure" in p_stall)
    p_budget = gate2_prompt({"all_passed": False, "branch": "b", "same_signature_count": 0,
                             "fix_cycles": 6, "max_fix_cycles": 6,
                             "last_verdict": {"failures": ["x"]}, "review_rounds": 0,
                             "max_review_rounds": 2})
    check("gate2-prompt-names-budget", "fix budget" in p_budget)
    p = gate2_prompt({"all_passed": True, "branch": "b",
                      "review_rounds": 2, "max_review_rounds": 2})
    check("gate2-prompt-final-round-warning", "FINAL review round" in p)

    # build_again: budgets + stall + approval
    def build_again(**over):
        # NAMED arguments: the law's inputs are visible at every call site now,
        # in the test exactly as on the canvas.
        a = {"approved": False, "user_stopped": False, "environment_blocked": False,
             "same_signature_count": 0, "fix_cycles": 0, "max_fix_cycles": 6,
             "review_rounds": 0, "max_review_rounds": 2}
        a.update(over)
        return LIB["build_again"](a["approved"], a["user_stopped"], a["environment_blocked"],
                                  a["same_signature_count"], a["fix_cycles"],
                                  a["max_fix_cycles"], a["review_rounds"],
                                  a["max_review_rounds"])

    check("cond-continues", build_again(max_fix_cycles=3) is True)
    check("cond-stops-approved", build_again(approved=True) is False)
    check("cond-continues-at-2-repeats", build_again(same_signature_count=2) is True)
    check("cond-stops-stalled", build_again(same_signature_count=3) is False)
    check("cond-stops-budget", build_again(fix_cycles=3, max_fix_cycles=3) is False)
    check("cond-stops-user-stop", build_again(user_stopped=True) is False)
    check("cond-stops-env-blocked", build_again(environment_blocked=True) is False)

    # tail_escalate: wait+red+exhausted/stalled only
    def tail_escalate(**over):
        a = {"wait_gating": True, "all_passed": False, "environment_blocked": False,
             "same_signature_count": 0, "fix_cycles": 0, "max_fix_cycles": 6}
        a.update(over)
        return LIB["tail_escalate"](a["wait_gating"], a["all_passed"], a["environment_blocked"],
                                    a["same_signature_count"], a["fix_cycles"],
                                    a["max_fix_cycles"])

    check("escalate-on-exhaustion", tail_escalate(fix_cycles=3, max_fix_cycles=3) is True)
    check("escalate-on-stall", tail_escalate(fix_cycles=1, same_signature_count=3) is True)
    check("no-escalate-in-auto",
          tail_escalate(wait_gating=False, fix_cycles=3, max_fix_cycles=3) is False)
    check("no-escalate-mid-budget", tail_escalate(fix_cycles=1, max_fix_cycles=3) is False)
    check("no-escalate-env-blocked",
          tail_escalate(environment_blocked=True, fix_cycles=3, max_fix_cycles=3) is False)
    check("no-escalate-green",
          tail_escalate(all_passed=True, fix_cycles=3, max_fix_cycles=3) is False)

    # merge_fold NODE: POSITIVE sentinel required (adversary F4)
    check("merge-fold-unwraps-envelope", fx("merge_fold", "merge_text") == "text_of(value)")

    def merge_fold(state, raw):
        return node_from_vars("merge_fold", state,
                              merge_text=SANDBOX["text_of"](raw))["updates"]

    raw = {"results": [{"output": {"stdout": "Auto-merging...\nMERGE_CONFLICT_ABORTED"}}]}
    s = merge_fold({"approved": True}, raw)
    check("merge-conflict-honest", s["merged"] is False
          and any("conflict" in w for w in s["warnings"]))
    raw = {"results": [{"output": {"stdout": "Merge made by ort\nMERGED_OK main"}}]}
    s = merge_fold({"approved": True}, raw)
    check("merge-green", s["merged"] is True)
    raw = {"results": [{"output": {"stdout": "NO_MAINLINE_BRANCH"}}]}
    s = merge_fold({"approved": True}, raw)
    check("merge-no-mainline-honest", s["merged"] is False
          and any("no main/master" in w for w in s["warnings"]))
    raw = {"results": [{"output": {"stdout": "something odd happened"}}]}
    s = merge_fold({"approved": True}, raw)
    check("merge-missing-sentinel-honest", s["merged"] is False)
    shapes = [
        {"results": [{"output": {"stdout": "MERGED_OK main"}}]},
        {"mode": "results", "results": [{"output": {"results": [{"output": {"stdout_preview": "MERGED_OK main"}}]}}]},
        {"results": [{"output": "MERGED_OK main"}]},
        {"results": [{"output": {"stderr": "MERGED_OK main"}}]},
    ]
    ok_shapes = 0
    for raw in shapes:
        if merge_fold({"approved": True}, raw)["merged"] is True:
            ok_shapes += 1
    check("extractor-recursive-shapes", ok_shapes == len(shapes), f"{ok_shapes}/{len(shapes)}")
    cmd = cmd_of("merge_cmd", {"workspace_root": "/w", "branch": "b"})
    check("merge-cmd-sentinel", "MERGED_OK" in cmd and "NO_MAINLINE_BRANCH" in cmd)
    # shq: ONE escape implementation shared by every command composer
    check("shq-escape", SANDBOX["shq"]("it's") == "it'\\''s" and SANDBOX["shq"](None) == ""
          and SANDBOX["shq"](0) == "0")  # falsy non-None keeps its text (wave-B P2-3)
    cmd = cmd_of("merge_cmd", {"workspace_root": "/tmp/it's ws", "branch": "a'b"})
    check("shq-in-merge", "it'\\''s" in cmd and "a'\\''b" in cmd)

    # lint_parse NODE: diagnostic grammar only (adversary F1/F2 false-red class)
    check("lint-parse-unwraps-envelope", fx("lint_parse", "lint_text") == "text_of(value)")
    check("lint-parse-feeds-the-fold",
          wire_into("next_state", "lint_out") == ("lint_parse", "residuals")
          and fx("next_state", "lint_out") == "",
          str(wire_into("next_state", "lint_out")))

    def lint_res(text):
        raw = {"results": [{"output": {"stdout": text}}]}
        return node_out("lint_parse", lint_text=SANDBOX["text_of"](raw))["residuals"]
    check("lint-ignores-ruff-success-summary", lint_res("Found 12 errors (12 fixed, 0 remaining).") == [])
    check("lint-ignores-all-checks-passed", lint_res("All checks passed!") == [])
    check("lint-ignores-filename-echo", lint_res("src/error-modal.js 12ms") == [])
    check("lint-catches-ruff-diagnostic", lint_res("src/game.js:12:5: E501 line too long") != [])
    check("lint-catches-diag-in-error-named-file", lint_res("src/error_handler.py:3:1: F401 unused import") != [])
    check("lint-catches-prettier-error", lint_res("[error] src/app.js: SyntaxError: Unexpected token (5:12)") != [])
    check("lint-catches-bare-syntaxerror", lint_res("SyntaxError: invalid syntax in solution.py") != [])

    # doc drift NODE: drift -> red with named feedback; clean/no-selfcheck -> ok
    def doc_drift(state, guard_raw):
        out = node_from_vars("doc_drift", state, guard_text=SANDBOX["text_of"](guard_raw))
        return out, applied(state, out)
    g, after = doc_drift({"all_passed": True},
                         {"results": [{"output": {"stdout": "DOC_DRIFT game.js\nDOC_DRIFT my file.py"}}]})
    check("docguard-drift-red", g["ok"] is False and after["all_passed"] is False
          and "game.js" in after["build_feedback"] and "my file.py" in after["build_feedback"])
    g, after = doc_drift({"all_passed": True}, {"results": [{"output": {"stdout": "DOC_GUARD_OK"}}]})
    # a clean pass writes NOTHING: `updates` is empty, set_vars no-ops, and the
    # green flag survives untouched (the blob-era fold rewrote the container)
    check("docguard-clean-ok", g["ok"] is True and g["updates"] == {}
          and after["all_passed"] is True)
    g, _ = doc_drift({"all_passed": True}, {"results": [{"output": {"stdout": "NO_SELFCHECK_TO_GUARD"}}]})
    check("docguard-no-selfcheck-ok", g["ok"] is True)
    cmd = cmd_of("docguard_cmd", {"workspace_root": "/w"})
    check("docguard-posix-no-procsub", "< <(" not in cmd)

    # ENVIRONMENT fail-soft (coding-agent 0.2.2 precedent; live 2026-07-23)
    st0 = {"wait_gating": False, "fix_cycles": 0, "failure_signature": "",
           "same_signature_count": 0, "repair_history": []}
    out = node_from_vars("next_state", st0, lint_out=[],
                         verify_verdict={"all_passed": False,
                                         "failures": ["Build step failed: missing Python executor."],
                                         "environment_failures": []})
    s = out["updates"]
    check("env-belt-classifies", s.get("environment_blocked") is True
          and s["last_verdict"]["environment_failures"] != []
          and s["last_verdict"]["failures"] == [])
    out = node_from_vars("next_state", st0, lint_out=[],
                         verify_verdict={"all_passed": False, "failures": [],
                                         "environment_failures": ["no shell executor available"]})
    check("env-primary-lane", out["updates"].get("environment_blocked") is True)
    out = node_from_vars("next_state", st0, lint_out=[],
                         verify_verdict={"all_passed": False,
                                         "failures": ["delivery: main.js missing",
                                                      "Execution step failed: missing Python executor."],
                                         "environment_failures": []})
    check("env-mixed-keeps-fixing", not out["updates"].get("environment_blocked")
          and "main.js" in out["updates"]["build_feedback"]
          and "executor" not in out["updates"]["build_feedback"])

    # final report NODE: reasons per state + evidence rendering
    def report(state):
        return node_from_vars("final_report", state)
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
    check("report-merged", out["stopped_reason"] == "approved-and-merged"
          and out["merged_ok"] is True)
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

    # pr_body NODE + compose_pr_push: no-remote degrade text + quote safety
    st = {"title": "Snake", "plan": {"goal": "g"}, "branch": "snake-game",
          "all_passed": True, "warnings": ["w1"], "workspace_root": "/tmp/it's ws"}
    body = node_from_vars("pr_body", st)["content"]
    check("pr-body", "# PR: Snake" in body and "snake-game" in body and "w1" in body)
    check("pr-body-gates-line", "- gates: green" in body
          and "- gates: NOT GREEN" in node_from_vars("pr_body", {})["content"])
    check("pr-body-feeds-the-writer",
          wire_into("pr_write", "content") == ("pr_body", "content")
          and fx("pr_write", "content") == "")
    push = node_from_vars("pr_push_cmd", st)["tool_call"]
    check("pr-remote-degrade", "NO_REMOTE_LOCAL_PR_MD_ONLY" in push["arguments"]["command"])
    check("pr-quote-escape", "it'\\''s" in push["arguments"]["command"])
    check("pr-no-prompt-hang", "GIT_TERMINAL_PROMPT=0" in push["arguments"]["command"]
          and push["arguments"].get("timeout") == 120)

    # verify subflow input: SEVEN DECLARED PINS, each fed by its own chip
    # (0.0.16 — the `make_object` that used to assemble them is gone). Simulate
    # what the runtime does: resolve each chip, then let the subflow effect
    # builder land each declared pin in the child's vars under its own name.
    st = {"fix_cycles": 2, "request": "r", "workspace_root": "/w",
          "build_command": "", "run_command": "", "provider": "p", "model": "m"}
    built = {pin_id: var_at(st, name, dflt)
             for pin_id, (name, dflt) in chips_of("verify").items()}
    check("verify-round-index", built["round_index"] == 2)
    check("verify-config-from-flat-vars",
          built["request"] == "r" and built["workspace_root"] == "/w"
          and built["provider"] == "p" and built["model"] == "m", str(built))
    check("verify-pins-cover-the-childs-whole-interface",
          set(built) == set(child_input_pins["multiagent-verify-gates"]),
          f"{sorted(built)} vs {sorted(child_input_pins['multiagent-verify-gates'])}")

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
    check("e2e-refusal-honest", out.get("success") is False and out.get("passed") is False
          and out.get("stopped_reason") == "preflight-failed"
          and "empty request" in str(out.get("report") or ""),
          str(out)[:200])

    # What a host sends with every run (abstractcode.coding.v1 hosts pass the
    # provider/model they route to). Without them the runtime's Agent node
    # refuses to start ("Agent node missing provider/model configuration")
    # and every agent stage returns an error: the scripted agents below would
    # never run. The values are stub names; the effect handlers answer.
    HOST_ROUTE = {"provider": "smoke-provider", "model": "smoke-model"}

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
        "request": "build a snake game", "workspace_root": ws, **HOST_ROUTE, "gating_mode": "wait",
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
    check("e2e-full-merged", out.get("success") is True and out.get("passed") is True
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
        "request": "build a snake game", "workspace_root": ws, **HOST_ROUTE, "gating_mode": "auto",
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
        "request": "build a snake game", "workspace_root": ws, **HOST_ROUTE, "gating_mode": "auto",
    })
    st4 = runtime3.tick(workflow=spec, run_id=run_id4, max_steps=400)
    out4 = st4.output or {}
    check("e2e-auto-stall-exits", st4.status == RunStatus.COMPLETED
          and out4.get("success") is False and out4.get("passed") is False
          and str(out4.get("stopped_reason") or "").startswith("stalled"),
          f"status={st4.status} out={str(out4)[:160]}")

    # ---- layer 9: E2E WRAPPER through the real Runtime. This is the gate for
    # the mechanism the whole P2 elimination rests on: a subflow node's
    # DECLARED output pins are populated from the child's on_flow_end fields
    # (compiler `_sync_effect_results_to_node_outputs`, `start_subworkflow`
    # branch -> `effect_config["output_pins"]`), so a consumer can WIRE a child
    # field instead of carrying `(value or {}).get(field, default)`. Both the
    # live child and the DEAD child are pinned here.
    coder_spec = compile_visualflow(coder)

    def wrapper_run(child_raw, *, run_vars=None, seen=None):
        def sub_stub(run, effect, default_next_node):
            if seen is not None:
                seen.update(dict((effect.payload or {}).get("vars") or {}))
            return EffectOutcome.completed(dict(child_raw))

        rt = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                     effect_handlers={EffectType.START_SUBWORKFLOW: sub_stub})
        rid = rt.start(workflow=coder_spec,
                       vars=dict(run_vars if run_vars is not None
                                 else {"prompt": "build a thing", "workspace_root": "/tmp/ws"}))
        st = rt.tick(workflow=coder_spec, run_id=rid, max_steps=60)
        return st

    # ---- THE MARSHALLING GATE (0.0.16). The whole pins-not-blobs shape rests
    # on `executor._create_subflow_effect_builder`: every DECLARED non-control
    # input pin lands in the child's run vars UNDER ITS OWN NAME. Asserted on
    # the REAL effect payload, not on the graph.
    marshalled: dict = {}
    wrapper_run({"sub_run_id": "s", "output": {"report": "r", "success": True}},
                seen=marshalled)
    check("wrapper-declared-input-pins-become-child-vars",
          marshalled == {"request": "build a thing", "workspace_root": "/tmp/ws",
                         "gating_mode": "wait", "provider": None, "model": None,
                         "browser_probe_available": True},
          str(marshalled))
    check("wrapper-sends-no-input-blob",
          "input" not in marshalled and "vars" not in marshalled, str(sorted(marshalled)))
    # ABSENT MEANS ABSENT: the six child fields the wrapper does NOT declare
    # are not in the payload at all, so the CHILD's own start-pin defaults
    # apply. A declared-but-unwired pin would have written None instead — and
    # None DOES shadow a child default (measured), which is exactly why those
    # six pins are not declared.
    check("wrapper-omits-the-childs-other-fields-entirely",
          not ({"max_plan_revisions", "max_fix_cycles", "max_review_rounds",
                "skills", "build_command", "run_command"} & set(marshalled)),
          str(sorted(marshalled)))
    # And a caller-supplied value overrides the pin default on the same wire.
    override: dict = {}
    wrapper_run({"sub_run_id": "s", "output": {"report": "r", "success": True}},
                run_vars={"prompt": "x", "workspace_root": "/w", "gating_mode": "auto",
                          "browser_probe_available": False, "provider": "lmstudio",
                          "model": "ornith-1.0-35b"},
                seen=override)
    check("wrapper-caller-values-cross-on-their-own-pins",
          override == {"request": "x", "workspace_root": "/w", "gating_mode": "auto",
                       "provider": "lmstudio", "model": "ornith-1.0-35b",
                       "browser_probe_available": False},
          str(override))

    st_live = wrapper_run({"sub_run_id": "s",
                           "output": {"report": "# done", "success": True, "branch": "feat/x",
                                      "stopped_reason": "approved-and-merged"}})
    out_live = st_live.output or {}
    check("e2e-wrapper-declared-pins-carry-child-fields",
          st_live.status == RunStatus.COMPLETED
          and out_live.get("response") == "# done"
          and out_live.get("success") is True
          and (out_live.get("meta") or {}).get("branch") == "feat/x"
          and (out_live.get("meta") or {}).get("stopped_reason") == "approved-and-merged",
          f"status={st_live.status} out={str(out_live)[:220]}")
    st_dead = wrapper_run({"sub_run_id": "s",
                           "output": {"success": False, "error": "child run failed"}})
    out_dead = st_dead.output or {}
    check("e2e-wrapper-dead-child-answers-honestly",
          st_dead.status == RunStatus.COMPLETED
          and isinstance(out_dead.get("response"), str)
          and "child run failed" in str(out_dead.get("response"))
          and out_dead.get("success") is False
          and (out_dead.get("meta") or {}) == {"branch": "", "stopped_reason": ""},
          f"status={st_dead.status} out={str(out_dead)[:220]}")

    # ---- auto-mode metadata covers every gated tool in the family ----
    # A live auto run parked FOREVER on list_files because the bundle's
    # auto_mode_requirement named execute_command alone while the verify
    # subflow calls list_files/read_file via call_tool (gateway run
    # 02eb7ba9, 2026-07-31). The advertised auto-approve list must be a
    # superset of every call_tool allowlist in the family, or unattended
    # runs deadlock on the first uncovered tool.
    import re as _re
    builder_src = (Path(__file__).resolve().parent / "build_multiagent_coding_workflow.py").read_text()
    # EVERY advertised auto_approve list in the builder (bundle metadata AND
    # the wrapper's user-facing description) must cover the family's tools —
    # an operator follows whichever one they read first.
    advertised_lists = _re.findall(r'auto_approve_tools[^\[]*\[(.*?)\]', builder_src, _re.S)
    advertised = (
        set.intersection(*[set(_re.findall(r'([a-z_]+)', blob)) for blob in advertised_lists])
        if advertised_lists else set()
    )
    family_tools: set[str] = set()
    for fname in ("multiagent-coding.json", "multiagent-verify-gates.json", "multiagent-coder.json"):
        fam = json.loads((FLOWS / fname).read_text())
        for n in fam["nodes"]:
            if n["type"] != "call_tool":
                continue
            for t in (n["data"].get("pinDefaults") or {}).get("allowed_tools") or []:
                family_tools.add(str(t))
    uncovered = sorted(family_tools - advertised)
    check("auto-mode-metadata-covers-call-tools", not uncovered,
          f"call_tool uses {uncovered} but auto_mode_requirement advertises only {sorted(advertised)}")

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("SMOKE OK: all scenarios passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
