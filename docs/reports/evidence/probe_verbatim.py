#!/usr/bin/env python3
"""H5 targeted: run ONE visit cognition turn directly; inspect the episode
verbatim for feel-fence stripping + diary marker, and the recall handles'
admission labels (identity presence)."""
from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

FLOWS = Path(__file__).resolve().parents[3] / "examples" / "flows"

REPLY = """Hello - I hear you.

```diary
A hello worth keeping.
```

```feel
target=person:laurent sign=+1 magnitude=2 reason=kind words
```

And this is the closing thought after the fences."""


def make_home(tmp: Path) -> Path:
    import yaml
    from abstractmemory import (DEFAULT_SPARK_TEMPLATE, MemorySystem, SQLiteJournal,
                                SQLiteTripleStore, engram, lint_spark)
    home_dir = tmp / "entities" / "verbling"
    home_dir.mkdir(parents=True)
    entity_id = "entity:verbling@home-probe"
    spark = copy.deepcopy(dict(DEFAULT_SPARK_TEMPLATE))
    spark["name"] = "Verbling"
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
    from abstractruntime.core.models import EffectType, RunStatus
    from abstractruntime.core.runtime import EffectOutcome
    from abstractruntime.identity.entity_runtime import open_entity_runtime
    from abstractruntime.visualflow_compiler.compiler import compile_visualflow

    recalls: list[dict] = []

    def scripted_llm(run, effect, default_next_node):
        del default_next_node
        return EffectOutcome.completed({"content": REPLY})

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        home_dir = make_home(tmp)
        ert = open_entity_runtime(home_dir, extra_handlers={EffectType.LLM_CALL: scripted_llm})
        try:
            spec = compile_visualflow(json.loads((FLOWS / "entity-cognition-turn.json").read_text()))
            run_id = ert.runtime.start(workflow=spec, vars={
                "stimulus": "Hello there, tell me what you value.", "phase": "visit",
                "task": "", "state": {}, "system": "Be brief.", "tools": []},
                session_id="verb-1")
            state = ert.runtime.tick(workflow=spec, run_id=run_id, max_steps=80)
            print("status:", state.status)
            out = state.output if isinstance(state.output, dict) else {}
            print("reply out:", repr(str(out.get("reply"))[:200]))

            # ledger: recall result handles admissions
            for r in ert.ledger_store.list(run_id):
                d = r if isinstance(r, dict) else getattr(r, "__dict__", {})
                eff = d.get("effect") if isinstance(d.get("effect"), dict) else {}
                et = str(d.get("effect_type") or eff.get("type") or "")
                if "memory_recall" in et:
                    res = d.get("result") if isinstance(d.get("result"), dict) else {}
                    handles = res.get("handles") or []
                    print(f"recall handles={len(handles)} admissions:",
                          sorted({str(h.get('admission')) for h in handles if isinstance(h, dict)}))

            from abstractmemory import TripleQuery
            life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))
            for a in life:
                at = a.attributes if isinstance(a.attributes, dict) else {}
                if at.get("record_kind") == "episode":
                    print("episode digest:", str(a.object)[:160])
                    ref = getattr(a, "payload_ref", None) or at.get("payload_ref")
                    print("payload_ref:", ref)
                    if ref:
                        art = None
                        for meth in ("load_text", "get_text", "read_text", "load"):
                            fn = getattr(ert.home.artifacts, meth, None)
                            if callable(fn):
                                try:
                                    art = fn(ref)
                                    break
                                except Exception:
                                    continue
                        txt = art if isinstance(art, str) else str(art)
                        print("verbatim:")
                        print(txt)
                        print("---")
                        print("has feel fence:", "```feel" in txt, "| has feel words:", "kind words" in txt)
                        print("has diary marker:", "[kept in diary" in txt)
                        print("has closing thought:", "closing thought" in txt)
        finally:
            ert.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
