import json
from pathlib import Path


def test_ltm_ai_kg_extract_triples_has_safe_default_output_budget() -> None:
    flow_path = Path(__file__).resolve().parents[1] / "web" / "flows" / "ltm-ai-kg-extract-triples.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    start = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-1")
    pin_defaults = start.get("data", {}).get("pinDefaults", {})
    max_out = pin_defaults.get("max_out_tokens")
    assert isinstance(max_out, (int, float)) and int(max_out) <= 0


def test_ltm_ai_kg_extract_triples_is_unbounded_by_default() -> None:
    flow_path = Path(__file__).resolve().parents[1] / "web" / "flows" / "ltm-ai-kg-extract-triples.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    start = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-1")
    pin_defaults = start.get("data", {}).get("pinDefaults", {})
    max_assertions = pin_defaults.get("max_assertions")
    # 0/negative => no selection cap; output is bounded only by model capabilities + gating/validation.
    assert isinstance(max_assertions, (int, float)) and int(max_assertions) <= 0


def test_ltm_ai_kg_extract_triples_prompt_mentions_composition_edges() -> None:
    flow_path = Path(__file__).resolve().parents[1] / "web" / "flows" / "ltm-ai-kg-extract-triples.json"
    flow = json.loads(flow_path.read_text(encoding="utf-8"))
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    prompt_node = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-5")
    template = prompt_node.get("data", {}).get("pinDefaults", {}).get("template", "")
    assert isinstance(template, str) and "dcterms:hasPart" in template and "dcterms:isPartOf" in template
