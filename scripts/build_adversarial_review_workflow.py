#!/usr/bin/env python3
"""adversarial-review workflow: a reusable review primitive.

Three independent critics review an artifact through distinct lenses
(correctness, design/robustness, requirements-fit), then a merge step
consolidates and severity-ranks their findings into one verdict. Designed to
be REUSED as a subflow (coding-agent's match-gate, co-scientist's reflection
step). The three critics run on a linear exec spine (simple + provably
correct; each is one cheap structured llm_call), and the merge is a pure
node pulled after the spine completes.
"""
from __future__ import annotations

import wf_common as W
from workflow_labels import label

CRITIC_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["findings"],
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["severity", "title", "detail"],
                "properties": {
                    "severity": {"type": "string", "enum": ["P0", "P1", "P2", "P3"]},
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                },
            },
        },
    },
}

CRITIC_PROMPT_CODE = """
artifact_text = str(artifact or "").strip()
req = str(requirements or "").strip()
lens_text = str(lens or "").strip()
parts = []
parts.append("Review the following artifact through ONE lens: " + lens_text)
parts.append("")
if req:
    parts.append("## Requirements / intent")
    parts.append(req)
    parts.append("")
parts.append("## Artifact")
parts.append(artifact_text)
parts.append("")
parts.append("Report ONLY real, specific findings for your lens as {severity (P0/P1/P2/P3), title, detail}. P0 = blocks use / correctness-breaking; P1 = must fix; P2 = should fix; P3 = nice. No praise, no generic advice. If the artifact is clean for your lens, return an empty findings list.")
return "\\n".join(parts)
""".strip()

MERGE_CODE = """
def _findings(obj, lens_name):
    # Partial-failure honesty: structured critic output can arrive
    # schema-shaped-but-wrong (the executor stores schema-parse results in
    # `data` even when validation failed — same class as the
    # meta-perspectives angle guard). A malformed lens must be REPORTED as a
    # finding, never silently folded as "clean" — otherwise a broken critic
    # upgrades the verdict toward "pass".
    if not isinstance(obj, dict):
        return [{
            "severity": "P1",
            "lens": lens_name,
            "title": "critic output unparseable",
            "detail": "#FALLBACK structured critic output was not an object; findings for this lens are unavailable",
        }]
    out = []
    for f in (obj.get("findings") or []):
        if not isinstance(f, dict):
            continue
        sev = str(f.get("severity") or "P2").upper()
        if sev not in ("P0", "P1", "P2", "P3"):
            sev = "P2"
        out.append({
            "severity": sev,
            "lens": lens_name,
            "title": str(f.get("title") or "").strip(),
            "detail": str(f.get("detail") or "").strip(),
        })
    return out

merged = _findings(correctness, "correctness") + _findings(design, "design") + _findings(requirements_fit, "requirements-fit")
order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
merged.sort(key=lambda f: order.get(f["severity"], 2))
blocking = sum(1 for f in merged if f["severity"] in ("P0", "P1"))
p0 = sum(1 for f in merged if f["severity"] == "P0")
if p0 > 0:
    verdict = "block"
elif blocking > 0:
    verdict = "revise"
else:
    verdict = "pass"
summary = str(len(merged)) + " findings across 3 lenses; " + str(blocking) + " blocking (" + str(p0) + " P0)."
return {
    "findings": merged,
    "blocking_count": blocking,
    "verdict": verdict,
    "summary": summary,
}
""".strip()


def _critic(node_id, label, x, y):
    # Pure reviewers: a single structured-output llm_call (no tool loop, no
    # subrun, no approval parks). The lens is baked into the composed prompt
    # (via the prompt composer's `lens` pin default), not into this node.
    return W.llm_node(
        node_id, label, x, y,
        pin_defaults={
            "system": "You are a rigorous, adversarial reviewer. You find real, specific, actionable flaws and never flatter. You review through exactly the lens you are given.",
            "temperature": 0.2,
            "resp_schema": CRITIC_SCHEMA,
        },
    )


