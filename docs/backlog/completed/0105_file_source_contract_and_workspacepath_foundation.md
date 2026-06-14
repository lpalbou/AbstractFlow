# Completed: File Source Contract And WorkspacePath Foundation

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: Completed. This item landed ADR-0037 as the durable hosted source contract and authority boundary.

## Context
AbstractFlow needed one accepted foundation before node naming, coredoc
alignment, and future file/folder features could proceed safely.

Artifact ownership was already stable through ADR-0036, but hosted file-source
vocabulary and server-path authority were not. The design risk was that Flow
UI/docs/assistant wording would harden into de facto policy before the platform
decided:

- what `Artifact`, `Local File`, and `Server File` should mean;
- what durable value actually enters a hosted run;
- how server workspace paths should be described without implying generic
  server-filesystem access;
- what remained true today versus what was only an accepted target model.

## Current code reality
- Runtime-owned artifact meaning is already canonical through ADR-0036 and the
  Runtime artifact descriptor contract:
  [docs/adr/0036-artifact-descriptor-contract.md](/Users/albou/tmp/abstractframework/docs/adr/0036-artifact-descriptor-contract.md).
- Browser-local uploads are already policy-distinct from server-side paths and
  become artifacts in hosted Flow:
  [abstractflow/docs/web-editor.md](/Users/albou/tmp/abstractframework/abstractflow/docs/web-editor.md),
  [docs/adr/0023-file-attachment-path-resolution-and-authorization.md](/Users/albou/tmp/abstractframework/docs/adr/0023-file-attachment-path-resolution-and-authorization.md).
- Gateway currently owns workspace policy, per-run workspace creation, and
  mounted/allowlisted server roots, but Gateway and Runtime still do not share
  one stable mounted-path canonicalizer:
  [abstractgateway/docs/security.md](/Users/albou/tmp/abstractframework/abstractgateway/docs/security.md),
  [abstractruntime/src/abstractruntime/integrations/abstractcore/workspace_scoped_tools.py](/Users/albou/tmp/abstractframework/abstractruntime/src/abstractruntime/integrations/abstractcore/workspace_scoped_tools.py).
- Flow already exposes three practical source classes through the artifact input
  picker: existing artifact, browser upload, and workspace import:
  [abstractflow/src/components/ArtifactInputField.tsx](/Users/albou/tmp/abstractframework/abstractflow/src/components/ArtifactInputField.tsx).
- Runtime file nodes still consume raw string paths and can fall back to host
  cwd semantics when workspace scope is missing:
  [abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py](/Users/albou/tmp/abstractframework/abstractruntime/src/abstractruntime/visualflow_compiler/visual/executor.py).
- `0095` already contained the right ingredients, but mixed user-facing
  vocabulary, conceptual engineering primitives, mount authority, grants, and
  future node behavior in one umbrella proposal:
  [../completed/0095_file_nodes_artifact_io_boundary_resolution.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0095_file_nodes_artifact_io_boundary_resolution.md).

## What changed
- Added ADR-0037:
  [docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md](/Users/albou/tmp/abstractframework/docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md)
- Accepted the user-facing hosted source terms:
  - `Artifact`
  - `Local File`
  - `Server File`
- Accepted `WorkspacePath` as the contract name for the Gateway-owned
  workspace-scoped server-path capability, while explicitly recording that a
  shared typed/canonical implementation is still follow-up work.
- Recorded the current hosted truth that server workspace helper/import/export
  behavior remains admin/operator controlled in hosted user-auth mode until a
  stronger per-principal grant model lands.
- Updated root coredoc to teach the new source contract without pretending the
  current Flow UI labels are already renamed.
- Extracted the canonicalization and round-trip proof gap into `0106`, which is
  now completed:
  [../completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md)

## Scope
- Hosted source vocabulary and authority model.
- New governing ADR.
- Root coredoc updates needed to teach the accepted contract.
- Backlog follow-up reshaping so `0104`, `0103`, and implementation work can
  proceed honestly.

## Non-goals
- This item does not implement shared mounted-path canonicalization.
- This item does not rename current Flow product labels; `0104` owns that pass.
- This item did not complete the cross-package coredoc sweep on its own; that
  broader documentation track later closed as `0103`.
- This item does not design the full file/folder node catalog.

