# Completed: Gateway-aware palette and preflight

## Metadata
- Created: 2026-05-25
- Status: Completed
- Completed: 2026-05-25

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Recent AbstractFlow work made media nodes first-class, made artifact pins modality-aware, and added live connection feedback. The editor now helps users wire compatible graphs, but it can still offer node types the connected Gateway cannot execute.

## Current code reality
- `web/frontend/src/components/NodePalette.tsx` renders every visible node template as draggable.
- `web/frontend/src/types/nodes.ts` defines node templates but does not declare Gateway capability requirements.
- `web/frontend/src/utils/gatewayClient.ts` already computes optional Gateway feature readiness for generated image, edited image, generated voice, generated music, tools, KG memory, and model residency.
- `web/frontend/src/utils/preflight.ts` checks graph input completeness and artifact modality issues, but not Gateway capability availability.
- `web/frontend/src/components/Toolbar.tsx` runs preflight before opening the Run modal and already has Gateway readiness in scope.

## Problem
A user can build a cleanly wired workflow with a media or residency node that is unavailable on the connected Gateway. That failure arrives too late, usually at run time, and reads like a backend problem rather than an authoring constraint.

## What we want to do
Make authoring capability-aware:
- keep unavailable nodes visible in the palette so users know the feature exists;
- disable dragging for nodes that the current Gateway cannot execute;
- show compact capability status in the palette;
- keep saved-flow nodes renderable even if a capability is unavailable;
- add Run preflight issues for reachable nodes whose required Gateway capability is unavailable.

## Why
Live typed wiring is useful only if the target execution surface is also truthful. The editor should prevent impossible workflows early while still communicating what the framework can support when the right plugins/routes are enabled.

## Requirements
- Use existing Gateway readiness abstractions instead of probing routes from the palette.
- Do not hide unavailable nodes; dim/disable them with a clear reason.
- Do not delete or mutate existing saved-flow nodes when a capability is unavailable.
- Block drag start for known-unavailable palette cards.
- Keep Search behavior unchanged: disabled nodes should still be discoverable.
- Preflight should report capability issues only for reachable execution nodes.
- Keep the first slice focused on already-known optional Gateway capabilities.

## Suggested implementation
- Add `gatewayCapability` metadata to `NodeTemplate`.
- Add a helper in `gatewayClient.ts` that maps node capability requirements to `{available, checking, reason}`.
- Let `NodePalette.tsx` consume `useGatewayCapabilities` / `getGatewayFlowEditorReadiness` and apply disabled card UI.
- Extend `computeRunPreflightIssues(...)` to accept optional Gateway readiness and emit capability issues for reachable nodes.
- Pass Gateway readiness from `Toolbar.tsx` into preflight.
- Add source/contract tests and helper behavior tests.

## Scope
- AbstractFlow frontend node template metadata.
- Node palette capability status rendering.
- Run preflight capability checks.
- Focused frontend contract tests.
- Backlog overview and completion trace.

## Non-goals
- No Gateway route or capability contract changes.
- No browser E2E suite in this item.
- No plugin installer flow.
- No hiding unsupported saved-flow nodes.
- No capability checks for future embeddings/rerank nodes until their authoring nodes exist.

## Dependencies and related tasks
- `completed/0086_live_connection_feedback.md`
- `proposed/2026-05-08_gateway_capability_profile_alignment.md`
- `completed/050_gateway_execution_regression_suite.md`

## Expected outcomes
- If generated voice is unavailable, `Generate Voice` remains visible but cannot be dragged from the palette and explains why.
- If an existing reachable `Generate Voice` node is already in the graph, Run preflight reports the missing Gateway capability before the run modal opens.
- If capability discovery is still loading, palette cards show a checking state instead of pretending support is known.
- Core nodes without Gateway capability metadata behave unchanged.

## Validation
- Frontend contract/source test for palette capability metadata and drag blocking.
- Helper behavior test for available/unavailable/checking capability states.
- Preflight behavior test for reachable capability issues.
- Frontend build.
- Diff check.

## Progress checklist
- [x] Add node capability metadata.
- [x] Add Gateway authoring capability helper.
- [x] Wire palette disabled/checking status.
- [x] Add preflight capability issues.
- [x] Add focused tests.
- [x] Record completion evidence.

## Guidance for the implementing agent
Keep the capability mapping small and explicit. This item is about truthful authoring feedback, not a new discovery subsystem.

## Completion report
- Date: 2026-05-25
- Summary: Added a shared authoring-capability map for Gateway-dependent nodes, exposed capability requirements on node templates, dimmed and drag-blocked known-unavailable palette cards, and extended Run preflight to report reachable nodes whose Gateway capability is unavailable.
- Files and symbols touched:
  - `web/frontend/src/utils/nodeCapabilities.ts`: new explicit node-to-Gateway-capability mapping.
  - `web/frontend/src/utils/gatewayClient.ts`: `gatewayAuthoringCapabilityStatus(...)`.
  - `web/frontend/src/types/nodes.ts`: `NodeTemplate.gatewayCapability` and metadata for media, model residency, tools, and KG memory nodes.
  - `web/frontend/src/components/NodePalette.tsx`: Gateway-aware checking/unavailable palette status and drag blocking.
  - `web/frontend/src/utils/preflight.ts`: optional Gateway readiness input and reachable-node capability issues.
  - `web/frontend/src/components/Toolbar.tsx`: passes Gateway readiness into Run preflight.
  - `web/frontend/src/styles/palette.css`: compact unavailable/checking badges.
  - `tests/test_frontend_gateway_contract.py`: source and runtime contract coverage for the new behavior.
- Validation:
  - `pytest tests/test_frontend_gateway_contract.py::test_frontend_gateway_authoring_capabilities_gate_palette_and_preflight tests/test_frontend_gateway_contract.py::test_frontend_preflight_catches_required_media_inputs -q`
  - `pytest tests/test_frontend_gateway_contract.py -q`
  - `npm run build` from `web/frontend`
  - `git diff --check`
- Behavior changes:
  - Palette search still finds capability-dependent nodes, but known-unavailable Gateway surfaces show a themed status badge and cannot be dragged into a new graph.
  - Existing saved-flow nodes are not deleted or hidden; Run preflight reports capability issues only when those nodes are reachable by execution flow.
  - Capability discovery loading/unknown states are treated as checking, not as a false negative.
- ADR impact: None. This implements the existing Gateway-first authoring boundary without establishing a new durable architecture rule.
- Residual risks: The first slice covers only capabilities already represented by the Gateway readiness object. STT/listen/input-capture capability readiness needs a future explicit Gateway contract before it should be used for palette gating.
- Follow-ups: Covered by existing Gateway capability profile alignment and execution regression backlog items; no new backlog item created.
