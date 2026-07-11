# Planned: Run-modal live inspection (follow toggle) + failure forensics + resume identity

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 adversarial run-experience review: the modal is optimized for
watching, not interrogating. While a run streams, every new event force-selects
the newest step, so a user cannot inspect an earlier cycle's tool args mid-run.
Failed steps render only the error string — the inputs that caused the failure
exist in trace records but are never shown. The failure-panel jump updates the
details pane but neither scrolls the timeline nor expands collapsed ancestors.
Ask_user resume from an inspected (post-reload) run silently dead-ends because
the resume path lacks run/wait identity. Follow-up injection hardcodes the
`prompt` input key, so flows whose entry pin is `task`/`query` re-run the OLD
task with the new message parked in an unused key.

## Current code reality
- Selection steal: `src/components/RunFlowModal.tsx` ~4123-4132 (auto
  `setSelectedStepId(last.id)` while running/waiting); no scrollIntoView in the
  modal.
- Failed step details: ~6481-6482 error string only; trace records with full
  payloads flow through `src/utils/ledgerEvents.ts` ~95-105.
- Failure jump: ~5994 sets selection only; children render when `expanded`
  (~6207-6209); "+N more failures" non-interactive (~6002-6004).
- Resume identity: `submitResume` ~5625-5639 sends text only;
  `useWebSocket.ts` ~995-1004 requires live refs; inspected-run waits are built
  without runId/waitKey (`Toolbar.tsx` ~1491-1500) even though ledger waits
  carry `waitKey` (`ledgerEvents.ts` ~66-93). Approval + visitor paths already
  pass identity explicitly.
- Follow-up key: extraction accepts `prompt|message|task|query|question`
  (~4810-4818) but injection hardcodes `nextInputData.prompt`
  (`Toolbar.tsx` ~1102-1103).

## Problem
Mid-run inspection is impossible; failure diagnosis lacks inputs; two resume
paths are broken or lossy in real use.

## What we want to do
1. Follow-live toggle: auto-follow newest step only until the user selects a
   step; a visible "Follow live" pill re-arms; scrollIntoView on follow and on
   any programmatic jump.
2. Failure forensics: failed-step details render the effect payload (inputs)
   from the step's trace record beside the error; failure jump expands
   ancestors + scrolls; "+N more" expands.
3. Resume identity: ask_user resume passes the wait's runId/waitKey when
   present (fixes inspected-run resume); keep live-ref fallback.
4. Follow-up prompt-key fidelity: inject the follow-up message into the same
   key the extraction found (shared candidate helper), falling back to
   `prompt` only when none exists.

## Requirements
- Follow behavior must not fight the user: one manual selection disarms; the
  pill state is obvious; no scroll jank per event (only scroll on follow when
  the selected id changes).
- Payload rendering reuses existing JSON viewer components; large payloads go
  through the existing folding viewer.
- Pure logic (follow reducer, prompt-key pick) extracted into tested utils.

## Suggested implementation
- `src/utils/runFollow.ts` (new): tiny reducer deciding selection given
  (events, userPinned) — unit-tested.
- `src/utils/followUpInputs.ts` (new): `pickPromptKey(inputData/schema)` shared
  by extraction + injection — unit-tested; `Toolbar.tsx` uses it.
- RunFlowModal: pill UI + scrollIntoView refs; failed-step payload panel;
  expandAncestors(stepId) helper for jumps.
- submitResume: thread `waitingPayload.runId/waitKey` through `resumeFlow`.

## Scope
Run modal cluster (`RunFlowModal.tsx`, `Toolbar.tsx`, `useWebSocket.ts`) + two
small utils + tests.

## Non-goals
- No run page / URL identity / virtualization (proposed 0134-series).
- No retry-with-same-inputs action (needs input replay contract; proposed).
- No Approve All revoke UI (proposed).

## Dependencies and related tasks
- Reviewer 2B findings 1-3, 7, 10 (2026-07-11).

## Expected outcomes
A user can inspect any step while a run streams and re-arm following; failed
steps show the inputs that caused them; resume works from inspected runs;
follow-ups reach the flow's real prompt pin.

## Validation
- Unit tests: follow reducer; prompt-key pick (task/query/message flows);
  ledger wait identity passthrough.
- Full vitest + tsc + build green; manual live-run check.

## Progress checklist
- [ ] runFollow util + wire + pill UI
- [ ] failure payload panel + jump expand/scroll
- [ ] resume identity threading
- [ ] followUpInputs helper + injection fix
- [ ] tests + CHANGELOG

## Guidance for the implementing agent
The selection-steal fix is behavioral surgery in an 8k-line component — keep
state additions minimal (one `followLive` flag + one manual-selection setter
wrapper) and lean on the extracted utils for logic.

## Completion report
- Completed: 2026-07-11
- Shipped: follow-live state with manual-selection disarm + re-arm pill +
  scroll-into-view; adversarial review then closed three disarm leaks —
  terminal-landing steal (P1), vanished-selection auto-follow (P2), and the
  pill rendering on terminal inspected runs (P2). Failure forensics: jump
  expands ancestors + scrolls, "+N more" expands, failed steps render the
  failing effect payload from trace records. Resume identity: ask_user,
  choice, and (post-review) voice-wait resumes thread runId+waitKey;
  `resumeFlow` honors explicit identity past the live run's paused state
  and no longer clears an unrelated live wait. Follow-up prompt-key
  fidelity via `src/utils/followUpInputs.ts` shared by extraction and
  injection (tested).
- Validation: followUpInputs tests + full vitest 275, tsc, build green.
- Residuals (acknowledged): the follow/disarm decision logic remains inline
  component state rather than an extracted tested util (review P2-10) —
  the three behavior bugs it hid are fixed; extraction rides the 0141
  decomposition track. Approve All visibility and park-toast honesty are
  proposed 0138.
