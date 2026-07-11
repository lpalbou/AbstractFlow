# Proposed: Async subflow fan-out + Gather node; honest Parallel semantics

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: May need ADR (concurrency semantics are durable contract).

## Context
2026-07-11 nodes-lane review: "Parallel" executes branches sequentially in pin
order (abstractruntime control_adapter ~189-191) while the runtime already
supports async child runs (`core/runtime.py` ~2809 `is_async`; the compiler
uses `"async": True` internally for agents ~1860). The visual Subflow hardcodes
`"async": False` (subflow_adapter ~67).

## Current code reality
True fan-out of N sub-tasks is impossible from the UI; the Parallel node's name
over-promises; runtime capability exists unexposed.

## Problem or opportunity
Fan-out/fan-in is a core orchestration pattern (map N documents through an LLM
subflow concurrently). Today authors serialize everything.

## Proposed direction
Expose `async`/`wait` pins on Subflow; add a `Gather` node that joins on
sub_run_ids (list input → results list output, with per-child status); fix or
rename Parallel's description honestly (deterministic sequential) until real
concurrency lands.

## Why it might matter
Large latency wins on multi-item workloads; honesty fix is immediate
(description is currently misleading).

## Promotion criteria
Runtime seat confirms child-run scheduling capacity and result-join contract;
UI has a wait/park story for long children (ties into existing wait rendering).

## Validation ideas
Compiler test: N async children complete out of order, Gather returns ordered
results; UI renders child runs in the subrun tree.

## Non-goals
No general dataflow-parallel execution of arbitrary branches in v1.

## Guidance for future agents
The honest-description half (Parallel docstring/catalog text) is shippable
flow-side immediately and should not wait for the async work.
