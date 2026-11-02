#!/usr/bin/env python3
"""Run the typed-literals fixtures headlessly through AbstractRuntime (root ADR 0049).

`src/utils/__fixtures__/typed_literals_flow.json` is what the editor saves for Compare `b`
typed next to a wired number: the JSON numbers 5 and 9. The runtime executes them as stored,
so `5 == 5` and `10 > 9` are true. `typed_literals_flow.legacy.json` is the same flow as
Flow 0.13.0 saved it (the text "5" and "9"): the runtime still executes it as stored, never
guessing a type from the text, so both comparisons are false; the editor converts such a flow
when it opens it (src/utils/pinLiterals.test.ts proves that conversion gives exactly the
typed fixture). No model, no network.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict

from abstractruntime import Runtime, RunStatus
from abstractruntime.storage.in_memory import InMemoryLedgerStore, InMemoryRunStore
from abstractruntime.visualflow_compiler import compile_visualflow

FIXTURES = Path(__file__).resolve().parents[1] / "src" / "utils" / "__fixtures__"


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        raise SystemExit(f"check failed: {name}: {detail}")


def run(path: Path) -> Dict[str, Any]:
    spec = compile_visualflow(json.loads(path.read_text(encoding="utf-8")))
    runtime = Runtime(run_store=InMemoryRunStore(), ledger_store=InMemoryLedgerStore())
    run_id = runtime.start(workflow=spec, vars={})
    state = runtime.tick(workflow=spec, run_id=run_id)
    check(f"{path.name}: run completed", state.status == RunStatus.COMPLETED, str(state.error))
    return dict(state.output or {})


def main() -> None:
    typed = run(FIXTURES / "typed_literals_flow.json")
    print(f"  typed output: {typed}")
    check("typed: 5 == 5 (b stored as the number 5)", typed.get("same") is True, str(typed))
    check("typed: 10 > 9 (b stored as the number 9)", typed.get("above") is True, str(typed))

    legacy = run(FIXTURES / "typed_literals_flow.legacy.json")
    print(f"  legacy output: {legacy}")
    check("legacy: 5 == '5' runs as stored (false)", legacy.get("same") is False, str(legacy))
    check("legacy: 10 > '9' runs as stored (false)", legacy.get("above") is False, str(legacy))
    print("typed literals smoke: OK")


if __name__ == "__main__":
    sys.exit(main())
