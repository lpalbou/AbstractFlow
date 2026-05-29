# Planned: Run Modal Artifact Input Picker

## Metadata
- Created: 2026-05-28
- Status: Completed
- Completed: 2026-05-28
- Owner: AbstractFlow
- Depends On: `completed/0091_gateway_artifact_import_export_contract.md`

## Context

Flow pins already distinguish artifact modalities: generic artifact, image, audio, text, and video. The run modal can display generated artifacts after a run, and the Properties panel has an artifact literal upload control. However, run-start inputs still render artifact pins as plain text fields.

## Current Code Reality

- `RunFlowModal.tsx` maps unknown pin types to text inputs through `getInputTypeForPin`.
- `RunFlowModal.tsx` already has artifact preview/extraction helpers for run outputs.
- `PropertiesPanel.tsx` has `ArtifactLiteralPanel`, which uploads browser files into Gateway artifacts and stores an artifact ref.
- `ArtifactPlayer.tsx` can preview image/audio/video/text-ish artifacts from Gateway content URLs.

## Problem

Users need to provide images, audio, video, documents, text, JSON, music, or voice artifacts at run start without manually pasting artifact ids. The current plain text field is error-prone and leaks storage details into normal workflow operation.

## What We Want

For run-start pins of type `artifact`, `artifact_image`, `artifact_audio`, `artifact_text`, and `artifact_video`, the run modal should offer a first-class artifact input control with three sources:

- upload a browser-local file
- import a Gateway workspace path as an artifact
- select an existing visible artifact from the current run/session context

The submitted `input_data` must contain canonical artifact ref objects, not bytes and not raw paths.

## Requirements

- Filter existing artifacts by pin modality using content type and artifact tags.
- Preview selected artifacts with `ArtifactPlayer` where possible.
- Preserve generic artifact pins for documents and other binary blobs that do not map cleanly to image/audio/video/text.
- Submit stable refs with `$artifact`, `artifact_id`, owner `run_id`, `content_type`, `filename`, and sha256 when available.
- Show clear errors when Gateway does not advertise upload/import/list/content capabilities.
- Keep Flow as UX only; no browser-side path policy or artifact persistence.

## Suggested Implementation

- Extract a reusable `ArtifactInputField` from the upload/ref logic already used by `ArtifactLiteralPanel`.
- Add a Gateway client helper for artifact import and, when available, session-visible artifact listing.
- Extend run modal form initialization so artifact refs are stored as structured JSON instead of stringified text.
- Add source tabs or segmented controls: Upload, Workspace Path, Existing Artifact.
- Use modality-specific search placeholders such as "Search image artifacts..." and "Search audio artifacts...".

## Non-Goals

- No client access to arbitrary local filesystem paths.
- No artifact format conversion or editing in the picker.
- No cross-user global artifact library until Gateway defines ownership and retention semantics.

## Validation

- Frontend tests cover artifact pin rendering as picker controls, not text inputs.
- Tests verify upload, workspace import, and existing artifact selection produce canonical JSON refs in `input_data`.
- Tests cover modality filtering for image/audio/video/text/generic artifact pins.
- Tests cover missing Gateway capability descriptors and disabled controls.
- Manual smoke: start a flow with an image artifact input and wire it into Edit Image or Image To Video.

## Progress Checklist

- [x] Add reusable artifact input field component.
- [x] Add Gateway client helpers for import/list/content descriptors.
- [x] Update run modal artifact pin rendering.
- [x] Add modality filtering and previews.
- [x] Add frontend contract tests.
- [x] Update user docs with run-start artifact examples.

## Completion Report

- Completed: 2026-05-28
- Summary: Added a first-class Run modal artifact input control for generic/image/audio/text/video artifact pins. It supports existing session artifacts, browser upload, Gateway workspace import, modality filtering, previews through `ArtifactPlayer`, and canonical JSON ref submission.
- Code touched:
  - `abstractflow/web/frontend/src/components/ArtifactInputField.tsx`
  - `abstractflow/web/frontend/src/components/RunFlowModal.tsx`
  - `abstractflow/web/frontend/src/utils/artifactInputs.ts`
  - `abstractflow/web/frontend/src/utils/gatewayClient.ts`
  - `abstractflow/web/frontend/src/styles/index.css`
- Tests:
  - `abstractflow/tests/test_frontend_gateway_contract.py`
- Docs:
  - `abstractflow/docs/getting-started.md`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/docs/api.md`
  - `abstractflow/docs/faq.md`
  - `abstractflow/llms.txt`
  - `abstractflow/llms-full.txt`
- Validation:
  - `python -m pytest tests/test_frontend_gateway_contract.py -q` in `abstractflow` passed.
  - `npm run build` in `abstractflow/web/frontend` passed.
- ADR impact: None. The picker is a UX layer over advertised Gateway routes and does not introduce a new persistence or filesystem authority rule.
- Residual risks: The current test suite validates helper normalization and contract compatibility. A browser-level component test can be added later if the project adopts a React test harness for modal interactions.
