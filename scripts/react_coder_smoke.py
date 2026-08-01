#!/usr/bin/env python3
"""Deterministic smoke for the REACT-CODER family (react-coding + react-coder).

Layers (mirrors multiagent_coding_smoke.py's layering):
0. DOCTRINE GATE: the shipped JSON passes audit_flow_graph --policy-strict.
1. NODE COMPILE: every code-node body compiles through the REAL code-node
   compiler (RestrictedPython, the runtime's own sandbox globals).
2. EXPRESSIONS: the loop law the flow ships compiles and EVALUATES through the
   real pin-expression lane.
3. LOGIC: the behavioural pins — steer watermark dedup, tail-bounded
   transcript, gate accept/revise, report fallbacks.
4. E2E AUTO: a full run through the real Runtime with scripted llm/tool
   effects — two tool cycles then a final answer, progress lines asserted.
5. E2E STEER: a REAL `Runtime.steer()` mid-run, proving the message reaches
   `_runtime.inbox` and lands in the NEXT cycle's prompt and in the report.
6. E2E WAIT GATE: the ask_user gate revises (its words become steering) and
   then accepts.
7. E2E BUDGET: a model that never stops burns the budget and reports honestly.
8. E2E WRAPPER: agent.v1 wrapper over a stubbed child, alive and dead.
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

FLOWS = ROOT / "abstractflow" / "examples" / "flows"
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
    # ---- layer 0: doctrine gate on the shipped JSON ----
    audit = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "audit_flow_graph.py"),
         "--policy-strict", str(FLOWS / "react-coding.json"), str(FLOWS / "react-coder.json")],
        capture_output=True, text=True)
    check("doctrine-gate", audit.returncode == 0,
          (audit.stdout or audit.stderr or "").strip()[-400:])

    flow = json.loads((FLOWS / "react-coding.json").read_text())
    wrapper = json.loads((FLOWS / "react-coder.json").read_text())
    by_id = {n["id"]: n for n in flow["nodes"]}

    # ---- layer 1: every code body compiles ----
    bodies = [n for n in flow["nodes"] + wrapper["nodes"] if n["data"].get("nodeType") == "code"]
    compiled = 0
    for n in bodies:
        try:
            create_code_handler(_generate_code_from_body(n["data"], "transform"), "transform")
            compiled += 1
        except Exception as e:  # pragma: no cover - the failure IS the finding
            check(f"body-compiles-{n['id']}", False, str(e))
    check("bodies-compile", compiled == len(bodies), f"{compiled}/{len(bodies)}")
    check("code-nodes-on-exec-lane",
          all("exec-in" in {p["id"] for p in n["data"]["inputs"]} for n in bodies),
          "every code node must carry exec pins (doctrine)")

    # ---- layer 2: the loop law, through the real expression lane ----
    law = (by_id["loop"]["data"].get("pinExpressions") or {}).get("condition")
    check("loop-law-present", bool(law), str(law))
    fn = compile_pin_expression(law, node_label="loop", pin_id="condition")

    def law_val(done: bool, cycle: int, mx: int) -> bool:
        return bool(fn(None, {"done": done, "cycle": cycle, "max_cycles": mx}))

    check("law-runs-while-open", law_val(False, 0, 3) and law_val(False, 2, 3))
    check("law-stops-on-done", not law_val(True, 0, 3))
    check("law-stops-on-budget", not law_val(False, 3, 3))
    check("law-pin-default-fails-closed",
          by_id["loop"]["data"]["pinDefaults"]["condition"] is False,
          "a pre-expression runtime must exit, never spin")

    # ---- layer 3: behaviour ----
    sf = by_id["steer_fold"]
    out = run_body(sf, {"inbox": [{"role": "system", "content": "use tabs"}],
                        "steer_seen": 0, "steering_notes": ""})["updates"]
    check("steer-fold-applies", "use tabs" in out["steering_notes"] and out["steer_seen"] == 1
          and out["steer_new"] == 1, str(out))
    out2 = run_body(sf, {"inbox": [{"role": "system", "content": "use tabs"}],
                         "steer_seen": out["steer_seen"],
                         "steering_notes": out["steering_notes"]})["updates"]
    check("steer-fold-dedups", out2["steering_notes"] == out["steering_notes"]
          and out2["steer_new"] == 0, str(out2))
    out3 = run_body(sf, {"inbox": [], "steer_seen": 5, "steering_notes": "x"})["updates"]
    check("steer-fold-shrink-guard", out3["steer_seen"] == 0 and out3["steer_new"] == 0, str(out3))
    out4 = run_body(sf, {"inbox": ["bare string"], "steer_seen": 0, "steering_notes": ""})["updates"]
    check("steer-fold-accepts-bare-strings", "bare string" in out4["steering_notes"], str(out4))

    fold = by_id["fold"]
    d = defaults_of(fold)
    folded = run_body(fold, {"transcript": "OLD", "cycle": 1, "thought": "t",
                             "calls_text": "[{}]", "observations": "obs",
                             "entry_text": d["entry_text"], "trim_marker": d["trim_marker"],
                             "max_chars": d["max_chars"]})["updates"]
    check("fold-accumulates", folded["transcript"].startswith("OLD")
          and "cycle 2" in folded["transcript"] and folded["cycle"] == 2, folded["transcript"][:80])
    tight = run_body(fold, {"transcript": "A" * 500, "cycle": 1, "thought": "t",
                            "calls_text": "c", "observations": "o",
                            "entry_text": d["entry_text"], "trim_marker": d["trim_marker"],
                            "max_chars": 120})["updates"]
    check("fold-tail-bounded", len(tight["transcript"]) <= 120 + len(d["trim_marker"])
          and tight["transcript"].startswith(d["trim_marker"]), str(len(tight["transcript"])))

    gf = by_id["gate_fold"]
    gd = defaults_of(gf)
    acc = run_body(gf, {"answer": "accept", "response": "done building", "cycle": 2,
                        "transcript": "", "steering_notes": "", **gd})["updates"]
    check("gate-accept-finishes", acc["done"] is True
          and acc["stopped_reason"] == "accepted-by-user", str(acc))
    rev = run_body(gf, {"answer": "the button does nothing", "response": "done", "cycle": 2,
                        "transcript": "", "steering_notes": "", **gd})["updates"]
    check("gate-revision-becomes-steering", rev["done"] is False
          and "button does nothing" in rev["steering_notes"], str(rev))

    rp = by_id["report"]
    rd = defaults_of(rp)
    exhausted = run_body(rp, {"final_response": "", "cycle": 5, "max_cycles": 5,
                              "done_flag": False, "stopped_reason": "", "has_verify": False,
                              "verified": False, "verify_text": "", "steering_notes": "", **rd})
    check("report-budget-honest", exhausted["passed"] is False
          and exhausted["stopped"] == "budget-exhausted"
          and "#FALLBACK" in exhausted["report"], str(exhausted)[:200])
    red = run_body(rp, {"final_response": "I finished everything", "cycle": 2, "max_cycles": 5,
                        "done_flag": True, "stopped_reason": "model-stopped", "has_verify": True,
                        "verified": False, "verify_text": "boom", "steering_notes": "", **rd})
    check("report-verify-beats-model-claim", red["passed"] is False
          and "VERIFICATION FAILED" in red["report"], str(red)[:200])

    vc = by_id["verify_cmd"]
    cmd = run_body(vc, {"workspace_root": "/tmp/w s", "verify_command": "npm test"})["tool_call"]
    shell = cmd["arguments"]["command"]
    check("verify-quotes-workspace", "cd '/tmp/w s'" in shell, shell[:120])
    check("verify-exit-before-pipe", 'echo "VERIFY_EXIT=$?"' in shell
          and shell.index("VERIFY_EXIT") < shell.index("tail -n 40"), shell[:200])

    # ---- E2E scaffolding -----------------------------------------------------
    from abstractruntime import Runtime
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
    from abstractruntime.storage.steer_sidecar import InMemorySteerSidecar
    from abstractruntime.visualflow_compiler import compile_visualflow

    spec = compile_visualflow(flow)

    class Harness:
        """Scripted llm/tool/answer effects + the prompts the loop actually sent."""

        def __init__(self, script):
            self.script = list(script)
            self.prompts: list[str] = []
            self.lines: list[str] = []
            self.tools_ran: list[str] = []
            self.on_llm = None

        def llm(self, run, effect, default_next_node):
            payload = effect.payload or {}
            self.prompts.append(str(payload.get("prompt") or ""))
            if self.on_llm is not None:
                self.on_llm(len(self.prompts))
            step = self.script.pop(0) if self.script else {"content": "done"}
            return EffectOutcome.completed(dict(step))

        def tools(self, run, effect, default_next_node):
            calls = (effect.payload or {}).get("tool_calls") or []
            results = []
            for c in calls:
                name = str(c.get("name") or "")
                self.tools_ran.append(name)
                results.append({"call_id": c.get("call_id") or "c", "name": name,
                                "success": True, "output": {"stdout": "ok: " + name}})
            if not results:
                results = [{"call_id": "c", "name": "execute_command", "success": True,
                            "output": {"stdout": "VERIFY_EXIT=0\n"}}]
            return EffectOutcome.completed({"mode": "executed", "results": results})

        def answer(self, run, effect, default_next_node):
            self.lines.append(str((effect.payload or {}).get("message") or ""))
            return EffectOutcome.completed({"delivered": True})

        def handlers(self):
            return {EffectType.LLM_CALL: self.llm, EffectType.TOOL_CALLS: self.tools,
                    EffectType.ANSWER_USER: self.answer}

    def tool_step(name="write_file"):
        return {"content": "thinking", "tool_calls": [
            {"call_id": "c1", "name": name, "arguments": {"file_path": "hello.html"}}]}

    ws = tempfile.mkdtemp(prefix="react_smoke_ws_")

    def start(h, *, gating="auto", steer_store=None, budget=6, verify=""):
        rt = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                     effect_handlers=h.handlers(), steer_store=steer_store)
        rid = rt.start(workflow=spec, vars={"request": "build hello.html",
                                            "workspace_root": ws, "gating_mode": gating,
                                            "max_cycles": budget, "verify_command": verify})
        return rt, rid

    def drive(rt, rid, answers=None, max_rounds=40, steps=200):
        answers = list(answers or [])
        final = None
        for _ in range(max_rounds):
            st = rt.tick(workflow=spec, run_id=rid, max_steps=steps)
            if st.status == RunStatus.WAITING:
                if not answers:
                    raise RuntimeError("unanswered gate")
                rt.resume(workflow=spec, run_id=rid, wait_key=st.waiting.wait_key,
                          payload={"response": answers.pop(0)}, max_steps=0)
                continue
            final = st
            break
        return final

    # ---- layer 4: E2E AUTO ----
    h = Harness([tool_step(), tool_step("execute_command"), {"content": "built hello.html"}])
    rt, rid = start(h)
    final = drive(rt, rid)
    out = (final.output or {}) if final else {}
    check("e2e-auto-completes", final is not None and final.status == RunStatus.COMPLETED,
          f"status={final and final.status} err={final and final.error}")
    check("e2e-auto-report", "built hello.html" in str(out.get("report") or ""), str(out)[:200])
    check("e2e-auto-success", out.get("success") is True and out.get("passed") is True, str(out))
    check("e2e-auto-stopped-reason", out.get("stopped_reason") == "model-stopped", str(out))
    check("e2e-auto-cycles", out.get("cycles_used") == 3, str(out))
    check("e2e-auto-tools-ran", h.tools_ran == ["write_file", "execute_command"], str(h.tools_ran))
    check("e2e-auto-gating-line-first", h.lines[:1] == ["gating: auto"], str(h.lines))
    cycle_lines = [line for line in h.lines if line.startswith("react cycle")]
    check("e2e-auto-progress-lines",
          len(cycle_lines) == 3 and cycle_lines[0] == "react cycle 1 of 6: reasoning"
          and cycle_lines[1].startswith("react cycle 2 of 6: ")
          and "write_file" in cycle_lines[1]
          and cycle_lines[2].startswith("react cycle 3 of 6: ")
          and "execute_command" in cycle_lines[2], str(cycle_lines))
    check("e2e-auto-accumulates",
          "ACTION TRACE" in h.prompts[1] and "cycle 1" in h.prompts[1]
          and "ACTION TRACE" in h.prompts[2] and "cycle 2" in h.prompts[2],
          "the ReAct transcript must grow across cycles")
    check("e2e-auto-no-gate-in-auto-mode", True)

    # ---- layer 5: E2E STEER (the mission's proof) ----
    sidecar = InMemorySteerSidecar()
    h2 = Harness([tool_step(), tool_step(), tool_step(), {"content": "done after steering"}])
    rt2, rid2 = start(h2, steer_store=sidecar)
    steered = {"seq": None}

    def steer_after_first(n):
        # Sent from INSIDE the first llm_call, i.e. mid-run: the tick drains it
        # into _runtime.inbox at the next step boundary and cycle 2 must see it.
        if n == 1:
            steered["seq"] = rt2.steer(rid2, "STOP adding features — make the button red instead")

    h2.on_llm = steer_after_first
    final2 = drive(rt2, rid2)
    out2 = (final2.output or {}) if final2 else {}
    check("e2e-steer-queued", steered["seq"] is not None, str(steered))
    check("e2e-steer-run-completes", final2 is not None and final2.status == RunStatus.COMPLETED,
          f"status={final2 and final2.status} err={final2 and final2.error}")
    check("e2e-steer-absent-from-the-prompt-it-preceded",
          "button red" not in h2.prompts[0], "cycle 1 was already composed")
    check("e2e-steer-lands-in-next-cycle-prompt",
          "button red" in h2.prompts[1] and "OPERATOR STEERING" in h2.prompts[1],
          h2.prompts[1][:400] if len(h2.prompts) > 1 else "no second prompt")
    check("e2e-steer-applied-once",
          h2.prompts[2].count("STOP adding features") == 1, "watermark dedup across cycles")
    check("e2e-steer-line-says-so",
          any("steering applied" in line for line in h2.lines), str(h2.lines))
    check("e2e-steer-in-report", "STOP adding features" in str(out2.get("report") or ""),
          str(out2)[:300])
    run_after = rt2.get_state(rid2)
    inbox = ((run_after.vars.get("_runtime") or {}).get("inbox") or [])
    check("e2e-steer-inbox-untouched-by-the-flow", len(inbox) == 1,
          "the loop watermarks, it never destroys the runtime's inbox")

    # ---- layer 5b: E2E LATE STEER (0.1.1 — a claim of done is not the end
    # when the operator just spoke). The steer is queued WHILE the model is
    # producing its final, tool-free answer: the late drain must catch it, the
    # loop must run another cycle, and the report must show the steering.
    sidecar_b = InMemorySteerSidecar()
    hb = Harness([{"content": "all done, nothing left"}, tool_step("edit_file"),
                  {"content": "now with the reset button"}])
    rtb, ridb = start(hb, steer_store=sidecar_b)

    def steer_on_the_claim(n):
        if n == 1:
            rtb.steer(ridb, "ALSO add a reset button")

    hb.on_llm = steer_on_the_claim
    finalb = drive(rtb, ridb)
    outb = (finalb.output or {}) if finalb else {}
    check("e2e-late-steer-does-not-finish-on-the-claim", len(hb.prompts) == 3,
          f"prompts={len(hb.prompts)} (a dropped steer would end at 1)")
    check("e2e-late-steer-reaches-the-next-prompt",
          "reset button" in hb.prompts[1] and "claimed the task was complete" in hb.prompts[1],
          hb.prompts[1][:300] if len(hb.prompts) > 1 else "")
    check("e2e-late-steer-line-says-so",
          any("steering applied" in line for line in hb.lines), str(hb.lines))
    check("e2e-late-steer-final-answer-is-the-later-one",
          "reset button" in str(outb.get("report") or "")
          and outb.get("stopped_reason") == "model-stopped", str(outb)[:250])

    # ---- layer 6: E2E WAIT GATE ----
    h3 = Harness([{"content": "I think it is done"}, tool_step("edit_file"),
                  {"content": "now it is really done"}])
    rt3, rid3 = start(h3, gating="wait")
    final3 = drive(rt3, rid3, answers=["the button is still blue", "accept"])
    out3 = (final3.output or {}) if final3 else {}
    check("e2e-gate-completes", final3 is not None and final3.status == RunStatus.COMPLETED,
          f"status={final3 and final3.status} err={final3 and final3.error}")
    check("e2e-gate-revision-continued-the-loop", len(h3.prompts) == 3, str(len(h3.prompts)))
    check("e2e-gate-revision-is-steering",
          "still blue" in h3.prompts[1] and "OPERATOR STEERING" in h3.prompts[1],
          h3.prompts[1][:300] if len(h3.prompts) > 1 else "")
    check("e2e-gate-accept-ends", out3.get("stopped_reason") == "accepted-by-user"
          and "really done" in str(out3.get("report") or ""), str(out3)[:200])

    # ---- layer 7: E2E BUDGET (a model that never stops) ----
    h4 = Harness([tool_step()] * 10)
    rt4, rid4 = start(h4, budget=3)
    final4 = drive(rt4, rid4)
    out4 = (final4.output or {}) if final4 else {}
    check("e2e-budget-completes", final4 is not None and final4.status == RunStatus.COMPLETED,
          f"status={final4 and final4.status}")
    check("e2e-budget-honest", out4.get("success") is False
          and out4.get("stopped_reason") == "budget-exhausted"
          and out4.get("cycles_used") == 3, str(out4)[:200])
    check("e2e-budget-only-3-cycles", len(h4.prompts) == 3, str(len(h4.prompts)))

    # ---- layer 7b: E2E deterministic verification decides `passed` ----
    h5 = Harness([{"content": "I am done (but the tests are red)"}])

    def red_verify(run, effect, default_next_node):
        calls = (effect.payload or {}).get("tool_calls") or []
        return EffectOutcome.completed({"mode": "executed", "results": [
            {"call_id": (calls[0].get("call_id") if calls else "c"), "name": "execute_command",
             "success": True, "output": {"stdout": "VERIFY_EXIT=1\nE   assert False\n"}}]})

    rt5 = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                  effect_handlers={EffectType.LLM_CALL: h5.llm,
                                   EffectType.TOOL_CALLS: red_verify,
                                   EffectType.ANSWER_USER: h5.answer})
    rid5 = rt5.start(workflow=spec, vars={"request": "build hello.html", "workspace_root": ws,
                                          "gating_mode": "auto", "max_cycles": 6,
                                          "verify_command": "pytest"})
    final5 = drive(rt5, rid5)
    out5 = (final5.output or {}) if final5 else {}
    check("e2e-verify-red-fails-the-run", out5.get("passed") is False
          and out5.get("success") is False
          and "VERIFICATION FAILED" in str(out5.get("report") or ""), str(out5)[:250])

    # ---- layer 8: E2E WRAPPER (agent.v1 contract, alive and dead child) ----
    wspec = compile_visualflow(wrapper)

    def child_ok(run, effect, default_next_node):
        # The subflow lane delivers the child's on_flow_end map under `output`
        # (compiler `_sync_effect_results_to_node_outputs`, start_subworkflow),
        # which is then spread onto the declared child_output pins.
        return EffectOutcome.completed({"sub_run_id": "stub", "output": {
            "report": "child report", "success": True,
            "stopped_reason": "model-stopped", "cycles_used": 2}})

    def child_dead(run, effect, default_next_node):
        # A DEAD child never reaches an on_flow_end: the death blob rides
        # `output` verbatim and every declared field arrives None.
        return EffectOutcome.completed({"sub_run_id": "stub", "output": {
            "success": False, "error": "provider exploded"}})

    for label, handler, expect_ok in (("alive", child_ok, True), ("dead", child_dead, False)):
        rtw = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore(),
                      effect_handlers={EffectType.START_SUBWORKFLOW: handler})
        ridw = rtw.start(workflow=wspec, vars={"prompt": "p", "workspace_root": ws})
        stw = rtw.tick(workflow=wspec, run_id=ridw, max_steps=50)
        ow = stw.output or {}
        check(f"e2e-wrapper-{label}-completes", stw.status == RunStatus.COMPLETED, str(stw.status))
        check(f"e2e-wrapper-{label}-contract",
              isinstance(ow.get("response"), str) and ow.get("response")
              and ow.get("success") is expect_ok and isinstance(ow.get("meta"), dict)
              and ow["meta"].get("orchestration") == "react", str(ow)[:200])
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
