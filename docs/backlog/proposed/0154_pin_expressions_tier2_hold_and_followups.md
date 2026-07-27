# 0154 — Pin expressions tier 2 (named function library): held, with ruled amendments

- Status: SHIPPED 2026-07-26 (tier 2 built + multiagent-coding migrated to the
  library; three fable5 adversaries reviewed, P0/P1 correctness folded). The
  remaining open items below are FEATURE-FRAME gaps + polish, not correctness.
- Owner: flow

## SHIPPED 2026-07-26 (function library + adversary fold)

The named-library tier is live: flow-level `functions` (full `def` sources)
compile once into the code-node sandbox; pin expressions call them; a
right-rail Functions drawer, `ƒ name` chips, docked binding strips, an
inline promote flow, and preflight unknown-call checks are all wired.
`multiagent-coding` migrated 79→45 nodes (33→3 pure code nodes, 31 library
functions). Runtime + editor suites green; behavior equivalence smoke green.

Adversary findings folded (2026-07-26):
- Runtime (P1): the shared library namespace is process-lifetime; a stateful
  helper would leak across runs/tenants. FIXED by ENFORCING statelessness at
  build (`_validate_library_purity`): no `global`/`nonlocal`, top-level `def`s
  only, no mutable default arguments — the complete closure of persistent
  writable state in a no-import sandbox. The library lane also now runs the
  SAME `validate_code` as code nodes (imports/dunder refusal parity).
- Editor P0-1 (function-only edits silently lost): `flowSignatureFor` +
  the dirty-check memo now include `functions`.
- Editor P0-2 (valid Python bricked Run): preflight `callNamesInExpression`
  now excludes Python keywords (`in`/`and`/`not`/`else`/…).
- Editor P1 (promote correctness): string-literal-aware read scan + right-to-
  left substitution (no more mangling `"vars.x"` literals), `value`-collision
  refusal, `vars.get`/dynamic-use refusal; ƒ chips require the call to span the
  whole expression (no false pure-binding chip on `f(x) or y`); rename rewrites
  call sites; promote is one undo step; Used-by rows pan the canvas.

### Still open (feature frames + polish, NOT correctness — deferred with rationale)

- **frame_3 binding form** (per-parameter open/literal/wire modes, `vars.*`
  autosuggest): NOT built. Clicking a ƒ chip opens the raw-text expression
  editor (frame_1), which is sufficient for authors; the binding form is a
  non-expert convenience. Medium build; pick up if non-expert authoring
  demand appears.
- **Test affordance** (frame_1 editor Test, frame_2 drawer-row Test): NOT
  built. Would strengthen the "typo caught pre-run" story beyond preflight;
  needs a gateway-backed expression/function eval path (the code-node sim
  endpoint is the precedent to reuse). High value, medium build.
- **frame_5 debugging (computed-input traces + chip error badges)**: NOT
  built — this is the tier-2-hold item by the operator's own recommendation
  ("hold the named library tier"). Now that branching logic lives in library
  functions, run-time error attribution ("condition ← ƒ should_retry:
  TypeError…") is the largest remaining risk; it is CROSS-REPO (runtime must
  emit per-expression eval traces, editor must render them). Highest-value
  next build.
- **Polish**: drawer return-type in signatures + timestamps (needs a
  `FlowFunction.updatedAt`), unused-row dimming as a filter, code-view line
  numbers; drawer editor Escape-to-cancel + Name autofocus + aria-expanded;
  arity check in preflight (abstain on defaults/`*`); subflow extraction
  (`toVisualFlow`) does not carry `functions` — extracting nodes that call
  library functions yields dangling calls (caught by preflight in the subflow).
