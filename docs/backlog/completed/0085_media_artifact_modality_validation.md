# Completed: Media artifact modality validation

## Metadata
- Created: 2026-05-25
- Status: Completed
- Completed: 2026-05-25

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
Media nodes and artifact literal nodes currently expose artifact references as generic `object` pins. That hides the most important authoring fact from the canvas: an image artifact is not a valid input for transcription, and an audio artifact is not a valid image mask.

## Current code reality
- `web/frontend/src/types/flow.ts` has scoped artifact pin types: generic, image, audio, text, and video.
- `web/frontend/src/types/nodes.ts` defines media artifact pins with scoped artifact types, with `artifact_ref` as a generic artifact pin and `outputs`/`meta` left as plain objects.
- `web/frontend/src/utils/mediaArtifacts.ts` is the shared source for artifact modality detection, connection compatibility, and configured-default checks.
- `web/frontend/src/utils/validation.ts` rejects known artifact modality mismatches with specific error messages before falling back to generic object compatibility.
- `web/frontend/src/utils/preflight.ts` flags incompatible connected artifact edges and incompatible configured artifact defaults before a run.
- `web/frontend/src/hooks/useFlow.ts` canonicalizes saved media node inputs and outputs so older flows regain the typed pin UX when opened.
- Artifact literal defaults store `content_type` and `modality`, and that metadata is used by preflight for configured defaults.
- Two read-only subagent audits on 2026-05-25 recommended typed artifact pins plus one small shared helper; a later two-agent critique recommended output canonicalization and clearer generic artifact typing.

## Problem
Users can wire media artifacts incorrectly without immediate canvas feedback, and run preflight does not distinguish missing artifacts from mismatched artifact modalities.

## What we want to do
Make media artifact modality visible in pin types and enforce it through shared connection/preflight logic.

## Why
This improves the core visual editing experience: the graph should communicate whether a value is image media, audio media, text artifact output, video media, or a generic object.

## Requirements
- Add scoped artifact pin types for image, audio, text, video, and a generic artifact escape hatch.
- Update new media node templates and artifact literal nodes to emit typed artifact pins.
- Keep `artifact_ref`, `outputs`, and `meta` generic object pins where they are not modality-specific.
- Add a shared pure helper for artifact modality detection and compatibility.
- Use the helper in connection validation and connection error messages.
- Use the helper in run preflight so saved/old incompatible edges are flagged before run.
- Preserve generic `object` as an advanced escape hatch for code/tool/custom object workflows.
- Do not add runtime endpoint changes in this slice.

## Suggested implementation
- Add `web/frontend/src/utils/mediaArtifacts.ts`.
- Extend `PinType` and `PIN_COLORS`.
- Replace modality-specific artifact pins in templates/canonical media pins with typed artifact pins.
- Update `validation.ts` to reject known mismatches before generic object compatibility.
- Update `preflight.ts` to report connected/default artifact modality mismatches.

## Scope
- Frontend type definitions, node templates, visual compatibility metadata.
- Frontend validation/preflight helpers.
- Focused frontend contract tests.
- Backlog overview/completion trace.

## Non-goals
- No artifact metadata network lookup during preflight.
- No runtime media handler changes.
- No broad run-modal artifact preview rewrite.
- No full hover-target highlighting pass; connection drop errors and preflight messages are the first slice.

## Dependencies and related tasks
- `completed/0083_media_node_advanced_pin_disclosure.md`
- `completed/0084_media_defaults_single_editor_surface.md`

## Expected outcomes
- Image artifacts connect to image artifact inputs.
- Audio artifacts connect to transcription/audio artifact inputs.
- Known image/audio/text/video mismatches are rejected with modality-specific messages.
- Existing generic object workflows remain possible.

## Validation
- Focused pytest/Node contract tests for `validateConnection`, `getConnectionError`, and `computeRunPreflightIssues`.
- Frontend build.
- Diff check for touched files.

## Progress checklist
- [x] Add typed artifact pins.
- [x] Add shared helper.
- [x] Wire validation.
- [x] Wire preflight.
- [x] Add behavior tests.
- [x] Record completion evidence.

## Guidance for the implementing agent
Prefer one readable helper over scattered pin-id checks. The helper should model what the user sees: image artifact, audio artifact, text artifact, video artifact, or generic object.

## Completion report

### Date
- Completed: 2026-05-25

### Summary
Media artifact authoring is now modality-aware in the Flow editor. Image, audio, text, video, and generic artifacts have distinct pin types and colors; media templates and artifact literal nodes emit typed artifact pins; saved media nodes are normalized back to the canonical typed pin contract; and connection validation/preflight now reject known mismatches with modality-specific messages.

### Files and symbols touched
- `web/frontend/src/types/flow.ts`: added artifact pin types and distinct artifact colors.
- `web/frontend/src/types/nodes.ts`: changed media artifact pins and artifact literals to typed artifact pins; changed `artifact_ref` to the generic `artifact` pin type while keeping `outputs` and `meta` as raw objects.
- `web/frontend/src/utils/mediaArtifacts.ts`: added shared artifact modality detection, compatibility, connection-error, and configured-default helpers.
- `web/frontend/src/utils/validation.ts`: wired artifact compatibility into route override inference, connection validation, and connection error text.
- `web/frontend/src/utils/preflight.ts`: added connected-edge and configured-default artifact modality checks.
- `web/frontend/src/hooks/useFlow.ts`: canonicalizes saved media node inputs and outputs against current templates.
- `web/frontend/src/utils/visualFlowCompat.ts`: keeps compatibility-generated music artifact outputs typed as audio/generic artifact pins.
- `tests/test_frontend_gateway_contract.py`: added executable frontend behavior tests for validation and preflight.

### Behavior changes
- Image artifacts connect to image edit/mask/source inputs.
- Audio, voice, and music artifacts connect to audio transcription inputs.
- Known image/audio/text/video mismatches are rejected immediately by canvas validation and reported by run preflight for saved or old flows.
- Media node `outputs` and `meta` object payloads no longer masquerade as artifact references.
- Generic `object` remains available as an advanced escape hatch for Code/tool/custom object workflows.

### Validation
- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_exposes_gateway_media_node_templates abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_media_artifact_validation_is_modality_aware abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_preflight_catches_required_media_inputs -q`
- `npm --prefix abstractflow/web/frontend run build`

### Residual risks and follow-ups
- Live drag-hover target highlighting is still a separate UX improvement; this item covers typed pins, drop validation, and run preflight.
- Artifact metadata is not fetched during preflight by design; configured string artifact ids remain unverified unless represented as typed artifact objects with metadata.
- Generic object-to-artifact connections remain allowed for advanced workflows and should be revisited only if a stronger typed custom-output story lands.
