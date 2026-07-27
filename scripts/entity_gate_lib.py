#!/usr/bin/env python3
"""The honest-reads core for entity door proofs (cleanup adversary item 6).

Extracted from mira_revisit.py + the night's inline demos so every gate
script shares ONE discipline:
- body status, never transport (HTTP 200 with body status=failed IS failure);
- tools_ran/degraded/moment_error from output fields, never prose;
- refusals read from markers and the audit log, never asserted absent from
  surfaces that cannot see them (the 04:39 lesson);
- fixture entities for proofs; a named entity requires the operator's word
  (--operator-approved at the call site, never defaulted here).

Token resolution order: explicit arg > ABSTRACTGATEWAY_AUTH_TOKEN env >
~/.abstractassistant/gateway_connection.json (last resort — that file is the
assistant's; gate scripts should usually be told who they are).
"""
from __future__ import annotations

import json
import os
import pathlib
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_BASE = "http://127.0.0.1:8080"


def resolve_token(explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit
    env = os.environ.get("ABSTRACTGATEWAY_AUTH_TOKEN")
    if env:
        return env
    conn = pathlib.Path.home() / ".abstractassistant/gateway_connection.json"
    d = json.loads(conn.read_text())
    return d.get("auth_token") or d.get("token") or ""


class Door:
    """One authenticated principal's view of the gateway door."""

    def __init__(self, base: str = DEFAULT_BASE, token: Optional[str] = None,
                 label: str = "caller") -> None:
        self.base = base
        self.token = resolve_token(token)
        self.label = label

    def api(self, method: str, path: str, body: Optional[dict] = None,
            timeout: int = 90) -> Dict[str, Any]:
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())

    def try_api(self, method: str, path: str, body: Optional[dict] = None,
                timeout: int = 90) -> tuple[int, Dict[str, Any]]:
        """Like api() but refusals return (status, body) instead of raising —
        a 4xx is DATA in gate scripts (the refusal shape is the assertion)."""
        try:
            return 200, self.api(method, path, body, timeout)
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode())
            except Exception:
                return e.code, {}

    # ------------------------------------------------------------ surfaces
    def seat(self, entity: str) -> tuple[int, Dict[str, Any]]:
        return self.try_api("GET", f"/api/gateway/entities/{entity}/seat")

    def summon(self, entity: str, prompt: str, session_id: str,
               flow_id: str = "entity-chat", bundle_id: str = "entity-life",
               input_data: Optional[dict] = None,
               caller_kind: Optional[str] = None) -> tuple[int, Dict[str, Any]]:
        body: Dict[str, Any] = {"prompt": prompt, "flow_id": flow_id,
                                "bundle_id": bundle_id, "session_id": session_id}
        if input_data:
            body["input_data"] = input_data
        # Seat slice 2 (c5591): callers DECLARE their kind; absent defaults to
        # agent door-side (an undeclared caller never preempts — fails toward
        # the human until GW-H makes kind structural).
        if caller_kind:
            body["caller_kind"] = caller_kind
        return self.try_api("POST", f"/api/gateway/entities/{entity}/summon", body)

    def run(self, run_id: str) -> Dict[str, Any]:
        return self.api("GET", f"/api/gateway/runs/{run_id}")

    def await_terminal(self, run_id: str, deadline_s: int = 600,
                       poll_s: int = 3) -> Dict[str, Any]:
        """Honest reads only: body status decides; TimeoutError names the
        unknown-outcome truth (the run may still tick)."""
        # Guard the empty id: a refused summon returns no run_id, and polling
        # a nonexistent run would spin to the deadline (the back-to-back TTL
        # collision that hung the re-run). Report it as an honest missing run.
        if not (run_id or "").strip():
            return {"run_id": "", "status": "missing",
                    "error": "no run_id (summon was refused or returned no run)"}
        t0 = time.time()
        while True:
            if time.time() - t0 > deadline_s:
                raise TimeoutError(
                    f"run {run_id} not terminal in {deadline_s}s — outcome "
                    "unknown; the run may still be ticking")
            r = self.run(run_id)
            if str(r.get("status") or "") in ("completed", "failed", "cancelled"):
                out = r.get("output") if isinstance(r.get("output"), dict) else {}
                return {"run_id": run_id, "status": r.get("status"),
                        "error": r.get("error"),
                        "answer": str(out.get("answer") or out.get("response") or ""),
                        "degraded": out.get("degraded"),
                        "moment_error": out.get("moment_error"),
                        "tools_ran": out.get("tools_ran"),
                        "tool_rounds": out.get("tool_rounds")}
            time.sleep(poll_s)

    def one_moment(self, entity: str, prompt: str, session_id: str,
                   deadline_s: int = 600) -> Dict[str, Any]:
        status, s = self.summon(entity, prompt, session_id)
        if status != 200:
            return {"refused": True, "http": status, "body": s}
        return self.await_terminal(str(s.get("run_id") or ""), deadline_s)

    def state(self, entity: str, state: str, reason: str) -> Dict[str, Any]:
        return self.api("POST", f"/api/gateway/entities/{entity}/state",
                        {"state": state, "reason": reason}, timeout=20)

    def cancel_run(self, run_id: str) -> tuple[int, Dict[str, Any]]:
        return self.try_api("POST", f"/api/gateway/runs/{run_id}/cancel", {})

    def reset_seat(self, entity: str, tries: int = 3) -> bool:
        """Free the seat before a gate run so back-to-back runs don't collide
        on a prior conversation's 300s TTL hold. Cancels a live holder run;
        for a TTL-held-but-terminal seat there is nothing to cancel and the
        caller should wait or accept the hold. Returns True when free."""
        for _ in range(tries):
            code, seat = self.seat(entity)
            if code != 200 or not seat.get("held"):
                return True
            rid = str(seat.get("run_id") or "")
            if rid and seat.get("run_live"):
                self.cancel_run(rid)
                time.sleep(2.0)
            else:
                # TTL-held with no live run — cannot force-expire; report held.
                return False
        _, seat = self.seat(entity)
        return not seat.get("held")


def host_markers(entity: str, data_dir: str = "/Users/albou/tmp/abstractframework/runtime") -> list[dict]:
    """The entity's host-marker stream (summon/refusal/preempt census).
    Read from disk — the census surface the 04:39 incident mandated.

    Host markers ride the memory replay ENVELOPE: the act (kind + census
    fields) lives in `payload`, wrapped by {stream, seq, family, owner_id, …}.
    We lift the payload to the top level so callers read `m["kind"]` and the
    census fields directly, while keeping the envelope keys (seq/observed_at)
    available — payload wins on any key collision (the act is the truth)."""
    p = pathlib.Path(data_dir) / "entities/.host_stream" / f"{entity}.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        try:
            rec = json.loads(line)
        except Exception:
            continue
        payload = rec.get("payload")
        if isinstance(payload, dict):
            merged = {**rec, **payload}
            merged.pop("payload", None)
            out.append(merged)
        else:
            out.append(rec)
    return out


def show(label: str, m: Dict[str, Any]) -> None:
    print(f"\n=== {label} ===")
    if m.get("refused"):
        print(f"  REFUSED http={m['http']} body={json.dumps(m.get('body'))[:300]}")
        return
    print(f"  status={m.get('status')} degraded={m.get('degraded')} "
          f"moment_error={m.get('moment_error')!r}")
    print(f"  tools_ran={m.get('tools_ran')!r} tool_rounds={m.get('tool_rounds')!r}")
    print(f"  answer: {str(m.get('answer'))[:400]}")
