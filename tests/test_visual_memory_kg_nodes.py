from __future__ import annotations

import json

from abstractflow.visual.executor import create_visual_runner
from abstractflow.visual.models import VisualFlow


def test_visual_memory_kg_assert_and_query_runs_without_installing_packages() -> None:
    """Level B: ensure VisualFlow can execute memory_kg_* nodes in monorepo dev.

    Regression guard:
    - When running from source, `abstractmemory/` is a project directory (namespace package),
      while the importable package lives in `abstractmemory/src/abstractmemory`.
    - `create_visual_runner()` must add the src-layout path so memory_kg flows run.

    This test stays deterministic:
    - no LLM calls
    - no embedding search (pattern query only)
    """

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
                    "outputs": [{"id": "value", "label": "value", "type": "array"}],
                    "literalValue": [
                        {
                            "subject": "AbstractFramework",
                            "predicate": "includes",
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
                        {"id": "assertions", "label": "assertions", "type": "array"},
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
                        {"id": "items", "label": "items", "type": "array"},
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
                        {"id": "items", "label": "items", "type": "array"},
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


def test_visual_memory_kg_assert_accepts_empty_assertions() -> None:
    """Level B: asserting an empty list should be a successful no-op.

    Some KG ingestion flows intentionally produce `assertions=[]` when the extractor
    finds no factual triples (e.g. user asks a question, or text is empty).
    That should not fail the whole workflow.
    """

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
                "data": {"nodeType": "literal_array", "outputs": [{"id": "value", "label": "value", "type": "array"}], "literalValue": []},
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
