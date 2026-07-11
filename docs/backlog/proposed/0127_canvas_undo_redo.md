# Proposed: Canvas undo/redo

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 competitive research: undo/redo is table stakes everywhere (n8n
Ctrl+Z, UE, ComfyUI, Node-RED). Verified absent in Toolbar/useFlow; only the
authoring assistant has "Undo Turn" (a whole-graph snapshot restore proving
the mechanism exists). Deleting a configured Agent node with a long system
prompt is currently unrecoverable.

## Current code reality
`useFlow` is a zustand store mutating nodes/edges; the assistant snapshots and
restores whole graphs (FlowAuthoringSnapshot).

## Problem or opportunity
Unrecoverable destructive edits block user trust in every other editing
feature.

## Proposed direction
Bounded snapshot stack (e.g. 50) over graph state in the flow store; push on
mutating actions (node/edge add/remove/config change, paste, assistant
apply-turn as one entry); Ctrl+Z / Shift+Ctrl+Z + toolbar buttons; coalesce
drag-move sequences into one entry.

## Why it might matter
Ranked #3 competitive gap (universal expectation); mechanism already half-built.

## Promotion criteria
None external — promotable on bandwidth; requires care around ReactFlow
position churn (coalescing rules).

## Validation ideas
Unit: stack semantics incl. coalescing; manual: delete node → Ctrl+Z restores
node + edges + config; assistant turn undo unaffected.

## Non-goals
No cross-session persistent history; no selective/partial undo.

## Guidance for future agents
Snapshot at the serialization boundary (same shape as save) so restore reuses
load paths; do not diff-patch.
