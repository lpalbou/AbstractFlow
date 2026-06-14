# Completed: File-Like Taxonomy, Workspace Path Pins, And Artifact IO Nodes

## Metadata
- Created: 2026-05-28
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: Completed for the current phase. This item shipped the first concrete node/runtime/product layer on top of ADR-0037 and the shared canonical path work from `0106`.

## Context
`0095` started as the umbrella design memory for a messy boundary:

- durable Runtime-owned artifacts;
- workspace-scoped server file/folder paths;
- browser-local uploads and future local-folder intake;
- Flow nodes that needed to stop pretending all “files” were the same thing.

`0105`, `0106`, and `0104` settled the vocabulary and path contract first.
This closure records the implementation pass that turned that model into shipped
Flow/Gateway/Runtime behavior for the current file/folder automation phase.

## Current code reality before closure
- Flow already had artifact pins and browser upload/import affordances, but no
  explicit workspace file/folder pin types.
- Runtime already had `read_file`, `write_file`, `read_pdf`, and `write_pdf`,
  but not explicit artifact-first file nodes.
- Gateway exposed workspace search/read/skim/import/export helpers, but not a
  folder-listing browse API for the run modal and workspace path inputs.
- File-family filtering was duplicated and incomplete across packages.

## What changed
- Added shared file-family / extension helpers in
  `abstractcore/abstractcore/utils/file_filters.py` and extended media type
  coverage in `abstractcore/abstractcore/media/types.py`.
- Added explicit Flow pin types:
  - `workspace_file`
  - `workspace_folder`
- Updated Flow compatibility/validation so legacy string paths still connect
  while typed workspace file-vs-folder mismatches are rejected.
- Added Flow/runtime node surfaces for the current file/artifact phase:
  - `Artifact` literal node
  - `List Folder Files`
  - `Import Server File`
  - `Read Artifact`
  - `Export Artifact`
- Added a workspace-path browser input in the run modal and source picker:
  `WorkspacePathInputField.tsx`.
- Added Gateway `GET /api/gateway/files/list` so Flow can browse server
  workspace roots and approved mounts instead of forcing blind path entry.
- Updated Runtime file/PDF nodes to emit canonical workspace-path strings in
  hosted workspace cases instead of absolute host paths.
- Added Runtime handlers for:
  - folder listing with family/extension filters
  - workspace-file import into the Runtime artifact store
  - bounded artifact content projection
  - artifact export back to workspace paths
- Threaded runtime artifact-store context into VisualFlow execution so the new
  artifact nodes work without abusing HTTP helper routes as execution contracts.
- Added end-to-end tests across Runtime and Gateway for:
  - workspace folder listing
  - workspace-file -> artifact -> read -> export round trips
  - mounted-root alias browsing/import/export
  - trusted workspace-root override canonicalization

## Scope
- File-like taxonomy implementation for the current product/runtime phase.
- Flow pin types, node templates, run-start UX, and node catalog updates.
- Runtime node execution and artifact-store handoff for artifact/file bridge
  nodes.
- Gateway browse/import/export helper surfaces needed by the editor and hosted
  runs.

## Non-goals
- This item does not make “artifact folders” a first-class Runtime primitive.
- This item does not add local-folder snapshot manifests or browser folder
  upload execution semantics.
- This item does not add artifact collection/search graph nodes beyond the
  existing Gateway artifact search surfaces.
- This item does not define archive/delete lifecycle behavior; that remains in
  `0102`.

## Expected outcomes
- Flow users can now distinguish durable artifacts from workspace-scoped server
  paths in both the editor and the run modal.
- Hosted runs can browse server folders, filter folder contents, import a
  server file into an artifact, inspect an artifact’s content, and export the
  artifact back to workspace storage.
- Gateway and Runtime now round-trip the same canonical workspace-path strings
  through file/artifact helper flows.

## Validation
- Runtime:
  - `pytest abstractruntime/tests/test_workspace_policy_mount_virtual_paths.py abstractruntime/tests/test_visualflow_file_nodes_workspace.py -q`
- Gateway:
  - `PYTHONPATH=abstractgateway/src:abstractruntime/src:abstractcore pytest abstractgateway/tests/test_gateway_visualflow_file_nodes.py abstractgateway/tests/test_gateway_workspace_policy_enforcement.py abstractgateway/tests/test_gateway_discovery_endpoints.py -q`
