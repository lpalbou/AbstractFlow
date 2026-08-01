# 0155 — Expression / function doctrine: bound the tiers, restore the primitives

- Status: DOCTRINE RULED 2026-07-30, WIDENED to the whole authoring process
  2026-07-31 (operator). Enabling changes and the visual-primacy ladder shipped
  across skill / docs / assistant / audit / preflight; corpus migration open.
- Owner: flow
- Supersedes the promotion rules in `0154_pin_expressions_tier2_hold_and_followups.md`
  by making them mechanically checkable and by naming the two root causes 0154
  missed (the state blob, and prompt text having no home outside a function body).

## The finding

Two adversarial reviews plus a corpus census, 2026-07-30. The tiers are well
built. They are **unbounded**, and in the 72 hours after they landed they
displaced primitives that already ship.

`examples/flows/multiagent-coding.json` — 47 nodes, 68 edges:

| | count |
|---|---:|
| pin expressions | 56 |
| flow functions | 28 (579 lines, off-canvas) |
| functions with exactly ONE call site | **25 of 28** |
| `get_var` nodes | **0** |
| `break_object` / `string_template` / `format` nodes | **0** (all three ship) |

Corpus-wide, 111 pin expressions across 10 flows classify as:

| bucket | count | what it actually is |
|---|---:|---|
| `ACCESS-VAR` | 20 | a run-var read — `vars.state.get("provider")` |
| `ACCESS-WIRE` | 32 | a field off the pin's own wire — `(value or {}).get("report","")` |
| `FN-CALL` | 26 | one call to a library function, 25 of which have one call site |
| `DERIVED` | 33 | a genuine derivation — **the only legitimate case** |

**70% of the corpus's expressions are not expressions.** And 101 `get_var`
nodes exist elsewhere in the corpus; all 101 take `name` from config and **zero**
wire the `name` pin.

## Why it happened (three causes, none of them "the tier is bad")

1. **A getter cost a full node.** `get_var` rendered with a header, a `name`
   row and a `default` row, and the layout model reserves 320×220 per node —
   the same cell as an Agent. Reading one field was expensive enough that an
   author with an expression field available always chose the expression.
   Unreal spends a dedicated `CompactNodeTitle` mechanism on exactly this.
2. **The editor could not express a default.** The `get_var` template declared
   no `default` pin, though the runtime has always honoured
   `pinDefaults.default` (`executor.py` `_create_get_var_handler`). So a getter
   dropped from the palette could not say `.get(key, fallback)` and returned
   `None` on a missing path — falsy, which on `if_g1`/`if_g2` silently skips a
   human approval gate. Every `.get(k, d)` read therefore *had* to stay an
   expression.
3. **The authoring skill said to.** `workflow-authoring-skill.md` read "Prefer
   an expression over a Get Variable -> Code chain for a small condition or
   field read." An authoring agent reads "field read" and reaches for an
   expression every time — including reads needing no Code node at all.

And two deeper causes the operator named:

4. **The `state` blob should never have existed.** `on_flow_start` already
   declares 12 typed vars (`request`, `provider`, `model`, `workspace_root`,
   budgets…). `mw_preflight` (68 lines) copies them all into one `state` dict
   and all 9 `set_var` nodes write back to it, so every later read is
   `vars.state.get(...)`. Its own comment gives the motive: "so every later
   function reads (state), call sites stay short." The blob exists to serve the
   function abstraction. Operator ruling: *"it's opaque and then we never see on
   the visual authoring which variable is actually used, we have to open the
   function and try to make sense of it. this is bad."*
