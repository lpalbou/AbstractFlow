# Planned: Gateway Artifact Import and Export Contract

## Metadata
- Created: 2026-05-28
- Status: Completed
- Completed: 2026-05-28
- Owner: AbstractGateway / AbstractRuntime integration
- Related ADRs: Runtime owns run-scoped artifact storage; Gateway owns workspace policy and remote client boundaries.

## Context

AbstractFlow now treats media as Gateway artifacts, but filesystem handoff is incomplete. Browser uploads can create artifacts, and Gateway can ingest some workspace files as attachments, but there is no advertised, symmetric contract for:

- importing a server workspace path into a typed artifact ref before a run starts
- exporting an existing artifact back to a server workspace path
- applying the same workspace policy, ignored-path, size, and ownership checks in both directions

## Current Code Reality

- Runtime has the correct storage primitive in `abstractruntime/src/abstractruntime/storage/artifacts.py`: `ArtifactStore.store/load/get_metadata/list_by_run`.
- Gateway exposes run-scoped artifact list, metadata, and content routes in `abstractgateway/src/abstractgateway/routes/gateway.py`.
- Gateway already has `/attachments/ingest` and `/attachments/upload`, but discovery only advertises attachment upload and artifact read routes.
- VisualFlow `read_file`/`write_file` handlers currently resolve paths from `Path.cwd()` in Runtime-local execution. That path should not become the general media/document artifact IO contract.

## Problem

If Flow starts accepting raw file paths as ordinary pin values, path safety, workspace scope, `.abstractignore`, upload size limits, symlink handling, overwrite behavior, and artifact ownership will drift between UI, Gateway, and Runtime. That would also make remote Flow clients ambiguous: a browser path and a Gateway workspace path are not the same thing.

## What We Want

Add explicit Gateway-managed artifact IO APIs:

- `POST /api/gateway/artifacts/import` for workspace-path-to-artifact.
- `POST /api/gateway/runs/{run_id}/artifacts/{artifact_id}/export` for artifact-to-workspace-path.
- Discovery descriptors under `common.artifacts.import` and `common.artifacts.export`.

Both routes must return canonical artifact refs and policy metadata, not raw absolute paths.

## Requirements

- Import accepts workspace-relative or mounted paths only under the effective Gateway workspace policy, unless the policy explicitly allows broader access.
- Import rejects path escape, ignored files, directories, missing files, oversized files, and unsafe symlink resolution.
- Import stores bytes in `ArtifactStore` with content type, size, sha256, filename, source path, session id, and purpose tags.
- Export writes raw artifact bytes atomically under the effective workspace policy.
- Export refuses overwrite by default, supports explicit `overwrite=true`, and can create parent directories only when explicitly requested.
- Export responses include relative/virtual destination, content type, bytes written, sha256, and artifact id.
- Gateway capabilities advertise import/export support so Flow does not guess endpoints.

## Suggested Implementation

- Reuse Gateway workspace scope resolution helpers and `.abstractignore` checks from the existing attachment ingest path.
- Factor shared artifact ref construction so upload, ingest, import, and generated media produce the same shape:

```json
{
  "$artifact": "artifact_id",
  "artifact_id": "artifact_id",
  "run_id": "owner_run_id",
  "content_type": "image/png",
  "filename": "input.png",
  "sha256": "...",
  "source_path": "inputs/input.png"
}
```

- Keep Runtime as storage owner; do not add arbitrary filesystem authority to Runtime start vars.
- Add a public Runtime/Gateway artifact content read helper if export currently depends on private store internals.

## Non-Goals

- No image resizing, video transcoding, audio normalization, document conversion, or archive export.
- No automatic conversion of any string that looks like a file path into an artifact.
- No browser-client local path access; browser-local files continue through upload.

## Validation

- Gateway tests cover import success for text, JSON, image, audio, video, and document bytes.
- Gateway tests reject `../` traversal, absolute paths outside policy, blocked ignored paths, symlink escape, directories, missing files, and oversized files.
- Export tests cover atomic write, overwrite refusal, explicit overwrite, create-dirs behavior, and denied destinations.
- Discovery contract tests assert `common.artifacts.import` and `common.artifacts.export` are advertised.

## Progress Checklist

- [x] Design request/response models.
- [x] Add import route and discovery descriptor.
- [x] Add export route and discovery descriptor.
- [x] Share canonical artifact ref construction.
- [x] Add Gateway policy/security tests.
- [x] Update Flow docs once the route contract exists.

## Completion Report

- Completed: 2026-05-28
- Summary: Added Gateway-owned artifact import/export and session listing routes. Import turns a server workspace path into a session-scoped artifact ref; export writes artifact bytes atomically back to a Gateway workspace path. Runtime exposes a public `ArtifactStore.content_path()` hook so Gateway export no longer needs to depend on private file-store internals.
- Code touched:
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractruntime/src/abstractruntime/storage/artifacts.py`
- Tests:
  - `abstractgateway/tests/test_gateway_artifacts_endpoint.py`
  - `abstractgateway/tests/test_capabilities_endpoint_contract.py`
  - `abstractruntime/tests/test_artifacts.py`
- Docs:
  - `abstractgateway/docs/api.md`
  - `abstractgateway/llms.txt`
  - `abstractgateway/llms-full.txt`
  - `abstractflow/docs/api.md`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/llms.txt`
  - `abstractflow/llms-full.txt`
- Validation:
  - `PYTHONPATH=/Users/albou/tmp/abstractframework/abstractruntime/src:/Users/albou/tmp/abstractframework/abstractcore/src:$PYTHONPATH python -m pytest tests/test_gateway_artifacts_endpoint.py tests/test_capabilities_endpoint_contract.py -q` in `abstractgateway` passed.
  - `python -m pytest tests/test_artifacts.py::TestFileArtifactStore::test_content_path_is_public_for_file_backed_store -q` in `abstractruntime` passed.
- ADR impact: None. This implements the existing package boundary: Gateway owns filesystem policy and remote client contracts; Runtime owns artifact storage.
- Residual risks: The Gateway import/export tests cover the main policy path, ownership, overwrite behavior, and discovery. Broader file-type matrix coverage can be added if new content-type-specific behavior appears.
