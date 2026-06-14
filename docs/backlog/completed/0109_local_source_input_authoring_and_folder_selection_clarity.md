# Completed: Local Source Input Authoring And Folder Selection Clarity

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: None. This item is a targeted product-surface fix, not a new architecture decision.

## Context
`0107` shipped the actual transport path for local inputs:

- one local file can be provided from the client;
- many local files can be provided from the client;
- one or more local folders can be provided from the client;
- folder member relative paths survive upload as artifact provenance metadata.

Users can already launch a workflow against client-selected files/folders in the
run modal. The unresolved problem is narrower: the Start/End and run-modal
surfaces still make that capability look harder or stranger than it is.

## Current code reality
- `abstractflow/src/components/ArtifactListInputField.tsx` already exposes
  `Artifacts`, `Local Files`, and `Local Folder` in the run modal for
  multi-file inputs, and uploads folder member files with preserved relative
  `source_path`.
- `abstractflow/src/components/ArtifactInputField.tsx` already exposes
  `Artifact`, `Local File`, and `Server File` for singular artifact-backed
  inputs.
- `abstractflow/src/components/RunFlowModal.tsx` routes artifact-list-like pins
  to the local multi-file/folder picker and workspace pins to the server-path
  browser.
- `abstractflow/src/utils/pinTypeOptions.ts` and
  `abstractflow/src/components/PropertiesPanel.tsx` still force users to think
  in internal value/type terms such as `artifact`, `array`, file-modality
  variants, and `server folder` instead of a cleaner task-oriented authoring
  model.

## Problem
The capability exists, but the authoring experience still does not teach it
cleanly. Users should not need to infer that:

- `artifact` means one client-pickable file or saved artifact-backed file value;
- `array` plus hidden item schema means multiple client-picked files or folder
  contents;
- `server folder` is a different class of runtime capability than selecting a
  local folder from the client.

That mismatch creates needless confusion and undermines trust in a feature that
is already implemented.

## What we want to do
Make local file and folder selection obvious in the workflow authoring and run
surfaces, using targeted UI fixes only.

## Why
- The direct user requirement is not “design a future ClientFS plane”; it is
  “let me choose files or folders from my computer and run the workflow on
  them.”
- The current implementation meets the transport requirement but still fails the
  discoverability and terminology test.
- Closing that gap is more important than speculative live-client filesystem
  work or larger refactors.

## Requirements
- A workflow author must be able to express:
  - one artifact-backed file input;
  - a list of artifact-backed file inputs;
  - a server file path input;
  - a server folder path input.
- The authoring surface must not expose duplicated peer types for singular and
  plural files when multiplicity already exists as an array/value-shape concept.
- The UI must clearly distinguish:
  - saved artifact-backed values;
  - client-side local selection from this computer;
  - server workspace path capabilities.
- The run modal must continue to let end users choose:
  - `Artifact` / `Local File` / `Server File` for singular file inputs;
  - `Artifacts` / `Local Files` / `Local Folder` for list-of-file inputs.
- The visible authoring model must explain what happens when a local folder is
  selected: the workflow receives the folder contents as files, with relative
  paths preserved.

## Suggested implementation
- Keep the current hosted transport contract:
  - one file = artifact-backed value;
  - many files or folder contents = array of artifact-backed values;
  - server file/folder = workspace path capability.
- Adjust the Start/End authoring control so it teaches value shape and source
  behavior honestly instead of leaking internal type ids.
- Align the visible user wording across:
  - Start/End editor;
  - run modal labels and helper text;
  - pin legend.
- Keep documentation updates minimal and limited to whatever is necessary to
  match the shipped UI.

## Scope
- AbstractFlow Start/End type-picker and helper-text UX.
- Run modal wording and source explanations where needed.
- Pin legend and only the minimum directly affected local docs.

## Non-goals
- This item does not own preflight/progress/recovery for larger local folder
  uploads; that is optional later work tracked in `proposed/0110_local_folder_staging_preflight_and_recovery.md`.
- This item does not add a live client-filesystem execution plane.
- This item does not change the underlying hosted `ArtifactRef + WorkspacePath`
  runtime contract.
- This item does not trigger a large refactor across unrelated authoring or
  runtime surfaces.
- This item does not replace workspace-scoped server folder/file nodes.

## Dependencies and related tasks
- `completed/0107_local_multifile_and_folder_workflow_inputs.md`
- `proposed/0110_local_folder_staging_preflight_and_recovery.md`
- `proposed/0108_future_live_clientfs_capability_plane.md`
- `completed/0104_abstractflow_node_and_authoring_terminology_alignment.md`
- `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`

## Expected outcomes
- Users can tell, from the authoring UI alone, how to define a workflow input
  that accepts:
  - one file from their computer;
  - multiple files from their computer;
  - one or more folders from their computer;
  - a server file or server folder.
- The work stays small and targeted instead of expanding into a larger redesign.
- The future `ClientFS` proposal remains clearly separated from this direct UI fix.

## Validation
- Focused frontend tests for type-picker rendering, helper text, and run-modal
  source selection behavior:
  - `npm test -- --run src/utils/pinTypeOptions.test.ts src/components/ArtifactListInputField.test.ts src/components/PinLegend.test.ts src/utils/gatewayInputSchema.test.ts`
