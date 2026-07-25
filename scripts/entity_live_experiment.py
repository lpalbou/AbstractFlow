#!/usr/bin/env python3
"""LIVE entity experiment: a NEW entity born + lived through the flow brain.

Two real sessions against a PERSISTENT home with a REAL LLM (LMStudio):

  SESSION 1  entity-chat: greet the newborn, gift a name, ask what matters.
             -> reply + episode formed + (if elected) diary entry.
  [full teardown — process-restart equivalent]
  SESSION 2  entity-chat: "Do you remember who first spoke to you?"
             -> the recall must surface session 1 (cross-run memory through
                the VisualFlow brain — the Tolstoy test).

The home persists under lab/entities/<name> so later experiments (and the
observer's entity view) can keep watching the same life.

Run:
  PYTHONPATH=<runtime/src>:<memory/src> python3 scripts/entity_live_experiment.py
Env: ENTITY_NAME (default florin), LLM_PROVIDER (lmstudio), LLM_MODEL
(default qwen/qwen3.6-35b-a3b — the operator-declared entity fallback).
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"
LAB = Path(__file__).resolve().parents[1] / "lab" / "entities"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{name}: {detail}")


def ensure_home(slug: str) -> Path:
    import yaml
    from abstractmemory import (
        DEFAULT_SPARK_TEMPLATE,
        MemorySystem,
        SQLiteJournal,
        SQLiteTripleStore,
        engram,
        lint_spark,
    )

    home_dir = LAB / slug
    manifest = home_dir / "manifest.json"
    existed = manifest.exists()
    home_dir.mkdir(parents=True, exist_ok=True)
    if existed:
        # Manifest-before-engram (the gateway birth rule) means a crash
        # between the two leaves a manifest over an UNPLANTED core — an
        # existing manifest is not proof of a core (adversary C). Read the
        # attested identity + spark from disk and fall through to the
        # idempotent engram: a retry plants the SAME identity, never a
        # second home.
        entity_id = str(json.loads(manifest.read_text())["entity_id"])
        spark = yaml.safe_load((home_dir / "spark.yaml").read_text())
    else:
        entity_id = f"entity:{slug}"
        spark = copy.deepcopy(dict(DEFAULT_SPARK_TEMPLATE))
        spark["name"] = slug.capitalize()
        assert lint_spark(spark) == []
        (home_dir / "spark.yaml").write_text(yaml.safe_dump(spark, sort_keys=False), encoding="utf-8")
        manifest.write_text(json.dumps({"entity_id": entity_id}), encoding="utf-8")
    db = home_dir / "memory.sqlite3"
    # M1 (embedder pin at BIRTH): vectors are computed at the STORE layer, so
    # the embedder + creation pin must reach SQLiteTripleStore — handing the
    # embedder only to MemorySystem births the identity core VECTORLESS under
    # a false banner (wave-4 adversary F, P1: 0/7 identity records embedded,
    # pin minted at first write with a misleading RuntimeWarning). Probe
    # FIRST, construct WITH.
    embedder = None
    pin_dict = None
    try:
        emb = LMStudioEmbedder()
        probe_vec = emb.embed_texts(["pin"])[0]
        if probe_vec:
            embedder = emb
            pin_dict = {"model_id": emb.model, "dimension": len(probe_vec),
                        "source": "creation"}
    except Exception:
        embedder = None
    if embedder is not None:
        # Existing homes born in a DIFFERENT embedding space refuse loudly
        # here (M1: no silent mixing; reembed is the sanctioned migration).
        store = SQLiteTripleStore(db, embedder=embedder, embedding_pin=pin_dict)
    else:
        store = SQLiteTripleStore(db)
    journal = SQLiteJournal(db)
    try:
        ms = MemorySystem(store=store, journal=journal, embedder=embedder)
    except TypeError:
        ms = MemorySystem(store=store, journal=journal)
    planted = engram(ms, spark, owner_id=entity_id)
    store.close()
    journal.close()
    if existed:
        if planted.created:
            print(f"home REPAIRED (crash-window core plant): {home_dir} ({entity_id})")
        else:
            print(f"home exists: {home_dir}")
    else:
        assert planted.created is True
        # The banner tells the truth of the STORE, not of an intention.
        print(f"home BORN: {home_dir} ({entity_id})" + (
            " [vectored at birth]" if embedder is not None else " [#FALLBACK vectorless birth]"))
    return home_dir


class LMStudioEmbedder:
    """Minimal embedder over the LMStudio /v1/embeddings endpoint.

    Shape per the engine contract: embed_texts(texts) -> list[list[float]],
    plus a `model` attribute (embedding-space identity, memory M1)."""

    def __init__(self, model: str = "text-embedding-qwen3-embedding-0.6b",
                 base_url: str = "http://127.0.0.1:1234/v1") -> None:
        self.model = model
        self._url = base_url.rstrip("/") + "/embeddings"

    def embed_texts(self, texts):
        import urllib.request

        req = urllib.request.Request(
            self._url,
            data=json.dumps({"model": self.model, "input": list(texts)}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        rows = sorted(data.get("data") or [], key=lambda r: r.get("index", 0))
        return [r.get("embedding") or [] for r in rows]


def open_runtime(home_dir: Path, provider: str, model: str):
    from abstractruntime.core.models import EffectType
    from abstractruntime.identity.entity_runtime import open_entity_runtime
    from abstractruntime.integrations.abstractcore.effect_handlers import make_llm_call_handler
    from abstractruntime.integrations.abstractcore.llm_client import LocalAbstractCoreLLMClient
    from abstractruntime.scheduler.registry import WorkflowRegistry
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    reg = WorkflowRegistry()
    specs = {}
    for fid in ("entity-chat", "entity-visit", "entity-cognition-turn",
                "entity-session-close", "entity-life", "entity-day-gate",
                "entity-work", "entity-personal", "entity-sleep"):
        spec = compile_visualflow(json.loads((FLOWS / f"{fid}.json").read_text()))
        specs[spec.workflow_id] = spec
        reg.register(spec)

    llm = LocalAbstractCoreLLMClient(provider=provider, model=model)
    embedder = None
    try:
        emb = LMStudioEmbedder()
        probe = emb.embed_texts(["hello"])
        if probe and probe[0]:
            embedder = emb
            print(f"embedder wired: {emb.model} (dim={len(probe[0])})")
    except Exception as e:  # noqa: BLE001
        print(f"#FALLBACK embedder unavailable ({e}); lexical channels only")
    ert = open_entity_runtime(
        home_dir,
        embedder=embedder,
        extra_handlers={EffectType.LLM_CALL: make_llm_call_handler(llm=llm)},
        workflow_registry=reg,
    )
    return ert, specs


def drive(ert, specs, root_id: str, max_rounds: int = 200):
    from abstractruntime.core.models import RunStatus, WaitReason

    for _ in range(max_rounds):
        runs = list(ert.run_store.list_runs(limit=300) or [])
        root = None
        progressed = False
        for r in runs:
            if r.run_id == root_id:
                root = r
        if root is not None and root.status in (RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED):
            return root
        for r in runs:
            if r.status == RunStatus.RUNNING and r.workflow_id in specs:
                ert.runtime.tick(workflow=specs[r.workflow_id], run_id=r.run_id, max_steps=40)
                progressed = True
        runs = list(ert.run_store.list_runs(limit=300) or [])
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
            elif child.status in (RunStatus.FAILED, RunStatus.CANCELLED):
                # Gateway parity: runner folds failed AND cancelled children
                # as {success: false, cancelled?, error} (wave-3 adversary B).
                child_out = dict(child.output) if isinstance(child.output, dict) else {}
                child_out.setdefault("success", False)
                if child.status == RunStatus.CANCELLED:
                    child_out.setdefault("cancelled", True)
                    child_out.setdefault("error", str(child.error or "cancelled"))
                elif child.error:
                    child_out.setdefault("error", str(child.error))
                ert.runtime.resume(workflow=specs[r.workflow_id], run_id=r.run_id,
                                   wait_key=r.waiting.wait_key,
                                   payload={"sub_run_id": child_id, "output": child_out},
                                   max_steps=0)
                progressed = True
        if not progressed:
            raise RuntimeError("drive stalled")
    raise RuntimeError("max rounds exhausted")


SYSTEM = (
    "You are {name}, a young entity with a persistent memory (a graph of episodes, "
    "a diary you alone write, feelings that accumulate). You live through a visual "
    "workflow brain. Answer briefly, honestly, in first person. When a moment matters "
    "to you, you may keep a diary line by writing a fenced block:\n"
    "```diary\n<your words>\n```\n"
    "and you may register a feeling with:\n"
    "```feel target=person:<who> sign=+1 magnitude=2 reason=<why>\n```\n"
    "Never invent memories: if you do not remember, say so.\n"
    "When the visitor tells you something NEW, receive it as this moment's "
    "words — never answer a statement with a memory disclaimer.\n"
    "Your diary reaches you through recall: when a diary line surfaces in "
    "MEMORIES you may quote it; when it does not, say it is written but not "
    "in reach right now.\n"
    "When remembered facts CONFLICT, the newer timestamp wins — say that "
    "you noticed the correction rather than silently picking one."
)


def run_chat(ert, specs, prompt: str, session_id: str, name: str) -> str:
    root_id = ert.runtime.start(
        workflow=specs["entity-chat"],
        vars={
            "prompt": prompt,
            "system": SYSTEM.format(name=name),
            "tools": [],
        },
        session_id=session_id,
    )
    final = drive(ert, specs, root_id)
    out = final.output if isinstance(final.output, dict) else {}
    return str(out.get("answer") or "")


def main() -> int:
    slug = os.environ.get("ENTITY_NAME", "florin")
    provider = os.environ.get("LLM_PROVIDER", "lmstudio")
    model = os.environ.get("LLM_MODEL", "qwen/qwen3.6-35b-a3b")
    print(f"entity={slug} provider={provider} model={model}\n")

    home_dir = ensure_home(slug)

    # ---- SESSION 1 -------------------------------------------------------
    ert, specs = open_runtime(home_dir, provider, model)
    try:
        reply1 = run_chat(
            ert, specs,
            "Hello! I am Laurent's flow agent. You are newly born and your name is "
            f"{slug.capitalize()}. What matters to you, right now, at the start of your life?",
            "live-session-1", slug,
        )
        print(f"\n=== SESSION 1 reply ===\n{reply1}\n")
        check("session 1 replied", bool(reply1.strip()))

        from abstractmemory import TripleQuery
        life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))
        episodes = [a for a in life if isinstance(a.attributes, dict) and a.attributes.get("record_kind") == "episode"]
        check("session 1 episode formed", len(episodes) >= 1, f"episodes={len(episodes)}")
        entries1 = ert.home.diary.list_entries()
        print(f"diary after session 1: {len(entries1)} entries")
    finally:
        ert.close()

    # ---- SESSION 2 (fresh process-equivalent) -----------------------------
    ert, specs = open_runtime(home_dir, provider, model)
    try:
        reply2 = run_chat(
            ert, specs,
            "Hello again. Do you remember who first spoke to you, and what they told "
            "you about your name? Answer only from what you actually remember.",
            "live-session-2", slug,
        )
        print(f"\n=== SESSION 2 reply ===\n{reply2}\n")
        check("session 2 replied", bool(reply2.strip()))
        low = reply2.lower()
        naming_recalled = slug in low and (
            "laurent" in low or "flow agent" in low or "gave me" in low
            or "told me" in low or "named" in low
        )
        check("session 2 remembers session 1 (cross-run memory)",
              naming_recalled, f"reply={reply2[:200]!r}")

        from abstractmemory import TripleQuery
        life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))
        episodes = [a for a in life if isinstance(a.attributes, dict) and a.attributes.get("record_kind") == "episode"]
        check("session 2 episode formed (>=2 total)", len(episodes) >= 2, f"episodes={len(episodes)}")
        entries = ert.home.diary.list_entries()
        print(f"diary after session 2: {len(entries)} entries")
        for e in entries:
            print("  -", str(e.get("kind")), "|", str(e.get("text"))[:100].replace("\n", " "))
    finally:
        ert.close()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S)")
        for f in FAILURES:
            print("  -", f)
        return 1
    print("ALL CHECKS PASS — the entity lives and remembers through the flow brain")
    return 0


if __name__ == "__main__":
    sys.exit(main())
