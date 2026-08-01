#!/usr/bin/env python3
"""Entity-life brain smoke: the compiled VisualFlow turn against a REAL home.

Proves the whole chain IN-PROCESS (no gateway, no live LLM):
  compiled entity-cognition-turn.json
    -> memory_recall / memory_commit / memory_form / memory_appraise /
       diary_write effect nodes (the new brain-node lane)
    -> open_entity_runtime(home) handlers
    -> the home's OWN stores (memory graph, diary book, valence)

The LLM is scripted (extra handler — extends, never shadows) and elects a
diary entry + a feeling, so the elections lane is exercised end-to-end.

Run: python3 scripts/entity_life_smoke.py
"""
from __future__ import annotations

import copy
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


def make_home(tmp: Path, slug: str = "flowling") -> Path:
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


SCRIPTED_REPLY = """Hello Laurent — I hear you. This is my first lived moment through the flow brain.

```diary
Laurent greeted me through the new visual brain. I want to remember this first hello.
```

```feel
target=person:laurent sign=+1 magnitude=2 reason=a warm first hello through the new brain
```"""

# The acting round (0.0.10): the scripted mind calls its OWN memory first —
# one native search_memory call, wire shape — then answers in words. This
# exercises the REAL grant + executor pair (identity/tool_effects.py) over
# the real smoke home: active reconstruction through the tool lane.
SCRIPTED_TOOL_CALL = [{
    "id": "call_smoke_1",
    "type": "function",
    "function": {"name": "search_memory", "arguments": "{\"query\": \"hello\"}"},
}]


