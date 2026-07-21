#!/usr/bin/env python3
"""Generate the `diagram-render` workflow bundle.

A DEDICATED professional-figure workflow (operator directive 2026-07-20):
takes a structured diagram SPEC (JSON data — the LLM never authors code) and
renders publication-quality PNG + PDF figures via the runtime's first-class
`write_chart` effect node.

History (why write_chart): v0.1.x rendered by writing a fixed matplotlib
script into the workspace and running it through the `execute_command` tool
— which sits on the runtime's require-approval list, so every unattended
run STALLED on a tool-approval prompt at the figure step. Operator ruling
2026-07-20: "co-scientist is a deterministic process... you should NEVER
ask for approval as long as it follows the process." v0.2.0 renders
IN-PROCESS through `write_chart` (write_pdf trust class: a fixed renderer
over pure data — no shell, no code authoring surface, workspace-contained
paths, hard resource caps), so the pipeline is approval-free by
construction while the framework's security rules stay intact
(adversarial fable5 review ranked this over run-scoped approval policies
and argument-inspecting auto-approve rules, both forgeable).

Design decisions (adversary-reviewed, carried from v0.1.x):
- Two spec kinds cover the report needs: `layered` (architecture boxes/
  arrows in columns) and `line` (trajectories, e.g. Elo across cycles).
- Failure is HONEST degradation, never a flow failure: missing matplotlib,
  a bad spec, or a render crash produce `rendered:false` + a labeled
  warning so callers can keep their ASCII fallback (#FALLBACK discipline).
- Deterministic gate: write_chart itself refuses to report rendered:true
  unless the PNG exists with non-trivial bytes (never trust prose claims).
- Figures land as durable run ARTIFACTS via import_workspace_file (the
  observer durable-artifacts rule: workspace bytes alone are not listable).

Spec contract (v1):
  {"kind":"layered","title":str,"caption":str,
   "layers":[{"label":str,"nodes":[{"id":str,"label":str}]}],
   "edges":[{"from":str,"to":str,"label":str?,"style":"solid"|"dashed"}]}
  {"kind":"line","title":str,"caption":str,"x_label":str,"y_label":str,
   "y_min":number?,
   "series":[{"label":str,"points":[[x,y],...]}]}
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wf_common as W

# ---------------------------------------------------------------------------
# Code node bodies (RestrictedPython sandbox: no imports).
# ---------------------------------------------------------------------------

# Path hygiene + early spec validation. write_chart contains paths against
# the run workspace regardless; this node keeps figure files in a tidy,
# predictable folder and gives invalid specs a SPECIFIC early error.
PREP_CODE = """
def _safe_name(t, extra):
    out = ""
    for ch in str(t or ""):
        if ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ("0" <= ch <= "9") or ch in extra:
            out = out + ch
        else:
            out = out + "-"
    return out
base = _safe_name(str(basename or "figure").strip().strip("/"), "-_.") or "figure"
if base.endswith(".png"):
    base = base[:-4] or "figure"
d_raw = _safe_name(str(out_dir or "reports/figures").strip().strip("/"), "-_./")
d_parts = []
for part in d_raw.split("/"):
    if part and part != "." and part != "..":
        d_parts.append(part)
d = "/".join(d_parts) or "reports/figures"
s = spec if isinstance(spec, dict) else None
kind = str((s or {}).get("kind") or "")
valid = s is not None and kind in ("layered", "line")
error = "" if valid else ("spec must be an object with kind layered|line, got kind=" + kind)
return {
    "valid": valid,
    "error": error,
    "spec": s or {},
    "png_path": d + "/" + base + ".png",
}
""".strip()

# Fold the write_chart outcome into the workflow's stable output contract.
FINAL_CODE = """
p = prep if isinstance(prep, dict) else {}
ok = bool(chart_rendered)
out_warnings = []
for w in (chart_warnings or []):
    out_warnings.append(str(w))
spec_error = str(p.get("error") or "").strip()
if spec_error:
    out_warnings.append("#FALLBACK: invalid diagram spec: " + spec_error[:200])
elif not ok:
    head = str(chart_error or "").strip()
    out_warnings.append("#FALLBACK: diagram render did not complete (" + head[:300] + ") — the caller should keep its text fallback.")
