#!/usr/bin/env python3
"""co-scientist workflow: a deep VisualFlow replica of the Nature 2026 'AI
co-scientist' (Gemini) multi-agent hypothesis engine
(nature.com/articles/s41586-026-10644-y; arXiv:2502.18864).

This is a genuinely multi-stage, test-time-compute-scaling system - by design
it does MORE orchestration than a single-pass deep-research report, because
the paper's contribution is exactly that: generate -> critique -> rank ->
evolve, iterated, with feedback threaded forward.

Pipeline (the paper's loop, reproduced):

  GROUNDING (starts from the literature - composition):
    Subflow calls to `deep-plan` + `deep-investigate` (the framework's proven
    web-search investigation engine: an agent iteratively searches/reads real
    sources and returns a source ledger + grounded findings + open questions).

  GENERATION grounded in that literature base.

  SUPERVISOR LOOP (max_cycles, scaling test-time compute):
    reflect -> rank (Elo tournament via simulated scientific debate over a
    deterministically PRIORITIZED pair set) -> evolve (convergent) ->
    generate-expand (divergent) -> fold (reviews, Elo, dedup, meta-feedback).

  TERMINAL FULL REVIEW: a search-grounded AGENT re-reviews the FINALISTS
  against live literature, then a final tournament, then Elo re-applied.

  META-REVIEW synthesizes the finalists + literature into a research overview,
  rendered with professional figures and exported as .md / .pdf / .docx.

===========================================================================
0.2.0 - THE DOCTRINE REWORK (2026-07-31). No behaviour changed; the SHAPE
did. Every composed prompt and every rendered report byte is preserved and
that preservation is GATED (`scripts/coscientist_smoke.py` replays 63 golden
cases captured from 0.1.16 through the real runtime code lane).

What moved, and why:

1. NO STATE BLOBS. The four namespaced blobs (`co.state`, `co.lit`,
   `co.citecheck`, `co.ts`) written by nine `set_var` nodes are gone. Every
   value is its OWN flat top-level run var, written with `set_vars` (one node
   per fold, `updates` dict) and read with a `get_var` CHIP the canvas draws.
   The blob also DUPLICATED the literature inside the tournament state; flat
   vars removed the copy, so `lit_text` has exactly one writer lineage.

2. CODE NODES ARE ON THE EXECUTION LANE. Thirty-seven exec-less code nodes
   became exec nodes (operator ruling 2026-07-30: "code nodes have execution
   pins, otherwise it's a pure function OR a variable access"). Each runs
   ONCE, in exec order, instead of being re-pulled per consumer.

3. PROMPT / REPORT TEXT LIVES IN EDITABLE PIN DEFAULTS with `{{slots}}`.
   133 sentences were lifted out of Python concatenation. A body may now only
   SELECT between texts that live on pins and fill their slots.

4. SUBFLOW CALLS DECLARE ONE PIN PER CHILD FIELD. The five `input`-blob calls
   (deep-plan, deep-investigate x2, diagram-render x2) now wire each field,
   so three whole "compose the child's input object" code nodes disappeared -
   and the investigation BRIEFINGS they carried became editable array pin
   defaults on the subflow node itself.

5. EXPRESSIONS ONLY FOR DERIVATIONS. Two: the supervisor loop's condition
   (`vars.cycle < vars.max_cycles and len(vars.pool) > 0`) and the grounding
   retry gate (`not vars.lit_grounding_ok`). Plain reads are chips, not text.

6. LEGACY `get` NODES ARE GONE. Eight of them: three read subflow results
   (now declared child output pins) and five dug fields out of the final
   ranking object (now flat vars read by chips).

Fidelity note (honest - faithful / simplified / dropped):
  FAITHFUL: literature grounding via real web search (delegated to
    deep-investigate); the six-agent division of labor; the Elo tournament via
    simulated pairwise scientific debate; the TWO feedback channels (Elo state
    + meta-feedback appended to next-cycle prompts); the
    initial-review-then-full-searched-review funnel; a source ledger surfaced
    with the output.
  SIMPLIFIED (disclosed): the async worker queue with adaptive agent-weighting
    is a FIXED synchronous supervisor while-loop; per-cycle reflection judges
    novelty against the SHARED gathered literature base, with the deep
    per-hypothesis LIVE-SEARCH novelty check running ONCE at the end over the
    finalists; the Proximity role is approximated by deterministic
    token-overlap DEDUP only (Jaccard); meta-feedback is deterministic
    aggregation, not a separate meta LLM call. Ranking soundness is enforced
    structurally at the end (a correctness-floor gate demotes unsound or
    unreviewed hypotheses below the headline).
  DROPPED: multi-turn debates for top vs single-turn for the rest; 4 of the
    paper's 6 Reflection review strategies; wet-lab verification;
    expert-in-the-loop; research-contact suggestions.
"""
from __future__ import annotations

import wf_common as W
from wf_common import EXEC_IN, EXEC_OUT, code_node, edge, pin

