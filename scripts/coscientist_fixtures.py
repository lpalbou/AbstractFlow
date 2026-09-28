#!/usr/bin/env python3
"""Shared fixtures for the co-scientist PROMPT/REPORT equivalence golden.

WHY THIS FILE EXISTS. The doctrine rework (0.2.0) moved every prompt, report
and caveat sentence out of Python string concatenation and into EDITABLE PIN
DEFAULTS with `{{slots}}`, dissolved four namespaced state blobs into flat run
vars, and put every code node on the execution lane. None of that is allowed to
change a single character of what a model reads or a reader receives.

`scripts/coscientist_smoke.py` runs every case below through the REAL runtime
code-node lane on the SHIPPED flow and compares the composed text to
`scripts/coscientist_golden.json` — which was generated from the pre-rework
0.1.16 builder. A paraphrase, a dropped rule, a lost heading or a reordered
section fails the gate.

Each case names the OLD node it came from (`node`), the NEW node that composes
the same text (`new_node`, default: same id), the inputs on each side, and the
path into each side's return value that holds the compared text.
"""
from __future__ import annotations

# --------------------------------------------------------------------------
# raw material
# --------------------------------------------------------------------------

INVESTIGATION_OK = {
    "answer_hypotheses": [
        "Replay-based consolidation dominates regularization on long task streams.",
        "Retrieval augmentation shifts forgetting from weights to the index.",
    ],
    "source_ledger": [
        {
            "title": "Concrete Problems in AI Safety",
            "url_or_path": "https://arxiv.org/abs/1606.06565",
            "fetched": True,
            "evidence_quality": "high",
            "relevance": "frames the desiderata this goal inherits",
        },
        {
            "title": "Continual Learning Survey",
            "url_or_path": "https://arxiv.org/pdf/1802.07569.pdf",
            "fetched": True,
            "evidence_quality": "medium",
            "relevance": "taxonomy of replay vs regularization",
        },
        {
            "title": "Vendor Whitepaper",
            "url_or_path": "https://example.com/whitepaper",
            "fetched": False,
            "rejected_reason": "paywalled",
            "relevance": "marketing claims only",
        },
    ],
    "open_questions": [
        "Does replay scale past 10^6 tasks without an index rebuild?",
        "What is the memory/accuracy frontier under a fixed budget?",
    ],
    "limitations": ["No longitudinal study past 200 tasks."],
}

INVESTIGATION_EMPTY = {
    "answer_hypotheses": ["The agent reasoned but retrieved nothing."],
    "source_ledger": [],
    "open_questions": [],
    "limitations": [],
}

GOAL = "How can an agent retain skills across a long stream of tasks?"

LIT_TEXT = (
    "Grounded findings from the literature:\n"
    "1. Replay-based consolidation dominates regularization on long task streams.\n"
    "\nSources:\n"
    "- Concrete Problems in AI Safety (https://arxiv.org/abs/1606.06565): frames the desiderata; evidence: high\n"
    "\nCITATION RULE: cite ONLY sources from this fetched list.\n"
    "- Concrete Problems in AI Safety <https://arxiv.org/abs/1606.06565>"
)

FEEDBACK = (
    "Recurring reviewer concerns from the last cycle (fix these):\n"
    "- The mechanism assumes an oracle task boundary.\n"
    "What won debates last cycle (favor these qualities):\n"
    "- Sharper falsification thresholds won three of four debates."
)


def _hyp(i, title, statement, elo, *, reviewed=True, corr=7, nov=7, test=8, safe=True):
    return {
        "id": i,
        "title": title,
        "statement": statement,
        "rationale": "Fills the gap the survey names in section 4.",
        "experiment": "Train on the stream, ablate the buffer.",
        "design": "Build the buffer on top of an ER baseline; ablate size; compare on Split-CIFAR100.",
        "metric": "average accuracy over all seen tasks after the final task",
        "expected_effect": "we predict up to ~8 points over ER",
        "falsification": "below +8 points average accuracy versus ER",
        "elo": elo,
        "reviews": ({
            "correctness": corr, "novelty": nov, "testability": test,
            "safety_ok": safe, "critique": "Sound but the boundary oracle is load-bearing.",
        } if reviewed else {}),
        "reviewed": reviewed,
    }


POOL = [
    _hyp(0, "Entropy-Gated Replay (EGR)", "Gate replay writes on predictive entropy.", 1246.0),
    _hyp(1, "Sparse Index Consolidation (SIC)", "Consolidate the retrieval index, not the weights.", 1223.0),
    _hyp(2, "Task-Agnostic Rehearsal (TAR)", "Rehearse without task boundaries at all.", 1188.0,
         reviewed=False),
    _hyp(3, "Low Novelty Baseline (LNB)", "Just do experience replay again.", 1205.0, nov=3),
    _hyp(4, "Unsafe Direction (UD)", "Self-modify the reward channel.", 1260.0, safe=False),
]

