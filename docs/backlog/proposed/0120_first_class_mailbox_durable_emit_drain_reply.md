# Proposed: First-class mailbox — durable emit pin + drain_inbox/reply_to_event nodes

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: May revise event-delivery contract notes (runtime+gateway).

## Context
2026-07-11 events-lane review: the durable mailbox (events_inbox run var,
cursor drain, cap-500 drop-oldest) exists ONLY in the gateway command path
(abstractgateway runner ~611-701); the runtime EMIT_EVENT handler has no
durable branch, and the `emit_event` node has no `durable` pin — so flow→flow
messages to a busy resident are silently dropped (the exact gap the mailbox
was built to close, closed only for external HTTP producers). The proven
resident pattern hand-rolls ~40 lines of cursor Python per flow
(examples/flows/event-inbox-react-agent.json ~299-321) and hand-composes raw
`evt:global:global:<name>` keys via concat (~163-178).

## Current code reality
Wait keys are raw strings; drain discipline is copy-pasted; reply/correlation
has no primitive (envelopes carry emitter identity only, runtime ~2514-2526).

## Problem or opportunity
A2A-in-flows exists but costs expert knowledge per flow; delivery guarantees
are asymmetric by producer type.

## Proposed direction
(1) `durable` pin on emit_event with the runtime handler gaining the gateway's
inbox append (one shared implementation). (2) `wait_event` gains structured
scope/name pins building keys via the runtime's own key builder. (3) New
`drain_inbox` node (declares mailbox, returns fresh envelopes, advances cursor
atomically, exposes dropped count) and `reply_to_event` (emits back on the
envelope's reply key). Ship the resident as a palette template.

## Why it might matter
Makes the strongest existing runtime capability (durable events) reachable by
ordinary authors; prerequisite quality-of-life for any agora/A2A bridge.

## Promotion criteria
Runtime seat agreement on the shared durable-append implementation and the
envelope reply-key field.

## Validation ideas
Two-flow test: producer emits durable while consumer is mid-burst; consumer
drains both envelopes; reply reaches producer's wait.

## Non-goals
No broker/queue semantics beyond the existing inbox contract (cap, drop-oldest
stays).

## Guidance for future agents
Cursor discipline is subtle (append-only writer + reader cursor; never
read-then-clear) — port the documented contract, do not redesign it.
