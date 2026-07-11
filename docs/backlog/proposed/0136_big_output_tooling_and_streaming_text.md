# Proposed: Big-output tooling (virtualized JSON, search, labeled truncation) + streaming text

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 rendering review: JsonViewer renders whole trees into the DOM (no
virtualization/search/copy-path; Debug JSON opens at collapseAfterDepth 99 —
RunFlowModal ~6935); a 100k+ char output or 10k-item array janks the modal
with no truncation labeling. No token/delta streaming exists (step-level
records only), so long LLM answers pop in at completion. YAML accepted on
upload but never rendered; no CSV/table view; JsonCodeBlock.tsx is dead code
(imported nowhere) drifting beside JsonViewer.

## Current code reality
JsonViewer ~185-238, 282-300; ledgerEvents has no delta event type; marked
renders markdown post-hoc.

## Problem or opportunity
Heavy agent runs produce heavy payloads; the viewers are the first thing to
fall over.

## Proposed direction
Lazy-render/virtualize JsonViewer children; add search + per-node copy-path;
label any clamp `#TRUNCATION`; delete dead JsonCodeBlock; YAML + CSV table
renderers behind the 0116 preview-kind helper. Streaming text is gated on
gateway/runtime exposing llm deltas on the ledger stream — file the ask with
the runtime seat before building client hooks.

## Why it might matter
Perceived performance + honest rendering of the outputs power users actually
produce.

## Promotion criteria
Profile evidence (synthetic big payloads); runtime-seat answer on delta
records for the streaming half.

## Validation ideas
1MB JSON opens <100ms interaction-ready; search hits highlight + scroll; YAML
artifact renders as tree.

## Non-goals
No editing of outputs; no server-side pagination redesign in v1.

## Guidance for future agents
Truncation must always be labeled (#TRUNCATION discipline) — silent clamps are
the failure mode this repo's rules exist to prevent.