STATE = {
    "pool": POOL,
    "cycle": 2,
    "next_id": 5,
    "literature": LIT_TEXT,
    "sources": [
        {"title": "Concrete Problems in AI Safety", "url": "https://arxiv.org/abs/1606.06565",
         "fetched": True, "takeaway": "frames the desiderata; evidence: high"},
        {"title": "Vendor Whitepaper", "url": "https://example.com/whitepaper",
         "fetched": False, "takeaway": "marketing claims only; not fetched: paywalled"},
    ],
    "open_questions": INVESTIGATION_OK["open_questions"],
    "grounding_ok": True,
    "warnings": [],
    "feedback": FEEDBACK,
    "elo_history": [
        {"cycle": 1, "best": 1231, "top3_mean": 1214, "pool": 5},
        {"cycle": 2, "best": 1260, "top3_mean": 1236, "pool": 5},
    ],
}

REVIEWS = {"reviews": [
    {"id": 0, "correctness": 8, "novelty": 7, "testability": 9, "safety_ok": True,
     "critique": "The gate is well specified; the entropy estimator is the weak link."},
    {"id": 2, "correctness": 4, "novelty": 8, "testability": 6, "safety_ok": True,
     "critique": "Boundary-free rehearsal is not shown to converge."},
]}

MATCHES = {"matches": [
    {"a": 0, "b": 1, "winner": 0, "reason": "sharper falsification threshold"},
    {"a": 1, "b": 2, "winner": 1, "reason": "the baseline is named and standard"},
    {"a": 0, "b": 4, "winner": 0, "reason": "safety concern is disqualifying"},
]}

EVOLVED = {"hypotheses": [{
    "title": "Entropy-Gated Replay with Budgeted Index (EGR-BI)",
    "statement": "Combine the entropy gate with a fixed-size index budget. [UNREVIEWED]",
    "rationale": "Merges the two strongest directions (Elo 1246).",
    "experiment": "Ablate gate and budget independently.",
    "design": "ER + gate + budget on Split-CIFAR100 against ER and DER++.",
    "metric": "average accuracy after the final task",
    "expected_effect": "we predict up to ~HYPOTHESIZED 10 points over ER",
    "falsification": "below HYPOTHESIZED +10 points average accuracy versus ER",
}]}

EXPANDED = {"hypotheses": [{
    "title": "Curriculum-Ordered Consolidation (COC)",
    "statement": "Order consolidation by task difficulty rather than recency.",
    "rationale": "Opens the scheduling axis the pool ignores.",
    "experiment": "Reorder the consolidation schedule.",
    "design": "Difficulty-sorted schedule vs recency on Split-CIFAR100 against ER.",
    "metric": "average accuracy after the final task",
    "expected_effect": "we predict up to ~5 points over recency ordering",
    "falsification": "below +5 points average accuracy versus recency ordering",
}]}

RANKED = [
    {"rank": 1, "elo": 1246, "reviewed": True, "flags": [],
     "title": "Entropy-Gated Replay (EGR)",
     "statement": "Gate replay writes on predictive entropy.",
     "rationale": "Fills the gap the survey names in section 4.",
     "experiment": "Train on the stream, ablate the buffer.",
     "design": "Build the buffer on top of an ER baseline; ablate size; compare on Split-CIFAR100.",
     "metric": "average accuracy over all seen tasks after the final task",
     "expected_effect": "we predict up to ~8 points over ER",
     "falsification": "below +8 points average accuracy versus ER",
     "reviews": {"correctness": 8, "novelty": 7, "testability": 9, "safety_ok": True,
                 "critique": "The gate is well specified; the entropy estimator is the weak link."}},
    {"rank": 2, "elo": 1223, "reviewed": True, "flags": ["sibling"],
     "title": "Sparse Index Consolidation (SIC)",
     "statement": "Consolidate the retrieval index, not the weights.",
     "rationale": "Fills the gap the survey names in section 4.",
     "experiment": "Train on the stream, ablate the buffer.",
     "design": "", "metric": "", "expected_effect": "", "falsification": "",
     "reviews": {"correctness": 7, "novelty": 7, "testability": 8, "safety_ok": True,
                 "critique": "Sound but the boundary oracle is load-bearing."}},
    {"rank": 3, "elo": 1205, "reviewed": True, "flags": ["low_novelty"],
     "title": "Low Novelty Baseline (LNB)",
     "statement": "Just do experience replay again.",
     "rationale": "", "experiment": "", "design": "", "metric": "",
     "expected_effect": "", "falsification": "",
     "reviews": {"correctness": 7, "novelty": 3, "testability": 8, "safety_ok": True,
                 "critique": "Already the standard baseline."}},
    {"rank": 4, "elo": 1188, "reviewed": False, "flags": ["unreviewed"],
     "title": "Task-Agnostic Rehearsal (TAR)",
     "statement": "Rehearse without task boundaries at all.",
     "rationale": "", "experiment": "", "design": "", "metric": "",
     "expected_effect": "", "falsification": "", "reviews": {}},
]

FINAL_OK = {
    "ranked_hypotheses": RANKED,
    "top": RANKED[0],
    "cycles": 3,
    "pool_size": 4,
    "sources": STATE["sources"],
    "literature": LIT_TEXT,
    "grounding_ok": True,
    "warnings": ["#FALLBACK: 1 finalist(s) reached the ranking without a completed review; flagged 'unreviewed' and demoted below reviewed hypotheses."],
    "elo_history": STATE["elo_history"],
}

FINAL_UNGROUNDED = dict(FINAL_OK, grounding_ok=False, sources=[], literature="",
                        warnings=["#FALLBACK: literature grounding fetched 0 real sources this run."])

