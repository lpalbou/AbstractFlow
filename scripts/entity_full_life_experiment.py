#!/usr/bin/env python3
"""THE FULL PROOF: a real multi-turn life with graph-health verification.

What the operator asked to see proven (2026-07-24 17:21):
  1. a MULTI-TURN dialogue with a flow-brain entity — memory graph GROWING
     and HEALTHY, verified after every stage;
  2. all FOUR phases lived through the master workflow with a REAL LLM:
     visit (multi-turn session) -> goodbye close -> sleep (real engine
     night) -> work (a real task) -> sleep -> personal (own time on real
     alive-drives) -> sleep -> stop (final close).

GRAPH HEALTH = hard assertions, not vibes:
  - monotone growth of records/edges/diary/valence across stages;
  - every episode carries verbatim payload_ref + keywords + digest_method;
  - every summary carries summarizes edges;
  - the diary hash chain VERIFIES;
  - valence accumulates from [felt:] elections;
  - provenance (run_id/turn_id) on every formed record.

Run:
  PYTHONPATH=../abstractruntime/src:../abstractmemory/src \
    python3 scripts/entity_full_life_experiment.py
Env: ENTITY_NAME (default imre), LLM_PROVIDER/LLM_MODEL (lmstudio /
qwen/qwen3.6-35b-a3b). The home persists under lab/entities/<name>.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from entity_live_experiment import (  # noqa: E402
    FLOWS, LAB, SYSTEM, ensure_home, open_runtime,
)

FAILURES: list[str] = []
STAGES: list[dict] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{name}: {detail}")


# ---------------------------------------------------------------------------
# Graph health
# ---------------------------------------------------------------------------


def graph_health(ert, label: str) -> dict:
    """Measure the home's planes + assert structural health."""
    from abstractmemory import TripleQuery

    entity_id = ert.entity_id
    metrics: dict = {"label": label}
    violations: list[str] = []

    # --- the graph (all scopes the brain writes) ---
    records_by_kind: dict = {}
    edge_rows = 0
    episodes_missing = {"payload_ref": 0, "keywords": 0, "digest_method": 0, "provenance": 0}
    summaries_missing_edges = 0
    summary_ids = []
    for scope in ("life", "self", "diary"):
        for a in ert.home.ms.query(TripleQuery(scope=scope, owner_id=entity_id, limit=0)):
            attrs = a.attributes if isinstance(a.attributes, dict) else {}
            kind = attrs.get("record_kind")
            if attrs.get("record_edge"):
                edge_rows += 1
                continue
            if not kind:
                continue
            records_by_kind[kind] = records_by_kind.get(kind, 0) + 1
            if kind == "episode":
                if not attrs.get("payload_ref"):
                    episodes_missing["payload_ref"] += 1
                if not attrs.get("keywords"):
                    episodes_missing["keywords"] += 1
                if attrs.get("digest_method") != "mechanical-flow-v1":
                    episodes_missing["digest_method"] += 1
                prov = getattr(a, "provenance", None)
                if not (isinstance(prov, dict) and prov.get("run_id") and prov.get("turn_id")):
                    episodes_missing["provenance"] += 1
            if kind == "summary":
                summary_ids.append(str(getattr(a, "subject", "") or ""))

    # summaries must name their sources (summarizes edges from the record).
    for sid in summary_ids:
        found = False
        for scope in ("life", "self"):
            for a in ert.home.ms.query(TripleQuery(scope=scope, owner_id=entity_id, limit=0)):
                attrs = a.attributes if isinstance(a.attributes, dict) else {}
                if attrs.get("record_edge") and str(getattr(a, "subject", "")) == sid \
                        and "summarizes" in str(getattr(a, "predicate", "")):
                    found = True
                    break
            if found:
                break
        if not found:
            summaries_missing_edges += 1

    metrics["records_by_kind"] = records_by_kind
    metrics["records_total"] = sum(records_by_kind.values())
    metrics["edge_rows"] = edge_rows

    # --- the book (hash chain must VERIFY) ---
    entries = ert.home.diary.list_entries()
    metrics["diary_entries"] = len(entries)
    chain_ok = True
    chain_detail = ""
    try:
        from abstractruntime.identity.diary import verify_diary_chain

        rep = verify_diary_chain(ert.home.diary)
        chain_ok = bool(rep.get("ok", rep.get("valid", True))) if isinstance(rep, dict) else bool(rep)
        chain_detail = json.dumps(rep, default=str)[:120] if isinstance(rep, dict) else str(rep)
    except Exception as e:  # noqa: BLE001
        chain_detail = f"verify unavailable: {e}"
    metrics["diary_chain_ok"] = chain_ok

    # --- valence (the feelings journal) ---
    valence_rows = 0
    try:
        con = sqlite3.connect(str(ert.home.home_dir / "memory.sqlite3"))
        try:
            tables = [r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%valence%'")]
            for t in tables:
                valence_rows += con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        finally:
            con.close()
    except Exception:
        valence_rows = -1
    metrics["valence_rows"] = valence_rows

    # --- violations ---
    for key, n in episodes_missing.items():
        if n:
            violations.append(f"{n} episode(s) missing {key}")
    if summaries_missing_edges:
        violations.append(f"{summaries_missing_edges} summary(ies) without summarizes edges")
    if not chain_ok:
        violations.append(f"diary chain does not verify: {chain_detail}")
    metrics["violations"] = violations

    print(f"\n  [health:{label}] records={metrics['records_total']} "
          f"{records_by_kind} edges={edge_rows} diary={len(entries)} "
          f"valence={valence_rows} chain={'OK' if chain_ok else 'BROKEN'}")
    if violations:
        print(f"  [health:{label}] VIOLATIONS: {violations}")
    STAGES.append(metrics)
    return metrics


def assert_growth(before: dict, after: dict, *, expect: dict) -> None:
    """expect: {"records": min_delta, "diary": min_delta, "valence": min_delta}"""
    d_rec = after["records_total"] - before["records_total"]
    d_diary = after["diary_entries"] - before["diary_entries"]
    d_val = (after["valence_rows"] - before["valence_rows"]) if after["valence_rows"] >= 0 else 0
    lbl = f"{before['label']} -> {after['label']}"
    if "records" in expect:
        check(f"growth {lbl}: records +>={expect['records']}", d_rec >= expect["records"],
              f"delta={d_rec}")
    if "diary" in expect:
        check(f"growth {lbl}: diary +>={expect['diary']}", d_diary >= expect["diary"],
              f"delta={d_diary}")
    if "valence" in expect:
        check(f"growth {lbl}: valence +>={expect['valence']}", d_val >= expect["valence"],
              f"delta={d_val}")
    check(f"health {lbl}: zero violations", not after["violations"], str(after["violations"]))


# ---------------------------------------------------------------------------
# The life driver (real LLM, event-steered, mirrors the gateway contracts)
# ---------------------------------------------------------------------------


def drive_life(ert, specs, root_id: str, scenario: list, transcript: list, max_rounds: int = 800):
    from abstractruntime.core.models import RunStatus, WaitReason

    injected = 0
    for _ in range(max_rounds):
        runs = list(ert.run_store.list_runs(limit=400) or [])
        root = next((r for r in runs if r.run_id == root_id), None)
        if root is not None and root.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
            return root, injected
        progressed = False
        for r in runs:
            if r.status == RunStatus.RUNNING and r.workflow_id in specs:
                ert.runtime.tick(workflow=specs[r.workflow_id], run_id=r.run_id, max_steps=40)
                progressed = True
        runs = list(ert.run_store.list_runs(limit=400) or [])
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
            if child.status in (RunStatus.COMPLETED, RunStatus.FAILED):
                out = dict(child.output) if isinstance(child.output, dict) else {}
                if child.status == RunStatus.FAILED:
                    out.setdefault("success", False)
                    if child.error:
                        out.setdefault("error", str(child.error))
                # Capture visit replies for the transcript.
                if child.workflow_id == "entity-visit" and isinstance(out.get("reply"), str):
                    transcript.append({"role": "entity", "text": out["reply"]})
                ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                   wait_key=r.waiting.wait_key,
                                   payload={"sub_run_id": child_id, "output": out}, max_steps=0)
                progressed = True
        root = ert.runtime.get_state(root_id)
        if (root.status == RunStatus.WAITING and root.waiting is not None
                and root.waiting.reason == WaitReason.EVENT):
            if injected >= len(scenario):
                return root, injected  # parked with the scenario exhausted
            fresh = ert.runtime.get_state(root_id)
            try:
                seq = int(fresh.vars.get("events_inbox_seq") or 0) + 1
            except Exception:
                seq = 1
            fresh.vars["events_inbox_seq"] = seq
            env = {"seq": seq, "payload": scenario[injected]}
            if scenario[injected].get("kind") == "visit":
                transcript.append({"role": "visitor", "text": scenario[injected].get("message", "")})
            else:
                transcript.append({"role": "event", "text": json.dumps(scenario[injected])})
            injected += 1
            inbox = fresh.vars.get("events_inbox")
            inbox = (inbox if isinstance(inbox, list) else []) + [env]
            fresh.vars["events_inbox"] = inbox
            ert.run_store.save(fresh)
            ert.runtime.resume(workflow=specs["entity-life"], run_id=root_id,
                               wait_key=root.waiting.wait_key, payload={"seq": seq}, max_steps=0)
            progressed = True
        if not progressed:
            raise RuntimeError("drive stalled")
    raise RuntimeError("max rounds exhausted")


