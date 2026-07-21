#!/usr/bin/env python3
"""co-scientist workflow: a deep VisualFlow replica of the Nature 2026 'AI
co-scientist' (Gemini) multi-agent hypothesis engine
(nature.com/articles/s41586-026-10644-y; arXiv:2502.18864).

This is a genuinely multi-stage, test-time-compute-scaling system — by design
it does MORE orchestration than a single-pass deep-research report, because
the paper's contribution is exactly that: generate -> critique -> rank ->
evolve, iterated, with feedback threaded forward.

Pipeline (the paper's loop, reproduced):

  GROUNDING (starts from the literature — composition):
    A subflow call to `deep-investigate` (the framework's proven web-search
    investigation engine: an agent iteratively searches/reads real sources and
    returns a source ledger + grounded findings + open questions). This is the
    paper's "Literature exploration through web search" that grounds the whole
    system; reusing deep-research's investigation unit is the faithful,
    modular way to make co-scientist literally start from research.

  GENERATION grounded in that literature base.

  SUPERVISOR LOOP (max_cycles, scaling test-time compute):
    reflect (initial review, grounded by the literature base)
      -> rank (Elo tournament via simulated scientific debate, over a
               deterministically PRIORITIZED set of pairs: new + top + similar)
      -> evolve (convergent: refine/combine top hypotheses)
      -> generate-expand (divergent: NEW hypotheses in UNEXPLORED areas, the
               paper's Generation "research expansion" using the overview +
               meta-feedback)
      -> fold (attach reviews, apply Elo, add evolved+expanded with
               near-duplicate pruning, aggregate META-FEEDBACK carried into
               the next cycle's prompts, cap the pool).

  TERMINAL FULL REVIEW (the paper's initial-vs-full review funnel):
    a search-grounded AGENT re-reviews the FINALISTS against live literature
    (per-hypothesis novelty check — the ablation-critical Reflection-with-
    search), then a final tournament so nothing reaches the overview
    unreviewed, then Elo re-applied.

  META-REVIEW synthesizes the finalists + literature into a research overview.

Fidelity note (honest — faithful / simplified / dropped):
  FAITHFUL: literature grounding via real web search (delegated to
    deep-investigate); the six-agent division of labor (Generation, Reflection,
    Ranking, Evolution + research-expansion, Meta-review, and a deterministic
    Proximity-style dedup); the Elo tournament via simulated pairwise
    scientific debate; the TWO feedback channels (Elo state + meta-feedback
    appended to next-cycle prompts) that the paper credits for the
    self-improving Elo rise; the initial-review-then-full-searched-review
    funnel; a source ledger surfaced with the output.
  SIMPLIFIED (disclosed): the async worker queue with the paper's adaptive
    agent-weighting/resource allocation is a FIXED synchronous supervisor
    while-loop (reflect->rank->evolve->expand every cycle, deterministic,
    replayable); per-cycle reflection judges novelty against the SHARED
    gathered literature base (cheap initial review) — the deep per-hypothesis
    LIVE-SEARCH novelty check runs ONCE at the end over the finalists
    (budget-bounded), so early cycles do NOT filter non-novel ideas the way
    the paper's search-in-Reflection ablation does (a real fidelity cost, not
    just placement); the Proximity role is approximated by deterministic
    token-overlap DEDUP only (Jaccard>=0.6) — its match-PRIORITIZATION role is
    a heuristic (top-vs-top + newest-vs-top pairs), not a learned similarity
    graph; meta-feedback is deterministic aggregation of review + debate
    signal appended to next-cycle prompts, not a separate meta LLM call.
    Ranking soundness is enforced structurally at the end (a correctness-floor
    gate demotes unsound/unreviewed hypotheses below the headline), on top of
    the plausibility-first debate prompt.
  DROPPED: multi-turn debates for top vs single-turn for the rest (all matches
    are single-pass); 4 of the paper's 6 Reflection review strategies
    (observation / simulation / recurrent / deep-verification); wet-lab
    verification; expert-in-the-loop; research-contact suggestions.
"""
from __future__ import annotations

import json

import wf_common as W

# A hypothesis now carries a STRUCTURED experimental protocol, not a one-line
# experiment string (adversary P1: the old `experiment` field was usually a
# restated title — "Proposed experiment. HAMG" — giving a scientist nothing to
# run). The five protocol fields force the model to commit to a design a
# reader can execute and, critically, to a FALSIFICATION criterion — the mark
# of a testable hypothesis. `experiment` stays as a one-line summary for
# backward-compatible pool serialization.
HYP_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["hypotheses"],
    "properties": {
        "hypotheses": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["title", "statement", "rationale", "experiment",
                             "design", "metric", "expected_effect", "falsification"],
                "properties": {
                    "title": {"type": "string"},
                    "statement": {"type": "string"},
                    "rationale": {"type": "string"},
                    "experiment": {"type": "string"},
                    "design": {"type": "string"},
                    "metric": {"type": "string"},
                    "expected_effect": {"type": "string"},
                    "falsification": {"type": "string"},
                },
            },
        },
    },
}

REVIEW_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["reviews"],
    "properties": {
        "reviews": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["id", "correctness", "novelty", "testability", "safety_ok", "critique"],
                "properties": {
                    "id": {"type": "number"},
                    "correctness": {"type": "number"},
                    "novelty": {"type": "number"},
                    "testability": {"type": "number"},
                    "safety_ok": {"type": "boolean"},
                    "critique": {"type": "string"},
                },
            },
        },
    },
}

RANK_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["matches"],
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["a", "b", "winner", "reason"],
                "properties": {
                    "a": {"type": "number"}, "b": {"type": "number"},
                    "winner": {"type": "number"},
                    "reason": {"type": "string"},
                },
            },
        },
    },
}

EVOLVE_SCHEMA = HYP_SCHEMA  # evolution + expansion return new/refined hypotheses

# ---- literature grounding (from deep-investigate's investigation object) -----

LIT_BASE_CODE = """
inv = (investigation or {})
findings = inv.get("answer_hypotheses") or []
ledger = inv.get("source_ledger") or []
open_q = inv.get("open_questions") or []
limitations = inv.get("limitations") or []
parts = []
if findings:
    parts.append("Grounded findings from the literature:")
    i = 0
    for f in findings:
        i = i + 1
        parts.append(str(i) + ". " + str(f))
if open_q:
    parts.append("")
    parts.append("Open questions / frontiers:")
    for q in open_q:
        parts.append("- " + str(q))
if limitations:
    parts.append("")
    parts.append("Known limitations in the current literature:")
    for l in limitations:
        parts.append("- " + str(l))
# Clean source ledger. deep-investigate's schema uses url_or_path / fetched /
# evidence_quality / relevance / rejected_reason (NOT url/takeaway) — read the
# real field names so URLs and notes are not silently dropped.
sources = []
if ledger:
    parts.append("")
    parts.append("Sources:")
    for s in ledger:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()
        url = str(s.get("url_or_path") or s.get("url") or "").strip()
        fetched = bool(s.get("fetched"))
        quality = str(s.get("evidence_quality") or "").strip()
        relevance = str(s.get("relevance") or "").strip()
        rejected = str(s.get("rejected_reason") or "").strip()
        take_bits = []
        if relevance:
            take_bits.append(relevance)
        if quality:
            take_bits.append("evidence: " + quality)
        if not fetched and rejected:
            take_bits.append("not fetched: " + rejected)
        take = "; ".join(take_bits)
        if title or url:
            sources.append({"title": title, "url": url, "fetched": fetched, "takeaway": take})
            mark = "" if fetched else " [unfetched]"
            parts.append("- " + title + " (" + url + ")" + mark + ": " + take)
# grounding_ok: did we actually gather real, FETCHED sources? Findings alone
# do NOT count — the investigation agent can return reasoning (or degenerate
# meta "sources" like a schema description) without searching, and that is
# exactly the ungrounded case we must not present as grounded. Require at
# least one fetched source with a real URL; otherwise warn loudly (#FALLBACK)
# so the operator knows the hypotheses are parametric, not literature-backed.
# A real fetched source must carry an http(s):// URL. The old gate accepted
# any non-"n/a" string, so a degenerate ledger entry (e.g. a lone
# "internal_agent_output" the investigation agent emits when it never
# searched) passed as grounded and the report shipped ungrounded with NO
# #FALLBACK (adversary P0, live report 1). Requiring a resolvable scheme
# makes grounding_ok mean what the reader assumes it means.
fetched_count = 0
for s in sources:
    u = str(s.get("url") or "").strip().lower()
    if s.get("fetched") and (u.startswith("http://") or u.startswith("https://")):
        fetched_count = fetched_count + 1
grounding_ok = fetched_count > 0
warnings = []
if not grounding_ok:
    warnings.append("#FALLBACK: literature grounding fetched 0 real sources this run (the investigation agent did not retrieve usable literature); the hypotheses below are the model's parametric reasoning, NOT grounded in fetched sources. Re-run for grounded output.")
# needs_retry drives the bounded one-shot grounding retry branch in the graph.
needs_retry = not grounding_ok
# Citation allowlist: the exact titles/URLs actually in the fetched ledger.
# Threaded into every generative prompt so the model cites ONLY grounded
# sources and never invents arXiv ids / vendor whitepapers (adversary P0:
# reports carried wrong Gato/DNC ids + fabricated NVIDIA/IBM/BostonDynamics
# "whitepapers"). Deterministic, not a prompt plea.
allowed = []
for s in sources:
    if not s.get("fetched"):
        continue
    u = str(s.get("url") or "").strip()
    if not (u.lower().startswith("http://") or u.lower().startswith("https://")):
        continue
    t = str(s.get("title") or "").strip()
    allowed.append((t + " <" + u + ">") if t else u)
if allowed:
    parts.append("")
    parts.append("CITATION RULE: cite ONLY sources from this fetched list; do NOT invent arXiv ids, DOIs, or vendor whitepapers. If a claim needs a source not listed here, state it as a general observation without a fake citation — and WITHOUT a venue-year attribution: never write '(NeurIPS 2020)' / '(ICLR 2022)' / 'Wang et al.' style references for works that are not in this list (those are unverifiable parametric recalls, the same defect as an invented id).")
    for a in allowed:
        parts.append("- " + a)
else:
    # Cycle-2 live defect: with an EMPTY allowlist the prompts carried no
    # citation rule at all, and the model name-dropped venues from parametric
    # memory ("TGAT (KDD 2020)" — wrong venue; TGAT was ICLR 2020). An empty
    # allowlist must ban named citations outright, not fall silent.
    parts.append("")
    parts.append("CITATION RULE: NO sources were fetched this run. You MUST NOT name or cite any specific paper, venue, year, arXiv id, DOI, or whitepaper anywhere in your output — every such attribution would be unverifiable parametric recall. Discuss prior work only as unattributed general knowledge (e.g. 'temporal graph attention methods', never 'TGAT (KDD 2020)').")
text = "\\n".join(parts).strip() or "(no literature grounding was gathered)"
return {"text": text, "sources": sources, "open_questions": open_q, "grounding_ok": grounding_ok, "warnings": warnings, "fetched_count": fetched_count, "allowed_citations": allowed, "needs_retry": needs_retry}
""".strip()

INIT_STATE_CODE = """
hyps = (generated or {}).get("hypotheses") or []
pool = []
def _defang_fals(f):
    # The honesty prompts demand HYPOTHESIZED framing on effect sizes; the
    # model sometimes splices the literal token INTO falsification criteria
    # ("auditability < HYPOTHESIZED 100%"), destroying the threshold text
    # (adversary N6). The criterion is a plain threshold — strip the token.
    f = str(f or "").strip()
    for tok in ("HYPOTHESIZED ", " HYPOTHESIZED", "HYPOTHESIZED"):
        f = f.replace(tok, " ")
    while "  " in f:
        f = f.replace("  ", " ")
    return f.strip()
for i, h in enumerate(hyps):
    if not isinstance(h, dict):
        continue
    pool.append({
        "id": i,
        "title": str(h.get("title") or "").strip(),
        "statement": str(h.get("statement") or "").strip(),
        "rationale": str(h.get("rationale") or "").strip(),
        "experiment": str(h.get("experiment") or "").strip(),
        "design": str(h.get("design") or "").strip(),
        "metric": str(h.get("metric") or "").strip(),
        "expected_effect": str(h.get("expected_effect") or "").strip(),
        "falsification": _defang_fals(h.get("falsification")),
        "elo": 1200.0,
        "reviews": {},
        "reviewed": False,
    })
return {
    "pool": pool,
    "cycle": 0,
    "next_id": len(pool),
    "literature": str(literature_text or "").strip(),
    "sources": sources or [],
    "open_questions": open_questions or [],
    "grounding_ok": bool(grounding_ok),
    "warnings": warnings or [],
    "feedback": "",
    "elo_history": [],
}
""".strip()

LOOP_COND_CODE = """
state = loop_state or {}
cycle = int(state.get("cycle", 0) or 0)
pool = state.get("pool") or []
max_c = max(1, int(max_cycles or 1))
return {"condition": cycle < max_c and len(pool) > 0, "cycle": cycle}
""".strip()

# TWO views of the pool. The DECORATED view (ids, Elo, [UNREVIEWED]) is what
# reflect/rank need — they must reference hypotheses by id and see standings.
# The CLEAN view carries only title/statement/rationale — it feeds
# evolve/expand/meta, which were echoing "(Elo 1224)"/"[UNREVIEWED]"/"[id]"
# decorations straight into reader-facing hypothesis titles and experiments
# (adversary P1/P2, both live reports). Generative stages must never see the
# bookkeeping.
POOL_TEXT_CODE = """
state = loop_state or {}
pool = state.get("pool") or []
ranked = sorted(pool, key=lambda h: -float(h.get("elo", 0)))
lines = []
clean = []
for h in ranked:
    tag = "" if h.get("reviewed") else " [UNREVIEWED]"
    lines.append("### [" + str(h.get("id")) + "] " + str(h.get("title") or "") + " (Elo " + str(int(h.get("elo", 0))) + ")" + tag)
    lines.append(str(h.get("statement") or ""))
    if h.get("rationale"):
        lines.append("Rationale: " + str(h.get("rationale")))
    lines.append("")
    clean.append("### " + str(h.get("title") or ""))
    clean.append(str(h.get("statement") or ""))
    if h.get("rationale"):
        clean.append("Rationale: " + str(h.get("rationale")))
    clean.append("")
return {"decorated": "\\n".join(lines), "clean": "\\n".join(clean), "text": "\\n".join(lines)}
""".strip()

CONTEXT_CODE = """
state = loop_state or {}
cycle = int(state.get("cycle", 0) or 0)
# Rotate the Evolution strategy per cycle instead of one blended prompt
# (adversary P1: the paper samples 6 DISTINCT strategies — grounding,
# combination, simplification, out-of-box, coherence, inspiration — and the
# ablation credits Evolution for a real quality gain; a single generic
# 'refine or combine' prompt collapses them).
strategies = [
    "COMBINATION: merge the complementary strengths of two top hypotheses into one stronger mechanism",
    "SIMPLIFICATION: strip a top hypothesis to its most testable core — fewer moving parts, a cleaner experiment, the same claim",
    "OUT-OF-BOX: take a top hypothesis's goal but reach it by a mechanism from a DIFFERENT paradigm than the pool uses",
    "GROUNDING+COHERENCE: fix the specific flaw a reviewer named and tighten the mechanism's internal consistency",
]
strategy = strategies[cycle % len(strategies)]
return {
    "literature": str(state.get("literature") or "").strip(),
    "feedback": str(state.get("feedback") or "").strip(),
    "open_questions": state.get("open_questions") or [],
    "strategy": strategy,
}
""".strip()

# Prioritized match set (Proximity/newness stand-in): pair newest with top,
# and top-with-top, so the tournament always compares the candidates whose
# ranking matters most this cycle.
RANK_PAIRS_CODE = """
state = loop_state or {}
pool = state.get("pool") or []
by_elo = sorted(pool, key=lambda h: -float(h.get("elo", 0)))
ids = [int(h.get("id")) for h in by_elo]
# newest = highest ids (added most recently)
newest = sorted([int(h.get("id")) for h in pool], key=lambda x: -x)[:3]
pairs = []
seen = set()
def _add(a, b):
    if a == b:
        return
    key = (a, b) if a < b else (b, a)
    if key in seen:
        return
    seen.add(key)
    pairs.append({"a": a, "b": b})
# top vs top
for i in range(len(ids)):
    for k in range(i + 1, min(i + 3, len(ids))):
        _add(ids[i], ids[k])
# newest vs top
for n in newest:
    for t in ids[:3]:
        _add(n, t)
lines = []
for p in pairs:
    lines.append("- compare [" + str(p["a"]) + "] vs [" + str(p["b"]) + "]")
return {"text": "\\n".join(lines), "count": len(pairs)}
""".strip()

