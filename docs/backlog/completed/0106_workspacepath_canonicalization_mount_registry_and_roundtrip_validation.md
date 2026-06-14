# Completed: WorkspacePath Canonicalization, Mount Registry, And Round-Trip Validation

## Metadata
- Created: 2026-06-11
- Status: Completed
- Completed: 2026-06-11

## ADR status
- Governing ADRs: `docs/adr/0037-hosted-file-source-contract-and-workspacepath-authority.md`, `docs/adr/0036-artifact-descriptor-contract.md`
- ADR impact: Completed. This item implemented the shared canonical string contract that ADR-0037 left as follow-up work.

## Context
ADR-0037 accepted the hosted source vocabulary and the engineering direction:
durable file payloads stay artifact-backed, while server-side file access
converges on a shared `WorkspacePath` contract.

At the time, Gateway and Runtime still disagreed on the actual public path
string for mounted roots. Gateway used order-dependent `-2` style aliases,
Runtime used hash-suffixed aliases in some paths, and only Runtime accepted a
redundant `<workspace_root_name>/...` compatibility form. That left `0106` as
the contract-convergence item before more file/folder features could safely
build on top.

## Current code reality before closure
- Gateway file helpers and artifact import/export already exposed workspace
  paths publicly, but path canonicalization lived only inside
  `abstractgateway/src/abstractgateway/routes/gateway.py`.
- Runtime file/tool scoping used a separate alias synthesizer in
  `abstractruntime/src/abstractruntime/integrations/abstractcore/workspace_scoped_tools.py`.
- Mounted basename collisions were not validated end-to-end across Gateway
  search/read/import/export and Runtime file-node execution.
- Hosted user-auth admin gating for `/files/*` and artifact import/export was
  already correct, but the canonical-path proof behind those surfaces was not.

## What changed
- Added one shared canonical helper module in
  `abstractcore/abstractcore/utils/workspace_paths.py`.
- Standardized the public server-path contract:
  - `rel/path` for the main workspace root
  - `mount_alias/rel/path` for approved mounts
  - optional `@` and redundant `<workspace_root_name>/...` accepted as legacy
    input sugar but never emitted canonically
- Switched mounted-root collision handling to deterministic digest-suffixed
  aliases for every colliding basename, removing order dependence.
- Updated Gateway to consume the shared helper for mount alias generation and
  workspace-path resolution.
- Updated Runtime workspace-scoped tools to consume the same helper and retain
  compatibility for the older root-name-prefix convenience form.
- Added validation for:
  - runtime mounted-path collision resolution
  - local Runtime cwd fallback when no workspace scope exists
  - Gateway collision alias stability in `/files/search` and `/files/read`
  - one end-to-end Gateway search -> artifact import -> Runtime `read_file` ->
    artifact export round trip using the same mounted alias string
  - existing hosted admin-gating and discovery-denial behavior
- Updated relevant Gateway/Runtime/root docs so the canonical string contract
  and hosted-vs-local fallback rules are documented.

## Scope
- Shared canonicalization helper code.
- Gateway and Runtime mounted-path serialization/resolution.
- Cross-package validation for collision stability and mounted-path round trips.
- Focused coredoc updates directly tied to the shipped contract.

## Non-goals
- This item does not introduce a structured mount-id object or typed
  `WorkspacePath` value in Flow graphs.
- This item does not redesign the file/folder node family from `0095`.
- This item does not broaden hosted server access beyond current workspace
  policy and admin-gated helper routes.

## Expected outcomes
- Gateway and Runtime now emit and consume the same canonical mounted-path
  string contract.
- Colliding mount basenames no longer depend on input ordering.
- Gateway discovery/import/export and Runtime file-node execution can round-trip
  the same mounted alias without drift.
- Hosted admin-gating metadata remains intact while the path contract beneath it
  becomes explicit and test-backed.

## Validation
- Runtime:
  - `pytest tests/test_workspace_policy_mount_virtual_paths.py tests/test_visualflow_file_nodes_workspace.py`
- Gateway:
  - `PYTHONPATH=src:../abstractruntime/src:../abstractcore pytest tests/test_gateway_discovery_endpoints.py tests/test_gateway_artifacts_endpoint.py -k 'files_search_and_read or import_session_list_export_and_run_start_validation'`
  - `PYTHONPATH=src:../abstractruntime/src:../abstractcore pytest tests/test_gateway_visualflow_file_nodes.py -k 'mount_alias_round_trips'`
  - `PYTHONPATH=src:../abstractruntime/src:../abstractcore pytest tests/test_gateway_workspace_policy_enforcement.py tests/test_gateway_principal_isolation_matrix.py -k 'workspace_policy or principal_isolation'`
- Architecture review, independent review, and UX review all completed before closure.

## Progress checklist
- [x] Audit current Gateway and Runtime path canonicalization differences.
- [x] Choose the shared public server-path representation.
- [x] Implement shared canonicalization and mount authority handling.
- [x] Remove or guard divergent Runtime alias synthesis.
- [x] Add end-to-end validation for mounted-path round trips.
- [x] Document remaining non-portable or admin-only cases.

## Completion report
- Completed: 2026-06-11
- Summary: Landed a shared canonical workspace-path helper in AbstractCore,
  switched Gateway and Runtime to the same deterministic mount-alias contract,
  validated basename collisions plus a full Gateway search/import/Runtime
  execution/export round trip, and documented the contract in the relevant
  Gateway/Runtime/root docs.
- Code and docs touched:
  - `abstractcore/abstractcore/utils/workspace_paths.py`
  - `abstractgateway/src/abstractgateway/routes/gateway.py`
  - `abstractruntime/src/abstractruntime/integrations/abstractcore/workspace_scoped_tools.py`
  - `abstractgateway/tests/test_gateway_discovery_endpoints.py`
  - `abstractgateway/tests/test_gateway_visualflow_file_nodes.py`
  - `abstractruntime/tests/test_workspace_policy_mount_virtual_paths.py`
  - `abstractruntime/tests/test_visualflow_file_nodes_workspace.py`
  - `docs/guide/gateway-security.md`
  - `abstractgateway/docs/api.md`
  - `abstractgateway/docs/security.md`
  - `abstractruntime/docs/api.md`
  - `abstractruntime/llms.txt`
  - `abstractruntime/llms-full.txt`
- Residual risks:
  - The contract is still a scoped string capability, not a structured mount-id
    identity object. If future work needs durable mount identity across topology
    changes, a new ADR/update will be required.
  - Runtime local fallback to `cwd` remains for non-Gateway local runs; docs now
    state that explicitly instead of implying hosted-only behavior is universal.
- Priority impact at the time:
  - `0095` could now build future file/folder/product features on a tested
    canonical path contract.
  - `0103` was the next broad coredoc sweep for the remaining package
    surfaces, especially Observer.
