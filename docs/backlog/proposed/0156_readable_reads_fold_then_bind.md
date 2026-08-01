# 0156 — Readable reads: fold, then bind

- Status: PROPOSED 2026-07-31 (two-agent adversarial design round, 2 iterations;
  full working papers preserved in the round's scratchpad: research catalog,
  strategy v1/v2, researcher attack).
- Owner: flow
- Depends on: 0155 (doctrine ladder), the 0154 min_runtime enforcement IOU.

## The problem (measured, `multiagent-coding.json`)

The flat-state migration implemented "reads must be visible" as "reads must
have a node". Result: 161 nodes of which **91 are `get_var` chips reading 38
distinct variables** — 85 of 91 feed exactly ONE consumer, 82% of getter edges
read a variable named identically to the pin they feed. The canvas: 8,090px
tall, one 21-node tower (19 chips spanning 6,080px feeding a node whose pin
rows state the same mapping in ~500px), 344 getter-wire crossings, exec-view
to full-view node ratio 0.43 (the entire delta IS the getters).

Three layout causes, all in `scripts/wf_common.py`: `_layout_node_height`
books 320×220 for a chip that renders ~330×70 (and `audit_flow_graph.py`
repeats the same wrong box); `_place_lane` stacks every pure node of a column
into one tower regardless of consumer; the tower inflates the exec lane's base.

## Operator proposals — verdicts (both agents, converged)

| proposal | verdict |
|---|---|
| (a) tiny sphere + 2-letter monogram + hover | **ADAPT**: shrink yes, monogram no. Measured collisions are the worst possible pairs: `all_passed`/`approved` → "AP" (both boolean, feeding the same nodes), `preflight_ok`/`probe_ok` → "PO". Keep the FULL name, middle-ellipsised preserving the tail (`plan.goal` vs `plan.steps`). |
| (b) small, freely positionable, layout-neutral | **ADOPT** — the single biggest win. |
| (c) share getters much more | **ADAPT, neighbourhood-capped**: global dedup measured at 17,280px (`wait_gating`) / 13,440px wires. The repo already ran this experiment (provider/model: 1 shared pair = 7,872px wire + 26 crossings; 3 neighbourhood pairs won). Blueprint Assist ships "duplicate getter per link" — UE power users optimise the same direction. |
| (d) fork/reroute points on edges | **DEFER**: only 4 of 228 edges span ≥3 columns and all four are EXEC edges; a reroute node type is fail-closed on old runtimes. Editor-only end-caps later if wanted. |
| (e) dropdown on a pin to select a variable | **ADOPT — the end state** (Stage 2). UE precedent is affirmative: Anim-BP input pin binding + UMG Bind, sold by Epic as clutter reduction. Epic ships NO on-canvas marker for it — our visibility contract is the part UE never built. |
| (f) generalize to any pin | **ADOPT** with soft type filter (`variableMeta.declaredTypes` exists). |

## The ruling insight

For a single-consumer read whose variable name matches the pin (82% here), the
chip + wire carry ZERO information beyond what the consumer's own pin row
states. **The read drawn on the pin row it feeds is more visible than a chip
5,760px away** — at the consumer. The wire's residual value is provenance
(where written) and run-time trace; both must be paid for explicitly (below).

Rule of thumb: **if the read is the argument, show it on the pin; if the read
is the subject, draw the node.** (Loop bounds, gate flags, shared clusters
stay nodes — ~6 of 91 here.)

## Stage 1 — ship now (consensus, zero document/runtime change)

1. **Shrink the chip**: ~140×32 pill, type-coloured ring, full name
   (middle-ellipsis), hover card (path, type, default, writers/readers with
   jump). No monogram.
2. **Fix the box-model lie once**: hoist node-box geometry to ONE shared
   constants source consumed by `wf_common.py`, `audit_flow_graph.py`, and the
   editor layout. (Three independent guesses today; the audit *enforces* the
   wrong box.)