return {
    "rendered": ok,
    "png_path": str(chart_png or "") if ok else "",
    "pdf_path": str(chart_pdf or "") if ok else "",
    "warnings": out_warnings,
}
""".strip()


def _if(node_id, label, x, y):
    return W.node(node_id, "if", label, x, y,
                  inputs=[W.EXEC_IN, W.pin("condition", "condition", "boolean")],
                  outputs=[W.pin("true", "true", "execution"),
                           W.pin("false", "false", "execution")],
                  extra={"icon": "&#x2753;", "headerColor": "#F39C12"})


def build_flow() -> dict:
    flow = W.base_flow(
        "diagram-render", "diagram-render",
        "Dedicated professional-figure workflow: renders a structured diagram "
        "SPEC (layered architecture boxes/arrows, or line trajectories) into "
        "publication-quality PNG + PDF via the runtime's in-process "
        "write_chart node (write_pdf trust class — no shell, no approval "
        "prompt). The LLM authors only the spec (data), never code. Missing "
        "matplotlib / bad spec / render crash degrade honestly to "
        "rendered:false + #FALLBACK warning so callers keep a text fallback. "
        "Figures are registered as durable run artifacts.",
    )
    fields = [
        W.pin("spec", "spec", "object"),
        W.pin("out_dir", "out_dir", "string"),
        W.pin("basename", "basename", "string"),
    ]
    # LAYOUT (clean-graph audit): exec spine left-to-right in one lane at
    # y=0, columns 360 apart; pure helpers in one row at y=340 near their
    # consumers. Audited by scripts/audit_flow_graph.py (zero OVERLAP).
    flow["nodes"] = [
        W.start_node("Diagram spec", fields, 0, 0,
                     pin_defaults={"out_dir": "reports/figures", "basename": "figure"}),
        W.code_node("prep", "Validate spec + compose figure path", PREP_CODE, 360, 340,
                    [W.pin("spec", "spec", "object"),
                     W.pin("out_dir", "out_dir", "string"),
                     W.pin("basename", "basename", "string")]),
        _if("if_valid", "Spec valid?", 360, 0),
        W.write_chart_node("chart", "Render chart (in-process)", 720, 0),
        W.code_node("final", "Fold render outcome", FINAL_CODE, 1080, 340,
                    [W.pin("prep", "prep", "object"),
                     W.pin("chart_rendered", "chart_rendered", "boolean"),
                     W.pin("chart_png", "chart_png", "string"),
                     W.pin("chart_pdf", "chart_pdf", "string"),
                     W.pin("chart_error", "chart_error", "string"),
                     W.pin("chart_warnings", "chart_warnings", "array")]),
        _if("if_rendered", "Rendered?", 1080, 0),
        W.import_workspace_file_node("import_png", "Register PNG artifact", 1440, 0,
                                     content_type="image/png"),
        W.import_workspace_file_node("import_pdf", "Register PDF artifact", 1800, 0,
                                     content_type="application/pdf"),
        W.end_node("Figure", [
            W.pin("rendered", "rendered", "boolean"),
            W.pin("png_path", "png_path", "string"),
            W.pin("pdf_path", "pdf_path", "string"),
            W.pin("warnings", "warnings", "array"),
        ], 2160, 0),
    ]
    flow["edges"] = [
        # exec spine: validate -> render -> gate -> import (if ok) -> end
        W.edge("start", "exec-out", "if_valid", "exec-in", animated=True),
        W.edge("if_valid", "true", "chart", "exec-in", animated=True),
        W.edge("if_valid", "false", "end", "exec-in", animated=True),
        W.edge("chart", "exec-out", "if_rendered", "exec-in", animated=True),
        W.edge("if_rendered", "true", "import_png", "exec-in", animated=True),
        W.edge("if_rendered", "false", "end", "exec-in", animated=True),
        W.edge("import_png", "exec-out", "import_pdf", "exec-in", animated=True),
        W.edge("import_pdf", "exec-out", "end", "exec-in", animated=True),
        # data
        W.edge("start", "spec", "prep", "spec"),
        W.edge("start", "out_dir", "prep", "out_dir"),
        W.edge("start", "basename", "prep", "basename"),
        W.edge("prep", "valid", "if_valid", "condition"),
        W.edge("prep", "png_path", "chart", "file_path"),
        W.edge("prep", "spec", "chart", "spec"),
        W.edge("prep", "output", "final", "prep"),
        W.edge("chart", "rendered", "final", "chart_rendered"),
        W.edge("chart", "file_path", "final", "chart_png"),
        W.edge("chart", "pdf_path", "final", "chart_pdf"),
        W.edge("chart", "error", "final", "chart_error"),
        W.edge("chart", "warnings", "final", "chart_warnings"),
        W.edge("final", "rendered", "if_rendered", "condition"),
        W.edge("final", "png_path", "import_png", "file_path"),
        W.edge("final", "pdf_path", "import_pdf", "file_path"),
        # end payload
        W.edge("final", "rendered", "end", "rendered"),
        W.edge("final", "png_path", "end", "png_path"),
        W.edge("final", "pdf_path", "end", "pdf_path"),
        W.edge("final", "warnings", "end", "warnings"),
    ]
    return flow


def main() -> int:
    flow = build_flow()
    problems = W.validate_edges(flow)
    print(f"edge problems: {problems}")
    if problems:
        return 1
    W.write_json(W.FLOWS_DIR / "diagram-render.json", flow)
    W.compile_check("diagram-render", ["diagram-render"])
    out = W.pack_bundle(
        root_flow_id="diagram-render",
        bundle_id="diagram-render",
        # 0.1.0 = first ship (fixed matplotlib script via execute_command).
        # 0.1.1 = adversary wave 2026-07-20: readable layout, zero overlaps.
        # 0.2.0 = APPROVAL-FREE rendering (operator ruling 2026-07-20): the
        # execute_command lane stalled every unattended run on a tool-
        # approval prompt; figures now render in-process via the runtime's
        # write_chart effect node (write_pdf trust class — no shell). The
        # python_bin input is gone with the subprocess.
        bundle_version="0.2.0",
        entrypoints=["diagram-render"],
        metadata={
            "family": "diagram-render",
            "purpose": "professional figure rendering from structured specs (layered architecture diagrams, line trajectories) via the runtime's in-process write_chart node; approval-free by construction; honest rendered:false degradation; figures registered as durable artifacts",
            "outputs": ["rendered", "png_path", "pdf_path", "warnings"],
        },
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
