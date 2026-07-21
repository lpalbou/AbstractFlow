# Completed: Waits actionable everywhere + approval visibility (toast honesty, toolbar badge, Approve All revoke)

## Metadata
- Created: 2026-07-11
- Status: Completed
- Completed: 2026-07-21
- Work id: abstractflow-0138
- Thread anchor: agora commons c3815 (work dispatch) + c3890 (operator ruling
  approving the held remainder with one fable5 adversary)

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 run-experience review: every non-subworkflow wait force-opens the
modal with toast "Flow is waiting for your response" — including event parks
and deadline waits that need no response (Toolbar ~817-821; useWebSocket
~416-445 forwards event-reason waits). Outside the modal there is no waiting
indicator (generic spinner only). Approve All is irrevocable and invisible: no
caller ever passes false, the choice persists in sessionStorage, auto-approved
resumes are suppressed as bookkeeping so the timeline shows no "auto-approved"
marker, and no UI revokes it. A wrong-subrun heuristic can attach another
agent's cycles to the selected step when two agents run concurrently
(RunFlowModal ~4356-4362).

## Current code reality
Wait rendering inside the modal is honest and good (park vs prompt vs approval
vs visitor, deadline countdown); the gaps are outside-modal visibility and
approval lifecycle.

## Problem or opportunity
Waits interrupt users who don't need interrupting, hide from users who do need
to act, and the strongest safety control (approvals) has silent permanent
bypass.

## Proposed direction
Reason-aware notifications (no force-open for event parks; correct wording per
reason); toolbar "waiting for you" badge with jump-to-wait; Approve All state
chip in the modal footer with revoke; auto-approved tool executions marked in
the timeline; fix the subrun attach heuristic to require sub_run_id once
available.

## Why it might matter
Trust surface: approvals and waits are where users decide whether the product
respects them.

## Promotion criteria
0115 landed (shares the wait plumbing it touches).

## Validation ideas
Park a wait_event flow: no force-open, badge shows; enable Approve All: chip
visible, timeline marks auto-approvals, revoke stops them.

## Non-goals
No push/OS notifications; no approval policy editor (gateway lane).

## Guidance for future agents
Match reason vocabulary to ledger wait reasons exactly — invented categories
drift.

## Progress (2026-07-21, work id abstractflow-0138)
First slice SHIPPED — the "waits actionable everywhere" half:
- `src/utils/waitClassification.ts` (`classifyWait` → approval|prompt|park,
  `isInteractiveWait`, `waitNotificationText`), reason-first + content-aware
  (a park reason with a real host prompt is a prompt; placeholder prompts
  like "Please respond:" never count). 10 tests in
  `waitClassification.test.ts`.
- `useWebSocket` computes interactivity from the RAW `flow_waiting` event
  (before the prompt is defaulted) and carries it on `WaitingInfo`.
- Toolbar `onWaiting` force-opens + toasts ONLY for interactive waits
  (approval/prompt); event/deadline parks run silently (no more spurious
  modal + "respond" toast).
- Toolbar "Waiting for you" / "Approval needed" badge in the run-actions
  group for interactive waits, jumping back into the run modal.

Remaining slice — the "approval visibility / lifecycle" half (still open):
- Approve-All state chip in the run modal footer WITH revoke (the hook
  setters `setAutoApproveForSession`/`setAutoApproveForRunRoot` already
  accept `enabled=false`; only a UI control + chip is missing).
- Mark auto-approved tool executions in the run timeline (today the
  auto-resume is suppressed as bookkeeping — a silent safety bypass; needs
  threading a marker through the resume-record suppression in
  `ledgerEvents.ts`).
- Tighten the subrun-attach heuristic (RunFlowModal) to require `sub_run_id`
  before attaching cycles to a step, so concurrent agents don't cross-attach
  (the dedupe path is already sub_run_id-gated; audit the cycles/trace
  attach path).

## Second slice SHIPPED (2026-07-21, one fable5 adversary — approval lifecycle)
All three remaining sub-tasks landed; 392 tests green, tsc + build clean.
- **C — Approve-All chip + Revoke:** a warning-toned "Auto-approving tool
  calls" pill (pulsing dot + Revoke) in the run-modal footer-left, shown
  whenever `approvalAutoApproveActive` (session or root). Revoke clears the
  local + hook auto-approve sets for the current sid/rid and calls the new
  `onRevokeAutoApprove` prop → Toolbar's `handleRevokeAutoApprove` passes
  `enabled=false` to the hook setters (first-ever false callers). HARDENING
  FOUND: `setAutoApproveForSession` now updates `autoApproveSessionsRef`
  SYNCHRONOUSLY — the incoming-wait auto-approve check reads the ref, and the
  state→ref effect only lands next render; without the sync update a wait
  arriving right after Revoke would still auto-resume (fail-dangerous gap).
  Re-prompt proven in the code path: after revoke the next tool-approval
  wait sees `autoEnabled=false`, skips `autoApproveWait`, and surfaces the
  Deny/Approve/Approve-All footer.
- **D — auto-approved executions marked in the timeline:** new pure helper
  `ledgerEvents.toolApprovalResumeMarker(rec)` (requires resume + resumed +
  `wait_reason==='user'` + strict boolean `approved===true`) surfaces an
  "auto-approved" (warning) / "approved" (success) badge in the step meta
  row instead of silently suppressing the resume. Only tool-approval resumes
  get it; denied/user-reply/event resumes excluded (test-pinned). History
  replay gets it free (same mapper). Honest limit: auto vs manual rests on
  the client-minted `auto_approved` stamp; a stampless third-party client
  renders plain "approved" (safe default).
- **E — subrun-attach tightening:** new pure helper
  `subrunAttach.unambiguousSubRunCandidate` — the last-resort agent-subrun
  fallback attaches only when exactly ONE unclaimed non-root sub-run is
  emitting traces; two concurrent agents = two candidates = null (no
  cross-attach). The trace panel now shows a "Waiting for sub_run_id…"
  placeholder instead of mixing every sub-run's cycles when the id is null.
  Output derivation + agent metrics ride the same tightened id.
- Tests: +8 ledgerEvents marker/exclusion tests, +6 subrunAttach concurrency
  tests. Cross-seat: none required (the resume record already carried every
  signal; noted a possible future server-attested auto-approve provenance
  field for the runtime seat, no current defect).