# Fold: attach reviews, apply Elo, add evolved+expanded (deduped), aggregate
# meta-feedback for the next cycle, cap the pool.
FOLD_STATE_CODE = """
state = loop_state or {}
pool = {int(h["id"]): dict(h) for h in (state.get("pool") or []) if isinstance(h, dict)}
cycle = int(state.get("cycle", 0) or 0)
next_id = int(state.get("next_id", len(pool)) or len(pool))

review_list = ((reviews or {}).get("reviews") or [])
for r in review_list:
    if not isinstance(r, dict):
        continue
    hid = int(r.get("id", -1))
    if hid in pool:
        pool[hid]["reviews"] = {
            "correctness": r.get("correctness"),
            "novelty": r.get("novelty"),
            "testability": r.get("testability"),
            "safety_ok": r.get("safety_ok"),
            "critique": str(r.get("critique") or ""),
        }
        pool[hid]["reviewed"] = True

K = 32.0
match_list = ((matches or {}).get("matches") or [])
for m in match_list:
    if not isinstance(m, dict):
        continue
    a = int(m.get("a", -1)); b = int(m.get("b", -1)); w = int(m.get("winner", -1))
    if a not in pool or b not in pool or a == b:
        continue
    Ra = float(pool[a].get("elo", 1200.0)); Rb = float(pool[b].get("elo", 1200.0))
    Ea = 1.0 / (1.0 + (10.0 ** ((Rb - Ra) / 400.0)))
    Eb = 1.0 - Ea
    Sa = 1.0 if w == a else (0.5 if w not in (a, b) else 0.0)
    Sb = 1.0 - Sa
    pool[a]["elo"] = Ra + K * (Sa - Ea)
    pool[b]["elo"] = Rb + K * (Sb - Eb)

def _toks(h):
    text = (str(h.get("title") or "") + " " + str(h.get("statement") or "")).lower()
    out = set()
    word = ""
    for ch in text:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            word = word + ch
        else:
            if len(word) > 3:
                out.add(word)
            word = ""
    if len(word) > 3:
        out.add(word)
    return out

# Sanitizer belt (adversary P1/P2): even with the clean generative pool view,
# a model can echo bookkeeping decorations ("(Elo 1224)", "[UNREVIEWED]",
# "[UNEXPLORED]", a leading "[3]", "hypothesis [k]") into a new title or
# field. Strip them from EVERY incoming string field so no decoration or
# internal pool id ever reaches the reader.
def _scrub(s):
    t = str(s or "")
    out = ""
    i = 0
    n = len(t)
    while i < n:
        ch = t[i]
        if ch == "[":
            j = t.find("]", i)
            if 0 <= j <= i + 40:
                inner = t[i + 1:j].strip().lower()
                # drop bracket tags that are pure bookkeeping: bare ints,
                # UNREVIEWED/UNEXPLORED/UNSAFE, or 'hypothesis N'
                stripped = inner.replace("hypothesis", "").strip()
                if inner in ("unreviewed", "unexplored", "unsafe") or stripped.isdigit() or (inner.startswith("unexplored")):
                    i = j + 1
                    continue
        if ch == "(":
            j = t.find(")", i)
            if 0 <= j <= i + 30 and t[i + 1:j].strip().lower().startswith("elo"):
                i = j + 1
                continue
        out = out + ch
        i = i + 1
    # collapse doubled spaces the removals may leave, and any 'hypothesis'
    # left dangling before a now-removed id
    while "  " in out:
        out = out.replace("  ", " ")
    return out.strip(" -–—:").strip()

existing_tok = [_toks(h) for h in pool.values()]
# Normalized-title identity: two entries with the same title ARE the same
# hypothesis to any reader, even when a reworded statement drops the
# title+statement token-Jaccard below the overlap threshold (cycle-2 live
# defect: the final report carried "Entropy-Guided Meta-Consolidation" twice
# at ranks 3 and 4 — an evolved copy re-entered under its parent's title).
def _title_key(h):
    t = str((h or {}).get("title") or "").lower()
    out = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            out = out + ch
    return out
existing_titles = set()
for h in pool.values():
    tk = _title_key(h)
    if tk:
        existing_titles.add(tk)

def _max_overlap(cand_tok):
    best = 0.0
    for et in existing_tok:
        if not et or not cand_tok:
            continue
        inter = len(cand_tok & et)
        union = len(cand_tok | et)
        if union > 0:
            j = float(inter) / float(union)
            if j > best:
                best = j
    return best

elos = [float(h.get("elo", 1200.0)) for h in pool.values()] or [1200.0]
mean_elo = sum(elos) / len(elos)
dropped_dups = 0
# EVOLVED hypotheses are refinements of their parents — they SHOULD resemble
# them, so only near-identical restatements are dropped (0.80). EXPANDED
# hypotheses are meant to open new areas, so anything close to an existing one
# is a failed expansion and is dropped (0.45 — tightened from 0.6 after cycle 1
# let five "hybrid graph/vector routing" near-variants crowd the headline;
# expansions that merely reword an existing direction must be rejected).
labelled = []
for h in ((evolved or {}).get("hypotheses") or []):
    labelled.append((h, 0.80))
for h in ((expanded or {}).get("hypotheses") or []):
    labelled.append((h, 0.45))
for h, thresh in labelled:
    if not isinstance(h, dict):
        continue
    ct = _toks(h)
    tk = _title_key(h)
    if _max_overlap(ct) >= thresh or (tk and tk in existing_titles):
        dropped_dups = dropped_dups + 1
        continue
    existing_tok.append(ct)
    if tk:
        existing_titles.add(tk)
    pool[next_id] = {
        "id": next_id,
        "title": _scrub(h.get("title")),
        "statement": _scrub(h.get("statement")),
        "rationale": _scrub(h.get("rationale")),
        "experiment": _scrub(h.get("experiment")),
        "design": _scrub(h.get("design")),
        "metric": _scrub(h.get("metric")),
        "expected_effect": _scrub(h.get("expected_effect")),
        "falsification": _scrub(h.get("falsification")).replace("HYPOTHESIZED ", "").replace("HYPOTHESIZED", "").strip(),
        "elo": mean_elo + 15.0,
        "reviews": {},
        "reviewed": False,
    }
    next_id = next_id + 1

crits = []
for r in review_list:
    if isinstance(r, dict) and str(r.get("critique") or "").strip():
        crits.append(str(r.get("critique")).strip())
debate = []
for m in match_list:
    if isinstance(m, dict) and str(m.get("reason") or "").strip():
        debate.append(str(m.get("reason")).strip())
fb_parts = []
if crits:
    fb_parts.append("Recurring reviewer concerns from the last cycle (fix these):")
    for c in crits[:6]:
        fb_parts.append("- " + c[:400])
if debate:
    fb_parts.append("What won debates last cycle (favor these qualities):")
    for d in debate[:6]:
        fb_parts.append("- " + d[:300])
feedback = "\\n".join(fb_parts).strip()

ranked = sorted(pool.values(), key=lambda h: -float(h.get("elo", 0)))
cap = 8
ranked = ranked[:cap]
# Snapshot the tournament standing this cycle so the report can render the
# Elo-evolution figure (the paper's headline result is Elo rising over
# cycles; making it visible is the single highest-value figure). Records the
# cycle's best + top-3-mean over the capped pool.
top_elos = [float(h.get("elo", 0)) for h in ranked]
hist = list(state.get("elo_history") or [])
if top_elos:
    top3 = top_elos[:3]
    hist.append({
        "cycle": cycle + 1,
        "best": int(max(top_elos)),
        "top3_mean": int(sum(top3) / len(top3)),
        "pool": len(top_elos),
    })
return {
    "pool": ranked,
    "cycle": cycle + 1,
    "next_id": next_id,
    "literature": str(state.get("literature") or ""),
    "sources": state.get("sources") or [],
    "open_questions": state.get("open_questions") or [],
    "grounding_ok": bool(state.get("grounding_ok")),
    "warnings": state.get("warnings") or [],
    "feedback": feedback,
    "dropped_dups": dropped_dups,
    "elo_history": hist,
}
""".strip()

# Terminal fold: apply the full-review results + a final Elo pass. No new
# hypotheses, no cap-growth — this closes the pool so nothing is unreviewed.
TERM_FOLD_CODE = """
state = loop_state or {}
pool = {int(h["id"]): dict(h) for h in (state.get("pool") or []) if isinstance(h, dict)}

for r in ((reviews or {}).get("reviews") or []):
    if not isinstance(r, dict):
        continue
    hid = int(r.get("id", -1))
    if hid in pool:
        pool[hid]["reviews"] = {
            "correctness": r.get("correctness"),
            "novelty": r.get("novelty"),
            "testability": r.get("testability"),
            "safety_ok": r.get("safety_ok"),
            "critique": str(r.get("critique") or ""),
        }
        pool[hid]["reviewed"] = True

K = 32.0
for m in ((matches or {}).get("matches") or []):
    if not isinstance(m, dict):
        continue
    a = int(m.get("a", -1)); b = int(m.get("b", -1)); w = int(m.get("winner", -1))
    if a not in pool or b not in pool or a == b:
        continue
    Ra = float(pool[a].get("elo", 1200.0)); Rb = float(pool[b].get("elo", 1200.0))
    Ea = 1.0 / (1.0 + (10.0 ** ((Rb - Ra) / 400.0)))
    Eb = 1.0 - Ea
    Sa = 1.0 if w == a else (0.5 if w not in (a, b) else 0.0)
    Sb = 1.0 - Sa
    pool[a]["elo"] = Ra + K * (Sa - Ea)
    pool[b]["elo"] = Rb + K * (Sb - Eb)

ranked = sorted(pool.values(), key=lambda h: -float(h.get("elo", 0)))
# Snapshot the final (post-full-review) standing as the last history point.
top_elos = [float(h.get("elo", 0)) for h in ranked]
hist = list(state.get("elo_history") or [])
if top_elos:
    top3 = top_elos[:3]
    hist.append({
        "cycle": int(state.get("cycle", 0) or 0),
        "best": int(max(top_elos)),
        "top3_mean": int(sum(top3) / len(top3)),
        "pool": len(top_elos),
        "final": True,
    })
return {
    "pool": ranked,
    "cycle": int(state.get("cycle", 0) or 0),
    "next_id": int(state.get("next_id", len(pool)) or len(pool)),
    "literature": str(state.get("literature") or ""),
    "sources": state.get("sources") or [],
    "open_questions": state.get("open_questions") or [],
    "grounding_ok": bool(state.get("grounding_ok")),
    "warnings": state.get("warnings") or [],
    "feedback": str(state.get("feedback") or ""),
    "elo_history": hist,
}
""".strip()

FINAL_CODE = """
state = loop_state or {}
pool = state.get("pool") or []
# Correctness-floor gate (structural, not prompt-deep): a hypothesis that a
# reviewer scored unsound (correctness < 5) or that was never reviewed cannot
# hold the headline slot, no matter how many debates its ambition won. This
# fixes the observed failure where the Elo tournament crowned a correctness-4,
# novelty-9 hypothesis. Elo still orders within each tier — we only demote
# unsound/unreviewed candidates BELOW sound ones, we do not distort the Elo.
CORRECTNESS_FLOOR = 5.0
# Novelty floor: the paper's entire purpose is surfacing NOVEL hypotheses, but
# the plausibility-first debate crowned a reviewer-declared non-novel idea #1
# (adversary P1: TAEW, novelty 4, "already explored in DynaKG/TG-GAT"). A
# reviewed-sound-but-non-novel hypothesis is demoted BELOW novel sound ones
# (still above unsound/unreviewed) — Elo still orders within each tier; we
# never delete, only reorder so the headline is a novel, sound idea.
NOVELTY_FLOOR = 4.0
def _score_val(h, key):
    rv = h.get("reviews") or {}
    v = rv.get(key)
    if isinstance(v, bool):
        return None
    if isinstance(v, int) or isinstance(v, float):
        return float(v)
    return None
def _corr_val(h):
    return _score_val(h, "correctness")
def _unsafe(h):
    # Only a reviewed, explicit False counts as unsafe (unreviewed/None is not).
    rv = h.get("reviews") or {}
    return bool(h.get("reviewed")) and (rv.get("safety_ok") is False)
def _sort_key(h):
    corr_v = _corr_val(h)
    nov_v = _score_val(h, "novelty")
    reviewed = bool(h.get("reviewed")) and corr_v is not None
    # tier 0 = reviewed, safe, sound, NOVEL; 1 = reviewed, safe, sound but
    # non-novel; 2 = reviewed, safe, unsound; 3 = unreviewed; 4 = unsafe.
    if _unsafe(h):
        tier = 4
    elif not reviewed:
        tier = 3
    elif corr_v < CORRECTNESS_FLOOR:
        tier = 2
    elif nov_v is not None and nov_v < NOVELTY_FLOOR:
        tier = 1
    else:
        tier = 0
    return (tier, -float(h.get("elo", 0)))
ranked = sorted(pool, key=_sort_key)
# Identical-title collapse (cycle-2 live defect): the fold's dedup can still
# let two entries with the SAME title coexist (older pools, or a reworded
# statement dropping token overlap below threshold). A reader sees one
# hypothesis listed twice — collapse to the best-ranked copy, never cap-at-2.
def _title_key(h):
    t = str((h or {}).get("title") or "").lower()
    out = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            out = out + ch
    return out
_seen_titles = set()
_collapsed = []
title_dups_dropped = 0
for h in ranked:
    tk = _title_key(h)
    if tk and tk in _seen_titles:
        title_dups_dropped = title_dups_dropped + 1
        continue
    if tk:
        _seen_titles.add(tk)
    _collapsed.append(h)
ranked = _collapsed
# NEAR-identical title collapse (adversary find, live report: "Hybrid
# Vector-Graph Retrieval (HVGR)" held ranks 2 AND 8 beside "... for
# Consistency (HVGR)" — same idea, one qualifier apart; exact-key collapse
# missed it). Predicate: CONTAINMENT of the smaller title's tokens in the
# larger >= 0.75 (min 3 tokens) — a qualifier ADDS tokens but the base title
# stays contained (HVGR pair = 1.0), while distinct ideas sharing words stay
# far below (TAG-MG vs temporal-edge-gating = 0.4; uncertainty-pruning pair
# = 0.43). Keep the best-ranked copy.
def _title_toks(h):
    t = str((h or {}).get("title") or "").lower()
    outw = set()
    w = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            w = w + ch
        else:
            if len(w) > 2:
                outw.add(w)
            w = ""
    if len(w) > 2:
        outw.add(w)
    return outw
_kept = []
_kept_toks = []
for h in ranked:
    ht = _title_toks(h)
    dup = False
    for pt in _kept_toks:
        smaller = min(len(ht), len(pt))
        if smaller >= 3:
            contain = float(len(ht & pt)) / float(smaller)
            if contain >= 0.75:
                dup = True
                break
    if dup:
        title_dups_dropped = title_dups_dropped + 1
        continue
    _kept.append(h)
    _kept_toks.append(ht)
ranked = _kept
# Diversity de-crowding (MMR-style, adversary P1): the top was four flavors of
# one idea (temporal-decay + meta-refresh variants). Within the SAME tier,
# once a hypothesis is placed, penalize the next candidate that is a
# near-sibling (high title+statement token overlap) so distinct directions
# surface. Tier order is never violated — only intra-tier neighbors reorder.
def _toks(h):
    t = (str(h.get("title") or "") + " " + str(h.get("statement") or "")).lower()
    out = set()
    w = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            w = w + ch
        else:
            if len(w) > 3:
                out.add(w)
            w = ""
    if len(w) > 3:
        out.add(w)
    return out
def _overlap(x, y):
    if not x or not y:
        return 0.0
    inter = len(x & y)
    union = len(x | y)
    return float(inter) / float(union) if union else 0.0
_remaining = list(ranked)
_diverse = []
_picked_toks = []
_SIB = 0.5   # token-overlap >= this = same theme/cluster
_CLUSTER_CAP = 2  # at most this many near-siblings before the rest are held back
while _remaining:
    best_i = 0
    best_penalized = None
    for i, h in enumerate(_remaining):
        tier = _sort_key(h)[0]
        ct = _toks(h)
        sim = 0.0
        siblings = 0
        for pt, ptier in _picked_toks:
            o = _overlap(ct, pt)
            if ptier == tier and o > sim:
                sim = o
            if o >= _SIB:
                siblings = siblings + 1
        # A hard cluster cap: once _CLUSTER_CAP near-siblings are already
        # placed, further members of that theme get a large rank penalty so a
        # distinct direction surfaces first (cycle-1 fix: five routing variants
        # held ranks 1-5). Below the cap, a softer 200-Elo similarity penalty
        # still favors variety. Tier is never violated.
        over_cap = siblings >= _CLUSTER_CAP
        pen = (100000.0 if over_cap else sim * 200.0)
        penalized = (tier, -(float(h.get("elo", 0)) - pen))
        if best_penalized is None or penalized < best_penalized:
            best_penalized = penalized
            best_i = i
    chosen = _remaining.pop(best_i)
    # Visible-honesty annotation (adversary: "de-crowding is explained
    # generically, never locally"): a placed hypothesis that is a near-variant
    # (>= _SIB overlap) of an already-placed same-tier one carries a 'sibling'
    # flag so the reader sees WHY rank order and Elo order can diverge.
    c_toks = _toks(chosen)
    c_tier = _sort_key(chosen)[0]
    for pt, ptier in _picked_toks:
        if ptier == c_tier and _overlap(c_toks, pt) >= _SIB:
            chosen["_sibling"] = True
            break
    _diverse.append(chosen)
    _picked_toks.append((c_toks, c_tier))
ranked = _diverse
# Local rank-vs-Elo honesty (adversary: "the report says higher Elo ranks
# higher, then violates it without a word"): any row whose Elo EXCEEDS an
# earlier same-tier row was reordered by de-crowding — flag it 'de-crowded'
# so the divergence is explained on the row where the reader sees it.
_seen_by_tier = {}
for h in ranked:
    t = _sort_key(h)[0]
    e = float(h.get("elo", 0))
    prev = _seen_by_tier.get(t)
    if prev is not None and e > prev:
        h["_decrowded"] = True
    if prev is None or e < prev:
        _seen_by_tier[t] = e
out = []
for rank, h in enumerate(ranked, 1):
    corr_v = _corr_val(h)
    nov_v = _score_val(h, "novelty")
    flags = []
    if _unsafe(h):
        flags.append("unsafe")
    if not bool(h.get("reviewed")):
        flags.append("unreviewed")
    elif corr_v is not None and corr_v < CORRECTNESS_FLOOR:
        flags.append("low_correctness")
    elif nov_v is not None and nov_v < NOVELTY_FLOOR:
        flags.append("low_novelty")
    if h.get("_sibling"):
        flags.append("sibling")
    if h.get("_decrowded") and "sibling" not in flags:
        flags.append("de-crowded")
    out.append({
        "rank": rank,
        "elo": int(float(h.get("elo", 0))),
        "reviewed": bool(h.get("reviewed")),
        "flags": flags,
        "title": h.get("title"),
        "statement": h.get("statement"),
        "rationale": h.get("rationale"),
        "experiment": h.get("experiment"),
        "design": h.get("design"),
        "metric": h.get("metric"),
        "expected_effect": h.get("expected_effect"),
        "falsification": h.get("falsification"),
        "reviews": h.get("reviews") or {},
    })
warnings = list(state.get("warnings") or [])
unreviewed = 0
unsafe = 0
for h in out:
    if not h.get("reviewed"):
        unreviewed = unreviewed + 1
    if "unsafe" in (h.get("flags") or []):
        unsafe = unsafe + 1
if unreviewed > 0:
    warnings.append("#FALLBACK: " + str(unreviewed) + " finalist(s) reached the ranking without a completed review; flagged 'unreviewed' and demoted below reviewed hypotheses.")
if unsafe > 0:
    warnings.append("#FALLBACK: " + str(unsafe) + " hypothesis(es) were flagged unsafe by the reviewer; flagged 'unsafe' and demoted below all safe hypotheses — do not action without human safety review.")
return {
    "ranked_hypotheses": out,
    "top": out[0] if out else {},
    "cycles": int(state.get("cycle", 0) or 0),
    "pool_size": len(out),
    "sources": state.get("sources") or [],
    "literature": str(state.get("literature") or ""),
    "grounding_ok": bool(state.get("grounding_ok")),
    "warnings": warnings,
    "elo_history": state.get("elo_history") or [],
}
""".strip()

