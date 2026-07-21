#!/usr/bin/env python3
"""Scripted proof of the coding-verify-gates v2 deterministic gate paths.

Drives the REAL compiled flow (examples/flows/coding-verify-gates.json)
through the real abstractruntime with stubbed tools — no LLM, no browser —
proving the redesign's fail-fast behavior (agora c2725/c2735/c2736 co-spec):

  A. empty workspace  -> G0 delivery failure verdict; verifier never invoked
  B. split-brain web  -> G1 integration failure naming the dead sibling;
                         verifier never invoked (the R-Type coding-agent/run2
                         failure class, caught with zero LLM cost)
  C. probe page error -> G3 fail-fast verdict carrying the exact page error
                         (the R-Type react/run1 crash class)
  D. dangling ref     -> G1 failure naming the missing referenced file
  E. dead verifier    -> the verifier agent subrun fails (LLM effect death,
                         the memgraph-hackathon 2026-07-20 class); the gates
                         still return an honest "delivered, not verifiable"
                         verdict: environment failure, EMPTY fixable
                         failures, verifier_died flag — never a fabricated
                         pass, never a fabricated gate failure.

Plus direct unit checks of the GATE3/MERGE fold semantics (fail-closed
no-executor -> environment_failures; probe overrides the LLM's executes for
web artifacts; round-0 blank canvas stays advisory), the verifier/verify-
subflow death folds (MERGE / NEXT_STATE), the environment early-stop, and
the FINAL_REPORT delivered-not-verifiable terminal state.

Run: python3 scripts/coding_agent_v2_gates_smoke.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "abstractruntime" / "src"))

from abstractruntime.core.models import EffectType, RunStatus  # noqa: E402
from abstractruntime.core.runtime import Runtime  # noqa: E402
from abstractruntime.integrations.abstractcore.effect_handlers import make_tool_calls_handler  # noqa: E402
from abstractruntime.integrations.abstractcore.tool_executor import MappingToolExecutor  # noqa: E402
from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore  # noqa: E402
from abstractruntime.visualflow_compiler import compile_visualflow  # noqa: E402
from abstractruntime.visualflow_compiler.visual.code_executor import create_code_handler  # noqa: E402

FLOW_PATH = ROOT / "abstractflow" / "examples" / "flows" / "coding-verify-gates.json"
GEN = ROOT / "abstractflow" / "scripts" / "build_coding_agent_workflow.py"

CHECKS: List[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append(name)
    status = "PASS" if ok else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        raise SystemExit(f"check failed: {name}: {detail}")


def run_flow(
    listing_text: str,
    entry_content: str,
    probe_result: Any,
    *,
    round_index: int = 0,
    agent_outcome: Any = None,
) -> Dict[str, Any]:
    """Execute the verify subflow with stubbed tools; return (verdict, journal).

    agent_outcome: when set, the verifier's START_SUBWORKFLOW completes with
    this payload instead of raising — emulating a host that resumed the run
    after the verifier's react subrun reached a terminal state (the gateway
    runner's failed-child resume shape: {"success": false, "error": ...}).
    LLM_CALL always raises: a dead verifier must never reach the structured
    post-pass.
    """
    from abstractruntime.core.runtime import EffectOutcome

    raw = json.loads(FLOW_PATH.read_text(encoding="utf-8"))
    spec = compile_visualflow(raw)

    journal: List[str] = []

    def list_files(**kwargs: Any) -> str:
        journal.append("list_files")
        return listing_text

    def read_file(**kwargs: Any) -> str:
        journal.append("read_file")
        return entry_content

    def browser_probe(**kwargs: Any) -> Any:
        journal.append("browser_probe")
        if isinstance(probe_result, Exception):
            raise probe_result
        return probe_result

    def fail_agent(run: Any, effect: Any, default_next_node: Any) -> Any:
        journal.append("AGENT_INVOKED")
        raise AssertionError("verifier agent must not run on deterministic fail-fast paths")

    def start_sub(run: Any, effect: Any, default_next_node: Any) -> Any:
        if agent_outcome is not None:
            journal.append("AGENT_SUBRUN_TERMINAL")
            return EffectOutcome.completed(agent_outcome)
        return fail_agent(run, effect, default_next_node)

    runtime = Runtime(
        run_store=InMemoryRunStore(),
        ledger_store=InMemoryLedgerStore(),
        effect_handlers={
            EffectType.TOOL_CALLS: make_tool_calls_handler(
                tools=MappingToolExecutor.from_tools([list_files, read_file, browser_probe])
            ),
            EffectType.START_SUBWORKFLOW: start_sub,
            EffectType.LLM_CALL: fail_agent,
        },
    )

    run_id = runtime.start(workflow=spec, vars={"input_data": {
        "request": "Build an R-Type style shooter",
        "workspace_root": "",
        "build_command": "",
        "run_command": "",
        "round_index": round_index,
    }})
    state = runtime.tick(workflow=spec, run_id=run_id)
    assert state.status == RunStatus.COMPLETED, f"run ended {state.status}: {state.error}"
    out = state.output or {}
    verdict = out.get("verdict") if isinstance(out, dict) else None
    assert isinstance(verdict, dict), f"no verdict in output: {out!r}"
    verdict["_journal"] = journal
    return verdict


def code_body(name: str) -> str:
    """Load a generator code-body constant without executing main()."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("bld", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return getattr(mod, name)


