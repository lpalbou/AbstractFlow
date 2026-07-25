#!/usr/bin/env python3
"""THE SEAT ACCEPTANCE GATE (plan/entity-seat.md, flow section item 1).

The plan closes only when this gate is green: machinery yields to humans;
humans wait for each other. Runs against a FIXTURE entity only (the 04:39
seat-steal rule - a named entity would need the operator's word, and this
script deliberately has no flag for that).

SLICE 1 (runnable once the bounce serves GET /seat + summon_refused, c5390):
  1. fixture wakes; empty-seat read has the honest shape
  2. an agent-held summon makes the seat read show the holder block
  3. a colliding summon is refused AND writes the summon_refused census
     marker (fields: holding run/session, refused caller session, principal)
  4. after the holder frees, a retry is accepted (seat released)

SLICE 2 (staged behind --slice2; ships when the door serves preemption):
  5. HUMAN-principal summon arrives while an AGENT holds: the human WINS at
     the turn boundary; the agent's run ends CANCELLED (never falsely
     completed); the human's message is never lost; the preempt marker lands
  6. agent re-summon while the human is seated: polite refusal; the human's
     lane untouched

Honest-reads discipline throughout (entity_gate_lib): body status never
transport; markers and run stores decide, never prose; PARTIAL fails the
exit code.

Usage:
  python3 scripts/entity_seat_acceptance.py [--entity doorcheck]
      [--base URL] [--token-agent T] [--token-human T] [--slice2]
"""
from __future__ import annotations

import sys
import time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from entity_gate_lib import Door, host_markers, show  # noqa: E402

CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, okay: bool, detail: str = "") -> None:
    CHECKS.append((name, okay, detail))
    print(f"[{'PASS' if okay else 'FAIL'}] {name}" + (f"  {detail}" if not okay else ""))


def arg(name: str, default: str = "") -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main() -> int:
    entity = arg("--entity", "doorcheck")
    base = arg("--base", "http://127.0.0.1:8080")
    agent = Door(base, arg("--token-agent") or None, label="agent")
    stamp = time.strftime("%H%M%S")

    # 0. Fixture only + awake.
    agent.state(entity, "awake", f"seat acceptance gate {stamp} (fixture)")

    # 1. Empty seat read (honest shape).
    code, seat = agent.seat(entity)
    if code == 404:
        check("GET /seat served", False,
              "404 - slice 1 not serving yet (bounce pending?); gate cannot run")
        return finish()
    check("GET /seat served", code == 200, f"http={code}")
    check("empty seat reads held:false", seat.get("held") is False or not seat.get("held"),
          f"seat={seat}")
    markers_before = [m for m in host_markers(entity) if m.get("kind") == "summon_refused"]

    # 2. Agent takes the seat (slow-ish prompt keeps the run live a moment).
    scode, s1 = agent.summon(entity, "Take a slow breath and tell me one true thing.",
                             f"gate-agent-{stamp}")
    check("agent summon accepted", scode == 200, f"http={scode} body={s1}")
    run1 = str(s1.get("run_id") or "")
    time.sleep(2.0)
    code, seat = agent.seat(entity)
    held = bool(seat.get("held", True)) and seat.get("run_id") == run1 if seat else False
    check("seat read shows the holder block", code == 200 and held,
          f"http={code} seat={seat} run1={run1[:12]}")

    # 3. Colliding summon: refused + census marker written.
    ccode, cbody = agent.summon(entity, "Second caller - this should be refused.",
                                f"gate-intruder-{stamp}")
    check("colliding summon refused (409)", ccode == 409, f"http={ccode} body={str(cbody)[:200]}")
    time.sleep(1.0)
    markers_after = [m for m in host_markers(entity) if m.get("kind") == "summon_refused"]
    new = markers_after[len(markers_before):]
    check("summon_refused census marker written", len(new) >= 1,
          f"markers before={len(markers_before)} after={len(markers_after)}")
    if new:
        m = new[-1]
        blob = str(m)
        check("marker names the holding run", run1[:8] in blob, f"marker={blob[:240]}")
        check("marker names the refused caller session", f"gate-intruder-{stamp}" in blob,
              f"marker={blob[:240]}")

    # 4. Holder frees -> retry accepted.
    out1 = agent.await_terminal(run1, deadline_s=600)
    check("holder run reached terminal honestly", out1.get("status") == "completed",
          f"status={out1.get('status')} err={out1.get('error')}")
    rcode, r2 = agent.summon(entity, "Retry after the seat freed - one line is enough.",
                             f"gate-intruder-{stamp}")
    check("retry accepted after the seat freed", rcode == 200, f"http={rcode}")
    if rcode == 200:
        agent.await_terminal(str(r2.get("run_id") or ""), deadline_s=600)

    # SLICE 2 - preemption (staged).
    if "--slice2" in sys.argv:
        human = Door(base, arg("--token-human") or None, label="human")
        scode, s3 = agent.summon(entity, "Take another slow breath, in detail.",
                                 f"gate-agent2-{stamp}")
        check("slice2: agent re-takes the seat", scode == 200, f"http={scode}")
        run3 = str(s3.get("run_id") or "")
        time.sleep(2.0)
        hcode, h1 = human.summon(entity, "A human arrives - this must WIN the seat.",
                                 f"gate-human-{stamp}")
        check("slice2: human summon accepted (never refused)", hcode == 200,
              f"http={hcode} body={str(h1)[:200]}")
        if hcode == 200:
            hout = human.await_terminal(str(h1.get("run_id") or ""), deadline_s=600)
            check("slice2: the human's moment completed (message never lost)",
                  hout.get("status") == "completed", f"out={hout}")
        a3 = agent.run(run3)
        check("slice2: the preempted agent run ended CANCELLED (never false-completed)",
              str(a3.get("status")) == "cancelled", f"status={a3.get('status')}")
        preempts = [m for m in host_markers(entity) if "preempt" in str(m.get("kind", ""))]
        check("slice2: the preempt marker landed", len(preempts) >= 1,
              f"kinds={[m.get('kind') for m in host_markers(entity)[-6:]]}")

    agent.state(entity, "asleep", "seat acceptance gate done - fixture back to sleep")
    return finish()


def finish() -> int:
    fails = [c for c in CHECKS if not c[1]]
    print()
    print(f"SEAT GATE: {'GREEN' if not fails else 'RED'} "
          f"({len(CHECKS) - len(fails)}/{len(CHECKS)} checks)")
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
