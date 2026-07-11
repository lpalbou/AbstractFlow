# Proposed: Author-visible memory — inspector panel, semantic recall, exact-key KV

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: May need ADR when converging the two memory stacks.

## Context
2026-07-11 assistant/memory-lane review: author-facing memory is fragmented —
run vars (get/set_var), span notes with substring-only recall (`memory_query`
"substring match over span metadata", nodes.ts ~1854), and KG triples
(semantic `query_text` requires host embeddings). No exact-key cross-run KV
with TTL; session memory is entirely opaque (no UI to view/edit what a session
remembers — including the assistant's own replaying session); the newer
abstractmemory engine (MEMORY_RECALL/MEMORY_FORM usage-weighted graph) has NO
VisualFlow node at all (zero matches in visualflow_compiler).

## Current code reality
The only memory UI is the KG explorer, shown solely when a run step is
`memory_kg_query` (RunFlowModal ~6879-6885). Gateway endpoints for notes/KG
exist (used by the nodes).

## Problem or opportunity
"Memory handling is scarce/immature" (product owner). Authors cannot see,
debug, or manage what their flows remember; simple remember/recall-by-key
patterns require query gymnastics.

## Proposed direction
(1) Memory panel UI: browse/search/edit/delete session + global notes and KG
facts via existing gateway endpoints, scoped by session id. (2) Semantic
recall on `memory_query` where the host has embeddings (labeled fallback to
substring). (3) `remember` / `recall` exact-key KV nodes over the note store
(key=tag namespace) with optional TTL. (4) A stated convergence note for the
abstractmemory engine (entity-lane) vs the workflow stack — do not silently
grow a third stack.

## Why it might matter
Memory becomes debuggable and teachable; the KV primitive covers the most
common "remember this across runs" ask directly.

## Promotion criteria
Gateway endpoint audit confirms list/delete surfaces exist (or small gateway
additions agreed); memory-seat input on the convergence note.

## Validation ideas
Panel CRUD against a live gateway; KV round-trip across two runs; recall
fallback labeling test.

## Non-goals
Does not authorize exposing entity homes/identity memory in workflow UIs
(separate privacy lane).

## Guidance for future agents
Read the entity-lane memory contracts before designing the convergence note;
"one graph, two doors" may be the end state but is not this item's mandate.
