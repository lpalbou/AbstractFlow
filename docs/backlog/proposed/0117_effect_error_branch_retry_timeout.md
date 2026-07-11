# Proposed: Error branch + retry/timeout pins on effect nodes

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: Needs new ADR if adopted (error-path semantics are a durable
  execution contract shared with abstractruntime).

## Context
2026-07-11 nodes-lane adversarial review: there is no try/catch node, no error
exec-branch, no retry or timeout pin anywhere (`retry|timeout` zero matches in
`src/types/nodes.ts`). Hard failures set `_flow_error` and kill the run
(abstractruntime compiler ~2390, 3919, 4032, 4095). Soft-fail `success` pins
exist only on llm_call/tool_calls/agent/code.

## Current code reality
UI templates have no error outputs; the runtime compiler maps effect failure to
run failure; `success` booleans exist on four nodes only.

## Problem or opportunity
A flow calling a flaky provider cannot catch, retry, fall back, or bound
latency — the single most common robustness need in production workflows
(every comparable tool ships error routes: n8n error workflow/branch, Make
error handlers, Windmill retries).

## Proposed direction
Optional `error` exec output + `retry_count`/`retry_delay_s`/`timeout_s` pins
on effect nodes (llm_call, tool_calls, agent, subflow, media, file IO),
lowered to a compiler-side wrapper in abstractruntime. `success` pins stay for
soft checks. Error payload (message, category) flows on a data pin beside the
branch.

## Why it might matter
Converts "one hiccup kills the run" into author-controlled resilience; unlocks
fallback-provider patterns without Code-node gymnastics.

## Promotion criteria
Runtime seat agreement on failure-outcome mapping (cross-repo contract) and a
signed mini-spec for retry semantics (idempotency interaction with ledger
replay must be stated).

## Validation ideas
Compiler tests: error branch taken on forced failure; retries respect ledger
idempotency; timeout produces the error branch, not a hang.

## Non-goals
Does not authorize catch-all global handlers or implicit retries without pins.

## Guidance for future agents
Coordinate with abstractruntime owner; the wrapper must reuse existing effect
outcome plumbing, not fork it.