# ===========================================================================
# EDITABLE TEXT. Every one of these is a PIN DEFAULT on the node that uses it:
# the properties panel edits it as plain text and the `{{slots}}` show which
# runtime value lands where. Nothing here is retyped prose - the block is
# lifted byte-for-byte from the 0.1.16 bodies and gated by the golden.
# ===========================================================================
ARCH_BASENAME_PREFIX_TEXT = "architecture-"
ARCH_OUT_DIR_TEXT = "reports/figures"
CITE_DROPPED_WARNING_TEXT = (
    "#FALLBACK: ledger citation check DROPPED \"{{title}}\" — {{reason}}"
)
CITE_FAILED_SUFFIX_TEXT = " [citation check FAILED: {{reason}}]"
CITE_NONE_LEFT_RULE_TEXT = (
    "CITATION RULE: after verification, NO citable sources remain. You MUST NOT name or cite any specific paper, venue, year, arXiv id, DOI, or whitepaper anywhere in your output; discuss prior work only as unattributed general knowledge."
)
CITE_NONE_LEFT_WARNING_TEXT = (
    "#FALLBACK: citation verification left 0 citable sources; the report proceeds ungrounded."
)
CITE_REVISED_RULE_TEXT = (
    "REVISED CITATION RULE: the sources marked MISMATCH/UNREACHABLE above FAILED verification and MUST NOT be cited anywhere in your output — not by title, id, or url. Cite only the VERIFIED/UNVERIFIED-kept sources."
)
CITE_UNCHECKED_NOTE_TEXT = (
    "NOTE: {{n}} fetched source(s) unexpectedly missed title verification; treat their titles as claimed, not confirmed."
)
CITE_UNCHECKED_WARNING_TEXT = (
    "#FALLBACK: {{n}} fetched source(s) unexpectedly missed citation verification (anomaly — coverage should be total)."
)
CITE_VERIFICATION_HEADING_TEXT = (
    "CITATION VERIFICATION (ledger URLs were fetched and title-checked deterministically):"
)
ELO_BASENAME_PREFIX_TEXT = "elo-trajectory-"
ELO_FIG_CAPTION_TEXT = (
    "Best-hypothesis Elo across supervisor cycles (final point = post-review tournament; y-axis anchored at the 1200 tournament start). Elo is this system's internal self-play debate score - a relative ranking signal, not external validation."
)
ELO_FIG_TITLE_TEXT = "Figure 2 — Tournament trajectory"
ELO_FIG_X_LABEL_TEXT = "supervisor cycle"
ELO_FIG_Y_LABEL_TEXT = "best Elo"
EVOLVE_BRIEF_TEXT = (
    "You are the Evolution agent. Apply THIS cycle's strategy — {{strategy}} — to the TOP hypotheses below to produce 1-2 genuinely IMPROVED hypotheses (not restatements or near-duplicates). An evolved hypothesis must carry a NEW title naming ITS OWN mechanism — never the parent's title with a qualifier. Return the FULL structured form for each: title, statement, rationale, experiment (one-line), and the protocol fields design, metric, expected_effect, falsification (falsification uses the SAME metric/direction as expected_effect with no unadjudicated gap; no vague thresholds). EVIDENCE VERBS: only works in the literature base's citation list may take 'shows/demonstrates/reports'; other hypotheses in this pool take 'proposes/suggests'. Phrase quantitative targets as HYPOTHESIZED/EXPECTED, never as measured results; do not invent precise numbers, benchmark names, or citations not in the literature base."
)
EVOLVE_DEFAULT_STRATEGY_TEXT = "refine or combine"
EVOLVE_FEEDBACK_HEADING_TEXT = "## Feedback from prior cycles (fix these specific flaws)"
EVOLVE_GOAL_HEADING_TEXT = "## Research goal"
EVOLVE_LIT_HEADING_TEXT = "## Literature base"
EVOLVE_POOL_HEADING_TEXT = "## Current top hypotheses"
EXPAND_BRIEF_TEXT = (
    "You are the Generation agent in RESEARCH-EXPANSION mode. Review the hypotheses ALREADY in the pool below and propose 1-2 NOVEL hypotheses in UNEXPLORED areas that the current pool does NOT cover — open a new direction, do not refine an existing one. Ground each in the literature; cite only sources in the literature base; return the FULL structured form (title, statement, rationale, experiment, design, metric, expected_effect, falsification — falsification uses the SAME metric/direction as expected_effect with no unadjudicated gap, no vague thresholds). EVIDENCE VERBS: only cited literature-base works take 'shows/demonstrates'; pool hypotheses take 'proposes/suggests'. Do not invent named benchmarks."
)
EXPAND_FEEDBACK_HEADING_TEXT = (
    "## Recurring issues future hypotheses must address (from prior cycles)"
)
EXPAND_GOAL_HEADING_TEXT = "## Research goal"
EXPAND_LIT_HEADING_TEXT = "## Literature base"
EXPAND_OPEN_HEADING_TEXT = (
    "## Open questions from the literature (good sources of unexplored directions)"
)
EXPAND_POOL_HEADING_TEXT = "## Hypotheses already covered (do NOT duplicate these areas)"
EXPORT_FALLBACK_STAMP_TEXT = "reports/co-scientist-research"
EXPORT_PREFIX_TEXT = "reports/co-scientist-research"
FIG_BRIEF_TEXT = (
    "You are designing ONE professional architecture figure for a research overview. From the top-ranked hypotheses below, produce a LAYERED diagram spec showing how the key proposed mechanisms compose into one system (the pipeline a reader would build). Constraints: 2-4 layers (each layer = a pipeline stage, label <= 28 chars); 1-4 nodes per layer (node label <= 38 chars, the mechanism's short name — include its acronym if it has one); ids are short snake_case; edges ONLY between defined node ids, each edge labeled with a <= 14-char verb phrase or an empty string, style solid for the main path and dashed for optional paths. The title starts with 'Figure 1 — '. The caption is 1-2 sentences a scientist reads under the figure. Use ONLY mechanisms from the hypotheses below plus generic pipeline stages (input, storage, retrieval, generation) — invent nothing else."
)
FIG_FALLBACK_TITLE_TEXT = "Figure 1 — Proposed architecture"
FIG_GOAL_HEADING_TEXT = "## Research goal"
FIG_TOP_HEADING_TEXT = "## Top hypotheses"
FINAL_UNREVIEWED_WARNING_TEXT = (
    "#FALLBACK: {{n}} finalist(s) reached the ranking without a completed review; flagged 'unreviewed' and demoted below reviewed hypotheses."
)
FINAL_UNSAFE_WARNING_TEXT = (
    "#FALLBACK: {{n}} hypothesis(es) were flagged unsafe by the reviewer; flagged 'unsafe' and demoted below all safe hypotheses — do not action without human safety review."
)
FOLD_CRITIQUE_HEADING_TEXT = "Recurring reviewer concerns from the last cycle (fix these):"
FOLD_DEBATE_HEADING_TEXT = "What won debates last cycle (favor these qualities):"
GEN_BRIEF_TEXT = (
    "You are the Generation agent of an AI co-scientist. GROUND your reasoning in the literature base below, then propose {{n}} NOVEL, plausible, testable research hypotheses that go BEYOND what the literature already establishes. Each hypothesis must be a DISTINCT direction — do not propose several variants of the same mechanism. For EACH hypothesis return these fields, and DO NOT restate the title in any other field: title (the mechanism's name); statement (the claim); rationale (connect to the literature — what specific gap it fills); experiment (a one-line summary of the test); design (the experimental SETUP — what system you build, the named baseline(s) you compare against, the ablation(s), and a NAMED dataset or benchmark; NOT the mechanism name again); metric (the exact quantity measured and how it is computed); expected_effect (the HYPOTHESIZED direction/magnitude to be tested); falsification (the concrete result that would REFUTE the hypothesis, with a threshold). FALSIFICATION FORM: the falsification threshold must use the SAME metric and the SAME direction as the expected effect and leave no unadjudicated gap (expected '>= +10%' pairs with falsified 'below +10%', never 'below +3%'); no vague words ('negligible'), no template tokens. EVIDENCE VERBS: only works in the citation list may take 'shows/demonstrates/reports'; anything else — including other hypotheses — takes 'proposes/suggests/hypothesizes'. DATASETS: name only datasets/benchmarks/baselines that exist in the literature base or are broadly standard (MS-COCO, Natural Questions class); if none fits, describe the data to COLLECT instead of inventing a named benchmark. Favor mechanistic specificity and originality over restating known results. IMPORTANT: you have run no experiments — phrase any quantitative target as a HYPOTHESIZED/EXPECTED outcome (e.g. 'we predict up to ~X%'), never as a measured result. Cite only sources present in the literature base's citation list; never invent an arXiv id, DOI, or vendor whitepaper."
)
GEN_GOAL_HEADING_TEXT = "## Research goal"
GEN_LIT_HEADING_TEXT = "## Literature base (ground your hypotheses here)"
GROUND_BUDGET_RULE_TEXT = (
    "BUDGET RULE: you have a hard iteration budget. STOP gathering with at least 2 rounds to spare and spend them composing the final structured answer. A complete answer with 4 fetched ledger entries beats an empty answer after 8 searches."
)
GROUND_EMPTY_LEDGER_RULE_TEXT = (
    "An investigation that returns an EMPTY source_ledger is a FAILED investigation, regardless of how good the findings prose is — the downstream consumer discards ungrounded findings."
)
GROUND_LEDGER_RULE_TEXT = (
    "MANDATORY LEDGER DISCIPLINE: every source you search/fetch/skim MUST be recorded as a source_ledger entry with url_or_path (the real http(s) URL), title, fetched (true only if you actually retrieved it), evidence_quality, and relevance."
)
GROUND_PREFER_RULE_TEXT = (
    "Prefer 5-12 real fetched sources over broad unfetched search-result listings."
)
LIT_CITATION_RULE_TEXT = (
    "CITATION RULE: cite ONLY sources from this fetched list; do NOT invent arXiv ids, DOIs, or vendor whitepapers. If a claim needs a source not listed here, state it as a general observation without a fake citation — and WITHOUT a venue-year attribution: never write '(NeurIPS 2020)' / '(ICLR 2022)' / 'Wang et al.' style references for works that are not in this list (those are unverifiable parametric recalls, the same defect as an invented id)."
)
LIT_EMPTY_TEXT_TEXT = "(no literature grounding was gathered)"
LIT_FINDINGS_HEADING_TEXT = "Grounded findings from the literature:"
LIT_LIMITS_HEADING_TEXT = "Known limitations in the current literature:"
LIT_NO_CITATION_RULE_TEXT = (
    "CITATION RULE: NO sources were fetched this run. You MUST NOT name or cite any specific paper, venue, year, arXiv id, DOI, or whitepaper anywhere in your output — every such attribution would be unverifiable parametric recall. Discuss prior work only as unattributed general knowledge (e.g. 'temporal graph attention methods', never 'TGAT (KDD 2020)')."
)
LIT_OPEN_HEADING_TEXT = "Open questions / frontiers:"
LIT_SOURCES_HEADING_TEXT = "Sources:"
LIT_UNFETCHED_MARK_TEXT = " [unfetched]"
LIT_UNGROUNDED_WARNING_TEXT = (
    "#FALLBACK: literature grounding fetched 0 real sources this run (the investigation agent did not retrieve usable literature); the hypotheses below are the model's parametric reasoning, NOT grounded in fetched sources. Re-run for grounded output."
)
META_BRIEF_TEXT = (
    "You are the Meta-review agent. Synthesize the top-ranked hypotheses below into a rigorous research overview for a scientist: the most promising directions and WHY they rank highly (reference their reviews), how they relate to the current literature, the key open questions, and concrete suggested next experiments. START YOUR RESPONSE with exactly these two elements before anything else: FIRST LINE 'TITLE: <a concise professional report title you derive from the FINDINGS themselves, 5-12 words, headline style — NEVER the verbatim research goal, never a question>'; SECOND (after a blank line) 'ABSTRACT: <one paragraph of 4-6 sentences summarizing the hypothesis landscape, the strongest directions, and the key insight — a real scientific abstract>'. Then continue with the overview. WHAT ELO MEANS (state this accurately if you mention it): the Elo score is this system's OWN self-play tournament auto-evaluation (one model debating hypotheses against each other) — it is an internal ranking signal, NOT community consensus, peer-review, citation count, or external validation; never describe it as any of those. CITATION HONESTY: cite ONLY the sources in the literature base; never invent an arXiv id/DOI/whitepaper, never attach a venue-year attribution ('(NeurIPS 2020)', 'Wang et al. 2023') to any work NOT in the literature base (unverifiable parametric recall = fabrication), and never attribute a specific NUMERIC RESULT (e.g. 'X reports 15-25% forgetting') to a cited work unless that exact figure is in the literature base — describe prior work qualitatively otherwise. FORMAT: write flowing PROSE in GitHub-flavored Markdown with section headings (##) — this is a human-readable research overview, NOT a data dump. Do NOT return JSON, do NOT wrap the answer in a code block. REQUIRED VISUAL ELEMENTS (the exported report renders GitHub pipe tables; a PROFESSIONAL architecture figure is rendered separately from structured data and EMBEDDED inline in the report — so do NOT emit ASCII-art, box-drawing, or mermaid diagrams anywhere, and do NOT refer to 'the appended figure' or an appendix): exactly one comparison TABLE of the key hypotheses as a GitHub pipe table, comparing DESIGN dimensions a scientist decides by — core mechanism, what it improves over the literature, main risk or failure mode, and the evidence an experiment must produce (do NOT tabulate Elo/review scores; those are already tabulated elsewhere in the report; additional tables for OTHER content, e.g. experiment matrices, are welcome). Keep every table cell one line. CRITICAL HONESTY RULE: these hypotheses are UNTESTED proposals. Never write that they 'report', 'demonstrate', 'achieve', or 'show' any result — no experiment was run. Present every quantitative figure as a hypothesized/expected TARGET to be tested, and do not assert benchmark results as if observed. If a hypothesis is flagged 'unreviewed' or 'low_correctness', say so rather than promoting it. NUMBER FIDELITY: any Elo or review score you quote must match the ranked data EXACTLY, and superlatives must be true of the data ('strongest novelty' only for the actual maximum novelty score). RANK vs ELO: ranks are tier-ordered (reviewed/safe/sound/novel first) THEN Elo within tier, with near-variants de-crowded ('sibling' flag) — when you discuss a hypothesis whose rank and Elo diverge (a flagged one holding high Elo, or a sibling reordered), SAY WHY at that mention, in one clause."
)
META_FLAGS_LINE_TEXT = (
    "FLAGS: {{flags}} (do not present a flagged hypothesis as a top recommendation without saying so)."
)
META_GOAL_HEADING_TEXT = "## Research goal"
META_LIT_HEADING_TEXT = "## Literature base"
META_RANKED_HEADING_TEXT = "## Top ranked hypotheses (with Elo + reviews)"
META_ZERO_SOURCES_TEXT = (
    "ZERO SOURCES WERE FETCHED THIS RUN: do NOT name or cite any specific paper, venue, year, arXiv id, DOI, author, or whitepaper anywhere (no 'TGAT (KDD 2020)', no 'TPAMI 2025'). Refer to prior work only as unattributed general knowledge and state plainly that this run fetched no literature."
)
PICK_RETRY_FAILED_WARNING_TEXT = (
    "#FALLBACK: the bounded grounding retry ALSO returned 0 fetched sources; proceeding ungrounded."
)
PICK_RETRY_OK_WARNING_TEXT = (
    "#FALLBACK: the first literature investigation returned 0 fetched sources; a bounded retry succeeded — grounding below comes from the retry pass."
)
POOL_UNREVIEWED_MARK_TEXT = " [UNREVIEWED]"
RANK_BRIEF_TEXT = (
    "You are the Ranking agent running an Elo tournament via simulated scientific debate. Hold a brief scientific debate for EACH of the prioritized pairs listed below and output the winner id with a one-line reason naming the deciding quality. Rank on PLAUSIBILITY/correctness first, then testability, then novelty — a bold but unsound hypothesis should lose to a sound, testable one. You may add a few more comparisons among the strongest candidates if useful."
)
RANK_FEEDBACK_HEADING_TEXT = "## Feedback from prior cycles (weigh these qualities)"
RANK_GOAL_HEADING_TEXT = "## Research goal"
RANK_PAIRS_HEADING_TEXT = "## Prioritized pairs to debate"
RANK_POOL_HEADING_TEXT = "## Hypotheses (id, title, current Elo)"
REFLECT_BRIEF_TEXT = (
    "You are the Reflection agent (a rigorous virtual scientific peer reviewer). For EACH hypothesis below, score correctness (plausibility/soundness), novelty, and testability from 0-10, set safety_ok, and give a one-paragraph critique. Judge novelty AND correctness AGAINST the literature base — name the weak assumption, or the prior work that undercuts novelty. Correctness (is the mechanism sound and not already refuted?) matters as much as novelty; do not reward ungrounded ambition."
)
REFLECT_FEEDBACK_HEADING_TEXT = (
    "## Feedback from prior cycles (address these recurring concerns)"
)
REFLECT_GOAL_HEADING_TEXT = "## Research goal"
REFLECT_LIT_HEADING_TEXT = "## Literature base"
REFLECT_POOL_HEADING_TEXT = "## Current hypotheses"
REPORT_ABSTRACT_LABEL_TEXT = "**Abstract.** "
REPORT_ARCH_FALLBACK_CAPTION_TEXT = "Proposed architecture"
REPORT_ARCH_FALLBACK_TITLE_TEXT = "Figure 1 — Proposed architecture"
REPORT_ASCII_NOTE_TEXT = (
    "bar length = Elo above the {{base}} tournament start; higher = won more pairwise debates"
)
REPORT_ASCII_TITLE_TEXT = "Best-hypothesis Elo across supervisor cycles"
REPORT_CAVEATS_HEADING_TEXT = "**Caveats:**"
REPORT_CITATION_CHECK_LINE_TEXT = (
    "- **Citation check:** EVERY fetched ledger URL was deterministically re-fetched and title-verified before writing; sources failing the check are labeled below and were barred from citation."
)
REPORT_CRITIQUE_LABEL_TEXT = "**Reviewer critique.** "
REPORT_CYCLES_LINE_TEXT = "- **Supervisor cycles:** {{cycles}} (test-time compute budget)"
REPORT_DESIGN_LABEL_TEXT = "- *Design:* "
REPORT_ELO_FIG_ALT_TEXT = (
    "Figure 2 — Tournament trajectory: best-hypothesis Elo across supervisor cycles; Elo is this system's internal self-play debate score, not external validation."
)
REPORT_ELO_LINE_TEXT = (
    "- **Elo:** an internal self-play tournament score (this system debating its own hypotheses) — a relative ranking signal, NOT peer review, citation count, or external validation."
)
REPORT_EXPECTED_LABEL_TEXT = "- *Expected effect (hypothesized, untested):* "
REPORT_EXPERIMENT_LABEL_TEXT = "**Proposed experiment.** "
REPORT_FALLBACK_TITLE_TEXT = "AI Co-Scientist — Research Overview"
REPORT_FALSIFIED_LABEL_TEXT = "- *Falsified if:* "
REPORT_GLANCE_HEADING_TEXT = "### Key hypotheses at a glance"
REPORT_GOAL_LABEL_TEXT = "**Research goal:** "
REPORT_GROUNDING_LINE_TEXT = (
    "- **Literature grounding:** {{n}} fetched source(s) with resolvable URLs (listed below)."
)
REPORT_HYPOTHESIS_LABEL_TEXT = "**Hypothesis.** "
REPORT_LIMITS_HEADING_TEXT = "## Limitations & Threats to Validity"
REPORT_LIMIT_CITE_UNVERIFIED_TEXT = (
    "- **Citation caution.** Citations are limited to fetched sources, but arXiv ids / DOIs were not each independently resolved in this run; verify before relying on any specific reference."
)
REPORT_LIMIT_CITE_VERIFIED_TEXT = (
    "- **Citation caution.** Every fetched ledger URL was deterministically re-fetched and title-checked this run (verdicts labeled in Literature Sources; failures were barred from citation). Characterizations of verified sources remain the model's reading — verify specific quotes/figures before relying on them."
)
REPORT_LIMIT_GROUNDED_TEXT = (
    "- **Grounding depth.** Hypotheses are grounded in {{n}} fetched source(s); the literature scan is bounded and may miss relevant prior art — a full novelty guarantee is not claimed."
)
REPORT_LIMIT_SEED_TEXT = (
    "- **Seed sensitivity.** The direction set depends on the grounding run and sampling; a re-run may surface a different frontier. Use this as one structured exploration, not the definitive map."
)
REPORT_LIMIT_SELFEVAL_TEXT = (
    "- **Self-evaluation.** The Elo ranking is this system debating its own hypotheses (single model family); it is not peer review, external benchmarking, or citation impact, and a ~30-point Elo gap can reflect a single debate."
)
REPORT_LIMIT_UNGROUNDED_TEXT = (
    "- **Ungrounded run.** No external sources were fetched this run — the hypotheses are the model's parametric reasoning; verify all prior-art and novelty claims independently."
)
REPORT_LIMIT_UNTESTED_TEXT = (
    "- **Untested proposals.** Every hypothesis and quantitative target above is an UNTESTED prediction generated by the tournament, not a measured result. Treat the numbers as design targets to falsify, not findings."
)
REPORT_MARK_MISMATCH_TEXT = " _(TITLE MISMATCH — barred from citation)_"
REPORT_MARK_UNFETCHED_TEXT = " _(unfetched)_"
REPORT_MARK_UNREACHABLE_TEXT = " _(UNREACHABLE — barred from citation)_"
REPORT_MARK_UNVERIFIED_TEXT = " _(title unverified)_"
REPORT_MARK_VERIFIED_TEXT = " _(verified)_"
REPORT_METHODOLOGY_TEXT = (
    "This overview was produced by the AbstractFlow co-scientist workflow, a literature-grounded multi-agent hypothesis tournament modeled on the Nature 2026 'AI co-scientist'. Pipeline: literature investigation (deep-plan + deep-investigate web search) -> Generation -> a supervisor loop of Reflection (peer review) / Elo ranking (pairwise scientific debate) / Evolution (per-cycle strategy) / research-expansion, with reviewer + debate feedback threaded into each next cycle -> a search-grounded full review of the finalists -> this Meta-review synthesis."
)
REPORT_METHODOLOGY_HEADING_TEXT = "## Methodology"
REPORT_METRIC_LABEL_TEXT = "- *Metric:* "
REPORT_NO_ABSTRACT_WARNING_TEXT = "meta-review returned no ABSTRACT line (#FALLBACK)"
REPORT_NO_OVERVIEW_TEXT = "_(no overview generated)_"
REPORT_NO_SOURCES_TEXT = "_(no sources gathered)_"
REPORT_NO_TITLE_WARNING_TEXT = (
    "meta-review returned no TITLE line; product title used (#FALLBACK)"
)
REPORT_OVERVIEW_HEADING_TEXT = "## Research Overview"
REPORT_PROTOCOL_LABEL_TEXT = "**Experimental protocol.**"
REPORT_PROVENANCE_TEXT = (
    "*Generated by the AbstractFlow co-scientist workflow: a literature-grounded multi-agent hypothesis engine (generation -> reflection -> Elo tournament -> evolution -> research expansion over {{cycles}} supervisor cycles, then a search-grounded full review). The hypotheses below are UNTESTED, ranked proposals for future work, not established results.*"
)
REPORT_RANKED_COUNT_LINE_TEXT = "- **Hypotheses ranked:** {{n}}"
REPORT_RANKED_HEADING_TEXT = "## Ranked Hypotheses"
REPORT_RANKING_CRITERION_TEXT = (
    "*Ranking: reviewed, safe, sound AND novel hypotheses rank first; within each tier, higher Elo (internal self-play debate score) ranks higher unless diversity de-crowding reorders near-variants — so Elo can be non-monotonic across neighboring ranks. Flags mark demotions (low_novelty / low_correctness / unreviewed / unsafe); 'sibling' marks a near-variant of a higher-ranked hypothesis kept under the cluster cap; 'de-crowded' marks a row whose higher Elo was passed over to surface a distinct direction first.*"
)
REPORT_RATIONALE_LABEL_TEXT = "**Rationale.** "
REPORT_SOURCES_HEADING_TEXT = "## Literature Sources"
REPORT_TABLE_HEADER_TEXT = (
    "| # | Hypothesis | Elo | Correctness | Novelty | Testability | Flags |"
)
REPORT_TABLE_SEPARATOR_TEXT = "| --- | --- | --- | --- | --- | --- | --- |"
REPORT_TRAJECTORY_HEADING_TEXT = "### Tournament trajectory"
REPORT_UNGROUNDED_LINE_TEXT = (
    "- **Literature grounding:** NONE fetched this run — the hypotheses are the model's parametric reasoning, not grounded in retrieved literature (see caveats)."
)
REPORT_UNTITLED_TEXT = "(untitled)"
RETRY_FAILED_RULE_TEXT = (
    "THE PREVIOUS INVESTIGATION FAILED: it returned an EMPTY source_ledger. Your PRIMARY deliverable this pass is the source_ledger itself."
)
RETRY_FETCH_RULE_TEXT = (
    "Fetch 4-8 real sources (http(s) URLs), record EACH as a ledger entry the moment you retrieve it, and reserve your last 2 rounds for composing the final structured answer."
)
RETRY_STOP_RULE_TEXT = (
    "STOP gathering after at most 6 tool rounds and write the final structured answer — an incomplete-but-recorded ledger beats another empty answer."
)
STRATEGY_COMBINATION_TEXT = (
    "COMBINATION: merge the complementary strengths of two top hypotheses into one stronger mechanism"
)
STRATEGY_GROUNDING_TEXT = (
    "GROUNDING+COHERENCE: fix the specific flaw a reviewer named and tighten the mechanism's internal consistency"
)
STRATEGY_OUT_OF_BOX_TEXT = (
    "OUT-OF-BOX: take a top hypothesis's goal but reach it by a mechanism from a DIFFERENT paradigm than the pool uses"
)
STRATEGY_SIMPLIFICATION_TEXT = (
    "SIMPLIFICATION: strip a top hypothesis to its most testable core — fewer moving parts, a cleaner experiment, the same claim"
)
TERM_RANK_BRIEF_TEXT = (
    "You are the Ranking agent holding the FINAL Elo tournament over the finalist hypotheses. For each meaningful pair among the finalists, hold a scientific debate and output the winner id with a one-line reason. Rank on plausibility/correctness first, then testability, then novelty."
)
TERM_RANK_GOAL_HEADING_TEXT = "## Research goal"
TERM_RANK_POOL_HEADING_TEXT = "## Finalist hypotheses (id, title, Elo, reviews)"
TERM_REFLECT_BRIEF_TEXT = (
    "You are the Reflection agent performing a FULL, deeply-grounded review of the FINALIST hypotheses. Use the read-only web tools to search the current literature and verify each hypothesis. Run a DEEP-VERIFICATION review: for each hypothesis, mentally decompose it into its core assumptions and sub-assumptions, and check each independently — a hypothesis is only as sound as its weakest load-bearing assumption. Verify NOVELTY (search: is it already published?) and CORRECTNESS (is every assumption sound, or does one rest on a refuted or unsupported premise?). For EACH hypothesis, score correctness (driven by the weakest assumption you found), novelty, testability (0-10), set safety_ok, and give a critique that (a) NAMES the weakest assumption and whether it holds, and (b) CITES what you found in the literature (or confirms you could not find prior art, supporting novelty). Be skeptical: down-score hypotheses that duplicate existing work or rest on an invalidating assumption. Never fabricate a citation — cite only what you actually retrieved."
)
TERM_REFLECT_GOAL_HEADING_TEXT = "## Research goal"
TERM_REFLECT_POOL_HEADING_TEXT = "## Finalist hypotheses to verify"

