# Proposed: Triggers that start runs (event/webhook/schedule subscription registry)

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: Needs new ADR (trigger registry is a gateway-owned durable
  contract).

## Context
2026-07-11 events-lane adversarial review: `on_event`/`on_schedule` compile to
waits INSIDE an already-started run (runtime executor ~4069-4077); nothing
cold-starts a flow when an event arrives; `on_agent_message` has no producer
anywhere (decorative); no webhook door exists — external producers must POST
`/api/gateway/commands` with client-minted command ids. The catalog doc
oversells ("Entry point triggered by a durable custom event",
docs/workflow-node-catalog.md ~849).

## Current code reality
Resident flows must be manually started and stay parked; chat bridges
(Telegram) start runs via env-configured flow ids invisible to the editor; no
subscription registry in the gateway (zero matches).

## Problem or opportunity
"Agent reacts to the world" is the most common automation entry point (n8n,
Make, Zapier, Windmill, Kestra all ship it). AbstractFlow cannot express it
without an always-running resident.

## Proposed direction
Gateway-side trigger registry: publishing a flow whose entry is
`on_event`/`on_schedule`/`on_agent_message` registers a subscription; matching
events/schedules START a run with the payload mapped to entry outputs. Add
per-trigger inbound URL (`/api/gateway/triggers/{id}/emit`) with auth for
webhooks. Editor shows active-trigger badges; run history links runs to their
trigger. Fix the catalog text immediately (honesty fix is flow-side).

## Why it might matter
Unlocks webhook/cron-started agent flows — the researcher ranked this among
the top adoption gaps vs every automation peer.

## Promotion criteria
Gateway seat capacity + a mini-spec covering auth, dedup/idempotency of
inbound posts, and backpressure (concurrent starts cap).

## Validation ideas
Publish → registry row visible; POST to trigger URL starts a run with payload;
schedule fires once per boundary; unpublish deregisters.

## Non-goals
Does not authorize arbitrary inbound HTTP proxying or per-node webhooks.

## Guidance for future agents
The catalog-text honesty fix should ship independently and immediately.