- Flow:
  - `cd abstractflow && npm test -- --run src/components/ArtifactInputField.test.ts src/utils/gatewayInputSchema.test.ts src/utils/flowAuthoringCommands.test.ts`
  - `cd abstractflow && npm run build`
  - `cd abstractflow && npm run docs:llms`
- Architecture review, independent review, and UX review informed the shipped split between artifacts and workspace paths before closure.

## Progress checklist
- [x] Lock the source taxonomy and workspace-path authority model.
- [x] Add real Flow pin types for workspace files/folders.
- [x] Ship the first explicit artifact/file bridge nodes.
- [x] Add workspace folder browsing/filtering for Flow run/start UX.
- [x] Validate Runtime and Gateway round trips for mounted server paths.
- [x] Update generated Flow docs/LLM context to include the new node family.

## Completion report
- Completed: 2026-06-11
- Summary: Shipped the first concrete file/folder automation layer on top of
  the accepted taxonomy: typed `workspace_file` / `workspace_folder` pins,
  workspace-path browsing, `List Folder Files`, `Import Server File`, `Read
  Artifact`, `Export Artifact`, canonical hosted file-node outputs, and shared
  file-family filtering. Gateway, Runtime, Flow docs, and the generated node
  catalog were updated in the same pass.
- Code and docs touched:
  - `abstractcore/abstractcore/media/types.py`
  - `abstractcore/abstractcore/utils/file_filters.py`
  - `abstractruntime/src/abstractruntime/integrations/abstractcore/workspace_scoped_tools.py`
  - `abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py`
  - `abstractruntime/src/abstractruntime/visualflow_compiler/compiler.py`
  - `abstractruntime/src/abstractruntime/core/runtime.py`
  - `abstractruntime/tests/test_workspace_policy_mount_virtual_paths.py`
  - `abstractruntime/tests/test_visualflow_file_nodes_workspace.py`
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractgateway/tests/test_gateway_visualflow_file_nodes.py`
  - `abstractgateway/tests/test_gateway_workspace_policy_enforcement.py`
  - `abstractflow/src/types/flow.ts`
  - `abstractflow/src/types/nodes.ts`
  - `abstractflow/src/components/WorkspacePathInputField.tsx`
  - `abstractflow/src/components/RunFlowModal.tsx`
  - `abstractflow/src/components/ArtifactInputField.tsx`
  - `abstractflow/src/components/PinLegend.tsx`
  - `abstractflow/src/components/PropertiesPanel.tsx`
  - `abstractflow/src/components/nodes/BaseNode.tsx`
  - `abstractflow/src/utils/validation.ts`
  - `abstractflow/src/utils/gatewayInputSchema.ts`
  - `abstractflow/src/utils/gatewayClient.ts`
  - `abstractflow/src/utils/flowAuthoringCommands.ts`
  - `abstractflow/src/styles/index.css`
  - `abstractflow/docs/README.md`
  - `abstractflow/docs/web-editor.md`
  - `abstractflow/docs/workflow-node-catalog.md`
  - `abstractflow/llms-full.txt`
  - `abstractgateway/docs/api.md`
  - `abstractruntime/docs/api.md`
  - `abstractruntime/docs/artifacts.md`
  - `abstractruntime/llms.txt`
  - `abstractruntime/llms-full.txt`
- Residual risks:
  - Artifact storage still does not model true folder namespaces; folder
    semantics are currently workspace-path-first, not artifact-collection-first.
  - Browser/local folder intake and durable snapshot manifests remain future
    work if product workflows need them; the current implementation follow-up
    is now tracked by
    `completed/0107_local_multifile_and_folder_workflow_inputs.md`.
  - Trusted `all_except_ignored` absolute paths outside current workspace roots
    remain a dev/operator escape hatch and should not be treated as portable
    hosted `WorkspacePath` identities.
- Priority impact:
  - `0103` was able to close as the remaining coredoc sweep for the same
    taxonomy.
  - Future file-related work should build new backlog items for local-folder
    snapshots or artifact-collection graph nodes instead of reopening `0095`.
