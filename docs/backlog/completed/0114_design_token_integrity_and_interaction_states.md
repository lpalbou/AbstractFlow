# Planned: Design token integrity + interaction states (focus ring, calm hover)

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 adversarial design review found that `--accent-primary` is referenced
~20 times across the app stylesheets but never defined anywhere (the ui-kit
defines `--accent`), so `color-mix(...)` expressions collapse and hover/warning
states silently render wrong (e.g. the "unavailable" palette chip never turns
red). `--border-color` is likewise undefined; fallback literals drift from the
real theme tokens (`#30a46c` vs `--success #27ae60`; `#e5484d` vs `--error
#e74c3c`). Keyboard focus is nearly invisible (7 `:focus-visible` rules in
~7,200 CSS lines), and a global `button:hover { background: var(--accent) }`
floods brand accent onto every unstyled utility button.

## Current code reality
- `src/styles/index.css` ~280, 329, 398, 434-435, 497, 586, 648...: uses of
  `var(--accent-primary)`; ~296, 342: `var(--border-color)`; ~330:
  `--accent-secondary` only as inline fallback `#ff4778`.
- Fallback drift: index.css ~411 (`#30a46c`), ~415-460, ~654-655 (`#e5484d` ×9).
- Global hover flood: index.css ~1009-1011; run modal Copy row hit
  (`RunFlowModal.tsx` ~6504-6528).
- Focus: `outline: none` on inputs (~967-984); palette entries non-focusable.
- Ungated infinite animations: nodes.css executing pulse ~72-97, dash march
  ~756-759; palette status blink ~630-641.
- ui-kit theme tokens: `abstractuic/ui-kit/src/theme.css` (`--accent`,
  `--success #27ae60`, `--error #e74c3c`, `--ui-border-*`, 16 themes).

## Problem
Broken-by-silence states, off-theme literals, invisible keyboard focus, and a
shouty hover default degrade both aesthetics and accessibility.

## What we want to do
1. Define the missing tokens at the app layer (`:root` in index.css), mapped to
   ui-kit tokens: `--accent-primary: var(--accent)`, `--accent-secondary:
   #ff4778` (single definition), `--border-color: var(--ui-border-1)` (verify
   exact ui-kit name).
2. Sweep fallback literals to equal the real token values.
3. Add a global `:focus-visible` ring token + rule; remove `outline: none`
   where it blinds focus (keep border tint as enhancement).
4. Calm the base `button:hover` to a subtle overlay; keep accent hover only on
   explicit primary variants (audit call sites so Run/primary buttons keep
   their accent).
5. Gate infinite animations behind `prefers-reduced-motion`.

## Requirements
- No light/dark theme regression: chrome must still derive from theme tokens.
- Accent-hover buttons that SHOULD be accent (primary actions) keep it via an
  explicit class, not the global default.
- A cheap regression guard: a unit test greps index.css for definitions of
  every `var(--x` referenced without a fallback in app CSS (at minimum the
  three named tokens).

## Suggested implementation
Single-pass CSS edit + one small test file (`src/utils/cssTokens.test.ts`
reading the stylesheet as text). Visual sanity via existing
`scripts/appearance_check*`/`toolbar_check_shot.mjs` where runnable.

## Scope
`src/styles/index.css`, `src/styles/*.css` fallback sweep, one test.

## Non-goals
- No full chrome light-theme sweep (tracked as proposed 0131-series item).
- No icon-system unification (proposed).
- No pin palette re-color (proposed).

## Dependencies and related tasks
- Reviewer 2A findings 1-2, 7-9 (2026-07-11).

## Expected outcomes
Hover/warning states render as designed in all themes; keyboard users can see
focus; utility buttons stop flashing brand red; reduced-motion is honored.

## Validation
- Token-definition test green; vitest/tsc/build green; grep shows zero
  remaining drifted fallback literals for success/error.

## Progress checklist
- [ ] Token definitions + fallback sweep
- [ ] focus-visible ring + outline restoration
- [ ] calm base hover + primary-class audit
- [ ] reduced-motion gates
- [ ] test + CHANGELOG

## Guidance for the implementing agent
Audit every `button` consumer before changing the global hover — the calm
default must not strip intended primary-action affordances.

## Completion report
- Completed: 2026-07-11
- Shipped: app-layer token bridge (`--accent-primary`, `--accent-secondary`,
  `--border-color`) over ui-kit tokens; success/error fallback literals
  reconciled to theme values; global `:focus-visible` ring — OUTLINE-based
  after adversarial review showed box-shadow rings lose to
  higher-specificity component shadows; calm base button hover (accent
  reserved for `.primary`); reduced-motion gates on executing pulse, edge
  dash, and status blink; `.palette-node-status.unavailable` recolored to
  `--error` (review nitpick: accent is not an error color in cyan themes).
- Validation: `src/utils/cssTokens.test.ts` resolves every no-fallback
  `var()` reference against app CSS + ui-kit theme + TSX-set properties;
  vitest/tsc/build green.
- Residuals (acknowledged): the token test's flat definition scan cannot
  see per-theme-block scoping gaps (currently one legitimately scoped
  token); a full light-theme chrome sweep is proposed 0131; remaining raw
  error-color literals that DO match the default theme are 0131's lane.
