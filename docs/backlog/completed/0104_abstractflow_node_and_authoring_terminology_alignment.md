# Completed: AbstractFlow Node, Source Picker, And AI Authoring Terminology Alignment

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: Completed. This item aligned the shipped Flow product language and authoring surfaces with ADR-0037 without inventing broader capability than the platform actually has.

## Context
After ADR-0037 and `0106`, the platform contract was clear but the Flow product
still taught older terms:

- artifact pickers said `Existing / Upload / Workspace`
- file nodes still sounded like generic “disk” access
- the pin legend still taught “Gateway artifact reference”
- the authoring assistant prompt and generated node catalog still echoed the
  older wording

That mismatch mattered because the assistant learns from the same docs and node
descriptions users see. If those surfaces kept the old terms, the UI and the
planner would keep reintroducing the same file/artifact confusion.

## Current code reality before closure
- Artifact literal templates already had stable modality-specific labels such as
  `Image Artifact` and `Text Artifact`.
- Authoring-command compatibility depended on those exact template labels.
- `ArtifactInputField.tsx`, `PinLegend.tsx`, `RunFlowModal.tsx`,
  `workflow-authoring-skill.md`, and `AuthoringAssistantDrawer.tsx` all needed
  vocabulary alignment.
- `0106` had to land first so “Server File” could map to a real shared mounted
  path contract rather than aspirational wording.

## What changed
- Updated the artifact input picker to use origin-based tabs:
  - `Artifact`
  - `Local File`
  - `Server File`
- Added consequence-oriented helper text in the picker so users can see:
  - what enters the flow
  - whether the result is reusable
  - what access boundary is being used
- Added selected-artifact summary text covering source, flow value, reuse,
  access, and reference/path.
- Surfaced hosted admin/operator gating for server-file import with explicit
  denial copy instead of a vague unavailable state.
- Rewrote file-node descriptions so `Read File`, `Write File`, `Read PDF`, and
  `Write PDF` describe workspace-scoped server paths honestly.
- Updated artifact pin legend wording from “Gateway artifact reference” to
  saved reusable artifact terminology, while explicitly distinguishing artifact
  pins from workspace-path string pins.
- Updated the run modal filesystem card to connect workspace policy settings to
  `Server File` imports and file-path nodes.
- Updated `workflow-authoring-skill.md`, the planner prompt, and the generated
  node catalog so the AI authoring assistant uses the same source/path
  vocabulary as the UI.
- Kept existing modality-specific artifact template labels stable, so no alias
  or migration layer was required for this pass. Compatibility was preserved by
  changing descriptions and guidance rather than renaming the visible artifact
  template variants.
- Added focused tests for picker terminology helpers, pin-legend wording, and
  planner prompt vocabulary.

## Scope
- AbstractFlow product terminology surfaces for files, artifacts, and source
  selection.
- Assistant-facing docs and prompt context inside `abstractflow/`.
- Generated Flow authoring docs and the package AI-readable corpus.

## Non-goals
- This item does not add a generic `Artifact` literal node.
- This item does not add file/folder pins or the broader node family from
  `0095`.
- This item does not rename existing modality-specific artifact template labels.
- This item does not replace the broader cross-package coredoc sweep still
  tracked by `0103`.

## Expected outcomes
- Flow users now see one consistent source model in the picker and related
  helper copy.
- File nodes no longer imply client-local disk access in hosted runs.
- The AI authoring assistant and the UI now teach the same file/artifact
  vocabulary.
- Existing template-label-based authoring behavior remains compatible.

## Validation
- `npm test -- src/components/ArtifactInputField.test.ts src/components/PinLegend.test.ts src/components/AuthoringAssistantDrawer.test.tsx src/utils/flowAuthoringCommands.test.ts`
- `npm run docs:llms`
- Grep/re-read of touched AbstractFlow docs and component copy for stale
  `Existing / Upload / Workspace` or misleading “from disk” wording.
- Architecture review, independent review, and three UX review passes all
  completed before closure.

## Progress checklist
- [x] Audit all AbstractFlow product-language surfaces for file-like terms.
- [x] Decide and document compatibility handling for existing template labels.
- [x] Update node/picker/pin-legend terminology.
- [x] Update AI authoring docs and generated node catalog.
- [x] Update tests for wording-sensitive UI/prompt behavior.
- [x] Regenerate derived docs/LLM context tied to those labels.

## Completion report
- Completed: 2026-06-11
- Summary: Renamed the artifact picker to `Artifact / Local File / Server File`,
  added consequence/provenance helper text, rewrote file-node and pin-legend
  copy to match the hosted source contract, aligned the authoring assistant and
  generated node catalog with the same terminology, and preserved exact
  artifact-template label compatibility by leaving those labels stable.
- Code and docs touched:
  - `abstractflow/src/components/ArtifactInputField.tsx`
  - `abstractflow/src/components/ArtifactInputField.test.ts`
  - `abstractflow/src/components/PinLegend.tsx`
  - `abstractflow/src/components/PinLegend.test.ts`
  - `abstractflow/src/components/RunFlowModal.tsx`
  - `abstractflow/src/components/AuthoringAssistantDrawer.tsx`
  - `abstractflow/src/components/AuthoringAssistantDrawer.test.tsx`
  - `abstractflow/src/types/nodes.ts`
  - `abstractflow/docs/workflow-authoring-skill.md`
  - `abstractflow/docs/workflow-node-catalog.md`
  - `abstractflow/docs/visualflow.md`
  - `abstractflow/llms-full.txt`
- Residual risks:
  - Flow still lacks a first-class typed `WorkspacePath` pin; the distinction is
    currently taught through copy and contract rather than a separate pin type.
  - The broader package-doc terminology sweep had not landed yet at this point;
    it later closed as `0103`.
- Priority impact at the time:
  - The Flow UI, authoring docs, and planner were safe foundations for the
    next file/folder node work in `0095`.
  - `0103` was the next doc-governance item for the remaining cross-package
    terminology alignment.
