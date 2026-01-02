"""WebSocket integration test for MEMORY_REHYDRATE visual node (no mocks)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from web.backend.main import app
from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.routes.flows import _flows


def test_ws_memory_query_meta_then_rehydrate_inserts_messages(monkeypatch) -> None:
    # Create stable, test-owned durability stores so we can seed a conversation span artifact.
    from abstractruntime.storage.artifacts import FileArtifactStore
    from abstractruntime.storage.json_files import JsonFileRunStore, JsonlLedgerStore
    from abstractruntime.storage.observable import ObservableLedgerStore

    base = Path(tempfile.mkdtemp(prefix="abstractflow-ws-memory-rehydrate-"))
    run_store = JsonFileRunStore(base)
    ledger_store = ObservableLedgerStore(JsonlLedgerStore(base))
    artifact_store = FileArtifactStore(base)

    # Seed one conversation span artifact (rehydratable).
    payload = {
        "messages": [
            {"role": "user", "content": "u1", "timestamp": "2025-01-01T00:00:00+00:00", "metadata": {"message_id": "m1"}},
            {"role": "assistant", "content": "a1", "timestamp": "2025-01-01T00:01:00+00:00", "metadata": {"message_id": "m2"}},
        ],
        "span": {"from_timestamp": "2025-01-01T00:00:00+00:00", "to_timestamp": "2025-01-01T00:01:00+00:00", "message_count": 2},
        "created_at": "2025-01-01T00:01:01+00:00",
    }
    meta = artifact_store.store_json(payload, run_id=None, tags={"kind": "conversation_span"})
    span_id = meta.artifact_id

    # Patch the WS route to use our stores (so the runner sees the seeded artifact store).
    import web.backend.routes.ws as ws_routes

    def _fixed_stores():
        return (run_store, ledger_store, artifact_store)

    monkeypatch.setattr(ws_routes, "get_runtime_stores", _fixed_stores)

    flow_id = "test-ws-memory-rehydrate"

    visual = VisualFlow(
        id=flow_id,
        name="test ws memory rehydrate",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="q",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": ""},
            ),
            VisualNode(
                id="limit",
                type=NodeType.LITERAL_NUMBER,
                position=Position(x=0, y=0),
                data={"literalValue": 10},
            ),
            VisualNode(
                id="mq",
                type=NodeType.MEMORY_QUERY,
                position=Position(x=0, y=0),
                data={"outputKey": "data.matches"},
            ),
            VisualNode(
                id="extract",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputKey": "data",
                    "code": (
                        "def transform(input):\n"
                        "    matches = input.get('matches') or []\n"
                        "    out = []\n"
                        "    for m in matches:\n"
                        "        if isinstance(m, dict) and m.get('kind') == 'conversation_span' and m.get('span_id'):\n"
                        "            out.append(m.get('span_id'))\n"
                        "    return {'span_ids': out}\n"
                    ),
                    "functionName": "transform",
                },
            ),
            VisualNode(
                id="place",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "after_system"},
            ),
            VisualNode(
                id="reh",
                type=NodeType.MEMORY_REHYDRATE,
                position=Position(x=0, y=0),
                data={"outputKey": "data.rehydrate"},
            ),
            VisualNode(
                id="done",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "inputKey": "context",
                    "code": (
                        "def transform(input):\n"
                        "    msgs = input.get('messages') or []\n"
                        "    contents = [m.get('content') for m in msgs if isinstance(m, dict)]\n"
                        "    return {'messages': contents}\n"
                    ),
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="mq", targetHandle="exec-in"),
            VisualEdge(id="e2", source="mq", sourceHandle="exec-out", target="extract", targetHandle="exec-in"),
            VisualEdge(id="e3", source="extract", sourceHandle="exec-out", target="reh", targetHandle="exec-in"),
            VisualEdge(id="e4", source="reh", sourceHandle="exec-out", target="done", targetHandle="exec-in"),
            VisualEdge(id="d1", source="q", sourceHandle="value", target="mq", targetHandle="query"),
            VisualEdge(id="d2", source="limit", sourceHandle="value", target="mq", targetHandle="limit"),
            VisualEdge(id="d3", source="extract", sourceHandle="span_ids", target="reh", targetHandle="span_ids"),
            VisualEdge(id="d4", source="place", sourceHandle="value", target="reh", targetHandle="placement"),
        ],
    )

    _flows[flow_id] = visual
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/api/ws/{flow_id}") as ws:
                ws.send_text(
                    json.dumps(
                        {
                            "type": "run",
                            "input_data": {
                                "context": {
                                    "task": "t",
                                    "messages": [
                                        {
                                            "role": "system",
                                            "content": "sys",
                                            "timestamp": "2025-01-01T00:00:00+00:00",
                                            "metadata": {"message_id": "s0"},
                                        }
                                    ],
                                },
                                "_runtime": {
                                    "memory_spans": [
                                        {
                                            "kind": "conversation_span",
                                            "artifact_id": span_id,
                                            "created_at": "2025-01-01T00:01:01+00:00",
                                            "from_timestamp": "2025-01-01T00:00:00+00:00",
                                            "to_timestamp": "2025-01-01T00:01:00+00:00",
                                            "message_count": 2,
                                        }
                                    ]
                                },
                                "_temp": {},
                                "_limits": {},
                                "scratchpad": {},
                            },
                        }
                    )
                )

                completed = None
                for _ in range(600):
                    msg = ws.receive_json()
                    t = msg.get("type")
                    if t == "flow_complete":
                        completed = msg
                        break
                    if t == "flow_error":
                        pytest.fail(f"flow_error: {msg.get('error')}")
                    if t == "flow_waiting":
                        pytest.fail(
                            f"flow_waiting: reason={msg.get('reason')} wait_key={msg.get('wait_key')} prompt={msg.get('prompt')}"
                        )

                assert completed is not None
                assert completed["result"]["success"] is True
                output = completed["result"]["result"]
                assert isinstance(output, dict)

                # We should see the original system message + the rehydrated span messages.
                msgs = output.get("messages")
                assert isinstance(msgs, list)
                assert msgs[0] == "sys"
                assert msgs[1:3] == ["u1", "a1"]
    finally:
        _flows.pop(flow_id, None)


