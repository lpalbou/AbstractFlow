# Proposed: Theme-safe chrome sweep (light-theme correctness)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 design review: hardcoded-dark chrome breaks the six shipped light
themes — run-modal titlebar is a fixed navy gradient while its h3 inherits
`--text-primary` (near-black in light themes ⇒ ~1.4:1 contrast); preflight
panel and connection-check card same pattern; flow-library metadata uses
white-alpha text invisible on light backgrounds (index.css ~1783, ~1834-1841).
The stylesheet itself documents this bug class (~1027-1030): node-dark is
deliberate, chrome must derive from theme tokens.

## Current code reality
index.css ~2299-2301 (titlebar), ~868/883 (preflight), ~99-107 (connection
card), ~1783+ (library); ui-kit ships 16 themes incl. 6 light.

## Problem or opportunity
Light-theme users see broken surfaces; the appearance feature under-delivers
its own promise.

## Proposed direction
Sweep chrome surfaces to theme tokens (`--bg-*`, `--ui-border-*`, `--text-*`);
any deliberately-dark surface must hardcode its own text colors too (self-
contained contrast). Keep canvas node-dark scoping as documented intent. Add
muted-text contrast fix (`--text-muted` #666 on default dark ≈3.2:1 at 11px).

## Why it might matter
Correctness of an already-shipped feature (16 themes); accessibility.

## Promotion criteria
0114 (token integrity) landed first; then this is mechanical.

## Validation ideas
appearance_check script screenshots across 3 light + 3 dark themes; contrast
spot checks on the named surfaces.

## Non-goals
No redesign of the run modal titlebar identity (traffic lights etc. stay).

## Guidance for future agents
Fix by derivation, not by adding light-theme overrides per surface — one
source of truth per color role.
