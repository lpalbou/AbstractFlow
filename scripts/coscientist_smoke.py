#!/usr/bin/env python3
"""Deterministic smoke tests for the co-scientist workflow (0.2.0 rework).

Layers:
0. AUDIT + LAYOUT: the shipped JSON passes `audit_flow_graph.py --policy` with
   ZERO findings (hard and policy) and zero node overlaps.
1. NODE COMPILE: every code-node body compiles through the REAL runtime
   code-node compiler, and every one of them is on the EXECUTION lane.
2. EMITTED EXPRESSIONS: every pin expression the flow ships is compiled and
   EVALUATED through the real pin-expression lane against representative run
   vars - the smoke tests what ships, not a copy of it.
3. DOCTRINE: no state blobs, no legacy `get` nodes, no subflow input blob,
   every run var written by `set_vars` and read by a `get_var` chip, every
   prose pin default non-empty, every agent/llm carrying a `system` charter.
4. PROMPT + REPORT PRESERVATION (the quality gate): every case in
   `coscientist_fixtures.py` is replayed through the SHIPPED bodies and
   compared BYTE-FOR-BYTE with `coscientist_golden.json`, which was captured
   from the pre-rework 0.1.16 builder. A paraphrase, a dropped rule, a lost
   heading or a reordered section fails here.
5. RULE CORPUS: the load-bearing instructions the reports were fought for are
   each asserted present in the composed corpus of the agent that must obey
   them - so a future edit to a pin default cannot quietly delete one.
6. ADR-0026 (0.2.1): every model-facing prompt carries its inputs WHOLE - each
   long fixture string fed past a removed cap (feedback 6x400/6x300, open
   questions 6, meta-review top 5 + literature 2500 + notes 300, figure prompt
   top 5 + statements 200, citation titles 60/80/70) is asserted present in
   the composed text. The six `adr26.*` golden cases pin the same bytes.
"""
from __future__ import annotations

import json
import subprocess
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
from abstractruntime.visualflow_compiler.visual.pin_expressions import (  # noqa: E402
    compile_pin_expression,
)

import coscientist_fixtures as FX  # noqa: E402
from coscientist_fixtures import CASES  # noqa: E402

FLOW_PATH = Path(__file__).resolve().parents[1] / "examples" / "flows" / "co-scientist.json"
GOLDEN_PATH = Path(__file__).resolve().parent / "coscientist_golden.json"

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


_HANDLERS: dict[str, object] = {}


def handler_for(node: dict):
    code = _generate_code_from_body(node["data"], "transform")
    h = _HANDLERS.get(code)
    if h is None:
        h = create_code_handler(code, "transform")
        _HANDLERS[code] = h
    return h


def run_node(node: dict, inputs: dict):
    """Run a shipped body seeded with its OWN pin defaults, wires on top."""
    merged = dict(node["data"].get("pinDefaults") or {})
    merged.update(inputs)
    return handler_for(node)(merged)


def dig(value, path: str):
    if not path:
        return value
    for seg in path.split("."):
        value = value.get(seg) if isinstance(value, dict) else None
    return value


def diff_note(expected, actual) -> str:
    if isinstance(expected, str) and isinstance(actual, str):
        for i, (a, b) in enumerate(zip(expected, actual)):
            if a != b:
                return (f"first diff at char {i}: expected ...{expected[max(0, i - 40):i + 40]!r} "
                        f"got ...{actual[max(0, i - 40):i + 40]!r}")
        return f"length {len(expected)} vs {len(actual)}; tail {expected[len(actual):][:80]!r}"
    return f"expected {json.dumps(expected)[:200]} got {json.dumps(actual, default=str)[:200]}"


