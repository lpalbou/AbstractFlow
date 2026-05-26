# Completed: Flow Pin And Code Regression Repair

## Metadata
- Created: 2026-05-25
- Status: Completed
- Completed: 2026-05-25

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Recent AbstractFlow authoring changes regressed core graph editing behavior. User reports show
execution links that cannot be removed from their pins, execution triangles no longer indicating
connected state, overly permissive data-pin wiring, confusing authoring-run language, and Code-node
execution failing because visible input links are not reflected cleanly in the executed code.

## Current code reality
- `web/frontend/src/components/nodes/BaseNode.tsx` excludes `exec-in` and `exec-out` from
  connected pin sets even though execution triangle fill and pin disconnect use those sets.
- `web/frontend/src/utils/validation.ts` treats `any` as accepting every type and still bridges
  provider/model pins into `string`, which lets control-like provider/model values wire into generic
  payload pins.
- `web/frontend/src/hooks/useFlow.ts` drops saved edges with missing handles, but does not re-run
  the canonical connection validator during load.
- `web/frontend/src/utils/codegen.ts` can generate Code-node variables from pins, but stale saved
  Code wrappers can miss variables when `codeBody` and `inputs` drift.
- Toolbar and run modal copy says `Test Draft` / `New Draft Test`, which over-exposes internal
  lifecycle terminology for normal authoring tests.

## Problem
The visual editor no longer enforces clear pin contracts or reliably reflects graph state. This
makes simple authoring actions feel broken and can lead to saved flows that run with stale code or
invalid edges.

## What we want to do
Repair the reported regressions at their source with minimal, maintainable changes.

## Why
AbstractFlow is an authoring framework. Users need pin contracts, connection state, and authoring
test runs to be predictable before broader workflow lifecycle or palette improvements matter.

## Requirements
- Execution pins must visibly show connected state and support the existing explicit pin-disconnect
  behavior for `exec-in` / `exec-out`.
- Connection validation must reject provider/model/control-like values into generic `any` or
  accidental `string` inputs unless the receiving pin is explicitly provider/model compatible.
- Loading a saved flow must not keep edges that fail the canonical connection validator.
- Code nodes with `codeBody` must execute with a wrapper regenerated from the current Code-node
  input pins.
- Authoring-run UI copy should avoid `draft` terminology in primary controls.

## Suggested implementation
- Include execution handles in BaseNode connected-pin state, while keeping any layout-specific
  filtering local if needed.
- Tighten `areTypesCompatible` for provider/model control values before the generic `any` case.
- Apply `validateConnection` when filtering loaded edges, excluding the candidate edge itself.
- Regenerate Code-node `data.code` from `data.codeBody` and current inputs during node
  normalization, and add a runtime-side guard if needed.
- Rename visible authoring-run controls to plain `Run` / `New Run`.

## Scope
- AbstractFlow frontend graph editing state and validation.
- AbstractFlow Code-node saved-flow normalization.
- Focused tests for the reported regressions.

## Non-goals
- Do not redesign the full run/publish lifecycle.
- Do not implement broad backlog items or unrelated Flow UX features.
- Do not rewrite Code-node permissions or language support.
- Blueprint-style edge-drop action menus are a follow-up unless a small existing hook can be wired
  without changing the connection model.

## Dependencies and related tasks
- Related completed items: `0079_code_node_editor_execution_policy.md`,
  `0081_code_editor_test_result_stability.md`, `0086_live_connection_feedback.md`.

## Expected outcomes
- Existing execution links can be identified and removed from pins again.
- Invalid provider/model-to-generic edges are rejected immediately and pruned on load.
- Code-node authoring tests do not fail from stale wrapper variables after inputs change.
- Primary authoring controls describe tests as tests, not as draft lifecycle operations.

## Validation
- Focused frontend contract tests for BaseNode exec connected-state source, validation policy,
  saved-flow edge filtering, and authoring-run labels.
- Focused runtime or frontend Code-node test proving stale wrappers are regenerated from
  `codeBody` plus current inputs.
- Frontend build if the patch touches TypeScript/React code.

## Progress checklist
- [x] Confirm root causes with three subagent critiques and local code inspection.
- [x] Patch execution pin connected-state and connection validation.
- [x] Patch Code-node wrapper regeneration.
- [x] Patch authoring-run labels.
- [x] Run focused tests/build and record completion evidence.

## Guidance for the implementing agent
Keep the patch narrow. Prefer existing validation, node normalization, and codegen helpers. Do not
paper over invalid saved flow state with UI-only workarounds.

## Completion report
- Execution pin connection state now includes `exec-in` and `exec-out`, restoring filled triangles
  and existing pin-disconnect behavior.
- Provider/model pins are now nominal values that only connect to provider/model-compatible pins,
  so they no longer wire into generic `any` or accidental `string` inputs.
- Saved-flow loading re-runs canonical connection validation after handle migration and drops
  invalid edges.
- Code nodes regenerate executable wrappers from `codeBody` plus current input pins in both
  frontend normalization and Runtime execution, preventing stale saved `data.code` from hiding
  missing variables.
- Authoring-run visible copy now says `Run` and `New Run` without exposing draft/test lifecycle
  wording.

## Validation evidence
- `pytest abstractflow/tests/test_python_code_node_params.py`
- `pytest abstractflow/tests/test_frontend_gateway_contract.py`
- `pytest abstractflow/tests/test_python_code_node_params.py::test_python_code_node_regenerates_wrapper_from_body_and_current_inputs`
- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_pin_contract_rejects_control_values_into_generic_inputs`
- `npm run build` in `abstractflow/web/frontend`