# ---- prompt composers (code nodes) ----------------------------------------

# deep-plan takes the raw research question and returns a structured research
# plan (sub-questions). The plan is what deep-investigate needs to organize its
# findings into a real source ledger — driving deep-investigate WITHOUT a plan
# (the earlier bare call) made the agent search real sources but then collapse
# its structured source_ledger to a single junk entry. deep-research always
# feeds the plan; co-scientist now does too.
PLAN_INPUT_CODE = """
return {
    "request": str(research_goal or "").strip(),
    "effort": str(effort or "standard"),
    "provider": provider,
    "model": model,
}
""".strip()

# deep-investigate input: the raw request + the plan from deep-plan + a single
# round of context (round_index 0 of 1), matching how deep-research drives it.
GROUND_INPUT_CODE = """
# adversarial_review is deep-investigate's own channel for reviewer guidance
# (its researcher prompt says "use the latest adversarial_review input").
# Live failure (cycle-2 run, 2026-07-19): the agent ran 8 web searches but
# returned an EMPTY source_ledger — searches happened, ledger discipline
# failed, and the whole report shipped on the honest-but-degraded 0-source
# path. Feed the ledger requirement through the channel the subflow already
# reads instead of hoping the default prompt is enough.
return {
    "request": str(research_goal or "").strip(),
    "effort": str(effort or "standard"),
    "provider": provider,
    "model": model,
    "plan": plan,
    "adversarial_review": {
        "verdict": "guidance",
        "guidance": [
            "MANDATORY LEDGER DISCIPLINE: every source you search/fetch/skim MUST be recorded as a source_ledger entry with url_or_path (the real http(s) URL), title, fetched (true only if you actually retrieved it), evidence_quality, and relevance.",
            "An investigation that returns an EMPTY source_ledger is a FAILED investigation, regardless of how good the findings prose is — the downstream consumer discards ungrounded findings.",
            "Prefer 5-12 real fetched sources over broad unfetched search-result listings.",
            # 0.1.10 verification run: the agent burned its whole iteration
            # budget on search/fetch and the forced final answer came back
            # empty — teach budget reservation explicitly.
            "BUDGET RULE: you have a hard iteration budget. STOP gathering with at least 2 rounds to spare and spend them composing the final structured answer. A complete answer with 4 fetched ledger entries beats an empty answer after 8 searches.",
        ],
    },
    "round_index": 0,
    "total_rounds": 1,
}
""".strip()

# Retry-once grounding input: same request, but the retry builds ON the first
# attempt (prior_investigation), leads with the failure fact, and ESCALATES
# effort to "thorough" (10 agent iterations vs standard's 6 — the observed
# failure burned all 6 on gathering and had none left to compose the answer).
# One bounded retry only — two consecutive live runs returned 0 sources
# through two DIFFERENT failure shapes (empty ledger with findings prose;
# empty forced final at max_iterations), so grounding needs a second chance
# with more room, not hope.
GROUND_RETRY_INPUT_CODE = """
return {
    "request": str(research_goal or "").strip(),
    "effort": "thorough",
    "provider": provider,
    "model": model,
    "plan": plan,
    "prior_investigation": prior_investigation or {},
    "adversarial_review": {
        "verdict": "retry",
        "guidance": [
            "THE PREVIOUS INVESTIGATION FAILED: it returned an EMPTY source_ledger. Your PRIMARY deliverable this pass is the source_ledger itself.",
            "Fetch 4-8 real sources (http(s) URLs), record EACH as a ledger entry the moment you retrieve it, and reserve your last 2 rounds for composing the final structured answer.",
            "STOP gathering after at most 6 tool rounds and write the final structured answer — an incomplete-but-recorded ledger beats another empty answer.",
        ],
    },
    "round_index": 1,
    "total_rounds": 2,
}
""".strip()

# Pick the grounded attempt. Prefer the first (no retry ran, or it succeeded);
# else the retry if IT succeeded; else keep the first's honest 0-source
# warnings (plus the retry-also-failed fact). Deterministic, label-honest.
LIT_PICK_CODE = """
a = first or {}
b = second or {}
if a.get("grounding_ok"):
    return a
if b.get("grounding_ok"):
    out = dict(b)
    out["warnings"] = ["#FALLBACK: the first literature investigation returned 0 fetched sources; a bounded retry succeeded — grounding below comes from the retry pass."] + list(b.get("warnings") or [])
    return out
out = dict(a)
warns = list(a.get("warnings") or [])
warns.append("#FALLBACK: the bounded grounding retry ALSO returned 0 fetched sources; proceeding ungrounded.")
out["warnings"] = warns
return out
""".strip()

# ---- deterministic citation verification (adversary P0, 2026-07-19) --------
#
# The citation ALLOWLIST constrains the writer to the ledger, but nothing
# verified the LEDGER: the investigation agent asserted `fetched: true` on a
# wrong title<->id pairing and the report laundered it ("Concrete Problems in
# AI Safety" pointing at arXiv 1905.11946 — which serves EfficientNet — cited
# eight times). Fix: FETCH every ledger URL deterministically (call_tool
# fetch_url in a foreach) and token-compare the served title against the
# claimed title. arXiv abs pages are strict (their <title> IS "[id] Real
# Title"); other pages verify loosely (marketing titles are noisy). Sources
# that fail resolve or mismatch are DROPPED from the citable set and labeled
# in the report — never silently kept.

CITE_ITEMS_CODE = """
src = (lit or {}).get("sources") or []
items = []
for s in src:
    if not isinstance(s, dict):
        continue
    u = str(s.get("url") or "").strip()
    if s.get("fetched") and (u.lower().startswith("http://") or u.lower().startswith("https://")):
        items.append({"url": u, "title": str(s.get("title") or "").strip()})
# EVERY fetched source is verified — no budget cap (operator ruling
# 2026-07-21: "we must be thorough"; a cap-overflow caveat in a delivered
# report should never happen). The list is already bounded upstream by the
# investigation's own iteration budget, so the loop cannot run away.
return {"items": items, "count": len(items)}
""".strip()

CITE_ARGS_CODE = """
it = item if isinstance(item, dict) else {}
u = str(it.get("url") or "").strip()
# arXiv PDFs serve no usable <title>; the abs page's title IS "[id] Real
# Title" — normalize so the strict check has something to check.
low = u.lower()
if "arxiv.org/pdf/" in low:
    u = u.replace("/pdf/", "/abs/")
    if u.lower().endswith(".pdf"):
        u = u[:-4]
return {"tool_call": {"name": "fetch_url", "arguments": {"url": u, "include_full_content": False, "keep_links": False}}}
""".strip()

CITE_FOLD_CODE = """
# One verdict per source: verified | unverified | mismatch | unreachable.
# raw is the UNMAPPED call_tool outcome ({mode, results:[{success, output}]});
# output arrives as a dict OR a JSON string depending on the tool executor —
# no json module in the sandbox, so string outputs get field-extracted.
it = item if isinstance(item, dict) else {}
url = str(it.get("url") or "").strip()
claimed = str(it.get("title") or "").strip()
r = raw if isinstance(raw, dict) else {}
results = r.get("results")
first = results[0] if isinstance(results, list) and results else None
first = first if isinstance(first, dict) else {}
out = first.get("output")
success = bool(first.get("success"))
status = None
fetched_title = ""
desc = ""
def _sfield(s, key):
    marker = '"' + key + '"'
    i = s.find(marker)
    if i < 0:
        return None
    j = s.find(":", i + len(marker))
    if j < 0:
        return None
    k = j + 1
    while k < len(s) and s[k] == " ":
        k = k + 1
    if k >= len(s):
        return None
    if s[k] == '"':
        k = k + 1
        buf = ""
        while k < len(s):
            ch = s[k]
            if ch == "\\\\" and k + 1 < len(s):
                buf = buf + s[k + 1]
                k = k + 2
                continue
            if ch == '"':
                break
            buf = buf + ch
            k = k + 1
        return buf
    # bare literal (number / true / false / null)
    buf = ""
    while k < len(s) and s[k] not in ",}":
        buf = buf + s[k]
        k = k + 1
    return buf.strip()
if isinstance(out, dict):
    if out.get("success") is False:
        success = False
    status = out.get("status_code")
    fetched_title = str(out.get("title") or "")
    desc = str(out.get("description") or "")
elif isinstance(out, str):
    ok_lit = _sfield(out, "success")
    if isinstance(ok_lit, str) and ok_lit.lower().startswith("false"):
        success = False
    st = _sfield(out, "status_code")
    if isinstance(st, str) and st.isdigit():
        status = int(st)
    fetched_title = str(_sfield(out, "title") or "")
    desc = str(_sfield(out, "description") or "")
else:
    success = False
def _tok(t):
    t = str(t or "").lower()
    outw = set()
    w = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            w = w + ch
        else:
            if len(w) > 2:
                outw.add(w)
            w = ""
    if len(w) > 2:
        outw.add(w)
    return outw
ct = _tok(claimed)
ft = _tok(fetched_title + " " + desc)
contain = (float(len(ct & ft)) / float(len(ct))) if ct else 0.0
is_arxiv = "arxiv.org" in url.lower()
try:
    status_num = int(status) if status is not None else None
except Exception:
    status_num = None
if (not success) or (status_num is not None and status_num >= 400):
    verdict = "unreachable"
    reason = "URL did not resolve (status " + str(status_num) + ")" if status_num else "fetch failed"
elif not ct:
    verdict = "unverified"
    reason = "no claimed title to compare"
elif is_arxiv:
    # Strict: an arXiv abs <title> carries the real paper title — a wrong id
    # shows ZERO overlap with the claimed title (the EfficientNet case).
    if contain >= 0.5:
        verdict = "verified"
        reason = "arXiv title matches"
    else:
        verdict = "mismatch"
        reason = 'claimed "' + claimed[:60] + '" but the arXiv id serves "' + (fetched_title[:80] or '?') + '"'
else:
    if contain >= 0.34:
        verdict = "verified"
        reason = "page title matches"
    elif fetched_title and contain == 0.0:
        verdict = "mismatch"
        reason = 'claimed "' + claimed[:60] + '" but the page serves "' + fetched_title[:80] + '"'
    else:
        verdict = "unverified"
        reason = "page title too generic to confirm (kept, labeled)"
new_acc = list(acc or [])
new_acc.append({"url": url, "claimed": claimed, "fetched_title": fetched_title, "verdict": verdict, "reason": reason})
return {"acc": new_acc}
""".strip()

CITE_RESET_CODE = """
return {"empty": []}
""".strip()

