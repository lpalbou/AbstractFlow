# Proposed: Faithful follow-up context (editable preview, complete seed, no double history)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 run-experience review: follow-up seeds prior prompt + final answer
only — mid-run ask_user exchanges and intermediate answer_user outputs are
dropped (RunFlowModal ~4851-4887); the answer extractor falls back to
JSON.stringify of the whole result, seeding noisy fake assistant turns
(~4844-4848); the dialog shows only message+attachments so users cannot see or
edit what context will be sent (~8016-8102); session-id reuse PLUS
context.messages seeding risks double history when the target flow replays
session memory (Toolbar ~1104,1112); threads are ephemeral (client-side refs,
gone on reload, unavailable for published-bundle runs — ~1073-1096, 1519).
Dead code: followUpContext never set non-null yet still merged (~2708-2717).

## Current code reality
The prompt-key injection bug from the same review is being fixed in planned
0115; this item is the remaining fidelity work.

## Problem or opportunity
"Is our way to do follow up good and accurate?" — accurate only for
single-exchange runs; lossy and unverifiable beyond that.

## Proposed direction
Editable "context that will be sent" preview in the follow-up dialog; seed
includes mid-run ask/answer exchanges in order; answer extraction prefers
answer_user outputs over stringified results; decide and document ONE history
mechanism per follow-up (session replay OR seeded messages — flag when both
would apply); persist thread mapping (e.g. run metadata/input tag) so timelines
survive reload; remove the dead followUpContext path.

## Why it might matter
Follow-up is the primary conversational loop on runs; silent context loss
breaks user trust invisibly.

## Promotion criteria
0115 landed; a session-vs-seed semantics decision recorded (may need one
gateway input field for thread ids).

## Validation ideas
Run with two ask_user exchanges → follow-up preview shows all four turns;
session-replaying flow shows single history (no duplication) in the next
model call ledger.

## Non-goals
No branching/forking of threads in v1; no editing of past turns.

## Guidance for future agents
The preview must show EXACTLY what will be sent (same object), not a
reconstruction — render from the payload builder's output.
