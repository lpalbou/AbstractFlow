# Completed: Media defaults single editor surface

## Metadata
- Created: 2026-05-25
- Completed: 2026-05-25
- Status: Completed

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
AbstractFlow media nodes already expose scoped provider/model pins and share a canvas-side advanced pin disclosure helper. The selected-node right panel still had a separate `Gateway Media` section that edited media settings through a different path.

## Current code reality
- `abstractflow/web/frontend/src/components/nodes/BaseNode.tsx` has themed `AfSelect` controls for scoped media pins and hides connected advanced pins unless expanded.
- `abstractflow/web/frontend/src/components/PropertiesPanel.tsx` has a generic `Input values` section for pin defaults.
- Before this item, `PropertiesPanel.tsx` also rendered a separate `Gateway Media` section that used native selects and wrote `effectConfig` for image, TTS, STT, and music controls.
- Runtime applies `pinDefaults` to unconnected input pins before handlers read payload/config, so duplicate side-panel media controls could show values that were not the actual effective input.

## Problem
The side panel exposed two mental models for media configuration: pin defaults and `Gateway Media` settings. This made the UI brittle, especially when provider/model pins were connected and static side-panel settings were ignored by execution.

## Outcome
- Removed the duplicate `Gateway Media` section from `PropertiesPanel`.
- Extended the existing `Input values` section so scoped media provider/model/voice/quality/format defaults use themed `AfSelect` controls.
- Connected media pins continue to render as read-only `Provided by connected pin.`
- Media right-panel provider/model defaults now share the pin-default mental model instead of presenting a separate media configuration surface.
- BaseNode image provider-specific default normalization now returns early when `image_provider` is connected, preventing stale static providers from rewriting image sizing/sampling defaults.

## Scope Completed
- `web/frontend/src/components/PropertiesPanel.tsx`
- `web/frontend/src/components/nodes/BaseNode.tsx`
- `tests/test_frontend_gateway_contract.py`
- Backlog overview

## Non-goals Preserved
- No runtime media endpoint changes.
- No artifact modality type-system migration.
- No shared media catalog hook extraction.
- No broad `effectConfig` migration outside the media side-panel UX.

## Validation
- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_media_nodes_use_shared_advanced_pin_presentation abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_exposes_gateway_media_node_templates -q`
- `npm --prefix abstractflow/web/frontend run build`
- `git -C abstractflow diff --check -- web/frontend/src/components/PropertiesPanel.tsx web/frontend/src/components/nodes/BaseNode.tsx tests/test_frontend_gateway_contract.py docs/backlog/overview.md docs/backlog/completed/0084_media_defaults_single_editor_surface.md`

## Follow-ups
- Artifact pin modality should become explicit (`artifact_image`, `artifact_audio`, etc.) or receive semantic preflight validation. This remains outside this item.
- A future pass should extract shared media catalog selector logic between BaseNode and PropertiesPanel if more media control surfaces are added.
