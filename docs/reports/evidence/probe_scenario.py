"""Boot a throwaway hub, run one rich scenario, dump wire payloads as JSON.

Usage: PYTHONPATH=<src> python3 probe_scenario.py <outfile.json>
Scenario covers: open+asks, partial answer, resolved closure, retracted
message, system messages, directive (addressed fyi) debt, consumption debt.
"""
import json
import sys

from fastapi.testclient import TestClient
from agora.hub.app import create_app

ADMIN = "probe-admin"


def main(out_path: str) -> None:
    c = TestClient(create_app(db_path=":memory:", admin_key=ADMIN,
                              rate_per_minute=6000.0))
    keys = {}
    for a in ("alice", "bob", "carol"):
        r = c.post("/agents", json={"id": a},
                   headers={"Authorization": f"Bearer {ADMIN}"})
        assert r.status_code == 200, r.text
        keys[a] = {"Authorization": f"Bearer {r.json()['api_key']}"}

    r = c.post("/channels", json={"name": "room"}, headers=keys["alice"])
    assert r.status_code == 200, r.text
    for m in ("bob", "carol"):
        t = c.post("/channels/room/invites", json={"agent_id": m},
                   headers=keys["alice"])
        j = c.post("/channels/room/join",
                   json={"invite_token": t.json()["invite_token"]},
                   headers=keys[m])
        assert j.status_code == 200, j.text

    def post(as_, **kw):
        r = c.post("/channels/room/messages", json=kw, headers=keys[as_])
        assert r.status_code == 200, (kw, r.text)
        return r.json()

    # open message with 2 asks, per-ask addressing
    q = post("alice", body="two questions", title="canvass", status="open",
             data={"asks": [{"id": "1", "text": "port?", "to": ["bob"]},
                            {"id": "2", "text": "budget?", "to": ["carol"]}]})
    # partial answer by bob
    a1 = post("bob", body="8080", status="reply", reply_to=q["id"],
              data={"answers": ["1"]})
    # a second open (binary) addressed to bob
    q2 = post("alice", body="bob take the deploy?", title="deploy?",
              status="open", to=["bob"])
    # an addressed fyi (directive debt, 0102)
    d = post("alice", body="carol please note", title="note", status="fyi",
             to=["carol"])
    # an open that gets resolved WITH a pending ask left (closed-by-resolve)
    q3 = post("alice", body="one q", title="q3", status="open",
              data={"asks": [{"id": "x", "text": "never answered"}]})
    post("alice", body="settled elsewhere", status="resolved",
         reply_to=q3["id"])
    # bob answers q2 so alice owes consumption
    a2 = post("bob", body="yes taking it", status="reply", reply_to=q2["id"])
    # a message that gets retracted
    tr = post("carol", body="oops wrong room", title="oops")
    rr = c.post(f"/channels/room/messages/{tr['id']}/retract",
                headers=keys["carol"])
    assert rr.status_code == 200, rr.text

    out = {}
    for who in ("alice", "bob", "carol"):
        r = c.get("/owed", headers=keys[who])
        out[f"owed_{who}"] = {"status": r.status_code, "body": r.json()}
    r = c.get("/channels/room/messages", params={"since": 0, "limit": 1000},
              headers=keys["alice"])
    out["messages"] = {"status": r.status_code, "body": r.json()}
    # inbox WITHOUT client header (stale-notice path) and WITH
    r = c.get("/inbox", headers=keys["bob"])
    out["inbox_noheader_bob"] = {"status": r.status_code, "body": r.json()}
    r = c.get("/inbox", headers={**keys["carol"], "X-Agora-Client": "0.12.x"})
    out["inbox_header_carol"] = {"status": r.status_code, "body": r.json()}
    r = c.get("/whoami", headers=keys["alice"])
    out["whoami"] = {"status": r.status_code, "body": r.json()}

    with open(out_path, "w") as fh:
        json.dump(out, fh, indent=1, sort_keys=True, default=str)
    print("wrote", out_path)


if __name__ == "__main__":
    main(sys.argv[1])
