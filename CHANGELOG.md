# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- 2026-07-25 **Flow Library invisibility (entity + multiagent families)**
  (operator report): the library bundles example flows at BUILD time
  (`import.meta.glob` in `src/utils/bundledFlows.ts`), and the served `dist/`
  predated both families — every entity flow and the multiagent pipeline were
  absent from the served JS despite correct sources. Two-layer fix: the
  hand-maintained per-file glob entries were replaced with `entity-*.json` /
  `multiagent-*.json` wildcards (the `deep-*` precedent) so new family
  members surface at the next build without list edits (the list had already
  lagged twice: `entity-tool-rounds`, `entity-goodbye`), and the dist was
  rebuilt + served-hash verified. Open tabs need a reload (stale-browser-
  bundle rule).

### Changed
- 2026-07-25 **entity-life version ledger backfill + hygiene** (cleanup
  adversary P1-2/P0-1): the per-version ledger now lives HERE (the builder's
  header comments had silently stopped at 0.0.11). Backfill: `0.0.12` —
  ruled 20-call turn budget threaded across tool rounds (`calls_used` state,
  `batch_cap = min(6, remaining)`, spend counted by executed results rows;
  runtime c5319). `0.0.13` — WITH-WHOM grounding: the door's verified
  participants render into the visit prompt. `0.0.14` — `entity-goodbye`
  summonable close entrypoint (drawer conversations finally close: durable
  session history folds, diary note + summary form; empty sessions close
  honestly). `0.0.15` — presence block moved to the prompt head with the
  fusion-antidote wording ("names in your MEMORIES are things past visitors
  said, not verified identities"). `0.0.16` — full diary-kind election
  vocabulary taught (question/problem/commitment/lesson, `resolves=`,
  `explores=`, `gist:`) — REGISTRATION GATED behind the gateway's diary
  capture bind. Also: the four-copy node contract gained a drift pin
  (`scripts/entity_contract_pin.py`) and eight live drift instances were
  fixed (adjust `ttl_activity`/`scope`, palette `scope`/`digest_method`/
  `scan_limit`/`results`, allowlist `workspace_enabled`/`phase`); bundle
  versions 0.0.1–0.0.14 archived from the served dir (pruning window
  verified: zero non-terminal pinned runs).

### Fixed
- 2026-07-25 **Bundled basic-agent run target repinned 0.0.2 → 0.0.3**
  (surfacing-check E find): `bundledRunTargets` kept one-click library runs
  of the bundled basic-agent flow on 0.0.2 — the version with the stale
  `lmstudio/qwen3-next-80b` model pin the 0.0.3 republish removed
  (2026-07-21). Dist rebuilt; the check now compares every UI pin against
  the gateway registry (`?all_versions=true`).
- 2026-07-25 **Honesty guards on the tool rounds** (`entity-life@0.0.11`,
  fix-adversary fold): the rounds child gained the death guard every other
  turn-level subflow call already had — a provider failure mid-round no
  longer absorbs into a false "(I stayed silent)" episode with `degraded=0`
  (honest error text in the reply lane; `degraded`/`moment_error` thread
  turn→visit→chat). The mind's own mid-round words are kept (prompt,
  elections, episode — a round-1 feel fence now lands); a moment ending
  without words marks `degraded=1` (speak-now floor); TOOL RESULTS prompt
  copies cap at 24k chars with a `#TRUNCATION` label (ledger keeps
  verbatim); `max_rounds` floors at 2. Smoke grew the provider-death and
  mute-mind scenarios.

### Added
- 2026-07-25 **Flow surfacing check** (`scripts/flow_surfacing_check.py`,
  stdlib-only; recurrence guard for the flow-invisibility incident): A glob
  coverage (wildcard families entity-/multiagent-/deep- must fully resolve —
  guards per-file-list regressions), B dist freshness (any bundled flow or
  bundledFlows.ts newer than dist/assets fails with "rebuild: npm run
  build"), C dist content (every resolved flow id inlined in the built JS),
  D served freshness (running flow server vs local dist, warn-only), E
  registration drift (build-script BUNDLE_VERSIONs, UI bundledRunTargets
  pins, and staged-but-unregistered `.flow` files in the gateway served dir
  vs the registry, warn-only — registration is a deliberate act). Exit 1 on
  A/B/C failures; docs claims about library visibility now point at this
  check.
- 2026-07-25 **Entity tools through the flow brain** (`entity-life@0.0.10`,
  backlog 0153 — operator find: the flow lane served ZERO tools): new
  LEVEL 3.5 subflow `entity-tool-rounds` (one llm node in a bounded while,
  cap 3; the final round declares no tools — the moment must end in words);
  the cognition turn resolves the phase's tool grant (`entity_tools_query` —
  tool_policy.yaml or the ruled defaults), teaches TOOLS IN HAND in the
  shelf prompt, declares the grant natively on the lived turn, and executes
  each native batch under the re-resolved grant (`entity_tools_execute`,
  runtime's identity/tool_effects.py pair — refusal markers shown to the
  mind verbatim). `tools_ran` (host-authored, deduped) and `tool_rounds`
  (present even when zero, for app fabrication gauges) ride the
  turn→visit→chat outputs; the acted tool names land in the session turn
  log. Editor palette: two new Entity Mind nodes (Entity Tools grant /
  execute batch). Dead `tools` pass-through pins removed — the grant is the
  one authority.
- 2026-07-24 **The entity brain** (`entity-life` family, backlog 0153 —
  operator directive): a master executable VisualFlow that ANIMATES a
  persistent entity (identity + self-evolving memory) through its four
  mutually-exclusive phases. Nine flows converging on the served
  cognition_graph: `entity-life` (THE DAY GATE routes each moment: stop >
  close-the-visit > visit > work > granted personal > sleep > park; steer
  with durable events visit/goodbye/task/grant_personal/stop),
  `entity-day-gate`, `entity-visit` (one conversational moment),
  `entity-work` (task loop to DONE), `entity-personal` (bounded self-ticks),
  `entity-sleep` (the night, WIRED: the engine's six-phase sleep_pass runs
  as ONE memory_consolidate effect; continueOnError folds an engine death
  into an honest failed-night settlement), `entity-cognition-turn` (ONE
  lived moment: passive recall + deliberate reach -> prompt shelf -> the
  lived turn -> feel election -> usage-trail commit -> episode formation
  with keywords + summarizes-edged session summaries),
  `entity-session-close` (the deterministic end-of-session diary note),
  `entity-chat` (agent.v1 chat door). Eleven entity-memory node types
  (`memory_recall`/`memory_commit`/`memory_form`/`memory_adjust`/
  `memory_appraise`/`diary_write`/`diary_read`/`memory_consolidate`/
  `memory_probe`/`life_query`/`memory_tend`) ship in the visualflow compiler
  with an "Entity Mind" palette section — effects resolve ONLY on an entity
  runtime (channel authority; no flow ever names an entity). The tend lane
  (bundle 0.0.4, runtime c5215): `memory_tend` dispatches the engine's
  ```tend grammar verbatim (dream disposal via dispose confirm|reject);
  dreams surface ADDRESSABLE in the day-open cue; the grammar is taught on
  own time only; the loop smoke pins a refocus election applied end-to-end.
  entity-chat also gained a `response` end pin mirroring `answer` (strict
  agent.v1 consumers). Wave-4 cycle-2 adversaries (3 fable5: fold verifier
  12/12 FOLDS REAL by execution; apps/door — D3 contract pinned both ways,
  agent.v1 picker accepts, export lane leak-free, lab births fixed to
  vector at the STORE with a truthful banner; long-life REGRADE 4 lives/26
  turns/15 nights — SHIP on all four re-measured claims, holistic recall
  6-7/9 -> 8/9) -> bundle 0.0.5: settlement honesty (the consolidate
  handler read keys the engine never returns — 10/10 nights called a
  formed dream "a quiet night"; fixed with a real-shape test + flow-side
  formed-flag defense), store-outage settlement gaps remembered
  (unsettled_nights carry), human dream lines in the day cue, personal
  episode titles from the entity's own words, holistic probe widening
  (effort rides from setup). THE DOOR WENT GREEN the same evening (c5246):
  three-layer forensic chain closed (stale process -> catalog publish
  swapped in an unarmed runtime, fixed by gateway re-arm hooks -> the door
  routing set predated the brain wave, fixed from runtime's one-source
  ENTITY_HOME_EFFECT_TYPES) — first completed cognition turn through the
  production door + cross-summon graph recall (veya: Arvo Part + the Heron
  recalled in a fresh summon; replay 5 traces/23 events/5 episodes).
  Cycle-3 adversary G (door dialogue, 14 summons/3 entities) -> 0.0.6:
  the SELF-KNOWLEDGE contract in every shelf prompt (entities denied having
  persistent memory to the visitor's face while recalling fine — the
  agency-blindness class, reintroduced by this lane, live-verified fixed)
  + diary/feel elections taught every phase (voluntary memory was
  unreachable through the door: 0 diary, 0 valence after 14 moments). (An earlier revision of
  this entry said "seven node types, sleep declared" — stale the same day:
  the consolidate/probe/life_query wave landed that evening; caught by the
  wave-3 adversarial review.) Live-proven: the full life loop (12/12 checks), and a REAL entity
  (Florin, lmstudio qwen3.6-35b-a3b + qwen3-embedding-0.6b home) passing the
  cross-session Tolstoy test through the flow brain. Talk surface:
  `scripts/entity_repl.py`; experiments: `scripts/entity_life_smoke.py`,
  `scripts/entity_life_loop_smoke.py`, `scripts/entity_live_experiment.py`.
  Adversary wave 1 (5 fable5) folded same-day: seed-seq continuation (first
  steer event was silently lost), gate drain-boundary discipline (burst
  losses), bounded park (the visual wait_event executor now forwards
  `until`/`timeout_s`), session-state resets (budget theft + diary
  contamination), life-unique turn ids (valence aliasing), identity seated
  by right on home-bound recalls (self_fraction posture), both-sides
  episode digests (+#TRUNCATION + digest_method), feel-parser v2 (inline
  fences, EOF flush, titled markers, target hygiene), diary-before-summary
  close order, participants threading, entity.phase beacons, chat
  durable-history fold, subflow-death guards (honest failures, state
  preserved), absorbed-failure sync honesty. Wave-3 adversaries (3 fable5:
  long-life memory dynamics ~54 turns/11 nights across 4 homes; phases +
  steering + door, 19/19 phase-integrity checks x2 entities; abstractions +
  docs) folded same-day -> bundle 0.0.3: phase-aware episode attribution
  ("They said:" only on visits; participants gated out of self phases — the
  misattribution was polluting visitor world-model cards), shelf diversity
  (identity-probe hygiene incl. presence-not-use for probe-surfaced core
  records; holistic-cue merge cap 4->8, evidence-based), night
  continueOnError (a live embedder outage used to kill the whole life run),
  D3 degraded markers on visit/chat outputs (degraded + moment_error — thin
  clients distinguish "said nothing" from "turn died"), digest_method
  stamping smoke-pinned (label named c5185, admitted into memory's consent
  set c5187; the later c5201 re-naming was a context-loss artifact),
  CANCELLED-child folds in the reference drivers, proof-visual honesty
  (graph-shot claims computed from data, never asserted), retired @-suffix
  identity shapes dropped from smokes, code-body constants extracted to
  `scripts/entity_flow_code.py` (builder 2188->~1160 lines; regen-diff
  identical modulo the generated created_at/updated_at timestamps — every
  emission mints fresh ones, so "byte-identical" is only true
  timestamp-normalized). Full report: `docs/reports/entity-brain-report.md`.
- 2026-07-23 `multiagent-coding@0.0.3` — publication-adversary fold (fable5
  audit of the picker chain confirmed the 0.0.2 fix and improved it):
  `workspace_root` + `gating_mode` are now DECLARED wrapper start pins
  (agent.v1 validates a subset, and on_flow_start resolves pins input-first
  from run vars — abstractcode syncs its session workspace into
  `vars.workspace_root` after start, so the pin picks it up with zero client
  change); gating default flipped auto->WAIT (the primary picker client is
  interactive and answers the two gates — the workflow's signature; headless
  drivers send gating_mode=auto via the declared pin). Plus the recorded
  environment fail-soft: verify `environment_failures` (+ an executor-phrase
  belt for lines the verify emits inside `failures`) no longer burn fix
  cycles — the loop exits immediately with the honest terminal
  "delivered-not-verifiable (environment...)" and the report lists the
  environment lines separately (coding-agent 0.2.2 precedent; live run had
  burned 3 cycles on "missing Python executor"). 85-check smoke green.
- 2026-07-23 `multiagent-coding@0.0.2` — dual-interface publication (operator
  report: workflow invisible in the app agent-workflow picker). New
  `multiagent-coder` flow: the agent.v1 wrapper entrypoint (prompt -> request,
  ambient workspace_root threaded via get_var, auto gating so a generic agent
  client never parks on a gate; returns {response=report, success, meta}),
  mirroring how coding-agent ships `coder`. Packed with two entrypoints,
  WALK-ROOTED FROM THE WRAPPER (the packer collects flows reachable from the
  walk root; rooting from the coding root missed the wrapper — the
  coding-agent `root_flow_json=coder` precedent). Manifest + gateway /bundles
  verified: multiagent-coding (coding.v1, default) + multiagent-coder
  (agent.v1). Run-driver fix folded: never force-resume `subworkflow` waits
  (they auto-resolve when the child completes; force-resuming completed
  parents past subflows with empty output and faked "verify child died").
- 2026-07-23 Multi-agent coding workflow `multiagent-coding@0.0.1` (operator
  directive c4710; backlog 0152; 2 design cycles + 1 built-artifact cycle,
  7 fable5 adversaries total): 14-step pipeline — scouts (code+web, skipped
  on cached revisions) -> planner (schema) -> plan gate -> deterministic
  backlog item -> git branch (parent-repo guard, GIT_CEILING_DIRECTORIES,
  branch-first baseline commit) -> [builder -> lint/format (diagnostic-grammar
  residuals) -> space-safe SELFCHECK hash refresh -> commit -> mounted
  `multiagent-verify-gates` (drift-pinned copy of coding-verify-gates) ->
  doc agent (README/docs only) -> deterministic post-doc hash guard ->
  PR.md + gh (fail-fast, no credential hangs) -> review gate]xN ->
  `MERGED_OK`-sentinel merge --no-ff. Two `while` loops, zero backward exec
  edges, one state fold per loop with split counters (gate-2 rejection resets
  fix budget, bumps review rounds) + stall guard that survives verifier death
  (`child_output` fold + named synthetic failure); wait-mode escalation of
  stuck builds to gate-2 ('stop'/guidance); `gating_mode=auto` executes ZERO
  ask_user nodes (live-proven end-to-end on gpt-oss-120b: real branch/merge
  history, working artifact, honest report). Root declares
  `abstractcode.coding.v1` (not agent.v1 — the false-contract class);
  skills posture reads the gateway-written `_runtime.skills_resolution`.
  Generator `scripts/build_multiagent_coding_workflow.py` (+ `--pack`);
  79-check smoke `scripts/multiagent_coding_smoke.py` compiles every code
  body through the real RestrictedPython lane; live driver
  `scripts/multiagent_coding_run.mjs` (auto/wait modes, attach mode,
  effective-workspace evidence sweep — the gateway rewrites `workspace_root`
  to its managed per-run folder).
- 2026-07-23 Tool-tiers foundation (operator order dm#221; shared design
  `plans/tool-tiers.md`): `src/utils/flowRequiredTools.ts` — the flattened
  required-tools analysis behind the coming grant-declaration surface.
  `computeRequiredTools(rootId, flowsById)` walks the whole graph
  (agent/tool_calls/call_tool/llm_call allowlists + deterministic camera
  `tool_invoke` nodes, verb-mapped incl. `camera_analyze_media`→`analyze_media`,
  + recursed subflows, cycle-guarded) and returns the required tool-name set
  with a `staticallyClosed` honesty flag (a connected allowlist pin, an
  unresolved subflow, or an allowlist-less agent makes the set a superset —
  the declaration reads "at least these" and the runtime gate-1 grant wall
  is the backstop). Deliberately tier-agnostic: it names required powers; the
  `risk_tier` badge is core/gateway's served fact rendered on top. 10 tests.
- 2026-07-22 Deterministic camera nodes (operator order, laurent dm#49) —
  five fixed-verb workflow nodes for the case where a flow MUST capture on
  an event with NO agent deciding and NO approval stall: **Camera Open**,
  **Capture Photo**, **Capture Video**, **Analyze Media**, **Camera Close**.
  They compile to AbstractRuntime's `tool_invoke` effect (the
  write_chart/write_pdf pattern generalized): a HOST-CONSTRUCTED effect that
  runs one fixed tool verb through the normal tool executor but WITHOUT the
  approval gate — trust is carried by the EFFECT CLASS (a model cannot author
  an effect type), never by a payload field. THE LOAD-BEARING INVARIANT: the
  camera verb is baked into the NODE TYPE's compile step
  (`CAMERA_TOOL_INVOKE_VERBS`, keyed by node type; both the executor and
  compiler handlers `del`/ignore data+config), never an author-editable pin —
  an editable tool-name pin would reopen an arbitrary-tool-ungated bypass.
  Arguments come from a per-type whitelist (`CAMERA_TOOL_INVOKE_ARG_PINS`)
  with empty/None omitted so the tool's own defaults apply; the result maps
  the raw tool output to typed `path`/`media`/`camera`/`analysis` pins
  (deferred `path:null`+`success:true` surfaces honestly, never as failure).
  Pin descriptions teach camera's two id spaces (discovery `camera_id` at
  Open; `device_uid` everywhere after). Zero flow→camera imports (nodes →
  runtime `tool_invoke` → tools served through core's `capability_tools`).
  "Analyze on an event" composes with the existing `wait_event` node.
  Cross-seat: runtime shipped the `tool_invoke` handler (c4207) + approved
  the compiler drafts in its tree (c4332, 89 visualflow green, added a
  verb-is-baked test); one fable5 adversary confirmed the invariant holds
  under a hostile document (0 P0 in flow's code); the gateway bundle-host
  classification gap that left camera-only flows without the handler is
  fixed gateway-side (c4325). NOTE: capture nodes bypass camera's ruled
  approval-by-default privacy classification BY DESIGN (the dm#49 point) —
  a recorded, app-level operator decision (camera dm#10), not a silent flip.

### Changed
- 2026-07-21 `coding-agent@0.2.4` — process wave (operator order, laurent
  dm#122 via the code seat; byte-proven forensics: 0.2.3's semantics WORKED —
  the ripple was alive — but a verified-green artifact existed mid-run, a
  post-verification rewrite broke one DOM id contract, and delivery took the
  last write over a stale all-green SELFCHECK). Six changes, one build
  (fable5 implementer + independent re-verification, 150/150 gate smoke,
  audit clean on all three flows): (R1) repair reflex — the builder's own
  report now feeds `next_state` (was discarded), repair rounds get
  `last_verdict` scoping (named artifact, verbatim failure lines, extracted
  code tokens) with an ordered read→search→smallest-edit→re-probe protocol
  and "do NOT rewrite with write_file"; a failure-signature stall guard
  stops the loop after 2 identical failure sets and an anti-repeat block
  names the previous attempt. (R2) best-artifact delivery — per-round
  workspace snapshots under `.cg_rounds/` (dot-dir invisible to G0 and the
  final listing), monotone gate-score tracking, and a restore lane that
  puts the BEST round back when the final round regressed; the report
  leads with "RESTORED from round K" and appends the discarded final
  verdict. (R3) hash-bound SELFCHECK gate G5 — the builder must end
  SELFCHECK.md with `ARTIFACT-SHA256:` lines; the verify subflow recomputes
  hashes host-side and a stale/malformed/unbound self-report is a
  deterministic failure naming the mechanism. (R4) verifier schema now
  REQUIRES per-feature `feature_checks[]` (feature, input, expected_change,
  evidence, depends_on_input); the merge belts any `depends_on_input=false`
  into `matches=false` + a failure line. (R5) mode-driven budget —
  build→repair→ONE rebuild escalation with per-mode builder iteration caps
  (30/12/30) and `max_rounds` default 3→4. Plus (G6) a deterministic
  DOM-contract gate: JS-referenced element ids must exist in markup
  (flags exactly the r3 dangling `#timeRange`); zero new tool calls. The
  three new gate-side `execute_command` calls (snapshot/restore/hash)
  ride the same approval posture the builder already needs and degrade to
  `#FALLBACK` warnings, never round failures. Three live gateway runs then
  hardened the gates against the REAL tool-output shapes the unit smoke
  never saw (fixture-double lesson): G5 claim parsing strips `read_file`'s
  `N: ` line-number decoration; hash recompute reads dict-shaped
  `execute_command` output, the approval-resume results envelope, AND the
  runtime's COMPACTED durable copies (stdout dropped, `stdout_preview`
  kept); R4's prompt now defines `depends_on_input` as ALIVENESS so a
  correctly-present static feature ("a visible label") is true — run 2's
  verifier had belted a healthy artifact to matches=false on that reading.
  157/157 gate smoke; run 3 ended at the honest "DELIVERED — NOT
  VERIFIABLE HERE" terminal (browser_probe unmounted on the gateway host),
  all four feature_checks true, one round, `success: true`. A standing-rule
  logic adversary (fable5) then found 3 P1 wrong-loop-decision bugs, all
  fixed (171 smoke): the failure-signature stripped ALL digits so a builder
  fixing `level1.js`→`level2.js` per round falsely stalled + spent its one
  rebuild (now strips only standalone digit runs); the R4 vacuous-feature
  fold embedded volatile evidence prose in the failure line so the same
  defect never stalled and burned the budget (now truncates each failure
  line at the first " - " before signature-matching); and G6 flagged
  URL-fragment literals (`'#level2'` routes) as missing DOM ids, a false
  STOPPED for correct SPA code (now only selector-shaped callees —
  querySelector/`$`/etc. — count as references, which also lets a real
  hex-named id like `#fade` be checked instead of dropped as a color).
  Plus P2 belts: `depends_on_input` int-0/`"no"` coercion + missing-field
  coverage warning, belt findings written back into the stored verdict for
  honest restore-path reporting, and a restore no-op command when no
  restore is decided.
