# Proposed: One icon language for nodes + softened pin/wire palette

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 design review: three icon systems coexist — toolbar stroke-SVG set
(good), raw emoji in node headers/palette via dangerouslySetInnerHTML
(platform-variant, ignores headerColor tint), and a third bespoke exec-view
SVG set. PinLegend shows unicode approximations instead of the real PinShape
SVGs (legend ≠ canvas). Pin colors are maximal RGB (#FF00FF/#00FF00/#FF0000)
that vibrate on dark; four artifact teals nearly collide; a dead `--pin-*`
CSS-var source of truth exists unused.

## Current code reality
ToolbarIcons.tsx (24-grid set); nodes.ts icon fields ~45-193 (emoji);
ExecViewNode.tsx ~26-110 (SVG set); PinLegend.tsx ~18-42; PIN_COLORS
types/flow.ts ~46-84; dead vars index.css ~16-24.

## Problem or opportunity
Node headers are the most-seen pixels in the product; emoji undermine the
professional-tool aesthetic and break color tinting.

## Proposed direction
Promote the exec-view SVG family to node headers + palette (tinted by
headerColor); PinLegend renders real PinShape components; desaturate pin/wire
palette UE5-style (keep hue semantics: e.g. string #E07DE8, number #8FE06B,
boolean #ED5E5E, object #5BD8E4); collapse artifact teals to one + shape/badge
modifier; delete or generate the `--pin-*` vars from PIN_COLORS.

## Why it might matter
Highest-visibility aesthetic upgrade; fixes legend honesty.

## Promotion criteria
Design sign-off on the palette values (screenshot pass via route_check
scripts); saved-flow compat confirmed (icons are presentation-only).

## Validation ideas
Screenshot diffs across themes; color-blind simulation on the new palette;
legend/canvas shape identity test.

## Non-goals
No node-shape redesign; no per-user custom palettes.

## Guidance for future agents
Wire colors derive from PIN_COLORS in Canvas edges — change once, verify both
pins and wires; edge underlay contrast (nodes.css ~720-730) must be rechecked
against new hues.
