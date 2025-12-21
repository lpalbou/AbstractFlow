"""Real LLM integration test for visual LLM_CALL effect nodes (no mocks).

This test is skipped if a local provider is not reachable. Configure via env:
- ABSTRACTFLOW_TEST_LLM_PROVIDER (default: lmstudio)
- ABSTRACTFLOW_TEST_LLM_MODEL (default: zai-org/glm-4.6v-flash)
"""

from __future__ import annotations

import os

import pytest

from abstractflow.visual import create_visual_runner
from abstractflow.visual.models import NodeType, Position, VisualEdge, VisualFlow, VisualNode


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


@pytest.mark.integration
def test_visual_llm_call_can_be_terminal_node() -> None:
    """Regression: terminal effect nodes must be allowed (LLM_CALL at end)."""
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

    flow_id = "test-visual-llm-call-terminal"
    visual = VisualFlow(
        id=flow_id,
        name="test visual llm_call terminal",
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
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="d1", source="prompt", sourceHandle="value", target="n2", targetHandle="prompt"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True

    payload = result.get("result")
    assert isinstance(payload, dict)
    content = payload.get("content")
    assert isinstance(content, str)
    assert content.strip()

    ledger = runner.get_ledger()
    assert any(
        rec.get("status") == "completed"
        and isinstance(rec.get("effect"), dict)
        and rec["effect"].get("type") == "llm_call"
        for rec in ledger
    )


@pytest.mark.integration
def test_visual_llm_call_can_use_multiple_models_in_one_flow() -> None:
    """Regression: LLM_CALL nodes can use different provider/model per node."""
    provider = (os.getenv("ABSTRACTFLOW_TEST_LLM_PROVIDER") or "lmstudio").strip().lower()
    preferred_a = (os.getenv("ABSTRACTFLOW_TEST_LLM_MODEL_A") or "zai-org/glm-4.6v-flash").strip()
    preferred_b = (os.getenv("ABSTRACTFLOW_TEST_LLM_MODEL_B") or "google_gemma-3-1b-it").strip()

    if provider != "lmstudio":
        pytest.skip("Only lmstudio provider is supported by this integration test for now")

    base_url = _lmstudio_base_url()
    try:
        available = _lmstudio_models(base_url)
    except Exception as e:
        pytest.skip(f"LMStudio not reachable at {base_url} ({e})")

    uniq: list[str] = []
    for m in available:
        if m not in uniq:
            uniq.append(m)

    if len(uniq) < 2:
        pytest.skip("Need at least two LMStudio models installed for multi-model test")

    model_a: str
    model_b: str
    if preferred_a in set(uniq) and preferred_b in set(uniq) and preferred_a != preferred_b:
        model_a, model_b = preferred_a, preferred_b
    else:
        model_a, model_b = uniq[0], next((m for m in uniq[1:] if m != uniq[0]), "")
        if not model_b:
            pytest.skip("Need two distinct LMStudio models installed for multi-model test")

    flow_id = "test-visual-llm-call-multi-model"
    visual = VisualFlow(
        id=flow_id,
        name="test visual llm_call multi model",
        entryNode="n1",
        nodes=[
            VisualNode(
                id="n1",
                type=NodeType.ON_USER_REQUEST,
                position=Position(x=0, y=0),
                data={},
            ),
            VisualNode(
                id="p1",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Reply with exactly: alpha"},
            ),
            VisualNode(
                id="n2",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"provider": provider, "model": model_a, "temperature": 0.0}},
            ),
            VisualNode(
                id="p2",
                type=NodeType.LITERAL_STRING,
                position=Position(x=0, y=0),
                data={"literalValue": "Reply with exactly: beta"},
            ),
            VisualNode(
                id="n3",
                type=NodeType.LLM_CALL,
                position=Position(x=0, y=0),
                data={"effectConfig": {"provider": provider, "model": model_b, "temperature": 0.0}},
            ),
        ],
        edges=[
            VisualEdge(id="e1", source="n1", sourceHandle="exec-out", target="n2", targetHandle="exec-in"),
            VisualEdge(id="e2", source="n2", sourceHandle="exec-out", target="n3", targetHandle="exec-in"),
            VisualEdge(id="d1", source="p1", sourceHandle="value", target="n2", targetHandle="prompt"),
            VisualEdge(id="d2", source="p2", sourceHandle="value", target="n3", targetHandle="prompt"),
        ],
    )

    runner = create_visual_runner(visual, flows={flow_id: visual})
    result = runner.run({})
    assert result.get("success") is True

    ledger = runner.get_ledger()
    llm_recs = [
        rec
        for rec in ledger
        if rec.get("status") == "completed"
        and isinstance(rec.get("effect"), dict)
        and rec["effect"].get("type") == "llm_call"
    ]
    assert len(llm_recs) == 2

    by_node: dict[str, dict] = {}
    for rec in llm_recs:
        node_id = rec.get("node_id")
        if isinstance(node_id, str):
            by_node[node_id] = rec

    assert by_node.get("n2", {}).get("result", {}).get("model") == model_a
    assert by_node.get("n3", {}).get("result", {}).get("model") == model_b
