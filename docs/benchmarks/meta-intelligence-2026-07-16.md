# Meta-intelligence benchmark — do deliberation workflows beat the isolated LLM?

2026-07-16 · model: `gpt-oss-120b` (OVH endpoint) for every stage AND the judge · all runs through the live gateway.

## The question

Operator ask: instead of one LLM answering directly, co-orchestrate multiple LLM calls
(self-reflection, planning, multi-angle consideration, introspection) — do these behave
better than the isolated LLM, and by how much?

## The arms

Six flows, all `abstractcode.agent.v1`-conformant (same prompt/provider/model in,
response out), so the ONLY variable is orchestration. Same system prompt everywhere.

| arm | pattern | LLM calls |
| --- | --- | --- |
| meta-baseline | one direct call (control) | 1 |
| meta-consensus | 2 independent answers (t=0.3/0.9) → reconciler | 3 |
| meta-debate | propose → adversarial attack → concede-or-rebut | 3 |
| meta-reflect | draft → introspection on the reasoning → revision | 3 |
| meta-perspectives | pick 3 question-specific angles → answer each → integrate | 5 |
| meta-deliberate | plan (pitfalls + checklist) → execute → verify vs checklist | 3 |

## Phase 1 — verifiable trap questions (12 items, 1 sample/cell)

Trap-style items (bat-and-ball, lily pads, rope ladder…) where the intuitive answer is
wrong. Graded on the COMMITTED final answer; grading was itself adversarially audited —
the first grader penalized verbose arms for *explaining* the trap, the second anchored on
the first bold number (often the premise). Nine disputed cells were adjudicated by hand.

| arm | correct | avg latency | avg tokens (in/out) | cost vs baseline |
| --- | --- | --- | --- | --- |
| meta-baseline | 10/12 | 5 s | 284 / 227 | 1.0x |
| meta-consensus | 10/12 | 8 s | 1 007 / 621 | 3.2x |
| **meta-debate** | **11/12** | 15 s | 1 453 / 1 476 | 5.7x |
| meta-reflect | 10/12 | 17 s | 2 125 / 1 821 | 7.7x |
| meta-perspectives | 9/12 | 26 s | 2 257 / 2 288 | 8.9x |
| meta-deliberate | 10/12 | 13 s | 2 256 / 1 141 | 6.6x |

Notes the numbers alone don't show:

- **`birthday-days` is a broken item** (self-contradictory wording; all six arms gave the
  same defensible "wrong" answer — zero discrimination). Excluding it: baseline 10/11,
  debate **11/11**, perspectives 9/11, others 10/11.
- **`rope-ladder` was the only genuinely discriminating item**: every arm fell for the
  trap (ship rises with the tide) EXCEPT meta-debate — the adversarial challenger caught
  it. This is the pattern working exactly as designed.
- **meta-perspectives lost a point by hedging**: its integrator dissolved a correct
  "5 minutes" into "5 minutes as a puzzle, ~7 in practice" — integration averaging away a
  correct answer is the known failure mode of persona ensembles, observed live.
- **Cost-matched control**: best-of-3 baseline (majority vote over 3 samples, ≈ consensus
  cost) also scored 10/12 — repeated sampling alone did not buy the debate win either.
- Statistical honesty: N=12 single-sample means ±1 item ≈ 8 pp; no between-arm difference
  here is statistically significant. The claims above are mechanism observations, not
  rankings.
- **Post-report addendum (replacement item)**: `birthday-days` was replaced with a clean
  `alarm-clock` wording and collected with FINAL-anchor grading. Result: baseline,
  consensus, reflect, perspectives answered 1 (correct); **debate and deliberate
  committed 13** — deliberation talked two arms OUT of an answer the direct call got
  right. This is the mirror image of rope-ladder (where only debate resisted) and
  sharpens the conclusion: orchestration effects are item-specific in BOTH directions;
  no pattern dominates.

## Phase 2 — open-ended questions (6 items × 5 pairs, blind pairwise)

Design/judgment/planning/explanation questions (memory-graph design, API versioning,
onboarding plan, entropy explanation, AI-merge policy, transport budget). Each meta arm's
answer judged against baseline's, blind, with **position swap** (two judgments per pair;
a win requires winning BOTH orders — order-flips count as ties). Judge = the same model
(caveat: shares the answerers' blind spots; a stronger judge is the obvious upgrade).

| arm | wins | losses | ties (of 6) |
| --- | --- | --- | --- |
| meta-consensus | 2 | 0 | 4 |
| meta-debate | 2 | 0 | 4 |
| meta-reflect | 1 | 0 | 5 |
| meta-perspectives | 0 | 2 | 4 |
| meta-deliberate | 0 | 0 | 6 |

The load-bearing observation: **22 of 30 pairs were judged "A" in both orders** — the
judge has massive position bias, and once neutralized, most pairs are inside its noise.
Where consistent preferences exist they favor consensus/debate/reflect (5 wins, 0 losses)
and disfavor perspectives (0 wins, 2 losses — hedged integrations again).

## Answer to the operator's question

**On this model, mostly no — with one real exception.**

1. **meta-debate is the only pattern with evidence on both phases** (11/12 verifiable,
   the only arm that caught the rope-ladder trap; 2-0-4 open-ended). Adversarial
   challenge is the deliberation shape that pays: it can find flaws the first pass
   missed, and the concede-or-rebut step keeps sound answers intact. Cost: ~5.7x tokens,
   ~3x latency.
2. **meta-consensus is the cheapest defensible upgrade** (3.2x tokens; 2-0-4 open-ended,
   no verifiable regression) — but best-of-3 sampling matches it on verifiable items, so
   its value is the reconciliation prose, not accuracy.
3. **meta-reflect and meta-deliberate are neutral on this model** — gpt-oss-120b already
   deliberates internally (long chain-of-thought before answering); an explicit
   plan/introspection pass mostly restates what the model does anyway.
4. **meta-perspectives HURT twice** (verifiable hedge, 0-2 open-ended): forcing
   integration across angles invites averaging away the correct view. Use it when the
   deliverable *is* the multi-angle analysis, not for accuracy.
5. **"By how much"**: on trap reasoning, +1 item (debate) at 5.7x cost — inside single-run
   noise at N=12; on open-ended, 5 consistent wins vs 2 losses across 30 pairs, the rest
   indistinguishable to a same-model judge. Honest headline: *small, pattern-specific
   gains, never free; the win concentrates in adversarial challenge.*

Caveats that bound these claims: one model (a strong reasoner — weaker models likely
benefit more from orchestration), one sample per cell, 12+6 items, same-model judge.
The harness (`scripts/meta_benchmark.mjs`, `meta_benchmark_open.mjs`) is resume-safe and
rerunnable against any provider/model pair for a proper multi-model answer.

## Where things stand

All six flows are live on the gateway (`meta-*@0.1.0`), visible in the Flow Library, and
usable as agent.v1 workflows anywhere a single agent is (abstractcode, assistant,
subflows). Adversarial review (fable5) found and we fixed: a host-injected `tools` leak
class (every llm node now pins `tools: []` as a declared default), type-guards on the
structured angle decomposition, explicit `tools` start pins for contract honesty, and an
optional `provider_b`/`model_b` on meta-consensus for true two-model consensus
(N>2 consensus = future loop-based flow; a composed "flagship" doing
absorption+angles+reflection+planning in one flow is likewise named future scope).
