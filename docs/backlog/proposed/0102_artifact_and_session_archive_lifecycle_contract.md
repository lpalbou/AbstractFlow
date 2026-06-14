# Proposed: Artifact And Session Archive Lifecycle Contract

## Metadata
- Created: 2026-06-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None identified after review
- ADR impact: May need new ADR

## Context
Users need a safe way to remove artifacts and sessions from ordinary product
surfaces without destroying bytes, provenance, or observability history.

Current design discussion converged on this requirement:

- normal users may archive artifacts and sessions;
- archived items should disappear from ordinary search, pickers, agent context,
  and replay surfaces;
- AbstractObserver or a future operator/admin surface must still be able to see
  archived data;
- hard delete must remain an explicit admin/retention path, not the ordinary
  user action.

## Current code reality
- Artifact storage supports `update_metadata(...)` and destructive `delete(...)`:
  `../../../../abstractruntime/src/abstractruntime/storage/artifacts.py`.
- Gateway artifact search/stats/list/content/read routes span many code paths;
  archive is not currently a first-class indexed filter:
  `../../../../abstractgateway/src/abstractgateway/routes/gateway.py`.
- Artifact reuse and visibility are validated at run start, including session
  visibility checks:
  `../../../../abstractgateway/src/abstractgateway/routes/gateway.py`.
- Session behavior is currently assembled from `run.session_id`, the internal
  session-memory owner run, artifact session tags, and best-effort history
  bundle export:
  `../../../../abstractgateway/src/abstractgateway/routes/gateway.py`,
  `../../../../abstractruntime/src/abstractruntime/history_bundle.py`,
  `../../../../abstractruntime/src/abstractruntime/integrations/abstractcore/session_attachments.py`.
- `run_lifecycle.visibility` already exists for draft/private-style lifecycle
  concerns and should not be overloaded with archive semantics:
  `../../../../abstractruntime/src/abstractruntime/core/run_lifecycle.py`,
  `../src/utils/runLifecycle.ts`.
- Observer is the observability app today, but long-term high-trust admin
  surfaces may move or split:
  `../../../../docs/guide/runtime-artifacts.md`,
  `../../../../docs/backlog/planned/gateway-control-plane/0150_observer_manager_responsibility_split.md`.

## Problem or opportunity
An archive feature implemented as a tag convention, descriptor hint, or UI-only
filter will be wrong.

Too many existing surfaces bypass tag-only filtering:

- artifact search/stats vs direct metadata/content reads;
- run-start artifact ref validation;
- session attachment injection for assistants/agents;
- `runs`, `history_bundle`, and replay surfaces.

If archive is not a first-class lifecycle contract, archived data will keep
leaking back into ordinary product use.

## Proposed direction
Introduce first-class archive lifecycle contracts for artifacts and sessions.

### Artifact archive lifecycle

Add a canonical artifact lifecycle object, indexed by storage and visible
through Gateway projections:

- `archive_state`: `active | archived`
- `archived_at`
- `archived_by`
- `archive_reason` (optional)
- `archive_source` (optional; e.g. `user`, `observer`, `retention_policy`)

Notes:

- `archive_reason` must remain optional.
- Tags may mirror archive state for compatibility or ad hoc debugging, but tags
  are not canonical.
- Artifact descriptors should not own archive state; archive is control-plane
  lifecycle, not semantic provenance.

### Session archive lifecycle

Add a canonical session lifecycle record keyed by `session_id`.

The session archive contract should be transitive for default visibility:

- session root runs,
- session memory owner run,
- session-scoped artifacts,
- session attachments,
- session replay / history bundle views

should all behave as archived by default when the session is archived, even if
implementation uses an indexed overlay instead of rewriting every descendant
row.

### Product-state and recovery contract

Archive must not behave like silent disappearance in user-facing surfaces.

- Exact-id and deep-link retrieval should produce explicit archived-state
  responses when authorized, not generic “missing” behavior.
- Product surfaces should specify:
  - archived badge/state;
  - archived-at / archived-by visibility where appropriate;
  - optional archive reason/source visibility;
  - restore/unarchive or operator-retrieval path when supported;
  - denial/recovery copy when ordinary users cannot reuse archived items.
- Observer/operator retrieval should make archived state visible without forcing
  users to inspect raw JSON.

### Ownership and migration notes

- Before promotion, identify the owning control-plane/package surface for the
  canonical session archive record.
- Before implementation, define migration/backfill expectations for existing
  runs, artifacts, and sessions so archive scope does not produce split-brain
  behavior across legacy data.

### Query contract

Add explicit archive query semantics:

- `archive_scope=active|archived|all`

Defaults:

- Flow, Assistant, agents, artifact pickers, and normal user search: `active`
- Observer/operator surfaces: explicit `all` or `archived`, with UI controls
  that make archive state visible

Exact-id behavior must also be explicit:

- ordinary endpoints should not return archived artifacts/sessions/runs unless
  archive scope is explicitly requested and authorized;
- archived artifacts should not be reusable through run-start artifact refs by
  default;
- archived sessions should not feed ordinary replay, follow-up context, or
  session attachment injection by default.

### Deletion policy

- User-facing archive must never call destructive artifact storage delete.
- Hard delete remains admin/retention-only.
- The admin/operator delete surface may eventually live in Observer, Gateway
  Console, or a later Manager/Admin surface, but it should not be the ordinary
  Flow/Assistant lifecycle action.

## Why it might matter
Without a first-class archive contract, the product will drift into split-brain
behavior:

- hidden in one list,
- visible in another,
- still replayable by assistants,
- still reusable by exact id.

That is worse than having no archive at all.

## Promotion criteria
Promote this to `planned/` when one or more of these are true:

- user-facing archive for artifacts or sessions is ready to be implemented;
- Observer or another operator surface needs reliable archived-data retrieval;
- assistant / run-start / replay behavior must exclude archived data by
  default;
- a storage/catalog migration is being scheduled for lifecycle indexing.
- an owning product/control-plane surface and migration approach have been
  identified well enough to schedule safely.

## Validation ideas
- Runtime storage tests for archive lifecycle persistence, metadata updates,
  catalog rebuild, and proof that hard delete remains destructive and separate.
- Gateway tests for `/artifacts/search`, `/artifacts/stats`,
  `/sessions/{session_id}/artifacts`, `/runs/{run_id}/artifacts`, `/runs`, and
  `/runs/{run_id}/history_bundle` with `archive_scope=active|archived|all`.
- Tests proving archived artifacts cannot be reused through ordinary run-start
  artifact refs by default.
- Tests proving archived sessions disappear from ordinary session attachment
  injection and assistant replay/context surfaces by default.
- Observer/operator client tests proving archived items remain visible when the
  archive scope is requested and that archived state is visibly marked.
- Auth tests proving archived retrieval does not weaken existing principal or
  visibility isolation.
- Migration/backfill tests or one-time repair validation proving existing
  artifacts/sessions do not become inconsistently visible under archive scope.
- Product-flow checks for exact-id or history-based retrieval so archived items
  show explicit recovery/denial states instead of generic not-found behavior.

## Non-goals
- Do not implement archive as tags-only, descriptor-only, or UI-only state.
- Do not overload `run_lifecycle.visibility` with archive semantics.
- Do not make archive a synonym for delete.
- Do not settle the final admin UI package boundary in this item.

## Guidance for future agents
Keep archive lifecycle separate from semantic artifact metadata, separate from
draft/private lifecycle, and separate from destructive retention cleanup.
Re-check every read/replay/reuse surface before treating archive as complete.
