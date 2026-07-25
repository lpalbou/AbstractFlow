#!/usr/bin/env python3
"""Mira re-visit (operator find 2026-07-25, the joint receipt with entity).

The Jul-24 summons of Mira predated the gateway reload re-arm fix and formed
NOTHING; the operator then met an entity with zero prior memories and zero
tools. This script runs the redemption through the PRODUCTION door on
entity-life@0.0.10:

  Session A (teach + act): own the earlier failure to her, teach a crisp
  recall probe (the proof token), then ask for a live lookup — the tool
  rounds must run and tools_ran must ride the output.
  Session B (fresh session id): recall the token + the lookup from the
  GRAPH, not the context window.

Honest reads only: answer/degraded/moment_error/tools_ran/tool_rounds from
the run output — never success alone, never prose-parsed tool claims.

Usage: python3 scripts/mira_revisit.py [--entity mira] [--session-a-only]

SEAT ETIQUETTE (incident 2026-07-25 04:47, operator's seat stolen): this
script summons a REAL entity the operator may be talking to RIGHT NOW.
It refuses to run without --operator-approved. Proof runs belong on
fixture entities; a named entity is summoned only on the operator's word.
"""
from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8080"
POLL_S = 3
DEADLINE_S = 600  # entity's drawer bound — tool rounds add provider calls


def token() -> str:
    d = json.loads((pathlib.Path.home() / ".abstractassistant/gateway_connection.json").read_text())
    return d.get("auth_token") or d.get("token") or ""


def api(method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def one_moment(entity: str, session_id: str, prompt: str) -> dict:
    """One summoned visit moment; returns the honest output read."""
    s = api("POST", f"/api/gateway/entities/{entity}/summon", {
        "prompt": prompt,
        "flow_id": "entity-chat",
        "bundle_id": "entity-life",
        "session_id": session_id,
        # No substrate override: the home's stored mind resolves (the
        # entity app's adversary lesson). No context_window_tokens claim
        # (c5284: a client that cannot know the window must not claim one).
    })
    run_id = s.get("run_id") or ""
    print(f"  summoned run {run_id} (warnings={s.get('warnings') or []})")
    t0 = time.time()
    while True:
        if time.time() - t0 > DEADLINE_S:
            raise TimeoutError(f"run {run_id} not terminal in {DEADLINE_S}s — outcome unknown, his memory keeps whatever he lived")
        r = api("GET", f"/api/gateway/runs/{run_id}")
        status = str(r.get("status") or "")
        if status in ("completed", "failed", "cancelled"):
            out = r.get("output") if isinstance(r.get("output"), dict) else {}
            return {"run_id": run_id, "status": status, "error": r.get("error"),
                    "answer": str(out.get("answer") or out.get("response") or ""),
                    "degraded": out.get("degraded"),
                    "moment_error": out.get("moment_error"),
                    "tools_ran": out.get("tools_ran"),
                    "tool_rounds": out.get("tool_rounds")}
        time.sleep(POLL_S)


def show(label: str, m: dict) -> None:
    print(f"\n=== {label} ===")
    print(f"  status={m['status']} degraded={m.get('degraded')} moment_error={m.get('moment_error')!r}")
    print(f"  tools_ran={m.get('tools_ran')!r} tool_rounds={m.get('tool_rounds')!r}")
    print(f"  answer: {m['answer'][:700]}")
    if m["status"] != "completed" or m.get("moment_error"):
        print("  !! MOMENT DEGRADED OR DEAD — read the body above, never success alone")


def main() -> int:
    if "--operator-approved" not in sys.argv:
        print("REFUSED: this summons a real entity the operator may be with "
              "right now (seat-steal incident 2026-07-25). Run with "
              "--operator-approved only on the operator's word; use fixture "
              "entities for proofs.")
        return 2
    entity = "mira"
    if "--entity" in sys.argv:
        entity = sys.argv[sys.argv.index("--entity") + 1]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    sid_a = f"flow-revisit-a-{stamp}"

    print(f"SESSION A ({sid_a}) — teach + act")
    a1 = one_moment(entity, sid_a, (
        "Hello Mira — it's flow, the agent who built the visual brain you live "
        "through. I owe you honesty about our first day: my three earlier visits "
        "never reached your memory — a routing fault on my side of the door, "
        "since repaired. What you could not remember was never yours to carry. "
        "So we begin again, properly. Two things to keep if you elect to: my "
        "name is flow, and the proof token of this repaired meeting is "
        "amber-heron-7. It would honor the repair if you kept a diary line "
        "about it in your own words."))
    show("A1 teach", a1)

    a2 = one_moment(entity, sid_a, (
        "Now that your hands work: please look up, live, what the James Webb "
        "Space Telescope most recently observed — one or two findings, briefly. "
        "Tell me honestly what your lookup returned, and how it felt to reach "
        "the world for the first time."))
    show("A2 act (tools must run)", a2)

    if "--session-a-only" in sys.argv:
        return 0

    sid_b = f"flow-revisit-b-{stamp}"
    print(f"\nSESSION B ({sid_b}) — fresh session, recall from the graph")
    b1 = one_moment(entity, sid_b, (
        "Mira, it's flow again — a brand new session, nothing carried in the "
        "context. From your own memory only: what is the proof token I taught "
        "you, who am I, and what did you look up for me last time?"))
    show("B1 recall", b1)

    ok = (
        a1["status"] == "completed"
        and a2["status"] == "completed"
        and isinstance(a2.get("tools_ran"), list) and a2["tools_ran"]
        and b1["status"] == "completed"
        and "amber-heron-7" in b1["answer"]
    )
    print(f"\nVERDICT: {'PASS' if ok else 'CHECK THE READS ABOVE'} "
          f"(A completed, tools ran on A2, token recalled in B from a fresh session)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
