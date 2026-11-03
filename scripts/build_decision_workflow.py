#!/usr/bin/env python3
"""Build `examples/flows/decision-triage.json`: three Decision nodes (one per question type)
on one support ticket, Break Object on a typed answer, and a flow output per decision.

Usage: python3 scripts/build_decision_workflow.py            # writes examples/flows/decision-triage.json
       python3 scripts/decision_workflow_smoke.py            # runs it headlessly with a stub model

The flow reads `ticket`, `model` and `truncate` from On Flow Start, so one bundle serves
every decision model: leave `model` empty for the host's `output.decision` default, or pass
`mlx/jaredpalmer/kev-4b`, `huggingface/ggml-org/Kev-4B-GGUF:Q4_K_M`, `typesafe/jev-latest`.
Each Decision node also has a `provider` pin (left empty here: with a bare model id it names
the decision provider, and the node sends both `provider` and `model` to the runtime).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from wf_common import base_flow, edge, node, pin  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "examples" / "flows" / "decision-triage.json"

TICKET = (
    "Shoes arrived two weeks late and in the wrong size. Also I see two charges on my card. "
    "I have written twice already and nobody answers."
)

DEPARTMENTS = {
    "returns": "Exchanges, refunds, wrong or damaged items",
    "shipping": "Delivery status, delays, lost packages",
    "billing": "Charges, invoices, payment problems",
}
LEVELS = ["Calm", "Frustrated", "Very angry"]

# Decision node pins (the editor's template declares the same ids; the runtime reads them by id).
DECIDE_INPUTS = [
    pin("exec-in", "", "execution"),
    pin("state", "state", "string"),
    pin("question", "question", "string"),
    dict(pin("question_type", "question_type", "string"),
         schema={"type": "string", "enum": ["choice", "noul", "score"],
                 "oneOf": [{"const": "choice", "title": "Choice"}, {"const": "noul", "title": "Yes-no (noul)"},
                           {"const": "score", "title": "Score"}]}),
    dict(pin("options", "options", "array"), schema={"type": "array", "items": {"type": "string"}}),
    dict(pin("levels", "levels", "array"), schema={"type": "array", "items": {"type": "string"}}),
    pin("provider", "provider", "provider"),   # a decision provider; empty here: the handle in `model` names it
    pin("model", "model", "model"),
    pin("truncate", "truncate", "boolean"),
    pin("questions", "questions", "object"),   # advanced form: several System One questions at once
]


def _answer_schema(question_type: str, options: dict | list | None = None, levels: list | None = None) -> dict:
    if question_type == "choice":
        names = list(options.keys()) if isinstance(options, dict) else list(options or [])
        return {
            "type": "object",
            "properties": {
                "type": {"const": "choice"},
                "choice": {"type": "string", "enum": names},
                "confidence": {"type": "number"},
                "probabilities": {"type": "object", "properties": {name: {"type": "number"} for name in names}},
            },
        }
    if question_type == "noul":
        return {"type": "object", "properties": {"type": {"const": "noul"}, "noul": {"type": "number"}}}
    return {
        "type": "object",
        "properties": {
            "type": {"const": "score"},
            "score": {"type": "number"},
            "confidence": {"type": "number"},
            "legend": {"type": "object"},
            "probabilities": {"type": "object"},
        },
    }


def decide_node(node_id: str, label: str, x: int, y: int, *, question: str, question_type: str,
                options: dict | list | None = None, levels: list | None = None):
    schema = _answer_schema(question_type, options, levels)
    answer = dict(pin("answer", "answer", "object"), schema=schema)
    outputs = [pin("exec-out", "", "execution"), answer]
    if question_type == "choice":
        names = list(options.keys()) if isinstance(options, dict) else list(options or [])
        outputs += [
            dict(pin("choice", "choice", "string"), schema={"type": "string", "enum": names}),
            pin("confidence", "confidence", "number"),
            dict(pin("probabilities", "probabilities", "object"),
                 schema=schema["properties"]["probabilities"]),
        ]
    elif question_type == "noul":
        outputs += [pin("noul", "noul", "number"), pin("verdict", "verdict", "boolean")]
    else:
        outputs += [
            pin("score", "score", "number"),
            dict(pin("level", "level", "string"), schema={"type": "string", "enum": list(levels or [])}),
            pin("confidence", "confidence", "number"),
            dict(pin("probabilities", "probabilities", "object"),
                 schema={"type": "object", "properties": {str(i): {"type": "number"} for i in range(len(levels or []))}}),
        ]
    outputs += [pin("model", "model", "string"), pin("success", "success", "boolean"),
                pin("answers", "answers", "object"), pin("meta", "meta", "object")]
    defaults = {"question": question, "question_type": question_type, "truncate": False}
    if options is not None:
        defaults["options"] = options
    if levels is not None:
        defaults["levels"] = levels
    return node(node_id, "decide", label, x, y, inputs=DECIDE_INPUTS, outputs=outputs, pin_defaults=defaults)


def build() -> dict:
    flow = base_flow(
        "decision-triage",
        "Decision triage",
        "Three decisions about one support ticket: which team (choice), escalate or not (noul), "
        "how frustrated the customer is (score). Break Object splits the typed choice answer. "
        "`model` picks the decision model (empty = the host's output.decision default).",
    )
    nodes = [
        node("start", "on_flow_start", "Ticket", -700, 0,
             outputs=[pin("exec-out", "", "execution"), pin("ticket", "ticket", "string"),
                      pin("model", "model", "model"), pin("truncate", "truncate", "boolean")],
             pin_defaults={"ticket": TICKET, "model": "", "truncate": False}),
        decide_node("department", "Department", -300, -220, question="Which team should handle this?",
                    question_type="choice", options=DEPARTMENTS),
        decide_node("escalate", "Escalate", -300, 60, question="Does this need urgent human attention?",
                    question_type="noul"),
        decide_node("frustration", "Frustration", -300, 320, question="How frustrated is the customer?",
                    question_type="score", levels=LEVELS),
        node("split", "break_object", "Break Object", 120, -220,
             inputs=[pin("object", "object", "object")],
             outputs=[dict(pin("choice", "choice", "string"), schema={"type": "string", "enum": list(DEPARTMENTS)}),
                      pin("confidence", "confidence", "number")],
             extra={"breakConfig": {"selectedPaths": ["choice", "confidence"]}}),
        node("end", "on_flow_end", "Triage", 520, 0,
             inputs=[pin("exec-in", "", "execution"),
                     pin("department", "department", "string"),
                     pin("department_confidence", "department_confidence", "number"),
                     pin("escalate", "escalate", "boolean"),
                     pin("escalate_probability", "escalate_probability", "number"),
                     pin("frustration", "frustration", "string"),
                     pin("frustration_score", "frustration_score", "number"),
                     # `answered_by`: the provider/model that answered (text). An end pin named
                     # `model` is a model picker (type `model`) once loaded, which a text cannot feed.
                     pin("answered_by", "answered_by", "string")]),
    ]
    edges = [
        edge("start", "exec-out", "department", "exec-in", animated=True),
        edge("department", "exec-out", "escalate", "exec-in", animated=True),
        edge("escalate", "exec-out", "frustration", "exec-in", animated=True),
        edge("frustration", "exec-out", "end", "exec-in", animated=True),
    ]
    for target in ("department", "escalate", "frustration"):
        edges += [
            edge("start", "ticket", target, "state"),
            edge("start", "model", target, "model"),
            edge("start", "truncate", target, "truncate"),
        ]
    edges += [
        edge("department", "answer", "split", "object"),
        edge("split", "choice", "end", "department"),
        edge("split", "confidence", "end", "department_confidence"),
        edge("escalate", "verdict", "end", "escalate"),
        edge("escalate", "noul", "end", "escalate_probability"),
        edge("frustration", "level", "end", "frustration"),
        edge("frustration", "score", "end", "frustration_score"),
        edge("department", "model", "end", "answered_by"),
    ]
    flow["nodes"] = nodes
    flow["edges"] = edges
    return flow


def main() -> None:
    OUT.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
