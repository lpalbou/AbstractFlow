#!/usr/bin/env python3
"""Deterministic smoke for the RALPH-CODER family (ralph-coding + ralph-cycle
+ ralph-coder).

Layers:
0. DOCTRINE GATE: the three shipped files pass audit_flow_graph --policy-strict.
1. NODE COMPILE: every code-node body compiles through the real code-node lane.
2. EXPRESSIONS: both loop laws (outer cycles, inner steps) compile and evaluate
   through the real pin-expression lane.
3. LOGIC: the deterministic completion check's parsing, the shell composition
   (exit code before the pipe, fixed-string marker grep), the steer watermark.
4. E2E CYCLE: the `ralph-cycle` child flow through the real Runtime — a fresh
   session that acts, then finishes.
5. E2E ROOT: the outer loop through the real Runtime with the cycle stubbed —
   a FALSE completion claim (marker without a green verify) buys another
   cycle, a true one ends the run; every cycle prompt is IDENTICAL except for
   steering/counter/check (the fresh-context proof).
6. E2E STEER: a real `Runtime.steer()` mid-run appears in the NEXT cycle's
   fixed prompt.
7. E2E WAIT GATE: the reviewer's rejection becomes standing steering and the
   loop runs another cycle.
8. E2E WRAPPER: agent.v1 contract over a stubbed child, alive and dead.
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
from abstractruntime.visualflow_compiler.visual.pin_expressions import (  # noqa: E402
    compile_pin_expression,
)

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"
FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" - {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


_HANDLERS: dict[str, object] = {}


def run_body(node: dict, inputs: dict) -> dict:
    wrapped = _generate_code_from_body(node["data"], "transform")
    handler = _HANDLERS.get(wrapped)
    if handler is None:
        handler = create_code_handler(wrapped, "transform")
        _HANDLERS[wrapped] = handler
    out = handler(inputs)
    if not isinstance(out, dict):
        raise RuntimeError("code body returned non-dict")
    return out


def defaults_of(node: dict) -> dict:
    return dict(node["data"].get("pinDefaults") or {})


def main() -> int:  # noqa: C901 - a smoke is a checklist
    # ---- layer 0 ----
    files = [str(FLOWS / f"{n}.json") for n in ("ralph-coding", "ralph-cycle", "ralph-coder")]
    audit = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "audit_flow_graph.py"),
         "--policy-strict", *files], capture_output=True, text=True)
    check("doctrine-gate", audit.returncode == 0,
          (audit.stdout or audit.stderr or "").strip()[-400:])

    root = json.loads((FLOWS / "ralph-coding.json").read_text())
    cycle = json.loads((FLOWS / "ralph-cycle.json").read_text())
    wrapper = json.loads((FLOWS / "ralph-coder.json").read_text())
    by_id = {n["id"]: n for n in root["nodes"]}
    cyc_by_id = {n["id"]: n for n in cycle["nodes"]}

    # ---- layer 1 ----
    bodies = [n for n in root["nodes"] + cycle["nodes"] + wrapper["nodes"]
              if n["data"].get("nodeType") == "code"]
    compiled = 0
    for n in bodies:
        try:
            create_code_handler(_generate_code_from_body(n["data"], "transform"), "transform")
            compiled += 1
        except Exception as e:  # pragma: no cover
            check(f"body-compiles-{n['id']}", False, str(e))
    check("bodies-compile", compiled == len(bodies), f"{compiled}/{len(bodies)}")
    check("code-nodes-on-exec-lane",
          all("exec-in" in {p["id"] for p in n["data"]["inputs"]} for n in bodies))

    # ---- layer 2: both loop laws ----
    outer = (by_id["loop"]["data"].get("pinExpressions") or {}).get("condition")
    inner = (cyc_by_id["steps"]["data"].get("pinExpressions") or {}).get("condition")
    check("laws-present", bool(outer) and bool(inner), f"{outer} | {inner}")
    fo = compile_pin_expression(outer, node_label="loop", pin_id="condition")
    fi = compile_pin_expression(inner, node_label="steps", pin_id="condition")
    check("outer-law", bool(fo(None, {"done": False, "cycle": 0, "max_cycles": 3}))
          and not fo(None, {"done": True, "cycle": 0, "max_cycles": 3})
          and not fo(None, {"done": False, "cycle": 3, "max_cycles": 3}))
    check("inner-law", bool(fi(None, {"step_done": False, "step": 0, "max_steps": 2}))
          and not fi(None, {"step_done": True, "step": 0, "max_steps": 2})
          and not fi(None, {"step_done": False, "step": 2, "max_steps": 2}))
    check("laws-fail-closed",
          by_id["loop"]["data"]["pinDefaults"]["condition"] is False
          and cyc_by_id["steps"]["data"]["pinDefaults"]["condition"] is False)

    # ---- layer 3: the DETERMINISTIC check ----
    cc = by_id["check_cmd"]
    shell = run_body(cc, {"workspace_root": "/tmp/w s", "progress_file": "PROGRESS.md",
                          "done_marker": "DONE:", "verify_command": "npm test"})["tool_call"]
    cmd = shell["arguments"]["command"]
    check("check-quotes-workspace", "cd '/tmp/w s'" in cmd, cmd[:120])
    # The exit code is captured before any output is printed, and the verify
    # log, progress file and change list are printed WHOLE (ADR-0026).
    check("check-exit-before-log", 'echo "VERIFY_EXIT=$?"' in cmd
          and "cat .ralph_verify.log" in cmd
          and cmd.index("VERIFY_EXIT") < cmd.index("cat .ralph_verify.log"), cmd[:200])
    check("check-output-whole", "tail -n" not in cmd and "head -n" not in cmd, cmd[:300])
    check("check-marker-is-fixed-string", "grep -qF" in cmd, cmd[:250])
    no_verify = run_body(cc, {"workspace_root": "/w", "progress_file": "P.md",
                              "done_marker": "DONE:", "verify_command": ""})["tool_call"]
    check("check-without-verify-command-uses-true",
          "( true )" in no_verify["arguments"]["command"],
          no_verify["arguments"]["command"][:120])

    cf = by_id["check_fold"]
    both = run_body(cf, {"result": {"results": [{"output": {
        "stdout": "VERIFY_EXIT=0\nPROMISE=1\n---PROGRESS-TAIL---\nDONE: ran npm test\n"}}]},
        "cycle": 1, "cycle_summary": "wrote index.html"})["updates"]
    check("check-complete-needs-both", both["complete"] is True and both["verify_ok"] is True
          and both["promise_done"] is True and both["cycle"] == 2, str(both)[:200])
    claimed = run_body(cf, {"result": {"results": [{"output": {
        "stdout": "VERIFY_EXIT=1\nPROMISE=1\n"}}]}, "cycle": 1, "cycle_summary": "s"})["updates"]
    check("check-model-claim-alone-is-not-complete", claimed["complete"] is False
          and claimed["promise_done"] is True, str(claimed)[:200])
    green_only = run_body(cf, {"result": {"results": [{"output": {
        "stdout": "VERIFY_EXIT=0\nPROMISE=0\n"}}]}, "cycle": 1, "cycle_summary": "s"})["updates"]
    check("check-green-without-promise-is-not-complete", green_only["complete"] is False,
          str(green_only)[:150])

    sf = by_id["steer_fold"]
    s1 = run_body(sf, {"inbox": [{"role": "system", "content": "ship it as one file"}],
                       "steer_seen": 0, "steering_notes": ""})["updates"]
    s2 = run_body(sf, {"inbox": [{"role": "system", "content": "ship it as one file"}],
                       "steer_seen": s1["steer_seen"],
                       "steering_notes": s1["steering_notes"]})["updates"]
    check("steer-watermark-dedups", "one file" in s1["steering_notes"]
          and s2["steering_notes"] == s1["steering_notes"] and s2["steer_new"] == 0, str(s2))

    bc = by_id["bootstrap_cmd"]
    bd = defaults_of(bc)
    boot = run_body(bc, {"workspace_root": "/w", "plan_file": "PLAN.md",
                         "progress_file": "PROGRESS.md", "plan_header": bd["plan_header"],
                         "progress_header": bd["progress_header"]})["tool_call"]
    bcmd = boot["arguments"]["command"]
    check("bootstrap-never-overwrites", bcmd.count("[ -f ") == 2 and ">>" not in bcmd, bcmd[:200])

    rp = by_id["report"]
    rd = defaults_of(rp)
    exhausted = run_body(rp, {"cycle": 4, "max_cycles": 4, "complete_flag": False,
                              "stopped_reason": "", "progress_file": "PROGRESS.md",
                              "last_summary": "still fixing", "evidence": "VERIFY_EXIT=1",
                              "steering_notes": "", **rd})
    check("report-budget-honest", exhausted["passed"] is False
          and exhausted["stopped"] == "budget-exhausted"
          and "#FALLBACK" in exhausted["report"], str(exhausted)[:200])

    # ---- ADR-0026 (0.2.1): no count/char cap on what the cycle model reads ----
    from abstractruntime import HISTORY_REPLAY_MAX_TOKENS

    wf = by_id["warm_fold"]
    wd = defaults_of(wf)

    def warm(progress_text: str, warm_entries=None) -> str:
        stdout = ("---RALPH-LISTING---\n./a.py\n---RALPH-PROGRESS---\n" + progress_text
                  + "\n---RALPH-WARM-END---\n")
        inputs = {**wd, "result": {"results": [{"output": {"stdout": stdout}}]}}
        if warm_entries is not None:
            inputs["warm_entries"] = warm_entries
        return run_body(wf, inputs)["updates"]["warm_progress"]

    def entries(n: int, size: int) -> list[str]:
        # each entry is `size` chars of body (~size/4 estimated tokens)
        return [f"## Cycle {i}\n" + (f"e{i} " * size)[:size] for i in range(1, n + 1)]

    twelve = entries(12, 400)
    got = warm("\n".join(twelve))
    check("adr26-warm-every-entry-within-the-window",
          all(e.strip() in got for e in twelve) and "omitted" not in got, got[:200])
    check("adr26-warm-window-is-the-runtime-history-window",
          f"window_tokens = {HISTORY_REPLAY_MAX_TOKENS}" in wf["data"]["codeBody"],
          str(HISTORY_REPLAY_MAX_TOKENS))
    # five ~20k-token entries: the newest two fit 50k tokens, the third does not
    big = entries(5, 80_000)
    got = warm("\n".join(big))
    check("adr26-warm-drops-oldest-WHOLE-entries-past-50k-tokens",
          big[4].strip() in got and big[3].strip() in got and "## Cycle 3" not in got
          and "(3 entr" in got, got[:160])
    body = "no headings here " * 800  # ~13,600 chars: the old tail kept 2,500
    got = warm(body)
    check("adr26-warm-unstructured-progress-is-whole", got == body.strip(), str(len(got)))
    got = warm("\n".join(entries(5, 400)), warm_entries=2)
    check("adr26-warm-explicit-bound-is-honoured-and-stated",
          "## Cycle 5" in got and "## Cycle 4" in got and "## Cycle 3" not in got
          and "(3 entr" in got, got[:160])
    check("adr26-warm-default-has-no-count-bound",
          by_id["start"]["data"]["pinDefaults"]["warm_entries"] == 0
          and {n["id"]: n for n in wrapper["nodes"]}["start"]["data"]["pinDefaults"]["warm_entries"] == 0)
    sfold = cyc_by_id["fold"]
    check("adr26-step-trace-has-no-default-bound", defaults_of(sfold).get("max_chars") == 0,
          str(defaults_of(sfold).get("max_chars")))
    long_obs = "x" * 60_000
    tr = run_body(sfold, {**defaults_of(sfold), "transcript": "", "step": 0, "thought": "t",
                          "calls_text": "c", "observations": long_obs})["updates"]["transcript"]
    check("adr26-step-trace-keeps-a-60k-observation-whole", long_obs in tr, str(len(tr)))
    cl = by_id["cycle_line"]
    line = run_body(cl, {**defaults_of(cl), "cycle": 0, "max_cycles": 3, "steer_new": 0,
                         "last_summary": "s" * 500})["message"]
    check("adr26-progress-line-preview-is-labeled", line.endswith("… (truncated)"), line[-40:])

    # ---- E2E scaffolding ----
    from abstractruntime import Runtime
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
    from abstractruntime.storage.steer_sidecar import InMemorySteerSidecar
    from abstractruntime.visualflow_compiler import compile_visualflow

    root_spec = compile_visualflow(root)
    cycle_spec = compile_visualflow(cycle)
    wrap_spec = compile_visualflow(wrapper)
    ws = tempfile.mkdtemp(prefix="ralph_smoke_ws_")

    def drive(rt, spec, rid, answers=None, max_rounds=40, steps=300):
        answers = list(answers or [])
        final = None
        for _ in range(max_rounds):
            st = rt.tick(workflow=spec, run_id=rid, max_steps=steps)
            if st.status == RunStatus.WAITING:
                if not answers:
                    raise RuntimeError(f"unanswered wait: {st.waiting}")
                rt.resume(workflow=spec, run_id=rid, wait_key=st.waiting.wait_key,
                          payload={"response": answers.pop(0)}, max_steps=0)
                continue
            final = st
            break
        return final

    # ---- layer 4: E2E the CYCLE flow (one fresh session) ----
    cyc_prompts: list[str] = []
    cyc_tools: list[str] = []

    def cyc_llm(run, effect, default_next_node):
        cyc_prompts.append(str((effect.payload or {}).get("prompt") or ""))
        if len(cyc_prompts) == 1:
            return EffectOutcome.completed({"content": "writing the file", "tool_calls": [
                {"call_id": "c1", "name": "write_file", "arguments": {}}]})
        return EffectOutcome.completed({"content": "cycle done: wrote hello.html"})

    def cyc_tools_h(run, effect, default_next_node):
        for c in (effect.payload or {}).get("tool_calls") or []:
            cyc_tools.append(str(c.get("name")))
        return EffectOutcome.completed({"mode": "executed", "results": [
            {"call_id": "c1", "name": "write_file", "success": True,
             "output": {"stdout": "written"}}]})

    rtc = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                  effect_handlers={EffectType.LLM_CALL: cyc_llm,
                                   EffectType.TOOL_CALLS: cyc_tools_h})
    ridc = rtc.start(workflow=cycle_spec, vars={"task_prompt": "THE FIXED TASK", "max_steps": 4})
    finalc = drive(rtc, cycle_spec, ridc)
    outc = (finalc.output or {}) if finalc else {}
    check("e2e-cycle-completes", finalc is not None and finalc.status == RunStatus.COMPLETED,
          f"status={finalc and finalc.status} err={finalc and finalc.error}")
    check("e2e-cycle-returns-summary", "wrote hello.html" in str(outc.get("summary") or "")
          and outc.get("steps_used") == 2 and outc.get("success") is True, str(outc)[:200])
    check("e2e-cycle-carries-the-fixed-task", all("THE FIXED TASK" in p for p in cyc_prompts))
    check("e2e-cycle-accumulates-within-the-cycle",
          "THIS CYCLE'S STEPS" in cyc_prompts[1] and "step 1" in cyc_prompts[1],
          cyc_prompts[1][:200] if len(cyc_prompts) > 1 else "")
    check("e2e-cycle-ran-tools", cyc_tools == ["write_file"], str(cyc_tools))

    # ---- layer 5: E2E the ROOT loop (cycle stubbed) ----
    class RootHarness:
        def __init__(self, checks):
            self.checks = list(checks)      # per-cycle stdout of the check command
            self.cycle_prompts: list[str] = []
            self.lines: list[str] = []
            self.bootstrapped = 0
            self.warm = 0
            self.on_cycle = None

        def child(self, run, effect, default_next_node):
            payload = effect.payload or {}
            self.cycle_prompts.append(str((payload.get("vars") or {}).get("task_prompt") or ""))
            if self.on_cycle is not None:
                self.on_cycle(len(self.cycle_prompts))
            return EffectOutcome.completed({"sub_run_id": "stub", "output": {
                "summary": f"cycle {len(self.cycle_prompts)} did work",
                "steps_used": 2, "success": True}})

        def tools(self, run, effect, default_next_node):
            calls = (effect.payload or {}).get("tool_calls") or []
            cid = str((calls[0].get("call_id") if calls else "") or "")
            if cid == "ralph-bootstrap":
                self.bootstrapped += 1
                stdout = "RALPH_MEMORY_READY\n"
            elif cid == "ralph-warm":
                # The per-cycle warm-start gather (0.2.0) runs before the
                # prompt: it is not the completion check.
                self.warm += 1
                stdout = "---RALPH-LISTING---\n.\n---RALPH-PROGRESS---\n\n---RALPH-WARM-END---\n"
            else:
                stdout = self.checks.pop(0) if self.checks else "VERIFY_EXIT=1\nPROMISE=0\n"
            return EffectOutcome.completed({"mode": "executed", "results": [
                {"call_id": cid or "c", "name": "execute_command", "success": True,
                 "output": {"stdout": stdout}}]})

        def answer(self, run, effect, default_next_node):
            self.lines.append(str((effect.payload or {}).get("message") or ""))
            return EffectOutcome.completed({"delivered": True})

        def handlers(self):
            return {EffectType.START_SUBWORKFLOW: self.child,
                    EffectType.TOOL_CALLS: self.tools,
                    EffectType.ANSWER_USER: self.answer}

    def start_root(h, *, gating="auto", budget=5, verify="npm test", steer_store=None):
        rt = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                     effect_handlers=h.handlers(), steer_store=steer_store)
        rid = rt.start(workflow=root_spec, vars={
            "request": "build hello.html", "workspace_root": ws, "gating_mode": gating,
            "max_cycles": budget, "verify_command": verify})
        return rt, rid

    # cycle 1: the model wrote the marker but the verify is RED -> not complete.
    # cycle 2: both green -> complete.
    h = RootHarness(["VERIFY_EXIT=1\nPROMISE=1\n---PROGRESS-TAIL---\nDONE: (claimed)\n",
                     "VERIFY_EXIT=0\nPROMISE=1\n---PROGRESS-TAIL---\nDONE: npm test green\n"])
    rt, rid = start_root(h)
    final = drive(rt, root_spec, rid)
    out = (final.output or {}) if final else {}
    check("e2e-root-completes", final is not None and final.status == RunStatus.COMPLETED,
          f"status={final and final.status} err={final and final.error}")
    check("e2e-root-false-claim-bought-another-cycle", len(h.cycle_prompts) == 2,
          f"cycles={len(h.cycle_prompts)}")
    check("e2e-root-warm-start-once-per-cycle", h.warm == len(h.cycle_prompts), f"warm={h.warm}")
    check("e2e-root-completed-deterministically", out.get("passed") is True
          and out.get("success") is True and out.get("stopped_reason") == "verified-complete"
          and out.get("cycles_used") == 2, str(out)[:220])
    check("e2e-root-bootstrapped-once", h.bootstrapped == 1, str(h.bootstrapped))
    check("e2e-root-progress-lines",
          [x for x in h.lines if x.startswith("ralph cycle")][0]
          == "ralph cycle 1 of 5: fresh context, re-reading the workspace"
          and [x for x in h.lines if x.startswith("ralph check")]
          # changes= is the files-changed count since the previous check
          # (0.2.0 fingerprint); these scripted checks report no change list.
          == ["ralph check 1: verify=fail promise=pass changes=0",
              "ralph check 2: verify=pass promise=pass changes=0"], str(h.lines))
    # THE FRESH-CONTEXT PROOF: the standing task is byte-identical between
    # cycles; only the counter and the machine check differ, and NOTHING from
    # the previous cycle's conversation appears.
    p1, p2 = h.cycle_prompts[0], h.cycle_prompts[1]
    task_head = p1.split("This is cycle")[0]
    check("e2e-root-task-prompt-is-fixed", p2.startswith(task_head), p2[:200])
    check("e2e-root-second-prompt-has-no-conversation",
          "cycle 1 did work" not in p2 and "THIS CYCLE'S STEPS" not in p2, p2[:400])
    check("e2e-root-second-prompt-carries-the-machine-check",
          "LAST AUTOMATED CHECK" in p2 and "VERIFY_EXIT=1" in p2, p2[-400:])

    # ---- layer 6: E2E STEER ----
    sidecar = InMemorySteerSidecar()
    h2 = RootHarness(["VERIFY_EXIT=1\nPROMISE=0\n", "VERIFY_EXIT=0\nPROMISE=1\n"])
    rt2, rid2 = start_root(h2, steer_store=sidecar)
    seq = {"v": None}

    def steer_during_first_cycle(n):
        if n == 1:
            seq["v"] = rt2.steer(rid2, "keep it to ONE file, no build step")

    h2.on_cycle = steer_during_first_cycle
    final2 = drive(rt2, root_spec, rid2)
    out2 = (final2.output or {}) if final2 else {}
    check("e2e-steer-queued", seq["v"] is not None)
    check("e2e-steer-completes", final2 is not None and final2.status == RunStatus.COMPLETED,
          f"status={final2 and final2.status} err={final2 and final2.error}")
    check("e2e-steer-absent-from-the-cycle-it-preceded",
          "ONE file" not in h2.cycle_prompts[0])
    check("e2e-steer-in-next-cycle-prompt",
          "ONE file" in h2.cycle_prompts[1] and "OPERATOR STEERING" in h2.cycle_prompts[1],
          h2.cycle_prompts[1][:400] if len(h2.cycle_prompts) > 1 else "")
    check("e2e-steer-line-says-so", any("steering applied" in x for x in h2.lines), str(h2.lines))
    check("e2e-steer-in-report", "ONE file" in str(out2.get("report") or ""), str(out2)[:250])

    # ---- layer 6b: E2E LATE STEER (0.1.1 — the live-run defect). The check
    # passes on cycle 1 while a steer is in flight: the late drain must catch
    # it, RE-OPEN the completion, and spend one more cycle applying it.
    h2b = RootHarness(["VERIFY_EXIT=0\nPROMISE=1\n", "VERIFY_EXIT=0\nPROMISE=1\n"])
    rt2b = None
    sidecar_b = InMemorySteerSidecar()
    rt2b, rid2b = start_root(h2b, steer_store=sidecar_b)

    def steer_inside_cycle_one(n):
        if n == 1:
            rt2b.steer(rid2b, "ALSO add a reset button")

    h2b.on_cycle = steer_inside_cycle_one
    final2b = drive(rt2b, root_spec, rid2b)
    out2b = (final2b.output or {}) if final2b else {}
    check("e2e-late-steer-reopens-completion", len(h2b.cycle_prompts) == 2,
          f"cycles={len(h2b.cycle_prompts)} (a dropped steer would end at 1)")
    check("e2e-late-steer-reaches-the-next-cycle-prompt",
          "reset button" in h2b.cycle_prompts[1], h2b.cycle_prompts[1][:300]
          if len(h2b.cycle_prompts) > 1 else "")
    check("e2e-late-steer-line-says-so",
          any("steering applied" in x for x in h2b.lines), str(h2b.lines))
    check("e2e-late-steer-still-completes",
          out2b.get("passed") is True and out2b.get("cycles_used") == 2
          and "reset button" in str(out2b.get("report") or ""), str(out2b)[:250])

    # ---- layer 7: E2E WAIT GATE ----
    h3 = RootHarness(["VERIFY_EXIT=0\nPROMISE=1\n", "VERIFY_EXIT=0\nPROMISE=1\n"])
    rt3, rid3 = start_root(h3, gating="wait")
    final3 = drive(rt3, root_spec, rid3, answers=["the page is not centered", "accept"])
    out3 = (final3.output or {}) if final3 else {}
    check("e2e-gate-completes", final3 is not None and final3.status == RunStatus.COMPLETED,
          f"status={final3 and final3.status} err={final3 and final3.error}")
    check("e2e-gate-rejection-ran-another-cycle", len(h3.cycle_prompts) == 2,
          str(len(h3.cycle_prompts)))
    check("e2e-gate-rejection-became-steering",
          "not centered" in h3.cycle_prompts[1], h3.cycle_prompts[1][:300]
          if len(h3.cycle_prompts) > 1 else "")
    check("e2e-gate-accept-ends", out3.get("stopped_reason") == "verified-and-accepted"
          and out3.get("passed") is True, str(out3)[:200])

    # ---- layer 7b: budget exhaustion is honest ----
    h4 = RootHarness(["VERIFY_EXIT=1\nPROMISE=0\n"] * 6)
    rt4, rid4 = start_root(h4, budget=2)
    final4 = drive(rt4, root_spec, rid4)
    out4 = (final4.output or {}) if final4 else {}
    check("e2e-budget-honest", out4.get("passed") is False and out4.get("success") is False
          and out4.get("stopped_reason") == "budget-exhausted"
          and out4.get("cycles_used") == 2 and len(h4.cycle_prompts) == 2, str(out4)[:220])

    # ---- layer 8: E2E WRAPPER ----
    def child_ok(run, effect, default_next_node):
        return EffectOutcome.completed({"sub_run_id": "stub", "output": {
            "report": "child report", "success": True,
            "stopped_reason": "verified-complete", "cycles_used": 3}})

    def child_dead(run, effect, default_next_node):
        return EffectOutcome.completed({"sub_run_id": "stub", "output": {
            "success": False, "error": "provider exploded"}})

    for label, handler, expect_ok in (("alive", child_ok, True), ("dead", child_dead, False)):
        rtw = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                      effect_handlers={EffectType.START_SUBWORKFLOW: handler})
        ridw = rtw.start(workflow=wrap_spec, vars={"prompt": "p", "workspace_root": ws})
        stw = rtw.tick(workflow=wrap_spec, run_id=ridw, max_steps=50)
        ow = stw.output or {}
        check(f"e2e-wrapper-{label}-completes", stw.status == RunStatus.COMPLETED, str(stw.status))
        check(f"e2e-wrapper-{label}-contract",
              isinstance(ow.get("response"), str) and ow.get("response")
              and ow.get("success") is expect_ok and isinstance(ow.get("meta"), dict)
              and ow["meta"].get("orchestration") == "ralph", str(ow)[:200])
        if not expect_ok:
            check("e2e-wrapper-dead-says-why", "provider exploded" in str(ow.get("response")),
                  str(ow)[:200])

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} failure(s): {FAILURES}")
        return 1
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
