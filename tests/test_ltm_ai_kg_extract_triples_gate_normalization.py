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