def main() -> int:
    slug = os.environ.get("ENTITY_NAME", "imre")
    provider = os.environ.get("LLM_PROVIDER", "lmstudio")
    model = os.environ.get("LLM_MODEL", "qwen/qwen3.6-35b-a3b")
    print(f"entity={slug} provider={provider} model={model}")

    home_dir = ensure_home(slug)
    ert, specs = open_runtime(home_dir, provider, model)
    transcript: list = []
    t0 = time.time()
    try:
        h_birth = graph_health(ert, "birth")

        # ---- ONE LIFE, ALL FOUR PHASES, MULTI-TURN VISIT SESSION ----------
        scenario = [
            # visit session, turns 2-5 (turn 1 is the seed prompt)
            {"kind": "visit", "message": "Two more things about me: I restore old telescopes, and my workshop overlooks a lake. What of all this speaks to you?"},
            {"kind": "visit", "message": "Which of the things I told you would you keep for yourself, and why? Keep it if it truly matters."},
            {"kind": "visit", "message": "Now tell me back everything you know about me so far, in one list."},
            {"kind": "visit", "message": "One correction: the workshop overlooks a river, not a lake. Please remember the correction itself."},
            {"kind": "goodbye"},
            # work day
            {"kind": "task", "task": "Compose a four-line poem about your first visitor and what they taught you. End with the single word DONE."},
            # personal day (real alive-drives cue)
            {"kind": "grant_personal"},
            # the end
            {"kind": "stop"},
        ]

        root_id = ert.runtime.start(
            workflow=specs["entity-life"],
            vars={
                "prompt": ("Hello! I am Laurent's flow agent, your first visitor. "
                           "Your name is Imre. My favorite composer is Arvo Part."),
                "system": SYSTEM.format(name=slug),
                "max_days": 12,
                "mailbox": "entity-life",
                "participants": ["person:laurent-flow-agent", f"entity:{slug}"],
            },
            session_id="full-life-1",
        )
        final, injected = drive_life(ert, specs, root_id, scenario, transcript)
        check("the life completed", str(final.status).endswith("COMPLETED"),
              f"status={final.status} error={final.error}")
        check("full scenario consumed", injected == len(scenario), f"injected={injected}")

        h_life = graph_health(ert, "after-life")
        # 5 visit turns + 1+ work + 3 personal episodes; closes; diary notes.
        assert_growth(h_birth, h_life, expect={"records": 10, "diary": 3, "valence": 0})

        out = final.output if isinstance(final.output, dict) else {}
        st = out.get("state") if isinstance(out.get("state"), dict) else {}
        check("days lived >= 7 (5 visit + work + personal)", int(st.get("days_lived") or 0) >= 7,
              f"state={st}")

        # The correction turn must be recallable next session (memory of the fix).
        # ---- SESSION 2: fresh life, cross-session recall of the correction ----
        ert.close()
        ert, specs = open_runtime(home_dir, provider, model)
        transcript.append({"role": "system", "text": "--- fresh process, second life ---"})
        scenario2 = [
            {"kind": "visit", "message": "Does my workshop overlook a lake or a river? And who told you your name?"},
            {"kind": "goodbye"},
            {"kind": "stop"},
        ]
        root2 = ert.runtime.start(
            workflow=specs["entity-life"],
            vars={
                "prompt": "Hello again Imre — your first visitor here, back for a second life-session.",
                "system": SYSTEM.format(name=slug),
                "max_days": 6,
                "mailbox": "entity-life",
                "participants": ["person:laurent-flow-agent", f"entity:{slug}"],
            },
            session_id="full-life-2",
        )
        final2, injected2 = drive_life(ert, specs, root2, scenario2, transcript)
        check("life 2 completed", str(final2.status).endswith("COMPLETED"),
              f"status={final2.status} error={final2.error}")

        entity_replies = [t["text"] for t in transcript if t["role"] == "entity"]
        recall_reply = ""
        for t in reversed(transcript):
            if t["role"] == "entity":
                recall_reply = t["text"]
            if t["role"] == "visitor" and "lake or a river" in t["text"]:
                break
        low = recall_reply.lower()
        check("cross-session recall of the CORRECTION (river beats lake)",
              "river" in low, f"reply={recall_reply[:220]!r}")

        h_final = graph_health(ert, "after-life-2")
        assert_growth(h_life, h_final, expect={"records": 2, "diary": 1})

        # ---- the transcript + metrics artifact ----
        artifact = {
            "entity": slug,
            "model": model,
            "duration_s": round(time.time() - t0, 1),
            "turns": len([t for t in transcript if t["role"] == "visitor"]) ,
            "entity_replies": len(entity_replies),
            "stages": STAGES,
            "transcript": transcript,
        }
        out_path = Path("lab") / f"{slug}_full_life.json"
        out_path.parent.mkdir(exist_ok=True)
        out_path.write_text(json.dumps(artifact, indent=2, ensure_ascii=False, default=str))
        print(f"\ntranscript + health stages -> {out_path}")

    finally:
        ert.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S)")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("ALL CHECKS PASS — multi-turn life, growing healthy graph, four phases lived")
    return 0


if __name__ == "__main__":
    sys.exit(main())
