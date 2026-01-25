from __future__ import annotations

import json
from pathlib import Path


def _repo_root() -> Path:
    # .../abstractflow/tests/<file>.py -> repo root is 2 levels up.
    return Path(__file__).resolve().parents[2]


def _load_flow(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _node_code(flow: dict, *, node_id: str) -> str:
    for node in flow.get("nodes", []):
        if isinstance(node, dict) and node.get("id") == node_id:
            data = node.get("data") if isinstance(node.get("data"), dict) else {}
            code = data.get("code")
            if isinstance(code, str) and code.strip():
                return code
    raise AssertionError(f"Node {node_id!r} with code not found")


def _exec_transform(code: str):
    ns: dict = {}
    exec(code, ns)  # noqa: S102 - executing local flow code is intentional for determinism/regression testing.
    transform = ns.get("transform")
    assert callable(transform)
    return transform


def test_ingest_turn_builds_chat_friendly_evidence_bundle() -> None:
    flow = _load_flow(_repo_root() / "abstractflow" / "web" / "flows" / "ltm-ai-kg-ingest-turn.json")
    transform = _exec_transform(_node_code(flow, node_id="node-28"))

    out = transform(
        {
            "input": {
                "text": "USER: hi\n\nASSISTANT: hello",
                "domain_focus": "unit",
                "sources": [
                    {"kind": "tool_outputs", "text": "## Tool outputs\n- `search_files`\n..."},
                    {"source_id": "doc", "kind": "attachment", "artifact_id": "artifact-123", "title": "Doc", "text": "doc snippet"},
                ],
            }
        }
    )

    assert isinstance(out, dict)
    bundle_text = out.get("bundle_text")
    assert isinstance(bundle_text, str)
    assert bundle_text.startswith("USER: hi")
    assert "SYSTEM: ## Tool Outputs" in bundle_text
    assert "source_id=doc" in bundle_text
    assert "artifact_id=artifact-123" in bundle_text
    assert "doc snippet" in bundle_text

    extractor_input = out.get("input")
    assert isinstance(extractor_input, dict)
    assert extractor_input.get("text") == bundle_text
    assert "sources" not in extractor_input

    sources_norm = out.get("sources")
    assert isinstance(sources_norm, list)
    assert sources_norm and sources_norm[0].get("source_id") == "transcript"

    sources_meta = out.get("sources_meta")
    assert isinstance(sources_meta, dict)
    meta_sources = sources_meta.get("sources")
    assert isinstance(meta_sources, list)
    assert any(s.get("source_id") == "doc" for s in meta_sources if isinstance(s, dict))


def test_ingest_turn_attaches_source_provenance_when_evidence_matches() -> None:
    flow = _load_flow(_repo_root() / "abstractflow" / "web" / "flows" / "ltm-ai-kg-ingest-turn.json")
    transform = _exec_transform(_node_code(flow, node_id="node-33"))

    out = transform(
        {
            "input": {
                "assertions": [
                    {"subject": "ex:a", "predicate": "skos:definition", "object": "foo", "attributes": {"evidence_quote": "doc snippet"}},
                    {"subject": "ex:b", "predicate": "skos:definition", "object": "bar", "attributes": {"original_context": "transcript snippet"}},
                    {"subject": "ex:c", "predicate": "skos:definition", "object": "baz", "attributes": {"evidence_quote": "no match"}},
                ],
                "sources": [
                    {"source_id": "transcript", "kind": "transcript", "artifact_id": "note-1", "text": "transcript snippet plus more"},
                    {"source_id": "doc", "kind": "attachment", "artifact_id": "artifact-123", "title": "Doc", "text": "doc snippet and stuff"},
                ],
            }
        }
    )

    assert isinstance(out, list)
    assert len(out) == 3

    a0 = out[0]
    prov0 = a0.get("provenance")
    assert isinstance(prov0, dict)
    assert prov0.get("source_id") == "doc"
    assert prov0.get("source_kind") == "attachment"
    assert prov0.get("source_artifact_id") == "artifact-123"

    attrs0 = a0.get("attributes")
    assert isinstance(attrs0, dict)
    assert attrs0.get("source_id") == "doc"
    assert attrs0.get("source_kind") == "attachment"
    assert attrs0.get("source_artifact_id") == "artifact-123"
    assert attrs0.get("source_title") == "Doc"

    a1 = out[1]
    prov1 = a1.get("provenance")
    assert isinstance(prov1, dict)
    assert prov1.get("source_id") == "transcript"
    assert prov1.get("source_kind") == "transcript"
    assert prov1.get("source_artifact_id") == "note-1"

    a2 = out[2]
    prov2 = a2.get("provenance")
    assert prov2 is None or "source_id" not in prov2


def test_ac_kg_memory_agent_emits_tool_sources_from_scratchpad_traces() -> None:
    flow = _load_flow(_repo_root() / "abstractflow" / "web" / "flows" / "ac-kg-memory-agent.json")
    transform = _exec_transform(_node_code(flow, node_id="kg_sources"))

    sources = transform(
        {
            "input": {
                "node_traces": {
                    "node-x": {
                        "steps": [
                            {
                                "effect": {
                                    "type": "tool_calls",
                                    "payload": {
                                        "tool_calls": [
                                            {"name": "search_files", "call_id": "c1", "arguments": {"query": "persona"}},
                                        ]
                                    },
                                },
                                "result": {"results": [{"call_id": "c1", "success": True, "output": {"matches": 3}}]},
                            }
                        ]
                    }
                }
            }
        }
    )

    assert isinstance(sources, list)
    assert len(sources) >= 2
    assert any(s.get("kind") == "tool_outputs" for s in sources if isinstance(s, dict))
    assert any(s.get("kind") == "work_summary" for s in sources if isinstance(s, dict))