- Context: tier 1 (anonymous inline pin expressions) shipped 2026-07-25 — see
  `CHANGELOG.md` (Added/Changed 2026-07-25), `docs/visualflow.md` ("Pin
  Expressions"), and abstractruntime `visualflow_compiler/visual/pin_expressions.py`.
  This item preserves the ruled tier-2 decisions so they survive beyond the
  design conversation, and records the tier-1 loose ends open at hold time.

## Decision record (2026-07-25 design round, operator-adopted)

The named-library tier (flow-level named helper functions with slim call
sites) is held until tier 1 proves out. When picked up, it must be reshaped
per these amendments — each one overrides an earlier draft rule:

- **Promote at the second call site, never at a line count.** A helper is
  named when the SAME expression appears at a second consumer (a duplication
  signal). The rejected trigger was "promote at 6 lines" — length alone is
  not a reason to add a library indirection.
- **Multi-output helpers stay nodes, by doctrine.** A helper with several
  outputs is graph structure (fan-out the canvas should show), not an
  expression. The library tier only ever holds single-value expressions.
- **Paste embeds definitions with hash dedup.** Copying a call site into
  another flow carries the helper definition along (no cross-flow reference
  coupling); identical definitions deduplicate by content hash on paste.
- **The authoring assistant keeps emitting nodes; collapse is a mechanical
  post-pass.** Generation stays in node vocabulary; converting eligible
  node chains into expressions (or future library calls) runs as a
  deterministic post-pass the user can inspect, never as generation-time
  behavior. (Tier 1 already gives the assistant `set_pin_expression` /
  `pin_expressions` for direct edits; the amendment constrains generation
  shape, not the edit surface.)

## Tier-1 loose ends at hold time (completeness review, 2026-07-26)

- **entity-life migration**: deferred and offered to the operator ("the
  bigger visual win"); the tier-1 screenshot acceptance named entity-life
  before/after at fitted zoom, which cannot exist until that flow migrates.
- **Two acceptance screenshots still owed**: (1) the ≤5-interaction authoring
  sequence with the typo warning visible in the preflight panel — the
  mechanism is proven textually (`untracked/pin_expression_preflight_typo_check.out.txt`)
  and the authoring moments are captured (`untracked/reports/fx/`), but the
  combined operator-facing shot is missing; (2) the failure-honesty pair (a
  raising expression attributed as `<node>.<pin>` in the run view).
- **While-condition failure channel (runtime)**: a raising expression on a
  `while.condition` pin escapes as an exception (the run fails loudly with
  correct node+pin attribution) instead of completing through the uniform
  in-band `{success: false, error, node}` contract other consumers use.
  Channel divergence only; nothing is silent.
- **Bundle min-runtime gate** (SHARPENED 2026-07-26 by the quality review —
  raise to the first thing shipped before any external publish): the skew-safe
  FIELD encoding holds for expression-only pins (unread key → pin falls to its
  own default → falsy → bounded loops). BUT the MIGRATION rewires differently:
  collapsing a `get FIELD` accessor moves the whole upstream OBJECT onto the
  consumer pin (wired) and extracts the field via the expression. On a
  pre-expression runtime the expression is ignored and the pin resolves to the
  whole object — and where that pin is a control/boolean signal this is
  FAIL-DANGEROUS, not benign: `multiagent-coder`'s `end.success` becomes the
  whole `build.output` dict → truthy → a FAILED run reads as SUCCESS to
  `agent.v1` callers (the pre-migration get-node extracted the boolean
  correctly on the same old runtime). The root flow degrades bounded (verify
  reads "verdict missing", loops to budget with #FALLBACK; preflight false
  skill advisories — the old F2 shape). Two protections: (a) DECLARE the
  runtime dependency in bundle metadata now (`metadata.min_runtime`, done for
  the migrated bundles — a marker the gate reads); (b) the ENFORCEMENT gate is
  cross-repo (gateway refuses to load a bundle whose `min_runtime` exceeds the
  serving runtime) — filed to gateway+runtime. A pin-expression bundle REQUIRES
  the pin-expression runtime; the gate makes an old gateway refuse-loud rather
  than run-wrong. Interim note: nothing is published externally today and the
  local gateway runs the new runtime, so live risk is currently zero.
- **multiagent-coding bundle version hygiene**: DONE 2026-07-26 — bumped to
  `0.0.4` + re-packed (`scripts/build_multiagent_coding_workflow.py`
  `BUNDLE_VERSION`), UI run-target pins updated (`src/utils/bundledFlows.ts`),
  `metadata.min_runtime` declared. Gateway re-registration batched with the
  entity-life migration's bundle bump.
- **Editor dist rebuild**: `dist/` predates the feature and the migration,
  so the served build lacks the ƒx UI and still bundles pre-migration
  example flows until rebuilt.
