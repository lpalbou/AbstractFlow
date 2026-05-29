# Proposed: File Nodes and Artifact IO Boundary Resolution

## Metadata
- Created: 2026-05-28
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None identified after review
- ADR impact: May need new ADR

## Context
AbstractFlow now has several overlapping ways to move data between user-visible files, workflow values, and durable artifacts:

- `Read File` and `Write File` nodes exist on the canvas.
- Run-start artifact inputs can upload browser files, import Gateway workspace files, or select existing artifacts.
- Generated media outputs are stored as Runtime/Gateway artifacts and can be opened or downloaded from the Run modal, but artifact-to-filesystem writes are not exposed as a modal action.
- JSON, document, data-dossier, and memory-system workflows need a clearer story than media-only artifact previews.

There is a real design tension that should not be resolved by a quick implementation:

- One perspective favors keeping `Read File` / `Write File` as plain workspace text/JSON filesystem nodes and adding explicit artifact import/export nodes or artifact actions.
- The other perspective argues that `Read File` / `Write File` are the natural user-facing abstraction and should be able to import/export any artifact, with JSON as just another artifact type, while still supporting normal workflow-authored file trees and dossiers.

## Current code reality
- Flow frontend defines artifact pin types for generic/image/audio/text/video artifact refs, but not explicit JSON or document artifact pins: `web/frontend/src/types/flow.ts`.
- Flow frontend defines `Read File` and `Write File` as Memory/IO node templates with `file_path` and `content` pins: `web/frontend/src/types/nodes.ts`.
- Flow normalizes old file nodes by removing a deprecated `file_type` pin and keeping only `file_path`/`content`: `web/frontend/src/hooks/useFlow.ts`.
- Runtime's VisualFlow compiler implements `read_file` by reading UTF-8 from `Path.cwd()`-relative or absolute paths, parsing JSON for `.json` or JSON-looking content, and returning `content`: `../abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py`.
- Runtime's VisualFlow compiler implements `write_file` by writing UTF-8 text, pretty-writing `.json`, creating parent directories, overwriting existing files, and returning `bytes` plus `file_path`: `../abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py`.
- Gateway owns artifact import/export routes with workspace policy, allowed roots, ignored paths, overwrite, and parent-directory controls: `../abstractgateway/src/abstractgateway/routes/gateway.py`.
- Flow's Run modal artifact input uses Gateway upload/import/search contracts for run-start artifact refs: `web/frontend/src/components/ArtifactInputField.tsx`.
- Flow's Run modal shows generated media artifact content links, but intentionally does not expose artifact export as a modal control: `web/frontend/src/components/RunFlowModal.tsx`.

## Problem or opportunity
The current UX splits file and artifact operations in a way that is technically defensible but conceptually rough:

- users see `Read File` / `Write File` and reasonably expect them to handle files that become artifacts or artifacts that become files;
- generated artifacts can be opened/downloaded from result cards, but not written to workspace files as first-class graph steps;
- JSON/document artifacts are not first-class enough for data workflows;
- workflows that intentionally build a directory tree, memory dossier, report package, or structured data corpus need predictable file semantics in addition to Runtime's internal artifact storage;
- Runtime's automatic artifact storage and user-authored external file trees serve different purposes and should not be conflated.

## Proposed direction
Run a focused design pass that compares and prototypes at least two options:

1. **Explicit artifact IO nodes**
   - Keep `Read File` / `Write File` as workspace filesystem nodes.
   - Add `Import Artifact` and `Export Artifact` nodes that call Gateway artifact contracts.
   - Add generic JSON/document/file artifact pin types and cards.

2. **Expanded file nodes**
   - Evolve `Read File` / `Write File` into higher-level file/artifact bridge nodes.
   - Let `Read File` optionally output both loaded runtime value and artifact ref.
   - Let `Write File` optionally write plain content, artifact bytes, or structured JSON into workspace paths.
   - Make artifact import/export behavior explicit through mode pins or options, not hidden side effects.

3. **Hybrid resolution**
   - Keep the visible node names simple (`Read File`, `Write File`) but use explicit modes such as `workspace`, `artifact`, or `both`.
   - Preserve Gateway as the policy authority for any server filesystem access.
   - Preserve Runtime as the artifact store/handoff authority.

The design should decide whether `Read File` / `Write File` remain low-level text/JSON nodes, become artifact-aware, or get paired with explicit artifact nodes while keeping their labels as user-facing affordances.

## Why it might matter
This affects core mental models:

- Files are user-visible, path-addressed, and useful for dossiers, reports, datasets, and memory systems.
- Artifacts are durable, content-addressed/run-scoped payloads for runtime handoff, previews, downloads, model media inputs, and ledger-safe persistence.
- JSON should be treated as a first-class artifact/data shape, not only as text.
- Directories and file trees are meaningful outputs for many specialized workflows and should not disappear behind Runtime internals.

Getting this wrong will either make artifacts feel too magical or make file workflows bypass safety, provenance, and runtime durability.

## Promotion criteria
Promote this to `planned/` when at least one of these is true:

- a concrete workflow needs to build or consume a structured file/directory dossier from Flow;
- users need graph-level artifact export/import instead of ad hoc Run modal actions;
- JSON/document artifacts become required for a Gateway/Core/Flow integration;
- the team agrees on whether file nodes should be artifact-aware or whether explicit artifact IO nodes are the clearer contract.

## Validation ideas
- Code audit: confirm the runtime path used by `Read File` / `Write File` under Gateway-hosted runs and whether it should be `workspace_root`, not process cwd.
- Prototype both designs with one workflow:
  - import JSON from workspace into artifact;
  - parse/load it into runtime values;
  - transform it;
  - write a directory tree containing JSON, text, and one copied media artifact;
  - export the final package or key files.
- Tests should cover:
  - parent directory creation;
  - overwrite behavior;
  - `.json`, `application/json`, and `application/*+json`;
  - text/document/image/audio/video artifact refs;
  - ignored-path and allowed-root enforcement through Gateway;
  - remote Gateway behavior where browser paths and server workspace paths differ.

## Non-goals
- Do not weaken Gateway workspace policy or allow browser-local paths to masquerade as server paths.
- Do not make Runtime artifact storage a substitute for user-requested file trees.
- Do not hide artifact import/export as an implicit side effect without visible mode/options.
- Do not implement semantic artifact search in this item.

## Guidance for future agents
Re-open the design with both positions intact. Avoid forcing a false choice between artifacts and files: Runtime artifacts and workflow-authored filesystem outputs are complementary. The useful resolution is probably a small set of explicit modes and pin types that make the boundary visible without making common file workflows verbose.
