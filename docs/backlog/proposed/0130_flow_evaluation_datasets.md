# Proposed: Evaluation datasets for flows (regression harness over gateway runs)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: Needs new ADR if adopted (eval artifacts/run labeling contract).

## Context
2026-07-11 competitive research: n8n Evaluations (datasets + metrics +
run-over-run comparison incl. token cost), OpenAI Agent Builder trace grading,
Vellum test suites. AbstractFlow: prompt/model changes in Agent/LLM nodes
regress silently; the run/ledger infrastructure needed for a regression
harness already exists.

## Current code reality
Runs are durable and inspectable; usage data rides ledgers; no dataset,
batch-run, scoring, or comparison surface exists.

## Problem or opportunity
AI workflows need regression datasets MORE than deterministic software does;
today every prompt tweak is a leap of faith.

## Proposed direction
Attach datasets (rows of inputs + expected/reference outputs) to a flow;
batch-run through the normal gateway path with an eval label; score via metric
nodes or an LLM-judge flow; comparison table across eval runs (pass rate,
token cost, duration). Start client-side (dataset in flow storage, sequential
batch), grow gateway-side batching later.

## Why it might matter
Turns existing infrastructure into the safety net serious users need before
trusting flows in production.

## Promotion criteria
Product priority call; 0125 (partial execution) not required but synergistic.

## Validation ideas
Golden dataset on a bundled example; deliberate prompt regression flips the
comparison red.

## Non-goals
No hosted leaderboards; no auto-optimization loops in v1.

## Guidance for future agents
Label eval runs distinctly in history (they must not pollute user run lists by
default).