CITE_APPLY_CODE = """
l = dict(lit or {})
cl = checks or []
by_url = {}
for c in cl:
    if isinstance(c, dict) and c.get("url"):
        by_url[str(c.get("url"))] = c
new_sources = []
dropped = []
kept_allow = []
for s in (l.get("sources") or []):
    if not isinstance(s, dict):
        new_sources.append(s)
        continue
    s2 = dict(s)
    c = by_url.get(str(s.get("url") or "").strip())
    if c and s2.get("fetched"):
        v = str(c.get("verdict") or "")
        s2["verification"] = v
        if v in ("mismatch", "unreachable"):
            s2["fetched"] = False
            s2["takeaway"] = (str(s2.get("takeaway") or "") + " [citation check FAILED: " + str(c.get("reason") or v) + "]").strip(" ;")
            dropped.append({"title": str(s2.get("title") or ""), "url": str(s2.get("url") or ""), "reason": str(c.get("reason") or v)})
        else:
            t = str(s2.get("title") or "").strip()
            u = str(s2.get("url") or "").strip()
            kept_allow.append((t + " <" + u + ">") if t else u)
    new_sources.append(s2)
fetched_count = 0
for s in new_sources:
    if isinstance(s, dict) and s.get("fetched"):
        u = str(s.get("url") or "").lower()
        if u.startswith("http://") or u.startswith("https://"):
            fetched_count = fetched_count + 1
warns = list(l.get("warnings") or [])
for d in dropped:
    warns.append('#FALLBACK: ledger citation check DROPPED "' + d["title"][:70] + '" — ' + d["reason"])
parts = [str(l.get("text") or "")]
# Only claim verification when at least one URL was actually checked: on a
# zero-source run the loop body never executes and an unconditional
# "every ledger URL was fetched and title-checked" header would be a
# vacuous-truth honesty defect in the very text that teaches the model
# citation discipline (adversary 2026-07-20).
ver_lines = []
for s in new_sources:
    if not isinstance(s, dict):
        continue
    v = str(s.get("verification") or "")
    if not v:
        continue
    ver_lines.append("- [" + v.upper() + "] " + str(s.get("title") or "") + " <" + str(s.get("url") or "") + ">")
if ver_lines:
    parts.append("")
    parts.append("CITATION VERIFICATION (ledger URLs were fetched and title-checked deterministically):")
    for vl in ver_lines:
        parts.append(vl)
# Coverage integrity (operator ruling 2026-07-21: EVERY fetched source is
# verified — the budget cap is gone). This counter is a defensive anomaly
# check only: with full coverage it must be 0; if a fetched source ever
# slips through without a verdict (loop anomaly), say so honestly instead
# of implying coverage.
unchecked = 0
for s in new_sources:
    if not isinstance(s, dict) or not s.get("fetched") or s.get("verification"):
        continue
    u = str(s.get("url") or "").lower()
    if u.startswith("http://") or u.startswith("https://"):
        unchecked = unchecked + 1
if unchecked > 0 and ver_lines:
    parts.append("NOTE: " + str(unchecked) + " fetched source(s) unexpectedly missed title verification; treat their titles as claimed, not confirmed.")
    warns.append("#FALLBACK: " + str(unchecked) + " fetched source(s) unexpectedly missed citation verification (anomaly — coverage should be total).")
if dropped:
    parts.append("")
    parts.append("REVISED CITATION RULE: the sources marked MISMATCH/UNREACHABLE above FAILED verification and MUST NOT be cited anywhere in your output — not by title, id, or url. Cite only the VERIFIED/UNVERIFIED-kept sources.")
if fetched_count == 0 and ver_lines:
    # Only when verification actually ran and eliminated everything: on a
    # run that fetched nothing to begin with, lit_base already appended the
    # no-citation ban and the #FALLBACK ungrounded warning — repeating them
    # here with "after verification" wording would misdescribe what happened.
    parts.append("")
    parts.append("CITATION RULE: after verification, NO citable sources remain. You MUST NOT name or cite any specific paper, venue, year, arXiv id, DOI, or whitepaper anywhere in your output; discuss prior work only as unattributed general knowledge.")
    warns.append("#FALLBACK: citation verification left 0 citable sources; the report proceeds ungrounded.")
l["sources"] = new_sources
l["text"] = "\\n".join(parts)
l["warnings"] = warns
l["fetched_count"] = fetched_count
l["grounding_ok"] = fetched_count > 0
l["allowed_citations"] = kept_allow
l["citations_verified"] = True
return l
""".strip()

GENERATE_PROMPT = """
goal = str(research_goal or "").strip()
n = int(num_hypotheses or 5)
lit = str(literature or "").strip()
base = "You are the Generation agent of an AI co-scientist. GROUND your reasoning in the literature base below, then propose " + str(n) + " NOVEL, plausible, testable research hypotheses that go BEYOND what the literature already establishes. Each hypothesis must be a DISTINCT direction — do not propose several variants of the same mechanism. For EACH hypothesis return these fields, and DO NOT restate the title in any other field: title (the mechanism's name); statement (the claim); rationale (connect to the literature — what specific gap it fills); experiment (a one-line summary of the test); design (the experimental SETUP — what system you build, the named baseline(s) you compare against, the ablation(s), and a NAMED dataset or benchmark; NOT the mechanism name again); metric (the exact quantity measured and how it is computed); expected_effect (the HYPOTHESIZED direction/magnitude to be tested); falsification (the concrete result that would REFUTE the hypothesis, with a threshold). FALSIFICATION FORM: the falsification threshold must use the SAME metric and the SAME direction as the expected effect and leave no unadjudicated gap (expected '>= +10%' pairs with falsified 'below +10%', never 'below +3%'); no vague words ('negligible'), no template tokens. EVIDENCE VERBS: only works in the citation list may take 'shows/demonstrates/reports'; anything else — including other hypotheses — takes 'proposes/suggests/hypothesizes'. DATASETS: name only datasets/benchmarks/baselines that exist in the literature base or are broadly standard (MS-COCO, Natural Questions class); if none fits, describe the data to COLLECT instead of inventing a named benchmark. Favor mechanistic specificity and originality over restating known results. IMPORTANT: you have run no experiments — phrase any quantitative target as a HYPOTHESIZED/EXPECTED outcome (e.g. 'we predict up to ~X%'), never as a measured result. Cite only sources present in the literature base's citation list; never invent an arXiv id, DOI, or vendor whitepaper."
parts = [base, "", "## Research goal", goal]
if lit:
    parts += ["", "## Literature base (ground your hypotheses here)", lit]
return "\\n".join(parts)
""".strip()

REFLECT_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
lit = str(literature or "").strip()
feedback = str(feedback or "").strip()
parts = ["You are the Reflection agent (a rigorous virtual scientific peer reviewer). For EACH hypothesis below, score correctness (plausibility/soundness), novelty, and testability from 0-10, set safety_ok, and give a one-paragraph critique. Judge novelty AND correctness AGAINST the literature base — name the weak assumption, or the prior work that undercuts novelty. Correctness (is the mechanism sound and not already refuted?) matters as much as novelty; do not reward ungrounded ambition."]
if feedback:
    parts += ["", "## Feedback from prior cycles (address these recurring concerns)", feedback]
parts += ["", "## Research goal", goal]
if lit:
    parts += ["", "## Literature base", lit]
parts += ["", "## Current hypotheses", pool_text]
return "\\n".join(parts)
""".strip()

RANK_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
pairs = str(pairs or "").strip()
feedback = str(feedback or "").strip()
parts = ["You are the Ranking agent running an Elo tournament via simulated scientific debate. Hold a brief scientific debate for EACH of the prioritized pairs listed below and output the winner id with a one-line reason naming the deciding quality. Rank on PLAUSIBILITY/correctness first, then testability, then novelty — a bold but unsound hypothesis should lose to a sound, testable one. You may add a few more comparisons among the strongest candidates if useful."]
if feedback:
    parts += ["", "## Feedback from prior cycles (weigh these qualities)", feedback]
parts += ["", "## Research goal", goal, "", "## Prioritized pairs to debate", pairs, "", "## Hypotheses (id, title, current Elo)", pool_text]
return "\\n".join(parts)
""".strip()

EVOLVE_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
lit = str(literature or "").strip()
feedback = str(feedback or "").strip()
strategy = str(strategy or "").strip() or "refine or combine"
parts = ["You are the Evolution agent. Apply THIS cycle's strategy — " + strategy + " — to the TOP hypotheses below to produce 1-2 genuinely IMPROVED hypotheses (not restatements or near-duplicates). An evolved hypothesis must carry a NEW title naming ITS OWN mechanism — never the parent's title with a qualifier. Return the FULL structured form for each: title, statement, rationale, experiment (one-line), and the protocol fields design, metric, expected_effect, falsification (falsification uses the SAME metric/direction as expected_effect with no unadjudicated gap; no vague thresholds). EVIDENCE VERBS: only works in the literature base's citation list may take 'shows/demonstrates/reports'; other hypotheses in this pool take 'proposes/suggests'. Phrase quantitative targets as HYPOTHESIZED/EXPECTED, never as measured results; do not invent precise numbers, benchmark names, or citations not in the literature base."]
if feedback:
    parts += ["", "## Feedback from prior cycles (fix these specific flaws)", feedback]
parts += ["", "## Research goal", goal]
if lit:
    parts += ["", "## Literature base", lit]
parts += ["", "## Current top hypotheses", pool_text]
return "\\n".join(parts)
""".strip()

EXPAND_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
lit = str(literature or "").strip()
oq = open_questions or []
feedback = str(feedback or "").strip()
parts = ["You are the Generation agent in RESEARCH-EXPANSION mode. Review the hypotheses ALREADY in the pool below and propose 1-2 NOVEL hypotheses in UNEXPLORED areas that the current pool does NOT cover — open a new direction, do not refine an existing one. Ground each in the literature; cite only sources in the literature base; return the FULL structured form (title, statement, rationale, experiment, design, metric, expected_effect, falsification — falsification uses the SAME metric/direction as expected_effect with no unadjudicated gap, no vague thresholds). EVIDENCE VERBS: only cited literature-base works take 'shows/demonstrates'; pool hypotheses take 'proposes/suggests'. Do not invent named benchmarks."]
if feedback:
    parts += ["", "## Recurring issues future hypotheses must address (from prior cycles)", feedback]
if oq:
    parts += ["", "## Open questions from the literature (good sources of unexplored directions)"]
    for q in oq[:6]:
        parts.append("- " + str(q))
parts += ["", "## Research goal", goal]
if lit:
    parts += ["", "## Literature base", lit]
parts += ["", "## Hypotheses already covered (do NOT duplicate these areas)", pool_text]
return "\\n".join(parts)
""".strip()

TERM_REFLECT_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
parts = ["You are the Reflection agent performing a FULL, deeply-grounded review of the FINALIST hypotheses. Use the read-only web tools to search the current literature and verify each hypothesis. Run a DEEP-VERIFICATION review: for each hypothesis, mentally decompose it into its core assumptions and sub-assumptions, and check each independently — a hypothesis is only as sound as its weakest load-bearing assumption. Verify NOVELTY (search: is it already published?) and CORRECTNESS (is every assumption sound, or does one rest on a refuted or unsupported premise?). For EACH hypothesis, score correctness (driven by the weakest assumption you found), novelty, testability (0-10), set safety_ok, and give a critique that (a) NAMES the weakest assumption and whether it holds, and (b) CITES what you found in the literature (or confirms you could not find prior art, supporting novelty). Be skeptical: down-score hypotheses that duplicate existing work or rest on an invalidating assumption. Never fabricate a citation — cite only what you actually retrieved.", "", "## Research goal", goal, "", "## Finalist hypotheses to verify", pool_text]
return "\\n".join(parts)
""".strip()

TERM_RANK_PROMPT = """
goal = str(research_goal or "").strip()
pool_text = str(pool_text or "").strip()
parts = ["You are the Ranking agent holding the FINAL Elo tournament over the finalist hypotheses. For each meaningful pair among the finalists, hold a scientific debate and output the winner id with a one-line reason. Rank on plausibility/correctness first, then testability, then novelty.", "", "## Research goal", goal, "", "## Finalist hypotheses (id, title, Elo, reviews)", pool_text]
return "\\n".join(parts)
""".strip()

META_PROMPT = """
goal = str(research_goal or "").strip()
ranked = (final or {}).get("ranked_hypotheses") or []
lit = str((final or {}).get("literature") or "").strip()
grounded = bool((final or {}).get("grounding_ok"))
top = ranked[:5]
parts = ["You are the Meta-review agent. Synthesize the top-ranked hypotheses below into a rigorous research overview for a scientist: the most promising directions and WHY they rank highly (reference their reviews), how they relate to the current literature, the key open questions, and concrete suggested next experiments. START YOUR RESPONSE with exactly these two elements before anything else: FIRST LINE 'TITLE: <a concise professional report title you derive from the FINDINGS themselves, 5-12 words, headline style — NEVER the verbatim research goal, never a question>'; SECOND (after a blank line) 'ABSTRACT: <one paragraph of 4-6 sentences summarizing the hypothesis landscape, the strongest directions, and the key insight — a real scientific abstract>'. Then continue with the overview. WHAT ELO MEANS (state this accurately if you mention it): the Elo score is this system's OWN self-play tournament auto-evaluation (one model debating hypotheses against each other) — it is an internal ranking signal, NOT community consensus, peer-review, citation count, or external validation; never describe it as any of those. CITATION HONESTY: cite ONLY the sources in the literature base; never invent an arXiv id/DOI/whitepaper, never attach a venue-year attribution ('(NeurIPS 2020)', 'Wang et al. 2023') to any work NOT in the literature base (unverifiable parametric recall = fabrication), and never attribute a specific NUMERIC RESULT (e.g. 'X reports 15-25% forgetting') to a cited work unless that exact figure is in the literature base — describe prior work qualitatively otherwise. FORMAT: write flowing PROSE in GitHub-flavored Markdown with section headings (##) — this is a human-readable research overview, NOT a data dump. Do NOT return JSON, do NOT wrap the answer in a code block. REQUIRED VISUAL ELEMENTS (the exported report renders GitHub pipe tables; a PROFESSIONAL architecture figure is rendered separately from structured data and EMBEDDED inline in the report — so do NOT emit ASCII-art, box-drawing, or mermaid diagrams anywhere, and do NOT refer to 'the appended figure' or an appendix): exactly one comparison TABLE of the key hypotheses as a GitHub pipe table, comparing DESIGN dimensions a scientist decides by — core mechanism, what it improves over the literature, main risk or failure mode, and the evidence an experiment must produce (do NOT tabulate Elo/review scores; those are already tabulated elsewhere in the report; additional tables for OTHER content, e.g. experiment matrices, are welcome). Keep every table cell one line. CRITICAL HONESTY RULE: these hypotheses are UNTESTED proposals. Never write that they 'report', 'demonstrate', 'achieve', or 'show' any result — no experiment was run. Present every quantitative figure as a hypothesized/expected TARGET to be tested, and do not assert benchmark results as if observed. If a hypothesis is flagged 'unreviewed' or 'low_correctness', say so rather than promoting it. NUMBER FIDELITY: any Elo or review score you quote must match the ranked data EXACTLY, and superlatives must be true of the data ('strongest novelty' only for the actual maximum novelty score). RANK vs ELO: ranks are tier-ordered (reviewed/safe/sound/novel first) THEN Elo within tier, with near-variants de-crowded ('sibling' flag) — when you discuss a hypothesis whose rank and Elo diverge (a flagged one holding high Elo, or a sibling reordered), SAY WHY at that mention, in one clause.", "", "## Research goal", goal]
if not grounded:
    # Zero-source runs: the meta-review is the highest-visibility fabrication
    # surface (it writes the "Relation to Current Literature" prose). Repeat
    # the ban at meta level, not only in the (possibly truncated) lit text.
    parts += ["", "ZERO SOURCES WERE FETCHED THIS RUN: do NOT name or cite any specific paper, venue, year, arXiv id, DOI, author, or whitepaper anywhere (no 'TGAT (KDD 2020)', no 'TPAMI 2025'). Refer to prior work only as unattributed general knowledge and state plainly that this run fetched no literature."]
if lit:
    parts += ["", "## Literature base", lit[:2500]]
parts += ["", "## Top ranked hypotheses (with Elo + reviews)"]
for h in top:
    parts.append("### #" + str(h.get("rank")) + " " + str(h.get("title")) + " (Elo " + str(h.get("elo")) + ")")
    parts.append(str(h.get("statement") or ""))
    if h.get("experiment"):
        parts.append("Experiment: " + str(h.get("experiment")))
    if h.get("design"):
        parts.append("Design: " + str(h.get("design")))
    if h.get("metric"):
        parts.append("Metric: " + str(h.get("metric")))
    if h.get("expected_effect"):
        parts.append("Expected (hypothesized): " + str(h.get("expected_effect")))
    if h.get("falsification"):
        parts.append("Falsified if: " + str(h.get("falsification")))
    rv = h.get("reviews") or {}
    fl = h.get("flags") or []
    if fl:
        parts.append("FLAGS: " + ", ".join(fl) + " (do not present a flagged hypothesis as a top recommendation without saying so).")
    if rv.get("critique"):
        parts.append("Reviewer note (corr=" + str(rv.get("correctness")) + ", nov=" + str(rv.get("novelty")) + ", safety_ok=" + str(rv.get("safety_ok")) + "): " + str(rv.get("critique"))[:300])
    parts.append("")
