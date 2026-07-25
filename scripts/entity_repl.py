#!/usr/bin/env python3
"""Talk to a flow-brain entity from your terminal.

Each line you type is one VISIT MOMENT through the entity-chat workflow
(recall -> the lived turn -> elections -> deposits) against the entity's
persistent home under lab/entities/<name>. The entity keeps its episodes,
diary, and feelings between sessions — close the REPL, come back tomorrow,
it remembers.

Usage:
  PYTHONPATH=<runtime/src>:<memory/src> python3 scripts/entity_repl.py [name]

Env: LLM_PROVIDER (lmstudio), LLM_MODEL (qwen/qwen3.6-35b-a3b).
Commands: /diary (list the book), /memories (life-scope records),
/bye (close the session with the deterministic diary note), /quit.
"""
from __future__ import annotations

import os
import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from entity_live_experiment import (  # noqa: E402
    SYSTEM, drive, ensure_home, open_runtime,
)


def _compact_warning(message, category, filename, lineno, file=None, line=None):
    # Naive-user surface (adversary F): keep the SIGNAL, kill the splash —
    # a raw RuntimeWarning with file paths between "you>" and the reply
    # reads like a crash. One indented line, message only, never silenced.
    print(f"  (note: {message})", file=sys.stderr)


def _gist(text: str, cap: int) -> str:
    """Word-boundary cut with an ellipsis — never a mid-marker slice."""
    t = str(text or "").strip().replace("\n", " ")
    if len(t) <= cap:
        return t
    cut = t[:cap].rsplit(" ", 1)[0]
    return (cut if len(cut) > 40 else t[:cap]) + " …"


def main() -> int:
    slug = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ENTITY_NAME", "florin")).strip()
    provider = os.environ.get("LLM_PROVIDER", "lmstudio")
    model = os.environ.get("LLM_MODEL", "qwen/qwen3.6-35b-a3b")

    warnings.showwarning = _compact_warning
    home_dir = ensure_home(slug)
    ert, specs = open_runtime(home_dir, provider, model)
    session_id = f"repl-{int(time.time())}"
    state: dict = {}
    session_open = False
    print(f"\nYou are visiting {slug.capitalize()} (model {model}).")
    print("Type your words; /diary /memories /bye /quit.\n")

    try:
        while True:
            try:
                line = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                line = "/quit"
            if not line:
                continue

            if line in ("/quit", "/q"):
                if session_open:
                    print("(left without closing the session — the parked life keeps its state; /bye closes it)")
                else:
                    print("(goodbye)")
                break

            if line == "/diary":
                for e in ert.home.diary.list_entries():
                    print(f"  [{e.get('kind')}] {_gist(e.get('text'), 160)}")
                continue

            if line == "/memories":
                from abstractmemory import TripleQuery
                life = list(ert.home.ms.query(TripleQuery(scope="life", owner_id=ert.entity_id, limit=0)))
                shown = 0
                for a in reversed(life):
                    attrs = a.attributes if isinstance(a.attributes, dict) else {}
                    kind = attrs.get("record_kind")
                    if not kind:
                        continue  # edge rows carry no digest — skip
                    print(f"  [{kind}] {_gist(a.object, 140)}")
                    shown += 1
                    if shown >= 20:
                        break
                continue

            if line == "/bye":
                # The deterministic session close: summary + diary note.
                rid = ert.runtime.start(
                    workflow=specs["entity-session-close"],
                    vars={"state": state, "phase": "visit", "reason": "the visitor said goodbye"},
                    session_id=session_id,
                )
                final = drive(ert, specs, rid)
                out = final.output if isinstance(final.output, dict) else {}
                print(f"(session closed — diary {out.get('diary_entry_id')}, {out.get('turns')} turns)")
                state = {}
                session_open = False
                continue

            # One visit moment.
            print(f"({slug.capitalize()} is thinking…)", flush=True)
            rid = ert.runtime.start(
                workflow=specs["entity-visit"],
                vars={
                    "message": line,
                    "state": state,
                    "system": SYSTEM.format(name=slug),
                    "tools": [],
                },
                session_id=session_id,
            )
            final = drive(ert, specs, rid)
            out = final.output if isinstance(final.output, dict) else {}
            state = out.get("state") if isinstance(out.get("state"), dict) else state
            session_open = True
            print(f"\n{slug}> {str(out.get('reply') or '').strip()}\n")
    finally:
        ert.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