def run_code(body: str, inputs: Dict[str, Any]) -> Any:
    """Execute a code-node body exactly the way the visual executor wraps it."""
    lines = ["def transform(_input):"]
    for key in inputs:
        lines.append(f"    {key} = _input.get({json.dumps(key)})")
    for line in body.replace("\r\n", "\n").split("\n"):
        lines.append(f"    {line}")
    handler = create_code_handler("\n".join(lines) + "\n", "transform", permissions="sandbox")
    return handler(inputs)


def main() -> int:
    print("scenario A: empty workspace -> G0 delivery fail, no LLM")
    v = run_flow("Entries in '/ws' matching '*' (hidden entries excluded):", "", {})
    check("A verdict fails", v.get("all_passed") is False)
    check("A delivery failure named", any("delivery" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("A gate_source deterministic", v.get("gate_source") == "deterministic", str(v.get("gate_source")))
    check("A verifier never ran", "AGENT_INVOKED" not in v["_journal"])
    check("A probe never ran", "browser_probe" not in v["_journal"])

    print("scenario B: split-brain (dead game.js, inline loop) -> G1 fail, no LLM, no browser")
    listing = (
        "Entries in '/ws' matching '*' (hidden entries excluded):\n"
        "  game.js (2000 bytes)\n"
        "  index.html (4200 bytes)"
    )
    html_inline_only = "<html><body><canvas id='c'></canvas><script>let x=bgOffset;</script></body></html>"
    v = run_flow(listing, html_inline_only, {})
    check("B verdict fails", v.get("all_passed") is False)
    check("B split-brain named", any("split-brain" in str(f) and "game.js" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("B verifier never ran", "AGENT_INVOKED" not in v["_journal"])
    check("B probe never ran", "browser_probe" not in v["_journal"])

    print("scenario C: integration clean, probe finds ReferenceError -> G3 fail-fast with exact error")
    html_ok = "<html><body><canvas id='c'></canvas><script src=\"game.js\"></script></body></html>"
    probe_fail = {
        "ok": False, "stage": "run", "engine": "python-playwright",
        "page_errors": ["ReferenceError: bgOffset is not defined"],
        "console_errors": [], "diag": {"has_canvas": True, "non_blank_samples": 3},
    }
    v = run_flow(listing, html_ok, probe_fail)
    check("C verdict fails", v.get("all_passed") is False)
    check("C page error carried verbatim", any("ReferenceError: bgOffset" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("C gate_source probe", v.get("gate_source") == "deterministic+probe", str(v.get("gate_source")))
    check("C probe ran", "browser_probe" in v["_journal"])
    check("C verifier never ran", "AGENT_INVOKED" not in v["_journal"])

    print("scenario D: dangling reference -> G1 fail naming the missing file")
    html_dangling = "<html><script src=\"missing.js\"></script><script src=\"game.js\"></script></html>"
    v = run_flow(listing, html_dangling, {})
    check("D missing ref named", any("missing.js" in str(f) and "does not exist" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("D verifier never ran", "AGENT_INVOKED" not in v["_journal"])

    print("scenario E: gates pass, verifier subrun DIES -> delivered-not-verifiable verdict (2026-07-20 class)")
    html_ok_e = "<html><body><canvas id='c'></canvas><script src=\"game.js\"></script></body></html>"
    probe_ok = {
        "ok": True, "stage": "run", "engine": "python-playwright",
        "page_errors": [], "console_errors": [], "failed_requests": [],
        "diag": {"has_canvas": True, "non_blank_samples": 40, "sampled_pixels": 369},
    }
    dead = {"sub_run_id": "dead-react-run", "output": {
        "success": False,
        "error": "Effect failed after 3 attempts: API error: 'NoneType' object has no attribute 'prompt_tokens'",
    }}
    v = run_flow(listing, html_ok_e, probe_ok, agent_outcome=dead)
    check("E verdict is not a pass", v.get("all_passed") is False)
    check("E verifier_died flagged", v.get("verifier_died") is True, str(v))
    check("E no fabricated fixable failures", v.get("failures") == [], str(v.get("failures")))
    check("E environment failure names the dead verifier",
          any("verification unavailable" in str(f) for f in v.get("environment_failures", [])),
          str(v.get("environment_failures")))
    check("E deterministic PASS evidence carried",
          bool(v.get("delivered")) and bool((v.get("deterministic") or {}).get("delivery_ok")), str(v))
    check("E probe execution result stands", v.get("executes") is True, str(v))
    check("E artifacts still named", bool(v.get("artifacts")), str(v.get("artifacts")))
    check("E structured post-pass never ran", "AGENT_INVOKED" not in v["_journal"], str(v["_journal"]))

    print("unit: GATE1 red-team false-positive classes stay quiet")
    gate1 = code_body("GATE1_CODE")
    g0 = {"web_class": True, "entrypoint": "index.html",
          "files": ["index.html", "game.js", "vite.config.js", "style.css"], "delivery_ok": True}
    html = (
        "<html><head><link rel='stylesheet' href='style.css'></head><body>"
        "<a href='/about'>about</a><a href='#top'>top</a>"
        "<img data-src='lazy.png'>"
        "<canvas></canvas>"
        "<script type='module'>import './game.js'; const i=new Image(); i.src='gen.png';</script>"
        "</body></html>"
    )
    r = run_code(gate1, {"gate0_out": g0, "entry_content": html, "entry_ok": True})
    check("routes/anchors/data-src/inline-js-src/config.js all quiet", r["integration_ok"] is True, str(r["failures"]))
    html_sb = "<html><body><canvas></canvas><script>let x=bgOffset;</script></body></html>"
    r = run_code(gate1, {"gate0_out": {"web_class": True, "entrypoint": "index.html", "files": ["index.html", "game.js"], "delivery_ok": True}, "entry_content": html_sb, "entry_ok": True})
    check("true split-brain still caught", not r["integration_ok"] and any("split-brain" in str(f) for f in r["failures"]), str(r["failures"]))
    html_dang = "<html><body><script src='missing.js'></script><script src='game.js'></script></body></html>"
    r = run_code(gate1, {"gate0_out": {"web_class": True, "entrypoint": "index.html", "files": ["index.html", "game.js"], "delivery_ok": True}, "entry_content": html_dang, "entry_ok": True})
    check("true dangling ref still caught", not r["integration_ok"] and any("missing.js" in str(f) for f in r["failures"]), str(r["failures"]))
    html_case = "<html><body><script src='Game.js'></script></body></html>"
    r = run_code(gate1, {"gate0_out": {"web_class": True, "entrypoint": "index.html", "files": ["index.html", "game.js"], "delivery_ok": True}, "entry_content": html_case, "entry_ok": True})
    check("case mismatch named honestly", not r["integration_ok"] and any("case mismatch" in str(f) for f in r["failures"]), str(r["failures"]))

    print("unit: GATE4 orphan-function heuristic (spawnBoss class, c2958 ask 2)")
    gate4 = code_body("GATE4_CODE")
    g0w = {"web_class": True, "entrypoint": "index.html", "files": ["index.html"], "delivery_ok": True}
    spawnboss = (
        "<html><body><canvas></canvas><script>"
        "function spawnBoss(){ boss = {hp: 100}; }"  # declared, never referenced again
        "function update(){ if (boss) { tick(); } }"
        "function tick(){ update(); }"  # mutual refs pass
        "window.onload = update;"
        "</script></body></html>"
    )
    r = run_code(gate4, {"gate0_out": g0w, "entry_content": spawnboss, "script_content": "", "script_ok": False})
    check("spawnBoss orphan caught", not r["orphans_ok"] and any("spawnBoss" in str(f) for f in r["failures"]), str(r["failures"]))
    check("referenced functions pass", not any("update" in str(f) or "tick" in str(f) for f in r["failures"]), str(r["failures"]))
    handler_html = "<html><script>function main(){}\nwindow.onload = main; function loop(){ requestAnimationFrame(loop); }\nloop();</script></html>"
    r = run_code(gate4, {"gate0_out": g0w, "entry_content": handler_html, "script_content": "", "script_ok": False})
    check("handler-assigned + recursive functions pass", r["orphans_ok"], str(r["failures"]))
    split_entry = "<html><script src='game.js'></script><script>startGame();</script></html>"
    split_script = "function startGame(){ helper(); } function helper(){} function deadEnd(){}"
    r = run_code(gate4, {"gate0_out": g0w, "entry_content": split_entry, "script_content": split_script, "script_ok": True})
    check("cross-file call resolves, dead fn caught", not r["orphans_ok"] and any("deadEnd" in str(f) for f in r["failures"]) and not any("startGame" in str(f) for f in r["failures"]), str(r["failures"]))
    r = run_code(gate4, {"gate0_out": {"web_class": False}, "entry_content": "function x(){}", "script_content": "", "script_ok": False})
    check("non-web skips orphan gate", r["orphans_ok"], str(r["failures"]))

    print("unit: GATE3 fail-closed + advisory semantics")
    gate3 = code_body("GATE3_CODE")
    g0_web = {"web_class": True, "entrypoint": "index.html", "files": ["index.html"], "delivery_ok": True}

    def raw_of(output: Any, *, success: bool = True, error: str = None, mode: str = "executed") -> Dict[str, Any]:
        return {"mode": mode, "results": [{"call_id": "c", "name": "browser_probe", "success": success, "output": output, "error": error}]}

    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of({"ok": False, "stage": "no-executor", "error": "no engine"}, success=False, error="no engine"), "round_index": 0})
    check("no-executor -> environment failure", bool(r["environment_failures"]) and not r["fixable_failed"], str(r))
    check("no-executor -> executes_web false", r["executes_web"] is False)
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(None, success=False, error="Tool 'browser_probe' not found"), "round_index": 0})
    check("tool missing -> environment failure", bool(r["environment_failures"]) and not r["fixable_failed"], str(r))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": {"mode": "approval_required"}, "round_index": 0})
    check("unapproved call -> environment failure", bool(r["environment_failures"]) and not r["fixable_failed"], str(r))
    blank = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 0}}
    # Red-team fold (2026-07-17): blank canvas BLOCKS the pass on every round
    # (a nothing-renders game must never report PASSED); round 0 gets the
    # draw-one-visible-element wording, repeats get the render-loop wording.
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(blank), "round_index": 0})
    check("round-0 blank canvas fails with actionable wording", r["fixable_failed"] and any("visible element" in str(f) for f in r["failures"]) and r["executes_web"] is False, str(r))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(blank), "round_index": 1})
    check("round-1 blank canvas fails", r["fixable_failed"] and any("still blank" in str(f) for f in r["failures"]), str(r))
    drawn = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 40, "sampled_pixels": 369}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(drawn), "round_index": 0})
    check("live canvas passes G3", not r["fixable_failed"] and r["executes_web"] is True and not r["environment_failures"], str(r))
    # cav2 escape (c2945): 1/369 lit = corner-ninth render must FAIL now.
    corner = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 1, "sampled_pixels": 369, "canvas_w": 640, "canvas_h": 576}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(corner), "round_index": 0})
    check("corner-ninth render (1/369) fails fraction floor", r["fixable_failed"] and any("essentially blank" in str(f) for f in r["failures"]), str(r))
    sparse_ok = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 12, "sampled_pixels": 369}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(sparse_ok), "round_index": 0})
    check("sparse dark game (12/369, >2%) still passes", not r["fixable_failed"] and r["executes_web"] is True, str(r))
    # class 5 second half (c2970 painted_bbox): corner-confined render fails
    # even when the area fraction clears the floor; letterboxed passes.
    corner_bbox = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 40, "sampled_pixels": 369, "canvas_w": 640, "canvas_h": 576, "painted_bbox": {"x": 0, "y": 0, "w": 213, "h": 192}}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(corner_bbox), "round_index": 0})
    check("corner-confined bbox (33%x33%) fails extent check", r["fixable_failed"] and any("painted area covers only" in str(f) for f in r["failures"]), str(r))
    letterbox = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 150, "sampled_pixels": 369, "canvas_w": 640, "canvas_h": 576, "painted_bbox": {"x": 0, "y": 144, "w": 640, "h": 288}}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(letterbox), "round_index": 0})
    check("letterboxed render (full width, half height) passes", not r["fixable_failed"] and r["executes_web"] is True, str(r))
    full_bbox = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 300, "sampled_pixels": 369, "canvas_w": 640, "canvas_h": 576, "painted_bbox": {"x": 0, "y": 0, "w": 628, "h": 570}}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(full_bbox), "round_index": 0})
    check("full-canvas render passes extent check", not r["fixable_failed"] and r["executes_web"] is True, str(r))
    no_bbox = {"ok": True, "stage": "run", "diag": {"has_canvas": True, "non_blank_samples": 40, "sampled_pixels": 369}}
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(no_bbox), "round_index": 0})
    check("older probe without bbox degrades gracefully", not r["fixable_failed"] and r["executes_web"] is True, str(r))

    print("unit: MERGE probe-overrides-LLM for web executes")
    merge = code_body("MERGE_VERDICT_CODE")
    v_llm_optimist = {"builds": True, "executes": True, "matches": True, "failures": [], "artifacts": ["index.html"], "summary": "looks fine"}
    g3_env = {"web": True, "ran": True, "stage": "no-executor", "executes_web": False,
              "environment_failures": ["no browser executor available on this host to run index.html: no engine"], "warnings": []}
    r = run_code(merge, {"verifier_data": v_llm_optimist, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_env})
    check("merge: LLM executes=true overridden by probe", r["executes"] is False and r["all_passed"] is False, str(r))
    check("merge: env failures ride", bool(r["environment_failures"]))
    g3_ok = {"web": True, "ran": True, "stage": "run", "executes_web": True, "environment_failures": [], "warnings": []}
    v_llm_pessimist = dict(v_llm_optimist, executes=False, run_error="decided by browser probe")
    r = run_code(merge, {"verifier_data": v_llm_pessimist, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok})
    check("merge: probe pass + builds/matches pass -> all_passed", r["all_passed"] is True, str(r))

    print("unit: MERGE verifier-death fold (2026-07-20 class)")
    r = run_code(merge, {"verifier_data": None, "verifier_ok": False,
                         "verifier_response": "The agent stopped because the model provider failed (HTTP 500).",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok})
    check("merge death: never a pass", r["all_passed"] is False, str(r))
    check("merge death: verifier_died + delivered flags", r.get("verifier_died") is True and r.get("delivered") is True, str(r))
    check("merge death: no fabricated fixable failures", r["failures"] == [], str(r["failures"]))
    check("merge death: env failure carries cause + evidence",
          any("verification unavailable" in str(f) and "browser probe" in str(f) for f in r["environment_failures"]),
          str(r["environment_failures"]))
    check("merge death: probe executes result stands", r["executes"] is True, str(r))
    # Death + env-blocked probe: both env classes ride, executes stays false.
    r = run_code(merge, {"verifier_data": {}, "verifier_ok": False, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_env})
    check("merge death+no-executor: both env failures ride", len(r["environment_failures"]) >= 2 and r["executes"] is False, str(r))
    # Guard: a REPORTED failure (verdict present) must NOT trip the death fold.
    v_reported = {"builds": False, "build_error": "SyntaxError", "executes": True, "matches": True,
                  "all_passed": False, "failures": ["build: SyntaxError in game.js"], "environment_failures": [],
                  "summary": "build failed", "artifacts": ["index.html"]}
    r = run_code(merge, {"verifier_data": v_reported, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok})
    check("merge: reported failure keeps the reprompt lane", r["failures"] == ["build: SyntaxError in game.js"] and not r.get("verifier_died"), str(r))

    print("unit: NEXT_STATE verify-subflow-death fold")
    next_state = code_body("NEXT_STATE_CODE")
    r = run_code(next_state, {"verifier": {}, "verify_meta": {"success": False, "error": "Effect failed after 3 attempts: API error: 'NoneType' object has no attribute 'prompt_tokens'"}, "round_index": 0})
    check("next_state death: env failure carries the error", any("NoneType" in str(f) for f in r["environment_failures"]), str(r))
    check("next_state death: no fabricated fixable failures", r["failures"] == [] and r["all_passed"] is False, str(r))
    check("next_state death: synthetic verdict flagged", r["last_verdict"].get("verifier_died") is True, str(r["last_verdict"]))
    r = run_code(next_state, {"verifier": {"all_passed": False, "builds": False, "executes": False, "matches": False,
                                           "failures": ["fix me"], "environment_failures": []},
                              "verify_meta": {"verdict": {}}, "round_index": 0})
    check("next_state: real verdict keeps the reprompt lane", r["failures"] == ["fix me"] and not r["last_verdict"].get("verifier_died"), str(r))

    print("unit: LOOP_CONDITION stops early on environment-only failures")
    loop = code_body("LOOP_CONDITION_CODE")
    r = run_code(loop, {"loop_state": {"rounds_completed": 1, "all_passed": False, "failures": [], "environment_failures": ["no executor"]}, "max_rounds": 3})
    check("env-only -> stop early", r["condition"] is False, str(r))
    r = run_code(loop, {"loop_state": {"rounds_completed": 1, "all_passed": False, "failures": ["fix me"], "environment_failures": ["no executor"]}, "max_rounds": 3})
    check("mixed failures -> keep going", r["condition"] is True, str(r))
    r = run_code(loop, {"loop_state": {"rounds_completed": 1, "all_passed": False, "failures": [],
                                       "environment_failures": ["verification unavailable: the LLM verifier failed before returning a verdict"]},
                        "max_rounds": 3})
    check("dead verifier -> stop early, no round burn", r["condition"] is False, str(r))

    print("unit: FINAL_REPORT delivered-not-verifiable terminal state")
    final_report = code_body("FINAL_REPORT_CODE")
    listing_txt = (
        "Entries in '/ws' matching '*' (hidden entries excluded):\n"
        "  index.html (4200 bytes)\n"
        "  game.js (2000 bytes)"
    )
    death_state = {
        "rounds_completed": 1, "all_passed": False, "failures": [],
        "environment_failures": ["verification unavailable: the verifier agent failed before returning a verdict"],
        "last_verdict": {"verifier_died": True, "all_passed": False, "builds": False, "executes": True,
                         "matches": False, "failures": [], "artifacts": [],
                         "deterministic": {"delivery_ok": True, "integration_ok": True},
                         "summary": "delivered, verification incomplete"},
    }
    r = run_code(final_report, {"loop_state": death_state, "final_listing": listing_txt, "final_listing_ok": True})
    check("report: DELIVERED status, not failed", "DELIVERED" in r["report_markdown"].split("\n")[2], r["report_markdown"].split("\n")[2])
    check("report: success reflects delivered, passed stays strict", r["success"] is True and r["passed"] is False and r["delivered"] is True, str({k: r[k] for k in ("success", "passed", "delivered")}))
    check("report: artifacts named from terminal listing", "index.html" in r["artifacts"], str(r["artifacts"]))
    check("report: verifier death stated", "DIED before reporting" in r["report_markdown"], r["report_markdown"])
    fail_state = {
        "rounds_completed": 3, "all_passed": False,
        "failures": ["execute(web): page error in index.html: ReferenceError: x"],
        "environment_failures": [],
        "last_verdict": {"all_passed": False, "builds": True, "executes": False, "matches": True,
                         "failures": ["execute(web): page error in index.html: ReferenceError: x"],
                         "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}},
    }
    r = run_code(final_report, {"loop_state": fail_state, "final_listing": listing_txt, "final_listing_ok": True})
    check("report: genuine gate failure stays STOPPED / success=false", r["success"] is False and "STOPPED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    pass_state = {"rounds_completed": 1, "all_passed": True, "failures": [], "environment_failures": [],
                  "last_verdict": {"all_passed": True, "builds": True, "executes": True, "matches": True,
                                   "failures": [], "artifacts": ["index.html"]}}
    r = run_code(final_report, {"loop_state": pass_state, "final_listing": listing_txt, "final_listing_ok": True})
    check("report: pass stays PASSED / success=true", r["success"] is True and r["passed"] is True and "PASSED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    # Env-blocked (missing executor) with delivered artifact: same honest class.
    env_state = {
        "rounds_completed": 1, "all_passed": False, "failures": [],
        "environment_failures": ["no browser executor available on this host to run index.html: no engine"],
        "last_verdict": {"all_passed": False, "builds": True, "executes": False, "matches": True, "failures": [],
                         "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}},
    }
    r = run_code(final_report, {"loop_state": env_state, "final_listing": listing_txt, "final_listing_ok": True})
    check("report: env-blocked delivered run reads DELIVERED / success=true", r["success"] is True and "DELIVERED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    # Nothing delivered + dead verifier: never claim delivered.
    r = run_code(final_report, {"loop_state": death_state | {"last_verdict": {"verifier_died": True, "all_passed": False, "failures": [], "artifacts": [], "deterministic": {}}},
                                "final_listing": "Entries in '/ws' matching '*' (hidden entries excluded):", "final_listing_ok": True})
    check("report: empty workspace + dead verifier is NOT delivered", r["delivered"] is False and r["success"] is False, str(r))

    print(f"\nALL {len(CHECKS)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