return "\\n".join(parts)
""".strip()

# ---- report assembly + export (the paper's research-overview document) -----

# Assemble the FULL report the paper describes: the meta-review research
# overview (roadmap + areas + suggested experiments) followed by the ranked
# hypotheses (statement / rationale / experiment / review scores + flags) and
# the literature source ledger. This is what gets written to md / pdf / docx.
REPORT_MD_CODE = """
goal = str(research_goal or "").strip()
overview = str(overview or "").strip()
data = final or {}
ranked = data.get("ranked_hypotheses") or []
sources = data.get("sources") or []
warns = data.get("warnings") or []
cycles = data.get("cycles")
elo_history = data.get("elo_history") or []
grounding_ok = bool(data.get("grounding_ok"))
# Professional figures (diagram-render subflow outputs; {} when not run).
af = arch_fig if isinstance(arch_fig, dict) else {}
am = arch_meta if isinstance(arch_meta, dict) else {}
ef = elo_fig if isinstance(elo_fig, dict) else {}
arch_ok = bool(af.get("rendered")) and bool(af.get("png_path"))
elo_ok = bool(ef.get("rendered")) and bool(ef.get("png_path"))
warns = list(warns)
for w in (list(af.get("warnings") or []) + list(ef.get("warnings") or [])):
    warns.append(str(w))
fetched_sources = 0
for s in sources:
    if isinstance(s, dict) and s.get("fetched"):
        u = str(s.get("url") or "").lower()
        if u.startswith("http://") or u.startswith("https://"):
            fetched_sources = fetched_sources + 1
# Extract the LLM-derived TITLE and ABSTRACT the meta prompt demands
# (operator ruling 2026-07-16: the report title must be THOUGHT OF by the
# LLM, never fixed product boilerplate and never the prompt; a small
# abstract follows the restated question). Tolerant parse: missing pieces
# degrade to the product title with a visible caveat, never silently.
derived_title = ""
abstract = ""
body_lines = []
for ln in overview.split("\\n"):
    st = ln.strip()
    if not derived_title and st.upper().startswith("TITLE:"):
        derived_title = st[6:].strip().strip('"')
        continue
    if not abstract and st.upper().startswith("ABSTRACT:"):
        abstract = st[9:].strip()
        continue
    body_lines.append(ln)
overview_body = "\\n".join(body_lines).strip()
title = derived_title or "AI Co-Scientist — Research Overview"
lines = []
lines.append("# " + title)
lines.append("")
lines.append("**Research goal:** " + goal)
lines.append("")
if abstract:
    lines.append("**Abstract.** " + abstract)
    lines.append("")
lines.append("*Generated by the AbstractFlow co-scientist workflow: a literature-grounded multi-agent hypothesis engine (generation -> reflection -> Elo tournament -> evolution -> research expansion over " + str(cycles) + " supervisor cycles, then a search-grounded full review). The hypotheses below are UNTESTED, ranked proposals for future work, not established results.*")
lines.append("")
if not derived_title:
    warns = list(warns) + ["meta-review returned no TITLE line; product title used (#FALLBACK)"]
if not abstract:
    warns = list(warns) + ["meta-review returned no ABSTRACT line (#FALLBACK)"]
if warns:
    # Plain bold + bullets, NOT a `>` blockquote: the PDF renderer has no
    # blockquote branch and shows literal '> ' characters on page 1 (the
    # first thing a reader sees). Flow-side mitigation until the renderer
    # gains a blockquote style (raised with runtime).
    lines.append("**Caveats:**")
    lines.append("")
    for w in warns:
        lines.append("- " + str(w))
    lines.append("")
lines.append("---")
lines.append("")
lines.append("## Research Overview")
lines.append("")
lines.append(overview_body if overview_body else "_(no overview generated)_")
lines.append("")
if arch_ok:
    # The image embeds INLINE in md viewers AND in the PDF/DOCX exports (the
    # renderer resolves workspace-relative image lines). The alt text becomes
    # the figure caption under the image, so it carries the DESCRIPTION; the
    # heading above carries the figure title.
    lines.append("### " + str(am.get("title") or "Figure 1 — Proposed architecture"))
    lines.append("")
    cap = str(am.get("caption") or "").strip() or str(am.get("title") or "Proposed architecture")
    lines.append("![" + cap + "](" + str(af.get("png_path")) + ")")
    lines.append("")
lines.append("---")
lines.append("")
# Methodology / provenance — states the pipeline, cycle budget, tournament
# depth, and grounding honestly so a reader can weigh the ranking (adversary:
# the reports never said what Elo IS or how many cycles ran).
lines.append("## Methodology")
lines.append("")
lines.append("This overview was produced by the AbstractFlow co-scientist workflow, a literature-grounded multi-agent hypothesis tournament modeled on the Nature 2026 'AI co-scientist'. Pipeline: literature investigation (deep-plan + deep-investigate web search) -> Generation -> a supervisor loop of Reflection (peer review) / Elo ranking (pairwise scientific debate) / Evolution (per-cycle strategy) / research-expansion, with reviewer + debate feedback threaded into each next cycle -> a search-grounded full review of the finalists -> this Meta-review synthesis.")
lines.append("")
lines.append("- **Supervisor cycles:** " + str(cycles if cycles is not None else "—") + " (test-time compute budget)")
lines.append("- **Hypotheses ranked:** " + str(len(ranked)))
lines.append("- **Elo:** an internal self-play tournament score (this system debating its own hypotheses) — a relative ranking signal, NOT peer review, citation count, or external validation.")
if grounding_ok:
    lines.append("- **Literature grounding:** " + str(fetched_sources) + " fetched source(s) with resolvable URLs (listed below).")
else:
    lines.append("- **Literature grounding:** NONE fetched this run — the hypotheses are the model's parametric reasoning, not grounded in retrieved literature (see caveats).")
_any_verif = False
for s in sources:
    if isinstance(s, dict) and s.get("verification"):
        _any_verif = True
        break
if _any_verif:
    lines.append("- **Citation check:** EVERY fetched ledger URL was deterministically re-fetched and title-verified before writing; sources failing the check are labeled below and were barred from citation.")
lines.append("")
# Elo-evolution figure (ASCII, renders as monospace in PDF/DOCX). The paper's
# headline result is Elo rising with test-time compute; this makes the
# tournament's trajectory visible instead of a single final number.
def _elo_fig(hist):
    pts = [h for h in hist if isinstance(h, dict) and h.get("best") is not None]
    if len(pts) < 2:
        return []
    bests = [int(h.get("best", 0)) for h in pts]
    hi = max(bests)
    # Anchor bars at the tournament's 1200 starting Elo, not at min(bests):
    # min-anchoring rendered the first cycle as a single '#' (1261 vs 1397
    # looked like 0 vs 40), visually overstating the gain. Bar length is now
    # proportional to Elo gained over the start, which is the honest quantity.
    base = 1200
    if min(bests) < base:
        base = min(bests)
    span = (hi - base) or 1
    width = 40
    fig = ["```text", "Best-hypothesis Elo across supervisor cycles", ""]
    for h in pts:
        b = int(h.get("best", 0))
        fill = int(round((b - base) * width / span)) if span else width
        bar = "#" * max(1, fill)
        label = ("final " if h.get("final") else "cycle ") + str(h.get("cycle"))
        fig.append(label.ljust(9) + "| " + bar + " " + str(b))
    fig.append("")
    fig.append("bar length = Elo above the " + str(base) + " tournament start; higher = won more pairwise debates")
    fig.append("```")
    return fig
if elo_ok:
    # Professional chart rendered by diagram-render; the ASCII fallback stays
    # for runs where the figure could not render (rendered:false path). The
    # image embeds inline in the PDF/DOCX exports; alt = caption.
    lines.append("### Tournament trajectory")
    lines.append("")
    lines.append("![Figure 2 — Tournament trajectory: best-hypothesis Elo across supervisor cycles; Elo is this system's internal self-play debate score, not external validation.](" + str(ef.get("png_path")) + ")")
    lines.append("")
else:
    ascii_elo = _elo_fig(elo_history)
    if ascii_elo:
        lines.append("### Tournament trajectory")
        lines.append("")
        lines.extend(ascii_elo)
        lines.append("")
lines.append("---")
lines.append("")
lines.append("## Ranked Hypotheses")
lines.append("")
# Deterministic at-a-glance comparison table (rendered as a real table in the
# PDF/DOCX exports). Built from structured tournament data so the report always
# carries at least one table on the key hypotheses, independent of what the
# meta-review model chose to include.
def _cell(v):
    s = str(v if v is not None else "—")
    s = s.replace("|", "/").replace("\\n", " ").strip() or "—"
    # Width cap: junk/nested values stringify safely but an arbitrarily wide
    # cell breaks table layout in the PDF (adversary P2).
    return s[:117] + "..." if len(s) > 120 else s
