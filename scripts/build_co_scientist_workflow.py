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
    A subflow call to `dp-investigate` (the framework's proven web-search
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
    dp-investigate); the six-agent division of labor (Generation, Reflection,
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

import wf_common as W

HYP_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["hypotheses"],
    "properties": {
        "hypotheses": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["title", "statement", "rationale", "experiment"],
                "properties": {
                    "title": {"type": "string"},
                    "statement": {"type": "string"},
                    "rationale": {"type": "string"},
                    "experiment": {"type": "string"},
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

# ---- literature grounding (from dp-investigate's investigation object) -----

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
# Clean source ledger. dp-investigate's schema uses url_or_path / fetched /
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
fetched_count = 0
for s in sources:
    if s.get("fetched") and str(s.get("url") or "").strip() and str(s.get("url") or "").strip().lower() != "n/a":
        fetched_count = fetched_count + 1
grounding_ok = fetched_count > 0
warnings = []
if not grounding_ok:
    warnings.append("#FALLBACK: literature grounding fetched 0 real sources this run (the investigation agent did not retrieve usable literature); the hypotheses below are the model's parametric reasoning, NOT grounded in fetched sources. Re-run for grounded output.")
text = "\\n".join(parts).strip() or "(no literature grounding was gathered)"
return {"text": text, "sources": sources, "open_questions": open_q, "grounding_ok": grounding_ok, "warnings": warnings, "fetched_count": fetched_count}
""".strip()

INIT_STATE_CODE = """
hyps = (generated or {}).get("hypotheses") or []
pool = []
for i, h in enumerate(hyps):
    if not isinstance(h, dict):
        continue
    pool.append({
        "id": i,
        "title": str(h.get("title") or "").strip(),
        "statement": str(h.get("statement") or "").strip(),
        "rationale": str(h.get("rationale") or "").strip(),
        "experiment": str(h.get("experiment") or "").strip(),
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
}
""".strip()

LOOP_COND_CODE = """
state = loop_state or {}
cycle = int(state.get("cycle", 0) or 0)
pool = state.get("pool") or []
max_c = max(1, int(max_cycles or 1))
return {"condition": cycle < max_c and len(pool) > 0, "cycle": cycle}
""".strip()

POOL_TEXT_CODE = """
state = loop_state or {}
pool = state.get("pool") or []
ranked = sorted(pool, key=lambda h: -float(h.get("elo", 0)))
lines = []
for h in ranked:
    tag = "" if h.get("reviewed") else " [UNREVIEWED]"
    lines.append("### [" + str(h.get("id")) + "] " + str(h.get("title") or "") + " (Elo " + str(int(h.get("elo", 0))) + ")" + tag)
    lines.append(str(h.get("statement") or ""))
    if h.get("rationale"):
        lines.append("Rationale: " + str(h.get("rationale")))
    lines.append("")
return "\\n".join(lines)
""".strip()

CONTEXT_CODE = """
state = loop_state or {}
return {
    "literature": str(state.get("literature") or "").strip(),
    "feedback": str(state.get("feedback") or "").strip(),
    "open_questions": state.get("open_questions") or [],
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

existing_tok = [_toks(h) for h in pool.values()]

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
# them, so only near-identical restatements are dropped (0.85). EXPANDED
# hypotheses are meant to open new areas, so anything close to an existing one
# is a failed expansion and is dropped (0.6). Using one 0.6 threshold for both
# silently discarded almost every genuine refinement (adversary P1).
labelled = []
for h in ((evolved or {}).get("hypotheses") or []):
    labelled.append((h, 0.85))
for h in ((expanded or {}).get("hypotheses") or []):
    labelled.append((h, 0.6))
for h, thresh in labelled:
    if not isinstance(h, dict):
        continue
    ct = _toks(h)
    if _max_overlap(ct) >= thresh:
        dropped_dups = dropped_dups + 1
        continue
    existing_tok.append(ct)
    pool[next_id] = {
        "id": next_id,
        "title": str(h.get("title") or "").strip(),
        "statement": str(h.get("statement") or "").strip(),
        "rationale": str(h.get("rationale") or "").strip(),
        "experiment": str(h.get("experiment") or "").strip(),
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
def _corr_val(h):
    rv = h.get("reviews") or {}
    corr = rv.get("correctness")
    if isinstance(corr, bool):
        return None
    if isinstance(corr, int) or isinstance(corr, float):
        return float(corr)
    return None
def _unsafe(h):
    # Only a reviewed, explicit False counts as unsafe (unreviewed/None is not).
    rv = h.get("reviews") or {}
    return bool(h.get("reviewed")) and (rv.get("safety_ok") is False)
def _sort_key(h):
    corr_v = _corr_val(h)
    reviewed = bool(h.get("reviewed")) and corr_v is not None
    # tier 0 = reviewed, safe, sound; 1 = reviewed, safe, unsound;
    # 2 = unreviewed; 3 = reviewed but flagged UNSAFE (never headline).
    if _unsafe(h):
        tier = 3
    elif not reviewed:
        tier = 2
    elif corr_v < CORRECTNESS_FLOOR:
        tier = 1
    else:
        tier = 0
    return (tier, -float(h.get("elo", 0)))
ranked = sorted(pool, key=_sort_key)
out = []
for rank, h in enumerate(ranked, 1):
    corr_v = _corr_val(h)
    flags = []
    if _unsafe(h):
        flags.append("unsafe")
    if not bool(h.get("reviewed")):
        flags.append("unreviewed")
    elif corr_v is not None and corr_v < CORRECTNESS_FLOOR:
        flags.append("low_correctness")
    out.append({
        "rank": rank,
        "elo": int(float(h.get("elo", 0))),
        "reviewed": bool(h.get("reviewed")),
        "flags": flags,
        "title": h.get("title"),
        "statement": h.get("statement"),
        "rationale": h.get("rationale"),
        "experiment": h.get("experiment"),
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
}
""".strip()

# ---- prompt composers (code nodes) ----------------------------------------

# dp-plan takes the raw research question and returns a structured research
# plan (sub-questions). The plan is what dp-investigate needs to organize its
# findings into a real source ledger — driving dp-investigate WITHOUT a plan
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

# dp-investigate input: the raw request + the plan from dp-plan + a single
# round of context (round_index 0 of 1), matching how deep-research drives it.
GROUND_INPUT_CODE = """
return {
    "request": str(research_goal or "").strip(),
    "effort": str(effort or "standard"),
    "provider": provider,
    "model": model,
    "plan": plan,
    "round_index": 0,
    "total_rounds": 1,
}
""".strip()

GENERATE_PROMPT = """
goal = str(research_goal or "").strip()
n = int(num_hypotheses or 5)
lit = str(literature or "").strip()
base = "You are the Generation agent of an AI co-scientist. GROUND your reasoning in the literature base below, then propose " + str(n) + " NOVEL, plausible, testable research hypotheses that go BEYOND what the literature already establishes. For each: a short title, the hypothesis statement, a rationale that connects to the literature (what specific gap it fills), and a concrete experiment to test it. Favor mechanistic specificity and originality over restating known results. IMPORTANT: you have run no experiments — phrase any quantitative target as a HYPOTHESIZED/EXPECTED outcome to be tested (e.g. 'we predict up to ~X%'), never as a measured or demonstrated result, and do not invent benchmark names or precise numbers as if observed."
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
parts = ["You are the Evolution agent. Produce 1-2 IMPROVED hypotheses by refining, combining, or extending the TOP hypotheses below (sharper mechanism, stronger grounding, a better-controlled experiment, fixing a reviewer-noted flaw). Return only genuinely improved hypotheses, not restatements or near-duplicates of existing ones. Phrase quantitative targets as HYPOTHESIZED/EXPECTED, never as measured results, and do not invent precise numbers or benchmark names as if observed."]
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
parts = ["You are the Generation agent in RESEARCH-EXPANSION mode. Review the hypotheses ALREADY in the pool below and propose 1-2 NOVEL hypotheses in UNEXPLORED areas that the current pool does NOT cover — open a new direction, do not refine an existing one. Ground each in the literature and give a concrete experiment."]
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
parts = ["You are the Reflection agent performing a FULL, deeply-grounded review of the FINALIST hypotheses. Use the read-only web tools to search the current literature and verify each hypothesis's NOVELTY (is it already published?) and CORRECTNESS (is the mechanism sound?). For EACH hypothesis, score correctness, novelty, testability (0-10), set safety_ok, and give a critique that CITES what you found (or confirms you could not find prior art, supporting novelty). Be skeptical: down-score hypotheses that duplicate existing work or rest on refuted assumptions.", "", "## Research goal", goal, "", "## Finalist hypotheses to verify", pool_text]
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
top = ranked[:5]
parts = ["You are the Meta-review agent. Synthesize the top-ranked hypotheses below into a rigorous research overview for a scientist: the most promising directions and WHY they rank highly (reference their reviews), how they relate to the current literature, the key open questions, and concrete suggested next experiments. FORMAT: write flowing PROSE in GitHub-flavored Markdown with section headings (##) — this is a human-readable research overview, NOT a data dump. Do NOT return JSON, do NOT wrap the answer in a code block. CRITICAL HONESTY RULE: these hypotheses are UNTESTED proposals. Never write that they 'report', 'demonstrate', 'achieve', or 'show' any result — no experiment was run. Present every quantitative figure as a hypothesized/expected TARGET to be tested, and do not assert benchmark results as if observed. If a hypothesis is flagged 'unreviewed' or 'low_correctness', say so rather than promoting it.", "", "## Research goal", goal]
if lit:
    parts += ["", "## Literature base", lit[:2500]]
parts += ["", "## Top ranked hypotheses (with Elo + reviews)"]
for h in top:
    parts.append("### #" + str(h.get("rank")) + " " + str(h.get("title")) + " (Elo " + str(h.get("elo")) + ")")
    parts.append(str(h.get("statement") or ""))
    if h.get("experiment"):
        parts.append("Experiment: " + str(h.get("experiment")))
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
lines = []
lines.append("# AI Co-Scientist — Research Overview")
lines.append("")
lines.append("**Research goal:** " + goal)
lines.append("")
lines.append("*Generated by the AbstractFlow co-scientist workflow: a literature-grounded multi-agent hypothesis engine (generation -> reflection -> Elo tournament -> evolution -> research expansion over " + str(cycles) + " supervisor cycles, then a search-grounded full review). The hypotheses below are UNTESTED, ranked proposals for future work, not established results.*")
lines.append("")
if warns:
    lines.append("> **Caveats:**")
    for w in warns:
        lines.append("> - " + str(w))
    lines.append("")
lines.append("---")
lines.append("")
lines.append("## Research Overview")
lines.append("")
lines.append(overview if overview else "_(no overview generated)_")
lines.append("")
lines.append("---")
lines.append("")
lines.append("## Ranked Hypotheses")
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
    if h.get("experiment"):
        lines.append("**Proposed experiment.** " + str(h.get("experiment")))
        lines.append("")
    if rv.get("critique"):
        lines.append("**Reviewer critique.** " + str(rv.get("critique")))
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

REPORT_TITLE_CODE = """
goal = str(research_goal or "").strip()
t = "AI Co-Scientist Research Overview"
if goal:
    t = t + ": " + goal
return t[:160]
""".strip()

SEARCH_TOOLS = ["web_search", "skim_websearch", "skim_url", "fetch_url"]


def build_flow():
    flow = W.base_flow(
        "co-scientist", "co-scientist",
        "Deep multi-agent hypothesis engine (Nature 'AI co-scientist' replica). Starts FROM the literature by delegating grounding to the deep-research investigation engine (dp-investigate: real web search + source ledger), then runs a supervisor loop of Generation -> Reflection -> Elo-ranking (prioritized pairwise scientific debate) -> Evolution -> research-expansion, threading meta-feedback forward each cycle with near-duplicate pruning, then a final search-grounded full review of the finalists and a Meta-review research overview. Deliberately deeper than a single-pass report — it scales test-time compute via the cycle budget.",
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
    flow["nodes"] = [
        W.start_node("Research goal", fields, -1900, 0,
                     pin_defaults={"num_hypotheses": 5, "max_cycles": 3, "effort": "standard"}),
        # GROUNDING via composition, driven the way deep-research drives it:
        # dp-plan (decompose the goal into a research plan) -> dp-investigate
        # (web-search evidence gathering guided by that plan). Both are
        # deep-research's own proven subflows; the plan is what makes
        # dp-investigate populate a real source ledger. All tools auto-approve.
        W.code_node("plan_input", "Compose plan request", PLAN_INPUT_CODE, -1580, -180,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("effort", "effort", "string"),
                     W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model")]),
        W.subflow_node("plan", "Research plan (deep-research)", "dp-plan", -1240, -320),
        W.get_node("get_plan", "plan", {}, -1240, -120),
        W.code_node("ground_input", "Compose investigation request", GROUND_INPUT_CODE, -1580, 200,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("effort", "effort", "string"),
                     W.pin("provider", "provider", "provider_text"),
                     W.pin("model", "model", "model"),
                     W.pin("plan", "plan", "object")]),
        W.subflow_node("ground", "Literature investigation (deep-research)", "dp-investigate", -900, 0),
        W.get_node("get_investigation", "investigation", {}, -560, 200),
        W.code_node("lit_base", "Build literature base", LIT_BASE_CODE, -580, 200,
                    [W.pin("investigation", "investigation", "object")]),
        # GENERATION grounded in the literature base
        W.code_node("gen_prompt", "Compose generation prompt", GENERATE_PROMPT, -580, 380,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("num_hypotheses", "num_hypotheses", "number"),
                     W.pin("literature", "literature", "string")], output_type="string"),
        W.llm_node("generate", "Generation agent", -240, 0, pin_defaults={
            "system": "You are the Generation agent of an AI co-scientist. You produce novel, grounded, testable scientific hypotheses, reasoning carefully over the supplied literature base.",
            "temperature": 0.7, "resp_schema": HYP_SCHEMA,
        }),
        W.code_node("init_state", "Init hypothesis pool", INIT_STATE_CODE, 100, 200,
                    [W.pin("generated", "generated", "object"),
                     W.pin("literature_text", "literature_text", "string"),
                     W.pin("sources", "sources", "array"),
                     W.pin("open_questions", "open_questions", "array"),
                     W.pin("grounding_ok", "grounding_ok", "boolean"),
                     W.pin("warnings", "warnings", "array")]),
        W.set_var("set_init", "Seed pool var", "co.state", 100, 0),
        # SUPERVISOR LOOP
        W.get_var("get_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 440, 200),
        W.code_node("loop_cond", "Supervisor: continue?", LOOP_COND_CODE, 440, 340,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("max_cycles", "max_cycles", "number")]),
        W.while_node("cycles", "Supervisor rounds (test-time compute)", 440, 500),
        # loop body
        W.get_var("get_state_body", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 780, -360),
        W.code_node("pool_text", "Serialize pool", POOL_TEXT_CODE, 780, -200,
                    [W.pin("loop_state", "loop_state", "object")], output_type="string"),
        W.code_node("ctx", "Extract lit+feedback", CONTEXT_CODE, 780, -40,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("rank_pairs", "Prioritize match pairs", RANK_PAIRS_CODE, 780, 120,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("reflect_prompt", "Reflect prompt", REFLECT_PROMPT, 780, 280,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("reflect", "Reflection agent (initial review)", 1120, -40, pin_defaults={
            "system": "You are the Reflection agent: a rigorous virtual scientific peer reviewer who judges hypotheses against the literature and weighs correctness as heavily as novelty.",
            "temperature": 0.2, "resp_schema": REVIEW_SCHEMA,
        }),
        W.code_node("rank_prompt", "Rank prompt", RANK_PROMPT, 1120, 220,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("pairs", "pairs", "string"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("rank", "Ranking agent (Elo tournament)", 1460, -40, pin_defaults={
            "system": "You are the Ranking agent: you run an Elo tournament via simulated scientific debate, ranking on plausibility first.",
            "temperature": 0.3, "resp_schema": RANK_SCHEMA,
        }),
        W.code_node("evolve_prompt", "Evolve prompt", EVOLVE_PROMPT, 1460, 220,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("feedback", "feedback", "string")], output_type="string"),
        W.llm_node("evolve", "Evolution agent (refine)", 1800, -40, pin_defaults={
            "system": "You are the Evolution agent: you refine, combine, and extend top hypotheses into improved ones, avoiding near-duplicates.",
            "temperature": 0.6, "resp_schema": EVOLVE_SCHEMA,
        }),
        W.code_node("expand_prompt", "Expand prompt", EXPAND_PROMPT, 1800, 220,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string"),
                     W.pin("literature", "literature", "string"),
                     W.pin("open_questions", "open_questions", "array")], output_type="string"),
        W.llm_node("expand", "Generation agent (research expansion)", 2140, -40, pin_defaults={
            "system": "You are the Generation agent exploring UNEXPLORED areas of the hypothesis space, opening new directions the current pool does not cover.",
            "temperature": 0.8, "resp_schema": HYP_SCHEMA,
        }),
        W.code_node("fold", "Fold reviews+Elo+evolved+expanded+feedback", FOLD_STATE_CODE, 2480, 120,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("reviews", "reviews", "object"),
                     W.pin("matches", "matches", "object"),
                     W.pin("evolved", "evolved", "object"),
                     W.pin("expanded", "expanded", "object")]),
        W.set_var("set_state", "Persist tournament state", "co.state", 2480, -40),
        # TERMINAL FULL REVIEW (search-grounded) + final tournament
        W.get_var("get_term_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 780, 640),
        W.code_node("term_pool_text", "Serialize finalists", POOL_TEXT_CODE, 1120, 640,
                    [W.pin("loop_state", "loop_state", "object")], output_type="string"),
        W.code_node("term_reflect_prompt", "Full-review prompt", TERM_REFLECT_PROMPT, 1120, 820,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string")], output_type="string"),
        W.agent_node("term_reflect", "Reflection agent (full search review)", 1460, 640, pin_defaults={
            "system": "You are the Reflection agent performing a deep, literature-grounded full review. You verify novelty and correctness against real sources using read-only web tools, and never fabricate citations.",
            "tools": SEARCH_TOOLS,
            "temperature": 0.2,
            "max_iterations": 4,
            "resp_schema": REVIEW_SCHEMA,
        }),
        W.code_node("term_rank_prompt", "Final rank prompt", TERM_RANK_PROMPT, 1460, 860,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("pool_text", "pool_text", "string")], output_type="string"),
        W.llm_node("term_rank", "Ranking agent (final tournament)", 1800, 640, pin_defaults={
            "system": "You are the Ranking agent holding the final Elo tournament, ranking on plausibility first.",
            "temperature": 0.3, "resp_schema": RANK_SCHEMA,
        }),
        W.code_node("term_fold", "Apply full review + final Elo", TERM_FOLD_CODE, 2140, 640,
                    [W.pin("loop_state", "loop_state", "object"),
                     W.pin("reviews", "reviews", "object"),
                     W.pin("matches", "matches", "object")]),
        W.set_var("set_term_state", "Persist final state", "co.state", 2140, 480),
        # META-REVIEW
        W.get_var("get_final_state", "co.state", {"pool": [], "cycle": 0, "next_id": 0}, 780, 1000),
        W.code_node("final", "Rank final pool", FINAL_CODE, 1120, 1000,
                    [W.pin("loop_state", "loop_state", "object")]),
        W.code_node("meta_prompt", "Meta-review prompt", META_PROMPT, 1120, 1180,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("final", "final", "object")], output_type="string"),
        W.llm_node("meta", "Meta-review agent", 1460, 1000, pin_defaults={
            "system": "You are the Meta-review agent: you synthesize the tournament's top hypotheses and the literature into a rigorous research overview.",
            "temperature": 0.4,
        }),
        W.get_node("get_ranked", "ranked_hypotheses", [], 1800, 940),
        W.get_node("get_top", "top", {}, 1800, 1060),
        W.get_node("get_cycles", "cycles", 0, 1800, 1180),
        W.get_node("get_sources", "sources", [], 1800, 1300),
        W.get_node("get_warnings", "warnings", [], 1800, 1420),
        # REPORT EXPORT: assemble the full research-overview document and write
        # it as .md / .pdf / .docx (the paper's research-overview deliverable,
        # matching deep-research's export surface).
        W.code_node("report_md", "Assemble report markdown", REPORT_MD_CODE, 2140, 1180,
                    [W.pin("research_goal", "research_goal", "string"),
                     W.pin("overview", "overview", "string"),
                     W.pin("final", "final", "object")], output_type="string"),
        W.system_datetime_node("run_ts", "Timestamp", 2140, 1320),
        W.code_node("export_paths", "Build export paths", EXPORT_PATHS_CODE, 2140, 1460,
                    [W.pin("iso", "iso", "string")]),
        W.code_node("report_title", "Report title", REPORT_TITLE_CODE, 2140, 1600,
                    [W.pin("research_goal", "research_goal", "string")], output_type="string"),
        W.write_file_node("write_md", "Write .md", 2480, 1000),
        W.write_pdf_node("write_pdf", "Write .pdf", 2480, 1180),
        W.write_docx_node("write_docx", "Write .docx", 2480, 1360),
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
        ], 2820, 1000),
    ]
    flow["edges"] = [
        # exec spine
        W.edge("start", "exec-out", "plan", "exec-in", animated=True),
        W.edge("plan", "exec-out", "ground", "exec-in", animated=True),
        W.edge("ground", "exec-out", "generate", "exec-in", animated=True),
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
        # meta -> write md -> write pdf -> write docx -> end (export chain)
        W.edge("meta", "exec-out", "write_md", "exec-in", animated=True),
        W.edge("write_md", "exec-out", "write_pdf", "exec-in", animated=True),
        W.edge("write_pdf", "exec-out", "write_docx", "exec-in", animated=True),
        W.edge("write_docx", "exec-out", "end", "exec-in", animated=True),
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
        # generation (grounded)
        W.edge("start", "research_goal", "gen_prompt", "research_goal"),
        W.edge("start", "num_hypotheses", "gen_prompt", "num_hypotheses"),
        W.edge("lit_base", "text", "gen_prompt", "literature"),
        W.edge("gen_prompt", "output", "generate", "prompt"),
        W.edge("start", "provider", "generate", "provider"),
        W.edge("start", "model", "generate", "model"),
        # init pool
        W.edge("generate", "data", "init_state", "generated"),
        W.edge("lit_base", "text", "init_state", "literature_text"),
        W.edge("lit_base", "sources", "init_state", "sources"),
        W.edge("lit_base", "open_questions", "init_state", "open_questions"),
        W.edge("lit_base", "grounding_ok", "init_state", "grounding_ok"),
        W.edge("lit_base", "warnings", "init_state", "warnings"),
        W.edge("init_state", "output", "set_init", "value"),
        # loop condition
        W.edge("get_state", "value", "loop_cond", "loop_state"),
        W.edge("start", "max_cycles", "loop_cond", "max_cycles"),
        W.edge("loop_cond", "condition", "cycles", "condition"),
        # body inputs
        W.edge("get_state_body", "value", "pool_text", "loop_state"),
        W.edge("get_state_body", "value", "ctx", "loop_state"),
        W.edge("get_state_body", "value", "rank_pairs", "loop_state"),
        # reflect
        W.edge("start", "research_goal", "reflect_prompt", "research_goal"),
        W.edge("pool_text", "output", "reflect_prompt", "pool_text"),
        W.edge("ctx", "literature", "reflect_prompt", "literature"),
        W.edge("ctx", "feedback", "reflect_prompt", "feedback"),
        W.edge("reflect_prompt", "output", "reflect", "prompt"),
        W.edge("start", "provider", "reflect", "provider"),
        W.edge("start", "model", "reflect", "model"),
        # rank
        W.edge("start", "research_goal", "rank_prompt", "research_goal"),
        W.edge("pool_text", "output", "rank_prompt", "pool_text"),
        W.edge("rank_pairs", "text", "rank_prompt", "pairs"),
        W.edge("ctx", "feedback", "rank_prompt", "feedback"),
        W.edge("rank_prompt", "output", "rank", "prompt"),
        W.edge("start", "provider", "rank", "provider"),
        W.edge("start", "model", "rank", "model"),
        # evolve
        W.edge("start", "research_goal", "evolve_prompt", "research_goal"),
        W.edge("pool_text", "output", "evolve_prompt", "pool_text"),
        W.edge("ctx", "literature", "evolve_prompt", "literature"),
        W.edge("ctx", "feedback", "evolve_prompt", "feedback"),
        W.edge("evolve_prompt", "output", "evolve", "prompt"),
        W.edge("start", "provider", "evolve", "provider"),
        W.edge("start", "model", "evolve", "model"),
        # expand
        W.edge("start", "research_goal", "expand_prompt", "research_goal"),
        W.edge("pool_text", "output", "expand_prompt", "pool_text"),
        W.edge("ctx", "literature", "expand_prompt", "literature"),
        W.edge("ctx", "open_questions", "expand_prompt", "open_questions"),
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
        W.edge("term_pool_text", "output", "term_reflect_prompt", "pool_text"),
        W.edge("term_reflect_prompt", "output", "term_reflect", "prompt"),
        W.edge("start", "provider", "term_reflect", "provider"),
        W.edge("start", "model", "term_reflect", "model"),
        W.edge("start", "research_goal", "term_rank_prompt", "research_goal"),
        W.edge("term_pool_text", "output", "term_rank_prompt", "pool_text"),
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
        W.edge("final", "output", "report_md", "final"),
        W.edge("run_ts", "iso", "export_paths", "iso"),
        W.edge("start", "research_goal", "report_title", "research_goal"),
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
        W.edge("write_pdf", "sha256", "end", "pdf_sha256"),
        W.edge("write_docx", "sha256", "end", "docx_sha256"),
    ]
    return flow


def main():
    flow = build_flow()
    problems = W.validate_edges(flow)
    print("edge problems:", problems)
    if problems:
        raise SystemExit(f"edge validation failed: {problems}")
    W.write_json(W.FLOWS_DIR / "co-scientist.json", flow)
    # co-scientist composes dp-plan + dp-investigate as its grounding subflows.
    W.compile_check("co-scientist", ["co-scientist", "dp-plan", "dp-investigate"])
    print("compiled ok")
    out = W.pack_bundle(
        root_flow_id="co-scientist",
        bundle_id="co-scientist",
        bundle_version="0.1.0",
        entrypoints=["co-scientist"],
        metadata={
            "family": "co-scientist",
            "purpose": "deep literature-grounded multi-agent hypothesis engine (Nature AI co-scientist replica): dp-plan + dp-investigate grounding -> generate -> [reflect -> Elo tournament -> evolve -> expand] xN -> full search review -> research overview, exported as .md/.pdf/.docx",
            "outputs": ["research_overview", "report_markdown", "ranked_hypotheses", "top_hypothesis", "sources", "warnings", "cycles", "md_path", "pdf_path", "docx_path", "pdf_sha256", "docx_sha256"],
        },
    )
    print(f"packed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
