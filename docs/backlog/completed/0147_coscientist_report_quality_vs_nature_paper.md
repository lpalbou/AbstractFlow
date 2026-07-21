# Completed: co-scientist report quality/depth/fidelity wave vs the Nature paper

## Metadata
- Created: 2026-07-19
- Status: Completed
- Completed: 2026-07-19
- Work id: abstractflow-0147
- Thread anchor: operator DM directive 2026-07-19 (self-analyze the last 2
  co-scientist reports with 2 fable5 adversaries vs "Accelerating scientific
  discovery with Co-Scientist" (Nature 2026); fix/optimize; 2 cycles; live-gen
  on OVH gpt-oss-120b and verify improvement)

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Operator-directed review of the two most recent co-scientist reports against
the real Google "AI co-scientist" Nature paper, via two adversarial fable5
subagents (one methodology-vs-paper, one report-quality/visuals). Both
converged on the same credibility P0s.

Baseline defects (both reports, bundle 0.1.0 / 0.1.6):
- **Grounding gate defeated**: report R1's only "source" was a degenerate
  `internal_agent_output` entry that passed the `url != "n/a"` grounding check,
  so an ungrounded report shipped presenting itself as literature-grounded
  with no `#FALLBACK`.
- **Fabricated citations**: R2's ledger was ~50% wrong on checkable entries —
  right paper names paired with WRONG arXiv ids (Gato `2205.06177` vs real
  `2205.06175`; DNC `1606.04474` is actually a different paper; De Lange survey
  `1909.08385` vs `1909.08383`), plus fabricated NVIDIA/IBM/Boston-Dynamics
  "whitepaper" URLs, all labeled "high; evidence: primary".
- **Fake numeric claims + false provenance**: "Gato and Memorizing Transformers
  report forgetting rates of 15-25%" (neither does); Elo described as
  "community confidence" and hypotheses as "peer-reviewed".
- **Thin/self-referential experiments**: the "Proposed experiment" field was
  usually the hypothesis's own title restated.
- **Ranking inversion + crowding**: a reviewer-declared non-novel idea (novelty
  4) held rank 1; the top was four flavors of one idea.
- **Decoration leakage**: `(Elo 1224)` / `[UNREVIEWED]` / `[id]` bookkeeping
  echoed into reader-facing hypothesis titles and experiments.

## What was done (2 cycles, live-verified on OVH gpt-oss-120b)
Cycle 1 (`0.1.8`): hardened grounding gate (resolvable `http(s)://` required);
deterministic citation allowlist threaded into every generative prompt;
decoration-free generative pool view; novelty floor + diversity de-crowding in
the final ranking; structured per-hypothesis protocol
(design/metric/expected-effect/falsification) rendered Specific-Aims style;
per-cycle Evolution strategy rotation; honest Elo framing + numeric-citation
ban in the meta prompt; deterministic Methodology/provenance section + ASCII
Elo-evolution figure. Live run confirmed real grounding (12 real fetched
sources, 0 fabricated whitepapers), honest Elo framing, and falsifiable
protocols — and surfaced cycle-2 targets (field cross-contamination in
`design`; five near-duplicate routing variants still crowded the headline).

Cycle 2 (`0.1.9`): design-field-is-the-experimental-SETUP prompt fix (named
baselines/ablations/dataset, not the mechanism name); tighter expansion dedup
(0.45) + a headline cluster-cap (≤2 near-siblings before a distinct direction
must surface); a fold-level SANITIZER belt scrubbing every incoming field of
`(Elo N)` / `[UNREVIEWED]` / `[UNEXPLORED]` / `[id]` / `hypothesis [k]`; a
stated ranking-criterion line under the glance table; a deterministic
Limitations & threats-to-validity section; a deep-verification (assumption
decomposition) terminal review pass.

Degraded-path wave (`0.1.10`, from the live 0.1.9 run that fetched 0 sources):
the 0.1.9 run exercised the honest zero-source path end-to-end (deep-investigate
ran 8 searches but returned an empty source_ledger; the `#FALLBACK` banner,
"NONE fetched" methodology line, and "(no sources gathered)" section all
rendered; zero fabricated arXiv ids/DOIs/URLs) and exposed three defects:
(1) identical-title duplicates at ranks 3/4 + 6/8 — an evolved copy re-entered
under its parent's exact title with a reworded statement below the
token-overlap threshold; fixed with a normalized-title identity check in the
fold AND an identical-title collapse (keep best copy) in the final ranking,
ahead of the MMR cluster-cap which deliberately allows 2 loose siblings.
(2) With an EMPTY allowlist the prompts carried no citation rule at all, and
the meta-review name-dropped venues from parametric memory ("TGAT (KDD 2020)"
— wrong venue; TGAT was ICLR 2020); zero-source runs now get an explicit
paper/venue/year/id citation BAN in the literature text and at meta level.
(3) Ledger discipline is now threaded through deep-investigate's own
`adversarial_review` input channel (empty source_ledger = failed
investigation; prefer 5-12 fetched sources) — the channel its researcher
prompt already reads. Plus: the Elo trajectory figure anchors at the 1200
tournament start (min-anchoring rendered cycle 1 as a single '#' and
overstated the gain).

