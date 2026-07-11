# Planned: Run-modal event interaction surface (send event + event visibility)

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 adversarial review (events lane) found the event core durable and honest
but "a runtime capability, not a product surface". A run parked on `wait_event`
renders an honest park card with key + deadline, yet the UI offers no way to send
an event — testing a resident flow requires curl against
`POST /api/gateway/commands` with `type=emit_event`. Received events are also
invisible: the resume record is filtered as bookkeeping, so the park step never
shows what payload woke it.

## Current code reality
- Park rendering: `src/components/RunFlowModal.tsx` (~4250, ~6411) shows
  "Parked — waiting for events on `<key>`" with deadline; no composer.
- The client only ever posts `type: 'resume'` commands
  (`src/hooks/useWebSocket.ts` ~1014); no `emit_event` client function exists in
  `src/utils/gatewayClient.ts`.
- `src/utils/ledgerEvents.ts` filters `resume` records (resumed=true) wholesale,
  so event payloads that woke a park are dropped client-side.
- Gateway side already ships: `emit_event` command with optional `durable: true`
  mailbox append (abstractgateway runner), so no server work is needed.

## Problem
Authors building event-driven flows (residents, A2A patterns) cannot exercise or
observe events from the product. Parked runs are dead ends; woken parks do not
show the payload that woke them.

## What we want to do
1. Add a "Send event" composer on event-park waits: event key prefilled from the
   wait (editable), JSON payload editor, optional durable toggle, posting the
   existing gateway `emit_event` command.
2. Surface received events: when a `wait_event` park resumes, annotate the step
   with the received payload (mapped from the ledger resume/result record instead
   of dropping it).
3. Show emitted-event results (`delivered`, `delivered_to`) in step details for
   `emit_event` nodes (already present in results; verify rendering).

## Requirements
- Composer only appears for `reason=event` waits; it must not appear for
  ask_user/approval waits.
- Payload must round-trip as JSON with inline validation; invalid JSON disables
  Send.
- Sending uses the same auth/proxy path as other gateway commands.
- Received-event annotation must be derived from ledger records (no client-side
  guessing) and clearly labeled.

## Suggested implementation
- `src/utils/gatewayClient.ts`: add `gatewayEmitEvent(...)` posting to
  `/api/gateway/commands`.
- `src/utils/eventComposer.ts` (new): parse `evt:<scope>:<scope_id>:<name>` keys
  into structured fields + compose back; unit-tested.
- `src/components/RunFlowModal.tsx`: composer UI on the park card; received
  payload panel on resumed parks.
- `src/utils/ledgerEvents.ts`: pass through event-park resume payloads as a
  dedicated annotation instead of filtering.

## Scope
Flow client only; gateway endpoint already exists.

## Non-goals
- No trigger registry / cold-start triggers (see 0119).
- No mailbox drain/reply nodes (see 0120).
- No global event feed page (only run-scoped visibility).

## Dependencies and related tasks
- Review finding source: adversarial reviewer 1B (2026-07-11).
- Related proposed: 0119 (triggers), 0120 (mailbox nodes).

## Expected outcomes
A user can watch a resident flow park, send it a test event from the run modal,
see the park resume, and read the payload that woke it — no curl required.

## Validation
- Unit tests: event key parse/compose; ledger mapping of event-park resume.
- Manual: park a wait_event flow, send event from composer, observe resume.
- Full vitest + tsc + build green.

## Progress checklist
- [ ] eventComposer util + tests
- [ ] gatewayClient emit function
- [ ] Composer UI on park card
- [ ] Received-payload annotation via ledgerEvents
- [ ] CHANGELOG + docs touch

## Guidance for the implementing agent
Keep the composer small and honest: it posts a command and reports the gateway
response verbatim (delivered count). Do not synthesize local success.

## Completion report
- Completed: 2026-07-11
- Shipped: `src/utils/eventComposer.ts` (+tests) parses `evt:` wait keys and
  composes gateway `emit_event` command payloads (verified against
  `runner._apply_emit_event` field-by-field by an adversarial fable5 review);
  `useWebSocket.emitEvent` posts via the existing commands endpoint;
  RunFlowModal renders the composer on event parks only (JSON validation,
  durable toggle, copy-key, stale-note race guarded by waitingKey ref);
  `ledgerEvents.resumePayloadResult` surfaces the full waking envelope for
  event-reason resumes (tests pin event vs user visibility rules).
- Validation: vitest 275 green incl. new eventComposer + ledgerEvents tests;
  tsc + build green; adversarial review verified the composer cannot appear
  for ask_user/approval/visitor waits and subrun run ids route safely.
- Deviations (deliberate): the event key is NOT editable in the composer —
  an edited key would target a key this park does not wait on (silent
  no-delivery footgun); a general send-event surface belongs to proposed
  0119/0138. Delivered-count is not shown (the async commands transport
  cannot return it); the note wording states the honest confirmation signal.
