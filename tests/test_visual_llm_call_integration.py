"""Real LLM integration test for visual LLM_CALL effect nodes (no mocks).

This test is skipped if a local provider is not reachable. Configure via env:
- ABSTRACTFLOW_TEST_LLM_PROVIDER (default: lmstudio)
- ABSTRACTFLOW_TEST_LLM_MODEL (default: zai-org/glm-4.6v-flash)
"""

from __future__ import annotations

import os

import pytest

from web.backend.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode
from web.backend.services.executor import create_visual_runner


def _lmstudio_base_url() -> str:
    return (os.getenv("LMSTUDIO_BASE_URL") or "http://localhost:1234/v1").rstrip("/")


def _lmstudio_models(base_url: str) -> list[str]:
    import httpx

    url = f"{base_url}/models"
    resp = httpx.get(url, timeout=2.0)
    resp.raise_for_status()
    data = resp.json()
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            out.append(item["id"])
    return out


@pytest.mark.integration
def test_visual_llm_call_executes_and_is_ledgered() -> None:
    provider = (os.getenv("ABSTRACTFLOW_TEST_LLM_PROVIDER") or "lmstudio").strip().lower()
    model = (os.getenv("ABSTRACTFLOW_TEST_LLM_MODEL") or "zai-org/glm-4.6v-flash").strip()

    if provider != "lmstudio":
        pytest.skip("Only lmstudio provider is supported by this integration test for now")

    base_url = _lmstudio_base_url()
    try:
        available = _lmstudio_models(base_url)
    except Exception as e:
        pytest.skip(f"LMStudio not reachable at {base_url} ({e})")

    if model not in set(available):
        pytest.skip(f"LMStudio model '{model}' not available (have: {available[:10]})")

    flow_id = "test-visual-llm-call"
    visual = VisualFlow(
        id=flow_id,
        name="test visual llm_call",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="prompt",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Reply with a single word: pong"},
            ),
            VisualNode(
                id="n2",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"provider": provider, "model": model, "temperature": 0.0}},
            ),
            VisualNode(
                id="n3",
                type=NodeType.CODE,
                position=Position(x=0, y=0),
                data={
                    "code": "def transform(input):\n    return {'text': input.get('input')}\n",
                    "functionName": "transform",
                },
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="e2", source="n2", sourceHandle="exec-out", target="n3", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="n2", targetHandle="prompt"),
            VisualEdge(id="d2", source="n2", sourceHandle="response", target="n3", targetHandle="input"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True

    text = result.get("result", {}).get("text")
    assert isinstance(text, str)
    assert text.strip()

    ledger = runner.get_ledger()
    assert any(
        rec.get("status") == "completed"
        and isinstance(rec.get("effect"), dict)
        and rec["effect"].get("type") == "llm_call"
        for rec in ledger
    )

