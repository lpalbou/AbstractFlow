#!/usr/bin/env python3
"""WAVE-2 DEEP PROBES over the entity-life master (in-process, real home).

  G  grandchild death: the TURN dies inside a visit -> visit completes with an
     honest error answer BUT state {} -> does the master fold {} into life_state?
  T  task overwrite: task1 queued while the visitor chats; task2 arrives before
     work runs -> is task1 silently replaced (lost steer content)?
  L  guard-fallback task_done leak: visit CHILD dies (master guard fires,
     fallback sets task_done=1) -> does the NEXT task run zero turns?
  P  park timeout: waiting.until set from timeout_s; {"timed_out": true} resume
     re-consults the gate and re-parks with NO day counted, no state damage.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path("/Users/albou/tmp/abstractframework/abstractflow/examples/flows")
VERDICTS: list[str] = []


def make_home(tmp: Path, slug: str = "lifeling") -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal, SQLiteTripleStore,
        engram, lint_spark,
    )
    home_dir = tmp / "entities" / slug
    home_dir.mkdir(parents=True)
    entity_id = f"entity:{slug}@home-w2"
    spark = copy.deepcopy(dict(DEFAULT_SPARK_TEMPLATE))
    spark["name"] = slug.capitalize()
    assert lint_spark(spark) == []
    (home_dir / "spark.yaml").write_text(yaml.safe_dump(spark, sort_keys=False), encoding="utf-8")
    (home_dir / "manifest.json").write_text(json.dumps({"entity_id": entity_id}), encoding="utf-8")
    db = home_dir / "memory.sqlite3"
    store = SQLiteTripleStore(db)
    journal = SQLiteJournal(db)
    ms = MemorySystem(store=store, journal=journal)
    assert engram(ms, spark, owner_id=entity_id).created is True
    store.close()
    journal.close()
    return home_dir


def build_specs():
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
    return specs, reg


def drive(ert, specs, root_id, on_park, *, kill_master_visit_child=None, rounds_max=500):
    """Generic drive loop. on_park(root_state) -> True if injected, False to stop.
    kill_master_visit_child: one-shot flag dict -> resume master with failure envelope."""
    from abstractruntime.core.models import RunStatus, WaitReason
    rounds = 0
    while rounds < rounds_max:
        rounds += 1
        runs = list(ert.run_store.list_runs(limit=500) or [])
        progressed = False
        root_state = next((r for r in runs if r.run_id == root_id), None)
        if root_state is not None and root_state.status in (
                RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
            break
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
            if (kill_master_visit_child is not None and r.run_id == root_id
                    and child.workflow_id == "entity-visit"
                    and not kill_master_visit_child.get("done")):
                kill_master_visit_child["done"] = True
                ert.runtime.resume(
                    workflow=specs[r.workflow_id], run_id=r.run_id,
                    wait_key=r.waiting.wait_key,
                    payload={"sub_run_id": child_id,
                             "output": {"success": False, "error": "provider exploded"}},
                    max_steps=0)
                progressed = True
                continue
            if child.status == RunStatus.COMPLETED:
                ert.runtime.resume(
                    workflow=specs[r.workflow_id], run_id=r.run_id,
                    wait_key=r.waiting.wait_key,
                    payload={"sub_run_id": child_id, "output": child.output or {}},
                    max_steps=0)
                progressed = True
            elif child.status == RunStatus.FAILED:
                child_out = dict(child.output) if isinstance(child.output, dict) else {}
                child_out.setdefault("success", False)
                if child.error:
                    child_out.setdefault("error", str(child.error))
                ert.runtime.resume(
                    workflow=specs[r.workflow_id], run_id=r.run_id,
                    wait_key=r.waiting.wait_key,
                    payload={"sub_run_id": child_id, "output": child_out},
                    max_steps=0)
                progressed = True
        root_state = ert.runtime.get_state(root_id)
        if (root_state.status == RunStatus.WAITING and root_state.waiting is not None
                and root_state.waiting.reason == WaitReason.EVENT):
            if on_park(root_state):
                progressed = True
            else:
                return rounds  # parked, scenario done
        if not progressed:
            print(f"  [drive stalled at round {rounds}]")
            break
    return rounds


def inject(ert, specs, root_id, root_state, payload):
    """Gateway-exact durable append + resume."""
    fresh = ert.runtime.get_state(root_id)
    try:
        seq = int(fresh.vars.get("events_inbox_seq") or 0) + 1
    except Exception:
        seq = 1
    fresh.vars["events_inbox_seq"] = seq
    inbox = fresh.vars.get("events_inbox")
    if not isinstance(inbox, list):
        inbox = []
    fresh.vars["events_inbox"] = inbox + [{"seq": seq, "payload": payload}]
    ert.run_store.save(fresh)
    ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                       wait_key=root_state.waiting.wait_key,
                       payload={"seq": seq}, max_steps=0)


def scenario_probe(name, scenario, scripted, *, kill_visit=False, timeout_parks=0,
                   inspect=None):
    from abstractruntime.core.models import EffectType
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    prompts: list[str] = []

    def llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        prompts.append(prompt)
        reply = scripted(prompt)
        if reply == "__FAIL__":
            return EffectOutcome.failed("scripted turn death")
        return EffectOutcome.completed({"content": reply})

    specs, reg = build_specs()
    state = {"i": 0, "timeouts_left": timeout_parks, "until_seen": []}
    kill_flag = {"done": False} if kill_visit else None

    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td))
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = ert.runtime.start(
                workflow=specs["entity-life"],
                vars={"prompt": "Hello! I am Laurent. Nice to meet you.",
                      "system": "Be brief.", "max_days": 20, "mailbox": "entity-life"},
                session_id=f"w2-{name}",
            )

            def on_park(root_state):
                # Optional timeout simulation FIRST (the runtime's deadline resume).
                if state["timeouts_left"] > 0:
                    state["timeouts_left"] -= 1
                    state["until_seen"].append(getattr(root_state.waiting, "until", None))
                    ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                       wait_key=root_state.waiting.wait_key,
                                       payload={"timed_out": True}, max_steps=0)
                    return True
                if state["i"] >= len(scenario):
                    return False
                payload = scenario[state["i"]]
                state["i"] += 1
                inject(ert, specs, root_id, root_state, payload)
                return True

            drive(ert, specs, root_id, on_park, kill_master_visit_child=kill_flag)
            final = ert.runtime.get_state(root_id)
            if inspect:
                inspect(ert, final, prompts, state)
        finally:
            ert.close()


def main() -> int:
    # ---- G: grandchild (turn) death inside a visit ----
    print("PROBE G: TURN dies inside a visit (grandchild death)")
    seen = {"first": True}

    def scripted_g(prompt):
        if "The visitor says" in prompt and "second message" in prompt:
            return "__FAIL__"
        return "I am here."

    def inspect_g(ert, final, prompts, state):
        ls = final.vars.get("life_state") or {}
        wiped = "inbox_cursor" not in ls or not isinstance(ls.get("days_lived"), int) or ls.get("days_lived", 0) == 0
        hello = sum("Nice to meet you" in p for p in prompts)
        print(f"  post life_state keys={sorted(ls.keys())} days={ls.get('days_lived')} cursor={ls.get('inbox_cursor')}")
        print(f"  seed answered {hello}x (replay if >1); status={final.status}")
        if wiped or hello > 1:
            VERDICTS.append("G CONFIRMED: turn grandchild death wipes life_state through a 'healthy' visit")
            print("  G CONFIRMED (life_state wiped / replay)")
        else:
            print("  G not reproduced")

    scenario_probe("g", [
        {"kind": "visit", "message": "second message that dies"},
        {"kind": "stop"},
    ], scripted_g, inspect=inspect_g)

    # ---- T: task overwrite across drains ----
    print("PROBE T: task1 queued during a chatty visit; task2 lands before work")
    tasks_worked: list[str] = []

    def scripted_t(prompt):
        if "Your current task" in prompt:
            tasks_worked.append(prompt)
            return "did it. DONE"
        return "I am here."

    def inspect_t(ert, final, prompts, state):
        t1 = any("TASK-ONE" in p for p in tasks_worked)
        t2 = any("TASK-TWO" in p for p in tasks_worked)
        print(f"  tasks worked: one={t1} two={t2} (work prompts={len(tasks_worked)})")
        if not t1 and t2:
            VERDICTS.append("T CONFIRMED: pending task silently overwritten by a later task (task1 lost)")
            print("  T CONFIRMED (task1 silently lost)")
        elif t1 and t2:
            print("  T not reproduced (both tasks worked)")
        else:
            print(f"  T inconclusive: {tasks_worked}")

    scenario_probe("t", [
        {"kind": "task", "task": "TASK-ONE: alpha. say DONE"},   # captured -> pending_task
        {"kind": "visit", "message": "still chatting"},           # visit day (session opens on seed already; keeps session)
        {"kind": "task", "task": "TASK-TWO: beta. say DONE"},    # overwrites pending TASK-ONE?
        {"kind": "goodbye"},                                       # close session -> work next
        {"kind": "stop"},
    ], scripted_t, inspect=inspect_t)

    # ---- L: guard-fallback task_done leak ----
    print("PROBE L: visit child dies (guard fallback task_done=1) then a task arrives")
    work_prompts: list[str] = []

    def scripted_l(prompt):
        if "Your current task" in prompt:
            work_prompts.append(prompt)
            return "done. DONE"
        return "I am here."

    def inspect_l(ert, final, prompts, state):
        n = sum("LEAK-TASK" in p for p in work_prompts)
        # find the work close note
        entries = ert.home.diary.list_entries()
        texts = [str(e.get("text") or "") for e in entries]
        work_closes = [t for t in texts if t.startswith("Session closed (work)")]
        print(f"  LEAK-TASK turns lived={n}; work close notes={work_closes}")
        if n == 0 and any("0 turns" in t for t in work_closes):
            VERDICTS.append("L CONFIRMED: guard-fallback task_done=1 leaks into life_state; next task runs 0 turns")
            print("  L CONFIRMED (task killed by stale task_done)")
        else:
            print("  L not reproduced")

    scenario_probe("l", [
        {"kind": "goodbye"},                                # close the seeded session first
        {"kind": "visit", "message": "this visit will die"},  # master visit child killed
        {"kind": "task", "task": "LEAK-TASK: gamma. say DONE"},
        {"kind": "stop"},
    ], scripted_l, kill_visit=True, inspect=inspect_l)

    # ---- P: park timeout re-gate ----
    print("PROBE P: park timeout ({'timed_out': true}) re-gates cleanly")
    def scripted_p(prompt):
        return "I am here."

    def inspect_p(ert, final, prompts, state):
        ls = final.vars.get("life_state") or {}
        out = final.output if isinstance(final.output, dict) else {}
        st = out.get("state") if isinstance(out.get("state"), dict) else ls
        untils = state["until_seen"]
        print(f"  waiting.until on parks: {untils}")
        print(f"  final days_lived={st.get('days_lived')} status={final.status}")
        # Seed visit = day 1. Two timeout re-parks must add ZERO days.
        ok_days = st.get("days_lived") == 1
        ok_until = all(u for u in untils)
        if ok_days and ok_until and str(final.status).endswith("COMPLETED"):
            print("  P VERIFIED (deadline set; timeout re-gates; no day counted; clean stop)")
        else:
            VERDICTS.append(f"P FAILED: days={st.get('days_lived')} untils={untils} status={final.status}")
            print("  P FAILED")

    scenario_probe("p", [
        {"kind": "goodbye"},   # close seeded session so the life PARKS clean
        {"kind": "stop"},
    ], scripted_p, timeout_parks=2, inspect=inspect_p)

    print()
    if VERDICTS:
        print(f"{len(VERDICTS)} CONFIRMED FINDING(S):")
        for v in VERDICTS:
            print("  -", v)
        return 1
    print("NO NEW LOOP FINDINGS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