OVERVIEW = (
    "TITLE: Entropy Gating as the Frontier of Continual Skill Retention\n"
    "\n"
    "ABSTRACT: The tournament surfaced four directions, of which entropy-gated replay is the "
    "strongest sound and novel candidate.\n"
    "\n"
    "## Most promising directions\n"
    "Entropy-Gated Replay leads because its falsification threshold is the sharpest.\n"
)

ARCH_FIG = {"rendered": True, "png_path": "reports/figures/architecture-2026-07-31T09-00-00.png",
            "pdf_path": "reports/figures/architecture.pdf", "warnings": []}
ARCH_META = {"title": "Figure 1 - Proposed architecture",
             "caption": "The three mechanisms compose into one retention pipeline."}
ELO_FIG = {"rendered": True, "png_path": "reports/figures/elo-trajectory-2026-07-31T09-00-00.png",
           "pdf_path": "reports/figures/elo.pdf", "warnings": []}

CITE_CHECKS = [
    {"url": "https://arxiv.org/abs/1606.06565", "claimed": "Concrete Problems in AI Safety",
     "fetched_title": "[1606.06565] Concrete Problems in AI Safety", "verdict": "verified",
     "reason": "arXiv title matches"},
    {"url": "https://example.com/whitepaper", "claimed": "Vendor Whitepaper",
     "fetched_title": "EfficientNet", "verdict": "mismatch",
     "reason": 'claimed "Vendor Whitepaper" but the page serves "EfficientNet"'},
]

LIT_VARS_OK = {
    "lit_text": LIT_TEXT,
    "lit_sources": [
        {"title": "Concrete Problems in AI Safety", "url": "https://arxiv.org/abs/1606.06565",
         "fetched": True, "takeaway": "frames the desiderata; evidence: high"},
        {"title": "Vendor Whitepaper", "url": "https://example.com/whitepaper",
         "fetched": True, "takeaway": "marketing claims only"},
    ],
    "lit_warnings": [],
}

FIG_SPEC_RAW = {
    "kind": "layered",
    "title": "Figure 1 - Proposed architecture",
    "caption": "How the mechanisms compose [see text]",
    "layers": [
        {"label": "Input", "nodes": [{"id": "stream", "label": "Task stream"}]},
        {"label": "Retention", "nodes": [{"id": "egr", "label": "Entropy-Gated Replay (EGR)"},
                                         {"id": "sic", "label": "Sparse Index Consolidation (SIC)"}]},
        {"label": "Eval", "nodes": [{"id": "acc", "label": "Average accuracy"}]},
    ],
    "edges": [
        {"from": "stream", "to": "egr", "label": "writes", "style": "solid"},
        {"from": "egr", "to": "sic", "label": "consolidates", "style": "dashed"},
        {"from": "ghost", "to": "acc", "label": "drops", "style": "solid"},
    ],
}


# --------------------------------------------------------------------------
# the cases
# --------------------------------------------------------------------------
# node       : OLD node id (0.1.16 flow)
# new_node   : NEW node id (0.2.0 flow); defaults to `node`
# inputs     : data pins fed on the OLD side (pin defaults are merged in)
# new_inputs : data pins fed on the NEW side; defaults to `inputs`
# old_path   : dotted path into the OLD result; "" = the whole return value
# new_path   : dotted path into the NEW result

