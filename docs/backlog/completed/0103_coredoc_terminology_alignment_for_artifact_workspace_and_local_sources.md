# Completed: Cross-Package Coredoc Terminology Alignment For Artifact, Workspace, And Local File Concepts

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: Completed. This pass propagated the accepted hosted source contract through the relevant package docs and AI-readable doc surfaces without reopening the ADR.

## Context
After `0105`, `0106`, and `0104`, the platform and Flow UI had the right model,
but the package docs still drifted:

- some pages still spoke loosely about “workspace imports” or “uploads” without
  explaining whether the result was a durable artifact or just a server path;
- Observer docs described Artifact Explorer without clearly stating that it
  inventories artifacts, not live workspace files or browser-local sources;
- package `llms-full.txt` outputs needed regeneration so AI-readable context did
  not teach older wording than the shipped UI and docs.

## Current code reality before closure
- Root docs already taught `Artifact`, `Workspace File` / `Workspace Folder`,
  and `Local File` / `Local Folder`.
- Flow/Gateway/Runtime product surfaces had already been aligned by `0104` and
  `0106`.
- Observer package docs and generated doc snapshots still needed the same
  contract language.

## What changed
- Updated Flow package docs to state the source taxonomy explicitly and to
  describe the new workspace-path and artifact node family honestly:
  - `abstractflow/docs/README.md`
  - `abstractflow/docs/web-editor.md`
- Updated Gateway API docs to document:
  - `Artifact` vs `Local File` vs `Server File`
  - canonical `WorkspacePath` strings
  - `GET /api/gateway/files/list`
  - server-file browse/import/export behavior
- Updated Runtime docs to describe:
  - artifact refs versus workspace-scoped paths
  - the current VisualFlow file/document/artifact node set
- Updated Observer docs so Artifact Explorer is clearly positioned as a viewer
  for durable artifacts, not a browser for live workspace files or local
  sources:
  - `abstractobserver/docs/README.md`
  - `abstractobserver/docs/architecture.md`
  - `abstractobserver/docs/faq.md`
- Regenerated or refreshed the relevant AI-readable package outputs:
  - `abstractflow/llms-full.txt`
  - `abstractgateway/llms-full.txt`
  - `abstractobserver/llms-full.txt`
  - `abstractruntime/llms.txt`
  - `abstractruntime/llms-full.txt`
- Regenerated Flow’s derived node catalog so the new file/artifact nodes appear
  in both human docs and agent context:
  - `abstractflow/docs/workflow-node-catalog.md`

## Scope
- Cross-package doc alignment for the file-like taxonomy.
- The relevant Flow, Gateway, Runtime, and Observer coredoc surfaces.
- The corresponding generated `llms` outputs tied to those docs.

## Non-goals
- This item did not rename additional product surfaces beyond what `0104`
  already handled.
- This item did not introduce new APIs, pin types, or runtime behavior.
- This item did not define archive lifecycle semantics beyond remaining
  compatible with `0102`.

## Expected outcomes
- Readers can now tell whether a file-like value is:
  - a durable artifact,
  - a workspace-scoped server path,
  - or a client-local intake source.
- Observer no longer implies that artifact inventory equals generic server file
  browsing.
- The package AI-readable docs now teach the same vocabulary as the human docs
  and the shipped Flow/Gateway surfaces.

## Validation
- Regenerated derived docs and doc snapshots:
  - `cd abstractflow && npm run docs:llms`
  - `cd abstractgateway && python scripts/generate-llms-full.py`
  - `cd abstractobserver && npm run llms:full`
- Re-read the touched Flow, Gateway, Runtime, and Observer pages for vocabulary
  drift.
- Verified the regenerated Flow node catalog includes `Artifact`, `List Folder
  Files`, `Import Server File`, `Read Artifact`, and `Export Artifact`.
- Ran targeted grep checks for the new vocabulary in the generated doc outputs.

## Progress checklist
- [x] Confirm the accepted terminology before editing docs.
- [x] Keep root docs and package docs aligned on the same source model.
- [x] Update Flow package docs after the product terminology ship.
- [x] Update Gateway and Runtime docs for the workspace-path and artifact node contract.
- [x] Update Observer docs so Artifact Explorer boundaries are explicit.
- [x] Refresh the affected generated `llms` and derived doc outputs.

## Completion report
- Completed: 2026-06-11
- Summary: Closed the cross-package terminology sweep by aligning Flow,
  Gateway, Runtime, and Observer docs on `Artifact`, `Workspace File` /
  `Workspace Folder`, and `Local File` / `Local Folder`, while preserving
  `Server File` / `Server Folder` as user-facing wording where appropriate.
  The generated node catalog and package `llms-full.txt` files were refreshed
  so the AI-readable corpus now matches the shipped contract.
- Code and docs touched:
  - `abstractflow/docs/README.md`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/docs/workflow-node-catalog.md`
  - `abstractflow/llms-full.txt`
  - `abstractgateway/docs/api.md`
  - `abstractgateway/llms-full.txt`
  - `abstractruntime/docs/api.md`
  - `abstractruntime/docs/artifacts.md`
  - `abstractruntime/llms.txt`
  - `abstractruntime/llms-full.txt`
  - `abstractobserver/docs/README.md`
  - `abstractobserver/docs/architecture.md`
  - `abstractobserver/docs/faq.md`
  - `abstractobserver/llms-full.txt`
- Residual risks:
  - Future docs for local-folder snapshots or artifact collections should land
    under a new backlog item instead of silently stretching this taxonomy again.
  - If `WorkspacePath` evolves into a structured identity object later, the
    docs will need a fresh ADR/backlog pass rather than incremental drift.
- Priority impact:
  - `0095` and `0103` are now both closed.
  - The next product/lifecycle priority remains `0102` unless a new file/folder
    feature such as local-folder snapshots becomes immediate.
