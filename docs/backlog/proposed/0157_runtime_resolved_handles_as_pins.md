# 0157 — Draw runtime-resolved handles as real pins

- Status: PROPOSED 2026-09-26 (operator ruling on review 14: badge now, pins later).
- Owner: flow (runtime lane for the `child_output` declaration bug).

## The problem (measured over examples/flows + the bundled catalog)

336 stored connections in 24 shipped flows (entity-chat 8 of 22, coding-agent,
coding-verify-gates, deep-research, diagram-render, the entity-* family) wire
handles that are not declared pins: a code node's returned dict keys
(`visit_guard.value/died/error`, `degraded_fold.degraded`, ...) and a subflow's
`child_output`. The runtime resolves them by key; the editor cannot draw them.
A few more (9 in `4050e15e`, `multi_agent_state_machine`) are refused by the
editor's nominal connection rules (model/provider_text -> string).

Today `loadFlow` keeps them verbatim (`preservedEdges`), `getFlow` saves them
back, and every node with such edges carries a persistent "N hidden" badge whose
tooltip lists them. They cannot be selected or deleted one by one.

## Direction

- Render an undeclared-but-wired handle as a dynamic "runtime" pin (drawn,
  selectable, deletable), WITHOUT writing a pin declaration into the document
  unless the author confirms it.
- Constraints that make "just declare the pin" unsafe today:
  - declaring `child_output` on a subflow node trips the compiler's
    `start_subworkflow` spread, which overwrites it with None
    (`scripts/build_entity_life_workflow.py` `subflow_node` docstring);
  - `error`/`output`/`success`/`result`/`execution` are reserved record keys on
    exec-lane code nodes (`scripts/wf_common.py` `_EXEC_RESERVED_OUTPUT_PINS`).
- Decide separately whether model/provider ids may connect to plain `string`
  pins (they are strings at runtime; the editor keeps them nominal on purpose).

## Acceptance

- Every preserved edge is visible and editable on the canvas; the badge only
  remains for edges that still cannot be drawn.
- `src/hooks/loadFlowEdges.test.ts` stays green (no stored edge lost).
