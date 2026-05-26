# Code Node Editor Execution Policy

## Date

- Completed: 2026-05-25

## Status

Completed

## Priority

P1

## Context / Problem Statement

The Code node editor had two confusing edges: opening a test result could collapse or crowd the right-side panels, and the execution policy was implicit even though custom code is a security-sensitive workflow primitive. The active node template already exposed `output`, `success`, and `execution`, but stale UI code still contained a separate Code renderer and the editor/test path did not carry an explicit permission mode.

## Decision

Keep `execution` as the standard metrics object output rather than adding a separate timing pin. Make `permissions` an explicit Code-node input with `sandbox` as the default and `full_access` as an opt-in policy mode. Full access is implemented only behind an explicit Runtime/Gateway environment policy and fails closed otherwise. The editor simulation endpoint and normal Runtime execution now share the same permission contract.

## Scope

- Rework the Code editor modal layout so the result is a full-width bottom terminal, folded by default and expanded when tests run.
- Remove the stale custom `CodeNode` renderer so all Code nodes use the shared `BaseNode` abstraction.
- Add the `permissions` Code input pin and dropdown controls on the node/properties panel.
- Advertise Code execution policy through the Gateway capabilities contract so Flow can disable unsupported modes.
- Keep `permissions` out of generated Python variables and out of the transform `_input` payload.
- Add Runtime/Gateway support for `sandbox` and policy-gated `full_access`.

## Non-goals

- Do not make full-access execution silently available.
- Do not implement multi-language Code nodes or dependency bundling here.
- Do not add a second timing-only output pin while the `execution` object already carries timing, CPU, and memory metrics.

## Validation

- `pytest abstractflow/tests/test_python_code_node_params.py abstractgateway/tests/test_gateway_code_simulation.py -q`
- `npm --prefix abstractflow/web/frontend run build`

## Report

The modal now has stronger grid/scroll containment: the Monaco editor and side inputs stay in the primary row, while result output opens as a deterministic full-width terminal dock at the bottom. Test results render a readable summary first with raw JSON available on demand, and rerenders no longer reset test output just because the parent rebuilt the parameter array. Code nodes now have a visible `permissions` selector driven by Gateway's `code_execution_policy_v1` contract. Sandbox remains the default and full access requires `ABSTRACTRUNTIME_CODE_FULL_ACCESS=1` in the Runtime host; otherwise Gateway/Runtime reject it with a clear error and Flow renders it as unavailable. Failed Runtime Code executions preserve the standard Code output envelope for observability. The old special `CodeNode` renderer was removed from the React Flow type map so there is one maintained Code node UI.
