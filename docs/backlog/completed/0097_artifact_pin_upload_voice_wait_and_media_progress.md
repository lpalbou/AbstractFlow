# Completed: Artifact pin upload, voice wait capture, and media progress

## Metadata

- Created: 2026-06-02
- Completed: 2026-06-02
- Status: Completed

## Context

Flow media authoring had three related gaps:

- artifact input pins such as `image_artifact` and `audio_artifact` required a
  connected upstream pin or separate run-start input selection, even when the
  natural user action was to upload a file directly on the node;
- `Listen Voice` waits showed a text response box instead of a recording state,
  and resume payloads could not carry an uploaded audio artifact through the
  websocket resume helper;
- image generation/edit child runs did not expose the same progress contract as
  video, so Flow could not render reliable start/progress state for t2i/i2i.

## Current Code Reality

- AbstractFlow is a web-only editor. It must not execute local audio or
  inference logic.
- Gateway exposes browser upload routes and run wait/resume routes.
- Runtime media effects can receive an `on_progress` callback and append
  `abstract.progress` ledger events.
- Gateway direct video routes already advertised progress on the returned child
  run ledger.

## Completed Work

- Tightened connection-preview inference so execution handles only preview
  compatible execution handles even if a handle id cannot be resolved through
  the canonical pin map.
- Added node-level upload controls for unconnected artifact input pins. Uploads
  use Gateway attachment upload and persist the canonical artifact ref as the
  pin default.
- Added browser microphone capture for `Listen Voice` waits. Flow uploads the
  captured audio blob to Gateway, then resumes the Gateway wait with the audio
  artifact ref. Runtime/Gateway remain responsible for STT and execution.
- Widened the websocket resume payload helper so structured resume data such as
  `audio_artifact`, `artifact_ref`, and `artifact_id` is not dropped.
- Aligned direct image generation and image edit with the media child-run
  progress contract by returning/advertising `event_name="abstract.progress"`.
- Added an initial Runtime progress ledger record for generated-media effects
  that receive an injected progress callback, giving t2i/i2i a visible running
  state even when a backend only reports completion.
- Removed the stale Flow-side assumption that image generation defaults to
  `512x512`; image dimensions are now explicit user/provider overrides.

## Validation

- `npm run build` in `abstractflow`: passed.
- `python -m pytest abstractruntime/tests/test_visualflow_media_nodes.py abstractruntime/tests/test_visualflow_llm_call_multimodal_output.py -q`: `19 passed`.
- `PYTHONPATH="abstractruntime/src:abstractgateway/src:abstractcore:${PYTHONPATH:-}" python -m pytest abstractgateway/tests/test_generated_media_gateway_contract.py abstractgateway/tests/test_voice_audio_api_contract.py -q`: `11 passed`.
- `PYTHONPATH="abstractcore:abstractvision/src:${PYTHONPATH:-}" python -m pytest abstractcore/tests/server/test_server_vision_image_endpoints.py -q`: `25 passed`.

## Residual Risks

- Image progress remains backend-dependent. Backends that do not expose
  step-level callbacks still show start/final states only.
- Browser microphone recording depends on normal browser permission flow and
  `MediaRecorder` support.
- Node-level artifact uploads are a direct authoring affordance; broader
  artifact search/reuse remains covered by the existing artifact picker/search
  backlog.