A second zero-source verification run exposed a SECOND grounding failure
shape: the guidance reached the prompt and the agent ran 6 real searches +
1 fetch, but burned its whole 6-iteration budget gathering — the forced
final at max_iterations came back empty. Two additions: a BUDGET RULE in the
guidance ("stop gathering with 2 rounds to spare; a complete answer with 4
ledger entries beats an empty answer after 8 searches") and a BOUNDED RETRY
BRANCH in the graph (0 fetched sources → one re-invocation of
deep-investigate at effort=thorough / 10 rounds, with `prior_investigation`
+ a ledger-first briefing; a deterministic picker keeps whichever attempt
grounded, labeling retry provenance `#FALLBACK`; the picked attempt rides a
`co.lit` var so the unexecuted branch is never dereferenced; `generate` is
multi-entry).

Final verification run (OVH gpt-oss-120b, 2 cycles): 9 real fetched sources;
every arXiv id and URL in the report resolves to the ledger (0 fabricated);
8 distinct hypothesis titles (0 duplicate pairs vs 3 pairs in the 0.1.9
run); Methodology / 1200-anchored Elo trajectory / Limitations /
ranking-criterion line / Specific-Aims protocols with falsification
thresholds all rendered; warnings empty.

Two-adversary before/after audit (`0.1.11`, operator-directed 1:1
comparison): both baseline goals were regenerated and two independent fable5
adversaries audited the four reports. VERDICTS: R1 genuinely/materially
better; R2 better with honesty materially improved; the epistemic-status
overhaul (honest Elo framing + Limitations + hypothesized-framing) named the
single most impressive improvement — it reverses an outright falsehood
("peer-reviewed... community confidence"). All seven claimed improvements
verified with quoted evidence; every baseline P0 class confirmed eliminated.
Their converged remaining defects were fixed as `0.1.11`:
- **Ledger laundering P0** (both ranked it #1): the allowlist constrained the
  writer to the ledger, but the LEDGER carried model-asserted wrong title↔id
  pairs stamped `fetched: true` ("Concrete Problems in AI Safety" on the
  EfficientNet id, cited 8x). Fixed with a DETERMINISTIC CITATION
  VERIFICATION loop: foreach ledger URL -> `call_tool fetch_url` (arXiv pdf
  normalized to abs) -> served-title token check (arXiv strict, others
  loose) -> mismatch/unreachable barred from citation + labeled + warned.
  Live catches on the first run: DNC's claimed id served "Range Majorities
  and Minorities in Arrays", EvolveGCN's served "GRET" — both barred, zero
  banned ids in prose.
- **Near-identical siblings** (HVGR held ranks 2 AND 8 one qualifier apart):
  containment >= 0.75 title collapse + visible `sibling`/`de-crowded` flags,
  with the ranking-criterion line explaining Elo non-monotonicity.
- **Falsification hygiene**: literal HYPOTHESIZED template tokens scrubbed
  deterministically; prompt FORM rules (same metric/direction as expected
  effect, no unadjudicated gap, no vague thresholds).
- **Evidence-verb honesty**: pool hypotheses / non-ledger works never take
  "demonstrates/shows/reports" (a sibling untested hypothesis had been cited
  as established fact); meta number-fidelity + rank-vs-Elo local explanation.
Verification runs on 0.1.11 (both goals): R2 exercised the full belt chain
live — first investigation 0 sources -> bounded retry succeeded -> 5/5
ledger URLs verified; R1 caught the 2 wrong-id pairings above. Zero
duplicate titles, zero HYPOTHESIZED tokens in criteria, zero banned ids
cited, de-crowded/sibling flags rendering.

Sandbox lesson (pinned): code nodes have NO `chr` builtin — the first 0.1.11
launch failed live on it; self-checks now compile AND execute new bodies
through the real RestrictedPython sandbox (`create_code_handler` +
`_generate_code_from_body`), never plain `exec`.

## Validation
- Every code-node change verified through the real RestrictedPython sandbox
  before packing (grounding gate true/false cases; clean-vs-decorated pool
  views; strategy rotation; novelty floor + diversity ordering; sanitizer
  strips decorations/ids; cluster-cap breaks routing-variant crowding;
  full report render with Methodology + Elo figure + Specific-Aims protocol +
  Limitations).
- Flow suite 346 green; generator compiles the co-scientist +
  deep-plan + deep-investigate tree through the runtime compiler; bundles
  packed + served by the live gateway (registry reloads verified).
- Live A/B on OVH gpt-oss-120b, same research question across cycles, direct
  comparison to the baseline report (see receipts on the operator thread).

## Honest limits / follow-ups
- **Renderer (runtime's `documents/` package):** no image embedding, and
  `---` / `>` blockquotes render as literal text; figures are ASCII/table only
  today. Raised with runtime as a coordination note (image-embed branch +
  hr/blockquote/KeepTogether/table-column-weight). Flow-side mitigation: the
  report avoids bare `>` blockquotes for the reader-facing callouts where it
  can.
- **Citation resolution:** the allowlist prevents fabrication but arXiv
  ids/DOIs are not each independently resolved at render time; the Limitations
  section states this, and a terminal citation-resolution step (the review
  agent already has `fetch_url`) is the next rung.
- **NIH Specific-Aims full proposal per top hypothesis** and a
  correctness×novelty scatter / pipeline figure are named future depth (need
  the renderer image branch to be their best form).