## Dependencies and related tasks
- [../completed/0095_file_nodes_artifact_io_boundary_resolution.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0095_file_nodes_artifact_io_boundary_resolution.md): the resulting file/artifact node and workspace-path implementation closure.
- [../completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md): completed shared canonicalization and alias-drift proof.
- [../completed/0104_abstractflow_node_and_authoring_terminology_alignment.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0104_abstractflow_node_and_authoring_terminology_alignment.md): completed Flow product-language pass.
- [../completed/0103_coredoc_terminology_alignment_for_artifact_workspace_and_local_sources.md](/Users/albou/tmp/abstractframework/abstractflow/docs/backlog/completed/0103_coredoc_terminology_alignment_for_artifact_workspace_and_local_sources.md): the later cross-package documentation closure.

## Expected outcomes
- One accepted contract exists for `Artifact`, `Local File`, and `Server File`
  as user-facing source classes.
- One accepted engineering answer now exists for the hosted target model:
  durable payloads use `ArtifactRef`, and server-side path capability converges
  on `WorkspacePath`.
- The current implementation gap is explicit instead of hidden: shared mounted
  path canonicalization remains follow-up work, not a false claim about current
  code.
- `0104` and `0103` can proceed without terminology churn.
- The remaining implementation breadth inside `0095` is now split at least once
  into a concrete execution item with an owner and validation target.

## Validation
- Architecture review, independent review, and three UX review passes all
  completed before closure.
- Landed ADR-0037 and cross-linked it from backlog/docs.
- Updated root docs so `Artifact`, `Local File`, `Server File`, and
  `Workspace` no longer contradict one another.
- Converted the shared canonicalizer/round-trip evidence gap into explicit
  follow-up backlog work instead of claiming it is already implemented.
- Pending for `0106`, not for this item: mounted-path alias-drift proof across
  Gateway and Runtime.

## Progress checklist
- [x] Confirm artifact ownership is already governed and does not need to be re-decided.
- [x] Decide the accepted hosted target model for durable payloads versus server paths.
- [x] Define the short user-facing source contract.
- [x] Define the current authority boundary for hosted grants vs dev/trusted overrides.
- [x] Land the governing ADR.
- [x] Mark `0104` and `0103` ready to proceed.
- [x] Split the canonicalization/round-trip implementation gap into a follow-up item.

## Completion report
- Completed: 2026-06-11
- Summary: Landed ADR-0037 to define the hosted `Artifact` / `Local File` /
  `Server File` source contract, clarified that `WorkspacePath` is the accepted
  contract name for Gateway-owned server-path capability rather than a fully
  shipped typed primitive today, updated root coredoc to teach that model, and
  created `0106` so the missing canonicalization/round-trip implementation does
  not get buried.
- Docs and backlog touched:
  - `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`
  - `docs/adr/README.md`
  - `docs/README.md`
  - `docs/architecture.md`
  - `docs/glossary.md`
  - `docs/guide/gateway-security.md`
  - `docs/guide/runtime-artifacts.md`
  - `llms.txt`
  - `abstractflow/docs/backlog/overview.md`
  - `abstractflow/docs/backlog/completed/0105_file_source_contract_and_workspacepath_foundation.md`
  - `abstractflow/docs/backlog/completed/0103_coredoc_terminology_alignment_for_artifact_workspace_and_local_sources.md`
  - `abstractflow/docs/backlog/completed/0104_abstractflow_node_and_authoring_terminology_alignment.md`
  - `abstractflow/docs/backlog/completed/0106_workspacepath_canonicalization_mount_registry_and_roundtrip_validation.md`
  - `abstractflow/docs/backlog/completed/0095_file_nodes_artifact_io_boundary_resolution.md`
- Validation:
  - Architecture review subagent
  - Independent review subagent
  - Beginner, intermediate, and expert UX review subagents
  - Root doc/backlog consistency re-read
- Residual risks:
  - Gateway and Runtime still need one shared mounted-path canonicalizer and
    alias-drift proof.
  - Current Flow UI labels still use older wording until `0104` lands.
  - Current hosted user-auth server workspace access remains conservative and
    admin/operator controlled until a stronger grant model lands.
- Priority impact at the time:
  - `0104` and `0103` were no longer blocked by missing contract.
  - `0106` was the next implementation-critical follow-up for actual
    file/folder feature work.