# A hypothesis carries a STRUCTURED experimental protocol, not a one-line
# experiment string. The five protocol fields force the model to commit to a
# design a reader can execute and, critically, to a FALSIFICATION criterion -
# the mark of a testable hypothesis. `experiment` stays as a one-line summary
# for backward-compatible pool serialization.
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

SEARCH_TOOLS = ["web_search", "skim_websearch", "skim_url", "fetch_url"]

# THE RUN-VAR INVENTORY, on ONE node's pin default. Where a `set_var{name:
# "co.state"}` used to hide everything behind one opaque key, each of these is
# a top-level run var a `get_var` chip names on the canvas, the variable picker
# offers, and `collectDeclaredVarNames` + the preflight unknown-var check
# understand. The values here are also the fail-closed seed: with pool empty
# and cycle 0 the supervisor loop cannot spin.
SEED_VARS = {
    # budgets the loop law reads BY NAME (a start pin the caller omits never
    # lands in run.vars, so the door writes the typed budget back itself)
    "max_cycles": 3,
    "num_hypotheses": 5,
    # literature base
    "lit_text": "",
    "lit_sources": [],
    "lit_open_questions": [],
    "lit_grounding_ok": False,
    "lit_warnings": [],
    "lit_fetched_count": 0,
    "lit_allowed_citations": [],
    "lit_citations_verified": False,
    # deterministic citation verification
    "cite_checks": [],
    # tournament
    "pool": [],
    "cycle": 0,
    "next_id": 0,
    "feedback": "",
    "elo_history": [],
    "dropped_dups": 0,
    # final ranking + export
    "ranked_hypotheses": [],
    "top_hypothesis": {},
    "final_cycles": 0,
    "final_warnings": [],
    "pool_size": 0,
    "run_timestamp": "",
}

# ===========================================================================
# CODE BODIES. Deterministic glue only: parsing, ETL, scoring, selection
# between texts that live on pins. No orchestration, no state reads, no prose.
# Every one of these nodes is on the EXECUTION lane.
# ===========================================================================

SEED_RUN_CODE = """
# THE DOOR. The only place run vars are born, and the only place the two
# budgets the loop law reads by name are normalized. Everything else in
# `updates` is the fail-closed empty seed (see SEED_VARS on the pin default).
seed = updates_seed if isinstance(updates_seed, dict) else {}
out = dict(seed)
out["max_cycles"] = max(1, int(max_cycles or 1))
out["num_hypotheses"] = max(1, int(num_hypotheses or 5))
return {"updates": out}
""".strip()

LIT_BASE_CODE = """
inv = (investigation or {})
findings = inv.get("answer_hypotheses") or []
ledger = inv.get("source_ledger") or []
open_q = inv.get("open_questions") or []
limitations = inv.get("limitations") or []
parts = []
if findings:
    parts.append(str(findings_heading_text or ""))
    i = 0
    for f in findings:
        i = i + 1
        parts.append(str(i) + ". " + str(f))
if open_q:
    parts.append("")
    parts.append(str(open_questions_heading_text or ""))
    for q in open_q:
        parts.append("- " + str(q))
if limitations:
    parts.append("")
    parts.append(str(limitations_heading_text or ""))
    for l in limitations:
        parts.append("- " + str(l))
# Clean source ledger. deep-investigate's schema uses url_or_path / fetched /
# evidence_quality / relevance / rejected_reason (NOT url/takeaway) - read the
# real field names so URLs and notes are not silently dropped.
sources = []
if ledger:
    parts.append("")
    parts.append(str(sources_heading_text or ""))
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
            mark = "" if fetched else str(unfetched_mark_text or "")
            parts.append("- " + title + " (" + url + ")" + mark + ": " + take)
# grounding_ok: did we actually gather real, FETCHED sources? Findings alone
# do NOT count - the investigation agent can return reasoning (or degenerate
# meta "sources") without searching, and that is exactly the ungrounded case
# we must not present as grounded. A real fetched source must carry an
# http(s):// URL, so grounding_ok means what the reader assumes it means.
fetched_count = 0
for s in sources:
    u = str(s.get("url") or "").strip().lower()
    if s.get("fetched") and (u.startswith("http://") or u.startswith("https://")):
        fetched_count = fetched_count + 1
grounding_ok = fetched_count > 0
warnings = []
if not grounding_ok:
    warnings.append(str(ungrounded_warning_text or ""))
# Citation allowlist: the exact titles/URLs actually in the fetched ledger.
# Threaded into every generative prompt so the model cites ONLY grounded
# sources and never invents arXiv ids / vendor whitepapers. Deterministic,
# not a prompt plea. An EMPTY allowlist bans named citations outright.
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
    parts.append(str(citation_rule_text or ""))
    for a in allowed:
        parts.append("- " + a)
else:
    parts.append("")
    parts.append(str(no_citation_rule_text or ""))
text = "\\n".join(parts).strip() or str(empty_text or "")
return {"updates": {
    "lit_text": text,
    "lit_sources": sources,
    "lit_open_questions": open_q,
    "lit_grounding_ok": grounding_ok,
    "lit_warnings": warnings,
    "lit_fetched_count": fetched_count,
    "lit_allowed_citations": allowed,
}}
""".strip()

LIT_PICK_CODE = """
# Only reached when attempt 1 fetched NOTHING (the retry branch), so the pick
# is: take the retry when IT grounded, else keep attempt 1's vars and say the
# retry failed too. Deterministic, label-honest - both sentences are pins.
retry = retry_updates if isinstance(retry_updates, dict) else {}
if retry.get("lit_grounding_ok"):
    out = dict(retry)
    out["lit_warnings"] = ([str(retry_ok_warning_text or "")]
                           + list(retry.get("lit_warnings") or []))
    return {"updates": out}
warns = list(first_warnings or [])
warns.append(str(retry_failed_warning_text or ""))
return {"updates": {"lit_warnings": warns}}
""".strip()

CITE_ITEMS_CODE = """
# EVERY fetched source is verified - no budget cap (operator ruling
# 2026-07-21: "we must be thorough"). The list is already bounded upstream by
# the investigation's own iteration budget, so the loop cannot run away.
items = []
for s in (sources or []):
    if not isinstance(s, dict):
        continue
    u = str(s.get("url") or "").strip()
    if s.get("fetched") and (u.lower().startswith("http://") or u.lower().startswith("https://")):
        items.append({"url": u, "title": str(s.get("title") or "").strip()})
return {"items": items, "count": len(items)}
""".strip()

CITE_ARGS_CODE = """
it = item if isinstance(item, dict) else {}
u = str(it.get("url") or "").strip()
# arXiv PDFs serve no usable <title>; the abs page's title IS "[id] Real
# Title" - normalize so the strict check has something to check.
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
# output arrives as a dict OR a JSON string depending on the tool executor -
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
    # Strict: an arXiv abs <title> carries the real paper title - a wrong id
    # shows ZERO overlap with the claimed title (the EfficientNet case).
    if contain >= 0.5:
        verdict = "verified"
        reason = "arXiv title matches"
    else:
        verdict = "mismatch"
        reason = 'claimed "' + claimed + '" but the arXiv id serves "' + (fetched_title or '?') + '"'
else:
    if contain >= 0.34:
        verdict = "verified"
        reason = "page title matches"
    elif fetched_title and contain == 0.0:
        verdict = "mismatch"
        reason = 'claimed "' + claimed + '" but the page serves "' + fetched_title + '"'
    else:
        verdict = "unverified"
        reason = "page title too generic to confirm (kept, labeled)"
new_acc = list(acc or [])
new_acc.append({"url": url, "claimed": claimed, "fetched_title": fetched_title, "verdict": verdict, "reason": reason})
return {"updates": {"cite_checks": new_acc}}
""".strip()

CITE_APPLY_CODE = """
# The allowlist constrains the writer to the ledger; THIS verifies the LEDGER
# itself. Sources whose served page title contradicts the claimed title (or
# that do not resolve) are DROPPED from the citable set and labeled in the
# report - never silently kept.
cl = checks or []
by_url = {}
for c in cl:
    if isinstance(c, dict) and c.get("url"):
        by_url[str(c.get("url"))] = c
new_sources = []
dropped = []
kept_allow = []
for s in (sources or []):
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
            s2["takeaway"] = (str(s2.get("takeaway") or "")
                              + str(failed_suffix_text or "").replace("{{reason}}", str(c.get("reason") or v))).strip(" ;")
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
warns = list(warnings or [])
for d in dropped:
    warns.append(str(dropped_warning_text or "").replace("{{title}}", d["title"]).replace("{{reason}}", d["reason"]))
parts = [str(lit_text or "")]
# Only claim verification when at least one URL was actually checked: on a
# zero-source run the loop body never executes and an unconditional "every
# ledger URL was fetched and title-checked" header would be a vacuous-truth
# honesty defect in the very text that teaches citation discipline.
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
    parts.append(str(verification_heading_text or ""))
    for vl in ver_lines:
        parts.append(vl)
# Coverage integrity: with full coverage this counter must be 0; if a fetched
# source ever slips through without a verdict, say so honestly instead of
# implying coverage.
unchecked = 0
for s in new_sources:
    if not isinstance(s, dict) or not s.get("fetched") or s.get("verification"):
        continue
    u = str(s.get("url") or "").lower()
    if u.startswith("http://") or u.startswith("https://"):
        unchecked = unchecked + 1
if unchecked > 0 and ver_lines:
    parts.append(str(unchecked_note_text or "").replace("{{n}}", str(unchecked)))
    warns.append(str(unchecked_warning_text or "").replace("{{n}}", str(unchecked)))
if dropped:
    parts.append("")
    parts.append(str(revised_rule_text or ""))
if fetched_count == 0 and ver_lines:
    # Only when verification actually ran and eliminated everything: on a run
    # that fetched nothing to begin with, lit_base already appended the
    # no-citation ban and the ungrounded warning.
    parts.append("")
    parts.append(str(none_left_rule_text or ""))
    warns.append(str(none_left_warning_text or ""))
return {"updates": {
    "lit_sources": new_sources,
    "lit_text": "\\n".join(parts),
    "lit_warnings": warns,
    "lit_fetched_count": fetched_count,
    "lit_grounding_ok": fetched_count > 0,
    "lit_allowed_citations": kept_allow,
    "lit_citations_verified": True,
}}
""".strip()

INIT_STATE_CODE = """
hyps = (generated or {}).get("hypotheses") or []
pool = []
def _defang_fals(f):
    # The honesty prompts demand HYPOTHESIZED framing on effect sizes; the
    # model sometimes splices the literal token INTO falsification criteria
    # ("auditability < HYPOTHESIZED 100%"), destroying the threshold text.
    # The criterion is a plain threshold - strip the token.
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
return {"updates": {
    "pool": pool,
    "cycle": 0,
    "next_id": len(pool),
    "feedback": "",
    "elo_history": [],
}}
""".strip()

# TWO views of the pool. The DECORATED view (ids, Elo, [UNREVIEWED]) is what
# reflect/rank need - they must reference hypotheses by id and see standings.
# The CLEAN view carries only title/statement/rationale - it feeds
# evolve/expand, which were echoing "(Elo 1224)"/"[UNREVIEWED]"/"[id]"
# decorations straight into reader-facing hypothesis titles. Generative stages
# must never see the bookkeeping.
POOL_TEXT_CODE = """
ranked = sorted(pool or [], key=lambda h: -float(h.get("elo", 0)))
lines = []
clean = []
for h in ranked:
    tag = "" if h.get("reviewed") else str(unreviewed_mark_text or "")
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
return {"decorated": "\\n".join(lines), "clean": "\\n".join(clean)}
""".strip()

# SELECTION ONLY: the four strategies are pin defaults. The paper samples SIX
# distinct Evolution strategies and the ablation credits Evolution for a real
# quality gain, so a single generic "refine or combine" prompt collapses them;
# rotating per cycle keeps them distinct without a fork.
CYCLE_STRATEGY_CODE = """
strategies = [str(combination_text or ""), str(simplification_text or ""),
              str(out_of_box_text or ""), str(grounding_text or "")]
return {"strategy": strategies[int(cycle or 0) % len(strategies)]}
""".strip()

