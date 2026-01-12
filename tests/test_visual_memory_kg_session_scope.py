from __future__ import annotations

import json

import pytest

from abstractflow.visual.executor import create_visual_runner
from abstractflow.visual.models import VisualFlow


def test_visual_memory_kg_session_scope_persists_across_separate_runs(tmp_path, monkeypatch) -> None:
    """Level B: session-scoped KG partitions must be stable across separate runs/flows.

    This mirrors the AbstractFlow Web expectation:
    - ingest with scope=session in one flow/run
    - query with scope=session (or all) in a different flow/run
    - as long as `session_id` is stable, results should be returned
    """
    try:
        import lancedb  # noqa: F401
    except Exception:
        pytest.skip("lancedb not installed")

    monkeypatch.setenv("ABSTRACTFLOW_MEMORY_DIR", str(tmp_path / "abstractmemory"))
    monkeypatch.setenv("ABSTRACTFLOW_EMBEDDING_PROVIDER", "__disabled__")

    # Avoid cross-test store reuse (host-level cache).
    from abstractflow.visual import executor as visual_executor

    visual_executor._MEMORY_KG_STORE_CACHE.clear()

    session_id = "sess_kg_1"
    expected_owner = f"session_memory_{session_id}"

    # Flow A: assert one triple into scope=session.
    flow_assert = {
        "id": "test-memory-kg-session-assert",
        "name": "test-memory-kg-session-assert",
        "description": "Test-only: assert one triple into session scope.",
        "interfaces": [],
        "nodes": [
            {
                "id": "start",
                "type": "on_flow_start",
                "position": {"x": 96.0, "y": 96.0},
                "data": {"nodeType": "on_flow_start", "outputs": [{"id": "exec-out", "label": "", "type": "execution"}]},
            },
            {
                "id": "triples",
                "type": "literal_array",
                "position": {"x": 320.0, "y": 160.0},
                "data": {
                    "nodeType": "literal_array",
                    "outputs": [{"id": "value", "label": "value", "type": "array"}],
                    "literalValue": [{"subject": "Data", "predicate": "created_by", "object": "Doctor Noonien Soong"}],
                },
            },
            {
                "id": "assert",
                "type": "memory_kg_assert",
                "position": {"x": 512.0, "y": 96.0},
                "data": {
                    "nodeType": "memory_kg_assert",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "assertions", "label": "assertions", "type": "array"},
                        {"id": "scope", "label": "scope", "type": "string"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "raw", "label": "raw", "type": "object"},
                    ],
                    "pinDefaults": {"scope": "session"},
                },
            },
            {
                "id": "end",
                "type": "on_flow_end",
                "position": {"x": 704.0, "y": 96.0},
                "data": {
                    "nodeType": "on_flow_end",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "count", "label": "count", "type": "number"},
                    ],
                    "outputs": [],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "exec-out", "target": "assert", "targetHandle": "exec-in", "animated": True},
            {"id": "e2", "source": "triples", "sourceHandle": "value", "target": "assert", "targetHandle": "assertions", "animated": False},
            {"id": "e3", "source": "assert", "sourceHandle": "exec-out", "target": "end", "targetHandle": "exec-in", "animated": True},
            {"id": "e4", "source": "assert", "sourceHandle": "ok", "target": "end", "targetHandle": "ok", "animated": False},
            {"id": "e5", "source": "assert", "sourceHandle": "count", "target": "end", "targetHandle": "count", "animated": False},
        ],
        "entryNode": "start",
    }

    vf_assert = VisualFlow.model_validate(json.loads(json.dumps(flow_assert)))
    runner_a = create_visual_runner(vf_assert, flows={vf_assert.id: vf_assert})
    out_a = runner_a.run({}, session_id=session_id)
    assert out_a.get("success") is True

    # Flow B: query the asserted triple from scope=session in a separate run.
    flow_query = {
        "id": "test-memory-kg-session-query",
        "name": "test-memory-kg-session-query",
        "description": "Test-only: query one triple from session scope.",
        "interfaces": [],
        "nodes": [
            {
                "id": "start",
                "type": "on_flow_start",
                "position": {"x": 96.0, "y": 96.0},
                "data": {"nodeType": "on_flow_start", "outputs": [{"id": "exec-out", "label": "", "type": "execution"}]},
            },
            {
                "id": "query",
                "type": "memory_kg_query",
                "position": {"x": 320.0, "y": 96.0},
                "data": {
                    "nodeType": "memory_kg_query",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "subject", "label": "subject", "type": "string"},
                        {"id": "scope", "label": "scope", "type": "string"},
                        {"id": "limit", "label": "limit", "type": "number"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "items", "label": "items", "type": "array"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "raw", "label": "raw", "type": "object"},
                    ],
                    # Query by a different casing to validate canonicalization in the integration path.
                    "pinDefaults": {"subject": "data", "scope": "session", "limit": 50},
                },
            },
            {
                "id": "end",
                "type": "on_flow_end",
                "position": {"x": 560.0, "y": 96.0},
                "data": {
                    "nodeType": "on_flow_end",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "items", "label": "items", "type": "array"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                    ],
                    "outputs": [],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "exec-out", "target": "query", "targetHandle": "exec-in", "animated": True},
            {"id": "e2", "source": "query", "sourceHandle": "exec-out", "target": "end", "targetHandle": "exec-in", "animated": True},
            {"id": "e3", "source": "query", "sourceHandle": "items", "target": "end", "targetHandle": "items", "animated": False},
            {"id": "e4", "source": "query", "sourceHandle": "count", "target": "end", "targetHandle": "count", "animated": False},
            {"id": "e5", "source": "query", "sourceHandle": "ok", "target": "end", "targetHandle": "ok", "animated": False},
        ],
        "entryNode": "start",
    }

    vf_query = VisualFlow.model_validate(json.loads(json.dumps(flow_query)))
    runner_b = create_visual_runner(vf_query, flows={vf_query.id: vf_query})
    out_b = runner_b.run({}, session_id=session_id)

    assert out_b.get("success") is True
    result = out_b.get("result")
    assert isinstance(result, dict)
    assert result.get("ok") is True
    items = result.get("items")
    assert isinstance(items, list)
    assert any(isinstance(i, dict) and i.get("subject") == "data" and i.get("owner_id") == expected_owner for i in items)