3. **Fold single-consumer getters into the consumer's pin row (render-only).**
   The document keeps the `get_var` node + edge — the fold is a pure function
   of `outgoing_edges == 1`, so nothing can drift; tools report
   `nodes / rendered_nodes`. Simulated: rendered 161→76, edges 228→143,
   canvas 8,090→~1,500px, crossings 344→~20, exec/full 0.43→0.92, no
   COLUMN_GAP change needed. Reversible: unfold = render toggle.
   Conversion is reversible-both-ways with jump-to-counterpart (the ComfyUI
   Set/Get 2026 rewrite's lesson).
4. **Tri-state variable-wire display** (Grasshopper): faint at rest / full on
   hover-selection / force-show-all key. **Parity rule: a folded or bound read
   never renders LESS visibly at rest than a wired one.** Edge bundling is
   ranked out (measured to harm path tracing — the operator's stated goal).
5. **Run-time glow parity** (attack finding: `executingNodeId` is node-keyed,
   so folded/bound reads would lose their execution trace): the consumer's pin
   row flashes on resolution of a folded read; the existing recent-trajectory
   afterglow gets a pin-level analogue.
6. Builder stops emitting duplicate chips where a neighbourhood shares
   (fan-out from one getter is already legal — `validateConnection` limits
   only exec sources).

Stage 1 is the *reversible pilot of the exact end-state UX*: fold-rendering and
pin-binding share the same pin-row visual, so Stage 2 changes storage, not
what the author sees.

## Stage 2 — pin variable bindings (the end state, behind preconditions)

`pinBindings?: Record<string, string>` (pinId → dotted variable path) beside
`pinExpressions`; authoring spelling `pin_bindings`, merge-per-key. Runtime:
~6 lines in `_create_data_aware_handler` between pin-defaults and expressions,
reusing `_get_by_path_with_found` — get_var semantics verbatim. Wire always
wins (binding kept, struck through — never silently dropped). Binding +
expression is legal (binding supplies `value`).

**Hard preconditions (researcher's, accepted):**
1. The **min_runtime enforcement gate exists** in the gateway (0154's IOU —
   currently unbuilt), AND the marker travels on the FLOW document, not only
   the packed bundle (0 of 176 example flows carry `metadata` today; the
   editor-save path is ungated).
2. **P8 unrepresentable, not flagged**: the binding setter API takes
   `(pinId, path, default)` atomically — a binding without a pin default
   cannot be written. (Old-runtime degrade = pin default; measured on this
   flow: all 85 bindable reads carry defaults whose polarity is conservative,
   and every default-less read is a shared chip that stays a node. The
   wait_gating lesson is enforced, not assumed.)
3. **P12 MUTED VARIABLE** (Simulink MAAB jc_0171 transplanted): every variable
   with a writer and ≥1 reader keeps at least one read drawn at rest —
   satisfied by a getter node OR the faint overlay; fails if both are off.
   A subflow must keep ≥1 drawn data edge (the `verify` node would otherwise
   hang on control flow alone).
4. **Invalidation as visible as the binding** (UMG's documented trap,
   inverted): an orphaned binding (no writer) renders as a red pill at rest,
   not a healthy teal; variable RENAME rewrites bindings in one transaction
   (dotted prefixes included) or refuses, per the function-rename precedent.
5. Materialize ⇄ dematerialize as **bulk migration commands only, never a
   per-pin mode** (ComfyUI abolished its widget⇄input convert-duality in 2026;
   custom nodes keying off the hidden mode broke — a binding is one row:
   socket + pill + literal, precedence in evaluation order). One undo step;
   dematerialize migrates the getter's `default` onto `pinDefaults`
   (two-field operation, always).
6. **P9′ MIGRATION FIDELITY** replaces polarity inference: for a migrated
   binding, `pinDefaults[p]` must equal the source getter's `default`
   byte-for-byte or the build fails — the safe value is already written down;
   nothing is inferred from names. For NEWLY authored bindings, add an
   optional `safe_value` annotation on the variable declaration
   (`var_decl`/`bool_var`/`on_flow_start` — `variableMeta` already reads all
   three), following the IEC 61508 de-energize-to-trip principle: declare the
   safe state once at the signal, not at every consumer. This finally gives
   `wait_gating`'s fail-toward-gates-shown rule a home in the document.

Doctrine ladder amendment (0155 rung 3): **3a bind the pin (default read);
3b draw the getter when shared, emphatic, or needing a divergent default.**
P1's "trivial read expression" finding gains the one-click fix "bind instead".
New audit: P8 (unguarded binding — strict for boolean/number), P10 (double
read: bound pin whose expression also reads `vars.`), P11 (orphan binding —
rendered at rest, not just flagged), P12 (muted variable).

## Sequencing verdict (arbitrated)

Researcher: fold first (reversible, tests the hypothesis, no gate needed).
Designer: bindings directly (document honesty; fold = 44% of the flow JSON as
phantom bytes forever; assistant emits 4 commands + invented node id per read
vs 2). **Arbitration: Stage 1 WITH the fold ships now; Stage 2 lands when the
min_runtime gate + flow-level marker exist, as a mechanical bulk
fold→binding migration with zero visual change.** The phantom-bytes cost is
real but temporary; the fail-open cost of shipping bindings before the gate
is real and irreversible. If the gate is refused cross-repo, the fold is the
honest permanent answer and this doc says so.

## Success criteria (the 161-node flow)

rendered_nodes ≤ 80 · canvas height ≤ 2,200px · getter-wire crossings ≤ 25 ·
no column span > 2,000px · max empty vertical gap in exec view ≤ 400px ·
p50 wire ≤ 300px · every variable satisfies P12 · run view shows a trace for
every read event (glow parity) · exec-view toggle changes the node set by ≤
10% (0.92 achieved by construction).
