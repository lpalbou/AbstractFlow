# Proposed: Run page (URL identity), scale hardening, export, history findability

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 run-experience review: the 8,110-line run modal has grown
window-manager controls (minimize/maximize) — evidence it wants to be a page.
No URL identity (no deep link, no side-by-side comparison), no step search, no
virtualization (all steps re-render per event; artifact extractors recompute
per event — O(N²) over long runs), no run export, reattach polls the full
history bundle every 2s. History search covers id/status/wait_reason only; no
facets, no prompt preview, no duration/token columns, no comparison.

## Current code reality
RunFlowModal ~5850-5863 (window controls), ~6013-6216 (step list), Toolbar
~503-530 (polling); RunHistoryModal ~112-121 (search fields).

## Problem or opportunity
Long agentic runs (hundreds of steps) will jank; runs cannot be shared,
compared, or exported for analysis.

## Proposed direction
Phase 1: virtualize the step list; memoize per-step derivations; step search
box; run export (JSON of mapped events + raw ledger download). Phase 2: run
page route (`#/runs/<id>`) rendering the same components; history facets
(status/date/workflow) + duration/token columns once 0115's accounting lands.

## Why it might matter
Scale correctness for exactly the users who adopt hardest (long agent runs);
shareable runs are a collaboration primitive.

## Promotion criteria
Evidence of jank on real long runs (profile first); routing decision for the
SPA (no router exists today).

## Validation ideas
Synthetic 2,000-step run stays responsive; export re-imports losslessly.

## Non-goals
No multi-user run sharing/permissions (gateway auth lane); no live
collaborative viewing.

## Guidance for future agents
Virtualization first — it unblocks everything else and is invisible when done
right. Measure before and after with the same synthetic run.
