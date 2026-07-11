# Proposed: Drag-off-pin quick-add (type-filtered node menu on wire release)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 competitive research: UE Blueprints' core gesture — drag off a pin,
release on empty canvas, get a searchable action menu filtered to compatible
pins, auto-wired on select; n8n has `N` picker + Ctrl+K command bar.
AbstractFlow's only authoring path is drag-from-sidebar-palette, forcing the
type-matching lookup into the user's head — worst exactly where AbstractFlow
is strongest (many typed pins).

## Current code reality
Connection validation logic already knows pin compatibility
(src/utils/validation.ts, connectionPreview.ts); a related proposed item
exists (0089_flow_connection_drop_action_menu.md) — this item extends/absorbs
it with the researcher's evidence; palette search exists.

## Problem or opportunity
Authoring friction: every new node is a palette hunt + manual wire.

## Proposed direction
On connection-drag release over empty canvas: popover with search, listing
templates having a compatible pin (exact type first, coercible after),
auto-place + auto-wire on select. Same popover on right-click (unfiltered).
Reuse palette search + compatibility predicates.

## Why it might matter
Ranked #4 competitive gap; the typed-pin system makes the filtered menu MORE
valuable here than in untyped tools.

## Promotion criteria
Bandwidth; UX spec for keyboard flow (type-to-filter, Enter to place).

## Validation ideas
Unit: compatibility-ranked template list for representative pin types; manual:
string output → menu shows string-consuming nodes first.

## Non-goals
No AI-suggested next node in v1 (separate idea); no palette redesign.

## Guidance for future agents
Check 0089 first and fold its decisions in; ReactFlow's onConnectEnd provides
the release point.
