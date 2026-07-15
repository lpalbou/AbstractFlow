# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
