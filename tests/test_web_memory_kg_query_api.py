from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from abstractflow.visual import executor as visual_executor
from web.backend.main import app
from web.backend.services.runtime_stores import get_runtime_stores


def test_web_api_memory_kg_query_returns_items_and_active_memory(tmp_path, monkeypatch) -> None:
    """Level B: Web backend KG query route must be able to query + pack Active Memory.

    This is used by the KG/ActiveMemory viewer for interactive debugging without rerunning flows.
    """
    try:
        import lancedb  # noqa: F401
    except Exception:
        pytest.skip("lancedb not installed")

    monkeypatch.setenv("ABSTRACTFLOW_MEMORY_DIR", str(tmp_path / "abstractmemory"))
    monkeypatch.setenv("ABSTRACTFLOW_EMBEDDING_PROVIDER", "__disabled__")

    # Avoid cross-test store reuse (host-level cache).
    visual_executor._MEMORY_KG_STORE_CACHE.clear()

    run_store, _, _ = get_runtime_stores()
    try:
        from abstractruntime.core.models import Effect, EffectType, RunState
        from abstractruntime.integrations.abstractmemory.effect_handlers import build_memory_kg_effect_handlers
        from abstractruntime.storage.artifacts import utc_now_iso
    except Exception as e:  # pragma: no cover
        pytest.skip(f"AbstractRuntime memory KG integration unavailable: {e}")

    run = RunState.new(workflow_id="wf", entry_node="start", session_id="sess-1", vars={"_temp": {}})
    run_store.save(run)

    from abstractmemory import LanceDBTripleStore

    store = LanceDBTripleStore(Path(tmp_path / "abstractmemory") / "kg", embedder=None)
    handlers = build_memory_kg_effect_handlers(store=store, run_store=run_store, now_iso=utc_now_iso)
    assert_handler = handlers[EffectType.MEMORY_KG_ASSERT]

    out = assert_handler(
        run,
        Effect(
            type=EffectType.MEMORY_KG_ASSERT,
            payload={
                "scope": "global",
                "assertions": [
                    {
                        "subject": "Data",
                        "predicate": "dcterms:description",
                        "object": "Android officer",
                        "attributes": {"evidence_quote": "android"},
                        "provenance": {"span_id": "s1"},
                    }
                ],
            },
        ),
        None,
    )
    assert out.status == "completed"

    with TestClient(app) as client:
        res = client.post(
            "/api/memory/kg/query",
            json={
                "run_id": run.run_id,
                "scope": "global",
                "subject": "data",
                "limit": 10,
                "max_input_tokens": 80,
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body.get("ok") is True
        assert int(body.get("count") or 0) >= 1
        items = body.get("items")
        assert isinstance(items, list) and items
        assert items[0].get("subject") == "data"
        active = body.get("active_memory_text")
        assert isinstance(active, str) and active.startswith("## KG ACTIVE MEMORY")

