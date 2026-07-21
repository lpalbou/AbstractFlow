# Completed: Canvas undo/redo

## Metadata
- Created: 2026-07-11
- Status: Completed
- Completed: 2026-07-21
- Work id: abstractflow-0127
- Thread anchor: agora commons c3815 (operator work dispatch: "look at the
  backlog" — claim top self-contained item)

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

## What shipped (2026-07-21)
Bounded (50) snapshot stack in the `useFlow` zustand store: `past`/`future`
arrays of `{nodes, edges, flowName, flowInterfaces}` deep-cloned on capture
AND restore (undo→redo→undo never aliases). `_captureHistory(coalesceKey?)`
is the internal push, called BEFORE each graph mutation:
- Discrete (no key, always a new entry): addNode, deleteNode, deleteEdge,
  onConnect, disconnectPin, pasteClipboard, duplicateSelection,
  applyAuthoringCommands (one batch = one entry), restoreAuthoringSnapshot,
  onNodesChange node-remove, onEdgesChange edge-remove.
- Coalesced (key + 600ms window): drag gestures (key `drag` on
  `dragging===true` position changes — the whole gesture is one step) and
  config edits (key `update:<nodeId>` — rapid keystrokes on one node
  collapse to one baseline; different nodes get distinct baselines).
`undo`/`redo` move between stacks; any capture clears `future` (new edit
forks the timeline); `loadFlow`/`clearFlow` reset both stacks. Shortcuts in
`Canvas.tsx` (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y) reuse the existing
editable-target/selection guards. Toolbar Undo/Redo group (`ToolbarIcons`
IconUndo/IconRedo) disables per empty stack. Tests: `src/hooks/undoRedo.test.ts`
(10). flowName/flowInterfaces ARE in the snapshot (restore sets them) but no
setter auto-captures on rename (avoids per-keystroke churn); a rename is
captured as part of the next graph baseline — deliberate, matches the
authoring snapshot shape.

## Non-goals held
No cross-session persistence, no selective/partial undo (as specified).