CASES: list[dict] = [
    # ---- literature base -------------------------------------------------
    {"name": "lit_base.grounded.text", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_OK}, "old_path": "text", "new_path": "updates.lit_text"},
    {"name": "lit_base.grounded.allowed", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_OK}, "old_path": "allowed_citations",
     "new_path": "updates.lit_allowed_citations"},
    {"name": "lit_base.grounded.sources", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_OK}, "old_path": "sources",
     "new_path": "updates.lit_sources"},
    {"name": "lit_base.grounded.flags", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_OK}, "old_path": "grounding_ok",
     "new_path": "updates.lit_grounding_ok"},
    {"name": "lit_base.empty.text", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_EMPTY}, "old_path": "text",
     "new_path": "updates.lit_text"},
    {"name": "lit_base.empty.warnings", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_EMPTY}, "old_path": "warnings",
     "new_path": "updates.lit_warnings"},
    {"name": "lit_base.empty.needs_retry", "node": "lit_base",
     "inputs": {"investigation": INVESTIGATION_EMPTY}, "old_path": "needs_retry",
     "new_path": "updates.lit_grounding_ok", "negate_new": True},

    # ---- retry pick ------------------------------------------------------
    {"name": "lit_pick.retry_ok.warnings", "node": "lit_pick",
     "inputs": {"first": {"grounding_ok": False, "warnings": ["#FALLBACK: first failed"]},
                "second": {"grounding_ok": True, "text": "retry text", "warnings": []}},
     "old_path": "warnings",
     "new_node": "lit_pick",
     "new_inputs": {"retry_updates": {"lit_grounding_ok": True, "lit_text": "retry text",
                                      "lit_warnings": []},
                    "first_warnings": ["#FALLBACK: first failed"]},
     "new_path": "updates.lit_warnings"},
    {"name": "lit_pick.retry_failed.warnings", "node": "lit_pick",
     "inputs": {"first": {"grounding_ok": False, "warnings": ["#FALLBACK: first failed"],
                          "text": "first text"},
                "second": {"grounding_ok": False, "warnings": ["#FALLBACK: retry failed too"]}},
     "old_path": "warnings",
     "new_inputs": {"retry_updates": {"lit_grounding_ok": False, "lit_warnings": []},
                    "first_warnings": ["#FALLBACK: first failed"]},
     "new_path": "updates.lit_warnings"},

    # ---- citation verification ------------------------------------------
    {"name": "cite_items.items", "node": "cite_items",
     "inputs": {"lit": {"sources": LIT_VARS_OK["lit_sources"]}},
     "new_inputs": {"sources": LIT_VARS_OK["lit_sources"]},
     "old_path": "items", "new_path": "items"},
    {"name": "cite_args.arxiv_pdf", "node": "cite_args",
     "inputs": {"item": {"url": "https://arxiv.org/pdf/1802.07569.pdf", "title": "Survey"}},
     "old_path": "tool_call", "new_path": "tool_call"},
    {"name": "cite_fold.verified", "node": "cite_fold",
     "inputs": {"item": {"url": "https://arxiv.org/abs/1606.06565",
                         "title": "Concrete Problems in AI Safety"},
                "raw": {"results": [{"success": True, "output": {
                    "status_code": 200, "title": "[1606.06565] Concrete Problems in AI Safety",
                    "description": "We discuss accident risk."}}]},
                "acc": []},
     "old_path": "acc", "new_path": "updates.cite_checks"},
    {"name": "cite_fold.mismatch", "node": "cite_fold",
     "inputs": {"item": {"url": "https://arxiv.org/abs/1905.11946",
                         "title": "Concrete Problems in AI Safety"},
                "raw": {"results": [{"success": True, "output": {
                    "status_code": 200, "title": "[1905.11946] EfficientNet: Rethinking Model Scaling",
                    "description": "Compound scaling."}}]},
                "acc": []},
     "old_path": "acc", "new_path": "updates.cite_checks"},
    {"name": "cite_fold.unreachable", "node": "cite_fold",
     "inputs": {"item": {"url": "https://example.com/gone", "title": "Vendor Whitepaper"},
                "raw": {"results": [{"success": True, "output": {"status_code": 404, "title": ""}}]},
                "acc": []},
     "old_path": "acc", "new_path": "updates.cite_checks"},
    {"name": "cite_apply.text", "node": "cite_apply",
     "inputs": {"lit": {"text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"], "warnings": []},
                "checks": CITE_CHECKS},
     "new_inputs": {"lit_text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"],
                    "warnings": [], "checks": CITE_CHECKS},
     "old_path": "text", "new_path": "updates.lit_text"},
    {"name": "cite_apply.warnings", "node": "cite_apply",
     "inputs": {"lit": {"text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"], "warnings": []},
                "checks": CITE_CHECKS},
     "new_inputs": {"lit_text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"],
                    "warnings": [], "checks": CITE_CHECKS},
     "old_path": "warnings", "new_path": "updates.lit_warnings"},
    {"name": "cite_apply.sources", "node": "cite_apply",
     "inputs": {"lit": {"text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"], "warnings": []},
                "checks": CITE_CHECKS},
     "new_inputs": {"lit_text": LIT_TEXT, "sources": LIT_VARS_OK["lit_sources"],
                    "warnings": [], "checks": CITE_CHECKS},
     "old_path": "sources", "new_path": "updates.lit_sources"},
    {"name": "cite_apply.zero_sources.text", "node": "cite_apply",
     "inputs": {"lit": {"text": "(no literature grounding was gathered)", "sources": [],
                        "warnings": ["#FALLBACK: nothing fetched"]}, "checks": []},
     "new_inputs": {"lit_text": "(no literature grounding was gathered)", "sources": [],
                    "warnings": ["#FALLBACK: nothing fetched"], "checks": []},
     "old_path": "text", "new_path": "updates.lit_text"},

    # ---- generation ------------------------------------------------------
    {"name": "gen_prompt.grounded", "node": "gen_prompt",
     "inputs": {"research_goal": GOAL, "num_hypotheses": 5, "literature": LIT_TEXT},
     "old_path": "", "new_path": "prompt"},
    {"name": "gen_prompt.ungrounded", "node": "gen_prompt",
     "inputs": {"research_goal": GOAL, "num_hypotheses": 3, "literature": ""},
     "old_path": "", "new_path": "prompt"},

    # ---- pool init + views ----------------------------------------------
    {"name": "init_state.pool", "node": "init_state",
     "inputs": {"generated": {"hypotheses": EVOLVED["hypotheses"] + EXPANDED["hypotheses"]},
                "literature_text": LIT_TEXT, "sources": STATE["sources"],
                "open_questions": STATE["open_questions"], "grounding_ok": True, "warnings": []},
     "new_inputs": {"generated": {"hypotheses": EVOLVED["hypotheses"] + EXPANDED["hypotheses"]}},
     "old_path": "pool", "new_path": "updates.pool"},
    {"name": "pool_text.decorated", "node": "pool_text",
     "inputs": {"loop_state": STATE}, "new_inputs": {"pool": POOL},
     "old_path": "decorated", "new_path": "decorated"},
    {"name": "pool_text.clean", "node": "pool_text",
     "inputs": {"loop_state": STATE}, "new_inputs": {"pool": POOL},
     "old_path": "clean", "new_path": "clean"},
    {"name": "rank_pairs.text", "node": "rank_pairs",
     "inputs": {"loop_state": STATE}, "new_inputs": {"pool": POOL},
     "old_path": "text", "new_path": "text"},

    # ---- evolution strategy rotation ------------------------------------
    {"name": "strategy.cycle0", "node": "ctx", "inputs": {"loop_state": dict(STATE, cycle=0)},
     "new_node": "cycle_strategy", "new_inputs": {"cycle": 0},
     "old_path": "strategy", "new_path": "strategy"},
    {"name": "strategy.cycle1", "node": "ctx", "inputs": {"loop_state": dict(STATE, cycle=1)},
     "new_node": "cycle_strategy", "new_inputs": {"cycle": 1},
     "old_path": "strategy", "new_path": "strategy"},
    {"name": "strategy.cycle2", "node": "ctx", "inputs": {"loop_state": dict(STATE, cycle=2)},
     "new_node": "cycle_strategy", "new_inputs": {"cycle": 2},
     "old_path": "strategy", "new_path": "strategy"},
    {"name": "strategy.cycle3", "node": "ctx", "inputs": {"loop_state": dict(STATE, cycle=3)},
     "new_node": "cycle_strategy", "new_inputs": {"cycle": 3},
     "old_path": "strategy", "new_path": "strategy"},
    {"name": "strategy.cycle4wrap", "node": "ctx", "inputs": {"loop_state": dict(STATE, cycle=4)},
     "new_node": "cycle_strategy", "new_inputs": {"cycle": 4},
     "old_path": "strategy", "new_path": "strategy"},

    # ---- supervisor-loop prompts ----------------------------------------
    {"name": "reflect_prompt.full", "node": "reflect_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": LIT_TEXT,
                "feedback": FEEDBACK}, "old_path": "", "new_path": "prompt"},
    {"name": "reflect_prompt.bare", "node": "reflect_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": "",
                "feedback": ""}, "old_path": "", "new_path": "prompt"},
    {"name": "rank_prompt.full", "node": "rank_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "pairs": "- compare [0] vs [1]",
                "feedback": FEEDBACK}, "old_path": "", "new_path": "prompt"},
    {"name": "rank_prompt.bare", "node": "rank_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "pairs": "- compare [0] vs [1]",
                "feedback": ""}, "old_path": "", "new_path": "prompt"},
    {"name": "evolve_prompt.full", "node": "evolve_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": LIT_TEXT,
                "feedback": FEEDBACK, "strategy": "COMBINATION: merge"},
     "old_path": "", "new_path": "prompt"},
    {"name": "evolve_prompt.bare", "node": "evolve_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": "",
                "feedback": "", "strategy": ""}, "old_path": "", "new_path": "prompt"},
    {"name": "expand_prompt.full", "node": "expand_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": LIT_TEXT,
                "open_questions": STATE["open_questions"], "feedback": FEEDBACK},
     "old_path": "", "new_path": "prompt"},
    {"name": "expand_prompt.bare", "node": "expand_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": "",
                "open_questions": [], "feedback": ""}, "old_path": "", "new_path": "prompt"},

    # ---- fold ------------------------------------------------------------
    {"name": "fold.pool", "node": "fold",
     "inputs": {"loop_state": STATE, "reviews": REVIEWS, "matches": MATCHES,
                "evolved": EVOLVED, "expanded": EXPANDED},
     "new_inputs": {"pool": POOL, "cycle": 2, "next_id": 5,
                    "elo_history": STATE["elo_history"], "reviews": REVIEWS,
                    "matches": MATCHES, "evolved": EVOLVED, "expanded": EXPANDED},
     "old_path": "pool", "new_path": "updates.pool"},
    {"name": "fold.feedback", "node": "fold",
     "inputs": {"loop_state": STATE, "reviews": REVIEWS, "matches": MATCHES,
                "evolved": EVOLVED, "expanded": EXPANDED},
     "new_inputs": {"pool": POOL, "cycle": 2, "next_id": 5,
                    "elo_history": STATE["elo_history"], "reviews": REVIEWS,
                    "matches": MATCHES, "evolved": EVOLVED, "expanded": EXPANDED},
     "old_path": "feedback", "new_path": "updates.feedback"},
    {"name": "fold.elo_history", "node": "fold",
     "inputs": {"loop_state": STATE, "reviews": REVIEWS, "matches": MATCHES,
                "evolved": EVOLVED, "expanded": EXPANDED},
     "new_inputs": {"pool": POOL, "cycle": 2, "next_id": 5,
                    "elo_history": STATE["elo_history"], "reviews": REVIEWS,
                    "matches": MATCHES, "evolved": EVOLVED, "expanded": EXPANDED},
     "old_path": "elo_history", "new_path": "updates.elo_history"},

    # ---- terminal review -------------------------------------------------
    {"name": "term_pool_text.decorated", "node": "term_pool_text",
     "inputs": {"loop_state": STATE}, "new_inputs": {"pool": POOL},
     "old_path": "decorated", "new_path": "decorated"},
    {"name": "term_reflect_prompt", "node": "term_reflect_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT"},
     "old_path": "", "new_path": "prompt"},
    {"name": "term_rank_prompt", "node": "term_rank_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT"},
     "old_path": "", "new_path": "prompt"},
    {"name": "term_fold.pool", "node": "term_fold",
     "inputs": {"loop_state": STATE, "reviews": REVIEWS, "matches": MATCHES},
     "new_inputs": {"pool": POOL, "cycle": 3, "elo_history": STATE["elo_history"],
                    "reviews": REVIEWS, "matches": MATCHES},
     "old_path": "pool", "new_path": "updates.pool"},

    # ---- final ranking ---------------------------------------------------
    {"name": "final.ranked", "node": "final", "inputs": {"loop_state": STATE},
     "new_inputs": {"pool": POOL, "cycle": 3, "warnings": [], "elo_history": STATE["elo_history"]},
     "old_path": "ranked_hypotheses", "new_path": "updates.ranked_hypotheses"},
    {"name": "final.warnings", "node": "final", "inputs": {"loop_state": STATE},
     "new_inputs": {"pool": POOL, "cycle": 3, "warnings": [], "elo_history": STATE["elo_history"]},
     "old_path": "warnings", "new_path": "updates.final_warnings"},
    {"name": "final.top", "node": "final", "inputs": {"loop_state": STATE},
     "new_inputs": {"pool": POOL, "cycle": 3, "warnings": [], "elo_history": STATE["elo_history"]},
     "old_path": "top", "new_path": "updates.top_hypothesis"},

    # ---- meta-review -----------------------------------------------------
    {"name": "meta_prompt.grounded", "node": "meta_prompt",
     "inputs": {"research_goal": GOAL, "final": FINAL_OK},
     "new_inputs": {"research_goal": GOAL, "ranked_hypotheses": RANKED,
                    "literature": LIT_TEXT, "grounding_ok": True},
     "old_path": "", "new_path": "prompt"},
    {"name": "meta_prompt.ungrounded", "node": "meta_prompt",
     "inputs": {"research_goal": GOAL, "final": FINAL_UNGROUNDED},
     "new_inputs": {"research_goal": GOAL, "ranked_hypotheses": RANKED,
                    "literature": "", "grounding_ok": False},
     "old_path": "", "new_path": "prompt"},

    # ---- figures ---------------------------------------------------------
    {"name": "fig_spec_prompt", "node": "fig_spec_prompt",
     "inputs": {"final": FINAL_OK, "research_goal": GOAL},
     "new_inputs": {"ranked_hypotheses": RANKED, "research_goal": GOAL},
     "old_path": "", "new_path": "prompt"},
    {"name": "fig_fold.spec", "node": "fig_fold", "inputs": {"data": FIG_SPEC_RAW},
     "old_path": "spec", "new_path": "spec"},
    {"name": "fig_fold.caption", "node": "fig_fold", "inputs": {"data": FIG_SPEC_RAW},
     "old_path": "caption", "new_path": "caption"},
    {"name": "elo_spec.spec", "node": "elo_spec", "inputs": {"final": FINAL_OK},
     "new_inputs": {"elo_history": STATE["elo_history"]},
     "old_path": "spec", "new_path": "spec"},
    {"name": "arch_input.basename", "node": "arch_input",
     "inputs": {"spec": FIG_SPEC_RAW, "ts": "2026-07-31T09-00-00"},
     "new_inputs": {"spec": FIG_SPEC_RAW, "stamp": "2026-07-31T09-00-00"},
     "old_path": "basename", "new_path": "basename"},
    {"name": "arch_input.spec", "node": "arch_input",
     "inputs": {"spec": FIG_SPEC_RAW, "ts": "2026-07-31T09-00-00"},
     "new_inputs": {"spec": FIG_SPEC_RAW, "stamp": "2026-07-31T09-00-00"},
     "old_path": "spec", "new_path": "spec"},
    {"name": "elo_input.basename", "node": "elo_input",
     "inputs": {"spec": {"kind": "line"}, "ts": "2026-07-31T09-00-00"},
     "new_inputs": {"spec": {"kind": "line"}, "stamp": "2026-07-31T09-00-00"},
     "old_path": "basename", "new_path": "basename"},

    # ---- report assembly + export ---------------------------------------
    {"name": "report_md.grounded_with_figures", "node": "report_md", "composite": "report",
     "inputs": {"research_goal": GOAL, "overview": OVERVIEW, "final": FINAL_OK,
                "arch_fig": ARCH_FIG, "arch_meta": ARCH_META, "elo_fig": ELO_FIG},
     "new_inputs": {"research_goal": GOAL, "overview": OVERVIEW,
                    "ranked_hypotheses": RANKED, "sources": FINAL_OK["sources"],
                    "warnings": FINAL_OK["warnings"], "cycles": 3, "fetched_count": 1,
                    "elo_history": STATE["elo_history"], "grounding_ok": True,
                    "arch_rendered": True, "arch_png_path": ARCH_FIG["png_path"],
                    "arch_warnings": [], "arch_title": ARCH_META["title"],
                    "arch_caption": ARCH_META["caption"], "elo_warnings": [],
                    "elo_rendered": True, "elo_png_path": ELO_FIG["png_path"]},
     "old_path": "", "new_path": "report"},
    {"name": "report_md.ungrounded_no_figures", "node": "report_md", "composite": "report",
     "inputs": {"research_goal": GOAL, "overview": "## Body only\nNo title line here.",
                "final": FINAL_UNGROUNDED, "arch_fig": {}, "arch_meta": {}, "elo_fig": {}},
     "new_inputs": {"research_goal": GOAL, "overview": "## Body only\nNo title line here.",
                    "ranked_hypotheses": RANKED, "sources": [],
                    "warnings": FINAL_UNGROUNDED["warnings"], "cycles": 3,
                    "fetched_count": 0, "elo_history": STATE["elo_history"],
                    "grounding_ok": False, "arch_rendered": False, "arch_png_path": "",
                    "arch_warnings": [], "arch_title": "", "arch_caption": "",
                    "elo_warnings": [], "elo_rendered": False, "elo_png_path": ""},
     "old_path": "", "new_path": "report"},
    {"name": "report_md.verified_sources", "node": "report_md", "composite": "report",
     "inputs": {"research_goal": GOAL, "overview": OVERVIEW,
                "final": dict(FINAL_OK, sources=[
                    {"title": "Concrete Problems in AI Safety",
                     "url": "https://arxiv.org/abs/1606.06565", "fetched": True,
                     "verification": "verified", "takeaway": "frames the desiderata"},
                    {"title": "Vendor Whitepaper", "url": "https://example.com/whitepaper",
                     "fetched": False, "verification": "mismatch",
                     "takeaway": "marketing [citation check FAILED: title mismatch]"}]),
                "arch_fig": {}, "arch_meta": {}, "elo_fig": {}},
     "new_inputs": {"research_goal": GOAL, "overview": OVERVIEW,
                    "ranked_hypotheses": RANKED,
                    "sources": [
                        {"title": "Concrete Problems in AI Safety",
                         "url": "https://arxiv.org/abs/1606.06565", "fetched": True,
                         "verification": "verified", "takeaway": "frames the desiderata"},
                        {"title": "Vendor Whitepaper", "url": "https://example.com/whitepaper",
                         "fetched": False, "verification": "mismatch",
                         "takeaway": "marketing [citation check FAILED: title mismatch]"}],
                    "warnings": FINAL_OK["warnings"], "cycles": 3, "fetched_count": 1,
                    "elo_history": STATE["elo_history"], "grounding_ok": True,
                    "arch_rendered": False, "arch_png_path": "", "arch_warnings": [],
                    "arch_title": "", "arch_caption": "", "elo_warnings": [],
                    "elo_rendered": False, "elo_png_path": ""},
     "old_path": "", "new_path": "report"},
    {"name": "export_paths", "node": "export_paths",
     "inputs": {"iso": "2026-07-31T09:00:00.123456+00:00"},
     "new_inputs": {"stamp": "2026-07-31T09-00-00-123456_00-00"},
     "old_path": "md", "new_path": "md"},
    {"name": "report_title.derived", "node": "report_title", "new_node": "report_head",
     "inputs": {"overview": OVERVIEW},
     "new_inputs": {"overview": OVERVIEW, "research_goal": GOAL, "cycles": 3,
                    "warnings": [], "arch_rendered": False, "arch_png_path": "",
                    "arch_warnings": [], "arch_title": "", "arch_caption": "",
                    "elo_warnings": []},
     "old_path": "", "new_path": "doc_title"},
    {"name": "report_title.fallback", "node": "report_title", "new_node": "report_head",
     "inputs": {"overview": "no title line"},
     "new_inputs": {"overview": "no title line", "research_goal": GOAL, "cycles": 3,
                    "warnings": [], "arch_rendered": False, "arch_png_path": "",
                    "arch_warnings": [], "arch_title": "", "arch_caption": "",
                    "elo_warnings": []},
     "old_path": "", "new_path": "doc_title"},
    # the filename-safe stamp moved from export_paths into freeze_ts, so the
    # figure basenames and the report filenames share ONE frozen instant
    {"name": "freeze_ts.stamp", "node": "export_paths", "new_node": "freeze_ts",
     "inputs": {"iso": "2026-07-31T09:00:00.123456+00:00"},
     "new_inputs": {"iso": "2026-07-31T09:00:00.123456+00:00"},
     "old_path": "timestamp", "new_path": "updates.run_timestamp"},
]