# Prioritized match set (Proximity/newness stand-in): pair newest with top,
# and top-with-top, so the tournament always compares the candidates whose
# ranking matters most this cycle.
RANK_PAIRS_CODE = """
by_elo = sorted(pool or [], key=lambda h: -float(h.get("elo", 0)))
ids = [int(h.get("id")) for h in by_elo]
newest = sorted([int(h.get("id")) for h in (pool or [])], key=lambda x: -x)[:3]
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
for i in range(len(ids)):
    for k in range(i + 1, min(i + 3, len(ids))):
        _add(ids[i], ids[k])
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
by_id = {int(h["id"]): dict(h) for h in (pool or []) if isinstance(h, dict)}
cyc = int(cycle or 0)
nid = int(next_id or 0) or len(by_id)

review_list = ((reviews or {}).get("reviews") or [])
for r in review_list:
    if not isinstance(r, dict):
        continue
    hid = int(r.get("id", -1))
    if hid in by_id:
        by_id[hid]["reviews"] = {
            "correctness": r.get("correctness"),
            "novelty": r.get("novelty"),
            "testability": r.get("testability"),
            "safety_ok": r.get("safety_ok"),
            "critique": str(r.get("critique") or ""),
        }
        by_id[hid]["reviewed"] = True

K = 32.0
match_list = ((matches or {}).get("matches") or [])
for m in match_list:
    if not isinstance(m, dict):
        continue
    a = int(m.get("a", -1)); b = int(m.get("b", -1)); w = int(m.get("winner", -1))
    if a not in by_id or b not in by_id or a == b:
        continue
    Ra = float(by_id[a].get("elo", 1200.0)); Rb = float(by_id[b].get("elo", 1200.0))
    Ea = 1.0 / (1.0 + (10.0 ** ((Rb - Ra) / 400.0)))
    Eb = 1.0 - Ea
    Sa = 1.0 if w == a else (0.5 if w not in (a, b) else 0.0)
    Sb = 1.0 - Sa
    by_id[a]["elo"] = Ra + K * (Sa - Ea)
    by_id[b]["elo"] = Rb + K * (Sb - Eb)

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

# Sanitizer belt: even with the clean generative pool view, a model can echo
# bookkeeping decorations ("(Elo 1224)", "[UNREVIEWED]", a leading "[3]") into
# a new title or field. Strip them from EVERY incoming string field so no
# decoration or internal pool id ever reaches the reader.
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
    while "  " in out:
        out = out.replace("  ", " ")
    return out.strip(" -\\u2013\\u2014:").strip()

existing_tok = [_toks(h) for h in by_id.values()]
# Normalized-title identity: two entries with the same title ARE the same
# hypothesis to any reader, even when a reworded statement drops the
# title+statement token-Jaccard below the overlap threshold.
def _title_key(h):
    t = str((h or {}).get("title") or "").lower()
    out = ""
    for ch in t:
        if ("a" <= ch <= "z") or ("0" <= ch <= "9"):
            out = out + ch
    return out
existing_titles = set()
for h in by_id.values():
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

elos = [float(h.get("elo", 1200.0)) for h in by_id.values()] or [1200.0]
mean_elo = sum(elos) / len(elos)
dropped = 0
# EVOLVED hypotheses are refinements of their parents - they SHOULD resemble
# them, so only near-identical restatements are dropped (0.80). EXPANDED
# hypotheses are meant to open new areas, so anything close to an existing one
# is a failed expansion and is dropped (0.45).
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
        dropped = dropped + 1
        continue
    existing_tok.append(ct)
    if tk:
        existing_titles.add(tk)
    by_id[nid] = {
        "id": nid,
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
    nid = nid + 1

crits = []
for r in review_list:
    if isinstance(r, dict) and str(r.get("critique") or "").strip():
        crits.append(str(r.get("critique")).strip())
debate = []
for m in match_list:
    if isinstance(m, dict) and str(m.get("reason") or "").strip():
        debate.append(str(m.get("reason")).strip())
# ADR-0026: the next cycle reads EVERY critique and debate reason, whole.
fb_parts = []
if crits:
    fb_parts.append(str(critique_heading_text or ""))
    for c in crits:
        fb_parts.append("- " + c)
if debate:
    fb_parts.append(str(debate_heading_text or ""))
    for d in debate:
        fb_parts.append("- " + d)
fb = "\\n".join(fb_parts).strip()

ranked = sorted(by_id.values(), key=lambda h: -float(h.get("elo", 0)))
# Tournament SURVIVOR SELECTION (the paper's evolving population), not a cut of
# content: whole hypotheses below the top 8 by Elo leave the pool; nothing kept
# is shortened. ADR-0026 audit 2026-09-28: kept, listed for the operator.
cap = 8
ranked = ranked[:cap]
# Snapshot the tournament standing this cycle so the report can render the
# Elo-evolution figure (the paper's headline result is Elo rising over cycles).
top_elos = [float(h.get("elo", 0)) for h in ranked]
hist = list(elo_history or [])
if top_elos:
    top3 = top_elos[:3]
    hist.append({
        "cycle": cyc + 1,
        "best": int(max(top_elos)),
        "top3_mean": int(sum(top3) / len(top3)),
        "pool": len(top_elos),
    })
return {"updates": {
    "pool": ranked,
    "cycle": cyc + 1,
    "next_id": nid,
    "feedback": fb,
    "dropped_dups": dropped,
    "elo_history": hist,
}}
""".strip()

# Terminal fold: apply the full-review results + a final Elo pass. No new
# hypotheses, no cap-growth - this closes the pool so nothing is unreviewed.
TERM_FOLD_CODE = """
by_id = {int(h["id"]): dict(h) for h in (pool or []) if isinstance(h, dict)}

for r in ((reviews or {}).get("reviews") or []):
    if not isinstance(r, dict):
        continue
    hid = int(r.get("id", -1))
    if hid in by_id:
        by_id[hid]["reviews"] = {
            "correctness": r.get("correctness"),
            "novelty": r.get("novelty"),
            "testability": r.get("testability"),
            "safety_ok": r.get("safety_ok"),
            "critique": str(r.get("critique") or ""),
        }
        by_id[hid]["reviewed"] = True

K = 32.0
for m in ((matches or {}).get("matches") or []):
    if not isinstance(m, dict):
        continue
    a = int(m.get("a", -1)); b = int(m.get("b", -1)); w = int(m.get("winner", -1))
    if a not in by_id or b not in by_id or a == b:
        continue
    Ra = float(by_id[a].get("elo", 1200.0)); Rb = float(by_id[b].get("elo", 1200.0))
    Ea = 1.0 / (1.0 + (10.0 ** ((Rb - Ra) / 400.0)))
    Eb = 1.0 - Ea
    Sa = 1.0 if w == a else (0.5 if w not in (a, b) else 0.0)
    Sb = 1.0 - Sa
    by_id[a]["elo"] = Ra + K * (Sa - Ea)
    by_id[b]["elo"] = Rb + K * (Sb - Eb)

ranked = sorted(by_id.values(), key=lambda h: -float(h.get("elo", 0)))
top_elos = [float(h.get("elo", 0)) for h in ranked]
hist = list(elo_history or [])
if top_elos:
    top3 = top_elos[:3]
    hist.append({
        "cycle": int(cycle or 0),
        "best": int(max(top_elos)),
        "top3_mean": int(sum(top3) / len(top3)),
        "pool": len(top_elos),
        "final": True,
    })
return {"updates": {"pool": ranked, "elo_history": hist}}
""".strip()

FINAL_CODE = """
# Correctness-floor gate (structural, not prompt-deep): a hypothesis a
# reviewer scored unsound (correctness < 5) or that was never reviewed cannot
# hold the headline slot, no matter how many debates its ambition won. Elo
# still orders WITHIN each tier - we only demote, we never distort the Elo.
CORRECTNESS_FLOOR = 5.0
# Novelty floor: the paper's entire purpose is surfacing NOVEL hypotheses, but
# the plausibility-first debate can crown a reviewer-declared non-novel idea.
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
ranked = sorted(pool or [], key=_sort_key)
# Identical-title collapse: a reader sees one hypothesis listed twice -
# collapse to the best-ranked copy.
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
# NEAR-identical title collapse: CONTAINMENT of the smaller title's tokens in
# the larger >= 0.75 (min 3 tokens) - a qualifier ADDS tokens but the base
# title stays contained, while distinct ideas sharing words stay far below.
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
# Diversity de-crowding (MMR-style): within the SAME tier, once a hypothesis
# is placed, penalize the next candidate that is a near-sibling so distinct
# directions surface. Tier order is never violated.
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
_SIB = 0.5
_CLUSTER_CAP = 2
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
        over_cap = siblings >= _CLUSTER_CAP
        pen = (100000.0 if over_cap else sim * 200.0)
        penalized = (tier, -(float(h.get("elo", 0)) - pen))
        if best_penalized is None or penalized < best_penalized:
            best_penalized = penalized
            best_i = i
    chosen = _remaining.pop(best_i)
    # Visible-honesty annotation: a placed hypothesis that is a near-variant of
    # an already-placed same-tier one carries a 'sibling' flag so the reader
    # sees WHY rank order and Elo order can diverge.
    c_toks = _toks(chosen)
    c_tier = _sort_key(chosen)[0]
    for pt, ptier in _picked_toks:
        if ptier == c_tier and _overlap(c_toks, pt) >= _SIB:
            chosen["_sibling"] = True
            break
    _diverse.append(chosen)
    _picked_toks.append((c_toks, c_tier))
ranked = _diverse
# Local rank-vs-Elo honesty: any row whose Elo EXCEEDS an earlier same-tier row
# was reordered by de-crowding - flag it so the divergence is explained on the
# row where the reader sees it.
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
warns = list(warnings or [])
unreviewed = 0
unsafe = 0
for h in out:
    if not h.get("reviewed"):
        unreviewed = unreviewed + 1
    if "unsafe" in (h.get("flags") or []):
        unsafe = unsafe + 1
if unreviewed > 0:
    warns.append(str(unreviewed_warning_text or "").replace("{{n}}", str(unreviewed)))
if unsafe > 0:
    warns.append(str(unsafe_warning_text or "").replace("{{n}}", str(unsafe)))
return {"updates": {
    "ranked_hypotheses": out,
    "top_hypothesis": out[0] if out else {},
    "final_cycles": int(cycle or 0),
    "pool_size": len(out),
    "final_warnings": warns,
}}
""".strip()

# ===========================================================================
# PROMPT COMPOSERS. Every sentence a model reads is a PIN DEFAULT above the
# node's inputs; these bodies only SELECT which texts apply and fill slots.
# ===========================================================================

GEN_PROMPT_CODE = """
parts = [str(brief_text or "").replace("{{n}}", str(int(num_hypotheses or 5))), "",
         str(goal_heading_text or ""), str(research_goal or "").strip()]
lit = str(literature or "").strip()
if lit:
    parts += ["", str(literature_heading_text or ""), lit]
return {"prompt": "\\n".join(parts)}
""".strip()

REFLECT_PROMPT_CODE = """
parts = [str(brief_text or "")]
fb = str(feedback or "").strip()
if fb:
    parts += ["", str(feedback_heading_text or ""), fb]
parts += ["", str(goal_heading_text or ""), str(research_goal or "").strip()]
lit = str(literature or "").strip()
if lit:
    parts += ["", str(literature_heading_text or ""), lit]
parts += ["", str(pool_heading_text or ""), str(pool_text or "").strip()]
return {"prompt": "\\n".join(parts)}
""".strip()

RANK_PROMPT_CODE = """
parts = [str(brief_text or "")]
fb = str(feedback or "").strip()
if fb:
    parts += ["", str(feedback_heading_text or ""), fb]
parts += ["", str(goal_heading_text or ""), str(research_goal or "").strip(),
          "", str(pairs_heading_text or ""), str(pairs or "").strip(),
          "", str(pool_heading_text or ""), str(pool_text or "").strip()]
return {"prompt": "\\n".join(parts)}
""".strip()

EVOLVE_PROMPT_CODE = """
strat = str(strategy or "").strip() or str(default_strategy_text or "")
parts = [str(brief_text or "").replace("{{strategy}}", strat)]
fb = str(feedback or "").strip()
if fb:
    parts += ["", str(feedback_heading_text or ""), fb]
parts += ["", str(goal_heading_text or ""), str(research_goal or "").strip()]
lit = str(literature or "").strip()
if lit:
    parts += ["", str(literature_heading_text or ""), lit]
parts += ["", str(pool_heading_text or ""), str(pool_text or "").strip()]
return {"prompt": "\\n".join(parts)}
""".strip()

EXPAND_PROMPT_CODE = """
parts = [str(brief_text or "")]
fb = str(feedback or "").strip()
if fb:
    parts += ["", str(feedback_heading_text or ""), fb]
oq = open_questions or []
if oq:
    parts += ["", str(open_questions_heading_text or "")]
    for q in oq:
        parts.append("- " + str(q))
parts += ["", str(goal_heading_text or ""), str(research_goal or "").strip()]
lit = str(literature or "").strip()
if lit:
    parts += ["", str(literature_heading_text or ""), lit]
parts += ["", str(pool_heading_text or ""), str(pool_text or "").strip()]
return {"prompt": "\\n".join(parts)}
""".strip()

TERM_REFLECT_PROMPT_CODE = """
parts = [str(brief_text or ""), "", str(goal_heading_text or ""),
         str(research_goal or "").strip(), "", str(pool_heading_text or ""),
         str(pool_text or "").strip()]
return {"prompt": "\\n".join(parts)}
""".strip()

TERM_RANK_PROMPT_CODE = TERM_REFLECT_PROMPT_CODE

META_PROMPT_CODE = """
# ADR-0026: the meta-review reads every ranked hypothesis, the whole literature
# base and every reviewer note whole.
top = ranked_hypotheses or []
parts = [str(brief_text or ""), "", str(goal_heading_text or ""),
         str(research_goal or "").strip()]
if not bool(grounding_ok):
    # Zero-source runs: the meta-review is the highest-visibility fabrication
    # surface (it writes the "Relation to Current Literature" prose), so the
    # ban is repeated at meta level, not only in the literature text.
    parts += ["", str(zero_sources_text or "")]
lit = str(literature or "").strip()
if lit:
    parts += ["", str(literature_heading_text or ""), lit]
parts += ["", str(ranked_heading_text or "")]
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
        parts.append(str(flags_line_text or "").replace("{{flags}}", ", ".join(fl)))
    if rv.get("critique"):
        parts.append("Reviewer note (corr=" + str(rv.get("correctness")) + ", nov=" + str(rv.get("novelty")) + ", safety_ok=" + str(rv.get("safety_ok")) + "): " + str(rv.get("critique")))
    parts.append("")
return {"prompt": "\\n".join(parts)}
""".strip()

FIG_SPEC_PROMPT_CODE = """
# ADR-0026: every ranked hypothesis, each statement whole.
top = ranked_hypotheses or []
parts = [str(brief_text or ""), "", str(goal_heading_text or ""),
         str(research_goal or "").strip(), "", str(top_heading_text or "")]
for h in top:
    parts.append("- " + str(h.get("title")) + ": " + str(h.get("statement") or ""))
return {"prompt": "\\n".join(parts)}
""".strip()

# ===========================================================================
# FIGURES. The LLM authors a STRUCTURED SPEC (data); the dedicated
# diagram-render workflow renders it with a fixed script. Both figures degrade
# honestly: rendered:false keeps the text fallback + a #FALLBACK caveat.
# ===========================================================================

FIG_SPEC_FOLD_CODE = """
# #[WARNING:TRUNCATION] figure-layout bounds on the spec the MODEL WROTE (not a
# model input): at most 4 layers x 4 nodes and 16 edges, node/layer/edge labels
# 60/34/20 chars, title 110 and caption 300 chars, so the rendered diagram stays
# legible. Kept under ADR-0026 as a render bound; listed for the operator.
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
# in the PDF/DOCX.
def _clean(t):
    t = str(t or "").replace("\\n", " ").replace("\\r", " ").replace("[", "(").replace("]", ")")
    while "  " in t:
        t = t.replace("  ", " ")
    return t.strip()
title_c = _clean(s.get("title") or str(fallback_title_text or ""))[:110]
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

ELO_SPEC_CODE = """
pts = []
i = 0
for h in (elo_history or []):
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
    "title": str(title_text or ""),
    "caption": str(caption_text or ""),
    "x_label": str(x_label_text or ""),
    "y_label": str(y_label_text or ""),
    "y_min": low,
    "series": [{"label": "best hypothesis", "points": pts}],
}
return {"spec": (spec if ok else {}), "ok": ok}
""".strip()

# Figure basenames carry the run timestamp: fixed names collide across runs
# sharing a workspace_root. The report embeds the RETURNED path, so uniqueness
# is enough. The baked-in caption is dropped from the FIGURE (matplotlib
# truncates it at the image width); the report renderer prints the full,
# wrapping caption below the embedded image.
RENDER_INPUT_CODE = """
t = str(stamp or "").strip() or "run"
sp = dict(spec or {})
if sp:
    sp["caption"] = ""
return {"spec": sp, "basename": str(basename_prefix_text or "") + t}
""".strip()

FREEZE_TS_CODE = """
# system_datetime is a VOLATILE pure source (it recomputes per pull), so
# reading it from both the figure-basename chain and the report-filename chain
# would yield DIFFERENT times. Freezing it into a run var once, before the
# figures, makes every consumer read the same instant. Colons/dots break some
# filesystems, so the stored form is already filename-safe.
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
    safe = str(fallback_text or "")
