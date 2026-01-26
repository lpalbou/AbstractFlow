import json
from pathlib import Path


def _load_flow(name: str) -> dict:
    flow_path = Path(__file__).resolve().parents[1] / "web" / "flows" / name
    return json.loads(flow_path.read_text(encoding="utf-8"))


def test_ltm_ai_kg_ingest_turn_has_safe_default_output_budget() -> None:
    flow = _load_flow("ltm-ai-kg-ingest-turn.json")
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    start = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-1")
    pin_defaults = start.get("data", {}).get("pinDefaults", {})
    max_out = pin_defaults.get("max_out_tokens")
    assert isinstance(max_out, (int, float)) and int(max_out) <= 0


def test_ltm_ai_kg_ingest_span_has_safe_default_output_budget() -> None:
    flow = _load_flow("ltm-ai-kg-ingest-span.json")
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    start = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-1")
    pin_defaults = start.get("data", {}).get("pinDefaults", {})
    max_out = pin_defaults.get("max_out_tokens")
    assert isinstance(max_out, (int, float)) and int(max_out) <= 0


def test_ac_kg_memory_agent_has_safe_default_output_budget() -> None:
    flow = _load_flow("ac-kg-memory-agent.json")
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    defaults = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "memory_default")
    literal = defaults.get("data", {}).get("literalValue", {})
    assert isinstance(literal, dict)
    max_out = literal.get("kg_max_out_tokens")
    assert isinstance(max_out, (int, float)) and int(max_out) <= 0

    get_node = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "mem_max_out_tokens")
    pin_defaults = get_node.get("data", {}).get("pinDefaults", {})
    max_out_default = pin_defaults.get("default")
    assert isinstance(max_out_default, (int, float)) and int(max_out_default) <= 0


def test_ltm_ai_kg_debug_observability_has_safe_default_output_budget() -> None:
    flow = _load_flow("ltm-ai-kg-debug-observability.json")
    nodes = flow.get("nodes")
    assert isinstance(nodes, list) and nodes

    start = next(n for n in nodes if isinstance(n, dict) and n.get("id") == "node-1")
    pin_defaults = start.get("data", {}).get("pinDefaults", {})
    max_out = pin_defaults.get("extract_max_out_tokens")
    assert isinstance(max_out, (int, float)) and int(max_out) <= 0