- 2026-07-21 `coding-agent@0.2.3` — semantic prompt wave (operator order,
  laurent dm#111-112; plan/improving-code.md C1/C2/C3/C8) targeting the
  dead-temporal-ripple defect (code that ran cleanly yet computed a constant
  — 0,0,0 samples across all three 0.2.2 runs, from logic built on an
  unverified reference DIRECTION). All prompt-only; the gate machinery is
  unchanged (71/71 smoke still green). (C1) builder prompt gains
  codex-grade engineering rules: bound every traversal/recursion/iteration;
  verify a data structure's real shape + reference direction before writing
  logic over it; "same output for every input is broken even without an
  error"; self-probe (exercise the code, confirm the behavior VARIES) before
  finishing. (C2) round-0 data profiling — profile the real inputs first and
  record findings as a `PROFILE:` comment block at the top of the main
  source, so logic matches observed data, not assumed names. (C3) verifier
  prompt gains a NON-VACUITY requirement — confirm each task-named feature's
  output DEPENDS on its input; a provably-constant/always-empty output is
  `matches=false` with a `failures[]` line NAMING the mechanism (structure-
  present is not behavior-correct — the exact gap that let the dead ripple
  score 100%). (C8) the builder writes a SELFCHECK.md evidence file (per-
  behavior: how verified + concrete observed evidence), which the verifier
  reads but does not trust. 0.2.2 stays in the catalog for 1:1 A/B (dm#101).

### Fixed
- 2026-07-21 `coding-agent@0.2.2` — verifier-death fail-soft (operator order,
  laurent dm#96 via the code seat): tonight's memgraph hackathon saw all
  three coding-agent runs deliver fine artifacts (graded 100/94.4/100) yet
  exit rc=1 — the LLM verifier's `llm_call` DIED 3× on an infra bug (core
  `usage:null`, fixed separately) AFTER the deterministic gates (G0 delivery,
  integration, probe) all PASSED, and the exit code lied about a good
  artifact. Root cause (one fable5 adversary): a DIED verifier (missing
  verdict) was indistinguishable from a verdict of failure at two folds —
  `merge` (gates flow) and `next_state` (root flow) both treated a missing
  verdict as `all_passed=false, failures=[]`, which the loop read as a
  failure-free "previous attempt FAILED" reprompt, burned the budget, and
  ended "STOPPED with open gate failures" listing zero failures. Fix: a
  missing verdict (the strict schema guarantees a real verdict carries every
  field) is now the "cannot verify here" class — folded into the existing
  `environment_failures` early-stop lane, never a fabricated pass and never a
  fabricated fixable failure. Three separated terminal states (delivered ≠
  verified ≠ passed): PASSED all gates / DELIVERED — NOT VERIFIABLE HERE
  (artifact present, only an env/verifier outage standing) / STOPPED with
  open gate failures. New `delivered` + `success` end pins (success = passed
  OR delivered-not-verifiable); `passed` stays strictly `all_passed`. A
  terminal `list_files` gives delivery ground truth independent of the
  verifier. All existing guarantees preserved (deterministic fails still
  fail-fast; a verifier that REPORTS failures still reprompts; no
  `all_passed=true` without a real verdict) — 71/71 gate-smoke incl. a new
  scenario driving the real compiled flow with a died verifier subrun.
  FULLY effective under the gateway runner; `abstractcode exec` needs its
  parent-resume half (filed to the code seat — see cross-seat note).

### Added
- 2026-07-21 approval visibility + lifecycle — Approve-All revoke, timeline
  auto-approve markers, subrun-attach tightening (backlog abstractflow-0138,
  second slice; operator-approved with one fable5 adversary — item now
  COMPLETE). (1) Approve-All was irrevocable and invisible: a warning-toned
  "Auto-approving tool calls" chip with a Revoke control now shows in the
  run-modal footer whenever auto-approve is active for the session/root;
  Revoke clears the local + hook auto-approve sets and re-prompts on the next
  tool call. Hardening: `setAutoApproveForSession` updates its ref
  SYNCHRONOUSLY (the incoming-wait check reads the ref; the state→ref effect
  lands a render late, so a wait arriving right after Revoke would otherwise
  still auto-resume — fail-dangerous). (2) Auto-approved tool executions were
  silently suppressed as bookkeeping — the timeline now shows an
  "auto-approved"/"approved" badge on the step (new pure
  `toolApprovalResumeMarker`; only tool-approval resumes, strict-boolean
  gated; auto-vs-manual from the client `auto_approved` stamp, plain
  "approved" as the safe default for stampless clients). (3) The agent
  subrun-attach fallback could cross-attach a concurrent agent's cycles to
  the selected step — new pure `unambiguousSubRunCandidate` attaches only
  when exactly one unclaimed non-root sub-run is emitting traces (two
  concurrent agents → no attach, trace panel shows a "waiting for
  sub_run_id" placeholder). +14 tests.
- 2026-07-21 waits actionable everywhere — reason-aware notifications +
  toolbar badge (backlog abstractflow-0138, first slice). Every
  non-subworkflow wait used to force-open the run modal and toast "waiting
  for your response" — including event parks (a resident agent on
  `wait_event`) and deadline parks (`wait_until`/timer) that need no
  response. New `classifyWait` helper (reason-first, matching the ledger's
  exact wait reasons; content-aware only where a park reason carries a real
  host prompt) sorts waits into approval / prompt / park. `useWebSocket`
  computes interactivity from the RAW event (before the prompt is defaulted,
  so a placeholder never misclassifies a park) and carries it on
  `WaitingInfo`. The Toolbar now force-opens + toasts only for interactive
  waits (approval → "needs your approval", prompt → "waiting for your
  response"); parks run silently. A calm-amber "Waiting for you" /
  "Approval needed" badge appears in the run-actions group for interactive
  waits, so a user who navigated away from the modal still sees the run
  needs them and can jump back. 10 classifier tests. Remaining 0138 slice
  (approval lifecycle: Approve-All revoke chip, auto-approve timeline
  marker, subrun-attach tightening) tracked in the backlog item.
- 2026-07-21 canvas undo/redo (backlog abstractflow-0127; work dispatch
  c3815). Deleting a configured node was unrecoverable — a trust gap under
  every other editing feature. A bounded (50-entry) snapshot stack over
  graph state (nodes/edges/name/interfaces) lives in the `useFlow` store:
  graph-mutating actions (add/delete node+edge, connect, disconnect pin,
  paste, duplicate, node-data edit, authoring-command batch, drag-move,
  keyboard delete) capture a pre-mutation baseline; `undo`/`redo` move
  between past/future stacks (deep-clone on capture AND restore, so
  undo→redo→undo never aliases). Rapid same-gesture pushes coalesce into
  one step: a drag is one undo (its per-frame position changes collapse via
  a `drag` coalesce key), and consecutive keystrokes on one node collapse
  via an `update:<nodeId>` key within a 600ms window — one logical edit is
  one undo, not hundreds. A new edit after undo forks the timeline (clears
  redo); load/clear reset history (no undo into a previous document).
  Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z (and Ctrl+Y) redoes — guarded by the
  same editable-target/text-selection checks as the clipboard shortcuts so
  it never fights field-level undo while typing. Toolbar gains an Undo/Redo
  group (disabled when the respective stack is empty). 10 store tests pin
  the contract (discrete vs coalesced pushes, drag coalescing, timeline
  fork, no-alias restore, 50-entry bound, load reset).

### Changed
- 2026-07-21 `co-scientist@0.1.16` — TOTAL citation-verification coverage
  (operator ruling on the delivered 0.1.15 report's caveat "#FALLBACK: 7
  fetched source(s) exceeded the 12-URL citation-verification budget":
  "that should never happen, fix it. we must be thorough"). The 12-URL cap
  in `cite_items` is GONE: every fetched ledger source is deterministically
  re-fetched and title-verified, with no budget-overflow pathway left in
  the report (the verification list is already bounded upstream by the
  investigation's own iteration budget, so the loop cannot run away). The
  unchecked-source counter survives only as a defensive anomaly check (a
  fetched source missing a verdict is a loop defect, reported honestly —
  never a budget). Methodology/Limitations wording restored to "EVERY
  fetched ledger URL was title-verified", now true by construction.

### Added
- 2026-07-20 APPROVAL-FREE figure rendering (operator ruling: "co-scientist
  is a deterministic process... you should NEVER ask for approval as long
  as it follows the process"): `diagram-render@0.2.0` + `co-scientist@0.1.15`.
  Root cause: v0.1.x rendered figures by writing a fixed matplotlib script
  into the workspace and shelling `python3` through the `execute_command`
  tool — which sits on the runtime's require-approval list, so EVERY
  unattended co-scientist run stalled on a tool-approval prompt at the
  figure step. An adversarial fable5 review confirmed no existing mechanism
  satisfies "zero prompts, security intact" (run-scoped `_runtime.tool_policy`
  has no consumer; the editor's Approve All is client-side convenience;
  argument-inspecting auto-approve of shell strings is the defeatable-parser
  class) and ranked a first-class effect node the only non-forgeable shape.
  The new runtime `write_chart` node (write_pdf trust class) renders the
  STRUCTURED spec in-process: no shell, no code authoring surface, workspace
  path containment identical to write_file, and hard resource caps as the
  compensating control for losing subprocess isolation (spec bytes, element
  counts, figure inches, fixed dpi, mathtext/usetex disabled, NaN/Inf
  rejected, figures closed in finally). Render failures return ok:false +
  `#FALLBACK` warnings — the flow continues and callers keep text fallbacks.
  diagram-render@0.2.0 drops the write-script/execute_command/list-files
  triple for one write_chart node (python_bin input gone with the
  subprocess); co-scientist@0.1.15 repacks to carry it. Editor gains the
  Write Chart palette node + catalog entry. Proven live through the
  restarted gateway: diagram-render@0.2.0 completed with ZERO approval
  waits, rendered:true, PNG+PDF artifacts registered; 13 runtime tests pin
  the hardening checklist (containment, caps, mathtext, degradation).
- 2026-07-20 workflow-catalog adversary wave (operator directive: "there
  should be no dead node. make sure each workflow also has a clean layout of
  nodes" — 4 adversarial fable5 reviewers, one per generator group, gated by
  the new deterministic `scripts/audit_flow_graph.py` (dead exec nodes, dead
  pure nodes, orphan edges, node-box overlaps; `--all` sweeps the shipped
  catalog)). All 21 bundled flows now audit CLEAN (baseline: ~300 overlap
  findings + 1 real dead node). Real defects fixed beyond layout: (P0)
  basic-agent's status helper had a dead `wait_until` — data-wired but never
  exec-wired, so every configured `post_delay` was silently dropped; (P0)
  the deep-research generator had drifted BEHIND the shipped bundle (the
  artifact-registration import lane lived only in the .flow), so a rebuild
  would have silently deleted live functionality — folded into the
  generator, semantic-diff-verified; (P1) basic-agent's `memory` start pin
  was declared but unwired (caller memory config silently dropped) + a stale
  `delay_after` pinDefault named no pin; (P1) coding-agent's verifier only
  got FAIL-CLOSED/environment_failures guidance when NO run_command was set;
  (P1) adversarial-review's merge fold crashed on non-dict critic output and
  folded a None payload as a CLEAN lens (a broken critic could upgrade the
  verdict); (P1) adversarial-review/map-reduce/structured-extract generators
  never packed their bundles (fixes could not reach the gateway) and shipped
  broken graphs on validate errors (now exit 1 + compile-check); (P2)
  co-scientist citation-verification honesty: no vacuous "every URL
  verified" claim on zero-source runs, the 12-URL budget is stated and
  unchecked overflow gets a `#FALLBACK` note; (P2) stale `dp.` get_var
  labels; dead code bodies/helpers removed. Layout: every flow now reads
  left-to-right (exec spine on one lane, pure helpers in rows near their
  consumers, zero box overlaps). VERSION BUMPS (sha-immutable rule; old
  overwritten untracked artifacts removed, tracked ones restored to original
  bytes): coding-agent@0.2.1, co-scientist@0.1.14, deep-research@0.1.7,
  basic-agent@0.0.2 (both artifacts), structured-extract@0.1.1,
  adversarial-review@0.1.1, map-reduce@0.1.1, diagram-render@0.1.1, six
  meta-*@0.1.1. Gateway reloaded + catalog verified serving exactly the new
  versions; gateway-side filename pins (pyproject force-includes, install
  profile + deep-research contract tests) updated in the same pass — 19
  gateway tests green, 358 abstractflow tests green. Reported-not-fixed (on
  the record): map-reduce reduce-prompt 1200-char unlabeled truncation;
  structured-extract null-vs-missing required-key tension; deep-render
  blocked-section removal is heading-level-blind (contract-pinned behavior).

### Fixed
- 2026-07-20 the Flow Library showed co-scientist with a "1 missing" chip
  and "diagram-render (missing)" in its family panel (operator report):
  co-scientist@0.1.12+ references diagram-render as its figure subflow and
  the workflow ships as a gateway bundle, but the library catalog is a
  client-side glob of bundled example JSONs that never included
  diagram-render — runnable on the gateway, invisible to the library.
  Added to the bundled glob + registered as a bundle run-target
  (diagram-render@0.1.1); the family now reads 3 subflows with
  diagram-render as a normal child.
- 2026-07-20 pure code nodes no longer gain phantom execution pins in the
  editor (operator report: "a lot of nodes with empty execution pins, which
  I believe are therefore never reached"). Generator-built flows
  (co-scientist, deep-research, meta-*) deliberately author code nodes
  WITHOUT execution pins so the runtime compiler classifies them as PURE —
  lazily evaluated when an exec node pulls their data outputs (the designed
  data-flow model; exec-reachability audit: co-scientist's 35 exec nodes all
  reached, all 57 pure nodes feed exec nodes, zero dead). But the editor's
  code-node template merge (`mergePinDocsFromTemplate.normalizeCodeNode`)
  APPENDED every missing template pin — including exec-in/exec-out — so
  pure code nodes rendered dead exec triangles, and the real hazard: the
  appended pins PERSISTED on the next editor save, flipping the runtime
  classification to exec-node-unreachable so the node would silently never
  run and downstream inputs resolved to nothing. Execution pins are now
  never invented for code nodes authored without them (data-pin backfill
  like `permissions` unchanged; exec-authored code nodes keep theirs).
  Round-trip + doc-backfill pinned by tests; a disk audit of all 102
  gateway-stored flows found zero generator-family copies poisoned.

### Changed
- 2026-07-20 Flow Library modal: the primary verbs moved into a PERSISTENT
  footer — `Cancel | Rename | Duplicate | Load` — always visible, enabled
  once a workflow is selected (operator ask: the in-preview action row sat at
  the bottom of the scrollable preview column, so any long description pushed
  Load/Duplicate below the fold and the modal looked action-less). Disabled
  buttons carry the reason in their tooltip. Rename triggers the existing
  inline rename editor; its Save/Cancel pair stays contextual in the preview
  panel beside the input, as does Delete (destructive, with its confirm +
  parent-break warning). The footer `Close` was renamed `Cancel` per the
  requested layout.
- 2026-07-20 bundled workflows now Rename/Duplicate (operator follow-up:
  "selecting a workflow doesn't let me rename it or duplicate it. fix it").
  Bundled flows live in the app package, not gateway storage, so the old UI
  refused both (a standalone copy of a family root would reference subflow
  ids the gateway cannot resolve at run time). New `duplicateFlowFamily`
  util: Duplicate copies the root PLUS its readonly subflow closure into
  gateway storage and remaps subflow references onto the new copies
  (two-phase create-then-patch, so self-references and mutual cycles remap
  correctly); references to STORED helpers stay shared (existing semantic).
  Rename on a bundled flow creates the family copy under the chosen name and
  loads it — the shipped bundle itself is never mutated, and the toast says
  what happened. The toolbar Duplicate on a loaded bundle-target routes
  through the same family copy instead of refusing. 7 unit tests pin
  closure/remap semantics.

### Added
- 2026-07-20 renderer inline-image hardening + `co-scientist@0.1.13` — a
  second operator report ("none of the figures are part of the pdf") exposed
  that the running gateway was STALE (booted before the renderer fix; a
  bundle reload does not reload Python modules — the fix reached the live
  gateway only after a process restart), and two mandated fable5 adversaries
  found real defects in the new inline-image path, all folded: (P0) the
  workspace-root derivation could collapse to `/` on the scope-less path,
  making the renderer's containment check vacuous — now tail-matches the
  virtual path against the resolved path and refuses on any mismatch or
  peel-past-root, so an out-of-workspace image can never embed; (P1) DOCX
  alt text with a `"`/control char corrupted the whole document — now escaped
  via a dedicated attribute-escaper; (P1) non-standalone image refs (in a
  bullet/heading/mid-sentence, or an alt containing `]`/newline, or a
  markdown-title form) leaked raw `![...]` markdown — the inline text
  pipelines now convert any image ref to a `[figure: alt]` note (non-greedy
  alt so a `]` inside it is still caught); (P1) DOCX had no height clamp and
  trusted the PNG IHDR — now clamps both axes to one page and validates the
  IHDR tag + bounds; plus size caps, unique drawing ids, underscore emphasis,
  and a `\\\\`-UNC refusal. The co-scientist caption is sanitized (no
  `]`/newline reaches the image line) and the baked figure caption is dropped
  in favor of the renderer's wrapping caption (no duplicate). Version bumped
  0.1.12→0.1.13 deliberately: a gateway that already loaded 0.1.12 refuses a
  same-version re-publish (immutable by sha), so the fix would never reach
  it. Proven in BOTH formats (adversary attack harness + delivered reports):
  figures embedded in PDF (`get_images`) and DOCX (`a:blip` + `word/media`),
  python-docx opens both, zero raw `![`, secrets/traversal refused.
- 2026-07-20 `diagram-render@0.1.0` — NEW dedicated professional-figure
  workflow (operator directive; one adversarial fable5 reviewer, verdict
  "shippable after fixes", all P0/P1 + 5 of 6 P2 folded). A structured
  diagram SPEC (data — the LLM never authors code) renders to publication
  PNG + PDF via a FIXED matplotlib script executed through
  `execute_command`: `layered` (architecture columns of rounded boxes with
  labeled arrows, per-layer color coding) and `line` (trajectories, optional
  honest `y_min` anchor). Injection-proofed per the adversary's P0: basename
  AND out_dir AND python_bin are reduced to safe character sets before
  quoting (traversal segments stripped, shell-active characters rejected
  wholesale). Deterministic render gate: the tool's prose is never trusted —
  the stdout ok-marker AND a filtered `list_files` check must both pass or
  the workflow returns `rendered:false` + `#FALLBACK` (matplotlib missing,
  bad spec, crash: all degrade honestly, never fail the flow). Figures
  register as durable run artifacts. NaN/Infinity coerced to null in the
  sandbox JSON emitter; invalid specs surface their specific reason.

### Changed
- 2026-07-20 runtime document renderers (`abstractruntime/documents/pdf.py` +
  `docx.py`) — INLINE IMAGE EMBEDDING. Standalone markdown image lines
  (`![alt](reports/figures/x.png)`) now embed the local image where they
  appear — scaled to the text column with the alt text as an italic caption
  (PDF: reportlab `Image`; DOCX: a real `word/media/*` part + drawing XML).
  Before this, `![...](...)` printed as LITERAL markdown text in the PDF (the
  operator screenshotted it). The `write_pdf`/`write_docx` handlers pass the
  resolved workspace root as `base_dir`; the renderer refuses remote/`data:`
  URLs and any path escaping base_dir (resolve + `relative_to` containment),
  restricts to image extensions, and degrades to an italic `[figure: alt]`
  note on any miss — never raw markdown, never an exception. Coordinated with
  runtime (their `documents/` package; consumer-driven fix, offered for
  ratification).
- 2026-07-20 `co-scientist@0.1.12` — PROFESSIONAL FIGURES replace the ASCII
  art (operator: "didn't I ask you to create a workflow dedicated to create
  professional diagrams?"). The report now embeds the figures INLINE (relying
  on the runtime renderer change above) instead of the earlier pypdf
  appendix-page merge — the merge machinery (MERGE_SCRIPT / merge nodes /
  post-merge sha) is deleted, `pdf_sha256` is write_pdf's own hash again.
  The run timestamp is frozen once into a var (`co.ts`) before the figures
  render, so the figure basenames and the report filenames share the SAME
  timestamp — `system_datetime` is a volatile pure source, and reading it
  from both the figure chain and the write chain would otherwise diverge and
  break the embedded image path (found by the mandated adversary review). An LLM node designs a layered architecture spec
  from the run's top hypotheses (strict schema; clamped to ≤4 layers /
  ≤4 nodes each; dangling edges dropped); the Elo trajectory spec is fully
  deterministic (1200-anchored y-axis). Both render through the new
  `diagram-render` subflow; the markdown embeds the PNGs and the PDF export
  gains the figures as appendix pages (pypdf merge — the runtime PDF writer
  has no inline-image branch). Every failure path keeps the ASCII/text
  fallback with a `#FALLBACK` caveat. Adversary folds: `pdf_sha256` now
  reports the DELIVERED bytes (the merge script prints the post-merge hash;
  pre-merge hash shipped wrong on every figure run), figure basenames carry
  the run timestamp (fixed names collided across runs sharing a
  workspace_root), the md never promises appendix pages the merge hasn't
  made yet, and meta no longer emits ASCII-art architecture sketches.
  Live-verified end-to-end: 15-page merged PDF with both figures, unattended
  approvals. Probe fix: the gateway resume route is `POST
  /api/gateway/commands` (run_id in the body) — `/runs/{id}/command` never
  existed; earlier runs never noticed because web tools are safe-auto-
  approve and `execute_command` is this flow's first ask-approval tool.
  Build-time guard added to `wf_common.validate_edges`: a code-node data
  input with no edge and no pin default is now a build error (live incident:
  an unwired `exec_args.prep` made the render command empty and the tool
  "succeeded" doing nothing).
- 2026-07-19 `co-scientist@0.1.11` — the two-adversary before/after audit
  wave (operator-directed 1:1 comparison of the regenerated reports against
  the two baselines; both fable5 adversaries verdicted "genuinely better"
  and converged on the remaining defects, now fixed). DETERMINISTIC CITATION
  VERIFICATION: after grounding, a foreach loop re-fetches EVERY ledger URL
  (`call_tool fetch_url`; arXiv PDF urls normalized to abs pages) and
  token-checks the served `<title>` against the claimed title — arXiv strict
  (a wrong id shows zero overlap), other pages loose; MISMATCH/UNREACHABLE
  sources are barred from citation, labeled in Literature Sources, and
  `#FALLBACK`-warned. This kills the laundering P0 both adversaries ranked
  #1: the allowlist constrained the writer to the ledger, but the ledger
  itself carried model-asserted wrong title↔id pairs stamped `fetched: true`
  ("Concrete Problems in AI Safety" on the EfficientNet id, cited 8 times).
  Live first run: caught 2 real wrong-id pairings (DNC on an id serving
  "Range Majorities and Minorities in Arrays"; EvolveGCN on "GRET") — zero
  banned ids reached the prose. Ranking honesty: near-identical-title
  collapse (containment >= 0.75 — "HVGR" held ranks 2 AND 8 one qualifier
  apart) plus visible `sibling`/`de-crowded` flags with the criterion line
  explaining Elo non-monotonicity locally. Falsification hygiene: literal
  HYPOTHESIZED template tokens scrubbed from criteria (deterministic) +
  prompt FORM rules (same metric/direction as the expected effect, no
  unadjudicated gap, no vague thresholds). Evidence-verb honesty: pool
  hypotheses and non-ledger works may never take 'demonstrates/shows/
  reports' (a sibling untested hypothesis was cited as established fact).
  Meta number-fidelity: quoted scores must match the ranked data; rank-vs-
  Elo divergences explained at the mention site. Sandbox lesson pinned: code
  nodes have no `chr` builtin — the first launch failed live on it; all new
  bodies are now compile+exec-checked through the real RestrictedPython
  sandbox in the self-checks, not plain `exec`.
- 2026-07-19 `co-scientist@0.1.10` — degraded-path fixes from the live 0.1.9
  zero-source run (the run where deep-investigate ran 8 web searches but
  returned an EMPTY source_ledger, exercising the honest 0-source path
  end-to-end). Identical-title collapse in BOTH the fold and the final
  ranking: the cycle-2 report listed the same hypothesis title twice (ranks
  3/4 and 6/8) because an evolved copy re-entered under its parent's title
  with a reworded statement below the token-overlap threshold — final ranking
  now keeps only the best-ranked copy per normalized title (never cap-at-2
  for exact duplicates). Empty-allowlist citation BAN: with 0 fetched
  sources the prompts previously carried NO citation rule at all and the
  meta-review name-dropped venues from parametric memory ("TGAT (KDD 2020)"
  — wrong venue, TGAT was ICLR 2020); a zero-source run now explicitly bans
  naming any paper/venue/year/arXiv id/DOI in every generative prompt AND at
  meta level. Grounding reliability: MANDATORY-ledger-discipline + budget
  guidance ("stop gathering with 2 rounds to spare") threaded through
  deep-investigate's own `adversarial_review` input channel (two distinct
  live failure shapes: an empty source_ledger beside findings prose, and an
  empty forced final at max_iterations after the agent burned its whole
  budget on searches), plus a BOUNDED RETRY BRANCH in the graph — when the
  literature base sees 0 fetched sources it re-invokes deep-investigate once
  at effort=thorough (10 agent rounds vs 6) with the failed attempt as
  `prior_investigation`, and a deterministic picker keeps whichever attempt
  grounded with honest `#FALLBACK` provenance (state rides a `co.lit` var so
  the unexecuted branch is never dereferenced; `generate` is multi-entry).
  Elo trajectory figure is now anchored at the 1200 tournament start instead
  of min(best) — min-anchoring rendered cycle 1 as a single '#' and visually
  overstated the gain. Verification run (OVH gpt-oss-120b): 9 real fetched
  sources, every arXiv id/URL in the report resolves to the ledger (0
  fabricated), 8 distinct titles (0 duplicate pairs vs 3 in the 0.1.9 run),
  all report sections render, warnings empty. Backlog: `abstractflow-0147`.
- 2026-07-19 `co-scientist@0.1.9` — report quality/depth/fidelity wave vs the
  Nature 'AI co-scientist' paper (operator-directed; two fable5 adversaries +
  live A/B on OVH gpt-oss-120b, two cycles). Credibility (P0): the grounding
  gate now requires a resolvable `http(s)://` URL (a degenerate
  `internal_agent_output` "source" no longer passes as grounded → the
  `#FALLBACK` fires honestly), and a deterministic CITATION ALLOWLIST of the
  fetched sources is threaded into every generative prompt so the model cites
  only grounded literature and never invents arXiv ids / DOIs / vendor
  whitepapers (the fabricated Gato id, Boston-Dynamics/IBM/NVIDIA
  "whitepapers", wrong DNC id class). The meta-review prompt states what Elo
  IS (internal self-play tournament score, not peer review / community /
  citation impact) and bans attributing numeric results to cited works.
  Depth: hypotheses carry a STRUCTURED experimental protocol
  (design / metric / expected-effect / **falsification**) rendered
  Specific-Aims style, replacing the one-line "experiment" that was usually a
  restated title; the design field is prompted as the experimental SETUP
  (named baselines/ablations/dataset), not the mechanism name. Ranking: a
  NOVELTY floor + diversity de-crowding with a headline cluster-cap stop a
  self-declared non-novel idea from holding rank 1 and stop near-duplicate
  variants from monopolizing the top (cycle-1 crowded five routing variants).
  Hygiene: generative stages get a decoration-free pool view AND a fold-level
  SANITIZER belt strips `(Elo N)` / `[UNREVIEWED]` / `[UNEXPLORED]` /
  `[id]` / `hypothesis [k]` from every incoming field so no bookkeeping or
  internal pool id reaches the reader. Evolution rotates a distinct strategy
  per cycle (combination / simplification / out-of-box / grounding); the
  terminal review runs a deep-verification pass (decompose each finalist into
  assumptions, score by the weakest). Report gains a deterministic
  Methodology/provenance section, an ASCII Elo-evolution figure (the paper's
  self-improving-tournament result made visible), a stated ranking-criterion
  line, and a Limitations & threats-to-validity section. Live-verified: the
  hardened grounding, honest Elo framing, and falsifiable protocols all
  landed in the OVH gpt-oss-120b run; renderer image-embedding + hr/blockquote
  gaps raised with runtime (their `documents/` package). Backlog:
  `abstractflow-0147`.
- 2026-07-17 `coding-agent@0.2.0` — deterministic-gates redesign of the verify
  subflow (R-Type post-mortem, agora c2725/c2735/c2736; operator: "badly
  designed — do more research and improve it"). Root cause owned: the v1
  verifier PROMPT instructed "executes=true if the entrypoint loads" for web
  artifacts, so runtime crashes (split-brain ReferenceError, unscaled canvas)
  passed verification unexecuted. v2 inverts the design — execute where an
  executor exists, LLM-judge only where none does, gates ordered cheapest
  first (pay-per-failure): G0 DELIVERY (deterministic `call_tool list_files`
  ground truth: non-empty workspace, entrypoint exists), G1 INTEGRATION
  (deterministic entrypoint reference check: dangling `src`/`href` refs,
  split-brain orphan `.js` siblings when the entrypoint loads no local
  script), G3 EXECUTES-web (deterministic `call_tool browser_probe` — code's
  registered headless-Chromium tool, c2769; page/console errors and failed
  local resource loads fail the round with the exact error text before any
  LLM runs; a blank canvas blocks the pass on every round — round 0 gets
  draw-one-visible-element wording for the dark-background case, repeats get
  render-loop wording), then the LLM verifier for builds/matches only — its
  `executes` opinion is OVERRIDDEN by the probe's world-side result for web
  artifacts in a deterministic merge. Red-team hardening folded (fable5
  adversary): the G1 reference scan is markup-only (script/style bodies
  stripped so inline `img.src="x.png"` never counts), token-boundary-checked
  (`data-src=` is not `src=`), relative-with-extension-only (SPA routes and
  anchors stay quiet), and orphan flagging skips files mentioned anywhere in
  the entrypoint text (inline module imports) plus well-known non-browser
  siblings (server.js, *.config.js, tests); case-mismatched references are
  named as case mismatches. Builder allowlist gains `browser_probe` for
  mid-build self-verification (the memact arm's organic self-probe was the
  fastest honest arm of the R-Type experiment, c2790); the independent gate
  stays authoritative. External validation (code's cav2 A/B, c2945, probe
  mounted, n=2): 2/2 completed with integrated running code vs v1's 0.5/2 —
  strictly better — with the probe's ceiling honestly mapped (render-scale
  and progression-deadlock defects throw no errors and pass execution
  gates; playthrough assertions remain the operator's hands today). Fold
  from that series: the blank-canvas gate now demands a minimum non-blank
  FRACTION (≥2% of sampled pixels when the pass is real) — cav2/run1
  slipped the zero-check with a 1-of-369 corner-ninth render; genuinely
  sparse dark games clear the floor with one HUD element. Second fold
  (taxonomy class 4, code's c2958 ask 2): a deterministic G4
  ORPHAN-FUNCTION gate — a function declared in the delivered code whose
  identifier appears exactly once (the declaration) is dead code or a
  missing call, the `spawnBoss` progression-deadlock class that threw zero
  errors and froze the boss transition; conservative by construction (any
  second reference passes: calls, handler assignments, recursion, strings;
  declarations only), runs over entrypoint + main referenced script so
  cross-file calls resolve. Third fold (class 5's second half, on code's
  additive `painted_bbox` probe field, c2970): a draw-extent check fails
  renders confined to less than half the canvas in BOTH dimensions (the
  corner-ninth scale-bug class) while letterboxed games pass; older probes
  without the field degrade gracefully to the fraction floor. Failures now
  split fixable vs `environment_failures` (missing executor on host): the
  round loop stops early instead of burning repair rounds on failures the
  builder cannot fix, and the report renders them under an honest "Not
  verifiable in this environment" section. Builder prompts gain delivery
  rules (workspace-only paths, single-file-first for small web builds,
  every split file must be loaded by the entrypoint). Branch verdicts merge
  through a `vg.verdict` run var (single-writer per path; no multi-entry pin
  overrides). Scripted proof: `scripts/coding_agent_v2_gates_smoke.py`
  drives the real compiled flow through abstractruntime with stubbed tools
  (27 checks: fail-fast paths never invoke the verifier agent, fail-closed
  no-executor semantics, probe-overrides-LLM merge, early-stop loop).
  Library pins updated to `coding-agent@0.2.0` (flow + coder entrypoints).

### Added
- 2026-07-16 Meta-intelligence workflow family (operator ask: co-orchestrate
  multiple LLM calls into deliberation instead of answering directly, then
  measure whether it beats the isolated call). Six flows, each
  `abstractcode.agent.v1`-conformant so any of them benchmarks 1:1 against a
  single call: `meta-consensus` (2 independent answers — temperature-diverse
  or a second model via optional `provider_b`/`model_b` — reconciled, not
  averaged), `meta-debate` (propose → adversarial attack → concede-or-rebut),
  `meta-reflect` (draft → introspection interrogating the reasoning →
  revision), `meta-perspectives` (3 question-specific angles → integration
  naming the tensions), `meta-deliberate` (plan with pitfalls + checklist →
  execute → verify against the plan's own checklist), and `meta-baseline`
  (the isolated call as a flow — the control arm). Benchmark harnesses:
  `meta_benchmark.mjs` (verifiable trap items, committed-answer grading,
  token/latency cost), `meta_benchmark_open.mjs` (open questions,
  position-swapped blind pairwise judging). Adversarial review folded:
  every llm node pins `tools: []` as a declared default so a host-injected
  ambient `tools` key (abstractcode agent.v1 scaffold) can never leak native
  tool declarations into a deliberation stage (the content_type-leak class);
  perspectives' angle parsing type-guards schema-shaped-but-wrong structured
  output; `tools` declared on every start node for contract honesty; the
  generator documents that `success` is boilerplate on completed runs (llm
  failures terminate the run) and that the five factored patterns are
  deliberate (a composed flagship is future scope).

### Changed
- 2026-07-16 The `dp-` prefix is fully retired (operator ruling: "there should
  not be anymore dp-*, they should all have been renamed to deep-*"). The
  2026-07-13 pass had renamed display names only; this pass renames the ids,
  files, and every reference: flow ids + files (`deep-research`, `deep-plan`,
  `deep-investigate`, `deep-review`, `deep-render`), the bundle id
  (`deep-research@0.1.6`, version lineage continues from `dp-research@0.1.5`),
  the interface id (`abstractresearch.dp.v1` → `abstractresearch.deep.v1`),
  co-scientist's grounding subflow refs (repacked as `co-scientist@0.1.7`),
  internal run-var namespace (`dp.*` → `deep.*`), report output prefixes
  (`reports/deep-{quick,standard,thorough}-research`), the generator script
  (`build_deep_research_workflows.py`), docs (`docs/deep-research.md`), the
  bundled-flows glob + run targets, and the preview/test fixtures. Old
  `dp-research@0.1.x` bundles moved to `flows/bundles/archive/` (kept for
  completed-run history, no longer served); the gateway now lists only
  `deep-research`. Also fixed stale `bundleVersion` fields in the bundled run
  targets that had drifted behind their `bundleRef`s.

### Added
- 2026-07-16 coding-agent reports now name the produced artifacts by path
  (`coding-agent@0.1.3`, code seat ask after the operator's first live run:
  "no link / path to test it"). The independent verifier's schema gained a
  required `artifacts[]` field (workspace-relative paths it actually observed,
  entrypoint first — verifier-sourced, never the builder's self-report), and
  the final report renders an "Artifacts (paths relative to the run workspace
  root)" section plus an `artifacts` output field; when the verifier observed
  none, the report says so with a visible `#FALLBACK` label instead of staying
  silent. The report is self-sufficient on every host (assistant, gateway
  runs, headless exec) — no second agent needed to find the produced file.
- 2026-07-16 Report titles are now LLM-derived with an abstract (operator
  ruling: a fixed product title is not acceptable — "the LLM creating the
  report MUST think of a proper title and even provide a small abstract after
  repeating the user question"). co-scientist (`co-scientist@0.1.6`): the
  meta-review returns `TITLE:` (5-12 word headline derived from the findings,
  never the verbatim goal) and `ABSTRACT:` (4-6 sentence scientific abstract)
  lines; the report assembler extracts both and structures the document as
  derived title → **Research goal:** (the user's question) → **Abstract.** →
  overview; the PDF/DOCX document title uses the same derived title. A
  missing TITLE/ABSTRACT degrades to the product title with a visible
  `#FALLBACK` caveat, never silently. deep-research (`dp-research@0.1.5`):
  the report writer already derived a headline H1; it now also restates the
  research goal and writes a 3-5 sentence abstract immediately after the H1
  (dp-render.json + generator kept in sync — the generator previously lacked
  the title instruction entirely, a source-drift fix).
- 2026-07-15 Node palette reorganized for scanability (operator ask): an
  always-visible Essentials strip (the ~8 nodes nearly every flow uses: On
  Flow Start/End, Agent, LLM Call, Code, If/Else, For, String Template), ten
  ordered display sections that regroup the twelve semantic categories by
  build frequency (Core → Control Flow → Events & Time → Variables → Data &
  Text → Values & Schema → Files & Artifacts → Media → Memory → Math), a
  two-column chip grid (halves scroll height; tooltips/title carry full
  labels), per-section node-count badges, collapsed-by-default long tail with
  expansion persisted per user (localStorage), and keyboard-accessible
  section headers. NODE_CATEGORIES stays the semantic source of truth
  (sections are presentation only; a safety net appends any future category
  not claimed by a section so nodes can never silently vanish from the
  palette). Capability status pills compact to glyphs (…/✕) with the full
  reason in the tooltip.
- 2026-07-15 The authoring assistant is now loaded with the core product
  documentation (operator ask): `architecture.md`, `visualflow.md`,
  `getting-started.md`, `web-editor.md`, `faq.md`, and `dp-research.md` ride
  the stable (cacheable) system-prompt prefix as an "ABSTRACTFLOW
  DOCUMENTATION" block, imported raw from `docs/` so they can never drift from
  the shipped docs. The assistant's contract gained an EXPLAIN mode next to
  AUTHOR: for pure questions ("what is a subflow?", "how do runs work?") it
  answers in `reply` grounded in the documentation, marks the plan
  `intent:"explain"`, and OMITS `graph` entirely — an omitted document is a
  no-op in the turn processor, so explaining never touches the canvas (no
  mass-deletion risk). Explain turns end the loop directly instead of going
  through the graph acceptance review (which judges graphs against build
  requests and would reject a question as "not implemented"); `parsePlan`
  honors the label only on workless plans, so real edits can never ride the
  explain exit past review.
- 2026-07-15 co-scientist reports now always carry visual elements on the key
  hypotheses (operator ask). Deterministic: `REPORT_MD_CODE` builds a "Key
  hypotheses at a glance" pipe table (rank/Elo/correctness/novelty/
  testability/flags) from structured tournament data — guaranteed to render
  as a real table in the PDF/DOCX exports regardless of model compliance
  (cells sanitized: pipes, newlines, 80-char titles). Encouraged: the
  meta-review prompt now requires one comparison table on DESIGN dimensions
  (mechanism, improvement over literature, main risk, required evidence — not
  scores, to avoid duplicating the deterministic table) and at least one
  fenced ASCII schema of the top hypothesis architecture, and states that
  mermaid/HTML/images do not render in the exports. Bundle republished as
  `co-scientist@0.1.1` (catalog versions are sha-immutable; same-version
  rebuilds are refused).
- 2026-07-15 Branded report exports + honest titles (operator directive):
  every workflow-generated PDF/DOCX now carries a discreet professional
  identity — a small gray meta line under the title (workflow@version ·
  report date · AbstractFramework / AbstractFlow — abstractframework.ai), a
  thin rule, a running page footer (framework · url · workflow | page
  number), and honest document metadata (PDF author/creator/subject; DOCX
  core properties incl. created date). Renderer changes live in
  abstractruntime/documents (branding opt-in per renderer; the
  write_pdf/write_docx nodes brand BY DEFAULT with run provenance — the
  workflow id+version is injected by the compiler from the run itself, so
  all report flows get it with zero graph changes; `branding` pin overrides
  fields or disables). Title fixes: co-scientist's document title is the
  fixed product title ("AI Co-Scientist — Research Overview"), NEVER the
  user's prompt (the goal stays as the body's "Research goal:" line);
  deep-research's writer must now open with a derived headline-style report
  title, never the verbatim request. Renderers dedup a leading markdown H1
  identical to the document title (was printed twice). Bundles republished
  as `co-scientist@0.1.5` + `dp-research@0.1.4`; 15 runtime-side regression
  tests; end-to-end verified through a compiled visual-flow run (footer
  reads "AbstractFramework · abstractframework.ai · co-scientist@0.1.5").
- 2026-07-15 coding-agent gained a dual-interface entrypoint (code seat's
  evaluation for the operator: the workflow is stronger than basic-agent but
  was invisible to abstractcode's agent selector). New `coding-agent-chat`
  flow conforms to `abstractcode.agent.v1` exactly (prompt/provider/model/
  tools in; response/success/meta out), maps prompt→request, and deliberately
  omits workspace/build/run commands so the pipeline runs in the session
  workspace with inferred gates — the verifier executes what it can and the
  degradation is visible in report/open_failures, never silent. History
  honored: agent.v1 was REMOVED from the primary flow on 2026-07-14 as a
  false contract (adversary finding — selector runs stalled on missing gate
  pins); the wrapper is the honest fix, not a re-labeling. Bundle
  `coding-agent@0.1.1` (both entrypoints declared; validated against
  abstractcode's exact validator rules; live-verified served by the gateway).
  bundledFlows run targets trued to current versions. Same evening, the
  operator asked for a simpler executable name — the agent.v1 entrypoint was
  renamed `coding-agent-chat` → `coder` (code seat's option A: bundle and
  strict entrypoint names unchanged, zero references existed yet) and
  republished as `coding-agent@0.1.2`, live-verified.
- 2026-07-15 Artifact content-type fix (found by the 0.1.2 receipt run): all
  three imported report artifacts registered as DOCX — exec-chained nodes
  receive the previous node's output as their base payload, so the imports'
  unconnected `content_type` input INHERITED `write_docx`'s content_type
  output. Fix: explicit `content_type` pin defaults on every import node
  (declared input-pin defaults override same-named ambient payload keys —
  verified against the runtime's data-aware handler both statically in the
  packed bundles and dynamically in-process). `wf_common.
  import_workspace_file_node` now takes a `content_type` kwarg and its
  docstring names the leak class. Bundles republished as `co-scientist@0.1.3`
  and `dp-research@0.1.3`. The live probe also gained 429-retry resilience
  (the gateway's auth-lockout window killed a poller mid-run while the
  durable run completed fine — retry with backoff instead of dying).
  Live-verified on run e95efef7: three artifacts with honest content types,
  observer thread closed. Adversary P2 polish followed as `co-scientist@0.1.4`
  (meta-prompt explicitly allows additional tables beyond the required design
  comparison; table cells capped at 120 chars against layout-breaking junk
  values).
- 2026-07-15 Report files are now durable run artifacts (observer ask, operator
  directive "only what has been written durably through the runtime can
  surface"): co-scientist and deep-research chain `import_workspace_file`
  after their report writers, so the produced md/pdf/docx are registered in
  the run's artifact store — listable via `GET /runs/{id}/artifacts` with
  honest content_type/filename/size and servable to any client — instead of
  existing only as loose workspace files (verified root cause: the
  write_file/write_pdf/write_docx effects never touch the artifact store;
  only imports and media generation do). Artifact ids are exposed as
  `md_artifact_id`/`pdf_artifact_id`/`docx_artifact_id` flow outputs. Bundles
  republished as `co-scientist@0.1.2` and `dp-research@0.1.2`;
  `wf_common.import_workspace_file_node` added for generated flows. Backlog
  item `2026-07-15_coscientist_reports_as_durable_artifacts.md` claimed on
  agora.
- 2026-07-15 Run totals in the execution view (operator ask): a terminal run's
  Execution header now shows aggregate stats — total wall-clock time and total
  input→output tokens — summed across the WHOLE run tree (agent workflows spend
  their tokens in sub-runs, so the root alone reads zero; agent nodes are
  excluded from the token sum to avoid double-counting their own sub-run llm
  steps). Shown whenever the root `flow_complete` carried no rolled-up meta
  (the common case). Also surfaced on the Final Result header.

### Changed
- 2026-07-14 co-scientist rebuilt into a deep, production-grade hypothesis
  engine (operator: "co-scientist can not be faster than deep-research… it
  normally has much more steps, orchestrations and iterations"). The prior
  version was a shallow tool-free single pass that finished faster than the
  deep-research report — the opposite of the paper. Rebuilt around three
  adversary-driven waves (three fable5 reviews: paper-fidelity gap analysis,
  head-to-head comparison audit, production mechanics audit):
  - **Starts from the literature via composition, driven correctly.** Grounding
    is delegated to `dp-plan` → `dp-investigate` (deep-research's own research
    planner + web-search investigation engine); the bundle embeds both. The
    plan is load-bearing: driving `dp-investigate` BARE (no plan) made the
    agent search real papers but then collapse its structured `source_ledger`
    to a single junk entry — deep-research always feeds it a plan, and once
    co-scientist does too, grounding reliably populates (verified live: 14/14
    fetched real-URL sources, zero fallback, vs 1 junk entry bare). URL-level
    fidelity is still model-dependent (gpt-oss-120b can fabricate an arXiv id
    in the ledger — the same limitation deep-research has), but the ledger no
    longer structurally collapses.
  - **Full report exported as .md / .pdf / .docx** (operator ask): co-scientist
    previously returned its research overview only as a JSON field — it now
    assembles the paper's research-overview deliverable (meta-review overview +
    ranked hypotheses with statement/rationale/experiment/review-scores/flags +
    literature source ledger + honesty caveats) and writes all three formats
    to `reports/co-scientist-research-<ts>.{md,pdf,docx}`, exposing
    `md_path`/`pdf_path`/`docx_path` + sha256s as flow outputs — the same
    `write_file`/`write_pdf`/`write_docx` export surface deep-research uses.
    The meta-review prompt enforces human-readable Markdown prose (no JSON
    dump). Live-verified: three real, valid files (PDF 13 pages, DOCX Word
    2007+), prose overview across 7 sections.
  - **Genuinely deep loop**: Generation (grounded) → supervisor cycles of
    Reflection → Elo tournament (prioritized pairwise scientific debate) →
    Evolution (refine) → research-Expansion (divergent new directions), with
    per-cycle meta-feedback threaded into the next cycle's prompts and
    near-duplicate pruning, then a terminal search-grounded full review of the
    finalists, then a Meta-review overview. ~17 LLM calls + 2 agent subruns;
    live runs take ~13 min (grounding alone ~8 min) vs the shallow 3 min —
    deliberately deeper than a single-pass report, within the 30-min budget.
  - **Structural quality/safety guards (not prompt-deep)**: a correctness-floor
    gate demotes unsound (reviewed correctness < 5) and unreviewed hypotheses
    below sound ones so the tournament can no longer crown a bold-but-unsound
    idea (the shallow run's Elo anti-correlated with correctness at ρ=−0.886);
    a safety gate demotes + flags any `safety_ok=false` hypothesis below all
    safe ones; both surface `#FALLBACK` warnings on a new `warnings` output.
  - **Honest grounding signal**: a `grounding_ok` check requires ≥1 genuinely
    fetched source with a real URL (grounding on gpt-oss-120b is
    nondeterministic — one run fetched 12 real sources, another fetched 0); a
    degenerate/empty grounding is labeled `#FALLBACK` instead of silently
    presenting parametric guesses as literature-grounded.
  - **Bugs fixed (adversary-found)**: source-ledger field mismatch (read
    `url_or_path`/`evidence_quality`/`relevance`, not `url`/`takeaway`, so
    URLs are no longer dropped); evolution refinements were being deduped away
    every cycle (evolved now dedups at 0.85 vs expanded at 0.6, so genuine
    refinements survive); no-fabricated-numbers prompt guards on
    generation/evolution/meta (targets phrased as hypothesized, never
    "reported"/"demonstrated"). Docstring rewritten to disclose the real
    simplifications (fixed synchronous supervisor, 2-of-6 reflection
    strategies, dedup-only Proximity, end-only deep search).

- 2026-07-14 Unified top-bar + chip adoption (uic kit): the header's
  assistant/appearance/connect controls moved out of the Toolbar into the
  kit's `AfTopBarActions` cluster (enforced order: assistant → appearance →
  extras → Disconnect pill rightmost; three-state connection phase so the
  boot probe shows "Connecting…" instead of flashing "Connect" over a live
  session; the flag-gated monitor-gpu widget rides `extraActions`). The
  local `AppearanceModal` is deleted — appearance is the kit's
  `AfAppearanceDialog` + `useAppearanceSettings('abstractflow', ...)`, which
  owns persistence (`af_appearance_abstractflow_v1`, one-time migration from
  the legacy `abstractflow_ui_settings_v1` key) and applies theme +
  typography synchronously on first load (no default-theme flash). Flow
  Library badge pills migrated from flow-local spans to kit
  `AfChip`/`AfChipButton` (operator AA approval c1652): the kit owns tones,
  geometry, and the AA text-derivation recipe; flow keeps only its
  name→tone map (current/runnable=success, family/bundled=info,
  shared/recursive/cycle=warning, missing=error) — ~80 lines of local badge
  and connection-pill CSS deleted. Verified headless in both themes
  (`scripts/topbar_verify.mjs` asserts cluster order + pill states, and the
  library preview re-shot) plus a signed-in live-app check (no page
  errors; cluster renders with correct order and Disconnect pill).

### Added
- 2026-07-14 Five framework workflows (operator ask): two runnable flagships
  and three composable primitives, all authored as generator scripts
  (`scripts/build_*_workflow.py` + `scripts/wf_common.py`), packed as gateway
  bundles, registered in the editor's bundled catalog + interface registry,
  and live-verified against the real gateway.
  - `co-scientist` (Nature 'AI co-scientist' replica, arXiv:2502.18864): a
    supervisor loop over Generation → Reflection → Ranking (Elo tournament via
    simulated pairwise debate) → Evolution, feeding the tournament state
    forward, then a Meta-review synthesis. Live run produced 5 hypotheses with
    differentiated Elo (1231/1220/1220/1199/1168 — the tournament moved scores
    off the 1200 seed) and a coherent research overview. Fidelity note in the
    generator docstring (synchronous supervisor loop, one debate pass/cycle,
    grounding opt-in) — no false claims.
  - `coding-agent`: builder agent + independent build/execute/match
    verification (its own `coding-verify-gates` subflow) with
    specific-failure reprompting; the reprompt loop is deterministically
    proven and the gates run via execute_command/analyze_code.
  - `adversarial-review`: three-lens critics → severity-ranked pass/revise/
    block verdict (composable subflow).
  - `structured-extract`: text → schema-validated JSON with a validate→
    reprompt loop. Live run extracted a correct object on attempt 1.
  - `map-reduce`: per-item LLM map + synthesis reduce. Live run mapped 3
    items and synthesized correctly (loop accumulator verified).
  - Registered `abstractcode.coding.v1`, `abstractresearch.coscientist.v1`,
    and the three composable-primitive interfaces in `flowFamilies.ts`.
  - Root-caused + fixed a shared loop bug found while proving these live: a
    `code` node's while-condition must wire the boolean SUB-KEY handle
    (`cond.condition`), not `.output` (the whole dict is always truthy →
    infinite loop). Fixed in all three loop workflows; `wf_common.validate_edges`
    now allows code-node dict-key handles (the dp-research idiom). Also:
    code-node bodies are import-free (RestrictedPython sandbox forbids
    imports — AST-verified for all 28 bodies), and the two flagships declare
    only their own entrypoint interfaces (dropped a false
    `abstractcode.agent.v1` whose pin contract they do not satisfy).
  - Post-audit reconciliation (4 adversarial reviews): generators verified
    idempotent against the shipped JSONs (regeneration produces a zero diff —
    the mid-review generator/artifact divergence the audits flagged was the
    fix wave landing while they read); the five bundles are now allowlisted
    in `abstractgateway/.gitignore` (previously gitignored → dangling run
    targets on a fresh clone); the coding-agent generator gained the same
    edge-validation + real-compiler self-check as the other four (a broken
    graph now fails the build, not a live run); and the co-scientist
    fidelity note now names what is NOT replicated (Meta-review feedback
    propagation into next-iteration prompts, Proximity/dedup agent,
    default-on literature grounding) instead of claiming a "faithful
    replica" — the flow description and interface-registry description were
    rewritten to match.

- 2026-07-14 The authoring assistant can CREATE and UPDATE helper workflows
  (subflows) in the same conversation (operator directive: "creation of
  subflows as well, to keep things clean when needed"). The graph document
  gains a top-level `subflows` array — each definition ({ref, flow_name,
  description, nodes, edges}) rides the SAME validated document lane as the
  open canvas (diff → commands → apply → serialize) and is saved through the
  gateway; the main document references it as `subflow_ref: "ref:<handle>"`
  and the editor substitutes the real minted id. Semantics: create/update
  only (omission never deletes a saved workflow — the document owns the open
  flow, not the library); updates are conversation-scoped (the durable
  ref→id map); name collisions with existing library flows are refused at
  birth; nested handle definitions are refused (deep nesting composes across
  cycles); at most 5 definitions per emission; missing on_flow_start is an
  error, missing on_flow_end a warning; created workflows join AVAILABLE
  WORKFLOWS on the next cycle; Undo Turn deletes exactly the helpers the
  undone turn created. New module `src/utils/subflowAuthoring.ts` (+16
  regression tests); prompt + `docs/workflow-authoring-skill.md` teach the
  grammar and when-to-decompose guidance. Adversary follow-ups folded:
  undo publishes the snapshot and the birth list TOGETHER in the turn's
  `finally` (an exception between creation and turn end can no longer orphan
  helpers or pair them with a stale canvas snapshot; a created-only turn
  unwinds births without touching the canvas), creation-only cycles count as
  progress (never stall as "empty"), a per-turn creation cap (10) backs the
  per-emission budget (5), and the skill doc's own `subflows` example is
  extracted and applied end to end by a fidelity test
  (`subflowAuthoringSkillExample.test.ts`). Live-verified: a real authoring
  turn created `text-shouter` in the store (proper description, start/end
  contract) and wired the main canvas through a subflow node with patched
  pins (`scripts/subflow_authoring_drive.mjs`).

### Fixed
- 2026-07-13 Cancel-while-running/waiting now works visibly (operator report:
  "I can't cancel an ongoing workflow"). Root cause: the gateway `cancel`
  command is durable/async (the runner applies it up to seconds later under
  load) but `cancelRun` fetched the run summary once immediately after the
  POST — it raced the runner, read back `waiting`, and re-painted the stale
  WAITING view with no further signal. Fix: `useWebSocket.cancelRun` marks the
  run cancel-pending (suppresses stale waiting re-paints in
  `applyRunSummary`) and polls the summary to a terminal state; the run modal
  shows an optimistic "Cancelling…" button; cancelled runs now label as
  CANCELLED (subtitle, final-result header) instead of FAILED, including
  inspected runs via `runSummary.status`. Verified live end to end with a
  headless drive (`scripts/cancel_repro.mjs`: ask_user probe flow → Cancel
  while WAITING → UI CANCELLED + backend `cancelled`).
- 2026-07-13 Cancel adversary follow-up (fable5 audit of the cancel fix):
  a refused or timed-out cancel now re-enables the button and raises a
  visible toast instead of leaving a dead disabled "Cancelling…" with an
  error nobody rendered (A1); waiting re-paints from the ledger STREAM are
  suppressed during a pending cancel, not only summary re-paints (A2); the
  waiting response form (Continue/choices/Send) and Pause are gated while a
  cancel is pending so an answer cannot race the durable cancel (A3); the
  CANCELLED label keys on the explicit `cancelled` flag only — matching
  `error === 'Cancelled'` could mislabel a genuinely failed parent whose
  error text was propagated from a cancelled child (A5). Repo plumbing from
  the same audit: `dp-research@0.1.1.flow` added to the gateway bundle
  allowlist (it was gitignored — fresh clones would have missed the pinned
  run target) and `llms-full.txt` regenerated.
- 2026-07-13 Artifact previews survive transient gateway load (operator
  screenshot: "Failed to fetch" on a generated-voice artifact while the
  gateway was saturated by the TTS model — the artifact itself was verified
  intact and servable). The artifact object-URL/text hooks now run one
  bounded automatic retry pass (1.5s) and every artifact error card gains a
  Retry button; a single dropped fetch no longer paints a permanent dead
  error card.

- 2026-07-13 Production-readiness wave (operator directive; one fable5
  code+logic adversary — 3 P1 + 9 P2 findings — plus a live headless-chrome
  drive of :3000 against :8080):
  - Round-trip truncation asymmetry (P1): the diff now compares the CLAMPED
    current side for labels/switch case values/pin descriptions, so faithful
    re-emissions of long canvas content compile zero commands instead of
    silently clobbering runtime values down to the normalizer limits; node
    ids are never truncated (documents with >120-char or duplicate ids are
    refused loudly).
  - `set_break_paths`/`set_switch_cases` now revalidate the node's attached
    edges and drop invalidated ones loudly (a retyped break path kept its
    incompatible edge silently; a renamed switch case orphaned exec edges).
  - Steer strip honesty (P1): `parked` derives from the wait/pause state
    (the live lane never clears isRunning on waits, so parked was never
    true); `key={rootRunId}` resets draft text and queued status across run
    switches.
  - Terminal events (`flow_complete`/`flow_error`/`flow_cancelled`) carry
    the same root-run guard node events had — one failed subrun record can
    no longer flip the whole UI terminal and kill root highlights.
  - Library: stale instance selections revalidate against visible rows
    (collapse no longer blanks the ring and teleports arrow-nav); Uses/Used-by
    links reveal the target's ancestor path before selecting it.
  - Draft tests: the interactive-wait flag tracks the current poll (an early
    answered question no longer converts a later timeout into
    needs_interactive_input); flow outputs match `on_flow_end` by node type,
    not an `/end/i` id substring; the run-tree walk labels its 24-run cap
    with #TRUNCATION; `update_pin` no-ops report as warnings, and
    non-canonical doc pin types ("text") no longer emit phantom updates.
  - Library header shows "Loading saved flows…" while bundled rows render
    ahead of the gateway query (live-drive finding: "7 flows" flashed on a
    120-flow library).
  - New evidence tooling: `scripts/production_drive.mjs` +
    `scripts/production_drive_run.mjs` (headless-chrome operator-path drive:
    real sign-in, real library, bundled basic-agent load, live no-LLM run).

### Changed
- 2026-07-13 Deep-research rename + dedup (operator directive): the `dp-*`
  workflow family now displays as `deep-research`,
  `deep-research-{plan,investigate,review,render}`. Ids and wiring stay
  `dp-*`; the rename lives in the generator
  (`scripts/build_dp_research_workflows.py`) and regenerated
  `examples/flows/dp-*.json`. Bundle republished as `dp-research@0.1.1`
  (versions are immutable by sha; 0.1.0 artifact restored byte-identical) and
  the editor run target now points at 0.1.1. The two stale June-28 saved
  snapshots of dp-research (`e31bd652`, `ec83cf80`) were deleted from the
  live store — the library now shows exactly one deep-research family.

### Added
- 2026-07-13 uic kit consumption (operator-directed absorb wave, commons
  c1236/c1239):
  - Run modal gains a SteerComposer strip (kit component) under the live
    steps list — speak to a RUNNING/WAITING run; truth is "Queued (seq N)"
    with delivery visible as the `abstract.steer_seen` ledger record; parked
    runs say guidance lands at next wake (steers do not wake runs).
  - Flow Library rows now render through the kit `DisclosureList` (the
    absorb-then-delete swap: the fork this component paid for — dual-key
    selection, path-keyed expansion, flat-with-depth rows — came back as the
    kit contract). Flow keeps its derivation/cycle/interface logic and the
    premium row styling via kit structural classes; the modal's window-level
    keyboard nav yields to the kit tree when focus is inside it.
  - Badge pills deliberately stay flow-local (NOT AfChip yet): uic's c1116
    flag (a) — the kit AA text recipe visibly changes operator-approved
    pixels on muted themes — awaits the operator's explicit ack.
- 2026-07-12 Flow Library premium pass (operator screenshot review round 2):
  - basic-agent (81795ea9) and its ac-update-status helper (15f19f7f) join
    the bundled catalog with a `basic-agent@0.0.1` run target — the
    framework default agent was invisible in the library (and the Runnable
    view) because only `dp-*` was globbed into `bundledFlows.ts`.
  - Badge rail fade fixed: the fade zone is reserved with padding so badges
    that FIT no longer fade at the right border; only true overflow slides
    under the mask (operator report on the `bundle`/`bundled` pills).
  - Same-name disambiguation: when several flows share a name (saved
    iteration copies of dp-research), rows show a muted short-id hint and
    lookup context lines dedupe parent names ("in dp-research", not
    "in dp-research, dp-research").
  - Visual refinement toward a calmer, premium read: rows are quiet list
    lines (transparent rest state, soft hover fill, single accent hairline +
    tint when selected — the border+ring double stroke is gone), badges are
    hue-tinted pills, segmented All/Runnable control with a raised active
    thumb, pill search field with softened focus ring, uppercase micro-label
    keys in the preview panel, hairline-separated action bar, themed thin
    scrollbars, larger modal (1020px/76vh).
  - Expanding a family near the bottom of the list now scrolls the parent to
    the top so the unfolded children are actually visible.
  - `scripts/library_preview_shot.mjs`: puppeteer-core screenshot suite over
    the library preview harness (6 states, dark+light) — chrome headless CLI
    on macOS hangs against IPv6-only vite binds; the script pins
    `127.0.0.1` and waits for the harness ready flag.
- 2026-07-12 Flow Library family grouping + executable view (operator
  green-light on backlog 0144; built with headless-render iteration and two
  fable5 adversaries; uic recruited via the hub for the kit halves):
  - Families are DERIVED from the subflow reference graph
    (`src/utils/flowFamilies.ts`): first-level = normalized non-empty
    `interfaces` OR zero external inbound; self-references never bury a flow
    (`recursive` badge); interface-less cycles promote whole (`cycle` badge —
    invariant: no flow is ever unreachable); dangling refs render as
    error-toned `missing` child rows (the publish-time 400 surfaced at
    authoring time). Shared helpers render under EVERY parent with a
    `shared ×N` badge — rows are views, the preview is the entity.
  - All/Executable view toggle: executable = declares an ENTRYPOINT-class
    interface (local class facet on the known-interfaces list — today
    `abstractcode.agent.v1`; the gateway-served registry is the planned
    retirement path). The All view keeps every flow searchable.
  - Search flattens (lookup mode) and matches descriptions; helper hits
    carry an "in <parents>" context subtitle; clearing the query reveals the
    selection by expanding its first parent.
  - Preview panel gains a Family section (Uses / Used by with jump links);
    Delete warns naming the parents it would break; Duplicate notes that
    shared subflows are referenced, not copied; the false "editor will
    auto-add the required pins" interface hint (a lost 0.3.0 feature) now
    states honestly that pins must be wired on the canvas.
  - Keyboard nav over VISIBLE rows (Up/Down/Right-expand/Left-collapse-or-
    parent/Enter-load); library CSS tokenized (white-alpha literals removed;
    light themes verified by screenshot).
  - Dev harness `library-preview.html` + `src/preview/libraryPreview.tsx`
    renders the modal with the dp- family + pathological fixtures for
    chrome-headless iteration (`?view/q/expand/select/theme` params).
  - Corpus annotation: every example flow now carries a description
    (capability-level, derived from each graph); `recursive-answer`
    (60a97e4d) now declares `abstractcode.agent.v1` (its boundary satisfies
    the full contract — the nine other candidates missing success/meta pins
    were deliberately NOT declared). basic-agent bundles repacked via the
    sync-audited script after its source description landed.
  - Post-build adversarial fold (two fable5 reviewers, correctness + visual):
    instance-keyed selection (a shared helper's N rows anchor keyboard nav
    and the ring on the CLICKED instance; other copies get a quiet dashed
    same-flow mark), cycle leaves excluded from keyboard nav (id-aliasing
    trapped ArrowDown), nested-helper reveal expands the full ancestor path,
    stale selection re-inits when the runnable toggle filters it out,
    Escape cancels an open editor without closing the modal, interface saves
    compare as sets (uncheck+recheck no longer fires a spurious PUT),
    delete-confirm disarms on close, collapsed parents surface a
    "N missing" badge, node/edge count pills left the list (preview keeps
    them), the runnable badge drops its ▶ and hides in the Runnable view,
    tree rail + chip chevron make hierarchy pre-attentive, and every
    remaining hardcoded color in the library CSS moved to theme tokens
    (verified by light/latte screenshots). Derivation verified against all
    147 corpus flows (9-parent shared helper, diamond, 7 self-refs,
    dangling refs — zero unreachable flows).
- 2026-07-12 authoring-assistant overhaul (operator directive: better
  visuals/realtime information/user-facing messages + complex-workflow
  capability, composition, and a build→test loop; designs from five
  adversarial audits):
  - Workflow COMPOSITION (stage 1): `subflow_ref` is now authorable in the
    workflow document — the diff resolves it against the saved-workflow
    list (unknown refs refused with the available ids; name-shaped refs
    redirected to the id; self-references and reference cycles refused
    naming the manual Properties-panel recursion path) and compiles to a
    new `set_subflow` command that patches the node's pins from the child's
    boundary via the existing `subflowPinPatchForSelectedFlow` machinery.
    The serializer emits a read-only `subflow_interface` context block so
    the model can wire edges correctly, and the prompt carries an
    AVAILABLE WORKFLOWS section. New skill-doc section
    "Composing Workflows (Subflow)". The catalog is a PICK-TIME contract
    surface (follow-up, same day): per saved workflow it lists id, name,
    purpose (flow description), and the boundary contract — inputs with
    types/required-or-default/pin descriptions, and outputs — derived
    client-side from the full graphs the visualflows collection already
    returns (`workflowContractSummary`); the same fetch now seeds the
    subflow graph cache, so cycle detection covers the whole library and
    `set_subflow` pin patching needs no second fetch. The current flow is
    listed but marked non-referenceable.
  - Mass-deletion guard: a document omitting more than max(3, 20%) of
    existing nodes is refused whole (truncation-shaped emission) with a
    `confirm_deletions` repair path — deliberate teardowns stay
    expressible, accidental graph wipes cannot happen.
  - Dynamic-pin upgrades: same-id type changes compile to a new
    `update_pin` command (in-place retype; incompatible edges dropped with
    named warnings — the previously documented-but-unimplementable repair),
    and pins round-trip `description` + `schema` (e.g. array-of-file
    boundary inputs).
  - Draft TEST loop (stage 1): a consented "Test run" card in the drawer —
    entry-pin input form (required detection from pin defaults), draft
    publish + isolated-session run (`assistant-test:<workflow>` session,
    `draft_test`/ephemeral lifecycle), live tool-approval and ask-user
    surfacing with Approve/Deny/reply (subworkflow waits followed to the
    owning descendant run), wall-clock watchdog with cancel, and a
    structured verdict report (failed steps with node labels + verbatim
    errors + `#TRUNCATION`-labeled input previews). The report feeds the
    NEXT planning turn as a `LAST TEST RUN` prompt section (consume-once),
    closing the build→test→fix loop. Mechanics in
    `src/utils/draftTestRun.ts` (+ tests).
  - General structural readiness floor (all workflows, each check
    satisfiable by wiring or omitting): unreachable execution nodes (the
    runtime silently drops them), loop nodes without a body / while without
    a condition, subflow nodes without a referenced workflow (previously an
    opaque publish-time 400), On Flow End with declared-but-unwired data
    pins, on_schedule without a schedule.

### Changed
- 2026-07-12 assistant message contract (the maintainer's complaint:
  "dumping the list of changes is not really useful"): turn messages are
  OUTCOME-FIRST — model-authored headline (≤12 words), capability-level
  "What changed" bullets (new `changes_summary` plan field; fallback is a
  one-line verb-bucket summary, never a per-command dump), "Check next"
  steps, every aggregated warning rendered VERBATIM as a ⚠ caveat line
  (never "N notes recorded" — includes #FALLBACK review-skips and stall
  explanations), an explicit verification line when the acceptance review
  passed, and a stats footer (changes · cycles · duration · tokens).
  Process narration (How It Works / How To Test / What To Expect / Workflow
  Plan + short repair/readiness forms) folds into one collapsed "Turn
  report" details block. needs_user renders question-first with neutral
  (not error) styling; cycle-cap exhaustion is a PAUSED message with
  continue/raise-cap guidance, not a failure; failures are three lines
  (what/why/try) with full forensics moved to the activity payload
  inspector. Welcome message rewritten user-first.
- 2026-07-12 assistant visual system: drawer header with flow name + state
  pill (idle/running/waiting/done/failed — needs_user/stall/interrupt wear
  warning, never error); stage chips (PLANNING=info/APPLYING=warning/
  CHECKING=success); "Cycle N/MAX" header with a cycle-budget progress
  track; live model-declared plan strip (steps + next, no invented
  checkmarks); activity feed with glyph marks (shape+color, never color
  alone), a new 'notice' kind for routine self-corrections (amber, not
  red), sticky cycle headers, 32vh height while running, and a
  scroll-trap-free payload inspector; theme-token message surfaces (the
  white-alpha bubbles were invisible on all 6 light themes) with turn
  separators carrying outcome stats; user messages render literal (never
  parsed as markdown); Monaco code colorize follows the app theme
  (light themes get 'vs'); reduced-motion gates on spinner/pulse.
  Component extraction: the 3.6k-line drawer split into
  `src/components/assistant/` (status card, message list, composer, test
  card, messages/activity/settings modules).
- 2026-07-12 runtime contract note: the visual `llm_call` executor dropped
  provider+model from the effect when only one resolved (the taught
  model-pool pattern silently ran on gateway defaults). Runtime fixed it
  same-turn (forward-independently, abstractruntime `5578779`); preflight's
  pairing rule now cites the runtime pin file
  (`tests/test_visual_llm_call_partial_override.py`).

### Fixed
- 2026-07-12 post-implementation adversarial round (fixes shipped with the
  wave; full findings in backlog 0143): branch-aware reachability for the
  unreachable-node readiness check (loop/if/switch/sequence bodies are
  reachable — an exec-out-only walk flagged every non-linear workflow);
  second-approval surfacing + honest `needs_interactive_input` watchdog
  verdicts in the test loop; ask_user prompts read from the wait's real
  top-level field; nested-redacted pin defaults no longer break the
  document round-trip; in-flight test approvals stay reachable during
  authoring turns and Clear Chat stops/clears the test state;
  needs_user-with-changes keeps the model's question; break_object same-id
  retype re-emits; test reports walk the full run tree; follow-live
  autoscroll wired to the activity log (scroll up to read without yanking,
  Follow ↓ re-arms).
- 2026-07-11 basic-agent sync + ruled iteration defaults (maintainer ruling,
  agora commons c726: "the workflow decides" — a bundle pinDefault is
  authoritative design; source and shipped bundle must be in sync at
  max_iterations=20; any agent max_iterations DEFAULT is 20, not 50):
  - `examples/flows/81795ea9.json`: on_flow_start pinDefaults
    max_iterations 5 -> 20, reverting an accidental drift introduced by an
    unrelated 2026-01-30 commit (`2658f45`). The source (with its newer
    memory pin) is authoritative; both shipped bundle artifacts
    (`abstractgateway/flows/bundles/basic-agent.flow` and
    `basic-agent@0.0.1.flow`) were repacked from it — byte-identical flow
    payloads, `abstractcode.agent.v1` interface intact.
  - Agent max_iterations editor defaults 50 -> 20: template seed
    (`src/types/nodes.ts`), legacy-flow backfill (`src/utils/serialization.ts`
    — which now also skips edge-connected pins: writing a dead default
    churned saved bytes and desynced packed bundles from source for zero
    runtime behavior), pin-disclosure display map
    (`src/utils/nodePinDisclosure.ts`). Deep-research guidance
    (`AuthoringAssistantDrawer`, `docs/architecture.md`,
    `docs/workflow-authoring-skill.md`) now presents `max_iterations >= 50`
    as the recipe's explicit workflow choice, never "the default".
    Generated docs (`docs/workflow-node-catalog.md`, `llms-full.txt`)
    regenerated. Regression pins in
    `src/utils/agentIterationDefaults.test.ts` (seed=20, backfill=20,
    explicit values preserved at any number, no backfill when the pin is
    edge-connected).

### Added
- 2026-07-11 `scripts/build_basic_agent_bundle.py` (pack | check): rebuilds
  the shipped basic-agent bundles from `examples/flows/` and audits
  source/shipped SYNC — byte-identity per flow file, manifest flow-set
  completeness (checked against a temp pack through the real packer, so a
  tampered manifest dropping a reachable subflow fails), loadability through
  `open_workflow_bundle`, interface declaration, and the ruled
  max_iterations pin. Publish-time refusal replaces commit archaeology for
  the January drift class.
- 2026-07-11 run-modal visual pass ("quiet card, loud state"): a visible
  aesthetic upgrade of the run experience, theme-safe across all 16 themes.
  - Launch view: the Workflow Parameters card leads with an accent-tinted
    header, a sliders glyph, and an input-count chip; collapsed
    infrastructure cards (File System Access, prompt caches) calm down
    (secondary title color, hover reveal) and their text `+`/`-` affordance
    is replaced by a rotating border-drawn chevron; card order is now
    Parameters -> File System Access -> caches; inputs get an 8px radius,
    hover border, and an accent focus glow; the "no parameters" note became
    an intentional empty state (dashed panel + play glyph); the Run/New Run
    buttons became a gradient accent CTA with a play icon and press motion.
  - Execution view: step status is now a pill vocabulary with a leading
    state dot — running=info (was warning, which collided with WAITING),
    waiting=warning, OK=success, failed=error; the spinner runs on
    currentColor so it is visible on light themes; step rows show the full
    node label (status/duration moved right, timestamp chip into the meta
    row) and get accent-tinted selection + motion-timed hovers (the old
    white-alpha hover/selected states were invisible on light themes);
    metric badges (duration/tokens/throughput/provider/model/tool/...)
    rebuilt on theme hues via color-mix (the old pale hardcoded text was
    unreadable on light themes); think/act/observe agent stage pills are
    tinted per stage (info/warning/success) via a `data-stage` attribute in
    monitor-flow's AgentCyclesPanel; the tool-approval panel gained a
    warning frame + pulsing dot (reduced-motion aware); JSON syntax colors,
    code blocks, markdown blocks, generated-artifact plates, warning/failure
    panels, and the JSON-viewer sticky toolbar all moved from hardcoded
    dark-only rgba to theme tokens; the dark titlebar/minibar hardcode their
    own light text (theme text tokens went near-black on light themes there)
    and the `▶` text glyph became a stroke play icon.
  - New screenshot harness `scripts/runmodal_check.html` +
    `runmodal_check_main.tsx` + `runmodal_check_shot.mjs` renders the real
    RunFlowModal (launch + synthetic execution timeline) in any theme for
    visual verification without a gateway.
- 2026-07-11 general review wave, group 1 (authoring) top picks implemented
  (backlog `planned/0111`-`0113`; the full seven-agent adversarial review is
  recorded as backlog items 0111-0141):
  - Run-modal send-event composer (0111): event parks now offer a "Send
    event" composer — event key parsed from the wait (`evt:` scheme via
    `src/utils/eventComposer.ts`, unit-tested), JSON payload editor with
    validation, optional `durable` mailbox delivery, posting the existing
    gateway `emit_event` command. Received events became visible: an event
    park's resume now surfaces the full waking envelope as the step result
    (`ledgerEvents.ts` event-reason passthrough, tested); user-wait resumes
    keep the narrow visibility rule. Copy-key affordance on park cards.
  - Authoring assistant transport overhaul (0112, adversarial-review
    corrected): the stable ~21k-token context (skill, catalog, tools) is
    byte-identical across cycles (tested) and rides the SYSTEM message —
    the runtime prepends a volatile grounding envelope to every user
    prompt, so only system content can form a wire-stable prefix for
    provider caches (the review caught the user-prompt placement as a
    cache-defeating claim). Planner cycles and acceptance reviews now run
    SESSIONLESS instead of on the shared durable session: this ends the
    quadratic in-turn replay cost AND avoids minting one persistent
    session-memory owner run per cycle server-side (review finding). The
    per-workflow session id remains the conversation identity; Clear Chat
    semantics unchanged. One labeled, non-blocking cumulative-usage note
    past 500k tokens/turn (checked after planner AND review usage); the
    context meter is labeled as a client estimate. Language anchoring
    stays at the request site (adjacency asserted by test — the
    2026-06-10 A/B proved block position irrelevant).
  - Catalog parity + Files taxonomy (0113): `llm_call` and `agent` templates
    now declare the `max_output_tokens` pin the runtime already honors
    (advanced disclosure, tested); `wait_event.until/details` fold as
    advanced pins; the nine file/artifact IO nodes moved from the "Memory"
    palette category to a new "Files" category (files and memory are
    distinct concepts); node catalog + llms-full regenerated.
- 2026-07-11 general review wave, group 2 (design/UX) top picks implemented
  (backlog `planned/0114`-`0116`):
  - Design token integrity (0114): `--accent-primary`, `--accent-secondary`,
    and `--border-color` — referenced ~20 times but never defined, silently
    collapsing hover/warning states — are now defined at the app layer over
    ui-kit tokens; drifted success/error fallback literals reconciled to the
    theme values; a global `:focus-visible` ring (`--focus-ring`) makes
    keyboard focus visible on every control; the base button hover calmed to
    a subtle overlay (brand accent reserved for `.primary` variants — no
    more red-flashing Copy buttons); infinite executing/dash/blink
    animations gated behind `prefers-reduced-motion`. A token-integrity test
    (`src/utils/cssTokens.test.ts`) resolves every no-fallback `var()`
    reference against app CSS + ui-kit theme + TSX-set properties so
    undefined tokens can never ship silently again.
  - Run-modal live inspection + failure forensics (0115): live runs no
    longer steal the selected step — auto-follow disarms on any manual
    selection and a "Follow live" pill re-arms it (scroll-into-view on
    follow); the failure panel jump expands collapsed ancestors and scrolls
    to the step; "+N more failures" expands; failed steps render the
    failing effect's input payload beside the error (from trace records);
    ask_user resumes pass the wait's `runId`+`waitKey` so resuming from an
    inspected (post-reload) run works instead of silently dead-ending;
    follow-up messages are injected into the same prompt-like key the prior
    run used (`src/utils/followUpInputs.ts`, shared by extraction and
    injection, tested) instead of a hardcoded `prompt` key that silently
    re-ran the old task on task/query-keyed flows.
  - Universal artifact previewer (0116): PDFs preview inline (iframe on the
    blob URL) with separate Open/Download actions instead of a forced
    download; text artifacts render inline (markdown through the markdown
    renderer) with a labeled `#TRUNCATION` clamp at 200k chars; images zoom
    in a dependency-free lightbox (Escape/click-out closes); multi-image
    outputs render every image as a thumbnail gallery with per-image
    selection (previously only the first image showed); markdown links open
    in a new tab (`rel="noopener noreferrer"`) so rendered answers stop
    ejecting users from the SPA; preview-kind resolution is a tested pure
    helper (`src/utils/artifactPreview.ts`) honoring content type over
    extension, with extensions speaking only for information-free types.
- Honest rendering for event-wait parks in the run modal (visit seam-spec
  0013 client half). Event waits (`reason=event`) no longer invent a
  "Please respond:" question: plain parks render as
  "Parked — waiting for events on `<wait_key>`" with no input affordance,
  while waits marked `details.kind="visitor_message"` render a chat-style
  composer ("Waiting for your message." + Send) that resumes with
  `{text: …}` — the payload key the shipped visit workflow's ROUTE node
  reads (`abstractruntime/identity/visit_workflow.py`). Deadline-bearing
  waits (`until` beside `wait_key`, the runtime's WAIT_EVENT idle timeout)
  show the idle deadline with relative time. The ledger mapper
  (`src/utils/ledgerEvents.ts`) now passes `until` through, and new
  contract tests (`src/utils/ledgerEvents.test.ts`) pin the wait
  passthrough plus the node-anchored record ruling (records without
  `run_id`+`node_id` are dropped by contract, per the 0013 clarifications
  addendum).
- `Wait Event` node: optional `until` and `details` input pins (D3
  follow-through, paired with the runtime's compiler passthrough). `until`
  gives a visual park a durable idle deadline (ISO timestamp, runtime
  normalizes to UTC; a passed deadline resumes with `{"timed_out": true}`
  in `event_data`); `details` rides the ledger wait record so clients can
  render the park honestly (e.g. `{"kind": "visitor_message"}` renders the
  message composer). Pin ids match the runtime effect payload spelling
  exactly so no mapping layer exists to drift. Node catalog + llms docs
  regenerated.
- Act-only act-frame chips (`src/utils/actOnlyRefs.ts` + run modal): step
  outputs carrying `$act_only` typed refs (diary-class tools under the G1
  privacy rule — "the book's words never rest outside the book") render as
  chips showing the ACT (tool, entry id, one-line gist, reason) with an
  explicit note that content stays in the entity's book. Recognition is
  parse-based on the frozen ref shape (lone `$act_only` top-level key,
  exact JSON), never regex; Flow never resolves refs (rendering is a pure
  read). Pinned by `src/utils/actOnlyRefs.test.ts`.
- Added `examples/flows/event-inbox-react-agent.json`: a resident ReAct agent
  (LLM + while loop + code drain, no Agent node) driven by an open event
  channel instead of any specific hub. It declares an `events_mailbox` run
  var, parks durably on `wait_event` (`evt:global:global:<mailbox>`) when
  idle, and drains its `events_inbox` run var with a `seq` cursor at every
  cycle boundary — so events posted by anyone via the gateway `emit_event`
  command (`durable: true`) interleave into the very next loop cycle, even
  mid-burst. `{kind: "stop"}` ends the resident; burst budgets flush with a
  labeled `#FALLBACK` report. Generalizes the agora example (agora becomes
  one producer). See `docs/guide/event-inbox-agent.md` at the repo root;
  scripted tests in
  `abstractruntime/tests/test_visualflow_event_inbox_react_agent.py`.
- Added `examples/flows/agora-react-agent.json`: a hand-built ReAct agent
  (`llm_call` + `while` loop + `tool_calls`, no Agent node) that participates
  in an agora agent-to-agent hub. It bootstraps its inbox deterministically
  (`call_tool: agora_check_inbox`), puts the hub's priority envelopes
  (critical / blocked / open+escalated / to_me / reply_to_me) in front of the
  model every cycle, replies where an answer is owed (`status=reply` +
  `reply_to`), acks handled cursors, and ends with a plain-text report.
  Requires the runtime's env-gated `agora` toolset (`AGORA_API_KEY`); see
  `docs/guide/agora-workflow-agent.md` at the repo root and the scripted test
  `abstractruntime/tests/test_visualflow_agora_react_agent.py`.
- Added the `dp-` production research workflow family sources under
  `examples/flows/dp-*.json`, plus a generator script that packs
  `dp-research@0.1.0.flow` for Gateway. The root graph uses an enforced
  `For(max_review_rounds)` investigate/review loop and timestamped exports.
- Added first-class `Write DOCX` authoring metadata so workflows can export
  Markdown/report content through Runtime's native DOCX node.

## [0.3.19] - 2026-06-14

### Changed
- Media node authoring now surfaces Gateway/Core vision route features directly in the Properties drawer: `Generate Image`, `Edit Image`, `Generate Video`, and `Image To Video` expose task-filtered provider/model discovery, batch controls (`count`, `seeds`), ordered `lora_adapters` stacks, and plural media outputs (`image_artifacts`, `video_artifacts`) for compatible routes. Legacy node normalization now rebuilds media input pins from the shared node templates so reopened/imported flows retain the newer vision fields instead of dropping them.
- Workflow Authoring Assistant switched from incremental command-batch negotiation to direct document authoring: the model now emits the complete workflow as one JSON document (`flow_name`, `nodes`, `edges`) every cycle, and the editor diffs it against the current graph (`src/utils/flowAuthoringDocument.ts`) and compiles the diff into the existing validated command machinery, so all validators, canonicalization (exec fan-out, loop-back removal, route overrides), and security guards remain the single source of truth. Nodes, edges, and dynamic pins omitted from the document are deleted — removal is implicit, and the assistant can no longer ask the user to "remove manually". `pin_defaults` merge per key, node ids are stable identities (type changes require a new id), existing node positions never move, new nodes get execution-depth auto-layout, and secrets round-trip as a `<redacted>` sentinel the diff never writes back. An idempotent re-emit compiles to zero changes, so unchanged documents are correctly detected as stalls. The first cycle aims to one-shot the workflow; later cycles only repair validator errors, readiness issues, and acceptance findings.
- Workflow Authoring Assistant prompt is leaner per cycle (~86k chars / ~21k tokens baseline, down from ~151k chars) with **zero semantic loss** (ADR-0026): the node catalog renders one line per template (`type [template] (category) in[...] out[...] dyn[...] cfg[...] cap:... :: description`) keeping every full node description, pin label, and pin description intact — only repeated headings and command-JSON scaffolding were removed. `docs/workflow-authoring-skill.md` was rewritten for document authoring (the obsolete 17-command schema is gone because it would contradict document mode; ownership semantics, dynamic-pin lists, and repair guidance replace it). A catalog-fidelity test asserts no template or pin description is ever dropped or sliced from the prompt; there is no prompt size budget and no imposed output token budget on planner runs.
- Workflow Authoring Assistant now reports token usage in token terms end to end: every outgoing planner request is logged with an explicit estimated size (`Sending plan request (~21k tokens est. (86k chars) — authoring the full workflow document)`), and after each planner response, `result.usage` is summed across the Gateway run-tree ledgers (root run and subruns, tolerant of `input/output_tokens` and `prompt/completion_tokens` field families) and logged as `Response received (41.2k in / 1.1k out tokens · 12k chars · 1:59)`; cumulative turn totals appear in the status card footer. Usage collection is best-effort observability and never blocks the loop; estimates are labeled `est.` and never used for budgeting decisions.
- Workflow Authoring Assistant requests and responses are now inspectable: `Sending plan request`, `Response received`, and acceptance-review activity entries carry an expandable "Inspect payload" section with the exact system prompt + user prompt sent (or the raw model response) and a one-click copy. Payloads are session-only (persisted activity keeps the entry text but drops the attached payload to protect the localStorage quota).
- Workflow Authoring Assistant live status: the card header now carries the cycle number (`Cycle 3 · Planning workflow graph`), and a shimmering in-flight ticker pinned at the bottom of the activity feed shows what the assistant is waiting on right now — including the request purpose ("authoring the full workflow document", "repairing 2 validation issues", "acceptance review") and the estimated tokens sent — with a per-stage elapsed counter that ticks every second (static under `prefers-reduced-motion`).
- Canvas maximum zoom-out increased from 13 to 17 zoom steps (min zoom ≈ 0.09, roughly 2x more dezoom) so large authored workflows fit on screen.
- `docs/workflow-node-catalog.md` generation now documents the authoring document format (document node snippets, `template` variant selection, document config fields) instead of `add_node` command JSON.

### Added
- Added a `remove_pin` authoring command (the document-ownership counterpart of `add_input_pin`/`add_output_pin`): dynamic, non-execution pins omitted from an emitted document pin list are removed together with their edges; template-owned pins are refused.
- Added a toolbar Execution View toggle that condenses the canvas to the control-flow skeleton: only nodes linked by execution edges (and those edges) stay visible, rendered as compact cards with per-family color, shape, and iconography (events, control flow, user interaction, generative AI, generated media, tools & files, memory, subflow, logic & state). Node positions are preserved so switching between views keeps the same layout.
- Added a `Ctrl/⌘+S` keyboard shortcut that saves the current flow and suppresses the browser "Save page" dialog inside the editor.
- Added a leave-page confirmation (`beforeunload`) when the flow has unsaved changes or a save is still in flight, preventing silent loss of graph edits.
- Added a node palette search empty state ("No nodes match …" with a Clear search action) instead of a blank list when a search has no results.
- Added a first-use empty-canvas hint that explains dragging nodes from the palette and disappears once the flow has nodes.
- Added first-class `Read PDF` and `Write PDF` VisualFlow nodes so workflows can extract PDF text/metadata and render report content to real PDF files through Runtime.
- Added a first-class Restore / Upscale Image media node backed by Gateway's `upscaled_image` contract and `image_upscale` vision catalog task.
- Added a right-drawer Workflow Authoring Assistant that reads `docs/workflow-authoring-skill.md` plus a complete generated node catalog, drafts edits through Gateway's default `output.text` model unless a model is pinned, applies only validated graph commands, and fails closed without draft changes when Gateway/model/JSON/command validation fails.
- Added capability-route filtering for text model discovery, including reusable `output.text` defaults and Models Catalog support for input/output-shaped routes such as `input.image,output.text`.
- Added reasoning/thinking controls for Agent and LLM Call nodes, with Gateway/Core-backed model capability lookup and inline/right-panel selectors for supported reasoning models.
- Added Vitest coverage for node pin disclosure behavior, including compact media nodes, default-value handling, and generated-video defaults.
- Added inline JSON Schema editing for unconnected schema input pins, including a Builder tab for fields and Choice/enum values plus an expert JSON Schema tab.
- Added switch-friendly structured-output authoring: enum-backed response fields can be discovered through Parse JSON / Break Object and synced into explicit Switch cases.

### Added
- The Workflow Authoring Assistant input row now has a max-cycles dropdown next to Send (10/20/40/60/80 autonomous planning cycles per turn, default 40, persisted across sessions). The cap is captured when a turn starts; changing it mid-turn applies from the next turn.

### Fixed
- The provider/model preflight rule for LLM Call and Agent nodes no longer produces unsatisfiable demands. The old rule ("Set both provider and model, or leave both blank for Gateway defaults") fired when the model pin was wired dynamically (e.g. a model pool feeding `llm_call.model` through a loop item) with provider on Gateway defaults — a valid runtime configuration the rule made impossible to satisfy without deleting a needed wire. It also read only the effect config, so typed pin defaults could never clear it. The rule now skips pairs where either pin is connected, reads pin defaults, and the remaining half-typed-default message names the current values (`Provider is "openai" but model is blank — …`) so users and the authoring model can see what to fix. This single false positive cost an authoring run 10 wasted cycles (~15 minutes) before failing the turn.
- Authoring loop stall guard: a cycle whose applied batch is identical to the previous one and leaves identical readiness issues counts as repetition, not progress. The first repeat sends the model a corrective note; the second stops the turn as "needs your input" with the remaining issues instead of grinding the full cycle budget. Rewriting an identical pin default is also now a warning no-op instead of counting as an applied change.
- Authoring applied-change logs now include the written value (`Set llm.provider = "openai"` instead of `Set llm.provider`), so users can see which provider/model/value the assistant actually chose.
- The authoring assistant now enforces its language contract at the boundary instead of trusting the model. A full ledger audit proved the planner model can reply in another language (English reasoning, French reply) with a 100% single-language 157k-char context at temperature 0 — and a replay of the exact same payload returned English, demonstrating serving-layer non-determinism no prompt can prevent. Every cycle's user-visible plan text is now language-checked against the user request (conservative stopword/script detector that abstains on ambiguity); mismatches trigger a bounded retry with a LANGUAGE CORRECTION note (2 per turn, live-validated to rewrite the same plan in the request language), then accept with a `#FALLBACK` activity note. The response schema also requires a leading `language` field as a decoding anchor.
- Switching to the Properties tab (or collapsing the right drawer) no longer wipes the Workflow Authoring Assistant: the drawer now stays mounted once opened (it renders nothing while hidden), so the in-flight autonomous authoring loop, conversation, plan, and activity feed all survive tab switches. Previously the tab switch unmounted the component, destroying the running turn and all in-memory state.
- The authoring status card (plan + activity feed + collapse state) is now persisted per workflow alongside the conversation: it survives page reloads and workflow switches, follows a draft promoted to a saved flow, and is only removed by Clear Chat. A turn that was in flight when the page reloaded is restored as "Interrupted (editor reloaded)" instead of pretending to still run; switching workflows now loads that workflow's own activity feed instead of leaking the previous one.

### Changed
- Workflow Authoring Assistant `connect` now mirrors the canvas connection semantics: connecting a different valid source to an occupied single-entry data input replaces the existing edge (the re-drag gesture), an exact duplicate connect is a no-op warning, and on multi-entry nodes (2+ incoming execution paths) connecting a data pin from a direct execution predecessor adds a per-path route override instead of replacing the base edge. A new `disconnect` command removes an edge by endpoints without replacing it, and "already connected" rejections now name the existing source so the planner can rewire instead of looping. When replacement is blocked by an invalid new edge (e.g. type mismatch), the underlying reason is reported instead of a misleading "already connected".
- Workflow Authoring Assistant planner runs now pin `temperature: 0` so structured command batches are deterministic instead of inheriting the Gateway agent default (0.7), which produced run-to-run language and command variance.
- Workflow Authoring Assistant session policy is now explicit: one durable Gateway session per workflow conversation (scoped to the workflow storage key, never shared across workflows), carried over when a draft is promoted to a saved flow, and rotated by Clear Chat so gateway-side agent memory restarts together with the visible conversation.
- Workflow Authoring Assistant prompt now anchors the language directive at the request site ("write … in the language of THIS request") and marks the replayed conversation as historical context that does not control the language. The gateway agent replays durable session memory into the model context, so without the anchored directive an English request kept producing French workflows when the session/conversation history was French.
- Workflow Authoring Assistant no longer hard-fails a turn when the planner returns `continue` with zero commands ("Gateway assistant returned no graph commands" discarded otherwise-progressing builds): command-less cycles get a corrective note for up to two consecutive cycles, then the turn ends as a "needs your input" message carrying the model's own reply so the user can guide the next turn.
- Workflow Authoring Assistant system prompt and skill now require all user-visible workflow content (flow name, node labels, prompts, replies) to match the language of the user request; the prompt's example label was also de-localized (an English request previously produced a French workflow because the only label example in the prompt was French).
- Workflow Authoring Assistant is now encouraged to ask follow-up questions mid-loop: the prompt/skill instruct the model to return `needs_user` with concrete questions when the request is ambiguous or repair cycles stop progressing, and `needs_user` replies render under an explicit "The assistant needs your input to continue" header.
- Research-scaffold readiness checks (Agent node, sources/citations, audit trace) now apply only when the request's deliverable is researched content (deep research, internet/web research, news, digest, jobs, or "research" coupled to a workflow/report deliverable in the same sentence). An incidental mention of "research" — e.g. "genuine discussion, research, and deepening of ideas" — previously forced 8 unfixable readiness issues onto a multi-LLM discussion workflow and stalled the loop.
- Workflow Authoring Assistant activity feed now groups entries under per-cycle divider rows, making iteration boundaries visible; the status card header gained a leading chevron with hover affordance (clear collapse signal) and a copy button that exports the activity feed (grouped by cycle with elapsed timestamps) to the clipboard.
- Workflow Authoring Assistant command batches are no longer atomic: commands are applied per-command in dependency order (nodes, then configuration, then connections), valid commands are kept even when others fail, and failed commands return to the planner as "skipped commands" feedback. Atomic rejection previously discarded whole batches, so the planner kept referencing nodes that never existed ("Source or target node not found" cascades across repair cycles).
- Workflow Authoring Assistant validator now auto-repairs execution fan-out: connecting an already-connected execution output inserts (or extends) a Sequence node and reports the rewiring as a warning instead of rejecting the edge ("Execution output pin already connected" was a recurring repair-loop trap).
- Workflow Authoring Assistant validator now drops loop-back edges from a loop body to the loop's `exec-in` (with a warning): AbstractRuntime control frames return to the loop automatically when the body chain ends, and an explicit loop-back resets the iteration counter. The authoring skill and system prompt now document these loop/control-frame semantics.
- Workflow Authoring Assistant working state is now a live activity feed (per-cycle plan request/response sizes, plan status and command counts, applied changes with labels, skipped/rejected commands, readiness and acceptance review events) with a spinner, elapsed timer, and cycle label, replacing the two static progress bars that conveyed no real-time information.
- Workflow Authoring Assistant turns can now be interrupted: a Stop control (in the status card and in place of Send while busy) aborts the autonomous loop between calls, best-effort cancels the in-flight Gateway planner run, and reports an explicit "Interrupted" message; applied edits stay in the draft and remain undoable via Undo Turn.
- Workflow Authoring Assistant drawer actions are now compact high-contrast icon buttons (copy, clear, undo at 19px/2px stroke in full text color) on the bottom row next to Send/Stop; the dedicated topbar action row is gone and the top of the drawer only shows the context-usage line while a request is being typed or running. Drawer chrome uses theme variables (`color-mix` on theme tokens) instead of hardcoded dark-biased rgba values so light themes render correctly.
- Workflow Authoring Assistant activity card is now collapsible (header toggles the log) and persists after the turn ends with a final state (green dot "Draft graph updated", red dot "Authoring failed"/"Interrupted by user") so the per-cycle history can be reviewed post-turn; Clear resets it.
- Fixed a loop-exit bug where an accepted `done` (including a passed acceptance review) was re-labeled "Autonomous authoring reached N cycles after validator rejections" because a stale rejected-batch marker from an earlier cycle survived the successful break; cap-exhaustion errors now apply only when the loop genuinely runs out of cycles.
- Workflow Authoring Assistant completion is now model-owned: the autonomous loop keeps cycling while the planner returns `continue` instead of force-stopping as soon as heuristic readiness checks pass (which previously cut the model off mid-build on requests outside the research/PDF/Markdown keyword heuristics, e.g. non-English multi-AI discussion workflows).
- Workflow Authoring Assistant now runs an acceptance review before accepting `done`: the planner declares per-request acceptance criteria, and a second model pass compares the draft graph against the original request; unmet findings are fed back into the loop as issues, and any findings left when the review budget is exhausted are reported with the result instead of being hidden.
- Workflow Authoring Assistant now preserves the planner's own plan memory: applied cycles carry one-line next-step notes into later cycles, and assistant turns are replayed across user turns as trimmed plan/result summaries (`#TRUNCATION`-labeled) so pending plan items are no longer forgotten between turns.
- Workflow authoring skill now documents iterative multi-participant discussion (loop + state) and multi-model fan-out patterns, and the system prompt explicitly forbids collapsing requested multi-participant/multi-model/iteration structure into a single Agent prompt simulation.
- Redesigned the editor toolbar: consistent stroke SVG icons replace mixed emoji/glyphs, actions are organized into segmented groups (file, import/export, run + history, gateway publish/lifecycle/models, workspace tools), Run is a labeled primary button with a running spinner, and the Connect/Disconnect button shows a live connection status dot.
- Execution View compact nodes now reuse the full-view node header (same per-node header color, uppercase title, and sheen) over a dark node body, so node identity carries across both modes while family icon and silhouette cues remain; the full-view header gained the same subtle sheen for harmony.
- Replaced the Execution View toolbar glyph (three dots on a line, easily read as a plain line) with a clearer node-to-node arrow icon, and toggle buttons now use accent-tinted pressed styling that works in all themes.
- Toolbar buttons now use fast AfTooltip hints (with disabled-state explanations and the save shortcut) instead of slow native `title` tooltips; `AfTooltip` gained a `minWidthPx` override for compact hints.
- Model residency and media provider/model selectors now include the `image_upscale` task for Gateway/Core upscaler discovery and explicit load/unload steps.
- Workflow Authoring Assistant PDF readiness now requires an executable `Write PDF` node and exposed PDF path instead of accepting Code or generic Write File workarounds.
- Compact node rendering now uses a shared pin disclosure policy so nodes show required, connected, or explicitly configured pins by default and hide optional/default/diagnostic pins behind a chevron.
- Workflow Authoring Assistant now shows prompt size plus Gateway-discovered model context/output limits and includes a Clear Chat control instead of trimming conversation history.
- Workflow Authoring Assistant now persists drawer chat/draft/session state across close/reopen and uses the authoring skill instead of generic `llms-full.txt` context for graph construction.
- Improved canvas rendering with clearer node cards, stronger edge readability, state-aware MiniMap node styling, and a pannable/zoomable preview.
- Restyled the MiniMap collapse/expand control as an icon button and moved React Flow attribution away from the preview while removing its grey backing.
- Restyled the schema-pin editor modal with clearer titles, validation, and editable Choice chips while keeping saved data as standard JSON Schema.

### Fixed
- Pin type compatibility now lets the dynamic `any` type connect to nominal provider/model pins: ForEach `item`, Get Variable `value`, Code outputs, and Parse JSON results are all `any`, so the documented multi-model pattern `loop.item -> llm_call.model` (and reading a model-typed variable) was unconstructible for both the authoring assistant and canvas users. Execution pins and non-`any` payload types (e.g. `string -> model`) keep their nominal guards.
- Authoring commands can now configure Variable nodes (`var_decl`/`bool_var`), which have no input pins: `set_pin_default` on pin `name`/`value` maps onto the declaration config, and `set_literal` accepts the canonical `{name, type, default}` object (or a bare value as the default), keeping the value output pin type in sync with the declared type. Previously these commands were refused ("unknown input pin 'name' on var_transcript") with no supported alternative.
- Connection and pin-default rejections now list the real pins so authors can self-correct: "Output pin 'end' not found (available outputs: loop, done, i, index)" and "unknown input pin 'instructions' on llm (available input pins: ...)" instead of dead-end messages.
- `add_node` without a descriptive label now records a non-blocking validator note (event nodes excepted), and the authoring prompt/skill instruct the model to label every node with its role in the user's language, so generated workflows stop shipping walls of "Variable"/"Array" default labels.
- Workflow Authoring Assistant plan parsing is now tolerant of model formatting: plan and acceptance-review JSON is extracted from markdown fences and prose-wrapped responses via a string-aware balanced-brace scan, instead of requiring the raw response to be bare JSON. Strict parsing previously made a fenced or prose-prefixed answer look like a missing response and killed the turn as "completed without an authoring response in its run tree ledger".
- Workflow Authoring Assistant no longer aborts the whole turn on one unusable planner response: an empty run output or unparseable/truncated plan JSON now retries the same cycle (up to 3 unusable responses per turn) with a corrective format note asking for bare JSON and smaller command batches, and the retry is logged in the activity feed. Previously a single bad cycle-2 response discarded an otherwise progressing turn, leaving nodes without edges.
- Theme support: the theme selector dropdown (and other AfSelect popovers) no longer hardcodes dark panel colors that broke light themes — app-level overrides were removed in favor of the ui-kit's theme-aware styles, with node-scoped colors kept for inline pin selects inside the intentionally dark node frames.
- Theme support: toolbar group chrome, toggle states, the offline connection dot, and the empty-canvas hint now derive from theme variables instead of white-alpha/hardcoded darks, so they stay visible in light themes.
- Theme support: the edge underlay now follows the canvas background color per theme, removing the chain-link edge artifacts that appeared on light themes.
- Workflow Authoring Assistant requests now keep full prior turns inside the current prompt instead of sending assistant-led chat history to OpenAI-compatible endpoints, avoiding LM Studio/Qwen prompt-template failures without imposing a local model-context cap.
- Model selectors now request provider models with the appropriate capability route so discovery stays aligned with Gateway/Core model capability metadata.
- Optional single-pin disclosures no longer collapse unnecessarily, and thinking pins stay hidden for models without detected thinking support unless already configured.
- Schema Builder mode no longer drops JSON Schema `enum` values when switching between Builder and JSON Schema editing.

## [0.3.18] - 2026-06-03

### Changed
- Reorganized AbstractFlow as the web editor package `@abstractframework/flow` at the repository root.
- Moved sample VisualFlow JSON files from `web/flows/` to `examples/flows/`.
- Rewrote current docs around the web package, Gateway connection flow, and Gateway/Runtime ownership boundaries.

### Removed
- Removed the Python package, Python packaging metadata, Python tests, FastAPI compatibility backend, generated Python docs site, and local runtime artifacts from the AbstractFlow repository.

## [0.3.17] - 2026-05-31

### Added
- Hosted Flow sessions can sign in with Gateway URL, user id, and token. Flow validates that the token resolves to the requested Gateway user, exchanges it for an opaque Gateway browser session, and stores only that session id in an HTTP-only browser-session cookie; the `/api/gateway/*` proxy resolves that request session before any server-wide Gateway token so different browsers can connect as different Gateway principals.
- Flow provider/model discovery now includes Gateway provider endpoint profiles as virtual providers, including OpenAI-compatible endpoints configured in the Gateway Console.

### Changed
- Remote browser connection updates may provide a token for the server-configured Gateway URL without mutating Flow server environment state. Remote browsers still cannot change the Gateway URL unless `ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1` is enabled.
- Apple/GPU Flow profiles now require Gateway `>=0.2.23` and Agent `>=0.3.10`.

### Fixed
- Flow's Gateway proxy now strips browser-supplied `Authorization`, `Cookie`, forwarded, and other unapproved request headers before proxying, then injects only the resolved opaque Gateway browser session and CSRF token where required.

## [0.3.16] - 2026-05-29

### Added
- Artifact input selection in the Run modal, including Gateway-backed search/filtering for reusable text, document, image, video, voice, audio, and music artifacts.
- Artifact search/import/export contract support in the Gateway client layer, while keeping file read/write behavior as graph-level nodes rather than modal-only actions.
- Staged Deep Research demo workflow for authoring demonstrations.

### Changed
- Media nodes now surface the critical sampling controls (`steps`, `seed`, and `guidance`) consistently for image and video generation/editing, with model defaults used when fields are left empty.
- Run progress rendering now includes elapsed/estimated remaining time when Gateway progress events provide enough timing data.
- The Run modal now uses a window-style top bar and only shows lifecycle actions that match the current run state.
- Apple/GPU Flow profiles now require Gateway `>=0.2.21` and Agent `>=0.3.9`; hosted CI/release tests install the base Gateway package because HTTP/SSE is part of the light install.

### Fixed
- Media provider selectors now keep image/video provider defaults scoped to media providers instead of showing text-only providers.
- Canvas interactions avoid stale pointer-capture state after trackpad/mouse release events.
- Generated media cards no longer expose a modal-level export button; artifact-to-file workflows should use graph nodes.

## [0.3.15] - 2026-05-26

### Added
- Native Generate Video and Image-to-Video authoring in the Flow editor, including scoped video provider/model pins, Gateway readiness checks, run preflight, artifact previews, and Runtime compatibility execution.
- Gateway `abstract.progress` ledger events now render as running-step progress in the Run modal.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.20` for the video media, progress, catalog, and model-residency contracts.
- Model residency and default routing now use task-scoped Gateway vision catalogs for `text_to_video` and `image_to_video` instead of reusing image defaults.
- Hosted CI/release tests now install the host-neutral Gateway HTTP stack instead of macOS-only Apple extras on Ubuntu runners.

## [0.3.14] - 2026-05-26

### Added
- Gateway-aware palette, preflight, live connection feedback, run lifecycle, workflow bundle, variable-name, and media artifact helpers for the thin-client editor.
- Validated code-editor execution policy and prompt-free variable selector improvements.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.19` and Agent `>=0.3.8`; Runtime/Core are still consumed through Gateway extras.
- Media defaults and advanced media pin disclosure now use one editor surface backed by Gateway discovery.

### Fixed
- Repaired code node, pin, media artifact, and run UI regressions around resumed runs, validated variables, and modality-specific source selection.

## [0.3.13] - 2026-05-22

### Added
- Native Generate Music authoring against the released Runtime/Gateway media contract, including Gateway music catalog selectors, music residency targeting, and advanced music controls.
- Image edit/image-to-image node templates and controls aligned with Gateway's generated media contracts.
- Gateway catalog v1 helpers that prefer canonical `items` envelopes while retaining legacy catalog fallbacks.
- Artifact reference primitives for text, image, voice, music, and video references in the palette.
- Artifact literal editor and built-in artifact content previews (image/audio/video) backed by Gateway artifact content endpoints.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.18`; Runtime/Core are consumed through Gateway extras instead of direct Flow dependencies.
- Generated media readiness honors Gateway's `common.readiness` surface summary when available while remaining compatible with legacy direct endpoint descriptors.
- Gateway proxy/model residency operations now allow long media and warmup requests without the previous short frontend/backend timeout path.

### Fixed
- Removed browser-side Generate Music lowering. Old lowered flows are normalized back to native `generate_music` when loaded or saved.
- Python VisualFlow models now accept the new native media node types without importing Runtime/Core at package import time.
- Warm/unload authoring is Gateway-only, allows Gateway default provider/model selection, and no longer disables all media residency controls from stale per-task support flags.
- Music provider/model changes clear stale backend overrides so Stable Audio 3 and Stable Audio Open do not inherit the wrong backend.
- Media previews are modality-aware and can fetch child-run/projected artifacts without using the wrong run id.
- Run preflight now catches missing media prompts and required source artifacts before starting a run.

## [0.3.12] - 2026-05-19

### Fixed
- Generate Image, Generate Voice, Transcribe Audio, and Listen Voice selectors now rely on Gateway provider catalogs instead of hardcoded media model fallbacks.
- Supertonic voice options now come from the Gateway voice catalog, so Flow surfaces the same voices that Gateway can execute.
- Media nodes keep image, TTS, and STT provider/model selections in media-specific fields instead of falling back to generic LLM `provider`/`model` values.

### Changed
- Apple/GPU Flow profiles now require Gateway `>=0.2.14`, Runtime `>=0.4.14`, and Core `>=2.13.15`.

## [0.3.11] - 2026-05-13

### Fixed
- Media node controls keep image, TTS, and STT model selectors in media-specific fields so runtime LLM provider/model inputs no longer overwrite generated media routing.
- Listen Voice nodes now expose the Gateway STT model selector and pass the chosen transcription model through wait metadata.

### Changed
- Apple/GPU Flow profiles now require Runtime `>=0.4.11` and Core `>=2.13.14`.
- Frontend npm package metadata is aligned with the Python release version for the next npm publication.


## [0.3.10] - 2026-05-12

### Added
- AbstractFlow media node properties now load Gateway voice profiles, TTS models, STT models, provider image models, and cached local vision models from Gateway catalog routes.
- Generate Image, Generate Voice, Transcribe Audio, and Listen Voice nodes now expose simple Gateway Media controls for local/provider model selection.

### Fixed
- Image, TTS, and STT selectors now write media-specific fields (`image_provider`/`image_model`, `tts_model`, `stt_model`) instead of overloading LLM routing `provider`/`model`.
- Apple/GPU Flow release-profile installs now include `abstractagent>=0.3.7`, so Agent-node workflow validation matches the capabilities shipped in the local host profiles.

### Changed
- Apple/GPU Flow install profiles now require Runtime `>=0.4.10` and Core `>=2.13.13` while keeping Gateway as a separately installed server dependency to avoid a Flow/Gateway release-order cycle.

## [0.3.9] - 2026-05-11

### Changed
- Release/install profile guidance now consistently targets canonical install profiles: `abstractflow`, `abstractflow[apple]`, `abstractflow[gpu]`.
- Runtime profile references and CLI error messages were updated across docs/code paths to remove `all-apple`, `all-gpu`, `runtime`, and `standalone` guidance.

### Fixed
- Release workflow manual dispatch now handles existing tags safely:
  - existing `vX.Y.Z` tags for the same commit are reused,
  - mismatched tag/commit state now fails with a clear remediation message.

### Added
- Release notes/packaging metadata refresh for the corrected profile taxonomy and corrected dependency/error messaging.

## [0.3.8] - 2026-05-09

### Added
- **Gateway contract strictness for run detail helpers**: AbstractFlow now requires Gateway discovery descriptors for
  `capabilities.contracts.common.runs.input_data` and `capabilities.contracts.common.runs.history_bundle` (or
  `contracts.flow_editor.runs.*`) before enabling run rehydration and run history replay in the editor UX.
  Missing helper descriptors in versioned contracts now produce explicit readiness failures instead of
  implicit path assumptions.
- **Gateway capability readiness checks**: New `gatewayClient` helpers (`getGatewayFlowEditorReadiness`,
  `endpointFromDescriptor`, `descriptorEndpointAvailable`) and the `useGatewayCapabilities` hook
  (`gatewayReadinessFromCapabilities`) for frontend capability discovery.
- **Gateway connectivity check**: New `check_gateway_connection()` and `require_gateway_connectivity()`
  functions in `gateway_options.py` for early validation of gateway reachability.
- **Lazy runtime exports**: `abstractflow.__init__.py` now uses `__getattr__` to lazily import runtime
  dependencies (Flow, FlowRunner, compile_flow, etc.), enabling a true thin-client install profile.
- **npm publish job**: Release workflow now publishes the frontend CLI (`@abstractframework/flow`) to npm
  alongside the PyPI release.

### Changed
- **Descriptor-driven endpoint usage in editor paths**: `RunFlowModal` and `Toolbar` now resolve
  run helper endpoints through descriptors and only use fallback canonical paths for legacy, non-versioned
  Gateway contracts.
- **CLI workflow bundle loading**: `abstractflow bundle` commands now lazily import `abstractruntime` to
  avoid hard dependencies on the runtime stack for thin-client users.
- **Install profile names**: Updated all documentation and CLI error messages to use canonical profiles
  (`abstractflow`, `abstractflow[apple]`, `abstractflow[gpu]`).

### Fixed
- **Gateway auth token resolution**: Simplified `resolve_gateway_token()` to use a single env var
  (`ABSTRACTGATEWAY_AUTH_TOKEN`) and removed fragile comma-split fallback.

### Notable cleanup for thin-client direction
- Documentation and install guidance now use the canonical profiles:
  - `abstractflow` (thin client)
  - `abstractflow[apple]` / `abstractflow[gpu]` (local execution + gateway-compatible host stack)

## [0.3.7] - 2026-05-06

### Added
- **Release and documentation automation**:
  - GitHub Actions now builds the MkDocs documentation site in CI and on releases.
  - Tagged releases deploy the docs site to the `gh-pages` branch after PyPI and GitHub Release publication.
  - Added a MkDocs Material documentation site configuration.
- **Centralized package version source**: `abstractflow/_version.py` is now the single source of truth for release version metadata.
- **AbstractCode UI event demo flows** (`web/flows/*.json`):
  - `acagent_message_demo.json`: `abstractcode.message`
  - `acagent_ask_demo.json`: durable ask+wait via `wait_event.prompt`
  - `acagent_tool_events_demo.json`: `abstractcode.tool_execution` + `abstractcode.tool_result`
- **Tool observability wiring improvements (Visual nodes)**:
  - `LLM Call` exposes `tool_calls` as a first-class output pin (same as `result.tool_calls`) for easier wiring into `Tool Calls` / `Emit Event`.
  - `Agent` exposes best-effort `tool_calls` / `tool_results` extracted from its scratchpad trace (post-run ergonomics).
- **Pure Utility Nodes (Runtime-backed)**:
  - `Stringify JSON` (`stringify_json`): Render JSON (or JSON-ish strings) into text with a `mode` dropdown (`none` | `beautify` | `minified`). Implementation delegates to `abstractruntime.rendering.stringify_json` for consistent host behavior.
  - `Agent Trace Report` (`agent_trace_report`): Render an agent scratchpad (`node_traces`) into a condensed Markdown timeline of LLM calls and tool actions (full tool args + results, no truncation). Implementation delegates to `abstractruntime.rendering.render_agent_trace_markdown`.

### Changed
- **Run Flow modal (array parameters)**: Array pins now render as a Blueprint-style item list (add/remove items) with a "Raw JSON (advanced)" escape hatch for non-string arrays.

### Fixed
- **FlowRunner SUBWORKFLOW auto-drive**: `FlowRunner.run()` no longer hangs if the runtime registry contains only subworkflow specs (common in unit tests). It now falls back to the runner’s own root `WorkflowSpec` when resuming/bubbling parents.
- **GitHub CI portability**: Tests and frontend build now work from a clean GitHub checkout instead of relying on local workspace-only paths.

## [0.3.4] - 2026-02-06

### Added
- **More AbstractCore “common tools” in the editor**: `skim_url` and `skim_websearch` are now included in `/api/tools` and are executable by the default host tool executor.
- **Comms tools documentation**: clarified how to opt into email/WhatsApp/Telegram tools via env flags.

## [0.3.3] - 2026-02-06

### Added
- **Historical install profile**: `abstractflow[standalone]` was the then-current profile for the Visual Editor backend.
  It is now replaced by the current split: `abstractflow` (thin client),
  `abstractflow[apple]`, and `abstractflow[gpu]`.

## [0.3.2] - 2026-02-06

### Added
- **Packaged visual editor backend** (FastAPI) as part of the then-current `abstractflow[standalone]` profile:
  - `abstractflow serve ...` CLI subcommand
  - `abstractflow-backend ...` console script (alias of `python -m backend`)

### Changed
- **Backend runtime directory defaults**:
  - source checkout: `web/runtime/`
  - installed package: `~/.abstractflow/runtime`
  - override: `ABSTRACTFLOW_RUNTIME_DIR`
- **Backend flow storage can be overridden** via `ABSTRACTFLOW_FLOWS_DIR` (default remains `./flows`).
- **Default publish directory** is now `./flows/bundles/` (override via `ABSTRACTFLOW_PUBLISH_DIR`).

### Fixed
- **`npx @abstractframework/flow` UI server now proxies `/api/*`** (HTTP + WebSocket) to the backend, preventing “Save failed: JSON.parse …” when the backend is running.

## [0.3.1] - 2026-02-04

### Added
- **User-facing documentation set** for public release:
  - Core docs: `README.md`, `docs/getting-started.md`, `docs/architecture.md`, `docs/api.md`, `docs/faq.md`
  - Repo policies: `CONTRIBUTING.md`, `SECURITY.md`, `ACKNOWLEDMENTS.md`
  - Agentic index: `llms.txt`, `llms-full.txt`

### Changed
- **Documentation accuracy + structure**: refreshed docs to match the implemented code (VisualFlow portability, runtime wiring, CLI bundle tooling, web editor layout) and improved cross-references for first-time users.

## [0.3.0] - 2025-01-06

### Added
- **VisualFlow Interface System** (`abstractflow/visual/interfaces.py`): Declarative workflow interface markers for portable host validation, enabling workflows to be run as specialized capabilities with known IO contracts
  - `abstractcode.agent.v1` interface: Host-configurable prompt → response contract for running a workflow as an AbstractCode agent
  - Interface validation with required/recommended pin specifications (provider/model/tools/prompt/response)
  - Auto-scaffolding support: enabling `abstractcode.agent.v1` auto-creates `On Flow Start` / `On Flow End` nodes with required pins
- **Structured Output Support**: Visual `LLM Call` and `Agent` nodes accept optional `response_schema` input pin (JSON Schema object) for schema-conformant responses
  - New literal node `JSON Schema` (`json_schema`) to author schema objects
  - New `JsonSchemaNodeEditor` UI component for authoring schemas in the visual editor
  - Pin-driven schema overrides node config and enables durable structured-output enforcement via AbstractRuntime `LLM_CALL`
- **Tool Calling Infrastructure**:
  - Visual `LLM Call` nodes support optional **tool calling** via `tools` allowlist input (pin or node config)
  - Expose structured `result` output object (normalized LLM response including `tool_calls`, `usage`, `trace_id`)
  - Inline tools dropdown in node UI (when `tools` pin not connected)
  - Visual `Tool Calls` node (`tool_calls`) to execute tool call requests via AbstractRuntime `EffectType.TOOL_CALLS`
  - New pure node `Tools Allowlist` (`tools_allowlist`) with inline multi-select for workflow-scope tool lists
  - Dedicated `tools` pin type (specialized `string[]`) for `On Flow Start` parameters
- **Control Flow & Loop Enhancements**:
  - New control node `For` (`for`) for numeric loops with `start`/`end`/`step` inputs and `i`/`index` outputs
  - `While` node now exposes `index` output pin (0-based iteration count) and `item:any` output pin for parity with `ForEach`
  - `Loop` (Foreach) now invalidates cached pure-node outputs per-iteration (fixes scratchpad accumulation)
- **Workflow Variables**:
  - New pure node `Variable` (`var_decl`) to declare workflow-scope persistent variables with explicit types
  - New pure node `Bool Variable` (`bool_var`) for boolean variables with typed outputs
  - New execution node `Set Variables` (`set_vars`) to update multiple variables in a single step
  - New execution node `Set Variable Property` (`set_var_property`) to update nested object properties
  - `Get Variable` (`get_var`) reads from durable `run.vars` by dotted path
  - `Set Variable` (`set_var`) updates `run.vars` with pass-through execution semantics
- **Custom Events** (Blueprint-style):
  - `On Event` listeners compiled into dedicated durable subworkflows (auto-started, session-scoped)
  - `Emit Event` node dispatches durable events via AbstractRuntime
- **Run History & Observability**:
  - New web API endpoints: `/api/runs`, `/api/runs/{run_id}/history`, `/api/runs/{run_id}/artifacts/{artifact_id}`
  - UI "Run History" picker (🕘) to open past runs and apply pause/resume/cancel controls
  - Run modal shows clickable **run id** pill (hover → copy to clipboard)
  - Run modal header token badge reflects cumulative LLM usage across entire run tree
  - WebSocket events include JSON-safe ISO timestamp (`ts`)
  - Runtime node trace entries streamed incrementally over WebSocket (`trace_update`)
  - Agent details panel renders live sub-run trace with expandable prompts/responses/errors
- **Pure Utility Nodes**:
  - `Parse JSON` (`parse_json`) to convert JSON/JSON-ish strings into objects
  - `coalesce` (first non-null selection by pin order)
  - `string_template` (render `{{path.to.value}}` with filters: json, join, trim)
  - `array_length`, `array_append`, `array_dedup`
  - `Compare` (`compare`) now has `op` input pin supporting `==`, `>=`, `>`, `<=`, `<`
  - `get` (Get Property) supports `default` input and safer nested path handling (e.g. `a[0].b`)
- **Memory Node Enhancements**:
  - `Memorize` (`memory_note`) adds optional `location` input
  - `Memorize` supports **Keep in context** toggle to rehydrate notes into `context.messages`
  - `Recall` (`memory_query`) adds `tags_mode` (all/any), `usernames`, `locations` inputs
- **Subflow Enhancements**:
  - `Subflow` supports **Inherit context** toggle to seed child run's `context.messages` from parent
  - `multi_agent_state_machine` accepts `workspace_root` parameter to scope agent file/system tools
- **Visual Execution Defaults**:
  - Default **LLM HTTP timeout** (7200s, overrideable via `ABSTRACTFLOW_LLM_TIMEOUT_S`)
  - Default **max output token cap** (4096, overrideable via `ABSTRACTFLOW_LLM_MAX_OUTPUT_TOKENS`)
- **UI/UX Improvements**:
  - Run preflight validation panel with itemized "Fix before running" checklist
  - Node tooltips available in palette and on-canvas (hover > 1s)
  - Node palette exposed transforms (`trim`, `substring`, `format`) and math ops (`modulo`, `power`)
  - Enhanced `PropertiesPanel` with structured output configuration
  - Improved `RunFlowModal` with better input validation and error display
  - JSON validation and error handling across executor and frontend (`web/frontend/src/utils/validation.ts`)

### Changed
- **Workflow-Agent Interface UX**: Enabling `abstractcode.agent.v1` auto-scaffolds `On Flow Start` / `On Flow End` pins (provider/model/tools)
- **Memory Nodes UX**: `memory_note` labeled **Memorize** (was Remember) to align with AbstractCode `/memorize`
- **Flow Library Modal**: Flow name/description edited via inline pencil icons (removed Rename/Edit Description buttons)
- **Run Modal UX**:
  - String inputs default to 3-line textarea
  - Modal actions pinned in footer (body scrolls)
  - No truncation of sub-run/memory previews (full content on demand)
  - JSON panels (`Raw JSON`, `Trace JSON`, `Scratchpad`) syntax-highlighted
- **Node Palette Organization**:
  - Removed **Effects** category
  - Added **Memory** category (memories + file IO)
  - Added **Math** category (after Variables)
  - Moved **Delay** to **Events**
  - Split into **Literals**, **Variables**, **Data** (renamed from "Data" to **Transforms**)
  - Reordered **Control** nodes (loops → branching → conditions)
  - `System Date/Time` moved to **Events**
  - `Provider Catalog` + `Models Catalog` moved to **Literals**
  - `Tool Calls` moved from **Effects** to **Core** (reordered: Subflow, Agent, LLM Call, Tool Calls, Ask User, Answer User)
- **Models Catalog**: Removed deprecated `allowed_models` input pin (in-node multi-select synced with right panel)
- **Node/Pin Tooltips**: Appear after 2s hover, rendered in overlay layer (no clipping)
- **Python Code Nodes**: Include in-node **Edit Code** button; editor injects "Available variables" comment block
- **Execution Highlighting**: Stronger, more diffuse bloom for readability during runs; afterglow decays smoothly (3s), highlights only taken edges
- **Data Edges**: Colored by data type (based on source pin type)

### Fixed
- **Recursive Subflows**: Visual data-edge cache (`flow._node_outputs`) now isolated per `run_id` to prevent stale outputs leaking across nested runs (fixes self/mutual recursion with pure nodes like `compare`, `subtract`)
- **Durable Persistence**: `on_flow_start` no longer leaks internal `_temp` into cached node outputs (prevented `RecursionError: maximum recursion depth exceeded`)
- **WebSocket Run Controls**: Pause/resume/cancel no longer block on per-connection execution lock (responsive during long-running LLM/Agent nodes)
- **WebSocket Resilience**:
  - Controls resilient to transient disconnects (can send with explicit `run_id`, UI reconnects-and-sends)
  - Execution resilient to UI disconnects (dropped connection doesn't cancel in-flight run)
- **VisualFlow Execution**: Ignores unreachable/disconnected execution nodes (orphan `llm_call`/`subflow` can't fail initialization)
- **Loop Nodes**:
  - `Split` avoids spurious empty trailing items (e.g. `"A@@B@@"`) so `Loop` doesn't execute extra empty iteration
  - Scheduler-node outputs in WebSocket `node_complete`: Loop/While/For sync persisted `{index,...}` outputs to `flow._node_outputs` (UI no longer shows stale index)
- **Pure Node Behavior**:
  - `Concat` infers stable pin order (a..z) when template metadata missing
  - `Set Variable` defaulting for typed primitives: `boolean/number/string` pins default to `false/0/""` instead of `None`
- **Agent Nodes**: Reset per-node state when re-entered (e.g. inside `Loop` iterations) so each iteration re-resolves inputs
- **Run Modal Observability**:
  - WebSocket `node_start`/`node_complete` events include `runId` (distinguish root vs child runs)
  - Visual Agent nodes start ReAct subworkflow in **async+wait** mode for incremental ticking
  - Run history replay synthesizes missing `node_complete` events for steps left open in durable ledger
- **Canvas Highlighting**: Robust to fast child-run emissions (race with `node_start` before `runId` state update fixed)
- **WebSocket Subworkflow Waits**: Correctly close waiting node when run resumes past `WAITING(reason=SUBWORKFLOW)`
- **Web Run History**: Reliably shows persisted runs regardless of server working directory (backend defaults to `web/runtime` unless `ABSTRACTFLOW_RUNTIME_DIR` set)
- **Cancel Run**: No longer surfaces as `flow_error` from `asyncio.CancelledError` (treated as expected control-plane operation)
- **Markdown Code Blocks**: "Copy" now copies original raw code (preserves newlines/indentation) after syntax highlighting

### Technical Details
- **13 commits**, **48 files changed**: 12,142 insertions, 368 deletions
- New module: `abstractflow/visual/interfaces.py` (347 lines)
- New UI component: `web/frontend/src/components/JsonSchemaNodeEditor.tsx` (460 lines)
- New tests: `test_visual_interfaces.py`, `test_visual_agent_structured_output_pin.py`, `test_visual_llm_call_structured_output_pin.py`, `test_visual_subflow_recursion.py`
- Compiler enhancements: Interface validation, per-run cache isolation, structured output pin support
- Executor optimizations: Performance improvements for VisualFlow execution
- 12 new example workflow JSON files in `web/flows/`

### Notes
- This repository includes the published Python package (`abstractflow/`) and a reference visual editor app (`web/`).

## [0.1.0] - 2025-01-15

### Added
- Initial placeholder package to reserve PyPI name
- Basic project structure and packaging configuration
- Comprehensive README with project vision and roadmap
- MIT license and contribution guidelines
- CLI placeholder with planned command structure

### Notes
- This is a placeholder release to secure the `abstractflow` name on PyPI
- No functional code is included in this version
- Follow the GitHub repository for development updates and release timeline