def build_flow():
    flow = W.base_flow(
        "adversarial-review", *label("adversarial-review", "adversarial-review"),
        ["abstractreview.adversarial.v1"],
    )
    fields = [
        W.pin("artifact", "artifact", "string"),
        W.pin("requirements", "requirements", "string"),
        W.pin("provider", "provider", "provider_text"),
        W.pin("model", "model", "model"),
    ]
    lenses = [
        ("correctness", "Correctness & bugs — logic errors, edge cases, incorrect behavior, safety."),
        ("design", "Design & robustness — structure, coupling, error handling, maintainability, scalability."),
        ("requirements_fit", "Requirements fit — does it actually do what was asked; missing/extra scope."),
    ]
    # Linear critic spine (simple + provably correct; critics are cheap
    # 2-iteration calls). Each critic's exec-out feeds the next; merge is a
    # pure node pulled by the end node's data reads after the spine completes.
    #
    # Layout grid (2026-07-20 clean-layout pass): exec spine at y=0 with a
    # 400px x-pitch (box ~300 wide -> 100px gaps); each pure prompt composer
    # at y=380 directly under its critic (llm boxes are ~272 tall -> >=108px
    # vertical gap); merge in the same helper row; the four pure `get` fan-out
    # nodes stack in a column (230px y-pitch, box ~168 tall) before the end.
    flow["nodes"] = [
        W.start_node("Artifact to review", fields, -1100, 0,
                     pin_defaults={"requirements": ""}),
    ]
    x = -700
    prev_exec = ("start", "exec-out")
    for lens_key, lens_desc in lenses:
        pc = f"prompt_{lens_key}"
        ag = f"critic_{lens_key}"
        # The lens is baked into the prompt composer's `lens` input via a pin
        # default (the composer reads it; the critic is a generic reviewer).
        pc_node = W.code_node(pc, f"Compose {lens_key} prompt", CRITIC_PROMPT_CODE, x, 380,
                              [W.pin("artifact", "artifact", "string"),
                               W.pin("requirements", "requirements", "string"),
                               W.pin("lens", "lens", "string")],
                              output_type="string")
        pc_node["data"]["pinDefaults"] = {"permissions": "sandbox", "lens": lens_desc}
        flow["nodes"].append(pc_node)
        flow["nodes"].append(_critic(ag, f"Critic: {lens_key}", x, 0))
        x += 400
    flow["nodes"].extend([
        W.code_node("merge", "Merge + rank findings", MERGE_CODE, x, 380,
                    [W.pin("correctness", "correctness", "object"),
                     W.pin("design", "design", "object"),
                     W.pin("requirements_fit", "requirements_fit", "object")]),
        W.get_node("get_findings", "findings", [], x + 400, 0),
        W.get_node("get_verdict", "verdict", "revise", x + 400, 230),
        W.get_node("get_blocking", "blocking_count", 0, x + 400, 460),
        W.get_node("get_summary", "summary", "", x + 400, 690),
        W.end_node("Review verdict", [
            W.pin("findings", "findings", "array"),
            W.pin("verdict", "verdict", "string"),
            W.pin("blocking_count", "blocking_count", "number"),
            W.pin("summary", "summary", "string"),
        ], x + 800, 0),
    ])

    edges = []
    for lens_key, _desc in lenses:
        pc = f"prompt_{lens_key}"
        ag = f"critic_{lens_key}"
        edges += [
            W.edge(prev_exec[0], prev_exec[1], ag, "exec-in", animated=True),
            W.edge("start", "artifact", pc, "artifact"),
            W.edge("start", "requirements", pc, "requirements"),
            W.edge(pc, "output", ag, "prompt"),
            W.edge("start", "provider", ag, "provider"),
            W.edge("start", "model", ag, "model"),
        ]
        prev_exec = (ag, "exec-out")
    # last critic -> end (exec); merge pulled by end's data reads.
    edges += [
        W.edge(prev_exec[0], prev_exec[1], "end", "exec-in", animated=True),
        W.edge("critic_correctness", "data", "merge", "correctness"),
        W.edge("critic_design", "data", "merge", "design"),
        W.edge("critic_requirements_fit", "data", "merge", "requirements_fit"),
        W.edge("merge", "output", "get_findings", "object"),
        W.edge("merge", "output", "get_verdict", "object"),
        W.edge("merge", "output", "get_blocking", "object"),
        W.edge("merge", "output", "get_summary", "object"),
        W.edge("get_findings", "value", "end", "findings"),
        W.edge("get_verdict", "value", "end", "verdict"),
        W.edge("get_blocking", "value", "end", "blocking_count"),
        W.edge("get_summary", "value", "end", "summary"),
    ]
    flow["edges"] = edges
    return flow


def main():
    flow = build_flow()
    # Fail LOUDLY on edge problems (the old build printed them and returned 0,
    # so a broken graph could ship green through automation).
    problems = W.validate_edges(flow)
    if problems:
        for p in problems:
            print(f"EDGE ERROR [adversarial-review]: {p}")
        return 1
    W.write_json(W.FLOWS_DIR / "adversarial-review.json", flow)
    print(f"wrote adversarial-review.json ({len(flow['nodes'])} nodes, {len(flow['edges'])} edges)")
    W.compile_check("adversarial-review", ["adversarial-review"])
    print("compiled ok")
    # Repack the shipped bundle so the gateway serves the same graph as the
    # example JSON (bundle_version bumps are the release process's job).
    out = W.pack_bundle(
        root_flow_id="adversarial-review",
        bundle_id="adversarial-review",
        bundle_version="0.1.1",
        entrypoints=["adversarial-review"],
        metadata={"family": "adversarial-review"},
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
