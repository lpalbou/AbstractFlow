# Proposed: Future Live ClientFS Capability Plane

## Metadata
- Created: 2026-06-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`, `docs/adr/0006-durable-tool-execution.md`, `docs/adr/0015-execution-targets-and-remote-tool-workers.md`
- ADR impact: None yet. This item should only promote to implementation if the product explicitly chooses to add a separate client-attached execution plane for live client-device filesystem operations.

## Current code reality
- `completed/0107_local_multifile_and_folder_workflow_inputs.md` already landed
  the direct local-input transport path: users can choose one local file, many
  local files, or one or more local folders from the client computer and run a
  workflow on them.
- `abstractflow/src/components/ArtifactListInputField.tsx` and
  `abstractflow/src/components/RunFlowModal.tsx` already implement local-folder
  intake through artifact-backed upload/staging.
- The immediate remaining problem is authoring clarity, tracked separately in
  `completed/0109_local_source_input_authoring_and_folder_selection_clarity.md`.
- No current code exposes a mid-run live client-device `list/read/write/search`
  capability for hosted flows, and no accepted ADR authorizes one.

## Problem or opportunity
Some future products may want more than launch-time selection from the client
computer. Examples include:

- browsing the client device during a running workflow;
- modifying local files after the run starts;
- searching local directories without pre-uploading them;
- resuming or waiting on future client-device actions.

That is a different problem from the already shipped “pick local files/folders
from your computer before running” workflow.

## Proposed direction
If hosted Flow ever needs true mid-run local-device file operations, treat that
as a separate capability plane instead of sneaking it into the current
artifact/workspace model.

That future plane would need its own:

- identity model;
- grant/auth model;
- wait/resume contract;
- replay policy;
- offline/reconnect behavior;
- audit/provenance surface;
- fallback behavior on unsupported clients.

## Scope
- Preserve this future design space without blocking current local-input UX.
- Record the boundary between launch-time client selection and any later live
  client-device execution plane.

## Non-goals
- This item does not question whether users can pick local files or folders from
  the client today; they can.
- This item does not own the immediate local file/folder authoring UX problem.
- This item does not authorize changes to the hosted runtime contract by itself.

## Why it might matter
- It prevents future work from quietly conflating “pick files/folders from your
  computer before run start” with “give the hosted runtime live access to the
  client filesystem during execution.”
- It preserves a place to design a real client-attached execution plane if a
  product later needs it.

## Promotion criteria
- A real workflow requires client-device file operations after run start, not
  just launch-time selection.
- The required behavior cannot be solved by improving pre-run local selection
  UX or artifact-backed staging.
- Product explicitly chooses to support a client-attached execution plane.
- Security/operability review defines the authority, reconnect, replay, and
  audit model.

## Validation ideas
- Design review of identity, grants, replay, wait/resume, and unsupported-client
  behavior.
- Prototype review on a real host/client pair before any broad implementation.

## Guidance for future agents
Do not cite this item as the answer to a user who only wants to choose local
files or folders from the client computer for a run. That immediate requirement
belongs to the shipped `0107` path and the authoring/UX follow-up in `0109`.
