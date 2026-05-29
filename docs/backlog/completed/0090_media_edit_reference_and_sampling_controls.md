# Completed: Media Edit Reference Fidelity and Sampling Controls

## Metadata
- Created: 2026-05-27
- Completed: 2026-05-27
- Status: Completed

## Problem

Run `e30bb129-1037-412a-ae4c-ab0c76153d57` showed Generate Image correctly producing a sword, then Edit Image producing an unrelated pencil sketch. The ledger proved the source artifact was wired into the edit effect, so the issue was downstream of the canvas edge. At the same time, image/video media nodes hid seed and guidance controls behind advanced disclosure, making deterministic local media runs hard to tune from the default node surface.

## Changes

- Routed AbstractVision MLX-Gen FLUX.2 image edits through MLX-Gen's dedicated `Flux2KleinEdit` class with `image_paths` instead of reusing the text-to-image `Flux2Klein` img2img path.
- Ranked MLX-Gen `image_to_image` catalog results by edit suitability so dedicated edit models, especially `AbstractFramework/qwen-image-edit-2511-4bit`, are surfaced ahead of broad text/image models.
- Preserved artifact media `role`/`purpose`/`kind` when Runtime materializes artifact-backed media into temporary files, protecting source/mask semantics for image edits.
- Split image edit model residency/catalog authoring from generic image generation as `image_to_image` through Core, Runtime, Gateway, and Flow, while keeping shared backend-cache semantics.
- Kept `seed` and `guidance_scale` visible by default on image and video generation/edit nodes while leaving deeper tuning such as steps, negative prompt, and extra options behind advanced disclosure.
- Added missing `seed` and `guidance_scale` pins to hidden compatibility templates for `image_to_image` and `text_to_video`.

## Validation

- Ledger audit for run `e30bb129-1037-412a-ae4c-ab0c76153d57` confirmed the edit node received the generated sword artifact as `role=source`; the failure was model/path selection, not the Flow edge.
- Real MLX-Gen smoke against the run's source artifact showed `AbstractFramework/flux.2-klein-4b-4bit` now uses the edit variant but is not the best structure-preserving default for pencil-sketch edits; `AbstractFramework/qwen-image-edit-2511-4bit` produced the expected sword-preserving pencil sketch.
- Focused AbstractVision MLX-Gen backend test covers FLUX.2 edit routing through the edit variant and source dimensions.
- Runtime media artifact resolution test covers role preservation for source/mask images.
- Core, Runtime, Gateway, and Flow tests cover `image_to_image` residency/catalog task propagation and avoid duplicate shared vision-cache records.
- Runtime and Flow VisualFlow media node tests cover seed/guidance pass-through for image, image edit, video, and image-to-video outputs.
- Frontend gateway contract test covers default visibility for image/video seed and guidance pins plus compatibility-template coverage.
- Flow frontend production build passes.