- Frontend build:
  - `npm run build`
- Review/UX status:
  - architecture, review, and UX lenses were applied in implementation-only
    `#FALLBACK` mode in this environment; no browser automation/inspection tool
    was available for a live visual pass.

## Progress checklist
- [x] Re-audit the current Start/End authoring model against the shipped run-modal behavior.
- [x] Choose the final user-facing value/source vocabulary for the targeted UI surfaces.
- [x] Implement the Start/End, run-modal, and legend wording changes.
- [x] Validate the updated flow with visible UI review and focused tests.
- [x] Update backlog and only the minimum affected docs after implementation.

## Guidance for the implementing agent
Do not reopen speculative live-client execution questions while implementing
this item. Re-check the visible UI first. Keep the change small. The goal is
simply to make the already shipped local file/folder capability obvious to
ordinary users at workflow start.

## Completion report

- Date: 2026-06-11
- Summary:
  - Harmonized workflow-boundary authoring back around `array`, so the editor no longer invents a fake local `folder` value while the underlying transport is still artifact-backed files.
  - Kept the existing hosted transport contract unchanged while clarifying that `Local Folder` in the run form is a source for `array<file>`, not a live writable folder path.
  - Broadened the array item-type selector so boundary arrays can represent more than files while still giving the special local file/folder picker only to `array<file>`.
- Files or symbols touched:
  - `abstractflow/src/utils/pinTypeOptions.ts`
  - `abstractflow/src/components/PropertiesPanel.tsx`
  - `abstractflow/src/components/RunFlowModal.tsx`
  - `abstractflow/src/components/ArtifactListInputField.tsx`
  - `abstractflow/src/components/PinLegend.tsx`
  - `abstractflow/src/utils/pinTypeOptions.test.ts`
  - `abstractflow/src/components/ArtifactListInputField.test.ts`
  - `abstractflow/src/components/PinLegend.test.ts`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/docs/workflow-authoring-skill.md`
- Tests:
  - `cd abstractflow && npm test -- --run src/utils/pinTypeOptions.test.ts src/components/ArtifactListInputField.test.ts src/components/PinLegend.test.ts src/utils/gatewayInputSchema.test.ts`
  - `cd abstractflow && npm run build`
- Docs updates:
  - Updated the directly affected Flow docs so they consistently use `array` plus item type, and explain that local folder selection is a source for `array<file>`.
- Behavior changes:
  - Boundary type pickers no longer surface `image file`, `audio file`, `text file`, or `video file` as separate top-level choices.
  - Workflow boundaries now use `array` consistently instead of mixing `list` in the UI while the graph uses `array`.
  - Arrays can now declare broader item types instead of only the earlier file-oriented cases.
  - `Local Folder` remains available in the run form, but only as a source for `array<file>`. `server folder` remains the live writable folder-path primitive.
  - Run-form type labels now show `array<file>` and other `array<...>` forms instead of raw `array` or `file list`.
- Residual risks:
  - Visible-browser UX review remained implementation-first in this pass because the dedicated local browser harness was unavailable here.
  - `Artifacts` remains the saved-source label in the multi-file picker; if future user testing shows that this is still too jargon-heavy, follow-up `0110` can absorb that polish together with preflight/progress work.
- Backlog or code drift:
  - None found after the targeted fix.
- Follow-ups:
  - `proposed/0110_local_folder_staging_preflight_and_recovery.md` remains optional later polish only.
- Priority impact:
  - No immediate blocking file/folder authoring work remains after this item. The next file/folder work is optional polish, not a larger redesign.

## Completion addendum

- Date: 2026-06-11
- Summary:
  - Finalized the narrow authoring model as `file`, `array`, `server file`,
    and `server folder` for workflow boundaries.
  - Made boundary arrays explicit about their item type, so the user sees
    `array<file>` and other `array<...>` forms instead of a separate `list`
    vocabulary.
  - Kept the source choices unchanged in the run modal (`Artifact`, `Local
    File`, `Server File`, `Artifacts`, `Local Files`, `Local Folder`) while
    clarifying that `Local Folder` is a source for file arrays rather than a
    live folder value.
- Files or symbols touched in the final refinement:
  - `abstractflow/src/utils/pinTypeOptions.ts`
  - `abstractflow/src/components/PropertiesPanel.tsx`
  - `abstractflow/src/components/ArtifactInputField.tsx`
  - `abstractflow/src/components/ArtifactListInputField.tsx`
  - `abstractflow/src/utils/pinTypeOptions.test.ts`
  - `abstractflow/docs/workflow-authoring-skill.md`
- Validation:
  - `cd abstractflow && npm test -- --run src/utils/pinTypeOptions.test.ts src/components/ArtifactInputField.test.ts src/components/ArtifactListInputField.test.ts src/components/PinLegend.test.ts`
  - `cd abstractflow && npm run build`
  - `git diff --check`
- Residual risks:
  - Larger local-folder preflight/progress/recovery remains explicitly deferred
    to `proposed/0110_local_folder_staging_preflight_and_recovery.md`.
  - This pass validated the shipped surface through focused code/tests/build;
    a fully automated signed-in browser walkthrough of the editor was still not
    available in this environment.