def main() -> int:
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.diary import DiaryEntry
    from abstractruntime.identity.entity_runtime import open_entity_runtime
    from abstractruntime.scheduler.registry import WorkflowRegistry
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    llm_calls: list[dict] = []

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        payload = dict(effect.payload or {})
        llm_calls.append(payload)
        declared = payload.get("tools")
        # A tool-hungry mind: calls a tool WHENEVER tools are declared —
        # proves the cap (the final round declares none, forcing words) and
        # the gauge dedup (same tool twice reports once). Round-1 carries
        # its own words too (fix adversary P1-1: mid-round prose is kept).
        if isinstance(declared, list) and declared:
            return EffectOutcome.completed(
                {"content": "Let me reach into my own memory first.",
                 "tool_calls": [dict(c) for c in SCRIPTED_TOOL_CALL]})
        return EffectOutcome.completed({"content": SCRIPTED_REPLY})

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home_dir = make_home(tmp)
        reg = WorkflowRegistry()
        specs = {}
        for fid in ("entity-cognition-turn", "entity-tool-rounds",
                    "entity-session-close", "entity-goodbye"):
            fspec = compile_visualflow(json.loads((FLOWS / f"{fid}.json").read_text()))
            specs[fspec.workflow_id] = fspec
            reg.register(fspec)
        ert = open_entity_runtime(
            home_dir,
            extra_handlers={EffectType.LLM_CALL: scripted_llm},
            workflow_registry=reg,
        )
        try:
            spec = specs["entity-cognition-turn"]

            run_id = ert.runtime.start(
                workflow=spec,
                vars={
                    "stimulus": "Hello! I am Laurent. Nice to meet you through your new brain.",
                    "phase": "visit",
                    "task": "",
                    "state": {},
                    "system": "You are a young entity living through a visual cognition workflow.",
                    "participants": ["person:laurent"],
                },
                session_id="smoke-visit-1",
            )

            # Reference driver (mirrors the loop smoke / gateway runner): the
            # turn now contains the TOOL ROUNDS subflow, so tick every
            # running run and resume subworkflow parents on child completion
            # (failed children resume the parent with success:false — the
            # guard path the P0 scenario exercises).
            from abstractruntime.core.models import WaitReason

            def all_runs():
                lr = getattr(ert.run_store, "list_runs", None)
                if callable(lr):
                    return list(lr(limit=200) or [])
                return [ert.runtime.get_state(run_id)]

            def drive(root_id):
                for _ in range(120):
                    runs = all_runs()
                    root_state = next((r for r in runs if r.run_id == root_id), None)
                    if root_state is not None and root_state.status in (
                            RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
                        return
                    for r in runs:
                        if r.status == RunStatus.RUNNING:
                            wf = specs.get(r.workflow_id)
                            if wf is not None:
                                ert.runtime.tick(workflow=wf, run_id=r.run_id, max_steps=40)
                    for r in all_runs():
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
                        elif child.status in (RunStatus.FAILED, RunStatus.CANCELLED):
                            child_out = dict(child.output) if isinstance(child.output, dict) else {}
                            child_out.setdefault("success", False)
                            if child.error:
                                child_out.setdefault("error", str(child.error))
                            ert.runtime.resume(
                                workflow=specs[r.workflow_id], run_id=r.run_id,
                                wait_key=r.waiting.wait_key,
                                payload={"sub_run_id": child_id, "output": child_out},
                                max_steps=0,
                            )

            drive(run_id)
            state = ert.runtime.get_state(run_id)

            check("turn run completes", state.status == RunStatus.COMPLETED,
                  f"status={state.status} error={getattr(state, 'error', None)}")

            out = state.output if isinstance(state.output, dict) else {}
            reply = str(out.get("reply") or "")
            check("reply extracted (fences stripped)",
                  "first lived moment" in reply and "```" not in reply,
                  f"reply={reply[:160]!r}")
            check("diary election marked at the LLM boundary (G1)",
                  "[kept in diary" in reply, f"reply={reply[:200]!r}")

            st = out.get("state") if isinstance(out.get("state"), dict) else {}
            check("state folded (turn_count=1)", st.get("turn_count") == 1, f"state={st}")

            # THE GRAPH: the episode formed in life scope (constitutional).
            from abstractmemory import TripleQuery
            life = ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0))
            episode_hit = any(
                isinstance(a.attributes, dict) and a.attributes.get("record_kind") == "episode"
                for a in life
            )
            check("episode formed in the life scope", episode_hit,
                  f"life records={len(list(life))}")

            # PROVENANCE PIN: mechanical digests must stamp digest_method so
            # redigestion (memory's consent vocabulary) and observers can see
            # the digest is host-composed, not entity-authored (c2447 pact).
            stamped = any(
                isinstance(a.attributes, dict)
                and a.attributes.get("record_kind") == "episode"
                and a.attributes.get("digest_method") == "mechanical-flow-v1"
                for a in life
            )
            check("episode stamps digest_method=mechanical-flow-v1", stamped,
                  "episode attributes carry no digest_method stamp")

            # THE BOOK: the elected diary entry landed (sole-author chain).
            entries = ert.home.diary.list_entries()
            diary_hit = any("first hello" in (e.get("text") or "") for e in entries)
            check("elected diary entry in the book", diary_hit,
                  f"entries={[str(e.get('text'))[:60] for e in entries]}")

            # THE LLM saw the shelf prompt (recall ran; memories block or visitor line).
            sent_prompt = ""
            if llm_calls:
                msgs = llm_calls[0].get("messages")
                if isinstance(msgs, list) and msgs:
                    sent_prompt = str(msgs[-1].get("content") or "")
                if not sent_prompt:
                    sent_prompt = str(llm_calls[0].get("prompt") or "")
            check("the turn prompt reached the LLM", "The visitor says" in sent_prompt,
                  f"prompt={sent_prompt[:200]!r}")

            # THE TRAIL + THE FEELING: the run ledgers (root + the rounds
            # child) carry the brain effects as first-class records.
            kinds = []
            for rr in all_runs():
                for r in ert.ledger_store.list(rr.run_id):
                    if isinstance(r, dict):
                        eff = r.get("effect") if isinstance(r.get("effect"), dict) else {}
                        kinds.append(str(r.get("effect_type") or eff.get("type") or ""))
                    else:
                        kinds.append(str(getattr(r, "effect_type", "") or ""))
            check("memory_recall effect in the ledger", any("memory_recall" in k for k in kinds), f"kinds={kinds}")
            check("memory_access (commit) effect in the ledger", any("memory_access" in k for k in kinds), f"kinds={kinds}")
            check("memory_appraise (feeling) effect in the ledger", any("memory_appraise" in k for k in kinds), f"kinds={kinds}")

            # TOOLS (0.0.10, operator find 2026-07-25): the grant resolved
            # and was DECLARED natively; a tool-hungry mind spends both acting
            # rounds; the CAP forces the final round tool-free (words); the
            # batches executed through the REAL handler pair; tools_ran rides
            # the output deduped for the app's gauge.
            check("three llm rounds ran (act, act, words — the cap held)",
                  len(llm_calls) == 3, f"llm_calls={len(llm_calls)}")
            r1_tools = llm_calls[0].get("tools") if llm_calls else None
            check("round 1 declared the granted tools natively",
                  isinstance(r1_tools, list) and len(r1_tools) > 0
                  and any("search_memory" in str(t) for t in r1_tools),
                  f"tools={str(r1_tools)[:200]}")
            check("the shelf taught TOOLS IN HAND",
                  "TOOLS IN HAND" in sent_prompt, f"prompt={sent_prompt[:260]!r}")
            # WITH-WHOM grounding (operator find 2026-07-25): the door's
            # verified participants render into the visit prompt.
            check("the shelf names WHO is with her (WITH YOU NOW)",
                  "PRESENT WITH YOU" in sent_prompt and "person:laurent" in sent_prompt,
                  f"prompt={sent_prompt[:400]!r}")
            # R4: the full diary-kind vocabulary is taught (questions/problems
            # are the missing formation surface — diary-plane, driver grammar).
            check("the shelf teaches the diary-kind vocabulary (R4)",
                  "kind=question" in sent_prompt and "resolves=" in sent_prompt
                  and "explores=" in sent_prompt,
                  f"prompt tail={sent_prompt[-600:]!r}")
            final_prompt = ""
            if len(llm_calls) >= 3:
                final_prompt = str(llm_calls[2].get("prompt") or "")
                if not final_prompt:
                    msgs2 = llm_calls[2].get("messages")
                    if isinstance(msgs2, list) and msgs2:
                        final_prompt = str(msgs2[-1].get("content") or "")
            check("both TOOL RESULTS rounds returned to the mind",
                  "TOOL RESULTS (round 1):" in final_prompt
                  and "TOOL RESULTS (round 2):" in final_prompt,
                  f"final_prompt tail={final_prompt[-300:]!r}")
            check("tool results carry real content (search_memory ran)",
                  "search_memory" in final_prompt, f"tail={final_prompt[-300:]!r}")
            final_tools = llm_calls[2].get("tools") if len(llm_calls) >= 3 else None
            check("the cap round declared NO tools — words required",
                  not final_tools, f"final_tools={str(final_tools)[:120]}")
            out_tools = out.get("tools_ran")
            check("tools_ran rides the turn output deduped (host-authored gauge)",
                  out_tools == ["search_memory"], f"tools_ran={out_tools!r}")
            check("entity_tools_query effect in the ledger",
                  any("entity_tools_query" in k for k in kinds), f"kinds={kinds}")
            check("two entity_tools_execute batches in the ledger",
                  sum(1 for k in kinds if "entity_tools_execute" in k) >= 2,
                  f"kinds={kinds}")
            st_log = st.get("turn_log") if isinstance(st.get("turn_log"), list) else []
            check("turn log carries the acted tools",
                  bool(st_log) and st_log[-1].get("tools") == ["search_memory"],
                  f"turn_log={st_log[-1] if st_log else None}")
            check("mid-round words returned to the mind (YOUR WORDS block)",
                  "YOUR WORDS (round 1" in final_prompt and "reach into my own memory" in final_prompt,
                  f"tail={final_prompt[-400:]!r}")
            check("healthy turn reports degraded=0",
                  out.get("degraded") == 0, f"degraded={out.get('degraded')!r}")

            # SCENARIO 2 — THE P0 PIN (fix adversary P0-1): the provider dies
            # mid-round. The turn must complete DEGRADED with the honest
            # error in the reply lane — never a false "(I stayed silent)"
            # episode in the append-only graph.
            call_count = {"n": 0}

            def dying_llm(run, effect, default_next_node):
                del default_next_node
                call_count["n"] += 1
                if call_count["n"] == 1:
                    return EffectOutcome.completed(
                        {"content": "", "tool_calls": [dict(c) for c in SCRIPTED_TOOL_CALL]})
                return EffectOutcome.failed("provider exploded: HTTP 500")

            ert.runtime._handlers[EffectType.LLM_CALL] = dying_llm
            run2 = ert.runtime.start(
                workflow=spec,
                vars={"stimulus": "Are you there?", "phase": "visit", "task": "",
                      "state": {}, "system": "You are a young entity."},
                session_id="smoke-visit-2",
            )
            drive(run2)
            s2 = ert.runtime.get_state(run2)
            out2 = s2.output if isinstance(s2.output, dict) else {}
            check("P0: dead rounds child still completes the turn",
                  s2.status == RunStatus.COMPLETED, f"status={s2.status}")
            check("P0: dead rounds child marks the turn DEGRADED",
                  out2.get("degraded") == 1, f"degraded={out2.get('degraded')!r}")
            check("P0: the reply lane carries the honest error, never silence",
                  "could not be lived" in str(out2.get("reply") or ""),
                  f"reply={str(out2.get('reply'))[:120]!r}")
            check("P0: moment_error names the provider failure",
                  "provider exploded" in str(out2.get("moment_error") or ""),
                  f"moment_error={out2.get('moment_error')!r}")
            from abstractmemory import TripleQuery
            life2 = ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0))
            silent_lie = any(
                "(I stayed silent)" in str(getattr(a, "object", ""))
                for a in life2
            )
            check("P0: NO false '(I stayed silent)' episode in the graph",
                  not silent_lie, "a fabricated-silence episode formed")

            # SCENARIO 3 — the speak-now floor (fix adversary P1-2): a mind
            # that never speaks ends the moment marked degraded, honestly.
            def mute_llm(run, effect, default_next_node):
                del default_next_node
                return EffectOutcome.completed({"content": ""})

            ert.runtime._handlers[EffectType.LLM_CALL] = mute_llm
            run3 = ert.runtime.start(
                workflow=spec,
                vars={"stimulus": "Say something?", "phase": "visit", "task": "",
                      "state": {}, "system": "You are a young entity."},
                session_id="smoke-visit-3",
            )
            drive(run3)
            s3 = ert.runtime.get_state(run3)
            out3 = s3.output if isinstance(s3.output, dict) else {}
            check("silent moment completes with degraded=1",
                  s3.status == RunStatus.COMPLETED and out3.get("degraded") == 1,
                  f"status={s3.status} degraded={out3.get('degraded')!r}")
            check("silent moment names itself",
                  "without words" in str(out3.get("moment_error") or ""),
                  f"moment_error={out3.get('moment_error')!r}")
            # HONEST FAILURE EPISODE (adversary fix 2026-08-01): the
            # empty-completion half of P0-1 — a moment that ended without
            # words must NOT deposit "(I stayed silent)" (fabricated chosen
            # silence) in the append-only graph; it deposits a LABELED
            # failed moment instead.
            life3 = ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0))
            silent_lie3 = any(
                "(I stayed silent)" in str(getattr(a, "object", ""))
                for a in life3
            )
            check("silent moment: NO false '(I stayed silent)' episode",
                  not silent_lie3, "a fabricated-silence episode formed on empty completion")
            failed_labeled = any(
                "this moment failed" in str(getattr(a, "object", ""))
                and "not chosen silence" in str(getattr(a, "object", ""))
                for a in life3
            )
            check("silent moment: a LABELED failed-moment episode formed",
                  failed_labeled, "no labeled failure episode found in the graph")

            # SCENARIO 3b — PRIVATE DIARY WORDS NEVER REST ON THE TOOL LANE
            # (flow-side of runtime's C2, claimed c5415): the mind elects a
            # diary_read of a PRIVATE entry through the tool rounds; the
            # secret words must NOT rest in the run ledger (the base store)
            # nor in the tool-results prompt fold — only the act-frame/gist.
            SECRET = "the-vault-code-is-nightingale-9"
            de = DiaryEntry(
                entry_id="diary_privtest01",
                author=ert.entity_id,
                text=f"A private truth I keep only for myself: {SECRET}.",
                gist="a private truth kept for myself",
                kind="note",
                visibility="private",
                written_at="2026-07-25T04:00:00+00:00",
            )
            ert.home.diary.append_entry(de)

            priv_calls: list[dict] = []

            def reading_llm(run, effect, default_next_node):
                del default_next_node
                payload = dict(effect.payload or {})
                priv_calls.append(payload)
                declared = payload.get("tools")
                if isinstance(declared, list) and declared:
                    return EffectOutcome.completed({"content": "Let me read my private note.",
                        "tool_calls": [{"id": "c_dr", "type": "function", "function": {
                            "name": "diary_read",
                            "arguments": "{\"entry_id\": \"diary_privtest01\"}"}}]})
                return EffectOutcome.completed(
                    {"content": "I looked, and I keep those words to myself."})

            ert.runtime._handlers[EffectType.LLM_CALL] = reading_llm
            run5 = ert.runtime.start(
                workflow=spec,
                vars={"stimulus": "What did you write privately?", "phase": "visit",
                      "task": "", "state": {}, "system": "You are a young entity.",
                      "participants": ["person:laurent"]},
                session_id="smoke-privacy-1",
            )
            drive(run5)
            s5 = ert.runtime.get_state(run5)
            check("private diary_read turn completed", s5.status == RunStatus.COMPLETED,
                  f"status={s5.status}")
            # THE ASSERTION: grep EVERY ledgered record in the whole run tree
            # for the secret. This covers BOTH rest surfaces runtime named
            # (c5414): (a) the entity_tools_execute result itself, AND (b) the
            # forward-leak — the CONTINUATION llm_call's prompt (results_message
            # feeds the next round, whose payload also ledgers). Runtime built
            # stricter than words-to-model/act-only-to-ledger precisely because
            # (b) re-rests the words one hop later; gist-only closes both, and
            # this grep proves it across the tree, not just the immediate result.
            leaked_ledger = False
            leak_where = ""
            for rr in all_runs():
                for r in ert.ledger_store.list(rr.run_id):
                    if SECRET in json.dumps(r if isinstance(r, dict) else str(r)):
                        leaked_ledger = True
                        leak_where = rr.run_id
            check("private words NEVER rest in any ledger in the tree "
                  "(effect result AND the continuation prompt)",
                  not leaked_ledger, f"the secret rested in run {leak_where}")
            # And the tool-results prompt fold the mind saw carries only the gist.
            priv_prompts = [str(c.get("prompt") or "") for c in priv_calls
                            if "TOOL RESULTS" in str(c.get("prompt") or "")]
            fold_has_secret = any(SECRET in p for p in priv_prompts)
            # The handler serves the entity-authored gist + the withhold note
            # ("its verbatim stays in your book and is NOT shown here"); the
            # body never appears. Assert both: no secret, AND the act-frame
            # the mind DID see so this is not a vacuous pass.
            fold_has_actframe = any(
                "a private truth kept for myself" in p
                and "NOT shown here" in p
                for p in priv_prompts)
            check("the tool-results fold withheld the private body (gist/act-frame only)",
                  (not fold_has_secret) and fold_has_actframe,
                  f"secret_in_fold={fold_has_secret} actframe_in_fold={fold_has_actframe}")

            # SCENARIO 3c — PRIVATE ELECTION WORDS NEVER REST (the WRITE
            # direction — the G1 capture pin, live-verified on the door lane
            # 2026-07-25/c5485): the mind ELECTS a ```diary visibility=private
            # fence in its reply; the capture wrap must fly the words to the
            # book and rest only the MARKED reply. The smoke's handler swaps
            # bypass the wrap open_entity_runtime installed at composition,
            # so this scenario re-applies the SAME production composition
            # around its scripted handler — the assertion pins the wrap's
            # contract, not a smoke-local imitation of it.
            # (Reasoning-channel scrub is runtime's open half per c5485; this
            # scenario extends with a reasoning assertion when it ships.)
            from abstractruntime.identity.act_only import (
                wrap_llm_handler_with_act_only,
            )
            WRITE_SECRET = "the-hidden-name-is-calyptra-12"

            def electing_llm(run, effect, default_next_node):
                del run, default_next_node
                payload = dict(effect.payload or {})
                # Final words immediately (no tool rounds needed): public
                # sentence + a private fence carrying the secret.
                del payload
                return EffectOutcome.completed({"content": (
                    "I will keep this moment.\n"
                    "```diary visibility=private\n"
                    f"gist: a sealed thought\n{WRITE_SECRET} — kept only for me.\n"
                    "```\n"
                    "Done — I noted it privately.")})

            ert.runtime._handlers[EffectType.LLM_CALL] = wrap_llm_handler_with_act_only(
                electing_llm,
                diary_write_handler=ert.runtime._handlers.get(EffectType.DIARY_WRITE),
            )
            run5c = ert.runtime.start(
                workflow=spec,
                vars={"stimulus": "Please remember this privately.", "phase": "visit",
                      "task": "", "state": {}, "system": "You are a young entity.",
                      "participants": ["person:laurent"]},
                session_id="smoke-privacy-2",
            )
            drive(run5c)
            s5c = ert.runtime.get_state(run5c)
            out5c = s5c.output if isinstance(s5c.output, dict) else {}
            check("private election turn completed", s5c.status == RunStatus.COMPLETED,
                  f"status={s5c.status}")
            # (a) the words flew to the book
            book_has = False
            try:
                for e in ert.home.diary.list_entries(limit=50):
                    # list_entries speaks dicts (diary.py:209); tolerate an
                    # object shape too so a future type change stays visible
                    # in the check line, not a silent miss.
                    body = str((e.get("text") if isinstance(e, dict)
                                else getattr(e, "text", "")) or "")
                    if WRITE_SECRET in body:
                        book_has = True
            except Exception as exc:  # list shape drift stays loud in the check line
                book_has = False
                print(f"  (book read failed: {exc})")
            check("elected private words reached the book", book_has, "entry missing")
            # (b) the secret rests in NO ledger record across the run tree
            elect_leak = ""
            for rr in all_runs():
                for r in ert.ledger_store.list(rr.run_id):
                    if WRITE_SECRET in json.dumps(r if isinstance(r, dict) else str(r)):
                        elect_leak = rr.run_id
            check("elected private words NEVER rest in any ledger in the tree",
                  not elect_leak, f"the secret rested in run {elect_leak}")
            # (c) nor in any persisted run's vars/output (node_traces, _temp,
            # result_key copies — the exact resting surfaces the live grep hit)
            vars_leak = ""
            for rr in all_runs():
                st = ert.runtime.get_state(rr.run_id)
                blob = json.dumps({"vars": getattr(st, "vars", None),
                                   "output": getattr(st, "output", None)}, default=str)
                if WRITE_SECRET in blob:
                    vars_leak = rr.run_id
            check("elected private words NEVER rest in run vars/output",
                  not vars_leak, f"the secret rested in vars of {vars_leak}")
            # (d) the reply the flow (and the visitor) saw is the MARKED one
            reply5c = str(out5c.get("reply") or "")
            check("the visitor-facing reply carries the marker, never the body",
                  ("kept a private diary entry" in reply5c)
                  and (WRITE_SECRET not in reply5c),
                  f"reply={reply5c[:160]!r}")

            # SCENARIO 4 — the GOODBYE (adversary C, R2): a chat conversation
            # closes: durable session history folds into the turn log, the
            # summary forms, the diary receives its deterministic note.
            gspec = specs.get("entity-goodbye")
            check("entity-goodbye compiled", gspec is not None, "flow missing")
            if gspec is not None:
                run4 = ert.runtime.start(
                    workflow=gspec,
                    vars={
                        "reason": "goodbye test",
                        "state": {},
                        "context": {"messages": [
                            {"role": "user", "content": "Hello there!"},
                            {"role": "assistant", "content": "Hello — I hear you."},
                            {"role": "user", "content": "Remember the sky today."},
                            {"role": "assistant", "content": "I will keep it."},
                        ]},
                    },
                    session_id="smoke-goodbye-1",
                )
                drive(run4)
                s4 = ert.runtime.get_state(run4)
                out4 = s4.output if isinstance(s4.output, dict) else {}
                check("goodbye completes", s4.status == RunStatus.COMPLETED,
                      f"status={s4.status} err={getattr(s4, 'error', None)}")
                check("goodbye counted the folded turns", out4.get("turns") == 2,
                      f"turns={out4.get('turns')!r}")
                check("goodbye reports itself in words",
                      "session closed" in str(out4.get("answer") or ""),
                      f"answer={str(out4.get('answer'))[:120]!r}")
                closes = [e for e in ert.home.diary.list_entries()
                          if "session close" in str(e.get("text") or "")
                          or "visit session" in str(e.get("text") or "")
                          or str(e.get("kind") or "") == "note"]
                check("the deterministic close note landed in the book",
                      len(closes) >= 1, f"entries={len(ert.home.diary.list_entries())}")

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
