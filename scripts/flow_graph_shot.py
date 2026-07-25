#!/usr/bin/env python3
"""Render a VisualFlow graph to a PNG from its authored node positions.

A faithful, READABLE diagram of the flow AS AUTHORED (the editor's x/y +
edges). Labels are wrapped to fit inside boxes that grow to the text — never
truncated (operator note 2026-07-24: "the node text didn't fit").

Run: python3 scripts/flow_graph_shot.py entity-life entity-cognition-turn ...
"""
from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch  # noqa: E402

FLOWS = Path(__file__).resolve().parents[1] / "examples" / "flows"
OUT = Path(__file__).resolve().parents[1] / "lab"

KIND_COLOR = {
    "on_flow_start": "#27AE60", "on_flow_end": "#C0392B",
    "code": "#34495E", "llm_call": "#2980B9", "subflow": "#7D3C98",
    "if": "#E67E22", "while": "#D35400", "set_var": "#16A085",
    "get_var": "#1ABC9C", "make_object": "#95A5A6", "get": "#95A5A6",
    "wait_event": "#8E44AD", "emit_event": "#C0392B", "answer_user": "#2ECC71",
    "concat": "#7F8C8D",
    "memory_recall": "#6C3483", "memory_commit": "#6C3483", "memory_form": "#6C3483",
    "memory_appraise": "#6C3483", "memory_probe": "#6C3483", "diary_write": "#6C3483",
    "memory_consolidate": "#6C3483", "life_query": "#6C3483",
}

# Layout in DATA units (the editor's coordinate space). One box occupies a
# generous slice so wrapped multi-line labels never collide.
BOX_W = 210.0          # box width in data units
LINE_H = 26.0          # per-text-line height in data units
PAD_V = 20.0           # vertical padding inside a box
WRAP = 22              # chars per wrapped line
FONT = 8.5


def _wrap(label: str) -> list[str]:
    lines: list[str] = []
    for para in str(label).split("\n"):
        lines.extend(textwrap.wrap(para, width=WRAP) or [""])
    # No silent truncation (the doc promises "never truncated"): boxes grow
    # to the text, so long labels get an ellipsis line + a loud warning
    # instead of quietly disappearing (adversary C latch).
    if len(lines) > 5:
        print(f"WARNING: label exceeds 5 wrapped lines, elided: {label!r}")
        lines = lines[:4] + ["…"]
    return lines


def render(flow_id: str) -> None:
    flow = json.loads((FLOWS / f"{flow_id}.json").read_text())
    nodes = {n["id"]: n for n in flow["nodes"]}
    xs = [n["position"]["x"] for n in flow["nodes"]]
    ys = [n["position"]["y"] for n in flow["nodes"]]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    w = max(1.0, maxx - minx)
    h = max(1.0, maxy - miny)

    # Figure size: ~1 inch per 150 data units, clamped generous.
    fig_w = max(16, (w + BOX_W * 2) / 150.0)
    fig_h = max(10, (h + 400) / 150.0)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))

    def px(x: float) -> float:
        return x - minx

    def py(y: float) -> float:
        return maxy - y  # editor y grows downward

    # precompute wrapped labels + box heights
    wrapped: dict = {}
    box_h: dict = {}
    for n in flow["nodes"]:
        lbl = str(n["data"].get("label") or n["id"])
        wl = _wrap(lbl)
        wrapped[n["id"]] = wl
        box_h[n["id"]] = PAD_V + LINE_H * len(wl)

    # edges under nodes; anchor at box centers so lines meet the boxes cleanly
    for e in flow["edges"]:
        s = nodes.get(e["source"]); t = nodes.get(e["target"])
        if not s or not t:
            continue
        is_exec = e.get("sourceHandle") in ("exec-out", "true", "false", "loop", "done", "body") \
            or e.get("targetHandle") == "exec-in"
        x1 = px(s["position"]["x"]) + BOX_W; y1 = py(s["position"]["y"])
        x2 = px(t["position"]["x"]); y2 = py(t["position"]["y"])
        col = "#2C3E50" if is_exec else "#AEB6BF"
        arr = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                              mutation_scale=11 if is_exec else 7,
                              color=col, alpha=0.75 if is_exec else 0.30,
                              lw=1.6 if is_exec else 0.8,
                              connectionstyle="arc3,rad=0.06", zorder=1)
        ax.add_patch(arr)

    for n in flow["nodes"]:
        x = px(n["position"]["x"]); y = py(n["position"]["y"])
        bh = box_h[n["id"]]
        nt = n["data"].get("nodeType", "")
        color = KIND_COLOR.get(nt, "#7F8C8D")
        box = FancyBboxPatch((x, y - bh / 2), BOX_W, bh,
                             boxstyle="round,pad=4,rounding_size=10",
                             fc=color, ec="white", lw=1.4, alpha=0.97, zorder=2)
        ax.add_patch(box)
        ax.text(x + BOX_W / 2, y, "\n".join(wrapped[n["id"]]),
                ha="center", va="center", color="white", fontsize=FONT,
                zorder=3, linespacing=1.15)

    ax.set_xlim(-BOX_W * 0.3, w + BOX_W * 1.3)
    ax.set_ylim(-max(box_h.values()), h + max(box_h.values()))
    ax.set_aspect("equal")
    ax.set_title(f"{flow_id}  —  {flow.get('name', '')}\n"
                 f"{len(flow['nodes'])} nodes · {len(flow['edges'])} edges "
                 "(dark arrows = execution flow, light = data flow · "
                 "violet = entity-memory effects)", fontsize=13)
    ax.axis("off")
    fig.tight_layout()
    out = OUT / f"flow_{flow_id}.png"
    fig.savefig(out, dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"wrote {out}  ({fig_w:.0f}x{fig_h:.0f}in)")


if __name__ == "__main__":
    ids = sys.argv[1:] or ["entity-life", "entity-cognition-turn"]
    OUT.mkdir(exist_ok=True)
    for fid in ids:
        render(fid)
