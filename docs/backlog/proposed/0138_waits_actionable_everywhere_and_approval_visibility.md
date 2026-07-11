# Proposed: Waits actionable everywhere + approval visibility (toast honesty, toolbar badge, Approve All revoke)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

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
