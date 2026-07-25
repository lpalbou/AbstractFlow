#!/usr/bin/env python3
"""WAVE-2: task-overwrite window (fold 2 depth) + entity-chat context fold (fold 8).

T2: burst [task1, visit] -> gate captures task1 AND breaks on visit (one drain);
    next burst [task2, visit2] -> does task2 overwrite the still-pending task1?
C:  entity-chat with durable context.messages -> folded log renders in the
    shelf prompt (THIS SESSION SO FAR) and does NOT double when state carries
    a turn_log already.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path("/Users/albou/tmp/abstractframework/abstractflow/examples/flows")
FINDINGS: list[str] = []


def make_home(tmp: Path, slug: str = "lifeling") -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal, SQLiteTripleStore,
        engram, lint_spark,
    )
    home_dir = tmp / "entities" / slug
    home_dir.mkdir(parents=True)
    entity_id = f"entity:{slug}@home-w2b"
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


def drive_generic(ert, specs, root_id, on_park, rounds_max=400):
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
            if child.status == RunStatus.COMPLETED:
                ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                   wait_key=r.waiting.wait_key,
                                   payload={"sub_run_id": child_id, "output": child.output or {}},
                                   max_steps=0)
                progressed = True
            elif child.status == RunStatus.FAILED:
                child_out = dict(child.output) if isinstance(child.output, dict) else {}
                child_out.setdefault("success", False)
                if child.error:
                    child_out.setdefault("error", str(child.error))
                ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
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
                break
        if not progressed:
            print(f"  [stalled at round {rounds}]")
            break


def probe_t2():
    from abstractruntime.core.models import EffectType
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime

    tasks_worked: list[str] = []

    def llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        if "Your current task" in prompt:
            tasks_worked.append(prompt)
            return EffectOutcome.completed({"content": "done. DONE"})
        return EffectOutcome.completed({"content": "I am here."})

    specs, reg = build_specs()
    bursts = [
        # ONE burst: task1 captured; task2 DEFERRED (drain boundary); at the
        # NEXT gate task2 is drained while TASK-ONE is still pending (work has
        # not run yet because close_visit interleaves) -> overwrite window.
        [{"kind": "task", "task": "TASK-ONE: alpha. say DONE"},
         {"kind": "task", "task": "TASK-TWO: beta. say DONE"},
         {"kind": "visit", "message": "keep chatting one"}],
        [{"kind": "goodbye"}],
        [{"kind": "stop"}],
    ]
    st = {"i": 0}
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td), slug="tover")
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            root_id = ert.runtime.start(
                workflow=specs["entity-life"],
                vars={"prompt": "Hello, opening the session.", "system": "Be brief.",
                      "max_days": 20, "mailbox": "entity-life"},
                session_id="w2-t2")

            def on_park(root_state):
                if st["i"] >= len(bursts):
                    return False
                fresh = ert.runtime.get_state(root_id)
                try:
                    seq = int(fresh.vars.get("events_inbox_seq") or 0)
                except Exception:
                    seq = 0
                inbox = fresh.vars.get("events_inbox")
                if not isinstance(inbox, list):
                    inbox = []
                new = list(inbox)
                for p in bursts[st["i"]]:
                    seq += 1
                    new.append({"seq": seq, "payload": p})
                fresh.vars["events_inbox_seq"] = seq
                fresh.vars["events_inbox"] = new
                st["i"] += 1
                ert.run_store.save(fresh)
                ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                                   wait_key=root_state.waiting.wait_key,
                                   payload={"seq": seq}, max_steps=0)
                return True

            drive_generic(ert, specs, root_id, on_park)
            t1 = any("TASK-ONE" in p for p in tasks_worked)
            t2 = any("TASK-TWO" in p for p in tasks_worked)
            print(f"  tasks worked: ONE={t1} TWO={t2} (work turns={len(tasks_worked)})")
            if not t1 and t2:
                FINDINGS.append("T2 CONFIRMED: burst-deferred task silently overwritten (TASK-ONE lost)")
                print("  T2 CONFIRMED (TASK-ONE silently lost)")
            else:
                print("  T2 not reproduced")
        finally:
            ert.close()


def probe_chat():
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
        return EffectOutcome.completed({"content": "Indeed, the harbor lights."})

    specs, reg = build_specs()
    ctx_msgs = [
        {"role": "user", "content": "PRIOR-Q1 about the harbor"},
        {"role": "assistant", "content": "PRIOR-A1 lighthouse answer"},
        {"role": "user", "content": "PRIOR-Q2 about the tide"},
        {"role": "assistant", "content": "PRIOR-A2 moon answer"},
    ]
    with tempfile.TemporaryDirectory() as td:
        home = make_home(Path(td), slug="chatling")
        ert = open_entity_runtime(home, extra_handlers={EffectType.LLM_CALL: llm},
                                  workflow_registry=reg)
        try:
            # Case 1: empty state + durable context -> fold renders in shelf.
            root_id = ert.runtime.start(
                workflow=specs["entity-chat"],
                vars={"prompt": "And the buoys?", "system": "Be brief.",
                      "context": {"messages": ctx_msgs}},
                session_id="w2-chat")
            drive_generic(ert, specs, root_id, lambda rs: False)
            final = ert.runtime.get_state(root_id)
            turn_prompt = prompts[-1] if prompts else ""
            ok_render = ("THIS SESSION SO FAR" in turn_prompt
                         and "PRIOR-Q1" in turn_prompt and "PRIOR-A2" in turn_prompt)
            print(f"  chat case1 status={final.status} folded-render={ok_render}")
            if not ok_render:
                FINDINGS.append("C1 FAILED: durable-context fold does not render in the shelf prompt")
                print(f"    prompt head: {turn_prompt[:400]!r}")

            # Case 2: NON-empty state turn_log + context -> no doubling.
            prompts.clear()
            state = {"turn_log": [{"stimulus": "LIVE-S1", "reply": "LIVE-R1"}],
                     "turn_count": 1}
            root2 = ert.runtime.start(
                workflow=specs["entity-chat"],
                vars={"prompt": "Second prompt", "system": "Be brief.",
                      "state": state, "context": {"messages": ctx_msgs}},
                session_id="w2-chat")
            drive_generic(ert, specs, root2, lambda rs: False)
            p2 = prompts[-1] if prompts else ""
            doubled = "PRIOR-Q1" in p2  # context must NOT fold when state has a log
            live_ok = "LIVE-S1" in p2
            print(f"  chat case2 live-log-render={live_ok} context-doubled={doubled}")
            if doubled or not live_ok:
                FINDINGS.append(f"C2 FAILED: doubling={doubled} live_render={live_ok}")
        finally:
            ert.close()


def main() -> int:
    print("PROBE T2: burst task overwrite")
    probe_t2()
    print("PROBE C: entity-chat context fold")
    probe_chat()
    print()
    if FINDINGS:
        print(f"{len(FINDINGS)} FINDING(S):")
        for f in FINDINGS:
            print("  -", f)
        return 1
    print("NO FINDINGS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
