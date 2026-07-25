#!/usr/bin/env python3
"""Adversary probes for the entity-life master workflow (control-flow lens).

PROBE A: gateway seq collision — seed envelope uses seq=1 but never sets
         events_inbox_seq; the gateway's _deliver_durable_event assigns
         seq = int(vars.get("events_inbox_seq") or 0) + 1 == 1 for the FIRST
         durable event -> gate drain skips it (seq <= cursor) forever.
PROBE B: lost wake — envelope appended AFTER the gate consult (decision=park)
         but BEFORE the park WAIT_EVENT registers; the run parks with an
         undrained envelope and nothing resumes it.
PROBE C: stale task_done — task A (DONE) then task B with no intervening
         turn: task B runs ZERO turns yet counts as a lived day.
PROBE D: message+goodbye burst while session open — the final visitor
         message is consumed by the gate but close_visit wins: never answered.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

FLOWS = Path("/Users/albou/tmp/abstractframework/abstractflow/examples/flows")
sys.path.insert(0, "/Users/albou/tmp/abstractframework/abstractflow/scripts")

from entity_life_loop_smoke import make_home, scripted_reply  # noqa: E402


def build(reg_llm_prompts):
    from abstractruntime.core.models import EffectType
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.scheduler.registry import WorkflowRegistry
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    flow_ids = [
        "entity-life", "entity-day-gate", "entity-visit", "entity-work",
        "entity-personal", "entity-sleep", "entity-cognition-turn",
        "entity-session-close", "entity-chat",
    ]
    specs = {}
    reg = WorkflowRegistry()
    for fid in flow_ids:
        spec = compile_visualflow(json.loads((FLOWS / f"{fid}.json").read_text()))
        specs[spec.workflow_id] = spec
        reg.register(spec)

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        reg_llm_prompts.append(prompt)
        return EffectOutcome.completed({"content": scripted_reply(prompt)})

    return specs, reg, scripted_llm


def gateway_append(store, run_id, payload):
    """EXACTLY the gateway _deliver_durable_event seq rule (runner.py:1776-1784)."""
    run = store.load(run_id)
    vars_obj = run.vars
    inbox = vars_obj.get("events_inbox")
    if not isinstance(inbox, list):
        inbox = []
        vars_obj["events_inbox"] = inbox
    try:
        seq = int(vars_obj.get("events_inbox_seq") or 0) + 1
    except Exception:
        seq = 1
    vars_obj["events_inbox_seq"] = seq
    inbox.append({"event_id": None, "name": "entity-life", "scope": "global",
                  "payload": dict(payload), "seq": seq})
    store.save(run)
    return seq


def drive(ert, specs, root_id, *, on_park, max_rounds=400):
    """Smoke-style drive loop; on_park(root_state) is called when the ROOT parks.
    Return the final root state. on_park returns False to stop driving."""
    from abstractruntime.core.models import RunStatus, WaitReason

    for _ in range(max_rounds):
        runs = list(ert.run_store.list_runs(limit=500) or [])
        root = ert.runtime.get_state(root_id)
        if root.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
            return root
        progressed = False
        for r in runs:
            if r.status == RunStatus.RUNNING:
                wf = specs.get(r.workflow_id)
                if wf is None:
                    continue
                ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=40)
                progressed = True
        runs = list(ert.run_store.list_runs(limit=500) or [])
        for r in runs:
            if r.status != RunStatus.WAITING or r.waiting is None:
                continue
            if r.waiting.reason != WaitReason.SUBWORKFLOW:
                continue
            details = r.waiting.details if isinstance(r.waiting.details, dict) else {}
            child_id = str(details.get("sub_run_id") or "")
            if not child_id:
                continue
            child = ert.runtime.get_state(child_id)
            if child.status == RunStatus.COMPLETED:
                ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                   wait_key=r.waiting.wait_key,
                                   payload={"sub_run_id": child_id, "output": child.output or {}},
                                   max_steps=0)
                progressed = True
            elif child.status == RunStatus.FAILED:
                raise RuntimeError(f"child failed: {child.workflow_id}: {child.error}")
        root = ert.runtime.get_state(root_id)
        if (root.status == RunStatus.WAITING and root.waiting is not None
                and root.waiting.reason == WaitReason.EVENT):
            if on_park(root) is False:
                return root
            progressed = True
        if not progressed:
            raise RuntimeError("drive stalled (no progress, root not parked)")
    raise RuntimeError("max rounds")


def start_life(specs, ert, prompt="Hello! I am Laurent. Nice to meet you."):
    return ert.runtime.start(
        workflow=specs["entity-life"],
        vars={"prompt": prompt,
              "system": "You are a young entity. Answer briefly.",
              "max_days": 10, "mailbox": "entity-life"},
        session_id="probe",
    )


def probe_a():
    """Seq collision: first gateway-appended durable event is silently skipped."""
    import tempfile
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = start_life(specs, ert)
            state = {"parks": 0}

            def on_park(root):
                state["parks"] += 1
                if state["parks"] == 1:
                    # Gateway-style durable append + resume (emit_event contract).
                    seq = gateway_append(ert.run_store, root_id,
                                         {"kind": "visit", "message": "PROBE-A-FIRST are you there?"})
                    print(f"  first gateway event appended with seq={seq}")
                    ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                       wait_key=root.waiting.wait_key,
                                       payload={"seq": seq}, max_steps=0)
                    return True
                if state["parks"] == 2:
                    n1 = sum("PROBE-A-FIRST" in p for p in prompts)
                    print(f"  after wake #1: run re-parked; PROBE-A-FIRST prompts seen = {n1}")
                    seq = gateway_append(ert.run_store, root_id,
                                         {"kind": "visit", "message": "PROBE-A-SECOND hello again"})
                    print(f"  second gateway event appended with seq={seq}")
                    ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                       wait_key=root.waiting.wait_key,
                                       payload={"seq": seq}, max_steps=0)
                    return True
                return False  # stop after third park

            root = drive(ert, specs, root_id, on_park=on_park)
            n1 = sum("PROBE-A-FIRST" in p for p in prompts)
            n2 = sum("PROBE-A-SECOND" in p for p in prompts)
            fresh = ert.runtime.get_state(root_id)
            cursor = (fresh.vars.get("life_state") or {}).get("inbox_cursor")
            print(f"  RESULT: first-event turns={n1} second-event turns={n2} cursor={cursor}")
            print(f"  PROBE A {'CONFIRMED (first event lost)' if n1 == 0 and n2 == 1 else 'not reproduced'}")
        finally:
            ert.close()


def probe_b():
    """Lost wake: envelope lands after gate consult, before park registers."""
    import tempfile
    from abstractruntime.core.models import EffectType, RunStatus, WaitReason
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = start_life(specs, ert)
            # Drive normally until day-1 visit is done and the master heads
            # back to the gate; then single-step so we can slip the envelope
            # in after the gate child completes (decision computed on the old
            # inbox snapshot) and before the park node ticks.
            from abstractruntime.core.models import RunStatus as RS
            appended = {"done": False, "at_node": None}
            for _ in range(600):
                root = ert.runtime.get_state(root_id)
                if root.status == RS.WAITING and root.waiting and root.waiting.reason == WaitReason.EVENT:
                    break  # parked
                runs = list(ert.run_store.list_runs(limit=500) or [])
                progressed = False
                for r in runs:
                    if r.status == RS.RUNNING:
                        wf = specs.get(r.workflow_id)
                        if wf is None:
                            continue
                        # SINGLE-STEP the root so we can observe the if-chain.
                        steps = 1 if r.run_id == root_id else 40
                        ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=steps)
                        progressed = True
                        if r.run_id == root_id and not appended["done"]:
                            cur = ert.runtime.get_state(root_id)
                            # After the gate child resumed us, the master walks
                            # sv_gate_state -> sv_phase -> if_stop ... -> park.
                            if str(cur.current_node or "").startswith("if_") and prompts:
                                # gate consult already happened (day-1 turn done).
                                # Use a clean non-colliding seq so this probe
                                # isolates the ORDERING race from probe A's
                                # seq-collision defect.
                                fresh2 = ert.run_store.load(root_id)
                                fresh2.vars["events_inbox_seq"] = 500
                                ert.run_store.save(fresh2)
                                gateway_append(ert.run_store, root_id,
                                               {"kind": "visit", "message": "PROBE-B missed hello"})
                                appended["done"] = True
                                appended["at_node"] = cur.current_node
                runs = list(ert.run_store.list_runs(limit=500) or [])
                for r in runs:
                    if r.status != RS.WAITING or r.waiting is None:
                        continue
                    if r.waiting.reason != WaitReason.SUBWORKFLOW:
                        continue
                    details = r.waiting.details if isinstance(r.waiting.details, dict) else {}
                    child_id = str(details.get("sub_run_id") or "")
                    if child_id:
                        child = ert.runtime.get_state(child_id)
                        if child.status == RS.COMPLETED:
                            ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                               wait_key=r.waiting.wait_key,
                                               payload={"sub_run_id": child_id, "output": child.output or {}},
                                               max_steps=0)
                            progressed = True
                        elif child.status == RS.FAILED:
                            raise RuntimeError(f"child failed: {child.error}")
                if not progressed:
                    raise RuntimeError("stalled before park")

            root = ert.runtime.get_state(root_id)
            inbox = root.vars.get("events_inbox") or []
            cursor = (root.vars.get("life_state") or {}).get("inbox_cursor")
            pending = [e for e in inbox if isinstance(e, dict) and isinstance(e.get("seq"), int)
                       and e["seq"] > (cursor or 0)]
            n = sum("PROBE-B" in p for p in prompts)
            print(f"  envelope appended at master node={appended['at_node']}")
            print(f"  RESULT: root status={root.status} wait={root.waiting.reason if root.waiting else None}")
            print(f"  inbox has {len(pending)} undrained envelope(s) beyond cursor={cursor}; PROBE-B answered turns={n}")
            ok = (root.status == RunStatus.WAITING and root.waiting.reason == WaitReason.EVENT
                  and len(pending) >= 1 and n == 0)
            print(f"  PROBE B {'CONFIRMED (parked over an undrained envelope; nothing will wake it)' if ok else 'not reproduced'}")
        finally:
            ert.close()


def probe_c():
    """Stale task_done: back-to-back tasks — second task runs zero turns."""
    import tempfile
    from abstractruntime.core.models import EffectType
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    scenario = [
        {"kind": "task", "task": "TASK-ONE write a haiku about memory. Then say DONE."},
        {"kind": "task", "task": "TASK-TWO write a haiku about rivers. Then say DONE."},
        {"kind": "stop"},
    ]
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            # Empty prompt: no seed visit (avoid session interference).
            root_id = start_life(specs, ert, prompt="")
            state = {"i": 0}

            def on_park(root):
                if state["i"] >= len(scenario):
                    return False
                env = {"seq": 1000 + state["i"], "payload": scenario[state["i"]]}
                state["i"] += 1
                fresh = ert.runtime.get_state(root_id)
                inbox = fresh.vars.get("events_inbox")
                inbox = (inbox if isinstance(inbox, list) else []) + [env]
                fresh.vars["events_inbox"] = inbox
                ert.run_store.save(fresh)
                ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                   wait_key=root.waiting.wait_key,
                                   payload={"seq": env["seq"]}, max_steps=0)
                return True

            root = drive(ert, specs, root_id, on_park=on_park)
            n1 = sum("TASK-ONE" in p for p in prompts)
            n2 = sum("TASK-TWO" in p for p in prompts)
            out = root.output if isinstance(root.output, dict) else {}
            st = out.get("state") if isinstance(out.get("state"), dict) else {}
            print(f"  RESULT: TASK-ONE turns={n1} TASK-TWO turns={n2} "
                  f"days_lived={st.get('days_lived')} task_done={st.get('task_done')}")
            print(f"  PROBE C {'CONFIRMED (task B silently skipped, day still counted)' if n1 >= 1 and n2 == 0 else 'not reproduced'}")
        finally:
            ert.close()


def probe_d():
    """Burst: final message + goodbye in one drain — message never answered."""
    import tempfile
    from abstractruntime.core.models import EffectType
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = start_life(specs, ert)  # seed visit opens the session
            state = {"step": 0}

            def on_park(root):
                if state["step"] == 0:
                    state["step"] = 1
                    fresh = ert.runtime.get_state(root_id)
                    inbox = fresh.vars.get("events_inbox")
                    inbox = (inbox if isinstance(inbox, list) else []) + [
                        {"seq": 200, "payload": {"kind": "visit", "message": "PROBE-D final words before I go"}},
                        {"seq": 201, "payload": {"kind": "goodbye"}},
                    ]
                    fresh.vars["events_inbox"] = inbox
                    ert.run_store.save(fresh)
                    ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                       wait_key=root.waiting.wait_key,
                                       payload={"seq": 201}, max_steps=0)
                    return True
                return False

            root = drive(ert, specs, root_id, on_park=on_park)
            n = sum("PROBE-D" in p for p in prompts)
            fresh = ert.runtime.get_state(root_id)
            ls = fresh.vars.get("life_state") or {}
            print(f"  RESULT: PROBE-D answered turns={n} cursor={ls.get('inbox_cursor')} "
                  f"session_open={ls.get('visit_session_open')}")
            print(f"  PROBE D {'CONFIRMED (final message consumed, never answered)' if n == 0 and ls.get('inbox_cursor') == 201 else 'not reproduced'}")
        finally:
            ert.close()


def probe_e():
    """Failed phase child: gateway resumes parent with {success:false,error} ->
    get_node('state', default {}) wipes life_state; cursor resets; inbox replays."""
    import tempfile
    from abstractruntime.core.models import EffectType, RunStatus, WaitReason
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = start_life(specs, ert)
            from abstractruntime.core.models import RunStatus as RS
            killed = {"done": False}
            for _ in range(600):
                root = ert.runtime.get_state(root_id)
                if root.status == RS.WAITING and root.waiting and root.waiting.reason == WaitReason.EVENT:
                    break
                runs = list(ert.run_store.list_runs(limit=500) or [])
                progressed = False
                for r in runs:
                    if r.status == RS.RUNNING:
                        wf = specs.get(r.workflow_id)
                        if wf is None:
                            continue
                        ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=40)
                        progressed = True
                runs = list(ert.run_store.list_runs(limit=500) or [])
                for r in runs:
                    if r.status != RS.WAITING or r.waiting is None or r.waiting.reason != WaitReason.SUBWORKFLOW:
                        continue
                    details = r.waiting.details if isinstance(r.waiting.details, dict) else {}
                    child_id = str(details.get("sub_run_id") or "")
                    if not child_id:
                        continue
                    child = ert.runtime.get_state(child_id)
                    # Kill the FIRST visit child from the master's perspective:
                    # resume the MASTER with the gateway's failure envelope
                    # (runner.py:1966-1974 "Preserve a stable shape").
                    if (r.run_id == root_id and child.workflow_id == "entity-visit"
                            and not killed["done"]):
                        pre = (ert.runtime.get_state(root_id).vars.get("life_state") or {})
                        print(f"  pre-failure life_state keys={sorted(pre.keys())} cursor={pre.get('inbox_cursor')}")
                        ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                           wait_key=r.waiting.wait_key,
                                           payload={"sub_run_id": child_id,
                                                    "output": {"success": False, "error": "provider exploded"}},
                                           max_steps=0)
                        killed["done"] = True
                        progressed = True
                        continue
                    if child.status == RS.COMPLETED:
                        ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                           wait_key=r.waiting.wait_key,
                                           payload={"sub_run_id": child_id, "output": child.output or {}},
                                           max_steps=0)
                        progressed = True
                if not progressed:
                    break
            root = ert.runtime.get_state(root_id)
            ls = root.vars.get("life_state") or {}
            hello_turns = sum("Nice to meet you" in p for p in prompts)
            print(f"  post-failure life_state keys={sorted(ls.keys())} cursor={ls.get('inbox_cursor')} "
                  f"days={ls.get('days_lived')}")
            print(f"  seed 'hello' answered {hello_turns} time(s) (replay if >1)")
            wiped = "inbox_cursor" not in ls or ls.get("inbox_cursor") in (None, 0)
            print(f"  PROBE E {'CONFIRMED (life_state wiped by one failed phase child; inbox replays)' if wiped or hello_turns > 1 else 'not reproduced'}")
        finally:
            ert.close()


def probe_f():
    """Baseline scenario: print per-phase turn counts + close notes to show
    personal budget theft and cross-session summary contamination."""
    import tempfile
    from abstractruntime.core.models import EffectType
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []
    specs, reg, llm = build(prompts)
    scenario = [
        {"kind": "visit", "message": "Do you remember what I first said to you?"},
        {"kind": "goodbye"},
        {"kind": "task", "task": "write a haiku about memory. Then say DONE."},
        {"kind": "grant_personal"},
        {"kind": "stop"},
    ]
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = start_life(specs, ert)
            state = {"i": 0}

            def on_park(root):
                if state["i"] >= len(scenario):
                    return False
                env = {"seq": 100 + state["i"], "payload": scenario[state["i"]]}
                state["i"] += 1
                fresh = ert.runtime.get_state(root_id)
                inbox = (fresh.vars.get("events_inbox") or []) + [env]
                fresh.vars["events_inbox"] = inbox
                ert.run_store.save(fresh)
                ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                   wait_key=root.waiting.wait_key,
                                   payload={"seq": env["seq"]}, max_steps=0)
                return True

            drive(ert, specs, root_id, on_park=on_park)
            own_time = sum("Own time" in p for p in prompts)
            print(f"  personal turns actually lived = {own_time} (max_ticks default is 3)")
            for e in ert.home.diary.list_entries():
                t = str(e.get("text") or "")
                if t.startswith("Session closed"):
                    print(f"  diary: {t[:110]}")
        finally:
            ert.close()


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("a", "all"):
        print("PROBE A: gateway seq collision (seed seq=1 vs events_inbox_seq)")
        probe_a()
    if which in ("b", "all"):
        print("PROBE B: lost wake (append after gate consult, before park)")
        probe_b()
    if which in ("c", "all"):
        print("PROBE C: stale task_done (back-to-back tasks)")
        probe_c()
    if which in ("d", "all"):
        print("PROBE D: message+goodbye burst (message dropped)")
        probe_d()
    if which in ("e", "all"):
        print("PROBE E: failed phase child wipes life_state")
        probe_e()
    if which in ("f", "all"):
        print("PROBE F: baseline turn budgets + close-note contamination")
        probe_f()