return {"updates": {"run_timestamp": safe}}
""".strip()

EXPORT_PATHS_CODE = """
safe = str(stamp or "").strip() or str(fallback_text or "")
prefix = str(prefix_text or "")
return {
    "md": prefix + "-" + safe + ".md",
    "pdf": prefix + "-" + safe + ".pdf",
    "docx": prefix + "-" + safe + ".docx",
}
""".strip()

# ===========================================================================
# THE REPORT, IN FOUR SECTIONS. One node per section of the delivered
# document, each carrying ITS OWN sentences as pin defaults, each returning a
# LINE ARRAY that the join node concatenates. The old single 12KB body held
# every caveat, methodology paragraph and limitation bullet inside Python
# string concatenation - unreadable and uneditable on the canvas.
# ===========================================================================

REPORT_HEAD_CODE = """
ov = str(overview or "").strip()
# The figure subflows declare their result FIELDS as output pins, so the
# report reads `rendered` / `png_path` / `warnings` on their own wires - no
# one-object result blob crossing the canvas.
arch_ok = bool(arch_rendered) and bool(str(arch_png_path or ""))
warns = list(warnings or [])
for w in (list(arch_warnings or []) + list(elo_warnings or [])):
    warns.append(str(w))
# Extract the LLM-derived TITLE and ABSTRACT the meta prompt demands (the
# report title must be THOUGHT OF by the model, never fixed product
# boilerplate and never the prompt). Tolerant parse: missing pieces degrade to
# the product title with a visible caveat, never silently.
derived_title = ""
abstract = ""
body_lines = []
for ln in ov.split("\\n"):
    st = ln.strip()
    if not derived_title and st.upper().startswith("TITLE:"):
        derived_title = st[6:].strip().strip('"')
        continue
    if not abstract and st.upper().startswith("ABSTRACT:"):
        abstract = st[9:].strip()
        continue
    body_lines.append(ln)
overview_body = "\\n".join(body_lines).strip()
fallback = str(fallback_title_text or "")
title = derived_title or fallback
lines = []
lines.append("# " + title)
lines.append("")
lines.append(str(goal_label_text or "") + str(research_goal or "").strip())
lines.append("")
if abstract:
    lines.append(str(abstract_label_text or "") + abstract)
    lines.append("")
lines.append(str(provenance_text or "").replace("{{cycles}}", str(cycles)))
lines.append("")
if not derived_title:
    warns = list(warns) + [str(no_title_warning_text or "")]
if not abstract:
    warns = list(warns) + [str(no_abstract_warning_text or "")]
if warns:
    # Plain bold + bullets, NOT a '>' blockquote: the PDF renderer has no
    # blockquote branch and shows literal '> ' characters on page 1.
    lines.append(str(caveats_heading_text or ""))
    lines.append("")
    for w in warns:
        lines.append("- " + str(w))
    lines.append("")
lines.append("---")
lines.append("")
lines.append(str(overview_heading_text or ""))
lines.append("")
lines.append(overview_body if overview_body else str(no_overview_text or ""))
lines.append("")
if arch_ok:
    # The image embeds INLINE in md viewers AND in the PDF/DOCX exports. The
    # alt text becomes the figure caption under the image, so it carries the
    # DESCRIPTION; the heading above carries the figure title.
    lines.append("### " + (str(arch_title or "") or str(arch_fallback_title_text or "")))
    lines.append("")
    cap = str(arch_caption or "").strip() or str(arch_title or "") or str(arch_fallback_caption_text or "")
    lines.append("![" + cap + "](" + str(arch_png_path) + ")")
    lines.append("")
lines.append("---")
lines.append("")
# The document title for the PDF/DOCX metadata is the same derived title,
# clamped; it falls back to the product title only when the model returned no
# TITLE line (the caveat above records that case).
doc = derived_title[:160] if derived_title else fallback  #[WARNING:TRUNCATION] PDF/DOCX metadata title only; the heading above keeps the whole title
return {"lines": lines, "title": title, "doc_title": doc}
""".strip()

REPORT_METHOD_CODE = """
# Methodology / provenance - states the pipeline, cycle budget, tournament
# depth and grounding honestly so a reader can weigh the ranking.
ranked = ranked_hypotheses or []
srcs = sources or []
elo_ok = bool(elo_rendered) and bool(str(elo_png_path or ""))
lines = []
lines.append(str(methodology_heading_text or ""))
lines.append("")
lines.append(str(methodology_text or ""))
lines.append("")
lines.append(str(cycles_line_text or "").replace("{{cycles}}", str(cycles if cycles is not None else "\\u2014")))
lines.append(str(ranked_count_line_text or "").replace("{{n}}", str(len(ranked))))
lines.append(str(elo_line_text or ""))
if bool(grounding_ok):
    lines.append(str(grounding_line_text or "").replace("{{n}}", str(int(fetched_count or 0))))
else:
    lines.append(str(ungrounded_line_text or ""))
_any_verif = False
for s in srcs:
    if isinstance(s, dict) and s.get("verification"):
        _any_verif = True
        break
if _any_verif:
    lines.append(str(citation_check_line_text or ""))
lines.append("")
# Elo-evolution figure (ASCII fallback, renders as monospace in PDF/DOCX).
# Bars are anchored at the 1200 tournament start, not at min(bests):
# min-anchoring rendered the first cycle as a single '#', visually overstating
# the gain. Bar length is proportional to Elo GAINED, the honest quantity.
def _elo_fig(hist):
    pts = [h for h in hist if isinstance(h, dict) and h.get("best") is not None]
    if len(pts) < 2:
        return []
    bests = [int(h.get("best", 0)) for h in pts]
    hi = max(bests)
    base = 1200
    if min(bests) < base:
        base = min(bests)
    span = (hi - base) or 1
    width = 40
    fig = ["```text", str(ascii_title_text or ""), ""]
    for h in pts:
        b = int(h.get("best", 0))
        fill = int(round((b - base) * width / span)) if span else width
        bar = "#" * max(1, fill)
        label = ("final " if h.get("final") else "cycle ") + str(h.get("cycle"))
        fig.append(label.ljust(9) + "| " + bar + " " + str(b))
    fig.append("")
    fig.append(str(ascii_note_text or "").replace("{{base}}", str(base)))
    fig.append("```")
    return fig
if elo_ok:
    lines.append(str(trajectory_heading_text or ""))
    lines.append("")
    lines.append("![" + str(elo_fig_alt_text or "") + "](" + str(elo_png_path) + ")")
    lines.append("")
else:
    ascii_elo = _elo_fig(elo_history or [])
    if ascii_elo:
        lines.append(str(trajectory_heading_text or ""))
        lines.append("")
        lines.extend(ascii_elo)
        lines.append("")
lines.append("---")
lines.append("")
return {"lines": lines}
""".strip()

REPORT_RANKED_CODE = """
ranked = ranked_hypotheses or []
lines = []
lines.append(str(ranked_heading_text or ""))
lines.append("")
# Deterministic at-a-glance comparison table (a real table in the PDF/DOCX
# exports), built from structured tournament data so the report always carries
# a table on the key hypotheses independent of what the meta-review chose.
def _cell(v):
    s = str(v if v is not None else "\\u2014")
    s = s.replace("|", "/").replace("\\n", " ").strip() or "\\u2014"
    # Width cap: junk/nested values stringify safely but an arbitrarily wide
    # cell breaks table layout in the PDF. #[WARNING:TRUNCATION] display-only
    # at-a-glance table cell, labeled "..."; the full row text follows below.
    return s[:117] + "..." if len(s) > 120 else s
if ranked:
    lines.append(str(glance_heading_text or ""))
    lines.append("")
    lines.append(str(ranking_criterion_text or ""))
    lines.append("")
    lines.append(str(table_header_text or ""))
    lines.append(str(table_separator_text or ""))
    for h in ranked:
        rv = h.get("reviews") or {}
        fl = h.get("flags") or []
        title = _cell(h.get("title") or str(untitled_text or ""))
        if len(title) > 80:
            title = title[:77] + "..."
        lines.append(
            "| " + _cell(h.get("rank"))
            + " | " + title
            + " | " + _cell(h.get("elo"))
            + " | " + _cell(rv.get("correctness"))
            + " | " + _cell(rv.get("novelty"))
            + " | " + _cell(rv.get("testability"))
            + " | " + (_cell(", ".join(str(f) for f in fl)) if fl else "\\u2014")
            + " |"
        )
    lines.append("")
for h in ranked:
    rv = h.get("reviews") or {}
    fl = h.get("flags") or []
    lines.append("### #" + str(h.get("rank")) + ". " + str(h.get("title") or str(untitled_text or "")))
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
        lines.append(str(hypothesis_label_text or "") + str(h.get("statement")))
        lines.append("")
    if h.get("rationale"):
        lines.append(str(rationale_label_text or "") + str(h.get("rationale")))
        lines.append("")
    # Structured experimental protocol (Specific-Aims style) - the testable
    # core a scientist acts on. Falls back to the one-line experiment.
    design = str(h.get("design") or "").strip()
    metric = str(h.get("metric") or "").strip()
    expected = str(h.get("expected_effect") or "").strip()
    falsif = str(h.get("falsification") or "").strip()
    if design or metric or expected or falsif:
        lines.append(str(protocol_label_text or ""))
        lines.append("")
        if design:
            lines.append(str(design_label_text or "") + design)
        if metric:
            lines.append(str(metric_label_text or "") + metric)
        if expected:
            lines.append(str(expected_label_text or "") + expected)
        if falsif:
            lines.append(str(falsified_label_text or "") + falsif)
        lines.append("")
    elif h.get("experiment"):
        lines.append(str(experiment_label_text or "") + str(h.get("experiment")))
        lines.append("")
    if rv.get("critique"):
        lines.append(str(critique_label_text or "") + str(rv.get("critique")))
        lines.append("")
lines.append("---")
lines.append("")
return {"lines": lines}
""".strip()

REPORT_LIMITS_CODE = """
# Limitations & threats to validity, then the source ledger: the deterministic
# honesty sections, so the reader weighs the deliverable correctly.
srcs = sources or []
lines = []
lines.append(str(limits_heading_text or ""))
lines.append("")
lines.append(str(limit_untested_text or ""))
lines.append(str(limit_selfeval_text or ""))
if bool(grounding_ok):
    lines.append(str(limit_grounded_text or "").replace("{{n}}", str(int(fetched_count or 0))))
else:
    lines.append(str(limit_ungrounded_text or ""))
lines.append(str(limit_seed_text or ""))
cites_verified = False
for s in srcs:
    if isinstance(s, dict) and s.get("verification"):
        cites_verified = True
        break
if cites_verified:
    lines.append(str(limit_cite_verified_text or ""))
else:
    lines.append(str(limit_cite_unverified_text or ""))
lines.append("")
lines.append("---")
lines.append("")
lines.append(str(sources_heading_text or ""))
lines.append("")
if srcs:
    for s in srcs:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()
        url = str(s.get("url") or "").strip()
        verif = str(s.get("verification") or "").strip()
        if verif == "verified":
            mark = str(mark_verified_text or "")
        elif verif == "mismatch":
            mark = str(mark_mismatch_text or "")
        elif verif == "unreachable":
            mark = str(mark_unreachable_text or "")
        elif verif == "unverified":
            mark = str(mark_unverified_text or "")
        else:
            mark = "" if s.get("fetched") else str(mark_unfetched_text or "")
        take = str(s.get("takeaway") or "").strip()
        line = "- **" + title + "**" + mark
        if url:
            line = line + " \\u2014 <" + url + ">"
        if take:
            line = line + " \\u2014 " + take
        lines.append(line)
else:
    lines.append(str(no_sources_text or ""))
lines.append("")
return {"lines": lines}
""".strip()

REPORT_JOIN_CODE = """
# Pure glue: four section line-arrays in document order. No prose here by
# construction - every sentence lives on the section node that owns it.
out = []
for chunk in (head_lines, method_lines, ranked_lines, limits_lines):
    for ln in (chunk or []):
        out.append(str(ln))
