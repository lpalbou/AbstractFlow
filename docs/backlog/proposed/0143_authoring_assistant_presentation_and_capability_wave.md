# 0143 — Authoring assistant presentation + capability wave (2026-07-12)

Status: partially shipped (this document records the wave, its adversarial
findings, and the follow-ups that did NOT ship).

## Directive (operator, verbatim intent)

Focus the assistant on helping design and fix workflows. Two improvement
streams: (a) aesthetics, better realtime information and visual cues, better
message layout/organization, better user-facing messages ("dumping the list
of changes is not really useful for a user"); (b) capability — complex
workflows, MULTIPLE workflows with composition (create workflow2, then
workflow1 leveraging workflow2), and significantly better build → register →
test delivery of production-ready workflows.

## Method

Five adversarial fable5 audits (message contract; layout/visual system;
single-workflow capability ceiling; multi-workflow composition; build/
register/test pipeline), then staged implementation. One P0 found in the
audits was runtime-owned and fixed same-night by the runtime seat
(visual `llm_call` both-or-neither provider/model drop — abstractruntime
`5578779`).

## Shipped (see CHANGELOG 2026-07-12 for the user-facing summary)

- Message contract: outcome-first turn reports, verbatim caveats, collapsed
  Turn report block, question-first needs_user (warning tone), paused (not
  failed) cycle-cap exhaustion, 3-line failures with forensics moved to the
  activity payload inspector.
- Visual system: state pill + stage chips + cycle budget + live plan strip +
  activity glyph marks + 'notice' kind + sticky cycle headers + theme-token
  message surfaces (light-theme fix) + literal user messages + theme-aware
  Monaco + reduced-motion gates. Drawer extracted into
  `src/components/assistant/`.
- Composition stage 0+1: authorable `subflow_ref` + `set_subflow` command
  (pin patch via subflowPins), refusals with suggestions, self-ref/cycle
  refusal, `subflow_interface` read-only context, AVAILABLE WORKFLOWS prompt
  section, subflow readiness check, skill-doc section.
- Safety: mass-deletion budget with `confirm_deletions`; `update_pin`
  in-place retype; pin description/schema round-trip.
- Test loop stage 1: `draftTestRun.ts` + drawer Test card (consented run of
  the saved flow as a draft bundle, isolated session, approval/ask-user
  surfacing with resume, watchdog cancel, structured report fed to the next
  planning turn consume-once).
- General readiness floor: unreachable exec nodes, loop-without-body,
  while-without-condition, blank subflow refs, declared-but-unwired On Flow
  End pins, schedule-less on_schedule.

## Post-implementation adversarial round (reviewer F) — findings + dispositions

A sixth fable5 adversary attacked the implemented wave. Fixed same-night:

- F1 (P0): the unreachable-node readiness check used the exec-out→exec-in
  walk and flagged every loop/branch/switch body (the 2026-06-10
  unsatisfiable-check class). Fixed: `execReachableNodeIds` follows ALL
  execution output handles (loop/done, true/false, case:*, then:N);
  regression tests pin branch-fed nodes clean + genuine orphans flagged.
- F2 (P0): a second tool approval in the same agent subrun never surfaced
  (root-wait-key dedup never reset) and the watchdog cancel mislabeled it a
  graph-defect `timeout`. Fixed: per-poll descendant probe (one in flight,
  keyed by runId:waitKey, cleared on resume so further waits surface),
  approvals count as interactive, and `hasPendingInteraction` feeds the
  watchdog verdict (`needs_interactive_input`); pinned by a mocked-clock
  poll test.
- F3 (P1): `classifyWait` read the ask_user prompt from `details.prompt`;
  the gateway carries it at the top level of the wait. Fixed with fallback;
  the unit test now pins the REAL shape (hand-written-double lesson).
- F4 (P1): nested-redacted pin defaults (e.g. headers.Authorization) broke
  the round-trip invariant — verbatim re-emits compiled an unappliable
  set_pin_default every cycle. Fixed with a redacted-current compare in
  `pinDefaultsCommands` + `eventConfigCommands`; round-trip test added.
- F5/F6 (P1): in-flight test approvals became unreachable while an
  authoring turn ran (card hidden on busy) and Clear Chat leaked the test
  report into the fresh conversation / left the poll running. Fixed:
  visibility includes testRunning/testWait; Clear stops the test and clears
  report + prompt-feedback ref.
- F7 (P2): "apply changes AND ask" (needs_user with a non-empty diff) was
  coerced to continue, swallowing the question until the stall budget
  burned. Fixed: post-apply needs_user breaks the turn with the question.
- F8 (P2): break_object same-id retype compiled to nothing (id-set-only
  compare). Fixed: type changes re-emit set_break_paths.
- F9 (P2): the test report read only the ROOT ledger — agent workflows fail
  in sub-runs. Fixed: the drawer walks the run tree (bounded) and feeds all
  records to buildDraftTestReport.
- F10 (P2): followLive.ts was dead code while the activity log auto-yanked.
  Fixed: useFollowLive wired to the activity log with a Follow ↓ re-arm
  pill.

Deferred from F (recorded): F11 — MarkdownRenderer sets the global Monaco
theme per message render (theme switches re-colorize on the next message;
an open CodeEditorModal could be restyled by a background message render).

## Deliberate deviations from the audit designs (recorded)

- Composer consolidation (audit B 2g: single control row absorbing the top
  model selects + the topbar context meter) NOT shipped — the model row
  stays at the top. Reason: scope control on a 3.3k-line file mid-wave; the
  single-Stop + header restructuring DID ship via the extracted components.
- Follow-live shipped for the ACTIVITY LOG; the conversation scroller keeps
  simple scroll-on-message-count (messages only arrive at turn boundaries,
  so mid-read yanking cannot happen there).
- "Open run" from the test card copies the run id (Run History opens it) —
  a direct run-modal hand-off needs a Toolbar-owned inspect callback plumbed
  through props; deferred.
- Test-input synthesis by the MODEL (`test_inputs` plan field, audit E) not
  shipped; inputs prefill from pin defaults and the user edits. The plan
  field is additive when wanted.

## Not shipped (future stages)

- Composition stage 2 (multi-workflow TURNS: target_workflow protocol,
  workspace map, off-canvas child authoring, save orchestration with
  undo-delete of created flows, workspace chips). Stage 1 delivers the
  directive across two conversations; stage 2 makes it one conversation.
- Registration ("Verified → save + durable publish with auto-bump"): the
  publish affordance stays the PublishFlowModal; assistant-prefilled
  registration is audit E part 3, unbuilt.
- Patch-mode document emission above a size threshold (audit C D2) — the
  output-cap ceiling for very large graphs stands; the deletion budget
  removes the catastrophic failure mode but not the ceiling.
- Editor-canonicalization feedback into the next cycle (audit C G10) and a
  consecutive-full-rejection budget (G11).
- Tool-name validation against the inventory in readiness (audit C D7e);
  research readiness first-instance binding fix (G9/D8).
- Client-side code-node lint (validate_code parity) and resp_schema
  validation (audit C G8).
- Mid-turn flow-switch guard (audit D finding 8: capture flowId/draft
  instance at turn start, abort the turn if the store identity changes).

## Cross-seat facts

- Runtime ruled + fixed the llm_call provider/model forwarding same-turn
  (commons c893); flow-side preflight cites their pin file.
- Composition + test designs need ZERO gateway changes (audit D/E verified
  against the gateway tree: visualflows CRUD/publish + runs API suffice).
