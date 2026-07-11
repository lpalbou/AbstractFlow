# Proposed: Sticky notes + frames (canvas documentation primitives)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 competitive research + nodes-lane review: no comment/sticky/frame
primitive exists (zero matches in nodes.ts). UE comment boxes, n8n sticky
notes ("use heavily on templates"), Zapier Canvas notes are core sharing
affordances. Agent flows encode design intent (why this tool allowlist, why
temperature 0) that node labels cannot carry; published/shared flows need
in-graph docs.

## Current code reality
VisualFlow JSON serializes nodes/edges; notes would be editor-layer nodes
excluded from compilation (compiler must ignore them; verify exclusion path
for non-executable node kinds).

## Problem or opportunity
Flows are increasingly shared (bundled examples, publish catalog, authoring
assistant output) with no way to document intent in-graph.

## Proposed direction
Two editor primitives serialized in flow JSON: `note` (markdown text, resizable,
colored) and `frame` (labeled rectangle; moving it moves contained nodes).
Compiler ignores both. The authoring assistant may emit notes to explain
generated graphs (document contract gains an optional notes section).

## Why it might matter
Ranked #5 competitive gap; cheap; improves template/gallery value immediately.

## Promotion criteria
Bandwidth; agreement that runtime compiler skips unknown editor-only kinds
(or explicit skip list) so old runtimes don't choke on shared flows.

## Validation ideas
Round-trip serialization; compiler ignores notes; assistant document
round-trip stays zero-command on unchanged notes.

## Non-goals
No real-time collaboration/commenting threads; no rich embeds in v1.

## Guidance for future agents
Frame containment = position math on move, not parenting in ReactFlow state —
keep the graph model flat.