# --------------------------------------------------------------------------
# ADR-0026 re-capture (co-scientist 0.2.1, operator ruling 2026-09-28)
# --------------------------------------------------------------------------
# 0.2.1 removes every count and char cap on what a model reads (and the cuts in
# the citation-check strings). NONE of the 63 cases above changes by a single
# byte: no fixture above reached a removed cap (the longest literature is far
# under 2,500 chars, no pool has more than 5 ranked rows, no critique is over
# 300 chars, ...). So the removals would pass the golden unseen. The cases
# below feed inputs PAST each removed cap. Their golden values were captured
# from the 0.2.1 flow and checked against the 0.2.0 flow: on 0.2.0 each one
# differs exactly by the cut it names (verified by a scratch capture that
# rebuilt the 0.2.0 value, applied the old slice to the 0.2.1 inputs, and
# compared). They have no 0.1.16 counterpart, so `node` IS the shipped node.

def _words(tag, n):
    return " ".join(f"{tag}{i}" for i in range(n))


# a claimed title over 60 chars and an arXiv page title over 80 chars, no overlap
ADR26_LONG_CLAIMED = "Continual Skill Retention Under Unbounded Task Streams With Entropy Gating"
ADR26_LONG_SERVED = ("[2101.00001] Photonic Lattice Solitons in Nonlinear Waveguide Arrays: "
                     "A Comprehensive Experimental Survey")
