#!/usr/bin/env python3
"""ADVERSARY PROBE: goodbye + visit landing in ONE gate drain.

Scenario: session open (seeded visit lived). Visitor A leaves and visitor B's
first message arrives before the master's next gate (one burst):
  inbox: [goodbye(seq=101), visit(seq=102)]
GATE_CODE drains both (cursor -> 102), goodbye wins the phase decision
(close_visit), and the captured visitor_message is discarded — cursor is
already past it, so B's opening message can never be re-presented.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path(__file__).resolve().parents[3] / "examples" / "flows"


def make_home(tmp: Path, slug: str = "lifeling") -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal, SQLiteTripleStore,
        engram, lint_spark,
    )
    home_dir = tmp / "entities" / slug
    home_dir.mkdir(parents=True)
    entity_id = f"entity:{slug}@home-probe2"
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

    lived_stimuli: list[str] = []

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        if "The visitor says" in prompt:
            lived_stimuli.append(prompt.split("The visitor says:")[-1].strip()[:80])
        return EffectOutcome.completed({"content": "I am here."})

    # Burst injections keyed by park count.
    bursts = [
        [{"seq": 101, "payload": {"kind": "goodbye"}},
         {"seq": 102, "payload": {"kind": "visit", "message": "Hi, I am visitor B - a NEW visitor."}}],
        [{"seq": 103, "payload": {"kind": "stop"}}],
    ]
    burst_i = 0

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
                vars={"prompt": "Hello, I am visitor A.", "system": "Be brief.",
                      "max_days": 10, "mailbox": "entity-life"},
                session_id="probe-2",
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
                    if burst_i >= len(bursts):
                        print("ROOT PARKED, bursts exhausted")
                        break
                    fresh = ert.runtime.get_state(root_id)
                    inbox = fresh.vars.get("events_inbox")
                    if not isinstance(inbox, list):
                        inbox = []
                        fresh.vars["events_inbox"] = inbox
                    for env in bursts[burst_i]:
                        inbox.append(env)
                    burst_i += 1
                    ert.run_store.save(fresh)
                    ert.runtime.resume(
                        workflow=root_spec, run_id=root_id,
                        wait_key=root_state.waiting.wait_key,
                        payload={}, max_steps=0,
                    )
                    progressed = True

                if not progressed:
                    print("DRIVE STALLED")
                    break

            final = ert.runtime.get_state(root_id)
            out = final.output if isinstance(final.output, dict) else {}
            st = out.get("state") if isinstance(out.get("state"), dict) else {}
            print(f"final status   : {final.status}")
            print(f"lived stimuli  : {lived_stimuli}")
            print(f"days_lived     : {st.get('days_lived')}")
            b_lived = any("visitor B" in s for s in lived_stimuli)
            print(f"visitor B's opening message LIVED: {b_lived}")
            if not b_lived:
                print("DEFECT CONFIRMED: goodbye+visit in one drain -> close_visit wins, "
                      "cursor passed visitor B's message, it is dropped forever.")
                return 1
            return 0
        finally:
            ert.close()


if __name__ == "__main__":
    sys.exit(main())
