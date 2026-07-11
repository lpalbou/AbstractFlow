# Proposed: Last-run values on the canvas (node badges + pin hover values)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 competitive research: Rivet renders node outputs under nodes, Dify
pins "Last Run" onto every node, UE Blueprints shows values on pin hover.
AbstractFlow has richer per-step data than any of them — but only inside the
run modal timeline; the canvas shows nothing after a run.

## Current code reality
Ledger events already carry per-node results (ledgerEvents → ExecutionEvent);
the canvas has node status badges during execution but no value inspection.

## Problem or opportunity
Users repair flows on the canvas but inspect data in a modal — a context
switch per value. Moving inspection to where repair happens is the biggest
observability win per unit effort.

## Proposed direction
After (and during) a run: badge executed nodes with status + duration; pin
hover shows the last value that flowed (existing tooltip machinery); click
opens the run-modal step. Data source is the same mapped events the modal
consumes; store last-run-by-node in the flow store keyed by run id.

## Why it might matter
Ranked #2 competitive gap; near-pure client work over existing data.

## Promotion criteria
0115 (follow/selection work) landed; a size-capped value snapshot policy
agreed (labeled truncation for huge payloads).

## Validation ideas
Unit: event→node-value map incl. loops (last iteration wins, iteration count
shown); manual: hover pins after a run.

## Non-goals
No live per-token streaming onto the canvas; no persistent history beyond the
last run per node.

## Guidance for future agents
Loops and multi-entry nodes need a deliberate "which value" rule — surface the
count, show the latest, link to the modal for the rest.