# a dropped source whose title is over 70 chars
ADR26_DROPPED_TITLE = ("Vendor Whitepaper on Retrieval-Augmented Consolidation for Enterprise "
                       "Knowledge Workers, Second Edition")
ADR26_CHECKS = [
    {"url": "https://example.com/long", "claimed": ADR26_DROPPED_TITLE,
     "fetched_title": "Unrelated", "verdict": "mismatch",
     "reason": 'claimed "' + ADR26_DROPPED_TITLE + '" but the page serves "Unrelated"'},
]
ADR26_SOURCES = [{"title": ADR26_DROPPED_TITLE, "url": "https://example.com/long",
                  "fetched": True, "takeaway": "enterprise claims"}]

# eight reviews with critiques over 400 chars, eight debates with reasons over
# 300 chars (the old fold kept 6 of each, cut to 400 / 300)
ADR26_REVIEWS = {"reviews": [
    {"id": i % 5, "correctness": 7, "novelty": 7, "testability": 7, "safety_ok": True,
     "critique": f"Critique {i}: " + _words(f"c{i}w", 80)}
    for i in range(8)]}
ADR26_MATCHES = {"matches": [
    {"a": i % 5, "b": (i + 1) % 5, "winner": i % 5, "reason": f"Debate {i}: " + _words(f"d{i}w", 60)}
    for i in range(8)]}