def main() -> int:  # noqa: C901
    # ---- layer 0: audit + layout -----------------------------------------
    audit = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "audit_flow_graph.py"),
         "--policy", str(FLOW_PATH)],
        capture_output=True, text=True)
    out = (audit.stdout or "") + (audit.stderr or "")
    check("audit-clean", audit.returncode == 0 and "clean" in out, out.strip()[-300:])

    flow = json.loads(FLOW_PATH.read_text())
    by_id = {n["id"]: n for n in flow["nodes"]}
    ntype = {nid: (n["data"].get("nodeType") or "") for nid, n in by_id.items()}
    pd_of = lambda nid, p: (by_id[nid]["data"].get("pinDefaults") or {}).get(p)  # noqa: E731

    # ---- layer 1: every code node compiles, and every one is on exec ------
    code_nodes = [n for n in flow["nodes"] if n["data"].get("nodeType") == "code"]
    compiled = 0
    for n in code_nodes:
        try:
            handler_for(n)
            compiled += 1
        except Exception as e:  # noqa: BLE001
            check(f"compile:{n['id']}", False, str(e)[:200])
    check("code-nodes-compile", compiled == len(code_nodes), f"{compiled}/{len(code_nodes)}")
    # Operator ruling 2026-07-30: "code nodes have execution pins, otherwise
    # it's a pure function OR a variable access". 37 exec-less nodes at 0.1.16.
    execless = [n["id"] for n in code_nodes
                if not any(p.get("type") == "execution" for p in n["data"].get("inputs") or [])]
    check("every-code-node-is-on-the-exec-lane", not execless, str(execless))

    # ---- layer 2: the SHIPPED pin expressions compile AND evaluate --------
    exprs = {(n["id"], p): e
             for n in flow["nodes"]
             for p, e in (n["data"].get("pinExpressions") or {}).items()}
    check("expressions-are-few-and-named", set(exprs) == {("cycles", "condition"),
                                                          ("if_ground_retry", "condition")},
          str(sorted(exprs)))
    VARS_RUNNING = {"cycle": 1, "max_cycles": 3, "pool": [{"id": 0}],
                    "lit_grounding_ok": False}
    VARS_DONE = {"cycle": 3, "max_cycles": 3, "pool": [{"id": 0}],
                 "lit_grounding_ok": True}
    VARS_EMPTY = {"cycle": 0, "max_cycles": 3, "pool": [], "lit_grounding_ok": True}
    for (nid, p), src in sorted(exprs.items()):
        try:
            compile_pin_expression(src, node_label=nid, pin_id=p)
        except Exception as e:  # noqa: BLE001
            check(f"expr-compiles:{nid}.{p}", False, str(e)[:200])
            continue
        check(f"expr-compiles:{nid}.{p}", True)
    loop = compile_pin_expression(exprs[("cycles", "condition")],
                                  node_label="cycles", pin_id="condition")
    check("loop-runs-while-budget-remains", bool(loop(None, VARS_RUNNING)) is True)
    check("loop-stops-at-the-cycle-budget", bool(loop(None, VARS_DONE)) is False)
    check("loop-stops-on-an-empty-pool", bool(loop(None, VARS_EMPTY)) is False)
    gate = compile_pin_expression(exprs[("if_ground_retry", "condition")],
                                  node_label="if_ground_retry", pin_id="condition")
    check("retry-fires-only-when-nothing-was-fetched",
          bool(gate(None, VARS_RUNNING)) is True and bool(gate(None, VARS_DONE)) is False)

    # ---- layer 3: doctrine -------------------------------------------------
    # (a) NO STATE BLOBS. Every write is a `set_vars` of flat top-level names.
    check("no-set_var-blob-writers",
          not [nid for nid, t in ntype.items() if t == "set_var"],
          str([nid for nid, t in ntype.items() if t == "set_var"]))
    written: set[str] = set()
    for nid, t in ntype.items():
        if t != "set_vars":
            continue
        seed = pd_of(nid, "updates")
        if isinstance(seed, dict):
            written |= set(seed)
    for n in code_nodes:
        # the `updates` dict a fold hands to its set_vars names its own vars
        body = n["data"].get("codeBody") or ""
        for line in body.splitlines():
            s = line.strip()
            if s.startswith('"') and '":' in s:
                written.add(s.split('"')[1])
    read = sorted({pd_of(nid, "name") for nid, t in ntype.items() if t == "get_var"})
    namespaced = [v for v in read if "." in str(v)]
    check("no-namespaced-var-reads", not namespaced, str(namespaced))
    unknown = [v for v in read if v not in written]
    check("every-read-var-is-written-somewhere", not unknown, str(unknown))

    # (b) no legacy `get` nodes, no subflow input blob
    check("no-legacy-get-nodes", not [nid for nid, t in ntype.items() if t == "get"],
          str([nid for nid, t in ntype.items() if t == "get"]))
    blobs = [nid for nid, n in by_id.items()
             if ntype[nid] == "subflow"
             and [p["id"] for p in n["data"]["inputs"]
                  if p["type"] != "execution" and p["id"] != "inherit_context"] == ["input"]]
    check("subflow-calls-declare-one-pin-per-child-field", not blobs, str(blobs))

    # (c) every prose pin default is present and non-empty. A `{{slot}}` that
    # nothing fills would silently ship the literal braces to a model.
    empty_text: list[str] = []
    unfilled: list[str] = []
    for n in code_nodes:
        body = n["data"].get("codeBody") or ""
        for p in n["data"].get("inputs") or []:
            # a PROSE pin is one that ships its sentence as a pin DEFAULT;
            # `lit_text` / `pool_text` are wired data pins, not prose.
            if not p["id"].endswith("_text") or p["id"] not in (
                    n["data"].get("pinDefaults") or {}):
                continue
            v = pd_of(n["id"], p["id"])
            if not (isinstance(v, str) and v.strip()):
                empty_text.append(f"{n['id']}.{p['id']}")
                continue
            for slot in {s.split("}}")[0] for s in v.split("{{")[1:]}:
                if f'"{{{{{slot}}}}}"' not in body:
                    unfilled.append(f"{n['id']}.{p['id']}:{{{{{slot}}}}}")
    check("prose-lives-in-editable-pin-defaults", not empty_text, str(empty_text))
    check("every-slot-is-filled-by-its-node", not unfilled, str(unfilled))

    # (d) every model call carries a CONSTANT role charter on `system`
    MODELS = [nid for nid, t in ntype.items() if t in ("llm_call", "agent")]
    no_charter = [nid for nid in MODELS
                  if not (isinstance(pd_of(nid, "system"), str) and pd_of(nid, "system").strip())]
    check("every-model-call-has-a-system-charter", not no_charter, str(no_charter))
    varying = [nid for nid in MODELS if "{{" in str(pd_of(nid, "system") or "")]
    check("system-charters-are-constant", not varying, str(varying))

    # ---- layer 4: BYTE-FOR-BYTE prompt + report preservation ---------------
    golden = json.loads(GOLDEN_PATH.read_text())
    missing = [c["name"] for c in CASES if c["name"] not in golden]
    check("golden-covers-every-case", not missing, str(missing))
    drift = 0
    for case in CASES:
        name = case["name"]
        if name not in golden:
            continue
        expected = golden[name]["value"]
        nid = case.get("new_node", case["node"])
        inputs = case.get("new_inputs", case["inputs"])
        try:
            if case.get("composite") == "report":
                # each section node composes its OWN lines; the join node puts
                # them in document order - exactly the shipped wiring
                sections = {
                    "head_lines": "report_head", "method_lines": "report_method",
                    "ranked_lines": "report_ranked", "limits_lines": "report_limits"}
                joined = run_node(by_id["report_md"], {
                    slot: list(run_node(by_id[nid2], inputs).get("lines") or [])
                    for slot, nid2 in sections.items()})
                actual = joined.get("report")
            else:
                actual = dig(run_node(by_id[nid], inputs), case.get("new_path", ""))
                if case.get("negate_new"):
                    actual = not bool(actual)
        except Exception as e:  # noqa: BLE001
            check(f"preserved:{name}", False, f"raised {e}")
            drift += 1
            continue
        if actual != expected:
            check(f"preserved:{name}", False, diff_note(expected, actual))
            drift += 1
    check("every-composed-prompt-and-report-byte-is-preserved", drift == 0,
          f"{drift} case(s) drifted")

    # ---- layer 6: ADR-0026 - model-facing text is never cut ----------------
    def _composed(case_name: str) -> str:
        case = next(c for c in CASES if c["name"] == case_name)
        value = dig(run_node(by_id[case["node"]], case["inputs"]), case.get("new_path", ""))
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

    ranked = FX.ADR26_RANKED
    WHOLE = {
        "adr26.fold.feedback_every_critique_whole":
            [r["critique"] for r in FX.ADR26_REVIEWS["reviews"]]
            + [m["reason"] for m in FX.ADR26_MATCHES["matches"]],
        "adr26.expand_prompt.every_open_question": FX.ADR26_OPEN_QUESTIONS,
        "adr26.meta_prompt.every_ranked_whole":
            [FX.ADR26_LONG_LIT] + [h["statement"] for h in ranked]
            + [h["reviews"]["critique"] for h in ranked],
        "adr26.fig_spec_prompt.every_ranked_whole": [h["statement"] for h in ranked],
    }
    for case_name, needles in WHOLE.items():
        text = _composed(case_name)
        cut = [n[:40] for n in needles if n not in text]
        check(f"whole:{case_name}", not cut, f"{len(cut)} input(s) not whole: {cut[:3]}")
    reason = json.loads(_composed("adr26.cite_fold.mismatch_whole_titles"))[0]["reason"]
    check("whole:citation-mismatch-reason-quotes-both-titles",
          FX.ADR26_LONG_CLAIMED in reason and FX.ADR26_LONG_SERVED in reason, reason)
    warns = json.loads(_composed("adr26.cite_apply.warning_whole_title"))
    check("whole:dropped-source-warning-quotes-the-title",
          any(w.count(FX.ADR26_DROPPED_TITLE) >= 2 for w in warns), str(warns)[:300])

    # ---- layer 5: the load-bearing rules survive on their own pins ---------
    # These are the instructions the report-quality wave was fought for. Each
    # must appear in the composed corpus of the stage that has to obey it, so
    # editing a pin default cannot quietly delete one.
    CORPUS = {
        "generate": [("generate", "system"), ("gen_prompt", "brief_text")],
        "reflect": [("reflect", "system"), ("reflect_prompt", "brief_text")],
        "rank": [("rank", "system"), ("rank_prompt", "brief_text")],
        "evolve": [("evolve", "system"), ("evolve_prompt", "brief_text")],
        "expand": [("expand", "system"), ("expand_prompt", "brief_text")],
        "term_reflect": [("term_reflect", "system"), ("term_reflect_prompt", "brief_text")],
        "meta": [("meta", "system"), ("meta_prompt", "brief_text"),
                 ("meta_prompt", "zero_sources_text")],
        "fig_spec": [("fig_spec", "system"), ("fig_spec_prompt", "brief_text")],
        "literature": [("lit_base", "citation_rule_text"),
                       ("lit_base", "no_citation_rule_text"),
                       ("lit_base", "ungrounded_warning_text")],
        "grounding_brief": [("ground", "adversarial_review"),
                            ("ground_retry", "adversarial_review")],
        "report": [("report_head", "provenance_text"),
                   ("report_method", "methodology_text"),
                   ("report_method", "elo_line_text"),
                   ("report_ranked", "ranking_criterion_text"),
                   ("report_limits", "limit_untested_text"),
                   ("report_limits", "limit_selfeval_text"),
                   ("report_limits", "limit_seed_text"),
                   ("report_limits", "limit_cite_verified_text")],
    }
    RULES = {
        # falsification form + evidence-verb honesty + the fabricated-citation ban
        "generate": ["NOVEL, plausible, testable", "falsification", "SAME metric",
                     "EVIDENCE VERBS", "HYPOTHESIZED", "never invent an arXiv id",
                     "DATASETS", "DO NOT restate the title"],
        "reflect": ["correctness", "novelty", "testability", "safety_ok",
                    "AGAINST the literature base", "do not reward ungrounded ambition"],
        "rank": ["Elo tournament", "simulated scientific debate", "PLAUSIBILITY/correctness first"],
        "evolve": ["NEW title naming ITS OWN mechanism", "EVIDENCE VERBS",
                   "HYPOTHESIZED/EXPECTED", "no unadjudicated gap"],
        "expand": ["UNEXPLORED areas", "open a new direction", "Do not invent named benchmarks"],
        "term_reflect": ["DEEP-VERIFICATION", "weakest assumption", "Never fabricate a citation"],
        "meta": ["TITLE:", "ABSTRACT:", "WHAT ELO MEANS", "self-play tournament auto-evaluation",
                 "NOT community consensus", "CITATION HONESTY", "CRITICAL HONESTY RULE",
                 "UNTESTED proposals", "NUMBER FIDELITY", "RANK vs ELO",
                 "GitHub pipe table", "ZERO SOURCES WERE FETCHED"],
        "fig_spec": ["LAYERED diagram spec", "invent nothing else"],
        "literature": ["cite ONLY sources from this fetched list", "NO sources were fetched",
                       "#FALLBACK", "unverifiable parametric recall"],
        "grounding_brief": ["MANDATORY LEDGER DISCIPLINE", "BUDGET RULE",
                            "THE PREVIOUS INVESTIGATION FAILED"],
        "report": ["UNTESTED, ranked proposals", "Untested proposals", "Self-evaluation",
                   "Seed sensitivity", "internal self-play tournament score",
                   "NOT peer review", "Ranking: reviewed", "title-checked"],
    }
    lost = []
    for stage, pins in CORPUS.items():
        corpus = " ".join(json.dumps(pd_of(nid, p), ensure_ascii=False)
                          if not isinstance(pd_of(nid, p), str) else pd_of(nid, p)
                          for nid, p in pins).replace("\n", " ")
        for rule in RULES[stage]:
            if rule not in corpus:
                lost.append(f"{stage}:{rule!r}")
    check("every-load-bearing-rule-survives-the-move-to-pins", not lost, str(lost))

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES[:12]}")
        return 1
    print(f"SMOKE OK ({len(CASES)} preservation cases, {len(code_nodes)} code nodes, "
          f"{len(exprs)} expressions)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
