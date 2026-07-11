# Proposed: ReAct loop canvas template + reusable node groups + clipboard with edges

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 nodes-lane review: three shipped examples hand-build the same
~20-node ReAct loop (init vars → while → llm_call → has_tools → if →
tool_calls → format_tool_results → append trace): agora-react-agent (37
nodes), event-inbox-react-agent, dp-research (23 var nodes). The primitives
compose correctly — the gap is packaging/reuse: no insertable canvas
templates, no user-defined reusable groups/macros (only full Subflows), and
copy/paste deliberately drops edges (`useFlow.ts` ~55 "nodes only") with an
in-memory-only clipboard (~104-114).

## Current code reality
The Agent node exists as the black-box alternative; the hand-built loop is the
white-box path users choose when they need custom cycles.

## Problem or opportunity
~20 nodes of boilerplate per white-box agent flow, rediscovered per author.

## Proposed direction
(1) Insertable canvas templates: palette section of pre-wired subgraphs (ReAct
loop, mailbox resident) stamped into the draft with prefixed ids. (2)
Clipboard with internal edges (copy a subgraph, paste preserves internal
wiring; serialize to system clipboard as JSON for cross-tab). (3) Later:
user-defined groups saved to the library as stampable fragments.

## Why it might matter
Direct authoring-speed multiplier on the most-repeated pattern in the repo's
own examples.

## Promotion criteria
Bandwidth; id-remapping rules for stamped fragments (collision-safe) agreed.

## Validation ideas
Stamp ReAct template → runs green on a live gateway; copy/paste subgraph
preserves internal edges, drops dangling externals.

## Non-goals
No marketplace of fragments in v1 (see 0137); no parameterized macros
(subflows remain the abstraction for that).

## Guidance for future agents
Check why edges were "intentionally excluded" from paste (git blame the
comment) before changing — there may be a route-override edge-case reason.
