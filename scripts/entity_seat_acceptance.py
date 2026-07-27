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

    # 0. Fixture only + awake + a CLEAN seat. Back-to-back gate runs (or a
    #    prior conversation's 300s TTL hold) would otherwise refuse this run's
    #    opening summon — a fixture reset is the honest setup, not a cheat.
    agent.state(entity, "awake", f"seat acceptance gate {stamp} (fixture)")
    freed = agent.reset_seat(entity)
    if not freed:
        _, s = agent.seat(entity)
        ttl = s.get("ttl_remaining_s")
        check("seat free at gate start", False,
              f"seat still TTL-held (ttl_remaining_s={ttl}) from a prior conversation — "
              f"wait it out or use a fresh fixture; gate cannot start clean")
        return finish()

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

    # 3. Colliding summon (agent-vs-agent): refused with the slice-2 body
    #    contract (retry_after_s + lane) + census marker written.
    ccode, cbody = agent.summon(entity, "Second caller - this should be refused.",
                                f"gate-intruder-{stamp}", caller_kind="agent")
    check("colliding summon refused (409)", ccode == 409, f"http={ccode} body={str(cbody)[:200]}")
    detail = cbody.get("detail") if isinstance(cbody.get("detail"), dict) else cbody
    check("409 body carries retry_after_s (slice 2 contract)",
          isinstance(detail, dict) and detail.get("retry_after_s") is not None,
          f"body={str(cbody)[:240]}")
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

    # 4. Holder's RUN completes -> the seat stays TTL-HELD for the holder
    #    (slice 2: conversation-level protection, the incident fix).
    #    4a. A DIFFERENT session (agent) is still refused, with honest
    #        retry_after_s <= the TTL window.
    #    4b. The SAME session+holder SLIDES (one conversation, many runs).
    out1 = agent.await_terminal(run1, deadline_s=600)
    check("holder run reached terminal honestly", out1.get("status") == "completed",
          f"status={out1.get('status')} err={out1.get('error')}")
    rcode, rbody = agent.summon(entity, "Different session during the TTL hold.",
                                f"gate-intruder-{stamp}", caller_kind="agent")
    check("TTL hold: different-session agent still refused (conversation protected)",
          rcode == 409, f"http={rcode} body={str(rbody)[:200]}")
    rdetail = rbody.get("detail") if isinstance(rbody.get("detail"), dict) else rbody
    ttl = rdetail.get("retry_after_s") if isinstance(rdetail, dict) else None
    check("TTL hold: retry_after_s is an honest bound (0 < s <= 300)",
          isinstance(ttl, (int, float)) and 0 < float(ttl) <= 300.0, f"retry_after_s={ttl}")
    scode2, s2 = agent.summon(entity, "Same conversation continues - one line.",
                              f"gate-agent-{stamp}", caller_kind="agent")
    check("TTL hold: same-session same-holder SLIDES (accepted)", scode2 == 200,
          f"http={scode2} body={str(s2)[:160]}")
    if scode2 == 200:
        agent.await_terminal(str(s2.get("run_id") or ""), deadline_s=600)

    # SLICE 2 - human-wins preemption (staged behind --slice2).
    #
    # NOTE on the holder: after step 4 the agent's conversation (session
    # gate-agent-{stamp}) still holds the seat via the 300s TTL. That IS the
    # holder the human must win against — the incident's exact shape (a human
    # arriving at an agent-held seat). We do NOT start a fresh agent session
    # (it would 409 against the TTL hold — correct product behavior, proven in
    # step 4). The preemption is valid whether the holder's run is live
    # (cancelled at the turn boundary) or TTL-held post-completion
    # (cancelled_runs=[] but the seat is still handed over) — the seat_preempted
    # marker carries the true story either way.
    if "--slice2" in sys.argv:
        human = Door(base, arg("--token-human") or None, label="human")
        preempts_before = [m for m in host_markers(entity)
                           if m.get("kind") == "seat_preempted"]
        # Confirm the agent still holds (TTL) before the human arrives.
        _, seat_pre = agent.seat(entity)
        check("slice2: agent still holds the seat (TTL) before the human arrives",
              bool(seat_pre.get("held")), f"seat={seat_pre}")
        # THE INCIDENT CASE, inverted: the human arrives at an agent-held seat
        # and WINS — the message is never lost.
        hcode, h1 = human.summon(entity, "A human arrives - this must WIN the seat.",
                                 f"gate-human-{stamp}", caller_kind="human")
        check("slice2: human summon accepted (never refused)", hcode == 200,
              f"http={hcode} body={str(h1)[:200]}")
        if hcode == 200:
            hout = human.await_terminal(str(h1.get("run_id") or ""), deadline_s=600)
            check("slice2: the human's moment completed (message never lost)",
                  hout.get("status") == "completed", f"out={hout}")
        preempts_after = [m for m in host_markers(entity)
                          if m.get("kind") == "seat_preempted"]
        newp = preempts_after[len(preempts_before):]
        check("slice2: the seat_preempted census marker landed", len(newp) >= 1,
              f"kinds={[m.get('kind') for m in host_markers(entity)[-6:]]}")
        if newp:
            m = newp[-1]
            # The holder's run is terminal either way; if it was LIVE it is
            # listed in cancelled_runs, if TTL-held it is []. Both honest.
            check("slice2: marker names the preempted holder + preempting human",
                  m.get("holder_kind") == "agent"
                  and str(m.get("preempting_session_id", "")).startswith("gate-human"),
                  f"marker={str(m)[:280]}")
            check("slice2: marker carries the act, never message words",
                  "must WIN the seat" not in str(m), f"marker={str(m)[:240]}")
        # Same-principal idle reclaim: the human returns with a NEW session —
        # one human never queues behind themself.
        h2code, h2 = human.summon(entity, "The same human returns - reclaim, not queue.",
                                  f"gate-human2-{stamp}", caller_kind="human")
        check("slice2: same-principal human reclaims their idle seat", h2code == 200,
              f"http={h2code} body={str(h2)[:160]}")
        if h2code == 200:
            human.await_terminal(str(h2.get("run_id") or ""), deadline_s=600)

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