# nine open questions (the old expansion prompt listed 6)
ADR26_OPEN_QUESTIONS = [f"Open question {i}: does mechanism {i} scale?" for i in range(9)]

# a literature base over 2,500 chars (the old meta-review cut it there)
ADR26_LONG_LIT = LIT_TEXT + "\n" + "\n".join(
    f"- Finding {i}: " + _words(f"lit{i}w", 30) for i in range(20))


def _ranked_row(rank, elo):
    # statements over 200 chars, reviewer notes over 300 chars
    return {"rank": rank, "elo": elo, "reviewed": True, "flags": [],
            "title": f"Direction {rank}",
            "statement": f"Statement {rank}: " + _words(f"s{rank}w", 50),
            "rationale": "", "experiment": "", "design": "", "metric": "",
            "expected_effect": "", "falsification": "",
            "reviews": {"correctness": 7, "novelty": 7, "testability": 7, "safety_ok": True,
                        "critique": f"Note {rank}: " + _words(f"n{rank}w", 70)}}


# seven ranked hypotheses (the old meta-review and figure prompt read the top 5)
ADR26_RANKED = [_ranked_row(r, 1300 - 10 * r) for r in range(1, 8)]

_FOLD_ADR26_INPUTS = {"pool": POOL, "cycle": 2, "next_id": 5,
                      "elo_history": STATE["elo_history"], "reviews": ADR26_REVIEWS,
                      "matches": ADR26_MATCHES, "evolved": {"hypotheses": []},
                      "expanded": {"hypotheses": []}}

