# Proposed: Flow Model Residency Controls

## Metadata
- Created: 2026-05-19
- Status: Implemented in Flow editor; keep as design record until released
- Completed: 2026-05-19

## Context

Flow already consumes Gateway capability contracts for provider/model discovery and generated media.
Gateway/Core now have a clear direction for model residency:

- Core owns `/acore/models/load`, `/acore/models/loaded`, and `/acore/models/unload`.
- Gateway should expose those through `/api/gateway/models/*`.
- Runtime should expose a `model_residency` effect for workflow-owned prewarm/list/unload actions.

Runtime/Gateway now expose a real end-to-end residency effect, so Flow should surface both:

- an operator panel for current Gateway/Core state;
- a first-class workflow node for deliberate, ledgered load/list/unload steps.

## Problem

Users need to see which models are currently resident and unload them when memory pressure matters.
Some flows also need explicit prewarm/unload steps around expensive local image models.

This must not confuse current operational state with run history. A model being loaded now is not
evidence that it was loaded when an old run executed.

## Proposed UI controls

Add a Gateway-backed "Loaded Models" panel in the editor toolbar:

- Fetch from `contracts.common.model_residency.endpoints.loaded` (or descriptor-compatible
  legacy keys).
- Show task, provider, model, state, resident, loaded, pinned, loaded_at, last_used_at, health,
  runtime_id/load_id, and source.
- Offer Load using the existing provider/model selectors.
- Offer Unload by runtime_id/load_id with confirmation.
- Label the panel as current Gateway/Core state, not run history.

If the contract is absent or unavailable, hide or disable the panel with an explicit unavailable
state.

Do not make model residency part of required Flow readiness. It is an optional optimization/control
plane like prompt-cache or generated-media capability details, not a prerequisite for save/run/history.

## Proposed workflow node

Add a first-class effect node named `Model Residency`. Runtime has `EffectType.MODEL_RESIDENCY`
and Gateway can execute it through the same residency path used by generation.

Inputs:

- `exec-in`
- `operation`: `load`, `list_loaded`, `unload`
- `task`: `text_generation`, `image_generation`, optionally `tts` and `stt`
- `provider`
- `model`
- `runtime_id`
- `options`
- `pin`
- `required`

Outputs:

- `exec-out`
- `success`
- `runtime`
- `models`
- `loaded_new`
- `unloaded`
- `meta`
- `warnings`
- `error`

Default behavior:

- `operation=load`, `task=image_generation`, `pin=true`, and `required=false`.
- `pin=true` means a successful load remains resident until an explicit unload or provider eviction.
- `required=false`, because residency is a speed/memory control, not semantic workflow data.
- If warmup fails and `required=false`, continue with `success=false` and warnings.
- If `required=true`, allow the Runtime effect to fail the step.
- Treat `loaded_new` as diagnostics in the UI, not as a recommended branch condition.

Task-specific selectors:

- Text generation should reuse `common.discovery.providers` and `provider_models`.
- Image generation should reuse `vision_provider_models?task=text_to_image`.
- TTS/STT should stay hidden or disabled until Gateway/Core advertise real support.

## Run/replay behavior

Flow must preserve ledger semantics:

- Live run progress displays the model residency step like any other effect step.
- Historical run rendering uses the recorded Runtime effect result.
- Historical rendering must not call the current `/models/loaded` endpoint to "complete" old step
  output.
- The current Loaded Models panel is separate from run replay.

## Optional preflight UX

After the explicit node exists, Flow can add an optional run preflight:

- Scan selected LLM/image nodes for provider/model ids.
- Offer "Preload selected models" before starting the run.
- Execute preloads through Gateway operator endpoints, outside the run ledger.
- Clearly label this as an optimization. For reproducible workflow behavior, users should add the
  `Model Residency` node.

Implemented sequence:

1. Gateway-backed Loaded Models panel for current operator state.
2. `Model Residency` node because Runtime/Gateway effect support exists.
3. Future: optional pre-run preload action and richer memory-pressure UX if the Gateway contract starts exposing memory size or eviction
   policy metadata.

## Expected Flow files

- `web/frontend/src/types/flow.ts`
- `web/frontend/src/types/nodes.ts`
- `web/frontend/src/hooks/useModelResidency.ts`
- `web/frontend/src/components/ModelResidencyPanel.tsx`
- `web/frontend/src/components/nodes/BaseNode.tsx`
- `web/frontend/src/components/PropertiesPanel.tsx`
- `web/frontend/src/components/RunFlowModal.tsx`
- `web/frontend/src/components/Toolbar.tsx`
- `web/frontend/src/utils/gatewayClient.ts`
- `abstractflow/visual/models.py`
- `abstractflow/visual/executor.py`
- frontend contract tests for the Gateway model residency descriptors
- `abstractruntime/visualflow_compiler` tests once the node is introduced

## Validation ideas

- Contract fixture tests for `common.model_residency`.
- UI tests for loaded model list parsing and empty/error states.
- Node serialization/compile tests for the `model_residency` effect payload.
- Replay test proving historical step output does not change when current loaded models change.
- Run modal test proving the current Loaded Models panel is independent from run history.
- Compile failure regression: do not ship a frontend node without matching Runtime `EffectType`,
  compiler lowering, and result mapping.

## Non-goals

- Do not add provider-specific memory controls to Flow.
- Do not make prewarm mandatory before Generate Image.
- Do not use Code nodes or tools as the primary model residency path.
- Do not make `loaded_new` a recommended branch condition.
