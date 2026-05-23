# Truthful Model Residency UX

## Problem

Two different things are currently conflated in Flow:

1. the Runtime step lifecycle (`completed`, `failed`, `waiting`)
2. the semantic result of a `model_residency` operation (`ok:true/false`, `supported:true/false`)

For optional warmup steps (`required=false`), this creates a misleading UX:

- step lifecycle = `completed`
- step badge = `OK`
- actual result = `ok:false`, `supported:false`

So a no-op warmup can look indistinguishable from a real successful warmup.

There is also a secondary observability issue for generated media nodes:

- media steps can surface runtime orchestration model badges instead of the actual image/voice backend model,
  which makes warmup debugging harder.

## Goals

- Keep optional warmup/unload behavior
- Never show a no-op unsupported warmup as a plain success
- Make it obvious when media residency is unavailable in the current Gateway mode
- Keep the graph simple and the ledger reproducible

## Proposed Direction

### 1. Render `completed + ok:false` as skipped/unsupported

For `model_residency` steps:

- `status=completed` and `result.ok=true` => `OK`
- `status=completed` and `result.supported=false` => `UNSUPPORTED`
- `status=completed` and `result.ok=false` => `SKIPPED`
- `status=failed` => `FAILED`

The run should still be overall successful when `required=false`, but the step itself must not look green.

### 2. Gate inline warm/unload shortcuts using Gateway contract support

If `contracts.common.model_residency.supports.image_generation` is false, disable image warmup shortcuts and explain why:

- “Requires a long-lived AbstractCore server”

Same for `tts` and `stt`.

Do not stop users from creating an explicit node if they deliberately want a ledgered skipped/unsupported step, but the common
shortcut path should not imply availability when the contract says otherwise.

### 3. Distinguish runtime model from media model in the run modal

For generated image/voice/transcription steps, show the actual media backend/provider model separately from any runtime
orchestration provider/model.

Warmup analysis is much harder when a generated-image step is labeled with the chat/runtime model.

### 4. Keep the same node surface

No new warmup node type is needed.

Keep using:

- the existing `model_residency` node
- inline “Warm before” / “Unload after” shortcuts
- the Loaded Models panel

## Acceptance Criteria

- Optional unsupported warmup steps render as skipped/unsupported, not green success.
- Inline warm/unload shortcuts reflect Gateway contract support per task.
- Run details separate media model identity from runtime orchestration identity.
- No ledger semantics are changed; only presentation and authoring guidance are improved.

## Test Plan

- Frontend tests for run modal status mapping of `completed + ok:false`.
- Frontend tests that contract support flags disable or annotate unsupported inline residency shortcuts.
- Run-preview tests for generated media metadata display once runtime/media identities are separated upstream.
