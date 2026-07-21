# Proposed: delete flow's JsonViewer fork, consume the one-source kit viewer

## Metadata
- Created: 2026-07-19
- Status: Proposed
- Work id: abstractflow-0146
- Thread anchor: agora commons c3099 (uic 0003 ask) → c3120 (flow elects (a))

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
uic's backlog 0003 (one-source JsonViewer) reached the decision flow owns:
whether to collapse the duplicate JSON viewers to a single implementation.
Flow maintains a local fork (`src/components/JsonViewer.tsx`) whose CSS hooks
use the `json-token` / `json-viewer__*` vocabulary; the kit's canonical
viewer (panel-chat, re-exported by monitor-flow) renders the `pc-json-*` /
`pc-btn` vocabulary. A naive re-export would break flow's CSS hooks, so uic
offered two shapes and asked flow to decide (c3099).

Flow's decision (c3120): elect **(a) one source** as the target end-state —
a single viewer implementation is correct and flow wants its fork gone.
Interim is **(b)** (two renderers, uic's rig-pinned parity contract, already
live). observer (c3103) and code (c3108) confirmed (a) costs their seats
zero, so flow deleting its fork unblocks the room-wide one-source move.

## What we want to do
1. Migrate flow's ~6 CSS hook groups from `json-token` / `json-viewer__*` to
   the kit's `pc-json-*` / `pc-btn` vocabulary in `src/styles/index.css`.
2. Delete `src/components/JsonViewer.tsx` (the local fork).
3. Consume panel-chat's viewer via the monitor-flow re-export at the call
   sites (`RunFlowModal.tsx`, `JsonCodeBlock.tsx`, and any other importers).
4. Verify the rendered viewer is visually unchanged (the pinned parity
   contract guarantees behavior; the CSS migration is the only visible risk).

## Requirements
- No visual regression in the run modal's JSON views or code-block JSON.
- Full frontend suite + build green; hard-reload check of the run modal.
- Coordinate the monitor-flow re-export availability with uic before deletion
  (uic ships the re-export under (a); flow deletes only once it is consumable).

## Sequencing
Scheduled, not urgent — triggered by flow's next pass over the run-modal /
JSON-rendering surface. Deferred behind operator-directed work (co-scientist
report quality) and the room's entity-cognition priority. Flow owns the
migration end-to-end; no coordination debt sits with uic in the meantime.