5. **Prompt text has nowhere to live but a function body.**
   `function_library.py` deliberately disallows top-level constants ("put them
   inside a function") so the statelessness rule stays a complete closure. That
   rule is correct for safety, and it is the direct cause of the 65-line
   `builder_prompt` and 68-line `mw_preflight`. Operator ruling: *"system and
   prompt texts should be very easily editable directly by users and agents."*

## The semantics that settle it

The two lanes are **behaviourally identical**. Every pure node is registered
volatile (`executor.py:4663`) and re-pulled at each resolution
(`executor.py:4938`); loops additionally evict upstream pure outputs before
every condition evaluation (`compiler.py:4310-4315`). The expression tier's own
comment concedes it: "matching the volatile pure lane it replaces."

Verified by execution, not by reading — the same loop written both ways:

```
A  pin expressions : status=completed  final_i=3  PASS
B  get_var nodes   : status=completed  final_i=3  PASS
```

So freshness and exec-ordering are **not** arguments for either lane. The choice
is only about what the canvas shows, and a node shows it. `get_var → while.condition`
is already the house idiom (7 direct instances corpus-wide, plus 9 via pure code
nodes) in `coding-agent`, `goal-agent`, `entity-work`, `structured-extract`,
`co-scientist`.

## THE DOCTRINE — ruled 2026-07-30, widened 2026-07-31

The first ruling bounded the expression tier. The operator then widened it from
one flow to the **authoring process**, with two clarifications that settle what
code is for:

> "The whole point of VISUAL authoring is to have no code, except for experts
> (e.g. doing some pure functions). The whole point is to let people think,
> visually, of how the process should work. **Whenever you are NOT using the
> pins, you are HIDING something and that's very bad.**"
>
> **(a) A missing abstraction is a missing NODE.** "If there is a genuinely
> useful functionality/abstraction missing, then we should have a reusable NODE
> that we can share across workflows." Not a private workaround in a body.
>
> **(b) Code is deterministic glue, never a replacement.** "Code and pure
> functions are here to couple/harness DETERMINISTIC or tedious processes —
> contact a database, do an ETL, transform format 1 to 2 — to prevent a
> combinatorial explosion of nodes and give flexibility. It is absolutely NOT
> meant as a replacement for the existing nodes and abstractions, which MUST
> always be favored."
>
> "Improve the general process to create workflows." — the skill, the assistant,
> the docs, and the enforcement, so the next workflow (authored by a human OR an
> agent) comes out visual-first without an operator having to fight for it.

### The ladder (the decision procedure, one wording everywhere)

Walk from the top; stop at the first rung that works.

| rung | reach for | for |
|---|---|---|
| 1 | **an existing node** | anything the catalog ships — check it before writing a line of Python |
| 2 | **a subflow, one input pin per field** | a whole reusable process; never a hand-built `input` object |
| 3 | **`get_var` / `set_var` / `set_vars`** | reading and writing run state |
| 4 | **a pin expression** | a derivation — never a plain read |
| 5 | **a code node** | deterministic glue: external systems, ETL, format transforms, checksums, validation, shell composition. Expert territory |
| 6 | **a flow function** | the same derivation at 2+ call sites, ≤ 25 lines |
| 7 | **a runtime builtin** | useful in every flow (envelope parsing, shell quoting) |
| 8 | **propose a reusable node** | nothing above fits — say so out loud |

A code node is never for orchestration, never for state reads/writes, never for
field extraction, and never for **prompt or system text**: every sentence a
model reads must be editable by a user or an agent without opening Python. A
body may SELECT between texts that live on pins; it may not contain them.

**An expression is for a derivation. Never for a read.**

| what you are doing | use |
|---|---|
| read a run variable (dotted path, optional default) | **Get Variable** node, wired in |
| read one field off this pin's wire | declare that **output pin upstream** |
| read several fields off one wire | **Break Object** |
| interpolate values into a string | **String Template** |
| combine reads with and / or / not / compare | those nodes, or one expression |
| multiple statements, branching, several outputs | **Code node** (no exec pins = pure) |
| the same derivation at 2+ call sites, ≤25 lines | **flow function** |
| useful in every flow (envelope parsing, shell quoting) | **runtime builtin** |
| prompt or system text | **pin default** or **String Template** — never Python |

Mechanically checked by `scripts/audit_flow_graph.py --policy`:

- **P1 TRIVIAL READ** — expression is only a run-var read. Matches BOTH
  spellings since 2026-07-31: the attribute form `vars.state.get("k")` and the
  method form `(vars.get("s") or {}).get("k")`. The method form was the gap
  `multiagent_coding_smoke.py` had to patch around with its own copy of the
  pattern; there is now one definition of "a trivial read".
- **P2 FIELD EXTRACT** — expression is only a field read off `value`.
- **P3 THIN WRAPPER** — expression is only a call to a function failing P4/P5.
- **P4 SINGLE USE** — function with fewer than 2 call sites.
- **P5 OVERSIZED FN** — function longer than 25 lines.
- **P6 HIDDEN CONTRACT** (2026-07-31) — a subflow node whose only data input is
  one `input`/`vars` object while the child declares several start pins. When
  the child resolves in the same directory the finding NAMES the smuggled
  fields. Advisory by construction: a child saved only in the Gateway library
  cannot be resolved from disk.
- **P7 CODE-FOR-ORCHESTRATION** (2026-07-31) — a code node whose body is mostly
  prose: the "prompt composer in Python" smell. Dominance is measured in
  CHARACTERS, not lines — a prompt is one 2,000-char literal on ONE line, so a
  line ratio scores the worst offender at 1/14 and misses exactly the case that
  matters. Shell/command text is excluded: a command composer is prose-shaped
  and is legitimate glue.

Against `multiagent-coding.json` at the original census: 20 P1, 1 P2, 26 P3,
25 P4, 6 P5.

`--policy` is advisory; `--policy-strict` makes it fail the gate. Advisory
first on purpose: a gate that fails on day one gets switched off.
`--selftest` runs every predicate against its own fixtures — each defect paired
with the legitimate shape it must NOT flag, because an advisory that cries wolf
gets switched off, which is how doctrine dies.

## Shipped 2026-07-30 (enabling changes)

- **`get_var` declares a `default` pin** (`src/types/nodes.ts`). Closes cause 2 —
  the palette getter can now express `.get(key, fallback)` exactly. Existing
  saved getters are untouched (template pin backfill runs only for `code` nodes
  and a media allowlist), so no layout churn.
- **Compact getter render** (`nodes.css`, `BaseNode.tsx`). A getter with a
  configured name collapses to a chip — 256×108 instead of 256×190 — with the
  name/default rows revealing on hover or selection, so inline editing is never
  lost. Verified in a standalone Canvas harness (`scripts/getter_check.html`).
- **Doctrine advisories in preflight** (`src/utils/preflight.ts`,
  `trivialExpressionKind`). WARNING-grade only: style must never block Run.
- **Policy + pin-level checks in the audit** (`scripts/audit_flow_graph.py`).
  The pin-level checks (undeclared source/target pin) are hard and clean across
  the whole bundled catalog; they found 18 real defects in 7 legacy flows that
  every existing gate reports as clean.
- **Authoring guidance rewritten** (`docs/workflow-authoring-skill.md`,
  `docs/visualflow.md`). Closes cause 3, and documents the `functions` field for
  the first time — the authoring document has always accepted it with no rule
  attached.

## Shipped 2026-07-30 (migration wave 1 — every trivial read is a node)

`multiagent-coding` 47→67 nodes, 68→88 edges, **56→36 pin expressions, 0→20
Get Variable chips**. `audit --policy` P1 findings: **20 → 0.**

- The 10 `provider`/`model` reads are LOCAL getter chips, two per agent.
  `apply_flow_layout` places a pure helper in its consumer's column, so a chip
  per consumer keeps every wire short — one shared getter would have dragged a
  5,700px wire across the canvas, which is the pre-expression tangle the tier
  was introduced to escape. This is Blueprint's idiom: getters are duplicated
  freely and placed next to what reads them.
- The 5 boolean gate conditions (`preflight_ok`, `wait_gating` ×2, `accepted`,
  `all_passed`) are getter chips carrying their `default`, so the missing-key
  case keeps the human gates SHOWN.
- The 5 `loop_state = vars.state` folds take the state on a visible wire.
- Latent layout bug fixed in `wf_common.apply_flow_layout`: lane-1 pure helpers
  stacked upward from lane 1's base, climbing back into lane 0's exec column.
  Branch lanes rarely carried pure helpers before local chips existed.
- Smoke suite updated: the four condition assertions that read pin expressions
  now assert the getter WIRING and config (name + default), plus a doctrine
  gate (`no-trivial-read-expressions`) that fails if any expression is ever
  again a bare variable read. **198 checks pass**, including every `e2e-full-*`
  and `e2e-auto-*` scenario through the real Runtime; the full-tree probe
  returns byte-identical output.

Node count rose because visibility was the point: those 20 edges were always
real data dependencies, just undrawn. The compact getter render keeps them
cheap (~40% the height of a normal node).

## Shipped 2026-07-31 (wave 2 — the PROCESS, not one flow)

The operator's widening ruling turned this from a flow migration into a change
to how workflows get authored at all. Five surfaces, one wording of the ladder
on every one of them, so a human or an agent lands on nodes first without an
operator having to fight for it.

- **The authoring skill** (`docs/workflow-authoring-skill.md`). New section
  `THE AUTHORING LADDER — nodes and wires first, always` placed BEFORE the
  document model, so an agent reading top-to-bottom hits the decision procedure
  before it learns the JSON. New section `Missing Abstractions — say so, don't
  work around it` (subflow first; otherwise write the code node AND flag the gap
  in `reply` as `Node gap: …`). The Code section is reframed as rung 5 with an
  explicit illegitimate list; the subflow section demands one input pin per
  field and names `make_object -> subflow.input` as the anti-pattern; the
  prompt-building pattern states that prompt text has exactly two homes (pin
  default, String Template literal).
- **The reference doc** (`docs/visualflow.md`). "When an expression is the right
  tool" becomes "The authoring ladder": all eight rungs, then the expression
  sub-table it used to be, then the code-node prohibitions, then a table of
  P1–P7 and what each fires on.
- **The assistant** (`AuthoringAssistantDrawer.tsx` `assistantSystemPrompt`).
  The skill document already rides the SYSTEM message verbatim; what was missing
  was the same doctrine in the model's OWN instructions. Added `VISUAL FIRST —
  NODES AND WIRES ALWAYS COME FIRST` (the ladder inline), the code-node
  prohibition, `MISSING ABSTRACTION` with the `Node gap:` reply line, `GENERATE
  IN NODE VOCABULARY` (the 0154 amendment made explicit — collapse is a
  mechanical post-pass, never generation-time), and `SUBFLOW WIRING — ONE INPUT
  PIN PER FIELD`. Asserted by tests so the guidance cannot be silently deleted.
  `flowAuthoringDocument.ts` documents at the serialization seam WHY
  `subflow_interface` exists.
- **Enforcement**. `--policy` gains P6 HIDDEN CONTRACT and P7
  CODE-FOR-ORCHESTRATION (above); P1 grows the method spelling. Both advisories
  are mirrored into `src/utils/preflight.ts` as WARNINGs, in their own pass —
  the prime P7 offender is a PURE node, and pure nodes never enter the
  exec-reachable set the readiness rules walk, so "live" there means reachable
  or one data hop from something reachable. The editor's P6 is deliberately
  narrower than the auditor's: it cannot see the child, so it fires only on the
  pairing (one object pin + something upstream that hand-BUILDS the object),
  which is the shape that is always wrong.
- **Tests**. `audit_flow_graph.py --selftest` (plain asserts, no runner: the
  script is a standalone gate and must be checkable wherever it runs) and
  8 new cases in `src/utils/preflight.test.ts`. Every predicate is paired with
  the legitimate shape it must NOT flag: selection-only prompt bodies, shell
  composers, per-field subflow pins, a one-value child contract.

First corpus pass, `--policy` over the 24 bundled flows: **13 P6** (deep-research
×4, co-scientist ×5, coding-agent, coder, and — before the sibling wave landed —
multiagent-coding and multiagent-coder, now 0), **19 P7** (co-scientist ×11,
coding-verify-gates + its multiagent copy, and one per meta-* flow). No P7 fires
on `multiagent-coding`'s own `builder_prompt` / `gate2_prompt`: those are
selection-only bodies over pin-default text, which is precisely the shape the
doctrine asks for, and the detector agreeing with the migration is the strongest
evidence it is measuring the right thing.

## Standing candidates: reusable-node gaps

Ruling (a) — a missing abstraction is a missing NODE — needs a list, or every
author rediscovers the same holes and patches them privately. Each entry is a
gap observed in the corpus, with the workaround it is currently forcing.

1. **A pure `select{condition, if_true, if_false}` node.** `if` and `switch` are
   both exec-lane, so "pick A or B on a boolean" has no pure form — it forces a
   code node or a conditional expression for what is one wire's worth of
   meaning. Constraint: a new node type is fail-closed on an older runtime
   (`UnknownNodeTypeError` refuses the whole flow), so it must ride the
   `metadata.min_runtime` gate 0154 defines.
2. **Pin-level enum values.** A pin whose legal values are a closed set
   (`gating_mode`: wait/auto, `effort`: quick/standard/deep) has nowhere to say
   so. The set ends up prose inside a prompt or a validation branch in a code
   node, and a typo is discovered at run time. Declaring the choices on the pin
   makes it a dropdown in the run form, checkable at author time, and readable
   on the canvas.
3. **Split Struct Pin** — expose an object's members as pins in place, no extra
   node. The zero-cost answer to the 32 `ACCESS-WIRE` extracts, and the same
   affordance that would make P6's per-field subflow wiring cheap to ADOPT
   rather than merely correct.

## Open

1. **Split the `state` blob** (cause 4). `provider` / `model` / `workspace_root`
   / budgets are run constants already declared on `on_flow_start`; they should
   be read directly, not copied into a dict. Removes ~10 of the 20 P1 reads
   structurally, before any policy is applied.
2. **Give prompt text a home** (cause 5). Move the prompt composers out of
   Python: static text to the agent's `prompt` pin default, interpolated text to
   `string_template`, and only genuinely branching prompt selection to a code
   node. This is what makes prompts editable by users and agents.
3. **Migrate `multiagent-coding`** against the doctrine: 20 trivial reads → ~8
   deduped getters (+8 nodes, +21 edges — both adversaries derived this
   independently), 25 single-use functions → code nodes or templates.
   Constraints that must hold: 8 expressions sit on pins that **already have a
   wire**, and a second data wire into one pin is a hard `ValueError`
   (`executor.py:281-289`); keep `pinDefaults.condition = false` on every
   `while` as the skew belt.
4. **"Convert to nodes"** on the expression editor — Unreal's Math Expression
   node is not a runtime evaluator, it is an authoring accelerator that expands
   into real, double-clickable nodes with variable tokens becoming actual
   getters. Keep the text affordance; refuse to let it be the runtime
   representation. Turns every policy finding into a one-click fix.
5. **The reusable-node gaps** — see "Standing candidates" above (pure `select`,
   pin-level enum values, Split Struct Pin). They are listed there rather than
   here because ruling (a) makes them a standing register the next author reads
   BEFORE writing a workaround, not a wave's to-do list.
6. **Migrate the P6/P7 corpus.** 13 P6 and 19 P7 findings are open on the
   bundled catalog. `deep-research` and `co-scientist` carry most of both: five
   `input` blobs and eleven prompt composers. Neither is touched in this wave —
   the doctrine and the detectors land first, deliberately, so the migration is
   measured against a fixed rule instead of the rule bending to the migration.

## Not a finding: the coder flow's graph

`multiagent-coder.json` **executes**. Driven end to end through the real
Runtime — wrapper → 47-node pipeline → gate subflow → `COMPLETED`, correct
report, `branch=snake-game`. The `map_input.built -> build.input` edge is a
documented idiom: a code node exposes every key of its returned dict as a
pullable handle (`wf_common.py`, and `executor.py:4911-4929` / `:479`).

(Historical: that edge was CORRECT and still a P6 HIDDEN CONTRACT — legal at run
time, illegible on the canvas. The 2026-07-31 flow wave replaced it with
per-field pins on both `multiagent-coder.build` and `multiagent-coding.verify`,
and `--policy` reports 0 P6 on the family.)

If the operator cannot run it, the cause is host-side. Two concrete candidates:
the wrapper's subflow emits `async: true, wait: true`, so the host must pump the
child run and resume the parent; and `scripts/multiagent_coding_run.mjs` starts
`multiagent-coding` (the child), not the wrapper — **there is no live-run script
for `multiagent-coder` at all.** Also worth checking: the wrapper forwards
`provider: null, model: null` into the child, since `start` declares those pins
but sets no defaults for them.