CASES += [
    {"name": "adr26.cite_fold.mismatch_whole_titles", "node": "cite_fold",
     "inputs": {"item": {"url": "https://arxiv.org/abs/2101.00001", "title": ADR26_LONG_CLAIMED},
                "raw": {"results": [{"success": True, "output": {
                    "status_code": 200, "title": ADR26_LONG_SERVED, "description": "Optics."}}]},
                "acc": []},
     "new_path": "updates.cite_checks"},
    {"name": "adr26.cite_apply.warning_whole_title", "node": "cite_apply",
     "inputs": {"lit_text": LIT_TEXT, "sources": ADR26_SOURCES, "warnings": [],
                "checks": ADR26_CHECKS},
     "new_path": "updates.lit_warnings"},
    {"name": "adr26.fold.feedback_every_critique_whole", "node": "fold",
     "inputs": _FOLD_ADR26_INPUTS, "new_path": "updates.feedback"},
    {"name": "adr26.expand_prompt.every_open_question", "node": "expand_prompt",
     "inputs": {"research_goal": GOAL, "pool_text": "POOLTEXT", "literature": "",
                "open_questions": ADR26_OPEN_QUESTIONS, "feedback": ""},
     "new_path": "prompt"},
    {"name": "adr26.meta_prompt.every_ranked_whole", "node": "meta_prompt",
     "inputs": {"research_goal": GOAL, "ranked_hypotheses": ADR26_RANKED,
                "literature": ADR26_LONG_LIT, "grounding_ok": True},
     "new_path": "prompt"},
    {"name": "adr26.fig_spec_prompt.every_ranked_whole", "node": "fig_spec_prompt",
     "inputs": {"ranked_hypotheses": ADR26_RANKED, "research_goal": GOAL},
     "new_path": "prompt"},
]
