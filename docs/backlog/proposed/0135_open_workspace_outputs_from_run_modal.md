# Proposed: Open what the flow produced (workspace file outputs actionable)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: ADR-0037
- ADR impact: None

## Context
2026-07-11 rendering review: flows that write to the workspace (write_pdf,
write_docx, export_artifact) end with a dead path string — the run modal
offers no way to open or download the produced file (no workspace-content
consumer anywhere in src/). The flagship "generate a report" flow ends in a
dead end. Run history has zero artifact surface. Workspace browsing is a flat
input-side picker only (no tree, no preview, no download).

## Current code reality
workspace_file outputs render as plain strings (nodes.ts ~1684-1690,
~1803-1810); WorkspacePathInputField browsing is input-only; gateway has
workspace list/import surfaces — a content/download endpoint needs an audit
(may exist for import preview; verify before designing).

## Problem or opportunity
The most satisfying moment of a document flow — the produced file — is
unreachable from the product.

## Proposed direction
Render workspace_file outputs as actionable chips (open/preview/download via a
gateway workspace-content endpoint; reuse the 0116 previewer); add a per-run
"Files written" section beside artifacts; upgrade workspace browsing to a tree
with preview + download (shared component with the run-modal file card).

## Why it might matter
Closes the loop on the whole file-nodes investment (0095/0101 tracks).

## Promotion criteria
Gateway endpoint audit: if content-read exists, this is flow-only (promote
fast); if not, one small gateway route lands first.

## Validation ideas
write_pdf flow → chip opens inline PDF preview; access-mode policies respected
(no read outside allowed roots).

## Non-goals
No workspace file editing from the UI; no file management (rename/delete)
in v1.

## Guidance for future agents
Respect workspace access modes — the preview endpoint must enforce the same
policy boundary as the file nodes.
