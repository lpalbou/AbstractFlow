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
  F. stale SELFCHECK  -> G5 hash binding (0.2.4 R3): an ARTIFACT-SHA256 line
                         that no longer matches the delivered bytes fails
                         deterministically ("modified after last
                         self-verification"); a matching hash sails through.
  G. dangling DOM id  -> G6 DOM contract (0.2.4): a JS-referenced element id
                         missing from the markup fails deterministically
                         (the memgraph r3 '#timeRange' class).

Plus direct unit checks of the GATE3/MERGE fold semantics (fail-closed
no-executor -> environment_failures; probe overrides the LLM's executes for
web artifacts; round-0 blank canvas stays advisory), the verifier/verify-
subflow death folds (MERGE / NEXT_STATE), the environment early-stop, the
FINAL_REPORT delivered-not-verifiable terminal state, and the 0.2.4 wave
(memgraph forensics R1-R5 + DOM gate): GATE5/GATE_DOM semantics, the
BUILDER_PROMPT repair/rebuild branches, the same-signature stall guard,
NEXT_STATE attempt memory + best-round tracking + mode economics,
ROUND_MODE_PINS budget shaping, RESTORE_DECIDE best-over-final delivery,
MERGE feature_checks folding, and the restore-aware FINAL_REPORT.

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

FLOW_PATH = Path(__file__).resolve().parents[1] / "examples" / "flows" / "coding-verify-gates.json"
GEN = Path(__file__).resolve().parent / "build_coding_agent_workflow.py"

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
    selfcheck_content: Any = None,
    shasum_output: str = "",
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
        path = str(kwargs.get("file_path") or "")
        if path.rsplit("/", 1)[-1] == "SELFCHECK.md":
            if selfcheck_content is None:
                return "Error: File not found: SELFCHECK.md"
            return str(selfcheck_content)
        return entry_content

    def execute_command(**kwargs: Any) -> str:
        journal.append("execute_command")
        return shasum_output

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
                tools=MappingToolExecutor.from_tools([list_files, read_file, browser_probe, execute_command])
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

    print("scenario F: stale SELFCHECK hash (G5, 0.2.4 R3) -> deterministic fail naming the mechanism")
    aa = "a" * 64
    bb = "b" * 64
    selfcheck_stale = "# SELFCHECK\nPlayback verified: visibleNodes grew 1364 -> 35.\nARTIFACT-SHA256: index.html " + aa
    v = run_flow(listing, html_ok_e, probe_ok, selfcheck_content=selfcheck_stale, shasum_output=bb + "  index.html")
    check("F stale selfcheck fails the round", v.get("all_passed") is False)
    check("F failure names the mechanism",
          any("self-report stale" in str(f) and "modified after the last self-verification" in str(f) for f in v.get("failures", [])),
          str(v.get("failures")))
    check("F gate_source deterministic (fail-fast)", v.get("gate_source") == "deterministic", str(v.get("gate_source")))
    check("F probe never ran", "browser_probe" not in v["_journal"])
    check("F verifier never ran", "AGENT_INVOKED" not in v["_journal"])
    # Matching hash: G5 quiet, the round proceeds to probe + verifier lane
    # (dead-agent outcome reused so no real LLM is needed).
    v = run_flow(listing, html_ok_e, probe_ok, selfcheck_content=selfcheck_stale, shasum_output=aa + "  index.html", agent_outcome=dead)
    check("F matching hash sails through G5 (no self-report failure)",
          not any("self-report" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("F hash recompute actually ran", "execute_command" in v["_journal"], str(v["_journal"]))

    print("scenario G: dangling DOM id (G6, 0.2.4) -> deterministic fail (the memgraph r3 '#timeRange' class)")
    html_dom = (
        "<html><body>"
        "<input id=\"timeStart\" type=\"range\"><input id=\"timeEnd\" type=\"range\">"
        "<canvas id=\"cv\"></canvas>"
        "<script src=\"game.js\"></script>"
        "<script>document.getElementById('timeRange').oninput = 1; "
        "var el = document.querySelector('#cv'); var c = grad('#e8e8e8');</script>"
        "</body></html>"
    )
    v = run_flow(listing, html_dom, {})
    check("G verdict fails", v.get("all_passed") is False)
    check("G dangling '#timeRange' named",
          any("dom-contract" in str(f) and "timeRange" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("G defined ids not flagged",
          not any("timeStart" in str(f) or "timeEnd" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("G resolved ref + hex color stay quiet",
          not any("'#cv'" in str(f) or "e8e8e8" in str(f) for f in v.get("failures", [])), str(v.get("failures")))
    check("G probe never ran", "browser_probe" not in v["_journal"])
    check("G verifier never ran", "AGENT_INVOKED" not in v["_journal"])

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
    check("tool missing NAMES the branch", any("NOT MOUNTED" in str(f) for f in r["environment_failures"]), str(r["environment_failures"]))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": {"mode": "approval_required"}, "round_index": 0})
    check("unapproved call -> environment failure", bool(r["environment_failures"]) and not r["fixable_failed"], str(r))
    check("unapproved call NAMES the branch", any("REFUSED" in str(f) and "auto_approve_tools" in str(f) for f in r["environment_failures"]), str(r["environment_failures"]))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(None, success=False, error="browser_probe is not allowed for this node"), "round_index": 0})
    check("policy refusal NAMES the branch", any("REFUSED" in str(f) for f in r["environment_failures"]), str(r["environment_failures"]))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(42), "round_index": 0})
    check("unparseable result NAMES the branch", any("UNREADABLE" in str(f) for f in r["environment_failures"]), str(r["environment_failures"]))

    # --- TEXT-shape probe results (operator-reported drift, 2026-07-30) ------
    # This host's abstractcore returns browser_probe's PASS/FAIL REPORT as a
    # plain string (its documented, test-pinned return: "A PASS/FAIL report").
    # The gate used to require a dict at results[0].output, so a real probe
    # that RENDERED THE PAGE read as "did not run" and the run stopped with
    # `web execution gate unavailable: ... : executed` (the trailing token was
    # `mode`). These strings are copied from abstractcore's own probe output.
    pass_text = (
        "Browser probe: PASS (navigation only — no content assertions requested)\n"
        "Target: file:///w/index.html (local file; network blocked (no outbound attempts))\n"
        "HTTP status: 200\nNavigation: 0.04s\nreadyState: complete | title: 'Snake Game'\n"
        "Visible text: 97 chars — \"Snake Score: 0 Restart\"\n"
        "Visual elements (canvas/svg/img/video/embed): 1\n"
        "Console: clean (no errors, no uncaught exceptions)\nTiming: 0.63s total (budget 20s)"
    )
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(pass_text), "round_index": 0})
    check("text-shape PASS is EXERCISED (ran)", r["ran"] is True and r["executes_web"] is True and not r["environment_failures"], str(r))
    check("text-shape PASS warns about missing canvas diag", any("canvas-liveness" in str(w) for w in r["warnings"]), str(r["warnings"]))
    # The operator's actual run: PASS verdict, but the page threw. With
    # require_nonblank=false the probe passes on navigation alone, so an
    # uncaught exception must still fail the gate.
    dirty_text = pass_text.replace(
        "Console: clean (no errors, no uncaught exceptions)",
        "Console: 0 error(s), 1 uncaught exception(s) — a page can render and still be broken:\n"
        "  [uncaught] Invalid or unexpected token",
    )
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(dirty_text), "round_index": 0})
    check("text-shape PASS + uncaught exception FAILS the gate", r["ran"] is True and r["fixable_failed"]
          and any("Invalid or unexpected token" in str(f) for f in r["failures"]) and r["executes_web"] is False, str(r))
    fail_text = (
        "Browser probe: FAIL — 1 check(s) failed\nTarget: file:///w/index.html (local file)\n"
        "Checks:\n  ✗ nonblank — page stayed blank within budget (no visible text, no canvas/svg/img/video) (4.0s)\n"
        "Console: 1 error(s), 0 uncaught exception(s) — a page can render and still be broken:\n"
        "  [error] ReferenceError: draw is not defined (at file:///w/game.js:12)"
    )
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(fail_text), "round_index": 0})
    check("text-shape FAIL is a FIXABLE failure, not an environment one", r["ran"] is True and r["fixable_failed"]
          and not r["environment_failures"] and any("draw is not defined" in str(f) for f in r["failures"]), str(r))
    # The install hints are ❌-prefixed, so the tool executor moves them to
    # results[0].error (output stays None) with the ❌ stripped.
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(
        None, success=False,
        error="Missing dependency: `playwright`\nbrowser_probe renders pages in a headless browser via Playwright.\nInstall (2 steps): pip install \"abstractcore[browser]\""),
        "round_index": 0})
    check("playwright missing -> no-executor environment failure", bool(r["environment_failures"])
          and not r["fixable_failed"] and r["stage"] == "no-executor", str(r))
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(
        None, success=False, error="Browser binary missing: Playwright is installed but its Chromium headless shell is not."), "round_index": 0})
    check("chromium missing -> no-executor environment failure", bool(r["environment_failures"])
          and not r["fixable_failed"] and r["stage"] == "no-executor", str(r))
    # `rendered` beside structured fields (the dual-channel shape): the
    # structured payload wins, no text parse, no #FALLBACK warning.
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(
        {"rendered": pass_text, "ok": True, "stage": "run",
         "diag": {"has_canvas": True, "non_blank_samples": 40, "sampled_pixels": 369}}), "round_index": 0})
    check("structured payload still wins over `rendered`", r["executes_web"] is True and r["stage"] == "run"
          and not any("canvas-liveness" in str(w) for w in r["warnings"]), str(r))
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
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_env, "gate5_out": {}})
    check("merge: LLM executes=true overridden by probe", r["executes"] is False and r["all_passed"] is False, str(r))
    check("merge: env failures ride", bool(r["environment_failures"]))
    g3_ok = {"web": True, "ran": True, "stage": "run", "executes_web": True, "environment_failures": [], "warnings": []}
    v_llm_pessimist = dict(v_llm_optimist, executes=False, run_error="decided by browser probe")
    r = run_code(merge, {"verifier_data": v_llm_pessimist, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("merge: probe pass + builds/matches pass -> all_passed", r["all_passed"] is True, str(r))

    print("unit: MERGE verifier-death fold (2026-07-20 class)")
    r = run_code(merge, {"verifier_data": None, "verifier_ok": False,
                         "verifier_response": "The agent stopped because the model provider failed (HTTP 500).",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("merge death: never a pass", r["all_passed"] is False, str(r))
    check("merge death: verifier_died + delivered flags", r.get("verifier_died") is True and r.get("delivered") is True, str(r))
    check("merge death: no fabricated fixable failures", r["failures"] == [], str(r["failures"]))
    check("merge death: env failure carries cause + evidence",
          any("verification unavailable" in str(f) and "browser probe" in str(f) for f in r["environment_failures"]),
          str(r["environment_failures"]))
    check("merge death: probe executes result stands", r["executes"] is True, str(r))
    # Death + env-blocked probe: both env classes ride, executes stays false.
    r = run_code(merge, {"verifier_data": {}, "verifier_ok": False, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_env, "gate5_out": {}})
    check("merge death+no-executor: both env failures ride", len(r["environment_failures"]) >= 2 and r["executes"] is False, str(r))
    # Guard: a REPORTED failure (verdict present) must NOT trip the death fold.
    v_reported = {"builds": False, "build_error": "SyntaxError", "executes": True, "matches": True,
                  "all_passed": False, "failures": ["build: SyntaxError in game.js"], "environment_failures": [],
                  "summary": "build failed", "artifacts": ["index.html"]}
    r = run_code(merge, {"verifier_data": v_reported, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("merge: reported failure keeps the reprompt lane", r["failures"] == ["build: SyntaxError in game.js"] and not r.get("verifier_died"), str(r))

    print("unit: NEXT_STATE verify-subflow-death fold")
    next_state = code_body("NEXT_STATE_CODE")
    r = run_code(next_state, {"verifier": {}, "verify_meta": {"success": False, "error": "Effect failed after 3 attempts: API error: 'NoneType' object has no attribute 'prompt_tokens'"}, "round_index": 0,
                              "builder_report": "", "prev_state": {}, "snapshot_ok": True})
    check("next_state death: env failure carries the error", any("NoneType" in str(f) for f in r["environment_failures"]), str(r))
    check("next_state death: no fabricated fixable failures", r["failures"] == [] and r["all_passed"] is False, str(r))
    check("next_state death: synthetic verdict flagged", r["last_verdict"].get("verifier_died") is True, str(r["last_verdict"]))
    r = run_code(next_state, {"verifier": {"all_passed": False, "builds": False, "executes": False, "matches": False,
                                           "failures": ["fix me"], "environment_failures": []},
                              "verify_meta": {"verdict": {}}, "round_index": 0,
                              "builder_report": "", "prev_state": {}, "snapshot_ok": True})
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
    r = run_code(final_report, {"loop_state": death_state, "final_listing": listing_txt, "final_listing_ok": True, "restore_out": {}, "restore_ok": None})
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
    r = run_code(final_report, {"loop_state": fail_state, "final_listing": listing_txt, "final_listing_ok": True, "restore_out": {}, "restore_ok": None})
    check("report: genuine gate failure stays STOPPED / success=false", r["success"] is False and "STOPPED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    pass_state = {"rounds_completed": 1, "all_passed": True, "failures": [], "environment_failures": [],
                  "last_verdict": {"all_passed": True, "builds": True, "executes": True, "matches": True,
                                   "failures": [], "artifacts": ["index.html"]}}
    r = run_code(final_report, {"loop_state": pass_state, "final_listing": listing_txt, "final_listing_ok": True, "restore_out": {}, "restore_ok": None})
    check("report: pass stays PASSED / success=true", r["success"] is True and r["passed"] is True and "PASSED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    # Env-blocked (missing executor) with delivered artifact: same honest class.
    env_state = {
        "rounds_completed": 1, "all_passed": False, "failures": [],
        "environment_failures": ["no browser executor available on this host to run index.html: no engine"],
        "last_verdict": {"all_passed": False, "builds": True, "executes": False, "matches": True, "failures": [],
                         "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}},
    }
    r = run_code(final_report, {"loop_state": env_state, "final_listing": listing_txt, "final_listing_ok": True, "restore_out": {}, "restore_ok": None})
    check("report: env-blocked delivered run reads DELIVERED / success=true", r["success"] is True and "DELIVERED" in r["report_markdown"], r["report_markdown"].split("\n")[2])
    # Nothing delivered + dead verifier: never claim delivered.
    r = run_code(final_report, {"loop_state": death_state | {"last_verdict": {"verifier_died": True, "all_passed": False, "failures": [], "artifacts": [], "deterministic": {}}},
                                "final_listing": "Entries in '/ws' matching '*' (hidden entries excluded):", "final_listing_ok": True,
                                "restore_out": {}, "restore_ok": None})
    check("report: empty workspace + dead verifier is NOT delivered", r["delivered"] is False and r["success"] is False, str(r))

    # ------------------------------------------------------------------
    # 0.2.4 wave (memgraph forensics R1-R5 + DOM gate)
    # ------------------------------------------------------------------
    aa = "a" * 64
    bb = "b" * 64

    print("unit: GATE5 hash-binding semantics (R3)")
    gate5 = code_body("GATE5_CODE")
    r = run_code(gate5, {"selfcheck_content": "Error: File not found: SELFCHECK.md", "selfcheck_ok": False, "hash_output": ""})
    check("G5 missing selfcheck -> advisory warning only", r["selfcheck_ok"] and not r["failures"] and any("unattested" in str(w) for w in r["warnings"]), str(r))
    r = run_code(gate5, {"selfcheck_content": "# SELFCHECK\nAll verified by probe.", "selfcheck_ok": True, "hash_output": ""})
    check("G5 present-but-unbound -> failure", not r["selfcheck_ok"] and any("no ARTIFACT-SHA256" in str(f) for f in r["failures"]), str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": aa + "  index.html"})
    check("G5 matching hash passes", r["selfcheck_ok"] and not r["failures"] and r["claims"] == 1, str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: ./index.html " + aa.upper(), "selfcheck_ok": True, "hash_output": aa + " *./index.html"})
    check("G5 tolerant of ./ prefix, case, and shasum '*' mode marker", r["selfcheck_ok"] and not r["failures"], str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": bb + "  index.html"})
    check("G5 mismatch -> stale failure naming the mechanism", not r["selfcheck_ok"] and any("modified after the last self-verification" in str(f) for f in r["failures"]), str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: gone.html " + aa, "selfcheck_ok": True, "hash_output": aa + "  index.html"})
    check("G5 unhashable claimed file -> unbound failure", not r["selfcheck_ok"] and any("gone.html" in str(f) and "could not be hashed" in str(f) for f in r["failures"]), str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": "sh: shasum: command not found"})
    check("G5 host cannot hash -> #FALLBACK warning, never a failure", r["selfcheck_ok"] and any("#FALLBACK" in str(w) for w in r["warnings"]), str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html deadbeef", "selfcheck_ok": True, "hash_output": ""})
    check("G5 malformed hash line -> unbound failure", not r["selfcheck_ok"] and any("valid sha256" in str(f) for f in r["failures"]), str(r))
    # Live-found (first 0.2.4 gateway run): read_file DECORATES content with
    # "N: " line-number prefixes — the claims must still parse through them.
    decorated = "File: /ws/SELFCHECK.md (3 lines)\n 1: ok\n 2: ARTIFACT-SHA256: index.html " + aa + "\n 3: end"
    r = run_code(gate5, {"selfcheck_content": decorated, "selfcheck_ok": True, "hash_output": aa + "  index.html"})
    check("G5 parses claims through read_file line-number decoration", r["selfcheck_ok"] and r["claims"] == 1 and not r["failures"], str(r))
    # Live-found: execute_command returns a DICT ({stdout,...}), not a string —
    # recomputed hashes must come from stdout, and str(dict) must never match.
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True,
                         "hash_output": {"success": True, "stdout": aa + "  index.html", "stderr": "", "return_code": 0}})
    check("G5 reads recomputed hashes from dict-shaped execute_command output", r["selfcheck_ok"] and not r["failures"], str(r))
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True,
                         "hash_output": {"success": True, "stdout": bb + "  index.html", "stderr": "", "return_code": 0}})
    check("G5 dict-shaped mismatch -> stale failure", not r["selfcheck_ok"] and any("modified after" in str(f) for f in r["failures"]), str(r))
    # Live-found (second 0.2.4 gateway run): the tool-APPROVAL resume lane
    # stores the raw {mode, results:[{output:{stdout}}]} envelope in the
    # result_key (the compiler's call_tool pin mapping does not re-run for
    # resumed effects) — the fold must dig hashes out of that shape too.
    envelope = {"mode": "executed", "results": [{"call_id": "gate-selfcheck-hash", "name": "execute_command",
                                                 "success": True,
                                                 "output": {"success": True, "stdout": aa + "  index.html\n", "stderr": "", "return_code": 0}}]}
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": envelope})
    check("G5 reads hashes from the approval-resume results envelope", r["selfcheck_ok"] and not r["failures"], str(r))
    # Live-found (third 0.2.4 gateway run): the DURABLE result_key copy is
    # COMPACTED by the runtime — stdout is dropped, only stdout_preview
    # survives. The fold must fall back to the preview twins.
    compacted = {"mode": "executed", "results": [{"call_id": "gate-selfcheck-hash", "name": "execute_command",
                                                  "success": True,
                                                  "output": {"success": True, "return_code": 0,
                                                             "stdout_preview": aa + "  index.html\n", "stderr_preview": "",
                                                             "stdout_truncated": False, "stderr_truncated": False,
                                                             "rendered": "Command executed"}}]}
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": compacted})
    check("G5 falls back to stdout_preview on compacted durable results", r["selfcheck_ok"] and not r["failures"], str(r))
    # Self-review (2026-07-21): distinguish FILES-missing (a real binding
    # failure — the builder attested a file that is not there) from
    # HOST-can't-hash (tooling absent → honest #FALLBACK). shasum RAN and said
    # "No such file"; no hex parsed -> must be a per-claim failure, NOT a
    # blanket host warning that misattributes the cause.
    phantom = {"success": False, "stdout": "", "stderr": "shasum: ghost.html: No such file or directory\n", "return_code": 1}
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: ghost.html " + aa, "selfcheck_ok": True, "hash_output": phantom})
    check("G5 all-phantom claim -> honest binding failure (not a host #FALLBACK)",
          not r["selfcheck_ok"] and any("ghost.html" in str(f) and "could not be hashed" in str(f) for f in r["failures"]) and not r["warnings"], str(r))
    missing = {"success": False, "stdout": "", "stderr": "sh: shasum: command not found\n", "return_code": 127}
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": missing})
    check("G5 shasum-missing stays #FALLBACK (host tooling, not a failure)",
          r["selfcheck_ok"] and not r["failures"] and any("#FALLBACK" in str(w) for w in r["warnings"]), str(r))

    print("unit: SELFCHECK_HASH_ARGS ws single-quote escape (self-review 2026-07-21)")
    hash_args_ws = code_body("SELFCHECK_HASH_ARGS_CODE")
    r = run_code(hash_args_ws, {"selfcheck_content": "x\nARTIFACT-SHA256: index.html " + aa,
                                "selfcheck_ok": True, "workspace_root": "/tmp/a'b"})
    cmd = r["arguments"]["command"]
    check("ws with a single quote yields a well-formed POSIX cd", cmd.startswith("cd '/tmp/a'\\''b' && shasum"), cmd)

    print("unit: SELFCHECK_HASH_ARGS recompute composition (R3)")
    hash_args = code_body("SELFCHECK_HASH_ARGS_CODE")
    r = run_code(hash_args, {"selfcheck_content": "x\nARTIFACT-SHA256: index.html " + aa + "\nARTIFACT-SHA256: ./game.js " + bb,
                             "selfcheck_ok": True, "workspace_root": "/ws"})
    cmd = r["arguments"]["command"]
    check("hash recompute lists claimed files workspace-relative", "shasum -a 256 -- 'index.html' 'game.js'" in cmd and cmd.startswith("cd '/ws'"), cmd)
    r = run_code(hash_args, {"selfcheck_content": "no binding lines here", "selfcheck_ok": True, "workspace_root": "/ws"})
    check("no claims -> harmless no-op command", r["arguments"]["command"] == "true", str(r))

    print("unit: GATE_DOM contract semantics (memgraph r3: markup rename, dangling JS refs)")
    gate_dom = code_body("GATE_DOM_CODE")
    g0w_dom = {"web_class": True, "entrypoint": "index.html", "files": ["index.html"], "delivery_ok": True}
    r3_like = (
        "<html><body>"
        "<input id=\"timeStart\"><input id=\"timeEnd\"><button id=\"play\">Play</button>"
        "<script>$('#timeRange').oninput = 1; $('#timeRange').value = 0; "
        "document.getElementById('play').onclick = 1; setTime();</script>"
        "</body></html>"
    )
    r = run_code(gate_dom, {"gate0_out": g0w_dom, "entry_content": r3_like, "script_content": "", "script_ok": False})
    check("dom: dangling #timeRange flagged once, resolved #play quiet",
          not r["dom_ok"] and len(r["failures"]) == 1 and "timeRange" in str(r["failures"][0]), str(r["failures"]))
    dyn = (
        "<html><body><div id=\"root\"></div><script>"
        "var el = document.createElement('input'); el.id = 'speed'; "
        "el.setAttribute('id', 'speed2'); "
        "document.querySelector('#speed').oninput = 1; document.getElementById('speed2').oninput = 1; "
        "root.innerHTML = '<canvas id=\"stage\"></canvas>'; document.querySelector('#stage');"
        "</script></body></html>"
    )
    r = run_code(gate_dom, {"gate0_out": g0w_dom, "entry_content": dyn, "script_content": "", "script_ok": False})
    check("dom: dynamically created ids (el.id / setAttribute / template markup) stay quiet", r["dom_ok"], str(r["failures"]))
    colors = "<html><body><canvas id=\"cv\"></canvas><script>ctx.fillStyle = '#fff'; grad('#e8e8e8'); document.querySelector('#cv .layer');</script></body></html>"
    r = run_code(gate_dom, {"gate0_out": g0w_dom, "entry_content": colors, "script_content": "", "script_ok": False})
    check("dom: hex colors quiet, complex-selector leading id resolves", r["dom_ok"], str(r["failures"]))
    missing_complex = "<html><body><div id=\"a\"></div><script>document.querySelector('#hud .score');</script></body></html>"
    r = run_code(gate_dom, {"gate0_out": g0w_dom, "entry_content": missing_complex, "script_content": "", "script_ok": False})
    check("dom: complex selector with missing leading id flagged", not r["dom_ok"] and any("hud" in str(f) for f in r["failures"]), str(r["failures"]))
    split_dom = "<html><body><script src='game.js'></script></body></html>"
    split_js = "document.getElementById('board').width = 100;"
    r = run_code(gate_dom, {"gate0_out": g0w_dom, "entry_content": split_dom, "script_content": split_js, "script_ok": True})
    check("dom: cross-file ref against entry markup checked", not r["dom_ok"] and any("board" in str(f) for f in r["failures"]), str(r["failures"]))
    r = run_code(gate_dom, {"gate0_out": {"web_class": False}, "entry_content": "document.getElementById('x')", "script_content": "", "script_ok": False})
    check("dom: non-web skips the gate", r["dom_ok"], str(r["failures"]))

    print("unit: BUILDER_PROMPT repair branch (R1) — scoped, minimal, memory-carrying")
    builder_prompt = code_body("BUILDER_PROMPT_CODE")
    r3_failure = "execute(web): page error in memory_graph.html: Cannot set properties of null (setting 'oninput')"
    repair_state = {
        "rounds_completed": 1, "all_passed": False, "mode": "repair",
        "failures": [r3_failure],
        "same_signature_count": 0,
        "last_attempt_summary": "",
        "last_verdict": {"artifacts": ["memory_graph.html"], "build_error": "", "run_error": "decided by browser probe",
                         "mismatch": "", "probe": {"engine": "python-playwright", "diag": {"has_canvas": True}}},
    }
    p = run_code(builder_prompt, {"request": "Build a memory graph visualizer", "workspace_root": "/ws", "loop_state": repair_state, "steering": ""})
    check("repair prompt names the artifact", "Artifact under repair: memory_graph.html" in p, p[:600])
    check("repair prompt carries grep tokens (quoted 'oninput' + memory_graph)", "oninput" in p and "memory_graph" in p and "search_files" in p, p)
    check("repair prompt forbids write_file rewrites", "Do NOT rewrite the file with write_file" in p, p)
    check("repair prompt orders read -> search -> minimal edit -> re-probe",
          p.find("Step 1: read") < p.find("Step 2: search_files") < p.find("Step 3:") < p.find("Step 4: re-run"), p)
    check("repair prompt drops the build-round profiling/rules blocks", "PROFILE the inputs" not in p and "Engineering rules" not in p, p)
    check("repair prompt keeps the hash-binding requirement (R3)", "ARTIFACT-SHA256:" in p, p)
    check("repair prompt has no anti-repeat block on a first attempt", "already attempted" not in p, p)
    check("probe-sentinel run_error not echoed", "decided by browser probe" not in p, p)
    repair_state2 = dict(repair_state, same_signature_count=1, last_attempt_summary="Rewrote the whole init IIFE and renamed the slider ids.")
    p = run_code(builder_prompt, {"request": "Build a memory graph visualizer", "workspace_root": "/ws", "loop_state": repair_state2, "steering": ""})
    check("repeated failure prepends the anti-repeat block",
          "already attempted this exact failure set" in p and "Rewrote the whole init IIFE" in p and "Do something different" in p, p)
    rebuild_state = dict(repair_state, mode="rebuild", last_attempt_summary="patched the handler twice")
    p = run_code(builder_prompt, {"request": "Build a memory graph visualizer", "workspace_root": "/ws", "loop_state": rebuild_state, "steering": ""})
    check("rebuild round keeps build rules + forbids reproducing the design",
          "REBUILD ROUND" in p and "do NOT reproduce the same design" in p and "Delivery rules" in p and "PROFILE the inputs" in p, p)
    p = run_code(builder_prompt, {"request": "Build a game", "workspace_root": "/ws", "loop_state": {}, "steering": ""})
    check("round 0 keeps profiling + gains the hash binding", "PROFILE the inputs" in p and "ARTIFACT-SHA256:" in p and ".cg_rounds" in p, p)

    print("unit: 0.2.5 STEERING + PROGRESS (the interactive bar)")
    p = run_code(builder_prompt, {"request": "Build a game", "workspace_root": "/ws",
                                  "loop_state": {}, "steering": "- keep it to ONE file"})
    check("steering rides directly under the task",
          "OPERATOR STEERING" in p and "keep it to ONE file" in p
          and p.find("OPERATOR STEERING") < p.find("Work inside the workspace root"), p[:800])
    p = run_code(builder_prompt, {"request": "Build a game", "workspace_root": "/ws",
                                  "loop_state": repair_state, "steering": "- stop, do X instead"})
    check("steering also reaches a repair round",
          "stop, do X instead" in p and p.find("OPERATOR STEERING") < p.find("REPAIR ROUND"), p[:900])
    steer_fold = code_body("STEER_FOLD_CODE")
    r = run_code(steer_fold, {"inbox": [{"role": "system", "content": "use tabs"}],
                              "steer_seen": 0, "steering": ""})
    check("steer fold applies a fresh message",
          "use tabs" in r["steering"] and r["seen"] == 1 and r["fresh"] == 1, str(r))
    r2 = run_code(steer_fold, {"inbox": [{"role": "system", "content": "use tabs"}],
                               "steer_seen": r["seen"], "steering": r["steering"]})
    check("steer fold dedups on the watermark",
          r2["steering"] == r["steering"] and r2["fresh"] == 0, str(r2))
    r3 = run_code(steer_fold, {"inbox": [], "steer_seen": 4, "steering": "x"})
    check("steer fold survives a host-reset inbox", r3["seen"] == 0 and r3["fresh"] == 0, str(r3))
    round_line = code_body("ROUND_LINE_CODE")
    line_defaults = {"line_text": "coding round {{n}} of {{max}}: {{note}}",
                     "steer_word": "steering applied — "}
    r = run_code(round_line, {"loop_state": {"rounds_completed": 1, "mode": "repair"},
                              "max_rounds": 4, "fresh_steers": 0, **line_defaults})
    check("round line reads round N of M", r["message"] == "coding round 2 of 4: repair", str(r))
    r = run_code(round_line, {"loop_state": {}, "max_rounds": 4, "fresh_steers": 2,
                              **line_defaults})
    check("round line announces steering",
          r["message"] == "coding round 1 of 4: steering applied — build", str(r))

    print("unit: LOOP_CONDITION stall guard (R1)")
    r = run_code(loop, {"loop_state": {"rounds_completed": 2, "all_passed": False, "failures": ["f"], "environment_failures": [], "same_signature_count": 2}, "max_rounds": 4})
    check("two identical signatures -> stop", r["condition"] is False and r["stalled"] is True, str(r))
    r = run_code(loop, {"loop_state": {"rounds_completed": 2, "all_passed": False, "failures": ["f"], "environment_failures": [], "same_signature_count": 1}, "max_rounds": 4})
    check("one repeat -> keep going", r["condition"] is True, str(r))

    print("unit: NEXT_STATE attempt memory (R1) + best tracking (R2) + mode economics (R5)")
    v_fail = {"all_passed": False, "builds": True, "executes": False, "matches": True,
              "failures": ["execute(web): page error in index.html: X is not defined"],
              "environment_failures": [], "artifacts": ["index.html"],
              "deterministic": {"delivery_ok": True}}
    s1 = run_code(next_state, {"verifier": v_fail, "verify_meta": {}, "round_index": 0,
                               "builder_report": "I built index.html with a canvas render loop and bound the slider. " * 20,
                               "prev_state": {}, "snapshot_ok": True})
    check("state: attempt_history appended", len(s1["attempt_history"]) == 1 and s1["attempt_history"][0]["round"] == 0, str(s1.get("attempt_history")))
    check("state: gate_score = [passed, gates, delivery]", s1["attempt_history"][0]["gate_score"] == [0, 2, 1], str(s1["attempt_history"]))
    # ADR-0026 retired the 800-char clip: the builder's own account flows WHOLE
    # into the next round, because clipping it erased exactly the "what I tried"
    # detail the next round needed. Assert what the builder now guarantees.
    check("state: builder report captured whole (ADR-0026, no clip)",
          s1["last_attempt_summary"] == s1["last_attempt_summary"].strip()
          and len(s1["last_attempt_summary"]) > 803,
          str(len(s1["last_attempt_summary"])))
    check("state: first failure -> signature recorded, count 0", bool(s1["failure_signature"]) and s1["same_signature_count"] == 0, str(s1["failure_signature"]))
    check("state: best snapshot recorded (R2)", s1["best_snapshot"] == ".cg_rounds/round_0" and s1["best_score"] == [0, 2, 1] and s1["best_round"] == 0, str(s1))
    check("state: mode -> repair", s1["mode"] == "repair", str(s1.get("mode")))
    # Digit-only drift (gate3's "still blank on round N" wording) must still
    # count as the SAME failure set; genuinely different wording resets.
    blank2 = dict(v_fail, failures=["execute(web): the canvas renders blank - still blank on round 2; draw the game state"])
    blank3 = dict(v_fail, failures=["execute(web): the canvas renders blank - still blank on round 3; draw the game state"])
    sb = run_code(next_state, {"verifier": blank2, "verify_meta": {}, "round_index": 0,
                               "builder_report": "r0", "prev_state": {}, "snapshot_ok": True})
    sb = run_code(next_state, {"verifier": blank3, "verify_meta": {}, "round_index": 1,
                               "builder_report": "r1", "prev_state": sb, "snapshot_ok": True})
    check("state: digit-only wording drift still counts as the same signature", sb["same_signature_count"] == 1, str(sb["same_signature_count"]))
    s2 = run_code(next_state, {"verifier": dict(v_fail, failures=["integration: entrypoint references 'missing.js' which does not exist"]),
                               "verify_meta": {}, "round_index": 1,
                               "builder_report": "tried a null guard", "prev_state": s1, "snapshot_ok": True})
    check("state: a different failure set resets the counter", s2["same_signature_count"] == 0, str(s2["same_signature_count"]))
    s2 = run_code(next_state, {"verifier": v_fail, "verify_meta": {}, "round_index": 1,
                               "builder_report": "tried again", "prev_state": s1, "snapshot_ok": True})
    check("state: identical failures increment same_signature_count", s2["same_signature_count"] == 1, str(s2["same_signature_count"]))
    s3 = run_code(next_state, {"verifier": v_fail, "verify_meta": {}, "round_index": 2,
                               "builder_report": "tried once more", "prev_state": s2, "snapshot_ok": True})
    check("state: second repeat escalates to the one rebuild (R5) + resets the counter",
          s3["mode"] == "rebuild" and s3["rebuilds_used"] == 1 and s3["same_signature_count"] == 0, str(s3))
    s4 = run_code(next_state, {"verifier": v_fail, "verify_meta": {}, "round_index": 3,
                               "builder_report": "rebuilt", "prev_state": s3, "snapshot_ok": True})
    s5 = run_code(next_state, {"verifier": v_fail, "verify_meta": {}, "round_index": 4,
                               "builder_report": "rebuilt again", "prev_state": s4, "snapshot_ok": True})
    check("state: rebuild is once-only; the stall guard takes over",
          s4["mode"] == "repair" and s5["mode"] == "repair" and s5["rebuilds_used"] == 1 and s5["same_signature_count"] == 2, str(s5))
    v_gap = {"all_passed": False, "builds": True, "executes": True, "matches": False,
             "failures": ["matches: task-named feature 'ripple' does not depend on its input"],
             "environment_failures": [], "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}}
    r = run_code(next_state, {"verifier": v_gap, "verify_meta": {}, "round_index": 1,
                              "builder_report": "did things", "prev_state": s1, "snapshot_ok": True})
    check("state: matches-only gap escalates to rebuild (design-level)", r["mode"] == "rebuild" and r["rebuilds_used"] == 1, str(r))
    v_better = {"all_passed": False, "builds": True, "executes": True, "matches": False, "failures": ["matches: gap"],
                "environment_failures": [], "deterministic": {"delivery_ok": True}}
    ra = run_code(next_state, {"verifier": v_better, "verify_meta": {}, "round_index": 0, "builder_report": "r0", "prev_state": {}, "snapshot_ok": True})
    v_worse = {"all_passed": False, "builds": False, "executes": False, "matches": False, "failures": ["execute(web): boom"],
               "environment_failures": [], "deterministic": {"delivery_ok": True}}
    rb = run_code(next_state, {"verifier": v_worse, "verify_meta": {}, "round_index": 1, "builder_report": "r1", "prev_state": ra, "snapshot_ok": True})
    check("best is monotone: a regressed round keeps the earlier best (R2)",
          rb["best_round"] == 0 and rb["best_score"] == [0, 2, 1] and rb["best_snapshot"] == ".cg_rounds/round_0", str(rb))
    rc = run_code(next_state, {"verifier": v_worse, "verify_meta": {}, "round_index": 1, "builder_report": "r1", "prev_state": ra, "snapshot_ok": False})
    check("snapshot failure degrades to a #FALLBACK warning, never fails the round",
          rc["best_round"] == 0 and any("#FALLBACK" in str(w) for w in rc["warnings"]) and rc["failures"] == ["execute(web): boom"], str(rc))
    rd = run_code(next_state, {"verifier": {}, "verify_meta": {"success": False, "error": "boom"}, "round_index": 0,
                               "builder_report": "", "prev_state": {}, "snapshot_ok": True})
    check("dead verify subflow still records history + zero score",
          rd["attempt_history"][0]["gate_score"] == [0, 0, 0] and rd["last_verdict"].get("verifier_died") is True, str(rd))

    print("unit: NEXT_STATE failure-signature normalization (F1/F2 self-review 2026-07-21)")
    def _fail_verdict(fails):
        return {"all_passed": False, "builds": False, "executes": False, "matches": False,
                "failures": fails, "environment_failures": [], "deterministic": {"delivery_ok": True}}
    # F1: distinct files fixed one-per-round must NOT collapse (identifier digits kept)
    p = {}
    counts = []
    for rnd in range(3):
        v = _fail_verdict(["integration: entrypoint index.html references 'level%d.js' which does not exist in the workspace" % (rnd + 1)])
        p = run_code(next_state, {"verifier": v, "verify_meta": {}, "round_index": rnd, "builder_report": "x", "prev_state": p, "snapshot_ok": True})
        counts.append(p["same_signature_count"])
    check("F1: level1.js/level2.js/level3.js do NOT collapse (real progress, no false stall)", counts == [0, 0, 0], str(counts))
    # F1 control: identical file every round SHOULD accumulate + escalate
    p = {}
    counts = []
    for rnd in range(3):
        v = _fail_verdict(["integration: entrypoint index.html references 'level1.js' which does not exist in the workspace"])
        p = run_code(next_state, {"verifier": v, "verify_meta": {}, "round_index": rnd, "builder_report": "x", "prev_state": p, "snapshot_ok": True})
        counts.append(p["same_signature_count"])
    check("F1 control: same file repeats -> signature accumulates (0,1,then escalate)", counts[0] == 0 and counts[1] == 1, str(counts))
    # F1: round-counter digits STILL collapse (standalone digit run)
    p = {}
    counts = []
    for rnd in range(2):
        v = _fail_verdict(["execute(web): canvas is blank - still blank on round %d; draw the game state" % (rnd + 1)])
        p = run_code(next_state, {"verifier": v, "verify_meta": {}, "round_index": rnd, "builder_report": "x", "prev_state": p, "snapshot_ok": True})
        counts.append(p["same_signature_count"])
    check("F1: 'round N' counter digits normalize away (stall still detectable)", counts == [0, 1], str(counts))
    # F2: same vacuous feature with drifting evidence prose MUST stall (truncate at ' - ')
    p = {}
    counts = []
    evid = ["score fn reads no input", "handler present but body constant", "the update path ignores it"]
    for rnd in range(3):
        v = _fail_verdict(["matches: task-named feature 'score updates' does not depend on its input - " + evid[rnd] + " - a feature that is present but vacuous is a FAILURE, not a pass"])
        p = run_code(next_state, {"verifier": v, "verify_meta": {}, "round_index": rnd, "builder_report": "x", "prev_state": p, "snapshot_ok": True})
        counts.append(p["same_signature_count"])
    check("F2: same vacuous feature stalls despite drifting evidence prose", counts[0] == 0 and counts[1] == 1, str(counts))
    # F2 control: DIFFERENT vacuous features must NOT collapse
    p = {}
    counts = []
    feats = ["score updates", "timer resets", "level advances"]
    for rnd in range(3):
        v = _fail_verdict(["matches: task-named feature '" + feats[rnd] + "' does not depend on its input - reason - vacuous FAILURE"])
        p = run_code(next_state, {"verifier": v, "verify_meta": {}, "round_index": rnd, "builder_report": "x", "prev_state": p, "snapshot_ok": True})
        counts.append(p["same_signature_count"])
    check("F2 control: distinct feature names do NOT collapse", counts == [0, 0, 0], str(counts))
    # F7: belted failures are written back into the stored verdict
    v_lie = {"all_passed": True, "builds": True, "executes": True, "matches": False,
             "failures": [], "environment_failures": [], "deterministic": {"delivery_ok": True}}
    r = run_code(next_state, {"verifier": v_lie, "verify_meta": {}, "round_index": 0, "builder_report": "x", "prev_state": {}, "snapshot_ok": True})
    check("F7: belt writes back into last_verdict (not just state.failures)",
          r["last_verdict"].get("all_passed") is False and any("all_passed but a gate was false" in str(f) for f in (r["last_verdict"].get("failures") or [])), str(r["last_verdict"]))

    print("unit: ROUND_MODE_PINS budget shaping (R5)")
    rmp = code_body("ROUND_MODE_PINS_CODE")
    r = run_code(rmp, {"loop_state": {}})
    check("round 0 -> build @ 30 iterations", r["mode"] == "build" and r["max_iterations"] == 30, str(r))
    r = run_code(rmp, {"loop_state": {"rounds_completed": 1, "mode": "repair"}})
    check("repair -> 12 iterations", r["max_iterations"] == 12, str(r))
    r = run_code(rmp, {"loop_state": {"rounds_completed": 2, "mode": "rebuild"}})
    check("rebuild -> 30 iterations", r["max_iterations"] == 30, str(r))
    r = run_code(rmp, {"loop_state": {"rounds_completed": 1}})
    check("missing mode after round 0 defaults to repair", r["mode"] == "repair" and r["max_iterations"] == 12, str(r))

    print("unit: SNAPSHOT_ARGS exclusion-safe copy (R2)")
    snap_args = code_body("SNAPSHOT_ARGS_CODE")
    r = run_code(snap_args, {"workspace_root": "/ws", "round_index": 2})
    cmd = r["arguments"]["command"]
    check("snapshot targets .cg_rounds/round_2 inside the workspace", "mkdir -p '.cg_rounds/round_2'" in cmd and cmd.startswith("cd '/ws'"), cmd)
    check("snapshot excludes .cg_rounds itself", '!= ".cg_rounds"' in cmd, cmd)

    print("unit: RESTORE_DECIDE best-over-final delivery (R2)")
    restore_decide = code_body("RESTORE_DECIDE_CODE")
    regressed = {"all_passed": False, "best_score": [0, 3, 1], "best_round": 1, "best_snapshot": ".cg_rounds/round_1",
                 "attempt_history": [{"round": 0, "gate_score": [0, 1, 1]}, {"round": 1, "gate_score": [0, 3, 1]}, {"round": 2, "gate_score": [0, 1, 1]}]}
    r = run_code(restore_decide, {"loop_state": regressed, "workspace_root": "/ws"})
    check("final < best -> restore", r["restore"] is True and r["restored_round"] == 1, str(r))
    check("restore command copies the best snapshot back", ".cg_rounds/round_1/." in r["tool_call"]["arguments"]["command"] and "cp -R" in r["tool_call"]["arguments"]["command"], str(r["tool_call"]))
    final_best = dict(regressed, attempt_history=[{"round": 2, "gate_score": [0, 3, 1]}])
    r = run_code(restore_decide, {"loop_state": final_best, "workspace_root": "/ws"})
    check("final == best -> no restore", r["restore"] is False, str(r))
    r = run_code(restore_decide, {"loop_state": dict(regressed, all_passed=True), "workspace_root": "/ws"})
    check("all_passed -> never restore", r["restore"] is False, str(r))
    r = run_code(restore_decide, {"loop_state": dict(regressed, best_snapshot=""), "workspace_root": "/ws"})
    check("no snapshot -> no restore", r["restore"] is False, str(r))
    # F8 (self-review 2026-07-21): a false restore emits a no-op command, never
    # a degenerate copy (cp -R '/.' .) riding the unexecuted pin.
    check("F8: no-restore emits a 'true' no-op command", r["tool_call"]["arguments"]["command"] == "true", str(r["tool_call"]))
    r = run_code(restore_decide, {"loop_state": regressed, "workspace_root": "/ws"})
    check("F8: real restore still emits the copy-back command", r["tool_call"]["arguments"]["command"].startswith("cd '/ws'") and "cp -R '.cg_rounds/round_1/.' ." in r["tool_call"]["arguments"]["command"], str(r["tool_call"]))

    print("unit: VERIFIER_PROMPT static-feature semantics (R4, live-found)")
    # Live-found (first 0.2.4 gateway run): the verifier marked a CORRECTLY
    # PRESENT static feature ('a number input (with a visible label)') as
    # depends_on_input=false because the enumeration protocol read as
    # "static => no input-dependence" — and the merge belted a healthy
    # artifact to matches=false. The prompt must define depends_on_input as
    # aliveness (defects only), with static presence counting as true.
    vp = code_body("VERIFIER_PROMPT_CODE")
    vout = run_code(vp, {"request": "make a page", "gate0_out": g0_web, "gate3_out": g3_ok,
                         "build_command": "", "run_command": "", "workspace_root": "/ws"})
    check("verifier prompt defines static-presence as depends_on_input=true",
          "STATIC features" in vout and "set depends_on_input=true when the static feature is correctly present" in vout, vout[:200])
    check("verifier prompt reserves depends_on_input=false for defects",
          "Reserve depends_on_input=false STRICTLY for defects" in vout, vout[:200])

    print("unit: MERGE schema-forced feature_checks fold (R4)")
    v_feature = {"builds": True, "executes": False, "matches": True, "failures": [], "environment_failures": [],
                 "artifacts": ["index.html"], "summary": "ok",
                 "feature_checks": [
                     {"feature": "timeline playback", "input": "click Play", "expected_change": "visibleNodes grows", "evidence": "handler exists", "depends_on_input": False},
                     {"feature": "search ranking", "input": "type a title", "expected_change": "top-3 order", "evidence": "score fn reads query terms", "depends_on_input": True},
                 ]}
    r = run_code(merge, {"verifier_data": v_feature, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("depends_on_input=false -> matches belted false + failure naming the feature",
          r["matches"] is False and r["all_passed"] is False and any("timeline playback" in str(f) and "does not depend on its input" in str(f) for f in r["failures"]), str(r))
    check("feature_checks carried in the verdict for audit", isinstance(r.get("feature_checks"), list) and len(r["feature_checks"]) == 2, str(r.get("feature_checks")))
    v_feature_ok = dict(v_feature, feature_checks=[{"feature": "search", "input": "q", "expected_change": "results", "evidence": "chain traced", "depends_on_input": True}])
    r = run_code(merge, {"verifier_data": v_feature_ok, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("all-true feature checks leave the verdict alone", r["matches"] is True and r["all_passed"] is True, str(r))
    v_feature_str = dict(v_feature, feature_checks=[{"feature": "playback", "input": "Play", "expected_change": "growth", "evidence": "", "depends_on_input": "false"}])
    r = run_code(merge, {"verifier_data": v_feature_str, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("string 'false' coerces (tool-arg coercion class)", r["matches"] is False, str(r))
    # F6 (self-review 2026-07-21): int 0 and "no" coerce to false; a missing /
    # unrecognized depends_on_input does NOT fail the verdict but IS surfaced
    # as a coverage warning (was: silent pass with zero trace).
    v_zero = dict(v_feature, feature_checks=[{"feature": "playback", "input": "Play", "expected_change": "g", "evidence": "", "depends_on_input": 0}])
    r = run_code(merge, {"verifier_data": v_zero, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("F6: integer 0 coerces to false", r["matches"] is False, str(r))
    v_no = dict(v_feature, feature_checks=[{"feature": "playback", "input": "Play", "expected_change": "g", "evidence": "", "depends_on_input": "no"}])
    r = run_code(merge, {"verifier_data": v_no, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("F6: 'no' coerces to false", r["matches"] is False, str(r))
    v_missing = dict(v_feature, feature_checks=[{"feature": "playback", "input": "Play", "expected_change": "g", "evidence": "e"}])
    r = run_code(merge, {"verifier_data": v_missing, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("F6: missing depends_on_input -> coverage warning, not a verdict failure",
          r["matches"] is True and any("depends_on_input" in str(w) and "UNVERIFIED" in str(w) for w in r["warnings"]), str(r.get("warnings")))
    r = run_code(merge, {"verifier_data": v_feature_ok, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok,
                         "gate5_out": {"warnings": ["selfcheck: SELFCHECK.md not found in the workspace - advisory"]}})
    check("G5 advisory warnings ride the merged verdict", any("selfcheck" in str(w) for w in r["warnings"]), str(r["warnings"]))

    print("unit: FINAL_REPORT restoration reporting (R2)")
    restored_state = {
        "rounds_completed": 3, "all_passed": False,
        "failures": ["execute(web): page error in index.html: Cannot set properties of null (setting 'oninput')"],
        "environment_failures": [],
        "warnings": [],
        "best_verdict": {"all_passed": False, "builds": True, "executes": True, "matches": False,
                         "failures": ["matches: search ranking unverified"], "environment_failures": [],
                         "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}, "summary": "best round"},
        "last_verdict": {"all_passed": False, "builds": False, "executes": False, "matches": False,
                         "failures": ["execute(web): page error in index.html: Cannot set properties of null (setting 'oninput')"],
                         "artifacts": ["index.html"], "deterministic": {"delivery_ok": True}},
    }
    restore_info = {"restore": True, "restored_round": 1, "best_score": [0, 2, 1], "final_score": [0, 0, 1]}
    r = run_code(final_report, {"loop_state": restored_state, "final_listing": listing_txt, "final_listing_ok": True,
                                "restore_out": restore_info, "restore_ok": True})
    check("report: names the restoration + delivered round",
          "RESTORED from the round 1 snapshot" in r["report_markdown"] and "Gate verdict (delivered round 1):" in r["report_markdown"], r["report_markdown"])
    check("report: delivered round's verdict reported, final round appended",
          r["gate_verdict"]["executes"] is True and "Final round verdict (discarded after restore)" in r["report_markdown"], r["report_markdown"])
    check("report: open failures are the delivered round's", r["open_failures"] == ["matches: search ranking unverified"], str(r["open_failures"]))
    check("report: restored flag surfaced", r["restored"] is True and r["success"] is False, str({k: r[k] for k in ("restored", "success", "passed")}))
    r = run_code(final_report, {"loop_state": restored_state, "final_listing": listing_txt, "final_listing_ok": True,
                                "restore_out": restore_info, "restore_ok": False})
    check("report: unconfirmed restore carries #FALLBACK", "#FALLBACK: the restore command did not confirm success" in r["report_markdown"], r["report_markdown"])
    snapshot_warn_state = dict(pass_state, warnings=["snapshot: round 0 snapshot failed - best-artifact restore cannot cover this round (#FALLBACK: delivery falls back to the last write for it)"])
    r = run_code(final_report, {"loop_state": snapshot_warn_state, "final_listing": listing_txt, "final_listing_ok": True,
                                "restore_out": {}, "restore_ok": None})
    check("report: state-level snapshot warnings surface as advisory", "snapshot: round 0 snapshot failed" in r["report_markdown"], r["report_markdown"])

    # ------------------------------------------------------------------
    # ADR-0026 (operator ruling 2026-09-28): failure text the fixer model reads
    # is carried WHOLE (the old 120-300 char cuts hid the decisive tail), and
    # the verifier verdict call carries no output-token cap.
    # ------------------------------------------------------------------
    print("unit: ADR-0026 whole failure text + no verifier output cap")
    tail = "DECISIVE-TAIL-" + "e" * 400
    long_err = "Error: " + "x" * 400 + " " + tail
    r = run_code(code_body("GATE0_CODE"), {"listing": long_err, "listing_ok": False})
    check("G0 listing failure carries the whole listing error", any(tail in str(f) for f in r["failures"]), str(r["failures"])[:300])
    r = run_code(code_body("GATE0_CODE"), {"listing": long_err, "listing_ok": True})
    check("G0 'listing failed' carries the whole error", any(tail in str(f) for f in r["failures"]), str(r["failures"])[:300])
    r = run_code(gate1, {"gate0_out": g0_web, "entry_content": long_err, "entry_ok": False})
    check("G1 unreadable entrypoint carries the whole read error", any(tail in str(f) for f in r["failures"]), str(r["failures"])[:300])
    for probe_err, label in (("Tool 'browser_probe' not found " + tail, "not mounted"),
                             ("browser_probe is not allowed for this node " + tail, "refused"),
                             ("probe crashed " + tail, "failed")):
        r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of(None, success=False, error=probe_err), "round_index": 0})
        check(f"G3 {label} carries the whole probe error", any(tail in str(f) for f in r["environment_failures"]), str(r["environment_failures"])[:300])
    r = run_code(gate3, {"gate0_out": g0_web, "probe_raw": raw_of("unparseable report " + tail), "round_index": 0})
    check("G3 unreadable probe result is carried whole", any(tail in str(f) for f in r["environment_failures"]), str(r["environment_failures"])[:300])
    long_path = "src/" + "deep/" * 40 + "index.html"
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: " + long_path + " deadbeef", "selfcheck_ok": True, "hash_output": ""})
    check("G5 malformed hash line names the whole path", any(str(f).count(long_path) == 2 for f in r["failures"]), str(r["failures"])[:300])
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: " + tail, "selfcheck_ok": True, "hash_output": ""})
    check("G5 malformed claim line is quoted whole", any(tail in str(f) for f in r["failures"]), str(r["failures"])[:300])
    r = run_code(gate5, {"selfcheck_content": "ok\nARTIFACT-SHA256: index.html " + aa, "selfcheck_ok": True, "hash_output": "sh: shasum: command not found " + tail})
    check("G5 host-cannot-hash warning carries the whole output", any(tail in str(w) for w in r["warnings"]), str(r["warnings"])[:300])
    r = run_code(merge, {"verifier_data": None, "verifier_ok": False, "verifier_response": "provider failed: " + tail,
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("MERGE dead-verifier note is carried whole", any(tail in str(f) for f in r["environment_failures"]), str(r["environment_failures"])[:300])
    long_feat = "the score counter increments on every eaten apple " + tail
    long_ev = "counter stayed at 0 after 5 apples " + tail
    v_vacuous = {"builds": True, "executes": True, "matches": True, "failures": [], "artifacts": ["index.html"], "summary": "",
                 "feature_checks": [{"feature": long_feat, "depends_on_input": False, "evidence": long_ev},
                                    {"feature": long_feat + "-2", "depends_on_input": "maybe " + tail}]}
    r = run_code(merge, {"verifier_data": v_vacuous, "verifier_ok": True, "verifier_response": "",
                         "gate0_out": g0_web, "gate1_out": {"integration_ok": True}, "gate3_out": g3_ok, "gate5_out": {}})
    check("MERGE vacuous-feature failure names the whole feature and evidence",
          any(long_feat in str(f) and long_ev in str(f) for f in r["failures"]), str(r["failures"])[:300])
    check("MERGE unclear depends_on_input warning carries the whole value",
          any(("maybe " + tail) in str(w) and (long_feat + "-2") in str(w) for w in r["warnings"]), str(r["warnings"])[:300])
    r = run_code(next_state, {"verifier": {}, "verify_meta": {"success": False, "error": "subflow died: " + tail}, "round_index": 0,
                              "builder_report": "", "prev_state": {}, "snapshot_ok": True})
    check("NEXT_STATE verify-death line carries the whole error", any(tail in str(f) for f in r["environment_failures"]), str(r["environment_failures"])[:300])
    flows_dir = FLOW_PATH.parent
    for fname in ("coding-verify-gates.json", "multiagent-verify-gates.json"):
        flow = json.loads((flows_dir / fname).read_text())
        verifiers = [n for n in flow["nodes"] if n["id"] == "verifier"]
        check(f"{fname}: the verifier agent node exists", len(verifiers) == 1, str([n["id"] for n in flow["nodes"]]))
        defaults = verifiers[0]["data"].get("pinDefaults") or {}
        check(f"{fname}: no max_output_tokens default on the verifier (model default applies)",
              "max_output_tokens" not in defaults, str(defaults.get("max_output_tokens")))

    print(f"\nALL {len(CHECKS)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
