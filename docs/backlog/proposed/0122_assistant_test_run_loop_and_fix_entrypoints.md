# Proposed: Assistant test-run loop ("build, run, fix") + fix-with-assistant entry points

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: ADR-0026 (authoring compaction/fidelity rules apply to any
  new prompt content)
- ADR impact: None

## Context
2026-07-11 assistant-lane review: the assistant cannot verify its graph against
reality — the system prompt forbids Run (AuthoringAssistantDrawer ~1247), the
acceptance review judges the static graph only (~1995-2007), and there is no
"fix this" path from preflight issues or failed run steps into the assistant
(selection context deliberately dead, ~1281-1283). Every user turn enters the
full authoring pipeline; a pure question costs a full cycle.

## Current code reality
The run modal already has failure summaries; preflight already computes
issues; the drawer already has an acceptance-findings repair loop to feed.

## Problem or opportunity
A copilot-grade authoring loop runs the flow with sample inputs and iterates on
real errors; ours reasons about structure only.

## Proposed direction
(1) Opt-in post-acceptance phase: start a draft run with user-supplied sample
inputs (reuse draft-run metadata + gatewayStartRun), summarize ledger failures
into acceptanceFindings, repair, bounded retries. (2) "Fix with assistant"
buttons on preflight issues and failed run steps that pre-fill a targeted turn
with the issue + node context. (3) A lightweight explain/Q&A path that answers
questions without entering document authoring (no commands, no acceptance
review).

## Why it might matter
Closes the loop between authoring and execution — the single biggest
capability gap vs the best assistants; reuses existing machinery.

## Promotion criteria
0112 (transport overhaul) should land first so test-run cycles don't inherit
the quadratic session bill.

## Validation ideas
Scripted: assistant builds a flow with a deliberate bad pin; test-run phase
catches the runtime error; repair fixes it; second run passes.

## Non-goals
No auto-run without explicit user opt-in (runs cost money and may have side
effects); no background scheduled runs.

## Guidance for future agents
Failure summarization must be lossless-in-substance (node id, error, inputs) —
do not paraphrase errors into vagueness.