return {"report": "\\n".join(out)}
""".strip()


# ===========================================================================
# GRAPH HELPERS
# ===========================================================================

def _if(node_id, label, x, y, *, condition_expression):
    n = W.node(node_id, "if", label, x, y,
               inputs=[EXEC_IN, pin("condition", "condition", "boolean")],
               outputs=[pin("true", "true", "execution"),
                        pin("false", "false", "execution")],
               extra={"icon": "&#x2753;", "headerColor": "#F39C12"})
    return W.with_expressions(n, {"condition": condition_expression})


def _call_tool(node_id, label, allowed, x, y):
    # `raw` exposes the unmapped effect outcome ({mode, results:[{output,...}]})
    # - structured tool payloads survive on the raw channel even when the
    # (result, success) mapping flattens them.
    return W.node(node_id, "call_tool", label, x, y,
                  inputs=[EXEC_IN,
                          pin("tool_call", "tool_call", "object"),
                          pin("allowed_tools", "allowed_tools", "array")],
                  outputs=[EXEC_OUT,
                           pin("result", "result", "any"),
                           pin("success", "success", "boolean"),
                           pin("raw", "raw", "object")],
                  pin_defaults={"allowed_tools": allowed},
                  extra={"icon": "&#x1F527;", "headerColor": "#16A085"})


def cnode(node_id, label, body, inputs, outputs, texts=None, *, x=0.0, y=0.0):
    """A code node ON THE EXECUTION LANE whose PROSE is pin defaults.

    `inputs` are the data pins; `texts` become string pins carrying their
    sentence as the DEFAULT, so the properties panel edits the prompt/report
    wording as plain text and the body only fills `{{slots}}`.
    """
    ins = [pin(p, p, t) for p, t in inputs] + [pin(p, p, "string") for p in (texts or {})]
    n = code_node(node_id, label, body, x, y, ins,
                  outputs=[pin(p, p, t) for p, t in outputs], exec_pins=True)
    if texts:
        n["data"]["pinDefaults"].update(texts)
    return n


class Graph:
    """Accumulates nodes + edges with a running exec-lane seed position."""

    def __init__(self):
        self.nodes: list[dict] = []
        self.edges: list[dict] = []
        self._y = 0.0

    def add(self, node_dict):
        node_dict["position"] = {"x": 0.0, "y": self._y}
        self._y += 220.0
        self.nodes.append(node_dict)
        return node_dict

    def pure(self, node_dict):
        self.nodes.append(node_dict)
        return node_dict

    def ex(self, source, target, *, handle="exec-out"):
        self.edges.append(edge(source, handle, target, "exec-in", animated=True))

    def dw(self, source, source_handle, target, target_handle):
        self.edges.append(edge(source, source_handle, target, target_handle))

    def read(self, node_id, pin_id, var_name, default):
        """One Get Variable CHIP per run var a node reads - THE anti-blob move.

        Each chip reads ONE flat top-level run var onto a pin named after it,
        so the chips beside a node ARE the list of variables it uses, readable
        without opening anything. `get_var` walks dotted paths and returns
        `default` when a segment is missing, so this is an exact replacement
        for the `.get(key, default)` that used to hide inside a body.
        """
        chip_id = f"{node_id}__{pin_id}"
        self.pure(W.get_var(chip_id, var_name, default, 0.0, 0.0))
        self.dw(chip_id, "value", node_id, pin_id)

    def reads(self, node_id, specs):
        for pin_id, var_name, default in specs:
            self.read(node_id, pin_id, var_name, default)


def build_flow():
    flow = W.base_flow(
        "co-scientist", "co-scientist",
        "Deep multi-agent hypothesis engine (Nature 'AI co-scientist' replica). Starts FROM the literature by delegating grounding to the deep-research investigation engine (deep-plan + deep-investigate: real web search + a verified source ledger), then runs a supervisor loop of Generation -> Reflection -> Elo-ranking (prioritized pairwise scientific debate) -> Evolution -> research-expansion, threading meta-feedback forward each cycle with near-duplicate pruning, then a final search-grounded full review of the finalists and a Meta-review research overview. Deliberately deeper than a single-pass report - it scales test-time compute via the cycle budget.",
        ["abstractresearch.coscientist.v1"],
    )
    G = Graph()
    A = G.add
    P = G.pure

    # ---- the door ---------------------------------------------------------
    P(W.start_node("Research goal", [
        pin("research_goal", "research_goal", "string"),
        pin("num_hypotheses", "num_hypotheses", "number"),
        pin("max_cycles", "max_cycles", "number"),
        pin("effort", "effort", "string"),
        pin("provider", "provider", "provider_text"),
        pin("model", "model", "model"),
    ], 0, 0, pin_defaults={"num_hypotheses": 5, "max_cycles": 3, "effort": "standard"}))

    seed = A(cnode("seed_run", "Normalize budgets", SEED_RUN_CODE,
                   [("max_cycles", "number"), ("num_hypotheses", "number"),
                    ("updates_seed", "object")],
                   [("updates", "object")]))
    seed["data"]["pinDefaults"]["updates_seed"] = SEED_VARS
    G.dw("start", "max_cycles", "seed_run", "max_cycles")
    G.dw("start", "num_hypotheses", "seed_run", "num_hypotheses")
    A(W.set_vars("seed_vars", "Seed run variables", 0, 0, seed=SEED_VARS))
    G.ex("start", "seed_run")
    G.ex("seed_run", "seed_vars")
    G.dw("seed_run", "updates", "seed_vars", "updates")

    # ---- grounding: deep-plan -> deep-investigate -------------------------
    # PER-FIELD PINS, both directions. The child's `on_flow_start` fields are
    # input pins here and its `on_flow_end` fields are output pins, so the
    # contract is on the canvas and the three "compose the child's input
    # object" code nodes that used to hide it are gone.
    A(W.subflow_node("plan", "Research plan (deep-research)", "deep-plan", 0, 0,
                     child_inputs=[("request", "string"), ("effort", "string"),
                                   ("provider", "provider_text"), ("model", "model")],
                     child_outputs=[("plan", "object"), ("plan_markdown", "string")]))
    G.ex("seed_vars", "plan")
    G.dw("start", "research_goal", "plan", "request")
    G.dw("start", "effort", "plan", "effort")
    G.dw("start", "provider", "plan", "provider")
    G.dw("start", "model", "plan", "model")

    ground = A(W.subflow_node(
        "ground", "Literature investigation (deep-research)", "deep-investigate", 0, 0,
        child_inputs=[("request", "string"), ("effort", "string"),
                      ("provider", "provider_text"), ("model", "model"),
                      ("plan", "object"), ("adversarial_review", "object"),
                      ("round_index", "number"), ("total_rounds", "number")],
        child_outputs=[("investigation", "object"), ("scratchpad", "object")]))
    # adversarial_review is deep-investigate's OWN channel for reviewer
    # guidance ("use the latest adversarial_review input"). A live run once
    # made 8 web searches and returned an EMPTY source_ledger - searches
    # happened, ledger discipline failed. The briefing rides the channel the
    # subflow already reads, as an EDITABLE array pin default rather than a
    # literal buried in a code body.
    ground["data"]["pinDefaults"].update({
        "adversarial_review": {"verdict": "guidance", "guidance": [
            GROUND_LEDGER_RULE_TEXT, GROUND_EMPTY_LEDGER_RULE_TEXT,
            GROUND_PREFER_RULE_TEXT, GROUND_BUDGET_RULE_TEXT]},
        "round_index": 0, "total_rounds": 1,
    })
    G.ex("plan", "ground")
    G.dw("start", "research_goal", "ground", "request")
    G.dw("start", "effort", "ground", "effort")
    G.dw("start", "provider", "ground", "provider")
    G.dw("start", "model", "ground", "model")
    G.dw("plan", "plan", "ground", "plan")

    LIT_TEXTS = {
        "findings_heading_text": LIT_FINDINGS_HEADING_TEXT,
        "open_questions_heading_text": LIT_OPEN_HEADING_TEXT,
        "limitations_heading_text": LIT_LIMITS_HEADING_TEXT,
        "sources_heading_text": LIT_SOURCES_HEADING_TEXT,
        "unfetched_mark_text": LIT_UNFETCHED_MARK_TEXT,
        "ungrounded_warning_text": LIT_UNGROUNDED_WARNING_TEXT,
        "citation_rule_text": LIT_CITATION_RULE_TEXT,
        "no_citation_rule_text": LIT_NO_CITATION_RULE_TEXT,
        "empty_text": LIT_EMPTY_TEXT_TEXT,
    }
    A(cnode("lit_base", "Build literature base", LIT_BASE_CODE,
            [("investigation", "object")], [("updates", "object")], LIT_TEXTS))
    A(W.set_vars("set_lit_first", "Store first grounding attempt", 0, 0))
    G.ex("ground", "lit_base")
    G.ex("lit_base", "set_lit_first")
    G.dw("ground", "investigation", "lit_base", "investigation")
    G.dw("lit_base", "updates", "set_lit_first", "updates")

    # BOUNDED GROUNDING RETRY. Two consecutive live runs returned an empty
    # source_ledger (once with findings prose, once as an empty forced final at
    # max_iterations), so grounding needs a second chance with more room, not
    # hope. The gate is boolean ALGEBRA over a run var, which is what a pin
    # expression is for - a plain read would be a chip.
    A(_if("if_ground_retry", "Grounding empty? retry once", 0, 0,
          condition_expression="not vars.lit_grounding_ok"))
    G.ex("set_lit_first", "if_ground_retry")

    retry = A(W.subflow_node(
        "ground_retry", "Literature investigation (retry)", "deep-investigate", 0, 0,
        child_inputs=[("request", "string"), ("effort", "string"),
                      ("provider", "provider_text"), ("model", "model"),
                      ("plan", "object"), ("prior_investigation", "object"),
                      ("adversarial_review", "object"),
                      ("round_index", "number"), ("total_rounds", "number")],
        child_outputs=[("investigation", "object")]))
    # The retry builds ON the first attempt, leads with the failure fact, and
    # ESCALATES effort to "thorough" (10 agent iterations vs standard's 6 - the
    # observed failure burned all 6 gathering and had none left to compose).
    retry["data"]["pinDefaults"].update({
        "effort": "thorough",
        "adversarial_review": {"verdict": "retry", "guidance": [
            RETRY_FAILED_RULE_TEXT, RETRY_FETCH_RULE_TEXT, RETRY_STOP_RULE_TEXT]},
        "round_index": 1, "total_rounds": 2,
    })
    G.ex("if_ground_retry", "ground_retry", handle="true")
    G.dw("start", "research_goal", "ground_retry", "request")
    G.dw("start", "provider", "ground_retry", "provider")
    G.dw("start", "model", "ground_retry", "model")
    G.dw("plan", "plan", "ground_retry", "plan")
    G.dw("ground", "investigation", "ground_retry", "prior_investigation")

    A(cnode("lit_base_retry", "Build literature base (retry)", LIT_BASE_CODE,
            [("investigation", "object")], [("updates", "object")], dict(LIT_TEXTS)))
    G.ex("ground_retry", "lit_base_retry")
    G.dw("ground_retry", "investigation", "lit_base_retry", "investigation")

    A(cnode("lit_pick", "Pick grounded attempt", LIT_PICK_CODE,
            [("retry_updates", "object"), ("first_warnings", "array")],
            [("updates", "object")],
            {"retry_ok_warning_text": PICK_RETRY_OK_WARNING_TEXT,
             "retry_failed_warning_text": PICK_RETRY_FAILED_WARNING_TEXT}))
    G.ex("lit_base_retry", "lit_pick")
    G.dw("lit_base_retry", "updates", "lit_pick", "retry_updates")
    G.read("lit_pick", "first_warnings", "lit_warnings", [])
    A(W.set_vars("set_lit_retry", "Store picked grounding", 0, 0))
    G.ex("lit_pick", "set_lit_retry")
    G.dw("lit_pick", "updates", "set_lit_retry", "updates")

    # ---- deterministic citation verification ------------------------------
    # The allowlist constrains the WRITER to the ledger; nothing verified the
    # LEDGER, and a run once laundered a wrong title<->id pairing eight times.
    # Both grounding branches converge here (multi-entry), then generation runs
    # against the VERIFIED literature.
    A(W.set_vars("cite_init", "Reset citation checks", 0, 0, seed={"cite_checks": []}))
    G.ex("set_lit_retry", "cite_init")
    G.ex("if_ground_retry", "cite_init", handle="false")

    A(cnode("cite_items", "Citable sources to verify", CITE_ITEMS_CODE,
            [("sources", "array")], [("items", "array"), ("count", "number")]))
    G.ex("cite_init", "cite_items")
    G.read("cite_items", "sources", "lit_sources", [])

    A(W.foreach_node("cite_each", "Verify each citation URL", 0, 0))
    G.ex("cite_items", "cite_each")
    G.dw("cite_items", "items", "cite_each", "items")

    A(cnode("cite_args", "Compose fetch_url call", CITE_ARGS_CODE,
            [("item", "object")], [("tool_call", "object")]))
    G.ex("cite_each", "cite_args", handle="loop")
    G.dw("cite_each", "item", "cite_args", "item")

    A(_call_tool("cite_call", "Fetch source URL", ["fetch_url"], 0, 0))
    G.ex("cite_args", "cite_call")
    G.dw("cite_args", "tool_call", "cite_call", "tool_call")

    A(cnode("cite_fold", "Fold title verdict", CITE_FOLD_CODE,
            [("item", "object"), ("raw", "object"), ("acc", "array")],
            [("updates", "object")]))
    G.ex("cite_call", "cite_fold")
    G.dw("cite_each", "item", "cite_fold", "item")
    G.dw("cite_call", "raw", "cite_fold", "raw")
    G.read("cite_fold", "acc", "cite_checks", [])
    A(W.set_vars("set_citecheck", "Record verdict", 0, 0))
    G.ex("cite_fold", "set_citecheck")
    G.dw("cite_fold", "updates", "set_citecheck", "updates")

    A(cnode("cite_apply", "Apply verification to literature", CITE_APPLY_CODE,
            [("lit_text", "string"), ("sources", "array"), ("warnings", "array"),
             ("checks", "array")],
            [("updates", "object")],
            {"failed_suffix_text": CITE_FAILED_SUFFIX_TEXT,
             "dropped_warning_text": CITE_DROPPED_WARNING_TEXT,
             "verification_heading_text": CITE_VERIFICATION_HEADING_TEXT,
             "unchecked_note_text": CITE_UNCHECKED_NOTE_TEXT,
             "unchecked_warning_text": CITE_UNCHECKED_WARNING_TEXT,
             "revised_rule_text": CITE_REVISED_RULE_TEXT,
             "none_left_rule_text": CITE_NONE_LEFT_RULE_TEXT,
             "none_left_warning_text": CITE_NONE_LEFT_WARNING_TEXT}))
    G.ex("cite_each", "cite_apply", handle="done")
    G.reads("cite_apply", [("lit_text", "lit_text", ""), ("sources", "lit_sources", []),
                           ("warnings", "lit_warnings", []), ("checks", "cite_checks", [])])
    A(W.set_vars("set_lit_verified", "Store verified literature", 0, 0))
    G.ex("cite_apply", "set_lit_verified")
    G.dw("cite_apply", "updates", "set_lit_verified", "updates")

    # ---- generation grounded in the verified literature -------------------
    A(cnode("gen_prompt", "Compose generation prompt", GEN_PROMPT_CODE,
            [("research_goal", "string"), ("num_hypotheses", "number"),
             ("literature", "string")], [("prompt", "string")],
            {"brief_text": GEN_BRIEF_TEXT, "goal_heading_text": GEN_GOAL_HEADING_TEXT,
             "literature_heading_text": GEN_LIT_HEADING_TEXT}))
    G.ex("set_lit_verified", "gen_prompt")
    G.dw("start", "research_goal", "gen_prompt", "research_goal")
    G.dw("start", "num_hypotheses", "gen_prompt", "num_hypotheses")
    G.read("gen_prompt", "literature", "lit_text", "")

    A(W.llm_node("generate", "Generation agent", 0, 0, pin_defaults={
        "system": "You are the Generation agent of an AI co-scientist. You produce novel, grounded, testable scientific hypotheses, reasoning carefully over the supplied literature base.",
        "temperature": 0.7, "resp_schema": HYP_SCHEMA,
    }))
    G.ex("gen_prompt", "generate")
    G.dw("gen_prompt", "prompt", "generate", "prompt")
    G.dw("start", "provider", "generate", "provider")
    G.dw("start", "model", "generate", "model")

    A(cnode("init_state", "Init hypothesis pool", INIT_STATE_CODE,
            [("generated", "object")], [("updates", "object")]))
    G.ex("generate", "init_state")
    G.dw("generate", "data", "init_state", "generated")
    A(W.set_vars("set_init", "Seed tournament vars", 0, 0))
    G.ex("init_state", "set_init")
    G.dw("init_state", "updates", "set_init", "updates")

    # ---- the supervisor loop ----------------------------------------------
    # The condition is a genuine DERIVATION (a comparison and a boolean AND
    # over two run vars), which is exactly the expression tier's job; the
    # three-node get_var + code + wire chain it replaces said nothing extra.
    # Expressions are re-evaluated at every input resolution, so the loop
    # re-reads `cycle` and `pool` fresh each iteration.
    A(W.with_expressions(
        W.while_node("cycles", "Supervisor rounds (test-time compute)", 0, 0),
        {"condition": "vars.cycle < vars.max_cycles and len(vars.pool) > 0"}))
    G.ex("set_init", "cycles")

    POOL_TEXTS = {"unreviewed_mark_text": POOL_UNREVIEWED_MARK_TEXT}
    A(cnode("pool_text", "Serialize pool", POOL_TEXT_CODE, [("pool", "array")],
            [("decorated", "string"), ("clean", "string")], dict(POOL_TEXTS)))
    G.ex("cycles", "pool_text", handle="loop")
    G.read("pool_text", "pool", "pool", [])

    A(cnode("cycle_strategy", "This cycle's evolution strategy", CYCLE_STRATEGY_CODE,
            [("cycle", "number")], [("strategy", "string")],
            {"combination_text": STRATEGY_COMBINATION_TEXT,
             "simplification_text": STRATEGY_SIMPLIFICATION_TEXT,
             "out_of_box_text": STRATEGY_OUT_OF_BOX_TEXT,
             "grounding_text": STRATEGY_GROUNDING_TEXT}))
    G.ex("pool_text", "cycle_strategy")
    G.read("cycle_strategy", "cycle", "cycle", 0)

    A(cnode("rank_pairs", "Prioritize match pairs", RANK_PAIRS_CODE, [("pool", "array")],
            [("text", "string"), ("count", "number")]))
    G.ex("cycle_strategy", "rank_pairs")
    G.read("rank_pairs", "pool", "pool", [])

    A(cnode("reflect_prompt", "Reflect prompt", REFLECT_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string"),
             ("literature", "string"), ("feedback", "string")],
            [("prompt", "string")],
            {"brief_text": REFLECT_BRIEF_TEXT,
             "feedback_heading_text": REFLECT_FEEDBACK_HEADING_TEXT,
             "goal_heading_text": REFLECT_GOAL_HEADING_TEXT,
             "literature_heading_text": REFLECT_LIT_HEADING_TEXT,
             "pool_heading_text": REFLECT_POOL_HEADING_TEXT}))
    G.ex("rank_pairs", "reflect_prompt")
    G.dw("start", "research_goal", "reflect_prompt", "research_goal")
    G.dw("pool_text", "decorated", "reflect_prompt", "pool_text")
    G.read("reflect_prompt", "literature", "lit_text", "")
    G.read("reflect_prompt", "feedback", "feedback", "")

    A(W.llm_node("reflect", "Reflection agent (initial review)", 0, 0, pin_defaults={
        "system": "You are the Reflection agent: a rigorous virtual scientific peer reviewer who judges hypotheses against the literature and weighs correctness as heavily as novelty.",
        "temperature": 0.2, "resp_schema": REVIEW_SCHEMA,
    }))
    G.ex("reflect_prompt", "reflect")
    G.dw("reflect_prompt", "prompt", "reflect", "prompt")
    G.dw("start", "provider", "reflect", "provider")
    G.dw("start", "model", "reflect", "model")

    A(cnode("rank_prompt", "Rank prompt", RANK_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string"),
             ("pairs", "string"), ("feedback", "string")],
            [("prompt", "string")],
            {"brief_text": RANK_BRIEF_TEXT,
             "feedback_heading_text": RANK_FEEDBACK_HEADING_TEXT,
             "goal_heading_text": RANK_GOAL_HEADING_TEXT,
             "pairs_heading_text": RANK_PAIRS_HEADING_TEXT,
             "pool_heading_text": RANK_POOL_HEADING_TEXT}))
    G.ex("reflect", "rank_prompt")
    G.dw("start", "research_goal", "rank_prompt", "research_goal")
    G.dw("pool_text", "decorated", "rank_prompt", "pool_text")
    G.dw("rank_pairs", "text", "rank_prompt", "pairs")
    G.read("rank_prompt", "feedback", "feedback", "")

    A(W.llm_node("rank", "Ranking agent (Elo tournament)", 0, 0, pin_defaults={
        "system": "You are the Ranking agent: you run an Elo tournament via simulated scientific debate, ranking on plausibility first.",
        "temperature": 0.3, "resp_schema": RANK_SCHEMA,
    }))
    G.ex("rank_prompt", "rank")
    G.dw("rank_prompt", "prompt", "rank", "prompt")
    G.dw("start", "provider", "rank", "provider")
    G.dw("start", "model", "rank", "model")

    A(cnode("evolve_prompt", "Evolve prompt", EVOLVE_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string"),
             ("literature", "string"), ("feedback", "string"), ("strategy", "string")],
            [("prompt", "string")],
            {"brief_text": EVOLVE_BRIEF_TEXT,
             "default_strategy_text": EVOLVE_DEFAULT_STRATEGY_TEXT,
             "feedback_heading_text": EVOLVE_FEEDBACK_HEADING_TEXT,
             "goal_heading_text": EVOLVE_GOAL_HEADING_TEXT,
             "literature_heading_text": EVOLVE_LIT_HEADING_TEXT,
             "pool_heading_text": EVOLVE_POOL_HEADING_TEXT}))
    G.ex("rank", "evolve_prompt")
    G.dw("start", "research_goal", "evolve_prompt", "research_goal")
    # generative stages read the CLEAN view: no ids, no Elo, no [UNREVIEWED]
    G.dw("pool_text", "clean", "evolve_prompt", "pool_text")
    G.dw("cycle_strategy", "strategy", "evolve_prompt", "strategy")
    G.read("evolve_prompt", "literature", "lit_text", "")
    G.read("evolve_prompt", "feedback", "feedback", "")

    A(W.llm_node("evolve", "Evolution agent (refine)", 0, 0, pin_defaults={
        "system": "You are the Evolution agent: you refine, combine, and extend top hypotheses into improved ones, avoiding near-duplicates.",
        "temperature": 0.6, "resp_schema": EVOLVE_SCHEMA,
    }))
    G.ex("evolve_prompt", "evolve")
    G.dw("evolve_prompt", "prompt", "evolve", "prompt")
    G.dw("start", "provider", "evolve", "provider")
    G.dw("start", "model", "evolve", "model")

    A(cnode("expand_prompt", "Expand prompt", EXPAND_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string"),
             ("literature", "string"), ("open_questions", "array"),
             ("feedback", "string")],
            [("prompt", "string")],
            {"brief_text": EXPAND_BRIEF_TEXT,
             "feedback_heading_text": EXPAND_FEEDBACK_HEADING_TEXT,
             "open_questions_heading_text": EXPAND_OPEN_HEADING_TEXT,
             "goal_heading_text": EXPAND_GOAL_HEADING_TEXT,
             "literature_heading_text": EXPAND_LIT_HEADING_TEXT,
             "pool_heading_text": EXPAND_POOL_HEADING_TEXT}))
    G.ex("evolve", "expand_prompt")
    G.dw("start", "research_goal", "expand_prompt", "research_goal")
    G.dw("pool_text", "clean", "expand_prompt", "pool_text")
    G.reads("expand_prompt", [("literature", "lit_text", ""),
                              ("open_questions", "lit_open_questions", []),
                              ("feedback", "feedback", "")])

    A(W.llm_node("expand", "Generation agent (research expansion)", 0, 0, pin_defaults={
        "system": "You are the Generation agent exploring UNEXPLORED areas of the hypothesis space, opening new directions the current pool does not cover.",
        "temperature": 0.8, "resp_schema": HYP_SCHEMA,
    }))
    G.ex("expand_prompt", "expand")
    G.dw("expand_prompt", "prompt", "expand", "prompt")
    G.dw("start", "provider", "expand", "provider")
    G.dw("start", "model", "expand", "model")

    A(cnode("fold", "Fold reviews+Elo+evolved+expanded+feedback", FOLD_STATE_CODE,
            [("pool", "array"), ("cycle", "number"), ("next_id", "number"),
             ("elo_history", "array"), ("reviews", "object"), ("matches", "object"),
             ("evolved", "object"), ("expanded", "object")],
            [("updates", "object")],
            {"critique_heading_text": FOLD_CRITIQUE_HEADING_TEXT,
             "debate_heading_text": FOLD_DEBATE_HEADING_TEXT}))
    G.ex("expand", "fold")
    G.reads("fold", [("pool", "pool", []), ("cycle", "cycle", 0),
                     ("next_id", "next_id", 0), ("elo_history", "elo_history", [])])
    G.dw("reflect", "data", "fold", "reviews")
    G.dw("rank", "data", "fold", "matches")
    G.dw("evolve", "data", "fold", "evolved")
    G.dw("expand", "data", "fold", "expanded")
    A(W.set_vars("set_state", "Persist tournament state", 0, 0))
    G.ex("fold", "set_state")
    G.dw("fold", "updates", "set_state", "updates")

    # ---- terminal full review (search-grounded) + final tournament --------
    A(cnode("term_pool_text", "Serialize finalists", POOL_TEXT_CODE, [("pool", "array")],
            [("decorated", "string"), ("clean", "string")], dict(POOL_TEXTS)))
    G.ex("cycles", "term_pool_text", handle="done")
    G.read("term_pool_text", "pool", "pool", [])

    A(cnode("term_reflect_prompt", "Full-review prompt", TERM_REFLECT_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string")],
            [("prompt", "string")],
            {"brief_text": TERM_REFLECT_BRIEF_TEXT,
             "goal_heading_text": TERM_REFLECT_GOAL_HEADING_TEXT,
             "pool_heading_text": TERM_REFLECT_POOL_HEADING_TEXT}))
    G.ex("term_pool_text", "term_reflect_prompt")
    G.dw("start", "research_goal", "term_reflect_prompt", "research_goal")
    G.dw("term_pool_text", "decorated", "term_reflect_prompt", "pool_text")

    A(W.agent_node("term_reflect", "Reflection agent (full search review)", 0, 0,
                   pin_defaults={
                       "system": "You are the Reflection agent performing a deep, literature-grounded full review. You verify novelty and correctness against real sources using read-only web tools, and never fabricate citations.",
                       "tools": SEARCH_TOOLS,
                       "temperature": 0.2,
                       "max_iterations": 4,
                       "resp_schema": REVIEW_SCHEMA,
                   }))
    G.ex("term_reflect_prompt", "term_reflect")
    G.dw("term_reflect_prompt", "prompt", "term_reflect", "prompt")
    G.dw("start", "provider", "term_reflect", "provider")
    G.dw("start", "model", "term_reflect", "model")

    A(cnode("term_rank_prompt", "Final rank prompt", TERM_RANK_PROMPT_CODE,
            [("research_goal", "string"), ("pool_text", "string")],
            [("prompt", "string")],
            {"brief_text": TERM_RANK_BRIEF_TEXT,
             "goal_heading_text": TERM_RANK_GOAL_HEADING_TEXT,
             "pool_heading_text": TERM_RANK_POOL_HEADING_TEXT}))
    G.ex("term_reflect", "term_rank_prompt")
    G.dw("start", "research_goal", "term_rank_prompt", "research_goal")
    G.dw("term_pool_text", "decorated", "term_rank_prompt", "pool_text")

    A(W.llm_node("term_rank", "Ranking agent (final tournament)", 0, 0, pin_defaults={
        "system": "You are the Ranking agent holding the final Elo tournament, ranking on plausibility first.",
        "temperature": 0.3, "resp_schema": RANK_SCHEMA,
    }))
    G.ex("term_rank_prompt", "term_rank")
    G.dw("term_rank_prompt", "prompt", "term_rank", "prompt")
    G.dw("start", "provider", "term_rank", "provider")
    G.dw("start", "model", "term_rank", "model")

    A(cnode("term_fold", "Apply full review + final Elo", TERM_FOLD_CODE,
            [("pool", "array"), ("cycle", "number"), ("elo_history", "array"),
             ("reviews", "object"), ("matches", "object")],
            [("updates", "object")]))
    G.ex("term_rank", "term_fold")
    G.reads("term_fold", [("pool", "pool", []), ("cycle", "cycle", 0),
                          ("elo_history", "elo_history", [])])
    G.dw("term_reflect", "data", "term_fold", "reviews")
    G.dw("term_rank", "data", "term_fold", "matches")
    A(W.set_vars("set_term_state", "Persist final state", 0, 0))
    G.ex("term_fold", "set_term_state")
    G.dw("term_fold", "updates", "set_term_state", "updates")

    A(cnode("final", "Rank final pool", FINAL_CODE,
            [("pool", "array"), ("cycle", "number"), ("warnings", "array"),
             ("elo_history", "array")],
            [("updates", "object")],
            {"unreviewed_warning_text": FINAL_UNREVIEWED_WARNING_TEXT,
             "unsafe_warning_text": FINAL_UNSAFE_WARNING_TEXT}))
    G.ex("set_term_state", "final")
    G.reads("final", [("pool", "pool", []), ("cycle", "cycle", 0),
                      ("warnings", "lit_warnings", []), ("elo_history", "elo_history", [])])
    A(W.set_vars("set_final", "Publish final ranking", 0, 0))
    G.ex("final", "set_final")
    G.dw("final", "updates", "set_final", "updates")

    # ---- meta-review --------------------------------------------------------
    A(cnode("meta_prompt", "Meta-review prompt", META_PROMPT_CODE,
            [("research_goal", "string"), ("ranked_hypotheses", "array"),
             ("literature", "string"), ("grounding_ok", "boolean")],
            [("prompt", "string")],
            {"brief_text": META_BRIEF_TEXT,
             "goal_heading_text": META_GOAL_HEADING_TEXT,
             "zero_sources_text": META_ZERO_SOURCES_TEXT,
             "literature_heading_text": META_LIT_HEADING_TEXT,
             "ranked_heading_text": META_RANKED_HEADING_TEXT,
             "flags_line_text": META_FLAGS_LINE_TEXT}))
    G.ex("set_final", "meta_prompt")
    G.dw("start", "research_goal", "meta_prompt", "research_goal")
    G.reads("meta_prompt", [("ranked_hypotheses", "ranked_hypotheses", []),
                            ("literature", "lit_text", ""),
                            ("grounding_ok", "lit_grounding_ok", False)])

    A(W.llm_node("meta", "Meta-review agent", 0, 0, pin_defaults={
        "system": "You are the Meta-review agent: you synthesize the tournament's top hypotheses and the literature into a rigorous research overview.",
        "temperature": 0.4,
    }))
    G.ex("meta_prompt", "meta")
    G.dw("meta_prompt", "prompt", "meta", "prompt")
    G.dw("start", "provider", "meta", "provider")
    G.dw("start", "model", "meta", "model")

    # ---- freeze the run timestamp once, before the figures -----------------
    P(W.system_datetime_node("run_ts", "Timestamp", 0, 0))
    A(cnode("freeze_ts", "Freeze run timestamp", FREEZE_TS_CODE, [("iso", "string")],
            [("updates", "object")], {"fallback_text": EXPORT_FALLBACK_STAMP_TEXT}))
    G.ex("meta", "freeze_ts")
    G.dw("run_ts", "iso", "freeze_ts", "iso")
    A(W.set_vars("set_ts", "Store run timestamp", 0, 0))
    G.ex("freeze_ts", "set_ts")
    G.dw("freeze_ts", "updates", "set_ts", "updates")

    # ---- professional figures ----------------------------------------------
    A(cnode("fig_spec_prompt", "Figure spec prompt", FIG_SPEC_PROMPT_CODE,
            [("ranked_hypotheses", "array"), ("research_goal", "string")],
            [("prompt", "string")],
            {"brief_text": FIG_BRIEF_TEXT, "goal_heading_text": FIG_GOAL_HEADING_TEXT,
             "top_heading_text": FIG_TOP_HEADING_TEXT}))
    G.ex("set_ts", "fig_spec_prompt")
    G.dw("start", "research_goal", "fig_spec_prompt", "research_goal")
    G.read("fig_spec_prompt", "ranked_hypotheses", "ranked_hypotheses", [])

    A(W.llm_node("fig_spec", "Architecture figure designer", 0, 0, pin_defaults={
        "system": "You design clean architecture figures as structured specs. You never invent components; you compose the given hypotheses into one legible pipeline.",
        "temperature": 0.2, "resp_schema": FIGURE_SCHEMA,
    }))
    G.ex("fig_spec_prompt", "fig_spec")
    G.dw("fig_spec_prompt", "prompt", "fig_spec", "prompt")
    G.dw("start", "provider", "fig_spec", "provider")
    G.dw("start", "model", "fig_spec", "model")

    A(cnode("fig_fold", "Clamp figure spec", FIG_SPEC_FOLD_CODE, [("data", "object")],
            [("spec", "object"), ("ok", "boolean"), ("title", "string"),
             ("caption", "string")],
            {"fallback_title_text": FIG_FALLBACK_TITLE_TEXT}))
    G.ex("fig_spec", "fig_fold")
    G.dw("fig_spec", "data", "fig_fold", "data")

    A(cnode("arch_input", "Compose arch render input", RENDER_INPUT_CODE,
            [("spec", "object"), ("stamp", "string")],
            [("spec", "object"), ("basename", "string")],
            {"basename_prefix_text": ARCH_BASENAME_PREFIX_TEXT}))
    G.ex("fig_fold", "arch_input")
    G.dw("fig_fold", "spec", "arch_input", "spec")
    G.read("arch_input", "stamp", "run_timestamp", "")

    arch = A(W.subflow_node("render_arch", "Render architecture figure", "diagram-render",
                            0, 0,
                            child_inputs=[("spec", "object"), ("out_dir", "string"),
                                          ("basename", "string")],
                            child_outputs=[("rendered", "boolean"), ("png_path", "string"),
                                           ("pdf_path", "string"), ("warnings", "array")]))
    arch["data"]["pinDefaults"]["out_dir"] = ARCH_OUT_DIR_TEXT
    G.ex("arch_input", "render_arch")
    G.dw("arch_input", "spec", "render_arch", "spec")
    G.dw("arch_input", "basename", "render_arch", "basename")

    A(cnode("elo_spec", "Elo trajectory spec", ELO_SPEC_CODE, [("elo_history", "array")],
            [("spec", "object"), ("ok", "boolean")],
            {"title_text": ELO_FIG_TITLE_TEXT, "caption_text": ELO_FIG_CAPTION_TEXT,
             "x_label_text": ELO_FIG_X_LABEL_TEXT, "y_label_text": ELO_FIG_Y_LABEL_TEXT}))
    G.ex("render_arch", "elo_spec")
    G.read("elo_spec", "elo_history", "elo_history", [])

    A(cnode("elo_input", "Compose elo render input", RENDER_INPUT_CODE,
            [("spec", "object"), ("stamp", "string")],
            [("spec", "object"), ("basename", "string")],
            {"basename_prefix_text": ELO_BASENAME_PREFIX_TEXT}))
    G.ex("elo_spec", "elo_input")
    G.dw("elo_spec", "spec", "elo_input", "spec")
    G.read("elo_input", "stamp", "run_timestamp", "")

    elo = A(W.subflow_node("render_elo", "Render Elo trajectory figure", "diagram-render",
                           0, 0,
                           child_inputs=[("spec", "object"), ("out_dir", "string"),
                                         ("basename", "string")],
                           child_outputs=[("rendered", "boolean"), ("png_path", "string"),
                                          ("pdf_path", "string"), ("warnings", "array")]))
    elo["data"]["pinDefaults"]["out_dir"] = ARCH_OUT_DIR_TEXT
    G.ex("elo_input", "render_elo")
    G.dw("elo_input", "spec", "render_elo", "spec")
    G.dw("elo_input", "basename", "render_elo", "basename")

    # ---- the report, one node per section ----------------------------------
    A(cnode("report_head", "Report: title, abstract, overview", REPORT_HEAD_CODE,
            [("research_goal", "string"), ("overview", "string"), ("cycles", "number"),
             ("warnings", "array"), ("arch_rendered", "boolean"),
             ("arch_png_path", "string"), ("arch_warnings", "array"),
             ("arch_title", "string"), ("arch_caption", "string"),
             ("elo_warnings", "array")],
            [("lines", "array"), ("title", "string"), ("doc_title", "string")],
            {"fallback_title_text": REPORT_FALLBACK_TITLE_TEXT,
             "goal_label_text": REPORT_GOAL_LABEL_TEXT,
             "abstract_label_text": REPORT_ABSTRACT_LABEL_TEXT,
             "provenance_text": REPORT_PROVENANCE_TEXT,
             "no_title_warning_text": REPORT_NO_TITLE_WARNING_TEXT,
             "no_abstract_warning_text": REPORT_NO_ABSTRACT_WARNING_TEXT,
             "caveats_heading_text": REPORT_CAVEATS_HEADING_TEXT,
             "overview_heading_text": REPORT_OVERVIEW_HEADING_TEXT,
             "no_overview_text": REPORT_NO_OVERVIEW_TEXT,
             "arch_fallback_title_text": REPORT_ARCH_FALLBACK_TITLE_TEXT,
             "arch_fallback_caption_text": REPORT_ARCH_FALLBACK_CAPTION_TEXT}))
    G.ex("render_elo", "report_head")
    G.dw("start", "research_goal", "report_head", "research_goal")
    G.dw("meta", "response", "report_head", "overview")
    G.reads("report_head", [("cycles", "final_cycles", 0),
                            ("warnings", "final_warnings", [])])
    G.dw("render_arch", "rendered", "report_head", "arch_rendered")
    G.dw("render_arch", "png_path", "report_head", "arch_png_path")
    G.dw("render_arch", "warnings", "report_head", "arch_warnings")
    G.dw("fig_fold", "title", "report_head", "arch_title")
    G.dw("fig_fold", "caption", "report_head", "arch_caption")
    G.dw("render_elo", "warnings", "report_head", "elo_warnings")

    A(cnode("report_method", "Report: methodology + trajectory", REPORT_METHOD_CODE,
            [("cycles", "number"), ("ranked_hypotheses", "array"), ("sources", "array"),
             ("grounding_ok", "boolean"), ("fetched_count", "number"),
             ("elo_history", "array"), ("elo_rendered", "boolean"),
             ("elo_png_path", "string")],
            [("lines", "array")],
            {"methodology_heading_text": REPORT_METHODOLOGY_HEADING_TEXT,
             "methodology_text": REPORT_METHODOLOGY_TEXT,
             "cycles_line_text": REPORT_CYCLES_LINE_TEXT,
             "ranked_count_line_text": REPORT_RANKED_COUNT_LINE_TEXT,
             "elo_line_text": REPORT_ELO_LINE_TEXT,
             "grounding_line_text": REPORT_GROUNDING_LINE_TEXT,
             "ungrounded_line_text": REPORT_UNGROUNDED_LINE_TEXT,
             "citation_check_line_text": REPORT_CITATION_CHECK_LINE_TEXT,
             "trajectory_heading_text": REPORT_TRAJECTORY_HEADING_TEXT,
             "elo_fig_alt_text": REPORT_ELO_FIG_ALT_TEXT,
             "ascii_title_text": REPORT_ASCII_TITLE_TEXT,
             "ascii_note_text": REPORT_ASCII_NOTE_TEXT}))
    G.ex("report_head", "report_method")
    G.reads("report_method", [("cycles", "final_cycles", 0),
                              ("ranked_hypotheses", "ranked_hypotheses", []),
                              ("sources", "lit_sources", []),
                              ("grounding_ok", "lit_grounding_ok", False),
                              ("fetched_count", "lit_fetched_count", 0),
                              ("elo_history", "elo_history", [])])
    G.dw("render_elo", "rendered", "report_method", "elo_rendered")
    G.dw("render_elo", "png_path", "report_method", "elo_png_path")

    A(cnode("report_ranked", "Report: ranked hypotheses", REPORT_RANKED_CODE,
            [("ranked_hypotheses", "array")], [("lines", "array")],
            {"ranked_heading_text": REPORT_RANKED_HEADING_TEXT,
             "glance_heading_text": REPORT_GLANCE_HEADING_TEXT,
             "ranking_criterion_text": REPORT_RANKING_CRITERION_TEXT,
             "table_header_text": REPORT_TABLE_HEADER_TEXT,
             "table_separator_text": REPORT_TABLE_SEPARATOR_TEXT,
             "untitled_text": REPORT_UNTITLED_TEXT,
             "hypothesis_label_text": REPORT_HYPOTHESIS_LABEL_TEXT,
             "rationale_label_text": REPORT_RATIONALE_LABEL_TEXT,
             "protocol_label_text": REPORT_PROTOCOL_LABEL_TEXT,
             "design_label_text": REPORT_DESIGN_LABEL_TEXT,
             "metric_label_text": REPORT_METRIC_LABEL_TEXT,
             "expected_label_text": REPORT_EXPECTED_LABEL_TEXT,
             "falsified_label_text": REPORT_FALSIFIED_LABEL_TEXT,
             "experiment_label_text": REPORT_EXPERIMENT_LABEL_TEXT,
             "critique_label_text": REPORT_CRITIQUE_LABEL_TEXT}))
    G.ex("report_method", "report_ranked")
    G.read("report_ranked", "ranked_hypotheses", "ranked_hypotheses", [])

    A(cnode("report_limits", "Report: limitations + sources", REPORT_LIMITS_CODE,
            [("grounding_ok", "boolean"), ("fetched_count", "number"),
             ("sources", "array")], [("lines", "array")],
            {"limits_heading_text": REPORT_LIMITS_HEADING_TEXT,
             "limit_untested_text": REPORT_LIMIT_UNTESTED_TEXT,
             "limit_selfeval_text": REPORT_LIMIT_SELFEVAL_TEXT,
             "limit_grounded_text": REPORT_LIMIT_GROUNDED_TEXT,
             "limit_ungrounded_text": REPORT_LIMIT_UNGROUNDED_TEXT,
             "limit_seed_text": REPORT_LIMIT_SEED_TEXT,
             "limit_cite_verified_text": REPORT_LIMIT_CITE_VERIFIED_TEXT,
             "limit_cite_unverified_text": REPORT_LIMIT_CITE_UNVERIFIED_TEXT,
             "sources_heading_text": REPORT_SOURCES_HEADING_TEXT,
             "no_sources_text": REPORT_NO_SOURCES_TEXT,
             "mark_verified_text": REPORT_MARK_VERIFIED_TEXT,
             "mark_mismatch_text": REPORT_MARK_MISMATCH_TEXT,
             "mark_unreachable_text": REPORT_MARK_UNREACHABLE_TEXT,
             "mark_unverified_text": REPORT_MARK_UNVERIFIED_TEXT,
             "mark_unfetched_text": REPORT_MARK_UNFETCHED_TEXT}))
    G.ex("report_ranked", "report_limits")
    G.reads("report_limits", [("grounding_ok", "lit_grounding_ok", False),
                              ("fetched_count", "lit_fetched_count", 0),
                              ("sources", "lit_sources", [])])

    A(cnode("report_md", "Assemble report markdown", REPORT_JOIN_CODE,
            [("head_lines", "array"), ("method_lines", "array"),
             ("ranked_lines", "array"), ("limits_lines", "array")],
            [("report", "string")]))
    G.ex("report_limits", "report_md")
    G.dw("report_head", "lines", "report_md", "head_lines")
    G.dw("report_method", "lines", "report_md", "method_lines")
    G.dw("report_ranked", "lines", "report_md", "ranked_lines")
    G.dw("report_limits", "lines", "report_md", "limits_lines")

    A(cnode("export_paths", "Build export paths", EXPORT_PATHS_CODE, [("stamp", "string")],
            [("md", "workspace_file"), ("pdf", "workspace_file"),
             ("docx", "workspace_file")],
            {"prefix_text": EXPORT_PREFIX_TEXT,
             "fallback_text": EXPORT_FALLBACK_STAMP_TEXT}))
    G.ex("report_md", "export_paths")
    G.read("export_paths", "stamp", "run_timestamp", "")

    # ---- export + durable artifact registration ----------------------------
    A(W.write_file_node("write_md", "Write .md", 0, 0))
    A(W.write_pdf_node("write_pdf", "Write .pdf", 0, 0))
    A(W.write_docx_node("write_docx", "Write .docx", 0, 0))
    G.ex("export_paths", "write_md")
    G.ex("write_md", "write_pdf")
    G.ex("write_pdf", "write_docx")
    G.dw("export_paths", "md", "write_md", "file_path")
    G.dw("report_md", "report", "write_md", "content")
    G.dw("export_paths", "pdf", "write_pdf", "file_path")
    G.dw("report_md", "report", "write_pdf", "content")
    G.dw("report_head", "doc_title", "write_pdf", "title")
    G.dw("export_paths", "docx", "write_docx", "file_path")
    G.dw("report_md", "report", "write_docx", "content")
    G.dw("report_head", "doc_title", "write_docx", "title")

    # write_* only places bytes in the workspace folder; importing each product
    # into the run's artifact store makes it listable/servable per run. Explicit
    # content_type per import: exec-chained payloads inherit the previous node's
    # output, so an unconnected content_type pin would inherit write_docx's type
    # for all three.
    A(W.import_workspace_file_node("import_md", "Register .md artifact", 0, 0,
                                   content_type="text/markdown"))
    A(W.import_workspace_file_node("import_pdf", "Register .pdf artifact", 0, 0,
                                   content_type="application/pdf"))
    A(W.import_workspace_file_node(
        "import_docx", "Register .docx artifact", 0, 0,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
    G.ex("write_docx", "import_md")
    G.ex("import_md", "import_pdf")
    G.ex("import_pdf", "import_docx")
    G.dw("write_md", "file_path", "import_md", "file_path")
    G.dw("write_pdf", "file_path", "import_pdf", "file_path")
    G.dw("write_docx", "file_path", "import_docx", "file_path")

    A(W.end_node("Research overview", [
        pin("research_overview", "research_overview", "string"),
        pin("report_markdown", "report_markdown", "string"),
        pin("ranked_hypotheses", "ranked_hypotheses", "array"),
        pin("top_hypothesis", "top_hypothesis", "object"),
        pin("sources", "sources", "array"),
        pin("warnings", "warnings", "array"),
        pin("cycles", "cycles", "number"),
        pin("md_path", "md_path", "workspace_file"),
        pin("pdf_path", "pdf_path", "workspace_file"),
        pin("docx_path", "docx_path", "workspace_file"),
        pin("pdf_sha256", "pdf_sha256", "string"),
        pin("docx_sha256", "docx_sha256", "string"),
        pin("md_artifact_id", "md_artifact_id", "string"),
        pin("pdf_artifact_id", "pdf_artifact_id", "string"),
        pin("docx_artifact_id", "docx_artifact_id", "string"),
    ], 0, 0))
    G.ex("import_docx", "end")
    G.dw("meta", "response", "end", "research_overview")
    G.dw("report_md", "report", "end", "report_markdown")
    # The five legacy `get` nodes that dug these out of one result object are
    # gone: each field is its own run var, read by its own chip.
    G.reads("end", [("ranked_hypotheses", "ranked_hypotheses", []),
                    ("top_hypothesis", "top_hypothesis", {}),
                    ("sources", "lit_sources", []),
                    ("warnings", "final_warnings", []),
                    ("cycles", "final_cycles", 0)])
    G.dw("write_md", "file_path", "end", "md_path")
    G.dw("write_pdf", "file_path", "end", "pdf_path")
    G.dw("write_docx", "file_path", "end", "docx_path")
    G.dw("write_pdf", "sha256", "end", "pdf_sha256")
    G.dw("write_docx", "sha256", "end", "docx_sha256")
    G.dw("import_md", "artifact_id", "end", "md_artifact_id")
    G.dw("import_pdf", "artifact_id", "end", "pdf_artifact_id")
    G.dw("import_docx", "artifact_id", "end", "docx_artifact_id")

    flow["nodes"] = G.nodes
    flow["edges"] = G.edges
    W.apply_flow_layout(flow)
    return flow


def main():
    flow = build_flow()
    problems = W.validate_edges(flow)
    print("edge problems:", problems)
    if problems:
        raise SystemExit(f"edge validation failed: {problems}")
    overlaps = W.layout_overlap_findings(flow)
    if overlaps:
        raise SystemExit(f"layout overlaps: {overlaps[:5]}")
    W.write_json(W.FLOWS_DIR / "co-scientist.json", flow)
    W.compile_check("co-scientist",
                    ["co-scientist", "deep-plan", "deep-investigate", "diagram-render"])
    print("compiled ok")
    out = W.pack_bundle(
        root_flow_id="co-scientist",
        bundle_id="co-scientist",
        # 0.2.0 = THE DOCTRINE REWORK. Four state blobs dissolved into flat run
        # vars written by set_vars and read by get_var chips; every code node on
        # the execution lane; 133 prompt/report sentences moved into editable
        # pin defaults with {{slots}}; five subflow calls converted to per-field
        # pins (three input-composer code nodes and three legacy `get` nodes
        # deleted with them); five more `get` nodes replaced by flat vars; the
        # supervisor-loop condition and the grounding-retry gate expressed as
        # pin expressions. NO OUTPUT CHANGED: scripts/coscientist_smoke.py
        # replays 63 golden cases captured from 0.1.16 through the real runtime
        # code lane and fails on a single byte of drift.
        # 0.2.1 = ADR-0026 (operator ruling 2026-09-28): no count or char caps
        # on what a model reads. The next cycle's feedback carries every
        # critique and debate reason whole (was 6 x 400 / 6 x 300 chars); the
        # expansion prompt lists every open question (was 6); the meta-review
        # and the figure-spec prompt read every ranked hypothesis (was top 5)
        # with the whole literature base (was 2500 chars), reviewer notes (was
        # 300) and statements (was 200); citation-check reasons and the
        # dropped-source warning quote whole titles (was 60/80/70). The golden
        # values those cuts shaped were re-captured deliberately (see
        # scripts/coscientist_fixtures.py, "ADR-0026 re-capture"). The embedded
        # diagram-render subflow is 0.2.1 (whole #FALLBACK errors).
        bundle_version="0.2.1",
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
