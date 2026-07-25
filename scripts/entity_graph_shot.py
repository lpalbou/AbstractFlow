#!/usr/bin/env python3
"""Render an entity's ACTUAL memory graph + growth curve to PNGs.

Proof visuals for "see the memory graph grow and be healthy": reads a real
home (lab/entities/<name>) and draws
  1. <name>_memory_graph.png — the record network coloured by kind, with the
     real edges (summarizes / mentions / written_amid / reflected_in /
     continues), diary + valence annotated;
  2. <name>_growth.png — records/edges/diary/valence across the life stages
     recorded in lab/<name>_full_life.json.

Run: PYTHONPATH=../abstractruntime/src:../abstractmemory/src \
       python3 scripts/entity_graph_shot.py [name]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import networkx as nx  # noqa: E402

from entity_live_experiment import open_runtime  # noqa: E402

KIND_COLORS = {
    "value": "#B03A2E", "purpose": "#A04000", "trait": "#B9770E",
    "episode": "#2E86C1", "observation": "#5499C7",
    "summary": "#7D3C98", "dream": "#9B59B6", "world_model": "#48C9B0",
    "diary": "#16A085", "claim": "#7F8C8D", "lesson": "#27AE60",
    "interest": "#F39C12", "realization": "#8E44AD",
}
# Anchor on the script's own location, not the CWD (the sibling scripts'
# convention) — running from the repo root must find the same lab/.
OUT = Path(__file__).resolve().parent.parent / "lab"


def render(slug: str) -> None:
    home = OUT / "entities" / slug
    if not home.exists():
        print(f"no home at {home}")
        return
    ert, _ = open_runtime(home, "lmstudio", "qwen/qwen3.6-35b-a3b")
    try:
        from abstractmemory import TripleQuery

        G = nx.DiGraph()
        node_kind: dict = {}
        edges: list = []
        for scope in ("life", "self", "diary"):
            for a in ert.home.ms.query(TripleQuery(scope=scope, owner_id=ert.entity_id, limit=0)):
                attrs = a.attributes if isinstance(a.attributes, dict) else {}
                subj = str(getattr(a, "subject", "") or "")
                if attrs.get("record_edge"):
                    obj = str(getattr(a, "object", "") or "")
                    pred = str(getattr(a, "predicate", "") or "").split(":")[-1].split("/")[-1]
                    if subj and obj:
                        edges.append((subj, obj, pred))
                    continue
                kind = attrs.get("record_kind")
                if kind and subj:
                    node_kind[subj] = kind
                    G.add_node(subj)
        drawn_edges = []
        for s, o, p in edges:
            if s in node_kind and o in node_kind:
                G.add_edge(s, o)
                drawn_edges.append((s, o, p))

        diary_n = len(ert.home.diary.list_entries())
        # -1 sentinel on read failure (the experiment twin's convention):
        # a silent 0 would caption a read error as "0 feelings".
        val_n = -1
        try:
            import sqlite3
            con = sqlite3.connect(str(home / "memory.sqlite3"))
            val_n = 0
            for t in [r[0] for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%valence%'")]:
                val_n += con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            con.close()
        except Exception:
            val_n = -1

        # --- figure 1: the memory graph ---
        fig, ax = plt.subplots(figsize=(14, 10))
        pos = nx.spring_layout(G, k=0.9, iterations=80, seed=7)
        for kind, color in KIND_COLORS.items():
            ns = [n for n in G.nodes if node_kind.get(n) == kind]
            if ns:
                nx.draw_networkx_nodes(G, pos, nodelist=ns, node_color=color,
                                       node_size=420, alpha=0.92, ax=ax, label=f"{kind} ({len(ns)})")
        nx.draw_networkx_edges(G, pos, edgelist=[(s, o) for s, o, _ in drawn_edges],
                               edge_color="#95A5A6", alpha=0.45, arrows=True,
                               arrowsize=8, width=0.8, ax=ax)
        counts: dict = {}
        for n in G.nodes:
            k = node_kind.get(n, "?")
            counts[k] = counts.get(k, 0) + 1
        feelings_txt = f"{val_n} feelings" if val_n >= 0 else "feelings unreadable"
        ax.set_title(
            f"Entity '{slug}' — memory graph: {G.number_of_nodes()} records, "
            f"{len(drawn_edges)} edges, {diary_n} diary entries, {feelings_txt}\n"
            f"kinds: {counts}", fontsize=11)
        ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
        ax.axis("off")
        fig.tight_layout()
        p1 = OUT / f"{slug}_memory_graph.png"
        fig.savefig(p1, dpi=130, bbox_inches="tight")
        plt.close(fig)
        print(f"wrote {p1}")

        # --- figure 2: growth across the recorded life stages ---
        art = OUT / f"{slug}_full_life.json"
        if art.exists():
            stages = json.loads(art.read_text()).get("stages", [])
            labels = [s["label"] for s in stages]
            recs = [s["records_total"] for s in stages]
            edg = [s["edge_rows"] for s in stages]
            dia = [s["diary_entries"] for s in stages]
            # -1 is the read-failure sentinel: clamping it to 0 would caption
            # a read error as "0 feelings" (adversary D, P3-1) — keep it as
            # None (matplotlib gaps the point) and label the series honestly.
            val = [s["valence_rows"] if s["valence_rows"] >= 0 else None for s in stages]
            val_unreadable = any(v is None for v in val)
            feelings_label = "feelings (gaps = unreadable)" if val_unreadable else "feelings"
            fig2, ax2 = plt.subplots(figsize=(9, 6))
            x = range(len(labels))
            for series, name, color in ((recs, "records", "#2E86C1"),
                                        (edg, "edges", "#95A5A6"),
                                        (dia, "diary", "#16A085"),
                                        (val, feelings_label, "#B03A2E")):
                ax2.plot(x, series, marker="o", label=name, color=color, linewidth=2)
                for xi, yi in zip(x, series):
                    if yi is None:
                        continue
                    ax2.annotate(str(yi), (xi, yi), textcoords="offset points",
                                 xytext=(0, 8), fontsize=8, ha="center")
            ax2.set_xticks(list(x))
            ax2.set_xticklabels(labels)
            # A proof visual must COMPUTE its claim, never assert it
            # (wave-3 adversary C: a hardcoded caption would title failing
            # data as healthy). Claims render only when true of the data.
            monotone = all(recs[i] <= recs[i + 1] for i in range(len(recs) - 1))
            violations = sum(int(s.get("violations", 0) or 0) for s in stages)
            claims = []
            if monotone:
                claims.append("monotone")
            if violations == 0:
                claims.append("zero health violations at every stage")
            else:
                claims.append(f"{violations} health violation(s) — SEE STAGES")
            ax2.set_title(f"Entity '{slug}' — the graph grows across a life "
                          f"({', '.join(claims)})")
            ax2.set_ylabel("count")
            ax2.legend()
            ax2.grid(alpha=0.3)
            fig2.tight_layout()
            p2 = OUT / f"{slug}_growth.png"
            fig2.savefig(p2, dpi=130)
            plt.close(fig2)
            print(f"wrote {p2}")
    finally:
        ert.close()


if __name__ == "__main__":
    render(sys.argv[1] if len(sys.argv) > 1 else "imre")
