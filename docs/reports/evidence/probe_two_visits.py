#!/usr/bin/env python3
"""ADVERSARY-2 probe: two visit sessions in one life.

Hypotheses:
H1 close_turn_id collides across visit sessions ("visit-close-1" twice) —
   does the book keep BOTH deterministic close notes? (suspected P0)
H2 episode turn_ids collide ("visit-turn-1" twice) — provenance ambiguity.
H3 MEMORY_APPRAISE event_id = sha(appraise|scope|owner|target|turn_id|reason)
   has NO run_id: identical feel (target+reason) in turn 1 of two sessions
   -> second appraisal silently swallowed by journal supplied-id dedup?
H4 flow commits ALL rendered ids incl. admission=self (driver commits
   displayed only) — check snapshot admissions.
H5 episode verbatim: feel fence stripped (verbatim-not-verbatim), diary
   marker kept.
H6 episodes carry no digest_method attribute -> redigestion-invisible.
H7 personal/work close describes a turn_log that was never reset
   (session bleed) — covered by turns count in close notes.
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path("/Users/albou/tmp/abstractframework/abstractflow/examples/flows")


def make_home(tmp: Path, slug: str = "probeling") -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal,
        SQLiteTripleStore, engram, lint_spark,
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


FEEL = "```feel\ntarget=person:laurent sign=+1 magnitude=2 reason=kind words\n```"


def scripted_reply(prompt: str) -> str:
    if "The visitor says" in prompt:
        if "second session" in prompt:
            return "Welcome back for the second session.\n\n" + FEEL
        return ("First hello.\n\n```diary\nA first hello worth keeping.\n```\n\n" + FEEL)
    if "Your current task" in prompt:
        return "haiku\n\nDONE"
    if "Own time" in prompt:
        return "One personal step."
    return "I am here."


def main() -> int:
    from abstractruntime.core.models import EffectType, RunStatus, WaitReason
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime
    from abstractruntime.scheduler.registry import WorkflowRegistry
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    flow_ids = ["entity-life", "entity-day-gate", "entity-visit", "entity-work",
                "entity-personal", "entity-sleep", "entity-cognition-turn",
                "entity-session-close", "entity-chat"]
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
        return EffectOutcome.completed({"content": scripted_reply(prompt)})

    scenario = [
        {"kind": "goodbye"},                                            # close session 1 (1 turn)
        {"kind": "visit", "message": "Hello again - second session."},  # session 2
        {"kind": "goodbye"},                                            # close session 2 (1 turn)
        {"kind": "task", "task": "write a haiku. Say DONE."},           # work day
        {"kind": "grant_personal"},                                     # personal day
        {"kind": "stop"},
    ]
    injected = 0
    next_seq = 100

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home_dir = make_home(tmp)
        ert = open_entity_runtime(home_dir, extra_handlers={EffectType.LLM_CALL: scripted_llm},
                                  workflow_registry=reg)
        try:
            root_spec = specs["entity-life"]
            root_id = ert.runtime.start(
                workflow=root_spec,
                vars={"prompt": "Hello, first session.", "system": "Answer briefly.",
                      "max_days": 10, "mailbox": "entity-life"},
                session_id="probe-life",
            )

            def all_runs():
                return list(ert.run_store.list_runs(limit=500) or [])

            rounds = 0
            while rounds < 500:
                rounds += 1
                runs = all_runs()
                progressed = False
                root_state = ert.runtime.get_state(root_id)
                if root_state.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
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
                        ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                           wait_key=r.waiting.wait_key,
                                           payload={"sub_run_id": child_id, "output": child.output or {}},
                                           max_steps=0)
                        progressed = True
                    elif child.status == RunStatus.FAILED:
                        raise RuntimeError(f"child failed: {child.workflow_id}: {child.error}")
                root_state = ert.runtime.get_state(root_id)
                if (root_state.status == RunStatus.WAITING and root_state.waiting is not None
                        and root_state.waiting.reason == WaitReason.EVENT):
                    if injected >= len(scenario):
                        raise RuntimeError("scenario exhausted while parked")
                    seq = next_seq + injected
                    env = {"seq": seq, "payload": scenario[injected]}
                    injected += 1
                    fresh = ert.runtime.get_state(root_id)
                    inbox = fresh.vars.get("events_inbox")
                    inbox = (inbox if isinstance(inbox, list) else []) + [env]
                    fresh.vars["events_inbox"] = inbox
                    ert.run_store.save(fresh)
                    ert.runtime.resume(workflow=root_spec, run_id=root_id,
                                       wait_key=root_state.waiting.wait_key,
                                       payload={"seq": seq}, max_steps=0)
                    progressed = True
                if not progressed:
                    raise RuntimeError("stalled: " + json.dumps(
                        [{"wf": r.workflow_id, "st": str(r.status),
                          "wait": (str(r.waiting.reason) if r.waiting else None)} for r in all_runs()],
                        default=str)[:600])

            final = ert.runtime.get_state(root_id)
            print(f"life status={final.status} rounds={rounds} injected={injected}")

            # H1: both visit close notes?
            entries = ert.home.diary.list_entries()
            texts = [str(e.get("text") or "") for e in entries]
            visit_closes = [t for t in texts if t.startswith("Session closed (visit)")]
            print(f"\nH1 visit close notes in book: {len(visit_closes)}")
            for t in visit_closes:
                print("   ", t[:110])
            origins = [e.get("origin") for e in entries if str(e.get("text") or "").startswith("Session closed (visit)")]
            print("H1 close note origin turn_ids:", [str((o or {}).get("turn_id")) for o in origins])

            # H2: episode turn_id collisions
            from abstractmemory import TripleQuery
            life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))
            ep_turns = []
            for a in life:
                at = a.attributes if isinstance(a.attributes, dict) else {}
                if at.get("record_kind") == "episode":
                    ep_turns.append(str(at.get("turn_id")))
            print(f"\nH2 episode turn_ids: {sorted(ep_turns)}")

            # H3: appraisal count for person:laurent (elected twice, same reason)
            grades = ert.home.ms.gradation(["person:laurent"], scope="self", owner_id=ert.entity_id)
            print(f"\nH3 gradation(person:laurent): {json.dumps(grades, default=str)[:400]}")
            jr = ert.home.ms._journal
            try:
                vev = jr.valence(scope="self", owner_id=ert.entity_id, limit=0)
            except Exception:
                try:
                    vev = jr.valence_events(scope="self", owner_id=ert.entity_id, limit=0)
                except Exception as e:
                    vev = None
                    print("H3 valence read API:", e)
            if vev is not None:
                app = [v for v in vev if getattr(v, "target_id", "") == "person:laurent"]
                print(f"H3 appraisal events for person:laurent: {len(app)} (elected 2x)")
                for v in app:
                    print("   event_id:", getattr(v, "event_id", "")[:20], "reason:", getattr(v, "reason", ""))

            # H4: snapshot admissions - did commits include self-admitted ids?
            try:
                snaps = jr.snapshots(limit=0)
            except Exception:
                snaps = jr.snapshots(trace_id=None, limit=0)
            self_committed = 0
            total_used = 0
            for s in snaps:
                adm = (getattr(s, "provenance", {}) or {}).get("admissions") or {}
                for rid, label in adm.items():
                    total_used += 1
                    if label == "self":
                        self_committed += 1
            print(f"\nH4 snapshots={len(list(snaps))} used ids total={total_used}, admission=self committed={self_committed}")

            # H5: verbatim artifact of episode 1 - feel fence present? diary marker?
            for a in life:
                at = a.attributes if isinstance(a.attributes, dict) else {}
                if at.get("record_kind") == "episode":
                    ref = getattr(a, "payload_ref", None) or at.get("payload_ref")
                    if ref:
                        try:
                            art = ert.home.artifacts.load_text(ref)
                        except Exception:
                            try:
                                art = ert.home.artifacts.get_text(ref)
                            except Exception as e:
                                art = f"<load failed {e}>"
                        txt = str(art)
                        print(f"\nH5 episode verbatim (turn {at.get('turn_id')}):")
                        print("    has ```feel fence:", "```feel" in txt)
                        print("    has [kept in diary marker:", "[kept in diary" in txt)
                        print("    verbatim head:", txt[:180].replace("\n", " | "))
                        break

            # H6: digest_method on episodes?
            has_dm = [str((a.attributes or {}).get("digest_method")) for a in life
                      if isinstance(a.attributes, dict) and (a.attributes or {}).get("record_kind") == "episode"]
            print(f"\nH6 episode digest_method values: {set(has_dm)}")

            # H7: personal close turns count (session bleed: work turn included?)
            personal_closes = [t for t in texts if t.startswith("Session closed (personal)")]
            work_closes = [t for t in texts if t.startswith("Session closed (work)")]
            print(f"\nH7 work close: {work_closes[0][:120] if work_closes else 'MISSING'}")
            print(f"H7 personal close: {personal_closes[0][:160] if personal_closes else 'MISSING'}")
            # summary records: check summarizes edge targets of the personal close
            for a in life:
                at = a.attributes if isinstance(a.attributes, dict) else {}
                if at.get("record_kind") in ("summary",) and at.get("phase") == "personal":
                    print("H7 personal summary digest:", str(a.object)[:200])
        finally:
            ert.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
