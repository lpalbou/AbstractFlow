#!/usr/bin/env python3
"""Dump the Python fold predicate's verdict for every bundled flow, as JSON.

The render-fold (backlog 0156 Stage 1) is implemented TWICE — once in
TypeScript (`src/utils/foldedGetters.ts`, what the canvas draws) and once in
Python (`scripts/wf_common.py::folded_getter_ids`, what the layout docks and
what the audit counts as `rendered_nodes`). Two implementations of one
predicate drift silently: a getter the layout excluded from its column but the
canvas still draws lands on top of a neighbour, and every metric in 0156's
success criteria is measured against a graph nobody sees.

So the two are pinned by an executable comparison, not by a comment: this
script prints the Python verdict for ALL of `examples/flows/*.json`, and
`src/utils/foldedGetters.test.ts` spawns it and asserts the TypeScript verdict
is identical, flow by flow and id by id. No checked-in fixture to go stale.

  python3 scripts/dump_folded.py            # {flow: {getter_id: [consumer, pin]}}
  python3 scripts/dump_folded.py a.json b.json

Exit code 0 always (parse failures are reported per-flow as an "error" key so
the comparison side sees them rather than a truncated dump).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wf_common import folded_getter_ids  # noqa: E402  (one fold predicate, never two)

FLOWS_DIR = Path(__file__).resolve().parent.parent / "examples" / "flows"


def main(argv: list[str]) -> int:
    paths = [Path(a) for a in argv[1:]] or sorted(FLOWS_DIR.glob("*.json"))
    out: dict[str, object] = {}
    for path in paths:
        try:
            flow = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - reported, not raised
            out[path.stem] = {"error": f"{type(exc).__name__}: {exc}"}
            continue
        if not isinstance(flow, dict):
            out[path.stem] = {"error": "flow document is not an object"}
            continue
        folded = folded_getter_ids(flow)
        out[path.stem] = {
            getter_id: [consumer_id, pin_id]
            for getter_id, (consumer_id, pin_id) in sorted(folded.items())
        }
    json.dump(out, sys.stdout, indent=None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
