# Completed: Local Multi-File And Folder Workflow Inputs

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`, `docs/adr/0023-file-attachment-path-resolution-and-authorization.md`
- ADR impact: Completed. This item stayed inside the accepted hosted contract: local sources normalize into durable artifact refs; server-side paths remain workspace-scoped.

## Context
`0095`, `0104`, `0105`, and `0106` established the current file-like source
model:

- `Artifact` = durable runtime-owned payload;
- `Workspace File` / `Workspace Folder` = server path under workspace policy;
- `Local File` / `Local Folder` = client-side source in hosted mode.

The product still lacked a clean local-input workflow for ordinary users:

- one local file already worked through singular artifact pins;
- multiple local files were not a first-class workflow input;
- a local folder was not a first-class workflow input;
- the fallback for “many files” was generic `array` JSON entry, which was not
  discoverable or trustworthy.

## Current code reality before closure
- `abstractflow/src/components/ArtifactInputField.tsx` already implemented the
  accepted single-file source contract (`Artifact`, `Local File`, `Server File`)
  for singular artifact pins.
- Gateway already validated artifact refs recursively inside arrays and objects
  at run start, so artifact-ref arrays were a safe runtime transport shape.
- Existing workflow array primitives (`for`, `array_map`, `array_filter`,
  `array_length`, `get_element`) were already sufficient to analyze ordered
  lists of artifact refs once the input contract became explicit.
- `/api/gateway/attachments/upload` still accepted one file per request and
  flattened client uploads to basename-only `client:<filename>` handles, so
  folder hierarchy did not survive hosted local intake.

## What changed
- Added explicit Flow pin types for ordered artifact-ref lists:
  - `artifacts`
  - `artifacts_image`
  - `artifacts_audio`
  - `artifacts_text`
  - `artifacts_video`
- Extended the Flow/Gateway schema bridge so those pins serialize as artifact
  arrays instead of generic JSON arrays:
  - Flow now normalizes and parses artifact-ref lists explicitly.
  - Gateway now advertises `type: array` with artifact-ref `items` plus
    modality metadata when relevant.
- Added `ArtifactListInputField.tsx` and wired it into `RunFlowModal` for
  `artifacts*` inputs:
  - reuse saved artifacts;
  - upload multiple local files;
  - choose one local folder per selection and add more folders before run;
  - review/remove selected files before run;
  - show consequence/provenance summaries consistent with the single-file
    picker.
- Extended `/api/gateway/attachments/upload` with optional client-relative
  `source_path` handling so hosted local folder uploads preserve normalized
  relative member paths without exposing browser-local absolute paths.
- Kept the runtime value JSON-safe and additive:
  - one local file still uses one artifact ref object;
  - many local files or one or more local folders now use ordered arrays of
    artifact refs;
  - no new runtime collection primitive was introduced.
- Updated authoring surfaces and docs so authors can create and understand the
  new multi-artifact inputs without dropping to raw JSON.

## Scope
- Flow pin types, run-input schema helpers, validation, run-modal UI, and
  supporting tests/docs.
- Gateway attachment upload extension for client-relative `source_path`.
- Focused authoring/docs updates for the new pin types and local multi-file /
  local folder intake workflow.

## Non-goals
- This item does not add a first-class `artifact_collection` / `folder snapshot`
  runtime primitive.
- This item does not add collection-specific graph nodes.
- This item does not broaden server-folder access; `Workspace Folder` remains
  the server path model.
- This item does not replace existing singular artifact pins.

## Expected outcomes
- Flow authors can add workflow inputs for:
  - one file (`artifact*`);
  - many files (`artifacts*`);
  - one or more folders (`artifacts*` via repeated local folder upload).
- End users can provide those inputs from the run modal without writing raw
  JSON.
- Workflows can immediately analyze multi-file/folder inputs through existing
  `array` and `for` nodes.
- Folder member relative paths survive upload as artifact provenance metadata.

## Validation
- Flow:
  - `npm test -- --run src/components/ArtifactInputField.test.ts src/components/ArtifactListInputField.test.ts src/utils/gatewayInputSchema.test.ts src/utils/flowAuthoringCommands.test.ts`
  - `npm run build`
- Gateway:
  - `PYTHONPATH=src:../abstractruntime/src:../abstractcore pytest tests/test_gateway_attachments_upload.py tests/test_abstractflow_editor_gateway_contract.py -q`
- Manual/browser:
  - run one local file through a singular artifact pin;
  - run several local files through an `artifacts*` pin;
  - run one or more local folders through an `artifacts*` pin and verify
    preserved relative member paths;
  - connect the resulting list through `ForEach` + `Read Artifact`.
- Architecture review, two review passes, and three UX review passes completed
  before closure.

## Progress checklist
- [x] Promote the local-input follow-up from proposal to concrete implementation scope.
- [x] Add explicit multi-artifact pin types and schema mapping.
- [x] Add Flow helpers and run-modal UI for multi-file and folder local input.
- [x] Extend Gateway upload to preserve client-relative source paths.
- [x] Validate artifact-list compatibility with existing array workflows.
- [x] Update docs/backlog history after implementation.

## Completion report
- Completed: 2026-06-11
- Summary: Added explicit multi-artifact workflow inputs so hosted Flow users
  can provide one local file, many local files, or one or more local folders
  to a run.
  The shipped design keeps local intake artifact-backed, uses ordered arrays of
  artifact refs for many-file and folder inputs, preserves client-relative
  member paths during upload, and reuses existing array/loop nodes for
  downstream analysis instead of introducing a new runtime collection
  primitive.
- Code and docs touched:
  - `abstractflow/src/types/flow.ts`
  - `abstractflow/src/utils/artifactInputs.ts`
  - `abstractflow/src/utils/mediaArtifacts.ts`
  - `abstractflow/src/utils/gatewayInputSchema.ts`
  - `abstractflow/src/utils/gatewayInputSchema.test.ts`
  - `abstractflow/src/utils/flowAuthoringCommands.ts`
  - `abstractflow/src/components/ArtifactInputField.tsx`
  - `abstractflow/src/components/ArtifactListInputField.tsx`
  - `abstractflow/src/components/ArtifactListInputField.test.ts`
  - `abstractflow/src/components/RunFlowModal.tsx`
  - `abstractflow/src/components/PinLegend.tsx`
  - `abstractflow/src/components/PropertiesPanel.tsx`
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractgateway/tests/test_gateway_attachments_upload.py`
  - `abstractgateway/tests/test_abstractflow_editor_gateway_contract.py`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/docs/workflow-authoring-skill.md`
  - `abstractgateway/docs/api.md`
- Residual risks:
  - Local multi-file and local folder intake still uploads one file per request.
    That is acceptable for this additive scope, but very large folder imports
    may justify a future batch/preflight protocol if product evidence demands
    it.
  - The durable shape for many-file and folder inputs is still an ordered array
    of artifact refs, not a first-class artifact collection primitive. If later
    product needs require set-level lifecycle, query, or export behavior, that
    should land as a separate backlog/ADR pass.
- Priority impact at the time:
  - The direct user requirement for one file, many files, or one or more local
    folders as workflow input is now satisfied inside the existing hosted
    artifact/workspace contract.
  - The next file-adjacent work only needs to reopen if product evidence
    demands batch-upload optimization or a first-class artifact-collection
    contract.

## Post-completion note (2026-06-11)
- The transport/input capability shipped here is real: the run modal can accept
  one local file, many local files, or one or more local folders from the
  client computer.
- What did not fully land was the authoring mental model. `On Flow Start` /
  `On Flow End`, pin labels, and authoring guidance still made users reason
  about internal artifact/array terminology more than necessary.
- Follow-up work is tracked separately in
  `completed/0109_local_source_input_authoring_and_folder_selection_clarity.md`.
