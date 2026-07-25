#!/usr/bin/env python3
"""ADVERSARY PROBE: seed/seq collision between SEED_CODE (hardcoded seq=1)
and the gateway's `_deliver_durable_event` seq computation
(`int(vars.get("events_inbox_seq") or 0) + 1` -> 1 on first append, because
the flow never initializes events_inbox_seq).

This is the entity_life_loop_smoke drive, but injections use the GATEWAY's
seq math instead of the smoke's dodge (`next_seq = 100  # seed used seq 1`).

Expected if the defect is real: the first steer event (visit "Do you
remember...") is appended with seq=1, the gate's cursor is already 1 after
draining the seed, so the event is silently skipped forever.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path("/Users/albou/tmp/abstractframework/abstractflow/examples/flows")


def make_home(tmp: Path, slug: str = "lifeling") -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal, SQLiteTripleStore,
        engram, lint_spark,
    )
    home_dir = tmp / "entities" / slug
    home_dir.mkdir(parents=True)
    entity_id = f"entity:{slug}@home-probe"
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


def scripted_reply(prompt: str) -> str:
    if "Do you remember" in prompt:
        return "Yes - you told me your name is Laurent."
    if "The visitor says" in prompt:
        return "Hello Laurent - I am Lifeling."
    return "I am here."


def main() -> int:
    from abstractruntime.core.models import EffectType, RunStatus, WaitReason
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime
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

    answered: list[str] = []

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        reply = scripted_reply(prompt)
        if "Do you remember" in prompt:
            answered.append(prompt)
        return EffectOutcome.completed({"content": reply})

    # Scenario: ONE steer event, then stop.
    scenario = [
        {"kind": "visit", "message": "Do you remember what I first said to you?"},
        {"kind": "stop"},
    ]
    injected = 0
    delivered_seqs: list[int] = []

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home_dir = make_home(tmp)
        ert = open_entity_runtime(
            home_dir,
            extra_handlers={EffectType.LLM_CALL: scripted_llm},
            workflow_registry=reg,
        )
        try:
            root_spec = specs["entity-life"]
            root_id = ert.runtime.start(
                workflow=root_spec,
                vars={
                    "prompt": "Hello! I am Laurent. Nice to meet you.",
                    "system": "You are a young entity.",
                    "max_days": 10,
                    "mailbox": "entity-life",
                },
                session_id="probe-1",
            )

            def all_runs():
                return list(ert.run_store.list_runs(limit=500) or [])

            rounds = 0
            while rounds < 300:
                rounds += 1
                runs = all_runs()
                progressed = False
                root_state = None
                for r in runs:
                    if r.run_id == root_id:
                        root_state = r
                if root_state is not None and root_state.status in (
                    RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED
                ):
                    break

                for r in runs:
                    if r.status == RunStatus.RUNNING:
                        wf = specs.get(r.workflow_id)
                        if wf is None:
                            continue
                        ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=40)
                        progressed = True

                runs = all_runs()
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
                        ert.runtime.resume(
                            workflow=specs[r.workflow_id], run_id=r.run_id,
                            wait_key=r.waiting.wait_key,
                            payload={"sub_run_id": child_id, "output": child.output or {}},
                            max_steps=0,
                        )
                        progressed = True
                    elif child.status == RunStatus.FAILED:
                        raise RuntimeError(f"child failed: {child.workflow_id}: {child.error}")

                root_state = ert.runtime.get_state(root_id)
                if (root_state.status == RunStatus.WAITING and root_state.waiting is not None
                        and root_state.waiting.reason == WaitReason.EVENT):
                    if injected >= len(scenario):
                        print(f"ROOT PARKED with scenario exhausted after {injected} events")
                        break
                    fresh = ert.runtime.get_state(root_id)
                    # EXACT GATEWAY MATH (_deliver_durable_event):
                    try:
                        seq = int(fresh.vars.get("events_inbox_seq") or 0) + 1
                    except Exception:
                        seq = 1
                    fresh.vars["events_inbox_seq"] = seq
                    inbox = fresh.vars.get("events_inbox")
                    if not isinstance(inbox, list):
                        inbox = []
                        fresh.vars["events_inbox"] = inbox
                    inbox.append({"seq": seq, "payload": scenario[injected]})
                    delivered_seqs.append(seq)
                    injected += 1
                    ert.run_store.save(fresh)
                    ert.runtime.resume(
                        workflow=root_spec, run_id=root_id,
                        wait_key=root_state.waiting.wait_key,
                        payload={"seq": seq}, max_steps=0,
                    )
                    progressed = True

                if not progressed:
                    print("DRIVE STALLED")
                    break

            final = ert.runtime.get_state(root_id)
            out = final.output if isinstance(final.output, dict) else {}
            st = out.get("state") if isinstance(out.get("state"), dict) else {}
            print(f"final status      : {final.status}")
            print(f"delivered seqs    : {delivered_seqs}")
            print(f"days_lived        : {st.get('days_lived')}")
            print(f"'Do you remember' turn LIVED: {bool(answered)}")
            if not answered and delivered_seqs and delivered_seqs[0] == 1:
                print("DEFECT CONFIRMED: first steer event (seq=1) collided with the "
                      "seeded envelope's seq=1 and was silently skipped by the gate cursor.")
                return 1
            print("no collision observed")
            return 0
        finally:
            ert.close()


if __name__ == "__main__":
    sys.exit(main())
