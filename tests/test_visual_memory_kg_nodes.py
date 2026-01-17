from __future__ import annotations

import json

import pytest

from abstractflow.visual.executor import create_visual_runner
from abstractflow.visual.models import VisualFlow


def test_visual_memory_kg_assert_and_query_runs(tmp_path, monkeypatch) -> None:
    """Level B: ensure VisualFlow can execute memory_kg_* nodes with a durable store.

    This stays deterministic/offline:
    - no LLM calls
    - no embedding search (pattern query only)
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

    flow_json = {
        "id": "test-memory-kg-basic",
        "name": "test-memory-kg-basic",
        "description": "Test-only: assert + query triples via memory_kg_* nodes.",
        "interfaces": [],
        "nodes": [
            {
                "id": "node-1",
                "type": "on_flow_start",
                "position": {"x": 96.0, "y": 96.0},
                "data": {
                    "nodeType": "on_flow_start",
                    "label": "Start",
                    "icon": "&#x1F3C1;",
                    "headerColor": "#C0392B",
                    "inputs": [],
                    "outputs": [{"id": "exec-out", "label": "", "type": "execution"}],
                },
            },
            {
                "id": "node-2",
                "type": "literal_array",
                "position": {"x": 320.0, "y": 192.0},
                "data": {
                    "nodeType": "literal_array",
                    "label": "Assertions",
                    "icon": "[]",
                    "headerColor": "#FF8800",
                    "inputs": [],
                    "outputs": [{"id": "value", "label": "value", "type": "assertions"}],
                        "literalValue": [
                            {
                                "subject": "AbstractFramework",
                                "predicate": "dcterms:hasPart",
                                "object": "abstractruntime",
                            }
                        ],
                    },
                },
            {
                "id": "node-3",
                "type": "memory_kg_assert",
                "position": {"x": 512.0, "y": 96.0},
                "data": {
                    "nodeType": "memory_kg_assert",
                    "label": "Assert",
                    "icon": "&#x1F9E0;",
                    "headerColor": "#8E44AD",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "assertions", "label": "assertions", "type": "assertions"},
                        {"id": "scope", "label": "scope", "type": "string"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "assertion_ids", "label": "assertion_ids", "type": "array"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "raw", "label": "raw", "type": "object"},
                    ],
                },
            },
            {
                "id": "node-4",
                "type": "literal_string",
                "position": {"x": 512.0, "y": 240.0},
                "data": {
                    "nodeType": "literal_string",
                    "label": "Subject",
                    "icon": '"',
                    "headerColor": "#FF00FF",
                    "inputs": [],
                    "outputs": [{"id": "value", "label": "value", "type": "string"}],
                    "literalValue": "AbstractFramework",
                },
            },
            {
                "id": "node-5",
                "type": "memory_kg_query",
                "position": {"x": 704.0, "y": 96.0},
                "data": {
                    "nodeType": "memory_kg_query",
                    "label": "Query",
                    "icon": "&#x1F50E;",
                    "headerColor": "#8E44AD",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "subject", "label": "subject", "type": "string"},
                        {"id": "scope", "label": "scope", "type": "string"},
                        {"id": "limit", "label": "limit", "type": "number"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "items", "label": "items", "type": "assertions"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "raw", "label": "raw", "type": "object"},
                    ],
                    "pinDefaults": {"scope": "run", "limit": 10},
                },
            },
            {
                "id": "node-6",
                "type": "on_flow_end",
                "position": {"x": 896.0, "y": 96.0},
                "data": {
                    "nodeType": "on_flow_end",
                    "label": "End",
                    "icon": "&#x23F9;",
                    "headerColor": "#C0392B",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "items", "label": "items", "type": "assertions"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                    ],
                    "outputs": [],
                },
            },
        ],
        "edges": [
            {"id": "edge-1", "source": "node-1", "sourceHandle": "exec-out", "target": "node-3", "targetHandle": "exec-in", "animated": True},
            {"id": "edge-2", "source": "node-2", "sourceHandle": "value", "target": "node-3", "targetHandle": "assertions", "animated": False},
            {"id": "edge-3", "source": "node-3", "sourceHandle": "exec-out", "target": "node-5", "targetHandle": "exec-in", "animated": True},
            {"id": "edge-4", "source": "node-4", "sourceHandle": "value", "target": "node-5", "targetHandle": "subject", "animated": False},
            {"id": "edge-5", "source": "node-5", "sourceHandle": "exec-out", "target": "node-6", "targetHandle": "exec-in", "animated": True},
            {"id": "edge-6", "source": "node-5", "sourceHandle": "count", "target": "node-6", "targetHandle": "count", "animated": False},
            {"id": "edge-7", "source": "node-5", "sourceHandle": "items", "target": "node-6", "targetHandle": "items", "animated": False},
            {"id": "edge-8", "source": "node-5", "sourceHandle": "ok", "target": "node-6", "targetHandle": "ok", "animated": False},
        ],
        "entryNode": "node-1",
    }

    # Validate JSON shape (ensures NodeType enum includes memory_kg_*).
    vf = VisualFlow.model_validate(json.loads(json.dumps(flow_json)))

    runner = create_visual_runner(vf, flows={vf.id: vf})
    out = runner.run({})

    assert isinstance(out, dict)
    assert out.get("success") is True
    result = out.get("result")
    assert isinstance(result, dict)
    assert result.get("ok") is True
    assert int(result.get("count") or 0) >= 1


def test_visual_memory_kg_assert_accepts_empty_assertions(tmp_path, monkeypatch) -> None:
    """Level B: asserting an empty list should be a successful no-op.

    Some KG ingestion flows intentionally produce `assertions=[]` when the extractor
    finds no factual triples (e.g. user asks a question, or text is empty).
    That should not fail the whole workflow.
    """
    try:
        import lancedb  # noqa: F401
    except Exception:
        pytest.skip("lancedb not installed")

    monkeypatch.setenv("ABSTRACTFLOW_MEMORY_DIR", str(tmp_path / "abstractmemory"))
    monkeypatch.setenv("ABSTRACTFLOW_EMBEDDING_PROVIDER", "__disabled__")

    from abstractflow.visual import executor as visual_executor

    visual_executor._MEMORY_KG_STORE_CACHE.clear()

    flow_json = {
        "id": "test-memory-kg-empty",
        "name": "test-memory-kg-empty",
        "description": "Test-only: memory_kg_assert should no-op on empty assertions.",
        "interfaces": [],
        "nodes": [
            {
                "id": "start",
                "type": "on_flow_start",
                "position": {"x": 96.0, "y": 96.0},
                "data": {"nodeType": "on_flow_start", "outputs": [{"id": "exec-out", "label": "", "type": "execution"}]},
            },
            {
                "id": "empty",
                "type": "literal_array",
                "position": {"x": 320.0, "y": 96.0},
                "data": {"nodeType": "literal_array", "outputs": [{"id": "value", "label": "value", "type": "assertions"}], "literalValue": []},
            },
            {
                "id": "assert",
                "type": "memory_kg_assert",
                "position": {"x": 512.0, "y": 96.0},
                "data": {
                    "nodeType": "memory_kg_assert",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "assertions", "label": "assertions", "type": "assertions"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "raw", "label": "raw", "type": "object"},
                    ],
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
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "exec-out", "target": "assert", "targetHandle": "exec-in"},
            {"id": "e2", "source": "empty", "sourceHandle": "value", "target": "assert", "targetHandle": "assertions"},
            {"id": "e3", "source": "assert", "sourceHandle": "exec-out", "target": "end", "targetHandle": "exec-in"},
            {"id": "e4", "source": "assert", "sourceHandle": "count", "target": "end", "targetHandle": "count"},
            {"id": "e5", "source": "assert", "sourceHandle": "ok", "target": "end", "targetHandle": "ok"},
        ],
        "entryNode": "start",
    }

    vf = VisualFlow.model_validate(json.loads(json.dumps(flow_json)))
    runner = create_visual_runner(vf, flows={vf.id: vf})
    out = runner.run({})

    assert out.get("success") is True
    result = out.get("result")
    assert isinstance(result, dict)
    assert result.get("ok") is True
    assert int(result.get("count") or 0) == 0


def test_visual_memory_kg_lancedb_persists_across_store_recreation(tmp_path, monkeypatch) -> None:
    """Level B: durability smoke test (file-backed store + restart simulation).

    This verifies:
    - VisualFlow memory_kg_* nodes use a durable LanceDB store when available
    - data survives store recreation (simulated restart by clearing host cache)
    """
    try:
        import lancedb  # noqa: F401
    except Exception:
        pytest.skip("lancedb not installed")

    # Force a deterministic, offline run:
    # - Disable embeddings (avoid LMStudio/Ollama calls)
    # - Use a temp dir as the persistent memory root
    mem_root = tmp_path / "abstractmemory"
    monkeypatch.setenv("ABSTRACTFLOW_MEMORY_DIR", str(mem_root))
    monkeypatch.setenv("ABSTRACTFLOW_EMBEDDING_PROVIDER", "__disabled__")

    # Clear the host-level cache so we can simulate store recreation between runs.
    from abstractflow.visual import executor as visual_executor

    visual_executor._MEMORY_KG_STORE_CACHE.clear()

    write_flow_json = {
        "id": "test-memory-kg-write-global",
        "name": "test-memory-kg-write-global",
        "interfaces": [],
        "nodes": [
            {"id": "start", "type": "on_flow_start", "position": {"x": 96, "y": 96}, "data": {"nodeType": "on_flow_start", "outputs": [{"id": "exec-out", "label": "", "type": "execution"}]}},
            {
                "id": "assertions",
                "type": "literal_array",
                "position": {"x": 320, "y": 160},
                "data": {
                    "nodeType": "literal_array",
                    "outputs": [{"id": "value", "label": "value", "type": "assertions"}],
                    "literalValue": [{"subject": "AbstractFramework", "predicate": "dcterms:hasPart", "object": "abstractruntime"}],
                },
            },
            {
                "id": "scope",
                "type": "literal_string",
                "position": {"x": 320, "y": 256},
                "data": {"nodeType": "literal_string", "outputs": [{"id": "value", "label": "value", "type": "string"}], "literalValue": "global"},
            },
            {
                "id": "assert",
                "type": "memory_kg_assert",
                "position": {"x": 512, "y": 96},
                "data": {
                    "nodeType": "memory_kg_assert",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "assertions", "label": "assertions", "type": "assertions"},
                        {"id": "scope", "label": "scope", "type": "string"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                    ],
                },
            },
            {
                "id": "end",
                "type": "on_flow_end",
                "position": {"x": 704, "y": 96},
                "data": {"nodeType": "on_flow_end", "inputs": [{"id": "exec-in", "label": "", "type": "execution"}, {"id": "ok", "label": "ok", "type": "boolean"}, {"id": "count", "label": "count", "type": "number"}]},
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "exec-out", "target": "assert", "targetHandle": "exec-in", "animated": True},
            {"id": "e2", "source": "assertions", "sourceHandle": "value", "target": "assert", "targetHandle": "assertions", "animated": False},
            {"id": "e3", "source": "scope", "sourceHandle": "value", "target": "assert", "targetHandle": "scope", "animated": False},
            {"id": "e4", "source": "assert", "sourceHandle": "exec-out", "target": "end", "targetHandle": "exec-in", "animated": True},
            {"id": "e5", "source": "assert", "sourceHandle": "ok", "target": "end", "targetHandle": "ok", "animated": False},
            {"id": "e6", "source": "assert", "sourceHandle": "count", "target": "end", "targetHandle": "count", "animated": False},
        ],
        "entryNode": "start",
    }

    read_flow_json = {
        "id": "test-memory-kg-read-global",
        "name": "test-memory-kg-read-global",
        "interfaces": [],
        "nodes": [
            {"id": "start", "type": "on_flow_start", "position": {"x": 96, "y": 96}, "data": {"nodeType": "on_flow_start", "outputs": [{"id": "exec-out", "label": "", "type": "execution"}]}},
            {
                "id": "subject",
                "type": "literal_string",
                "position": {"x": 320, "y": 160},
                "data": {"nodeType": "literal_string", "outputs": [{"id": "value", "label": "value", "type": "string"}], "literalValue": "AbstractFramework"},
            },
            {
                "id": "scope",
                "type": "literal_string",
                "position": {"x": 320, "y": 256},
                "data": {"nodeType": "literal_string", "outputs": [{"id": "value", "label": "value", "type": "string"}], "literalValue": "global"},
            },
            {
                "id": "query",
                "type": "memory_kg_query",
                "position": {"x": 512, "y": 96},
                "data": {
                    "nodeType": "memory_kg_query",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "subject", "label": "subject", "type": "string"},
                        {"id": "scope", "label": "scope", "type": "string"},
                    ],
                    "outputs": [
                        {"id": "exec-out", "label": "", "type": "execution"},
                        {"id": "items", "label": "items", "type": "assertions"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                    ],
                    "pinDefaults": {"limit": 10},
                },
            },
            {
                "id": "end",
                "type": "on_flow_end",
                "position": {"x": 704, "y": 96},
                "data": {
                    "nodeType": "on_flow_end",
                    "inputs": [
                        {"id": "exec-in", "label": "", "type": "execution"},
                        {"id": "ok", "label": "ok", "type": "boolean"},
                        {"id": "count", "label": "count", "type": "number"},
                        {"id": "items", "label": "items", "type": "assertions"},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "sourceHandle": "exec-out", "target": "query", "targetHandle": "exec-in", "animated": True},
            {"id": "e2", "source": "subject", "sourceHandle": "value", "target": "query", "targetHandle": "subject", "animated": False},
            {"id": "e3", "source": "scope", "sourceHandle": "value", "target": "query", "targetHandle": "scope", "animated": False},
            {"id": "e4", "source": "query", "sourceHandle": "exec-out", "target": "end", "targetHandle": "exec-in", "animated": True},
            {"id": "e5", "source": "query", "sourceHandle": "ok", "target": "end", "targetHandle": "ok", "animated": False},
            {"id": "e6", "source": "query", "sourceHandle": "count", "target": "end", "targetHandle": "count", "animated": False},
            {"id": "e7", "source": "query", "sourceHandle": "items", "target": "end", "targetHandle": "items", "animated": False},
        ],
        "entryNode": "start",
    }

    write_vf = VisualFlow.model_validate(json.loads(json.dumps(write_flow_json)))
    read_vf = VisualFlow.model_validate(json.loads(json.dumps(read_flow_json)))

    flows = {write_vf.id: write_vf, read_vf.id: read_vf}

    write_runner = create_visual_runner(write_vf, flows=flows)
    out1 = write_runner.run({})
    assert out1.get("success") is True

    # Simulate a host restart by discarding the cached store object.
    visual_executor._MEMORY_KG_STORE_CACHE.clear()

    read_runner = create_visual_runner(read_vf, flows=flows)
    out2 = read_runner.run({})
    assert out2.get("success") is True
    result2 = out2.get("result")
    assert isinstance(result2, dict)
    assert result2.get("ok") is True
    assert int(result2.get("count") or 0) >= 1

    # Sanity: make sure we actually created the LanceDB directory on disk.
    assert (mem_root / "kg").exists()
