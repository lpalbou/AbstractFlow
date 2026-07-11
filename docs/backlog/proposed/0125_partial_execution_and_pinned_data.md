# Proposed: Partial execution ("run to this node") + pinned/mock data

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: Needs new ADR if adopted (dev-run semantics vs durable runs).

## Context
2026-07-11 competitive research: every serious peer ships iterative execution —
n8n "Execute step" + data pinning, Dify single-node runs over cached variables
+ Variable Inspector, Windmill "test up to step" + per-iteration loop tests,
ComfyUI run-one-branch. AbstractFlow offers whole-flow runs only; testing the
JSON parser after a 40s agent chain means re-running (and re-billing) the
chain.

## Current code reality
Runs are durable gateway runs; ledger idempotency + trace records already
capture per-node outputs (the raw material for cached upstream values).

## Problem or opportunity
The dominant iteration tax for AI workflows is re-running expensive upstream
LLM/media steps to test cheap downstream logic.

## Proposed direction
Dev-only run mode: "Run to this node" executes the minimal upstream slice;
node outputs from the last run become pinned mocks (editable JSON) that
subsequent test runs inject instead of executing the node. Pinned data never
applies to published/production runs (n8n's rule). Gateway/runtime need a
partial-run entry + mock-injection contract.

## Why it might matter
Ranked the #1 competitive gap; directly attacks iteration cost and speed.

## Promotion criteria
Runtime+gateway seats agree on the dev-run contract (slice computation, mock
injection point, ledger labeling of mocked steps).

## Validation ideas
Slice correctness on branching graphs; mocked steps clearly labeled in ledger
+ UI; production runs provably ignore pins.

## Non-goals
No mocking in published bundles; no silent reuse of stale pins (age labeling
required).

## Guidance for future agents
Design the mock store client-side first (per-flow, localStorage) with explicit
injection at run-start input; avoid inventing server state until the contract
is proven.
