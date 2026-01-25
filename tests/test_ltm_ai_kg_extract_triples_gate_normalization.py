from __future__ import annotations

import json
from pathlib import Path


def _load_flow() -> dict:
    flows_dir = Path(__file__).resolve().parents[1] / "web" / "flows"
    return json.loads((flows_dir / "ltm-ai-kg-extract-triples.json").read_text())


def test_gate_assertions_canonicalizes_terms_and_aliases_predicates() -> None:
    flow = _load_flow()
    node = next(n for n in flow.get("nodes", []) if n.get("id") == "node-12")
    code = node["data"]["code"]

    ns: dict = {}
    exec(code, ns)  # noqa: S102 - trusted, repo-owned workflow code
    transform = ns["transform"]

    text = "Data was built by Doctor Noonien Soong."
    payload = {
        "input": {
            "text": text,
            "assertions": [
                {
                    "subject": "Data",
                    "predicate": "schema:creator",
                    "object": "Doctor Noonien Soong",
                    "attributes": {"evidence_quote": "Data", "original_context": "Data"},
                },
                {
                    "subject": "Data",
                    "predicate": "schema:awareness",
                    "object": "human behavior",
                    "attributes": {"evidence_quote": "Data", "original_context": "Data"},
                },
            ],
        }
    }

    out = transform(payload)
    assert isinstance(out, list) and out
    assert out[0]["subject"] == "data"
    assert out[0]["predicate"] == "dcterms:creator"
    assert out[0]["object"] == "doctor noonien soong"
    assert out[1]["predicate"] == "schema:knowsabout"


def test_gate_assertions_repairs_markdown_evidence_quote_to_verbatim_substring() -> None:
    flow = _load_flow()
    node = next(n for n in flow.get("nodes", []) if n.get("id") == "node-12")
    code = node["data"]["code"]

    ns: dict = {}
    exec(code, ns)  # noqa: S102 - trusted, repo-owned workflow code
    transform = ns["transform"]

    text = "That's vulnerability as *exposure to harm without agency*."
    payload = {
        "input": {
            "text": text,
            "assertions": [
                {
                    "subject": "ex:claim-vulnerability-as-exposure",
                    "predicate": "skos:definition",
                    "object": "vulnerability as exposure to harm without agency",
                    "attributes": {
                        # LLMs often drop markdown emphasis markers; the gate should repair this deterministically.
                        "evidence_quote": "That's vulnerability as exposure to harm without agency.",
                        "original_context": "That's vulnerability as exposure to harm without agency.",
                    },
                }
            ],
        }
    }

    out = transform(payload)
    assert isinstance(out, list) and out
    attrs = out[0].get("attributes")
    assert isinstance(attrs, dict)
    ev = attrs.get("evidence_quote")
    assert isinstance(ev, str) and ev
    assert ev in text
    assert "*exposure to harm without agency*" in ev
    ctx = attrs.get("original_context")
    assert isinstance(ctx, str) and ctx
    assert ctx in text
    assert ev in ctx
