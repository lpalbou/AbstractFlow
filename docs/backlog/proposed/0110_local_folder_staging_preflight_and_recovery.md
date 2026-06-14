# Proposed: Local Folder Staging Preflight And Recovery

## Metadata
- Created: 2026-06-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`, `docs/adr/0023-file-attachment-path-resolution-and-authorization.md`
- ADR impact: None. This is optional later polish only.

## Context
`0107` shipped the ability to choose one local file, many local files, or one
or more local folders from the client computer and run a workflow on them.
`0109` separately tracks the remaining authoring and terminology gap so authors
can define those inputs clearly.

What may still be missing later is the run-time trust layer for larger local selections:
ordinary users should be able to see what will be uploaded, what paths will be
preserved, how big the selection is, how upload is progressing, and how to
recover from partial failure.

Backlog review converged on the same correction:

- keep `0108` as a low-priority future `ClientFS` guardrail only;
- keep `0109` as the only immediate planned item for the direct user request;
- keep this item optional until product evidence says the extra polish is worth doing.

## Current code reality
- `abstractflow/src/components/ArtifactListInputField.tsx` already supports
  `Artifacts`, `Local Files`, and `Local Folder`.
- Local folder selection preserves relative member paths via `source_path`.
- The current upload path is sequential and per-file:
  `uploadFiles()` loops over every selected file, posts it to
  `/api/gateway/attachments/upload`, and only shows a simple
  `Uploading X/Y...` message plus a partial-success error.
- `abstractgateway/src/abstractgateway/routes/gateway.py` currently accepts one
  upload per request with optional `source_path`; there is no preflight or
  folder-manifest endpoint.
- The current UI does not yet provide a strong review/preflight surface for
  larger folder selections: file count, total bytes, clear relative-path
  preview, skip/exclude visibility, or strong retry/recovery guidance.

## Problem or opportunity
The local folder path works. A later product pass may still want stronger trust
and scale behavior:

- users can pick a folder, but cannot review it well before upload;
- progress is minimal for larger selections;
- partial failures are surfaced but recovery is still primitive;
- but none of this is required to satisfy the direct request to let users pick
  files or folders from their own computer to start a workflow.

## What we might want to do later
Make local file and folder staging in the run modal more trustworthy and
scalable without changing the hosted file-source contract.

In plain language:
- let the user choose files or folders from this computer;
- show what will be sent;
- preserve and preview relative paths;
- explain progress, skips, and failures clearly.

## Why it might matter
- It follows directly from the residual risks already recorded in `0107`.
- It would improve larger or messier local folder selections without reopening
  a speculative live-client filesystem debate.
- It should remain optional until the direct user-facing selection fixes are
  done and product evidence shows this extra polish is worth prioritizing.

## Requirements
- Keep local file/folder intake as a launch-time client action.
- Do not introduce live local `list/read/write/search` execution here.
- Show a stronger preflight/review surface for folder uploads.
- Surface file count and total bytes when practical.
- Preview preserved relative paths in a usable way.
- Improve progress and partial-failure messaging for larger selections.
- Keep the existing source terminology:
  - `Artifact`
  - `Local File`
  - `Local Folder`
  - `Server File`
- Keep the workflow launch path simple and obvious.

## Suggested implementation
- Add a review/preflight state in `ArtifactListInputField.tsx` before or during
  larger local-folder uploads.
- Summarize:
  - file count
  - total bytes
  - first N relative paths
  - obvious skipped/unsupported files
- Improve progress beyond a single `Uploading X/Y...` line when the selection
  is large enough to justify it.
- Improve partial-failure and retry/recovery copy and behavior.
- Only add Gateway support if the current single-file upload endpoint is not
  enough to provide the necessary UX.

## Scope
- Run-modal local file/folder staging UX in AbstractFlow.
- Any narrowly required Gateway support for preflight metadata, progress, or
  retry.
- Focused docs/backlog updates if the run path changes.

## Non-goals
- This item does not change the Start/End authoring model; that belongs to
  `0109`.
- This item does not add a live client-filesystem execution plane.
- This item does not add a new durable folder primitive or folder snapshot
  type.
- This item does not reopen `ArtifactRef + WorkspacePath`.
- This item does not replace workspace-scoped server file/folder nodes.

## Dependencies and related tasks
- `completed/0107_local_multifile_and_folder_workflow_inputs.md`
- `completed/0109_local_source_input_authoring_and_folder_selection_clarity.md`
- `proposed/0108_future_live_clientfs_capability_plane.md`
- `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`
- `docs/adr/0036-artifact-descriptor-contract.md`

## Expected outcomes
- If promoted later, users can review local folder selections with better trust
  cues before or during upload.
- If promoted later, larger local selections have clearer progress and better
  recovery behavior.
- The backlog clearly separates:
  - direct selection/authoring fix (`0109`)
  - optional later staging polish (`0110`)
  - future live-clientfs architecture (`0108`)

## Validation
- Focused frontend tests around `ArtifactListInputField` and `RunFlowModal`.
- Manual/browser checks:
  - choose a small folder and confirm summary/progress behavior;
  - choose a larger folder and confirm count/bytes/progress clarity;
  - trigger a partial failure and confirm recovery guidance;
  - confirm relative-path preview remains accurate.
- Backlog/docs checks:
  - `overview.md` priorities match `0109` and `0110`
  - links among `0107`, `0108`, `0109`, and `0110` stay current.

## Progress checklist
- [ ] Audit current folder-staging states in the run modal.
- [ ] Decide the minimum viable preflight/review surface.
- [ ] Improve progress and partial-failure messaging.
- [ ] Add any narrowly required Gateway support.
- [ ] Update docs/tests/backlog after implementation.

## Guidance for the implementing agent
Keep this item narrow and user-facing. If implementation starts to drift into
mid-run live local filesystem execution, stop and push that discussion back
into `0108` instead of expanding this item.
