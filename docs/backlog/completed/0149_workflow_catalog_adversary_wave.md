# Completed: workflow-catalog adversary wave (no dead nodes, clean layouts)

## Metadata
- Created: 2026-07-20
- Status: Completed
- Completed: 2026-07-20
- Work id: abstractflow-0149
- Thread anchor: operator directive 2026-07-20 (laurent DM seq 31): "enroll 4
  adversarial sub agents powered by fable 5, examine the workflow one by
  one, improve and clean them when you can. there should be no dead node.
  make sure each workflow also has a clean layout of nodes."

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
The operator inspected the shipped workflows in the editor and asked whether
they truly work ("I see a lot of nodes with empty execution pins, which I
believe are therefore never reached"). Two distinct facts fell out:
1. The nodes he saw are PURE data nodes by design — no execution pins means
   the runtime evaluates them lazily when an exec node pulls their outputs.
   (The exec-pin triangles he saw were a separate editor defect: the code
   template merge invented exec pins on load — fixed same day, see
   `mergePinDocsFromTemplate` + `pureCodeNodePins.test.ts`.)
2. Nothing GATED the catalog on "no dead nodes, readable layout" — and the
   layouts had accreted node-on-node overlaps over many feature waves.

## What was built

### `scripts/audit_flow_graph.py` (new deterministic gate)
- DEAD EXEC NODE: exec-pinned node unreachable from any trigger over exec
  edges (the compiler skips it; downstream data edges resolve to nothing).
- DEAD PURE NODE: pure node whose outputs never reach the exec spine.
- ORPHAN EDGE: edge naming a missing node.
- OVERLAP: node boxes intersecting (box model 300 x (90 + 26/data-pin row)).
- `--all` sweeps the shipped bundled catalog (21 flows). Exit 1 on findings.

### Four adversarial fable5 reviewers (parallel, disjoint generator scopes)
1. co-scientist + diagram-render
2. deep-research family (root + 4 subflows)
3. coding-agent family + basic-agent + structured-extract
4. meta-* family + adversarial-review + map-reduce

### Real defects fixed (beyond ~300 layout overlaps)
- P0 basic-agent status helper: `wait_until` Delay was data-wired but never
  exec-wired — every configured `post_delay` silently dropped. Wired into
  the exec spine (a past/zero deadline completes immediately, so the fix is
  behavior-neutral when unset).
- P0 deep-research generator DRIFT: the shipped bundle carried the
  artifact-registration import lane (3 `import_workspace_file` nodes + end
  pins) that the generator did not produce — a rebuild would have silently
  deleted live functionality. Folded into the generator; semantic diff vs
  the shipped bundle verified equal.
- P1 basic-agent root: declared `memory` start pin was unwired (caller
  memory config silently dropped); stale `delay_after` pinDefault named no
  pin (the pin is `post_delay`).
- P1 coding-agent verifier: FAIL-CLOSED + environment_failures guidance was
  only emitted when NO run_command was given; an explicit run command that
  cannot run on the host (missing-executor class) got no fail-closed rules.
- P1 adversarial-review merge fold: non-dict critic output crashed the node;
  a None payload folded as a CLEAN lens — a broken critic could upgrade the
  verdict toward "pass". Now an explicit unparseable-lens finding
  (`#FALLBACK`) that lowers the verdict.
- P1 generator/publish gaps: adversarial-review, map-reduce, and
  structured-extract generators never packed their bundles (fixes could not
  reach the gateway) and shipped JSON even when `validate_edges` failed.
  All three now exit 1 on edge problems, compile-check through the real
  runtime compiler, and repack their bundles.
- P2 co-scientist citation honesty: the "CITATION VERIFICATION (every ledger
  URL was fetched...)" block rendered vacuously on zero-source runs; the
  12-URL check budget was overclaimed as "every" on >12-source runs. Now the
  block renders only with verdicts, unchecked overflow is counted + noted in
  the literature text with `#FALLBACK`, and Methodology/Limitations state
  the budget.
- P2 hygiene: stale `dp.` get_var labels (deep-research), dead sandbox code
  (`_has_references_heading`), dead generator helpers (`_for_node`,
  `_template`), stale gate-policy comments, bundle metadata deduplicated
  between build + pack scripts.

### Layout (all 21 bundled flows audit-clean)
Exec spine flows left-to-right on one lane; pure helpers in rows above/below
their consumers; stages form columns; >= 60px box gaps. deep-research grew a
layout ENGINE (`_apply_layout`) that refuses if a spec misses/double-places
a node; the other generators use explicit grid coordinates.

### Version bumps (sha-immutable rule)
coding-agent@0.2.1, co-scientist@0.1.14, deep-research@0.1.7,
basic-agent@0.0.2 (both artifacts), structured-extract@0.1.1,
adversarial-review@0.1.1, map-reduce@0.1.1, diagram-render@0.1.1, six
meta-*@0.1.1. The adversaries had repacked at UNCHANGED versions (per
instruction); the fold bumped every content-changed bundle, removed the
overwritten untracked old-version artifacts (their bytes no longer matched
the version they claimed), restored the three tracked ones to original
bytes, reloaded the gateway, and verified the catalog serves exactly the
new refs. Gateway-side filename pins (pyproject force-includes, install
profiles test, deep-research contract test) updated in the same pass and
the gateway seat notified.

## Verification
- `python3 scripts/audit_flow_graph.py --all` -> 21/21 clean.
- All build scripts green (edge validation + runtime compile checks).
- coding_agent_v2_gates_smoke.py: 43/43.
- abstractflow: 358 TS tests green; dist rebuilt.
- abstractgateway: test_deep_research_bundle_contract + install profiles =
  19 green (PYTHONPATH=../abstractruntime/src — site-packages runtime is
  stale, pre-existing).
- Gateway catalog verified serving all 14 bumped bundle refs.

## Follow-ups (reported, deliberately not changed)
- map-reduce reduce prompt truncates per-item results at 1200 chars without
  a `#TRUNCATION` label (behavior change on a shipped primitive — needs a
  deliberate decision).
- structured-extract: required key with `null` value counts as missing while
  the prompt teaches "use null when the source does not state a value".
- deep-render `_remove_blocked_sections` is heading-level-blind (nested
  sub-heading ends the skip) — contract-pinned current behavior.
- co-scientist: dead `citations_verified` output key; Elo figure caption
  authored then always discarded (one-caption rule asymmetry).
- coder.json start `tools` pin deliberately declared-unwired (contract
  declaration; runtime allowlist binds).
