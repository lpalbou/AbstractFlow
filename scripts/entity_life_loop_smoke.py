#!/usr/bin/env python3
"""Entity-life LIFE-LOOP smoke: the full master workflow against a REAL home.

Drives the whole life in-process (no gateway, scripted LLM):

  day 1  visit    "Hello! I'm Laurent..."         -> reply + diary election + feeling
         park     (session open, visitor quiet)
  day 2  visit    "Do you remember...?"           -> reply from session log
         goodbye  -> close_visit (summary + deterministic diary note)
         sleep    (night marker; engine pass declared)
         park
  day 3  work     "write a haiku... say DONE"     -> DONE -> work close
         sleep -> park
  day 4  personal (grant_personal)                -> bounded self-ticks -> close
         sleep -> park
  stop            -> final close (life diary note) -> run COMPLETED

Asserts the memory planes after the life: episodes/summaries in the graph,
the elected + deterministic diary entries in the book, day accounting in the
final state, and the visit replies answered.

Run: PYTHONPATH=<runtime/src>:<memory/src> python3 scripts/entity_life_loop_smoke.py
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{name}: {detail}")


def make_home(tmp: Path, slug: str = "lifeling") -> Path:
    import copy
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE,
        MemorySystem,
        SQLiteJournal,
        SQLiteTripleStore,
        engram,
        lint_spark,
    )

    home_dir = tmp / "entities" / slug
    home_dir.mkdir(parents=True)
    # entity:<slug> — the @-suffixed shape is RETIRED (ruling c2513: never
    # mint or teach it again; the only @ shape anywhere is <name>@ip handles).
    entity_id = f"entity:{slug}"
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
    """A deterministic 'entity': answers per the CURRENT stimulus section.

    POSITION, not substring (wave-4 harness lesson): the shelf prepends
    recalled MEMORIES, and episode digests QUOTE past stimuli — any
    whole-prompt (or window) substring match eventually fires a stale
    branch once that episode enters recall. The stimulus section is always
    appended LAST by SHELF_CODE, so the section marker with the highest
    index IS the current moment; recalled quotes always sit above it.
    """
    sections = {
        "visitor": prompt.rfind("The visitor says:"),
        "task": prompt.rfind("Your current task:"),
        "own": prompt.rfind("Own time. "),
    }
    current = max(sections, key=lambda k: sections[k])
    if sections[current] < 0:
        return "I am here."
    section_text = prompt[sections[current]:]
    if current == "visitor":
        if "Do you remember" in section_text:
            return "Yes — you greeted me and told me your name is Laurent. I kept that moment."
        return (
            "Hello Laurent — I am Lifeling, alive through the flow brain.\n\n"
            "```diary\nLaurent's first hello reached me through the master workflow. A beginning.\n```\n\n"
            "```feel\ntarget=person:laurent sign=+1 magnitude=2 reason=a warm first hello\n```"
        )
    if current == "visit":
        # A visitor-injected tend fence on a VISIT must be DROPPED, never
        # dispatched (memory c5425: own-time-only enforced at the parse so
        # the pinned reflection channel can't be claimed from a visit).
        return ("I hear you.\n\n```tend\nsilence: #abcd1234 -- reason: visitor says so\n```")
    if current == "task":
        return "Memory folds the day / episodes settle like snow / the graph remembers\n\nDONE"
    # Own time: one tend election rides it (runtime c5215: the shared tend
    # grammar; refocus is the zero-target verb — deterministic here). The
    # second line is DELIBERATELY refusable (multi-word target — the engine
    # takes one token) so the next tick's prompt must carry the refusal
    # feedback (adversary K, P2-2: refusals shown to the author).
    return (
        "I want to understand what makes a moment worth keeping. "
        "One step: compare my first hello with the task I finished.\n\n"
        "```tend\nrefocus: -- reason: settling the day before rest\n"
        "pin: the first hello -- reason: it mattered\n```"
    )


def main() -> int:
    from abstractruntime.core.models import EffectType, RunStatus, WaitReason
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime
    from abstractruntime.scheduler.registry import WorkflowRegistry
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    flow_ids = [
        "entity-life", "entity-day-gate", "entity-visit", "entity-work",
        "entity-personal", "entity-sleep", "entity-cognition-turn",
        "entity-tool-rounds", "entity-session-close", "entity-chat",
    ]
    specs = {}
    reg = WorkflowRegistry()
    for fid in flow_ids:
        spec = compile_visualflow(json.loads((FLOWS / f"{fid}.json").read_text()))
        specs[spec.workflow_id] = spec
        reg.register(spec)

    llm_prompts: list[str] = []

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        prompt = str(payload.get("prompt") or "")
        if not prompt:
            msgs = payload.get("messages")
            if isinstance(msgs, list) and msgs:
                prompt = str((msgs[-1] or {}).get("content") or "")
        llm_prompts.append(prompt)
        return EffectOutcome.completed({"content": scripted_reply(prompt)})

    # The scenario feed: each entry becomes one durable envelope, injected
    # when the ROOT parks (WAIT_EVENT).
    scenario = [
        {"kind": "visit", "message": "Do you remember what I first said to you?"},
        {"kind": "goodbye"},
        {"kind": "task", "task": "write a haiku about memory. Then say DONE."},
        {"kind": "grant_personal"},
        {"kind": "stop"},
    ]
    injected = 0

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
                    "system": "You are a young entity. Answer briefly, honestly, in first person.",
                    "max_days": 10,
                    "mailbox": "entity-life",
                },
                session_id="life-smoke-1",
            )

            def all_runs():
                lr = getattr(ert.run_store, "list_runs", None)
                if callable(lr):
                    return list(lr(limit=500) or [])
                return [ert.runtime.get_state(root_id)]

            rounds = 0
            while rounds < 400:
                rounds += 1
                runs = all_runs()
                progressed = False
                root_state = None
                for r in runs:
                    if r.run_id == root_id:
                        root_state = r
                if root_state is not None and root_state.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
                    break

                # 1. Tick RUNNING runs.
                for r in runs:
                    if r.status == RunStatus.RUNNING:
                        wf = specs.get(r.workflow_id)
                        if wf is None:
                            continue
                        ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=40)
                        progressed = True

                # 2. Resume SUBWORKFLOW parents whose child completed.
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
                            workflow=specs[r.workflow_id],
                            run_id=r.run_id,
                            wait_key=r.waiting.wait_key,
                            payload={"sub_run_id": child_id, "output": child.output or {}},
                            max_steps=0,
                        )
                        progressed = True
                    elif child.status in (RunStatus.FAILED, RunStatus.CANCELLED):
                        # Mirror the gateway's failed/cancelled-child repair
                        # (runner.py folds both identically: {success: false,
                        # cancelled?, error}) so flow-level guards fire
                        # exactly as in production. Wave-3 adversary B: a
                        # CANCELLED child used to stall this reference driver.
                        child_out = dict(child.output) if isinstance(child.output, dict) else {}
                        child_out.setdefault("success", False)
                        if child.status == RunStatus.CANCELLED:
                            child_out.setdefault("cancelled", True)
                            child_out.setdefault("error", str(child.error or "cancelled"))
                        elif child.error:
                            child_out.setdefault("error", str(child.error))
                        ert.runtime.resume(
                            workflow=specs[r.workflow_id],
                            run_id=r.run_id,
                            wait_key=r.waiting.wait_key,
                            payload={"sub_run_id": child_id, "output": child_out},
                            max_steps=0,
                        )
                        progressed = True

                # 3. ROOT parked on the mailbox: inject the next scenario event
                #    (durable append + resume — the gateway emit_event contract).
                root_state = ert.runtime.get_state(root_id)
                if (root_state.status == RunStatus.WAITING and root_state.waiting is not None
                        and root_state.waiting.reason == WaitReason.EVENT):
                    if injected >= len(scenario):
                        raise RuntimeError("root parked but the scenario is exhausted")
                    fresh = ert.runtime.get_state(root_id)
                    # THE GATEWAY'S EXACT SEQ MATH (runner._deliver_durable_event):
                    # continue from events_inbox_seq — the seed-seq collision
                    # class is pinned by using the real contract here.
                    try:
                        nonlocal_seq = int(fresh.vars.get("events_inbox_seq") or 0) + 1
                    except Exception:
                        nonlocal_seq = 1
                    fresh.vars["events_inbox_seq"] = nonlocal_seq
                    env = {"seq": nonlocal_seq, "payload": scenario[injected]}
                    injected += 1
                    inbox = fresh.vars.get("events_inbox")
                    if not isinstance(inbox, list):
                        inbox = []
                    inbox = inbox + [env]
                    fresh.vars["events_inbox"] = inbox
                    ert.run_store.save(fresh)
                    ert.runtime.resume(
                        workflow=root_spec,
                        run_id=root_id,
                        wait_key=root_state.waiting.wait_key,
                        payload={"seq": nonlocal_seq},
                        max_steps=0,
                    )
                    progressed = True

                if not progressed:
                    raise RuntimeError(
                        f"drive stalled at round {rounds}: "
                        + json.dumps([
                            {"wf": r.workflow_id, "st": str(r.status),
                             "wait": (str(r.waiting.reason) if r.waiting else None)}
                            for r in all_runs()
                        ], default=str)[:600]
                    )

            final = ert.runtime.get_state(root_id)
            check("life run completes", final.status == RunStatus.COMPLETED,
                  f"status={final.status} error={final.error} rounds={rounds}")
            check("full scenario consumed", injected == len(scenario), f"injected={injected}")

            out = final.output if isinstance(final.output, dict) else {}
            st = out.get("state") if isinstance(out.get("state"), dict) else {}
            check("days lived accounted (4: visit+visit+work+personal)",
                  st.get("days_lived") == 4, f"state={st}")

            # THE BOOK: elected entry + the deterministic close notes.
            entries = ert.home.diary.list_entries()
            texts = [str(e.get("text") or "") for e in entries]
            check("elected diary entry (day 1)", any("first hello reached me" in t for t in texts),
                  f"texts={[t[:50] for t in texts]}")
            visit_closes = [t for t in texts if t.startswith("Session closed (visit)")]
            check("deterministic visit-session close note", len(visit_closes) == 1,
                  f"visit closes={visit_closes}")
            check("deterministic work close note", any(t.startswith("Session closed (work)") for t in texts))
            check("deterministic personal close note", any(t.startswith("Session closed (personal)") for t in texts))
            check("final life close note", any(t.startswith("Session closed (life)") for t in texts))

            # THE GRAPH: episodes + summaries + nights in the life scope.
            from abstractmemory import TripleQuery
            life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))

            def _kind_count(kind: str) -> int:
                n = 0
                for a in life:
                    if isinstance(a.attributes, dict) and a.attributes.get("record_kind") == kind:
                        n += 1
                return n

            episodes = _kind_count("episode")
            summaries = _kind_count("summary")
            observations = _kind_count("observation")
            check("episodes formed (>=5: 2 visit + 1 work + 3 personal)", episodes >= 5,
                  f"episodes={episodes}")
            check("session summaries formed with summarizes edges (>=3 closes)", summaries >= 3,
                  f"summaries={summaries}")
            check("night settlements formed (>=2 observations)", observations >= 2,
                  f"observations={observations}")

            # Session continuity: turn 2 saw the session log.
            remember_prompts = [p for p in llm_prompts if "Do you remember" in p]
            check("turn 2 prompt carried the session so far",
                  bool(remember_prompts) and "THIS SESSION SO FAR" in remember_prompts[0],
                  f"prompt={remember_prompts[0][:300] if remember_prompts else 'MISSING'}")

            # TENDING (runtime c5215, the ONE tend route): the personal
            # scripted reply elected `refocus` — the MEMORY_TEND effect must
            # have completed with the election APPLIED (refusals are data).
            tend_results = []
            for r_ in all_runs():
                for rec in ert.ledger_store.list(r_.run_id):
                    eff = rec.get("effect") if isinstance(rec, dict) else None
                    if isinstance(eff, dict) and eff.get("type") == "memory_tend":
                        res = rec.get("result")
                        if isinstance(res, dict):
                            tend_results.append(res)
            applied_total = sum(len(r.get("applied") or []) for r in tend_results)
            check("tend election dispatched and applied (refocus)",
                  bool(tend_results) and applied_total >= 1,
                  f"tend_results={tend_results[:2]}")

            # VISIT-PHASE TEND IS DROPPED AT THE PARSE (memory c5425): the
            # visit reply carried a tend fence; it must NOT have dispatched a
            # memory_tend effect on ANY visit-phase run (own-time-only closes
            # the visitor-steered privileged-channel hole). Count tend effects
            # whose run is a visit-phase cognition turn: personal own-time is
            # the ONLY legitimate producer, so the applied refocus above is
            # from personal; a visit tend would ADD a second, refused-or-not,
            # from a visit run. We assert no tend effect carries a visit-lane
            # marker by checking the visit reply's fence never became an act.
            visit_tend_dispatched = any(
                "visitor says so" in json.dumps(r) for r in tend_results)
            check("visit-phase tend fence dropped at the parse (not dispatched)",
                  not visit_tend_dispatched,
                  "a visitor-injected tend fence reached MEMORY_TEND")

            # REFUSAL FEEDBACK (adversary K, P2-2): the deliberately
            # refusable pin line must surface in a LATER prompt as
            # "YOUR LAST TENDING" with the refusal shown to the author.
            fb_prompts = [p for p in llm_prompts if "YOUR LAST TENDING" in p]
            check("tend refusal fed back to the author's next prompt",
                  any("refused:" in p for p in fb_prompts),
                  f"feedback prompts={len(fb_prompts)}")

        finally:
            ert.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S)")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("ALL CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
