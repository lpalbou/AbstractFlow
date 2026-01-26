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
    preds = [it.get("predicate") for it in out if isinstance(it, dict)]
    assert "dcterms:creator" in preds
    assert "schema:knowsabout" in preds

    creator = next(it for it in out if isinstance(it, dict) and it.get("predicate") == "dcterms:creator")
    assert creator["subject"] == "data"
    assert creator["object"] == "doctor noonien soong"


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


def test_gate_prioritizes_structural_relations_over_excess_typing_labels() -> None:
    flow = _load_flow()
    node = next(n for n in flow.get("nodes", []) if n.get("id") == "node-12")
    code = node["data"]["code"]

    ns: dict = {}
    exec(code, ns)  # noqa: S102 - trusted, repo-owned workflow code
    transform = ns["transform"]

    text = "Abstract Framework includes AbstractRuntime and AbstractGateway."
    payload = {
        "input": {
            "text": text,
            "max_assertions": 6,
            "assertions": [
                {"subject": "ex:framework", "predicate": "rdf:type", "object": "schema:SoftwareApplication", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:framework", "predicate": "schema:name", "object": "Abstract Framework", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:runtime", "predicate": "rdf:type", "object": "schema:SoftwareApplication", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:runtime", "predicate": "schema:name", "object": "AbstractRuntime", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:gateway", "predicate": "rdf:type", "object": "schema:SoftwareApplication", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:gateway", "predicate": "schema:name", "object": "AbstractGateway", "attributes": {"evidence_quote": text, "original_context": text}},
                # Structural relations should be kept even under a tight max_assertions budget.
                {"subject": "ex:framework", "predicate": "dcterms:hasPart", "object": "ex:runtime", "attributes": {"evidence_quote": text, "original_context": text}},
                {"subject": "ex:framework", "predicate": "dcterms:hasPart", "object": "ex:gateway", "attributes": {"evidence_quote": text, "original_context": text}},
            ],
        }
    }

    out = transform(payload)
    assert isinstance(out, list) and out
    preds = [a.get("predicate") for a in out if isinstance(a, dict)]
    assert "dcterms:haspart" in preds
