# Run Resume And Exec Backedge Routing

## Date

- Completed: 2026-05-24

## Status

Completed

## Priority

P1

## Context / Problem Statement

In the Run Flow modal, answering an `ask_user` wait with the Continue action could be followed by a full page navigation/reset or crash in the browser. Gateway logs showed the resume command itself succeeded, and the run continued through the LLM and voice nodes before looping back to `ask_user`, so the issue was in the Flow client event boundary rather than the Gateway/Runtime resume path. A second pass found the concrete crash: `node_complete` records for `ask_user` may have no result payload, and the run-step model metadata extraction read `result.scratchpad` without guarding that shape.

The same dialogue flow also exposed an execution-edge readability issue: the back edge from `Generate Voice` to `Ask User` was routed below the graph, colliding visually with the node layout instead of taking the shorter clear upper lane.

## Decision

Keep resume as the existing Gateway command. Make `RunFlowModal` the only Ask User resume surface, with controls that explicitly consume default browser behavior, prevent duplicate resume clicks while the command is in flight, and mark modal/footer buttons as non-submit actions. Centralize run-step model metadata extraction behind a guarded helper so empty node results and partial scratchpad entries do not crash modal rendering. Update the custom React Flow execution edge router so back edges prefer a clear lane above the source/target nodes and only fall back when that lane intersects another node.

## Scope

- Harden `RunFlowModal` Ask User resume controls.
- Remove the separate `UserPromptModal` prompt path, its Toolbar wiring, and its unused styles.
- Guard and centralize model/provider extraction for run-step rows and output previews.
- Add obstacle-aware upper-lane selection for loop-back execution edges in `Canvas`.

## Non-goals

- Do not change Gateway command semantics.
- Do not change Runtime wait-key generation or the `ask_user` node contract.
- Do not redesign node handles or introduce a graph layout engine.

## Validation

- `npm run build` in `abstractflow/web/frontend`.
- `git diff --check` for the touched frontend files.
- `python -m pytest tests/test_frontend_gateway_contract.py` in `abstractflow`.

## Report

The client now treats Ask User resume as an explicit in-app action inside `RunFlowModal`: the click is stopped, default navigation is prevented, the button disables while resume is being submitted, and waiting events reopen the run modal directly. The deleted prompt fallback removes the old parallel response path. Run-step model metadata extraction now tolerates undefined results and scratchpad steps without `effect` payloads. Execution back edges now choose a clear upper route first, so looped dialogue flows route back to the earlier Ask User node above the row instead of underneath it when that path is available.
