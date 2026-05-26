# Code Editor Test Result Stability

## Date

- Completed: 2026-05-25

## Status

Completed

## Priority

P1

## Context / Problem Statement

The Code editor modal had the right overall shape after item `0079`, but testing a Code node could still make the UI feel unstable: graph tooltips could render above the editor modal because they use a high-z-index portal, and the right-side variables/test panel could compete for height when the full-width result terminal opened.

Gateway code simulation also returned timing metrics without the `execution.permissions` field that normal Runtime Code-node execution already records, making editor tests slightly less faithful than real flow runs.

## Decision

Keep the Code node abstraction as already designed: display name `Code`, Python `transform(_input)` body for now, `permissions` as the execution-policy input, and one extensible `execution` object output for duration, CPU, memory, and policy metadata. Do not add a separate timing-only pin.

Harden the editor modal locally: keep the result as a folded full-width bottom terminal, suppress graph tooltip portals while the editor is open, and make the right panel a contained two-row grid so the variable list and test payload remain stable when results expand.

## Scope

- Keep Code editor result output folded by default and expanded when tests run.
- Prevent graph tooltip portals from visually covering the Code editor modal.
- Stabilize the right-side variable and test input layout while the result terminal is open.
- Add `execution.permissions` to Gateway code simulation responses for parity with normal Runtime Code-node execution.
- Add regression coverage for connected `permissions` inputs driving normal Runtime execution while staying out of `_input`.

## Non-goals

- Do not implement multi-language Code nodes.
- Do not implement dependency packaging for custom code.
- Do not add a second `execution_time` output while the `execution` object is the canonical metrics carrier.
- Do not make `full_access` available without the explicit Runtime host policy.

## Validation

- `pytest abstractflow/tests/test_python_code_node_params.py abstractgateway/tests/test_gateway_code_simulation.py -q`
- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_code_node_editor_layout_and_contract_are_explicit -q`
- `npm --prefix abstractflow/web/frontend run build`

## Report

The editor overlay now suppresses portal-rendered graph tooltips while it is open. The Code editor side panel uses deterministic grid containment, and the test payload textarea shrinks slightly when the bottom result terminal is open instead of pushing or overlapping the variables panel. Gateway code simulation now annotates metrics with the effective permission mode just like normal Runtime Code-node execution. Runtime tests cover connected `permissions` input behavior so the execution policy can be wired without leaking that control value into user code payloads.