if ranked:
    lines.append("### Key hypotheses at a glance")
    lines.append("")
    # State the ranking criterion so the table's order and the review columns
    # never appear to contradict each other (adversary P1: a novelty-4 idea at
    # rank 1 with no stated why). Ranking is tiered: sound+novel first, then
    # sound-but-non-novel, then unsound, then unreviewed, then unsafe; Elo
    # (self-play debate score) orders within each tier, and near-duplicates are
    # de-crowded so distinct directions surface.
    lines.append("*Ranking: reviewed, safe, sound AND novel hypotheses rank first; within each tier, higher Elo (internal self-play debate score) ranks higher unless diversity de-crowding reorders near-variants — so Elo can be non-monotonic across neighboring ranks. Flags mark demotions (low_novelty / low_correctness / unreviewed / unsafe); 'sibling' marks a near-variant of a higher-ranked hypothesis kept under the cluster cap; 'de-crowded' marks a row whose higher Elo was passed over to surface a distinct direction first.*")
    lines.append("")
    lines.append("| # | Hypothesis | Elo | Correctness | Novelty | Testability | Flags |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for h in ranked:
        rv = h.get("reviews") or {}
        fl = h.get("flags") or []
        title = _cell(h.get("title") or "(untitled)")
        if len(title) > 80:
            title = title[:77] + "..."
        lines.append(
            "| " + _cell(h.get("rank"))
            + " | " + title
            + " | " + _cell(h.get("elo"))
            + " | " + _cell(rv.get("correctness"))
            + " | " + _cell(rv.get("novelty"))
            + " | " + _cell(rv.get("testability"))
            + " | " + (_cell(", ".join(str(f) for f in fl)) if fl else "—")
            + " |"
        )
    lines.append("")
for h in ranked:
    rv = h.get("reviews") or {}
    fl = h.get("flags") or []
    head = "### #" + str(h.get("rank")) + ". " + str(h.get("title") or "(untitled)")
    lines.append(head)
    lines.append("")
    meta_bits = ["Elo " + str(h.get("elo"))]
    if rv.get("correctness") is not None:
        meta_bits.append("correctness " + str(rv.get("correctness")) + "/10")
    if rv.get("novelty") is not None:
        meta_bits.append("novelty " + str(rv.get("novelty")) + "/10")
    if rv.get("testability") is not None:
        meta_bits.append("testability " + str(rv.get("testability")) + "/10")
    if fl:
        meta_bits.append("FLAGS: " + ", ".join(fl))
    lines.append("*" + " | ".join(meta_bits) + "*")
    lines.append("")
    if h.get("statement"):
        lines.append("**Hypothesis.** " + str(h.get("statement")))
        lines.append("")
    if h.get("rationale"):
        lines.append("**Rationale.** " + str(h.get("rationale")))
        lines.append("")
    # Structured experimental protocol (Specific-Aims style) — the testable
    # core a scientist acts on. Rendered from the structured fields when the
    # model supplied them; falls back to the one-line experiment otherwise.
    design = str(h.get("design") or "").strip()
    metric = str(h.get("metric") or "").strip()
    expected = str(h.get("expected_effect") or "").strip()
    falsif = str(h.get("falsification") or "").strip()
    if design or metric or expected or falsif:
        lines.append("**Experimental protocol.**")
        lines.append("")
        if design:
            lines.append("- *Design:* " + design)
        if metric:
            lines.append("- *Metric:* " + metric)
        if expected:
            lines.append("- *Expected effect (hypothesized, untested):* " + expected)
        if falsif:
            lines.append("- *Falsified if:* " + falsif)
        lines.append("")
    elif h.get("experiment"):
        lines.append("**Proposed experiment.** " + str(h.get("experiment")))
        lines.append("")
    if rv.get("critique"):
        lines.append("**Reviewer critique.** " + str(rv.get("critique")))
        lines.append("")
lines.append("---")
lines.append("")
# Limitations & threats to validity — deterministic honesty section so the
# reader weighs the deliverable correctly (adversary template item 8).
lines.append("## Limitations & Threats to Validity")
lines.append("")
lines.append("- **Untested proposals.** Every hypothesis and quantitative target above is an UNTESTED prediction generated by the tournament, not a measured result. Treat the numbers as design targets to falsify, not findings.")
lines.append("- **Self-evaluation.** The Elo ranking is this system debating its own hypotheses (single model family); it is not peer review, external benchmarking, or citation impact, and a ~30-point Elo gap can reflect a single debate.")
if grounding_ok:
    lines.append("- **Grounding depth.** Hypotheses are grounded in " + str(fetched_sources) + " fetched source(s); the literature scan is bounded and may miss relevant prior art — a full novelty guarantee is not claimed.")
else:
    lines.append("- **Ungrounded run.** No external sources were fetched this run — the hypotheses are the model's parametric reasoning; verify all prior-art and novelty claims independently.")
lines.append("- **Seed sensitivity.** The direction set depends on the grounding run and sampling; a re-run may surface a different frontier. Use this as one structured exploration, not the definitive map.")
cites_verified = False
for s in sources:
    if isinstance(s, dict) and s.get("verification"):
        cites_verified = True
        break
if cites_verified:
    lines.append("- **Citation caution.** Every fetched ledger URL was deterministically re-fetched and title-checked this run (verdicts labeled in Literature Sources; failures were barred from citation). Characterizations of verified sources remain the model's reading — verify specific quotes/figures before relying on them.")
else:
    lines.append("- **Citation caution.** Citations are limited to fetched sources, but arXiv ids / DOIs were not each independently resolved in this run; verify before relying on any specific reference.")
lines.append("")
lines.append("---")
lines.append("")
lines.append("## Literature Sources")
lines.append("")
if sources:
    for s in sources:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()
        url = str(s.get("url") or "").strip()
        verif = str(s.get("verification") or "").strip()
        if verif == "verified":
            mark = " _(verified)_"
        elif verif == "mismatch":
            mark = " _(TITLE MISMATCH — barred from citation)_"
        elif verif == "unreachable":
            mark = " _(UNREACHABLE — barred from citation)_"
        elif verif == "unverified":
            mark = " _(title unverified)_"
        else:
            mark = "" if s.get("fetched") else " _(unfetched)_"
        take = str(s.get("takeaway") or "").strip()
        line = "- **" + title + "**" + mark
        if url:
            line = line + " — <" + url + ">"
        if take:
            line = line + " — " + take
        lines.append(line)
else:
    lines.append("_(no sources gathered)_")
lines.append("")
return "\\n".join(lines)
""".strip()

# Filename-safe timestamp + output paths (mirrors deep-research's export
# naming: <prefix>-<ts>.<ext>). Colons/dots in the ISO time break some
# filesystems, so replace them.
# ---- professional figures (diagram-render subflow, operator directive
# 2026-07-20: "a workflow dedicated to create professional diagrams") -------
#
# The LLM authors a STRUCTURED SPEC (data), the dedicated diagram-render
# workflow renders it with a fixed matplotlib script. Two figures per report:
# the architecture figure (LLM-designed from the top hypotheses) and the Elo
# trajectory (fully deterministic from tournament data). Both degrade
# honestly: rendered:false keeps the ASCII fallback + a #FALLBACK caveat.

FIGURE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["kind", "title", "caption", "layers", "edges"],
    "properties": {
        "kind": {"type": "string", "enum": ["layered"]},
        "title": {"type": "string"},
        "caption": {"type": "string"},
        "layers": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "nodes"],
                "properties": {
                    "label": {"type": "string"},
                    "nodes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["id", "label"],
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["from", "to", "label", "style"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "label": {"type": "string"},
                    "style": {"type": "string", "enum": ["solid", "dashed"]},
                },
            },
        },
    },
}

FIG_SPEC_PROMPT = """
ranked = (final or {}).get("ranked_hypotheses") or []
goal = str(research_goal or "").strip()
top = ranked[:5]
parts = ["You are designing ONE professional architecture figure for a research overview. From the top-ranked hypotheses below, produce a LAYERED diagram spec showing how the key proposed mechanisms compose into one system (the pipeline a reader would build). Constraints: 2-4 layers (each layer = a pipeline stage, label <= 28 chars); 1-4 nodes per layer (node label <= 38 chars, the mechanism's short name — include its acronym if it has one); ids are short snake_case; edges ONLY between defined node ids, each edge labeled with a <= 14-char verb phrase or an empty string, style solid for the main path and dashed for optional paths. The title starts with 'Figure 1 — '. The caption is 1-2 sentences a scientist reads under the figure. Use ONLY mechanisms from the hypotheses below plus generic pipeline stages (input, storage, retrieval, generation) — invent nothing else.", "", "## Research goal", goal, "", "## Top hypotheses"]
for h in top:
    parts.append("- " + str(h.get("title")) + ": " + str(h.get("statement") or "")[:200])
return "\\n".join(parts)
""".strip()

# Clamp the LLM's spec to renderer-safe bounds; drop dangling edges; refuse
# empty results. ok:false -> the diagram-render subflow's own invalid-spec
# path returns rendered:false and the report keeps its text fallback.
FIG_SPEC_FOLD_CODE = """
s = data if isinstance(data, dict) else {}
layers = []
ids = set()
for l in (s.get("layers") or [])[:4]:
    if not isinstance(l, dict):
        continue
    nodes = []
    for n in (l.get("nodes") or [])[:4]:
        if not isinstance(n, dict):
            continue
        nid = str(n.get("id") or "").strip()
        lab = str(n.get("label") or "").strip()
        if not nid or not lab or nid in ids:
            continue
        ids.add(nid)
        nodes.append({"id": nid, "label": lab[:60]})
    if nodes:
        layers.append({"label": str(l.get("label") or "")[:34], "nodes": nodes})
edges = []
for e in (s.get("edges") or [])[:16]:
    if not isinstance(e, dict):
        continue
    a = str(e.get("from") or "").strip()
    b = str(e.get("to") or "").strip()
    if a in ids and b in ids and a != b:
        edges.append({"from": a, "to": b, "label": str(e.get("label") or "")[:20], "style": ("dashed" if str(e.get("style")) == "dashed" else "solid")})
n_nodes = 0
for l in layers:
    n_nodes = n_nodes + len(l["nodes"])
ok = len(layers) >= 2 and n_nodes >= 3
# Sanitize title/caption for the markdown image line: a ']' or newline would
# break the renderer's full-line image regex and reintroduce raw ![...] text
# in the PDF/DOCX (adversary P1-1). Replace brackets with parens, collapse
# newlines, then clamp.
def _clean(t):
    t = str(t or "").replace("\\n", " ").replace("\\r", " ").replace("[", "(").replace("]", ")")
    while "  " in t:
        t = t.replace("  ", " ")
    return t.strip()
title_c = _clean(s.get("title") or "Figure 1 — Proposed architecture")[:110]
caption_c = _clean(s.get("caption") or "")[:300]
spec = {
    "kind": "layered",
    "title": title_c,
    "caption": caption_c,
    "layers": layers,
    "edges": edges,
}
return {"spec": (spec if ok else {}), "ok": ok, "title": title_c, "caption": caption_c}
""".strip()

# Deterministic Elo trajectory spec (no LLM) from tournament history.
ELO_SPEC_CODE = """
hist = (final or {}).get("elo_history") or []
pts = []
i = 0
for h in hist:
    if isinstance(h, dict) and h.get("best") is not None:
        i = i + 1
        pts.append([i, int(h.get("best", 0))])
ok = len(pts) >= 2
low = 1200
for p in pts:
    if p[1] < low:
        low = p[1]
spec = {
    "kind": "line",
    "title": "Figure 2 — Tournament trajectory",
    "caption": "Best-hypothesis Elo across supervisor cycles (final point = post-review tournament; y-axis anchored at the 1200 tournament start). Elo is this system's internal self-play debate score - a relative ranking signal, not external validation.",
    "x_label": "supervisor cycle",
    "y_label": "best Elo",
    "y_min": low,
    "series": [{"label": "best hypothesis", "points": pts}],
}
return {"spec": (spec if ok else {}), "ok": ok}
""".strip()

# Figure basenames carry the run timestamp (adversary P1-3): fixed names
# collide across runs sharing a workspace_root — run 2 would overwrite
# reports/figures/architecture.png and run 1's markdown would silently show
# run 2's figure. The md embeds the RETURNED path, so uniqueness is enough.
ARCH_RENDER_INPUT_CODE = """
t = str(ts or "").strip() or "run"
# Drop the baked-in caption from the FIGURE (the matplotlib caption truncates
# at the image width); the report renderer prints the full caption below the
# embedded image (wrapping, selectable). Keeping both duplicated the text —
# adversary caption-twice finding. The title stays baked (it fits).
sp = dict(spec or {})
if sp:
    sp["caption"] = ""
return {"spec": sp, "out_dir": "reports/figures", "basename": "architecture-" + t}
""".strip()

ELO_RENDER_INPUT_CODE = """
t = str(ts or "").strip() or "run"
# The Elo chart's caption also rides the report renderer (below the image),
# not baked in — keep the figure clean, one caption.
sp = dict(spec or {})
if sp:
    sp["caption"] = ""
return {"spec": sp, "out_dir": "reports/figures", "basename": "elo-trajectory-" + t}
""".strip()

# NOTE (2026-07-20): figures embed INLINE. The runtime PDF/DOCX renderers
# resolve a workspace-relative markdown image line (![alt](reports/figures/
# x.png)) against the workspace root and embed the image where it is
# referenced in the body — no appendix pages, no pypdf merge, no post-write
# PDF mutation, and pdf_sha256 is write_pdf's own delivered hash.

EXPORT_PATHS_CODE = """
raw = str(iso or "").strip()
safe = ""
for ch in raw:
    if ch == ":" or ch == ".":
        safe = safe + "-"
    elif ch == "+":
        safe = safe + "_"
    else:
        safe = safe + ch
if not safe:
    safe = "report"
prefix = "reports/co-scientist-research"
return {
    "md": prefix + "-" + safe + ".md",
    "pdf": prefix + "-" + safe + ".pdf",
    "docx": prefix + "-" + safe + ".docx",
    "timestamp": safe,
}
""".strip()

# The document title is the LLM-DERIVED title from the meta-review's TITLE:
# line (operator rulings 2026-07-15/16: never the user's prompt, never fixed
# boilerplate — "the LLM creating the report MUST think of a proper title").
# Falls back to the product title only when the model returned no TITLE line
# (the assembler records a #FALLBACK warning for that case).
REPORT_TITLE_CODE = """
ov = str(overview or "").strip()
for ln in ov.split("\\n"):
    st = ln.strip()
    if st.upper().startswith("TITLE:"):
        t = st[6:].strip().strip('"')
        if t:
            return t[:160]
return "AI Co-Scientist — Research Overview"
""".strip()

SEARCH_TOOLS = ["web_search", "skim_websearch", "skim_url", "fetch_url"]


def _if(node_id, label, x, y):
    return W.node(node_id, "if", label, x, y,
                  inputs=[W.EXEC_IN, W.pin("condition", "condition", "boolean")],
                  outputs=[W.pin("true", "true", "execution"),
                           W.pin("false", "false", "execution")],
                  extra={"icon": "&#x2753;", "headerColor": "#F39C12"})


def _call_tool(node_id, label, allowed, x, y):
    # `raw` exposes the unmapped effect outcome ({mode, results:[{output,...}]})
    # — the coding-agent gate idiom: structured tool payloads survive on the
    # raw channel even when the (result, success) mapping flattens them.
    return W.node(node_id, "call_tool", label, x, y,
                  inputs=[W.EXEC_IN,
                          W.pin("tool_call", "tool_call", "object"),
                          W.pin("allowed_tools", "allowed_tools", "array")],
                  outputs=[W.EXEC_OUT,
                           W.pin("result", "result", "any"),
                           W.pin("success", "success", "boolean"),
                           W.pin("raw", "raw", "object")],
                  pin_defaults={"allowed_tools": allowed},
                  extra={"icon": "&#x1F527;", "headerColor": "#16A085"})


def build_flow():
    flow = W.base_flow(
        "co-scientist", "co-scientist",
        "Deep multi-agent hypothesis engine (Nature 'AI co-scientist' replica). Starts FROM the literature by delegating grounding to the deep-research investigation engine (deep-investigate: real web search + source ledger), then runs a supervisor loop of Generation -> Reflection -> Elo-ranking (prioritized pairwise scientific debate) -> Evolution -> research-expansion, threading meta-feedback forward each cycle with near-duplicate pruning, then a final search-grounded full review of the finalists and a Meta-review research overview. Deliberately deeper than a single-pass report — it scales test-time compute via the cycle budget.",
        ["abstractresearch.coscientist.v1"],
    )
    fields = [
        W.pin("research_goal", "research_goal", "string"),
        W.pin("num_hypotheses", "num_hypotheses", "number"),
        W.pin("max_cycles", "max_cycles", "number"),
        W.pin("effort", "effort", "string"),
        W.pin("provider", "provider", "provider_text"),
        W.pin("model", "model", "model"),
    ]
    # LAYOUT (operator directive 2026-07-20, clean-graph audit): three
    # left-to-right exec lanes stacked vertically — grounding+citation+
    # generation at y=0, the supervisor-loop body at y=1100, terminal review/
    # meta/figures/export at y=2100 — with pure data helpers in rows above/
    # below each lane (y=-320 / 340 / 660 / 1440 / 1760 / 2480 / 2840), each
    # placed at or next to its consumer's column. Columns are 360 apart (box
    # model ~300 wide -> >=60px gaps). Audited by scripts/audit_flow_graph.py
    # (zero OVERLAP findings).
    flow["nodes"] = [
        W.start_node("Research goal", fields, 0, 0,
                     pin_defaults={"num_hypotheses": 5, "max_cycles": 3, "effort": "standard"}),
        # GROUNDING via composition, driven the way deep-research drives it:
        # deep-plan (decompose the goal into a research plan) -> deep-investigate
        # (web-search evidence gathering guided by that plan). Both are
        # deep-research's own proven subflows; the plan is what makes
        # deep-investigate populate a real source ledger. All tools auto-approve.
        W.code_node("plan_input", "Compose plan request", PLAN_INPUT_CODE, 360, 340,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("effort", "effort", "string"),
                     W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model")]),
        W.subflow_node("plan", "Research plan (deep-research)", "deep-plan", 360, 0),
        W.get_node("get_plan", "plan", {}, 720, 660),
        W.code_node("ground_input", "Compose investigation request", GROUND_INPUT_CODE, 720, 340,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("effort", "effort", "string"),
                     W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model"),
                     W.pin("plan", "plan", "object")]),
        W.subflow_node("ground", "Literature investigation (deep-research)", "deep-investigate", 720, 0),
        W.get_node("get_investigation", "investigation", {}, 1080, 340),
        W.code_node("lit_base", "Build literature base", LIT_BASE_CODE, 1440, 340,
                    [W.pin("investigation", "investigation", "object")]),
        # BOUNDED GROUNDING RETRY: two consecutive live runs returned an empty
        # source_ledger (once with findings prose, once as an empty forced
        # final at max_iterations). One retry at effort=thorough (10 agent
        # rounds vs 6), fed the failed attempt as prior_investigation and an
        # explicit ledger-first budget briefing via adversarial_review.
        # State rides the co.lit var (set_var idiom): the retry branch's pure
        # chain only pulls ground_retry outputs ON that branch, and downstream
        # consumers read the picked attempt through get_var — a pure pull
        # straight across the branch would dereference an unexecuted subflow.
        W.set_var("set_lit_first", "Store first grounding attempt", "co.lit", 1080, 0),
        _if("if_ground_retry", "Grounding empty? retry once", 1440, 0),
        W.code_node("ground_retry_input", "Compose retry investigation request", GROUND_RETRY_INPUT_CODE, 1800, 340,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model"),
                     W.pin("plan", "plan", "object"),
                     W.pin("prior_investigation", "prior_investigation", "object")]),
        W.subflow_node("ground_retry", "Literature investigation (retry)", "deep-investigate", 1800, 0),
        W.get_node("get_investigation_retry", "investigation", {}, 2160, 340),
        W.code_node("lit_base_retry", "Build literature base (retry)", LIT_BASE_CODE, 2160, 660,
                    [W.pin("investigation", "investigation", "object")]),
        W.get_var("get_lit_first", "co.lit", {}, 1800, 660),
        W.code_node("lit_pick", "Pick grounded attempt", LIT_PICK_CODE, 2520, 660,
                    [W.pin("first", "first", "object"),
                     W.pin("second", "second", "object")]),
        W.set_var("set_lit_retry", "Store picked grounding", "co.lit", 2160, 0),
        W.get_var("get_lit", "co.lit", {}, 4320, 660),
        W.code_node("lit_final", "Final literature base", "return lit or {}", 4320, 340,
                    [W.pin("lit", "lit", "object")]),
        # CITATION VERIFICATION LOOP (deterministic): fetch every ledger URL,
        # title-check against the claim, drop mismatch/unreachable from the
        # citable set. Both grounding branches converge HERE (multi-entry),
        # then generation runs against the verified literature.
        W.code_node("cite_reset", "Empty check list", CITE_RESET_CODE, 2520, 340, []),
        W.set_var("cite_init", "Reset citation checks", "co.citecheck", 2520, 0),
        W.get_var("get_lit_cite", "co.lit", {}, 2880, 340),
        W.code_node("cite_items", "Citable sources to verify", CITE_ITEMS_CODE, 2880, 660,
                    [W.pin("lit", "lit", "object")]),
        W.foreach_node("cite_each", "Verify each citation URL", 2880, 0),
        W.code_node("cite_args", "Compose fetch_url call", CITE_ARGS_CODE, 3240, 340,
                    [W.pin("item", "item", "object")]),
        _call_tool("cite_call", "Fetch source URL", ["fetch_url"], 3240, 0),
        W.get_var("get_citecheck", "co.citecheck", [], 3240, 660),
        W.code_node("cite_fold", "Fold title verdict", CITE_FOLD_CODE, 3600, 340,
                    [W.pin("item", "item", "object"),
                     W.pin("raw", "raw", "object"),
                     W.pin("acc", "acc", "array")]),
        W.set_var("set_citecheck", "Record verdict", "co.citecheck", 3600, 0),
        W.get_var("get_lit_apply", "co.lit", {}, 3600, 660),
        W.get_var("get_checks", "co.citecheck", [], 3960, 660),
        W.code_node("cite_apply", "Apply verification to literature", CITE_APPLY_CODE, 3960, 340,
                    [W.pin("lit", "lit", "object"),
                     W.pin("checks", "checks", "array")]),
        W.set_var("set_lit_verified", "Store verified literature", "co.lit", 3960, 0),
        # GENERATION grounded in the literature base
        W.code_node("gen_prompt", "Compose generation prompt", GENERATE_PROMPT, 4320, -320,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("num_hypotheses", "num_hypotheses", "number"),
                     W.pin("literature", "literature", "string")], output_type="string"),
        W.llm_node("generate", "Generation agent", 4320, 0, pin_defaults={
            "system": "You are the Generation agent of an AI co-scientist. You produce novel, grounded, testable scientific hypotheses, reasoning carefully over the supplied literature base.",
            "temperature": 0.7, "resp_schema": HYP_SCHEMA,
        }),
        W.code_node("init_state", "Init hypothesis pool", INIT_STATE_CODE, 4680, 340,
                    [W.pin("generated", "generated", "object"),
                     W.pin("literature_text", "literature_text", "string"),
                     W.pin("sources", "sources", "array"),
                     W.pin("open_questions", "open_questions", "array"),
                     W.pin("grounding_ok", "grounding_ok", "boolean"),
                     W.pin("warnings", "warnings", "array")]),
        W.set_var("set_init", "Seed pool var", "co.state", 4680, 0),
        # SUPERVISOR LOOP
        W.get_var("get_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 5040, 340),
        W.code_node("loop_cond", "Supervisor: continue?", LOOP_COND_CODE, 5040, 660,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("max_cycles", "max_cycles", "number")]),
        W.while_node("cycles", "Supervisor rounds (test-time compute)", 5040, 0),
        # loop body (its own exec lane at y=1100; helpers below at 1440/1760)
        W.get_var("get_state_body", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 1440, 1440),
        W.code_node("pool_text", "Serialize pool", POOL_TEXT_CODE, 1800, 1440,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("ctx", "Extract lit+feedback", CONTEXT_CODE, 2160, 1440,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("rank_pairs", "Prioritize match pairs", RANK_PAIRS_CODE, 2520, 1440,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("reflect_prompt", "Reflect prompt", REFLECT_PROMPT, 1800, 1760,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("reflect", "Reflection agent (initial review)", 1800, 1100, pin_defaults={
            "system": "You are the Reflection agent: a rigorous virtual scientific peer reviewer who judges hypotheses against the literature and weighs correctness as heavily as novelty.",
            "temperature": 0.2, "resp_schema": REVIEW_SCHEMA,
        }),
        W.code_node("rank_prompt", "Rank prompt", RANK_PROMPT, 2160, 1760,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("pairs", "pairs", "string"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("rank", "Ranking agent (Elo tournament)", 2160, 1100, pin_defaults={
            "system": "You are the Ranking agent: you run an Elo tournament via simulated scientific debate, ranking on plausibility first.",
            "temperature": 0.3, "resp_schema": RANK_SCHEMA,
        }),
        W.code_node("evolve_prompt", "Evolve prompt", EVOLVE_PROMPT, 2520, 1760,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("feedback", "feedback", "string"),
                     W.pin("strategy", "strategy", "string")], output_type="string"),
        W.llm_node("evolve", "Evolution agent (refine)", 2520, 1100, pin_defaults={
            "system": "You are the Evolution agent: you refine, combine, and extend top hypotheses into improved ones, avoiding near-duplicates.",
            "temperature": 0.6, "resp_schema": EVOLVE_SCHEMA,
        }),
        W.code_node("expand_prompt", "Expand prompt", EXPAND_PROMPT, 2880, 1760,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("open_questions", "open_questions", "array"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("expand", "Generation agent (research expansion)", 2880, 1100, pin_defaults={
            "system": "You are the Generation agent exploring UNEXPLORED areas of the hypothesis space, opening new directions the current pool does not cover.",
            "temperature": 0.8, "resp_schema": HYP_SCHEMA,
        }),
        W.code_node("fold", "Fold reviews+Elo+evolved+expanded+feedback", FOLD_STATE_CODE, 3240, 1440,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("reviews", "reviews", "object"),
                     W.pin("matches", "matches", "object"),
                     W.pin("evolved", "evolved", "object"),
                     W.pin("expanded", "expanded", "object")]),
        W.set_var("set_state", "Persist tournament state", "co.state", 3240, 1100),
        # TERMINAL FULL REVIEW (search-grounded) + final tournament
        # (third exec lane at y=2100; helpers below at 2480/2840)
        W.get_var("get_term_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 0, 2480),
        W.code_node("term_pool_text", "Serialize finalists", POOL_TEXT_CODE, 360, 2480,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("term_reflect_prompt", "Full-review prompt", TERM_REFLECT_PROMPT, 0, 2840,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string")], output_type="string"),
        W.agent_node("term_reflect", "Reflection agent (full search review)", 0, 2100, pin_defaults={
            "system": "You are the Reflection agent performing a deep, literature-grounded full review. You verify novelty and correctness against real sources using read-only web tools, and never fabricate citations.",
            "tools": SEARCH_TOOLS,
            "temperature": 0.2,
            "max_iterations": 4,
            "resp_schema": REVIEW_SCHEMA,
        }),
        W.code_node("term_rank_prompt", "Final rank prompt", TERM_RANK_PROMPT, 360, 2840,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string")], output_type="string"),
        W.llm_node("term_rank", "Ranking agent (final tournament)", 360, 2100, pin_defaults={
            "system": "You are the Ranking agent holding the final Elo tournament, ranking on plausibility first.",
            "temperature": 0.3, "resp_schema": RANK_SCHEMA,
        }),
        W.code_node("term_fold", "Apply full review + final Elo", TERM_FOLD_CODE, 720, 2480,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("reviews", "reviews", "object"),
                     W.pin("matches", "matches", "object")]),
        W.set_var("set_term_state", "Persist final state", "co.state", 720, 2100),
        # META-REVIEW
        W.get_var("get_final_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 720, 2840),
        W.code_node("final", "Rank final pool", FINAL_CODE, 1080, 2480,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("meta_prompt", "Meta-review prompt", META_PROMPT, 1080, 2840,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("final", "final", "object")], output_type="string"),
        W.llm_node("meta", "Meta-review agent", 1080, 2100, pin_defaults={
            "system": "You are the Meta-review agent: you synthesize the tournament's top hypotheses and the literature into a rigorous research overview.",
            "temperature": 0.4,
        }),
        W.get_node("get_ranked", "ranked_hypotheses", [], 3960, 2480),
        W.get_node("get_top", "top", {}, 4320, 2480),
        W.get_node("get_cycles", "cycles", 0, 3960, 2840),
        W.get_node("get_sources", "sources", [], 4320, 2840),
        W.get_node("get_warnings", "warnings", [], 4680, 2480),
        # PROFESSIONAL FIGURES (operator directive 2026-07-20): the LLM
        # designs a STRUCTURED architecture spec from the top hypotheses; the
        # dedicated diagram-render workflow turns specs into publication
        # PNG+PDF via a fixed matplotlib script. The Elo trajectory spec is
        # fully deterministic. Render failure degrades honestly (rendered:
        # false -> ASCII/text fallback + #FALLBACK caveat in the report).
        W.code_node("fig_spec_prompt", "Figure spec prompt", FIG_SPEC_PROMPT, 1800, 2480,
                    [W.pin("final", "final", "object"),
                     W.pin("research_goal", "research_goal", "string")], output_type="string"),
        W.llm_node("fig_spec", "Architecture figure designer", 1800, 2100, pin_defaults={
            "system": "You design clean architecture figures as structured specs. You never invent components; you compose the given hypotheses into one legible pipeline.",
            "temperature": 0.2, "resp_schema": FIGURE_SCHEMA,
        }),
        W.code_node("fig_fold", "Clamp figure spec", FIG_SPEC_FOLD_CODE, 2160, 2480,
                    [W.pin("data", "data", "object")]),
        W.code_node("arch_input", "Compose arch render input", ARCH_RENDER_INPUT_CODE, 2160, 2840,
                    [W.pin("spec", "spec", "object"),
                     W.pin("ts", "ts", "string")]),
        W.subflow_node("render_arch", "Render architecture figure", "diagram-render", 2160, 2100),
        W.code_node("elo_spec", "Elo trajectory spec", ELO_SPEC_CODE, 2520, 2480,
                    [W.pin("final", "final", "object")]),
        W.code_node("elo_input", "Compose elo render input", ELO_RENDER_INPUT_CODE, 2520, 2840,
                    [W.pin("spec", "spec", "object"),
                     W.pin("ts", "ts", "string")]),
        W.subflow_node("render_elo", "Render Elo trajectory figure", "diagram-render", 2520, 2100),
        # REPORT EXPORT: assemble the full research-overview document and write
        # it as .md / .pdf / .docx (the paper's research-overview deliverable,
        # matching deep-research's export surface).
        W.code_node("report_md", "Assemble report markdown", REPORT_MD_CODE, 2880, 2480,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("overview", "overview", "string"),
                     W.pin("final", "final", "object"),
                     W.pin("arch_fig", "arch_fig", "object"),
                     W.pin("arch_meta", "arch_meta", "object"),
                     W.pin("elo_fig", "elo_fig", "object")], output_type="string"),
        W.system_datetime_node("run_ts", "Timestamp", 1440, 2480),
        # Seed the run timestamp ONCE into a var: system_datetime is a
        # VOLATILE pure source (recomputes per pull), so reading it from both
        # the figure-basename chain and the report-filename chain would yield
        # DIFFERENT times. set_ts (exec-triggered once, before figures) freezes
        # it; every consumer reads the frozen value via get_ts.
        W.set_var("set_ts", "Freeze run timestamp", "co.ts", 1440, 2100),
        W.get_var("get_ts", "co.ts", "", 1440, 2840),
        W.code_node("export_paths", "Build export paths", EXPORT_PATHS_CODE, 3240, 2480,
                    [W.pin("iso", "iso", "string")]),
        W.code_node("report_title", "Report title", REPORT_TITLE_CODE, 3600, 2480,
                    [W.pin("overview", "overview", "string")], output_type="string"),
        W.write_file_node("write_md", "Write .md", 2880, 2100),
        W.write_pdf_node("write_pdf", "Write .pdf", 3240, 2100),
        W.write_docx_node("write_docx", "Write .docx", 3600, 2100),
        # Durable registration: write_* only places bytes in the workspace
        # folder; importing each product into the run's artifact store makes
        # it listable/servable per run (GET /runs/{id}/artifacts) — the
        # observer's durable-artifacts ask (backlog 2026-07-15). Explicit
        # content_type per import: exec-chained payloads inherit the previous
        # node's output, so an unconnected content_type pin would inherit
        # write_docx's type for all three (live incident 2026-07-15).
        W.import_workspace_file_node("import_md", "Register .md artifact", 3960, 2100,
                                     content_type="text/markdown"),
        W.import_workspace_file_node("import_pdf", "Register .pdf artifact", 4320, 2100,
                                     content_type="application/pdf"),
        W.import_workspace_file_node("import_docx", "Register .docx artifact", 4680, 2100,
                                     content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        W.end_node("Research overview", [
            W.pin("research_overview", "research_overview", "string"),
            W.pin("report_markdown", "report_markdown", "string"),
            W.pin("ranked_hypotheses", "ranked_hypotheses", "array"),
            W.pin("top_hypothesis", "top_hypothesis", "object"),
            W.pin("sources", "sources", "array"),
            W.pin("warnings", "warnings", "array"),
            W.pin("cycles", "cycles", "number"),
            W.pin("md_path", "md_path", "workspace_file"),
            W.pin("pdf_path", "pdf_path", "workspace_file"),
            W.pin("docx_path", "docx_path", "workspace_file"),
            W.pin("pdf_sha256", "pdf_sha256", "string"),
            W.pin("docx_sha256", "docx_sha256", "string"),
            W.pin("md_artifact_id", "md_artifact_id", "string"),
            W.pin("pdf_artifact_id", "pdf_artifact_id", "string"),
            W.pin("docx_artifact_id", "docx_artifact_id", "string"),
        ], 5040, 2100),
    ]
    flow["edges"] = [
        # exec spine
        W.edge("start", "exec-out", "plan", "exec-in", animated=True),
        W.edge("plan", "exec-out", "ground", "exec-in", animated=True),
        # grounding retry branch: store attempt 1 -> retry once if it fetched
        # nothing (see GROUND_RETRY_INPUT_CODE) -> store the picked attempt.
        # `generate` is multi-entry (reached from if.false and from the retry).
        W.edge("ground", "exec-out", "set_lit_first", "exec-in", animated=True),
        W.edge("set_lit_first", "exec-out", "if_ground_retry", "exec-in", animated=True),
        W.edge("if_ground_retry", "true", "ground_retry", "exec-in", animated=True),
        W.edge("ground_retry", "exec-out", "set_lit_retry", "exec-in", animated=True),
        # both grounding branches converge on the citation-verification loop
        # (cite_init is multi-entry), which then feeds generation.
        W.edge("set_lit_retry", "exec-out", "cite_init", "exec-in", animated=True),
        W.edge("if_ground_retry", "false", "cite_init", "exec-in", animated=True),
        W.edge("cite_init", "exec-out", "cite_each", "exec-in", animated=True),
        W.edge("cite_each", "loop", "cite_call", "exec-in", animated=True),
        W.edge("cite_call", "exec-out", "set_citecheck", "exec-in", animated=True),
        W.edge("cite_each", "done", "set_lit_verified", "exec-in", animated=True),
        W.edge("set_lit_verified", "exec-out", "generate", "exec-in", animated=True),
        W.edge("generate", "exec-out", "set_init", "exec-in", animated=True),
        W.edge("set_init", "exec-out", "cycles", "exec-in", animated=True),
        W.edge("cycles", "loop", "reflect", "exec-in", animated=True),
        W.edge("reflect", "exec-out", "rank", "exec-in", animated=True),
        W.edge("rank", "exec-out", "evolve", "exec-in", animated=True),
        W.edge("evolve", "exec-out", "expand", "exec-in", animated=True),
        W.edge("expand", "exec-out", "set_state", "exec-in", animated=True),
        W.edge("cycles", "done", "term_reflect", "exec-in", animated=True),
        W.edge("term_reflect", "exec-out", "term_rank", "exec-in", animated=True),
        W.edge("term_rank", "exec-out", "set_term_state", "exec-in", animated=True),
        W.edge("set_term_state", "exec-out", "meta", "exec-in", animated=True),
        # freeze the run timestamp once (before figures) so the figure
        # basenames and the report filenames share the SAME ts.
        W.edge("meta", "exec-out", "set_ts", "exec-in", animated=True),
        W.edge("run_ts", "iso", "set_ts", "value"),
        # figures: LLM spec -> render arch -> render elo (subflows), before
        # the report assembles.
        W.edge("set_ts", "exec-out", "fig_spec", "exec-in", animated=True),
        W.edge("fig_spec", "exec-out", "render_arch", "exec-in", animated=True),
        W.edge("render_arch", "exec-out", "render_elo", "exec-in", animated=True),
        # meta -> write md/pdf/docx -> register each as a durable run
        # artifact -> end (export chain; imports make the products listable
        # via GET /runs/{id}/artifacts, not just loose workspace files)
        W.edge("render_elo", "exec-out", "write_md", "exec-in", animated=True),
        W.edge("write_md", "exec-out", "write_pdf", "exec-in", animated=True),
        # figures embed inline in the PDF/DOCX renderers now — no merge step.
        W.edge("write_pdf", "exec-out", "write_docx", "exec-in", animated=True),
        W.edge("write_docx", "exec-out", "import_md", "exec-in", animated=True),
        W.edge("import_md", "exec-out", "import_pdf", "exec-in", animated=True),
        W.edge("import_pdf", "exec-out", "import_docx", "exec-in", animated=True),
        W.edge("import_docx", "exec-out", "end", "exec-in", animated=True),
        # artifact registration inputs (paths from the write nodes)
        W.edge("write_md", "file_path", "import_md", "file_path"),
        W.edge("write_pdf", "file_path", "import_pdf", "file_path"),
        W.edge("write_docx", "file_path", "import_docx", "file_path"),
        # planning (feeds the plan into grounding)
        W.edge("start", "research_goal", "plan_input", "research_goal"),
        W.edge("start", "effort", "plan_input", "effort"),
        W.edge("start", "provider", "plan_input", "provider"),
        W.edge("start", "model", "plan_input", "model"),
        W.edge("plan_input", "output", "plan", "input"),
        W.edge("plan", "output", "get_plan", "object"),
        # grounding (plan-guided, deep-research idiom)
        W.edge("start", "research_goal", "ground_input", "research_goal"),
        W.edge("start", "effort", "ground_input", "effort"),
        W.edge("start", "provider", "ground_input", "provider"),
        W.edge("start", "model", "ground_input", "model"),
        W.edge("get_plan", "value", "ground_input", "plan"),
        W.edge("ground_input", "output", "ground", "input"),
        W.edge("ground", "output", "get_investigation", "object"),
        W.edge("get_investigation", "value", "lit_base", "investigation"),
        # grounding retry branch (data)
        W.edge("lit_base", "output", "set_lit_first", "value"),
        W.edge("lit_base", "needs_retry", "if_ground_retry", "condition"),
        W.edge("start", "research_goal", "ground_retry_input", "research_goal"),
        W.edge("start", "provider", "ground_retry_input", "provider"),
        W.edge("start", "model", "ground_retry_input", "model"),
        W.edge("get_plan", "value", "ground_retry_input", "plan"),
        W.edge("get_investigation", "value", "ground_retry_input", "prior_investigation"),
        W.edge("ground_retry_input", "output", "ground_retry", "input"),
        W.edge("ground_retry", "output", "get_investigation_retry", "object"),
        W.edge("get_investigation_retry", "value", "lit_base_retry", "investigation"),
        W.edge("get_lit_first", "value", "lit_pick", "first"),
        W.edge("lit_base_retry", "output", "lit_pick", "second"),
        W.edge("lit_pick", "output", "set_lit_retry", "value"),
        W.edge("get_lit", "value", "lit_final", "lit"),
        # citation-verification loop (data)
        W.edge("cite_reset", "empty", "cite_init", "value"),
        W.edge("get_lit_cite", "value", "cite_items", "lit"),
        W.edge("cite_items", "items", "cite_each", "items"),
        W.edge("cite_each", "item", "cite_args", "item"),
        W.edge("cite_args", "tool_call", "cite_call", "tool_call"),
        W.edge("cite_each", "item", "cite_fold", "item"),
        W.edge("cite_call", "raw", "cite_fold", "raw"),
        W.edge("get_citecheck", "value", "cite_fold", "acc"),
        W.edge("cite_fold", "acc", "set_citecheck", "value"),
        W.edge("get_lit_apply", "value", "cite_apply", "lit"),
        W.edge("get_checks", "value", "cite_apply", "checks"),
        W.edge("cite_apply", "output", "set_lit_verified", "value"),
        # generation (grounded on the PICKED attempt via the co.lit var)
        W.edge("start", "research_goal", "gen_prompt", "research_goal"),
        W.edge("start", "num_hypotheses", "gen_prompt", "num_hypotheses"),
        W.edge("lit_final", "text", "gen_prompt", "literature"),
        W.edge("gen_prompt", "output", "generate", "prompt"),
        W.edge("start", "provider", "generate", "provider"),
        W.edge("start", "model", "generate", "model"),
        # init pool
        W.edge("generate", "data", "init_state", "generated"),
        W.edge("lit_final", "text", "init_state", "literature_text"),
        W.edge("lit_final", "sources", "init_state", "sources"),
        W.edge("lit_final", "open_questions", "init_state", "open_questions"),
        W.edge("lit_final", "grounding_ok", "init_state", "grounding_ok"),
        W.edge("lit_final", "warnings", "init_state", "warnings"),
        W.edge("init_state", "output", "set_init", "value"),
        # loop condition
        W.edge("get_state", "value", "loop_cond", "loop_state"),
        W.edge("start", "max_cycles", "loop_cond", "max_cycles"),
        W.edge("loop_cond", "condition", "cycles", "condition"),
        # body inputs
        W.edge("get_state_body", "value", "pool_text", "loop_state"),
        W.edge("get_state_body", "value", "ctx", "loop_state"),
        W.edge("get_state_body", "value", "rank_pairs", "loop_state"),
        # reflect (needs ids/Elo -> decorated view)
        W.edge("start", "research_goal", "reflect_prompt", "research_goal"),
        W.edge("pool_text", "decorated", "reflect_prompt", "pool_text"),
        W.edge("ctx", "literature", "reflect_prompt", "literature"),
        W.edge("ctx", "feedback", "reflect_prompt", "feedback"),
        W.edge("reflect_prompt", "output", "reflect", "prompt"),
        W.edge("start", "provider", "reflect", "provider"),
        W.edge("start", "model", "reflect", "model"),
        # rank (needs ids -> decorated view)
        W.edge("start", "research_goal", "rank_prompt", "research_goal"),
        W.edge("pool_text", "decorated", "rank_prompt", "pool_text"),
        W.edge("rank_pairs", "text", "rank_prompt", "pairs"),
        W.edge("ctx", "feedback", "rank_prompt", "feedback"),
        W.edge("rank_prompt", "output", "rank", "prompt"),
        W.edge("start", "provider", "rank", "provider"),
        W.edge("start", "model", "rank", "model"),
        # evolve (generative -> CLEAN view, no bookkeeping decorations)
        W.edge("start", "research_goal", "evolve_prompt", "research_goal"),
        W.edge("pool_text", "clean", "evolve_prompt", "pool_text"),
        W.edge("ctx", "literature", "evolve_prompt", "literature"),
        W.edge("ctx", "feedback", "evolve_prompt", "feedback"),
        W.edge("ctx", "strategy", "evolve_prompt", "strategy"),
        W.edge("evolve_prompt", "output", "evolve", "prompt"),
        W.edge("start", "provider", "evolve", "provider"),
        W.edge("start", "model", "evolve", "model"),
        # expand (generative -> CLEAN view)
        W.edge("start", "research_goal", "expand_prompt", "research_goal"),
        W.edge("pool_text", "clean", "expand_prompt", "pool_text"),
        W.edge("ctx", "literature", "expand_prompt", "literature"),
        W.edge("ctx", "open_questions", "expand_prompt", "open_questions"),
        W.edge("ctx", "feedback", "expand_prompt", "feedback"),
        W.edge("expand_prompt", "output", "expand", "prompt"),
        W.edge("start", "provider", "expand", "provider"),
        W.edge("start", "model", "expand", "model"),
        # fold -> persist
        W.edge("get_state_body", "value", "fold", "loop_state"),
        W.edge("reflect", "data", "fold", "reviews"),
        W.edge("rank", "data", "fold", "matches"),
        W.edge("evolve", "data", "fold", "evolved"),
        W.edge("expand", "data", "fold", "expanded"),
        W.edge("fold", "output", "set_state", "value"),
        # terminal full review
        W.edge("get_term_state", "value", "term_pool_text", "loop_state"),
        W.edge("start", "research_goal", "term_reflect_prompt", "research_goal"),
        W.edge("term_pool_text", "decorated", "term_reflect_prompt", "pool_text"),
        W.edge("term_reflect_prompt", "output", "term_reflect", "prompt"),
        W.edge("start", "provider", "term_reflect", "provider"),
        W.edge("start", "model", "term_reflect", "model"),
        W.edge("start", "research_goal", "term_rank_prompt", "research_goal"),
        W.edge("term_pool_text", "decorated", "term_rank_prompt", "pool_text"),
        W.edge("term_rank_prompt", "output", "term_rank", "prompt"),
        W.edge("start", "provider", "term_rank", "provider"),
        W.edge("start", "model", "term_rank", "model"),
        W.edge("get_term_state", "value", "term_fold", "loop_state"),
        W.edge("term_reflect", "data", "term_fold", "reviews"),
        W.edge("term_rank", "data", "term_fold", "matches"),
        W.edge("term_fold", "output", "set_term_state", "value"),
        # meta-review
        W.edge("get_final_state", "value", "final", "loop_state"),
        W.edge("start", "research_goal", "meta_prompt", "research_goal"),
        W.edge("final", "output", "meta_prompt", "final"),
        W.edge("meta_prompt", "output", "meta", "prompt"),
        W.edge("start", "provider", "meta", "provider"),
        W.edge("start", "model", "meta", "model"),
        # outputs
        W.edge("final", "output", "get_ranked", "object"),
        W.edge("final", "output", "get_top", "object"),
        W.edge("final", "output", "get_cycles", "object"),
        W.edge("final", "output", "get_sources", "object"),
        W.edge("final", "output", "get_warnings", "object"),
        W.edge("meta", "response", "end", "research_overview"),
        W.edge("get_ranked", "value", "end", "ranked_hypotheses"),
        W.edge("get_top", "value", "end", "top_hypothesis"),
        W.edge("get_cycles", "value", "end", "cycles"),
        W.edge("get_sources", "value", "end", "sources"),
        W.edge("get_warnings", "value", "end", "warnings"),
        # report assembly (pulled by the writers)
        W.edge("start", "research_goal", "report_md", "research_goal"),
        W.edge("meta", "response", "report_md", "overview"),
        W.edge("meta", "response", "report_title", "overview"),
        W.edge("final", "output", "report_md", "final"),
        # figure data threading
        W.edge("final", "output", "fig_spec_prompt", "final"),
        W.edge("start", "research_goal", "fig_spec_prompt", "research_goal"),
        W.edge("fig_spec_prompt", "output", "fig_spec", "prompt"),
        W.edge("start", "provider", "fig_spec", "provider"),
        W.edge("start", "model", "fig_spec", "model"),
        W.edge("fig_spec", "data", "fig_fold", "data"),
        W.edge("fig_fold", "spec", "arch_input", "spec"),
        W.edge("get_ts", "value", "arch_input", "ts"),
        W.edge("arch_input", "output", "render_arch", "input"),
        W.edge("final", "output", "elo_spec", "final"),
        W.edge("elo_spec", "spec", "elo_input", "spec"),
        W.edge("get_ts", "value", "elo_input", "ts"),
        W.edge("elo_input", "output", "render_elo", "input"),
        W.edge("render_arch", "output", "report_md", "arch_fig"),
        W.edge("fig_fold", "output", "report_md", "arch_meta"),
        W.edge("render_elo", "output", "report_md", "elo_fig"),
        # (figures embed inline — no merge threading)
        W.edge("get_ts", "value", "export_paths", "iso"),
        # write .md / .pdf / .docx
        W.edge("export_paths", "md", "write_md", "file_path"),
        W.edge("report_md", "output", "write_md", "content"),
        W.edge("export_paths", "pdf", "write_pdf", "file_path"),
        W.edge("report_md", "output", "write_pdf", "content"),
        W.edge("report_title", "output", "write_pdf", "title"),
        W.edge("export_paths", "docx", "write_docx", "file_path"),
        W.edge("report_md", "output", "write_docx", "content"),
        W.edge("report_title", "output", "write_docx", "title"),
        # report outputs
        W.edge("report_md", "output", "end", "report_markdown"),
        W.edge("write_md", "file_path", "end", "md_path"),
        W.edge("write_pdf", "file_path", "end", "pdf_path"),
        W.edge("write_docx", "file_path", "end", "docx_path"),
        # pdf_sha256 is write_pdf's own delivered hash again (no post-write
        # mutation now that figures embed inline).
        W.edge("write_pdf", "sha256", "end", "pdf_sha256"),
        W.edge("write_docx", "sha256", "end", "docx_sha256"),
        W.edge("import_md", "artifact_id", "end", "md_artifact_id"),
        W.edge("import_pdf", "artifact_id", "end", "pdf_artifact_id"),
        W.edge("import_docx", "artifact_id", "end", "docx_artifact_id"),
    ]
    return flow


def main():
    flow = build_flow()
    problems = W.validate_edges(flow)
    print("edge problems:", problems)
    if problems:
        raise SystemExit(f"edge validation failed: {problems}")
    W.write_json(W.FLOWS_DIR / "co-scientist.json", flow)
    # co-scientist composes deep-plan + deep-investigate as its grounding subflows.
    W.compile_check("co-scientist", ["co-scientist", "deep-plan", "deep-investigate", "diagram-render"])
    print("compiled ok")
    out = W.pack_bundle(
        root_flow_id="co-scientist",
        bundle_id="co-scientist",
        # 0.1.8 = quality wave vs the Nature paper (2 fable5 adversaries):
        # hardened grounding gate (http(s) URLs only) + citation allowlist
        # (no fabricated arXiv ids/whitepapers), decoration-free generative
        # pool views (no Elo/[id] leakage into hypothesis text), novelty
        # floor + diversity de-crowding in the final ranking, structured
        # per-hypothesis protocol (design/metric/expected/falsification)
        # rendered Specific-Aims style, per-cycle Evolution strategy
        # rotation, honest Elo framing + numeric-citation ban in meta,
        # methodology/provenance section + Elo-evolution ASCII figure.
        # 0.1.9 = cycle-2 sharpening from the live 0.1.8 run: design-is-setup
        # (not a restated title) prompt fix, tighter expansion dedup + a
        # headline cluster-cap (cycle-1 crowded 5 routing variants), fold-level
        # decoration/pool-id SANITIZER belt, stated ranking-criterion line,
        # deterministic Limitations & threats-to-validity section, and a
        # deep-verification (assumption-decomposition) terminal review.
        # 0.1.10 = degraded-path fixes from the live 0.1.9 zero-source run:
        # identical-title collapse in fold AND final ranking (same title twice
        # at ranks 3/4 + 6/8), empty-allowlist citation BAN (parametric venue
        # name-drops like "TGAT (KDD 2020)" in a 0-source report), ledger
        # discipline threaded through deep-investigate's adversarial_review
        # channel (8 searches ran but the source_ledger came back empty), and
        # a 1200-anchored Elo trajectory figure (min-anchoring overstated
        # cycle-over-cycle gain).
        # 0.1.11 = the two-adversary before/after audit wave (operator 1:1
        # comparison, 2026-07-19 23:00): DETERMINISTIC CITATION VERIFICATION
        # (fetch every ledger URL via call_tool fetch_url in a foreach;
        # title-check claimed vs served — arXiv strict, others loose;
        # mismatch/unreachable barred from citation + labeled in the report —
        # kills the laundering P0: the ledger claimed "Concrete Problems in
        # AI Safety" on an id serving EfficientNet, marked fetched:true);
        # near-identical-title collapse (HVGR held ranks 2 AND 8 one
        # qualifier apart) + a visible 'sibling' flag when de-crowding
        # reorders; falsification token scrub + form rules (same
        # metric/direction, no gaps, no vague thresholds); evidence-verb
        # honesty (pool hypotheses never 'demonstrate'); meta number-fidelity
        # + rank-vs-Elo local explanations.
        # 0.1.12 = PROFESSIONAL FIGURES (operator directive 2026-07-20) via
        # the new dedicated diagram-render workflow: an LLM-designed layered
        # architecture spec (data, never code) + a deterministic Elo
        # trajectory spec render to publication PNG.
        # 0.1.13 = figures embed INLINE (runtime renderer now embeds
        # workspace-relative markdown images in PDF+DOCX; the pypdf
        # appendix-merge is gone) + two-adversary hardening: run timestamp
        # frozen once (co.ts) so figure basenames and report filenames share
        # one instant; LLM caption sanitized (no ']'/newline -> no raw
        # markdown leak); baked figure caption dropped in favor of the
        # renderer's wrapping caption (no duplicate). VERSION BUMP is
        # load-bearing: a gateway that already loaded 0.1.12 refuses a
        # same-version re-publish (immutable by sha), so the fix would never
        # reach it — 0.1.13 forces the pickup.
        # 0.1.14 = 4-adversary catalog wave (operator directive 2026-07-20):
        # citation-verification honest reporting (no vacuous "every URL
        # verified" claim on zero-source runs; the 12-URL check budget is
        # stated, unchecked overflow gets a #FALLBACK note) + readable
        # three-lane layout, zero node overlaps.
        # 0.1.15 = approval-free figures (operator ruling 2026-07-20): the
        # diagram-render subflow moved from execute_command (approval-gated;
        # stalled every unattended run) to the runtime's in-process
        # write_chart effect node — python_bin input gone with the
        # subprocess. Repacked so the bundle carries diagram-render@0.2.0.
        # 0.1.16 = TOTAL citation-verification coverage (operator ruling
        # 2026-07-21: the 12-URL budget-overflow caveat "should never
        # happen, we must be thorough") — every fetched ledger source is
        # title-verified; the cap is gone (the list is bounded upstream by
        # the investigation iteration budget). The unchecked counter stays
        # as a defensive anomaly check only.
        bundle_version="0.1.16",
        entrypoints=["co-scientist"],
        metadata={
            "family": "co-scientist",
            "purpose": "deep literature-grounded multi-agent hypothesis engine (Nature AI co-scientist replica): deep-plan + deep-investigate grounding -> generate -> [reflect -> Elo tournament -> evolve -> expand] xN -> full search review -> research overview, exported as .md/.pdf/.docx",
            "outputs": ["research_overview", "report_markdown", "ranked_hypotheses", "top_hypothesis", "sources", "warnings", "cycles", "md_path", "pdf_path", "docx_path", "pdf_sha256", "docx_sha256"],
        },
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
