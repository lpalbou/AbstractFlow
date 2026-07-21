# 0150 — coding-agent 0.2.4 process wave: repair reflex + best-artifact delivery

- Status: completed (2026-07-21)
- Work id: abstractflow-0150
- Thread anchor: commons c4053 (operator order, laurent dm#122 via the code
  seat); forensics source `abstractcode/experiments/memgraph_bench/forensics/ARCHITECTURE.md`
- Owner: flow
- Depends on: 0145 (deterministic gates), coding-agent 0.2.2 (fail-soft) and
  0.2.3 (semantic prompt wave)

## Problem

The hack2 rerun forensics proved 0.2.3's semantics WORKED (the temporal
ripple was alive mid-run) but the PROCESS lost a good artifact twice:

- r3: a verified-green artifact existed after round 1; a post-verification
  rewrite in round 2 broke one DOM id contract (`#timeRange` referenced,
  `timeStart`/`timeEnd` defined) and delivery took the LAST write. The
  all-green SELFCHECK.md was stale — written before the breaking edit —
  and nothing bound it to the bytes it described.
- Repair rounds re-prompted with generic failure text; the builder's own
  account of what it tried was discarded, so consecutive repairs repeated
  the same failed approach until the budget died.

## What shipped (one build, all in `scripts/build_coding_agent_workflow.py`)

- R1 repair reflex [S+P]: `builder.response -> next_state.builder_report`
  (the builder's account persists as `last_attempt_summary`); repair
  prompts scope to `last_verdict` (named artifact, verbatim failure lines,
  extracted code tokens via general-purpose quoted-string/identifier
  extraction minus a gate-vocabulary stopword set) with an ordered
  read → search_files → smallest-edit → re-probe protocol and an explicit
  "do NOT rewrite the file with write_file"; failure-signature stall guard
  (per-line lowercase+digit-stripped set) stops the loop after 2 identical
  failure sets; anti-repeat block names the previous attempt when the
  signature repeats.
- R2 best-artifact snapshot/restore [S]: per-round workspace snapshot into
  `.cg_rounds/round_<N>` (dot-dir invisible to G0 classification and the
  final delivery listing — `include_hidden: False` verified in both
  compiled codeBodies); monotone gate-score max (`[all_passed,
  builds+executes+matches, delivery_ok]`, strict-greater keeps the earlier
  round on ties); restore lane (`restore_decide` + `if_restore` +
  `restore_call`) puts the BEST round back when the final round regressed;
  `final_report` leads with "RESTORED from round K", reports the DELIVERED
  round's verdict, appends the discarded final verdict; snapshot/restore
  failures degrade to `#FALLBACK` warnings, never round failures.
- R3 hash-bound SELFCHECK gate G5 [S+P]: builder must end SELFCHECK.md with
  `ARTIFACT-SHA256: <path> <sha256>` lines (computed via shasum AFTER the
  final edit); the verify subflow recomputes hashes host-side
  (`selfcheck_hash_args`/`selfcheck_hash_call`) and `gate5` fails
  deterministically on stale/malformed/unbound self-reports, naming the
  mechanism ("the artifact was modified after the last self-verification");
  missing SELFCHECK stays a warning; host-can't-hash degrades `#FALLBACK`.
- R4 schema-forced feature checks [P+schema]: VERIFIER_SCHEMA requires
  `feature_checks[]` of `{feature, input, expected_change, evidence,
  depends_on_input}`; verifier prompt replaces the C3 paragraph with the
  enumeration protocol (web evidence must name the full chain listener →
  state mutation → render read); `merge` belts any `depends_on_input=false`
  into `matches=false` + a failure line naming the feature. Verifier
  budget: max_output_tokens 2000→4000, max_iterations 12→16.
- R5 mode-driven budget [S]: `loop_state.mode` build → repair → ONE
  rebuild → stop; escalation on 2 identical failure signatures or a
  matches-only gap; per-mode builder `max_iterations` (build 30 / repair
  12 / rebuild 30) via the `round_mode_pins` pure node; `max_rounds`
  default 3→4.
- G6 DOM-contract gate [S, zero new tool calls]: pure code node over the
  entry/script reads already paid for — JS-referenced element ids
  (`getElementById` literals, quoted `#ident` selectors) must exist in
  markup (id= attributes, `el.id=` assignments, `setAttribute('id',…)`;
  over-collection on the defined side only reduces sensitivity); failure
  names the mechanism ("the reference resolves to null at runtime — a
  rename applied to one side of the markup↔script contract"). Flags
  exactly the broken r3 run.

## Verification

- Build: fable5 implementer subagent against the forensics spec;
  independently re-verified (audit clean on all three flows; gate smoke
  extended to 153 checks, ALL PASSED — includes G5 stale-hash and
  DOM-gate positive/negative pins, R1 prompt-shape units, stall-guard
  signature drift, R2 monotone-best/restore-decision/report-restoration,
  R4 merge fold, R5 mode/budget units, every 0.2.2/0.2.3 check unchanged).
- Bundle `coding-agent@0.2.4` packed, gateway registry reloaded, UI refs
  bumped (`bundledFlows.ts`); live gateway run driven via
  `scripts/coding_agent_run.mjs` (auto-approval across the run tree).
- LIVE-FOUND across three gateway runs (the fixture-double lesson again —
  unit smoke fed the gates raw strings, the live lane decorates every
  shape). Run 1: (a) `read_file` prefixes every line with `N: ` line
  numbers — the builder's ARTIFACT-SHA256 lines were present in all four
  rounds yet parsed as zero claims → "self-report unbound" every round;
  (b) `execute_command` returns a DICT (`{stdout,...}`), not a string.
  Run 2: (c) the tool-approval RESUME lane stores the whole
  `{mode, results:[{output:{...}}]}` envelope in the result_key — the
  fold must dig through it; (d) R4's verifier marked a correctly-present
  STATIC feature ("a number input (with a visible label)") as
  `depends_on_input=false` and the merge belted a healthy artifact to
  matches=false — the prompt now defines depends_on_input as ALIVENESS
  (static presence counts true; false is reserved for defects). Run 3:
  (e) the DURABLE result_key copy is COMPACTED by the runtime — `stdout`
  is dropped, only `stdout_preview` survives; the fold falls back to the
  preview twins (hash listings are tiny, so an untruncated preview is the
  full text). All five fixed + smoke-pinned (157 checks). Run 1 also
  proved R5's escalation arithmetic live (2 identical signatures →
  rebuild with counter reset → budget end at max_rounds=4) and the
  fail-fast path (deterministic G5 failure skipped probe+verifier); run 3
  ended at the honest 0.2.2 terminal "DELIVERED — NOT VERIFIABLE HERE"
  (browser_probe unmounted on the gateway host — the known cross-seat
  mount decision), rounds_used=1, all four feature_checks true, exit-code
  honesty (`success: true`).
- External bench: code seat armed the hack2 verification rerun (c4078).

## Honest limits / cross-seat

- R4's stronger half (verifier-planned scripted probe interactions) needs
  `browser_probe` to accept action scripts — code seat's tool lane;
  reported, not built.
- The three new gate-side `execute_command` calls (snapshot/restore/hash)
  ride the same approval posture the builder already needs; unattended
  runs keep their approve-all/auto policy or the gates degrade to
  `#FALLBACK` warnings (never round failures).
- Snapshots copy the whole workspace per round (`cp -R`); very large
  workspaces pay that copy per round. Acceptable at bench scale; a
  size-capped or rsync-hardlink variant is a future refinement.
