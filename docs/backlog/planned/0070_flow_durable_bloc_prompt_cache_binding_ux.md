# Planned: Flow Durable Bloc Prompt-Cache Binding UX

## Metadata
- Created: 2026-05-21
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: `../../../abstractcore/docs/adr/0007-durable-memory-bloc-cache-binding.md`
- ADR impact: None

## Context

The lower layers are now in a materially better state:

- `abstractcore` owns the durable exact-reuse model through blocs + KV artifacts + `prompt_cache_binding`.
- `abstractruntime` exposes that contract through the public AbstractCore host facade and already forwards `prompt_cache_binding` during generation.
- `abstractgateway` exposes the durable bloc contract through `/api/gateway/blocs/*` and advertises it under `contracts.common.prompt_cache.durable_blocs`.

Flow is now the missing layer.

Today the editor has a real session prompt-cache UI for volatile reuse, but it still has no clean
surface for durable exact reuse across app restarts.

## Current code reality

Files and behavior inspected:

- `web/frontend/src/utils/gatewayClient.ts`
  - types `common.prompt_cache.session_lifecycle`
  - does not type or normalize `common.prompt_cache.durable_blocs`
  - readiness only exposes `optional.promptCacheSessions`, not durable blocs
- `web/frontend/src/components/RunFlowModal.tsx`
  - surfaces session prompt-cache controls only:
    `status`, `prepare`, `clear`, `rebuild`
  - stores `runtime_hint.prompt_cache_key`
  - does not call any `/api/gateway/blocs/*` route
  - does not surface `prompt_cache_binding`
- `web/frontend/src/types/nodes.ts`
  - `llm_call` and `agent` nodes do not expose a `prompt_cache_binding` input pin
  - there is no durable prompt-cache/bloc node type
- `abstractflow/visual/executor.py`
  - already wires Gateway/Runtime-backed `llm_call` / `agent` / `model_residency`
  - needs an explicit audit before assuming a new pin is forwarded cleanly end to end
- `../abstractruntime/src/abstractruntime/integrations/abstractcore/llm_client.py`
  - already normalizes and forwards `prompt_cache_binding`
- `../abstractgateway/src/abstractgateway/routes/gateway.py`
  - now exposes `/blocs/upsert_text`, `/blocs/record`, `/blocs`, `/blocs/delete`,
    `/blocs/kv/manifest`, `/blocs/kv/list`, `/blocs/kv/ensure`, `/blocs/kv/load`,
    `/blocs/kv/delete`, `/blocs/kv/prune`
  - `saved/save/load` prompt-cache aliases are now routed through Runtime's public host facade
    and no longer touch provider-private state directly

What is true now:

- Flow can help users manage volatile session prompt-cache keys.
- Flow cannot yet author, inspect, load, or pass durable exact-reuse bindings in a first-class way.
- The clean lower-layer boundary exists, so Flow does not need to invent a bypass.

## Problem

Users can now get durable prompt-cache reuse through Gateway and Runtime, but Flow still lacks the
authoring and operator UX to use it safely.

That leaves two bad outcomes:

1. users fall back to volatile session prompt-cache controls for a problem that actually requires
   exact durable reuse across restarts; or
2. Flow is tempted to invent an out-of-band shortcut that hides host operator calls inside a run,
   which would damage ledger clarity.

## What we want to do

Add a Flow surface for durable prompt-cache reuse that is:

- explicit about the difference between volatile session cache and durable exact reuse
- consistent with the Gateway contract
- usable without teaching users provider-private cache internals
- careful about ledger semantics

## Why

Durable prompt caching is now a real framework capability, not just a lower-layer implementation.

If Flow does not surface it clearly:

- apps running through Gateway cannot easily reuse the same exact prompt-cache blocs after restart
- the editor over-emphasizes the volatile session path
- maintainers will be pressured toward hidden workarounds instead of explicit reusable abstractions

## Requirements

- Treat the three prompt-cache tracks as distinct:
  - session prompt cache = volatile convenience
  - durable blocs + binding = app-facing exact reuse
  - host-local export/import = operator/admin only, not the normal Flow UX
- Do not add a Flow node that secretly performs out-of-band Gateway host mutations during run execution.
- Do not require users to understand provider-native cache files or local filesystem roots.
- Prefer contract-driven capability gating from `contracts.common.prompt_cache.durable_blocs`.
- Keep any exact-reuse data path explicit in the graph or run form; do not silently inject bindings.

## Suggested implementation

### 1. Add durable-bloc contract typing and readiness

Extend Flow's Gateway contract support so it understands:

- `contracts.common.prompt_cache.durable_blocs`
- durable bloc endpoints and capability flags
- the fact that this is optional and separate from `session_lifecycle`

Expected result:

- Flow can tell the difference between:
  - no durable bloc support
  - durable bloc support available
  - session prompt-cache only

### 2. Add an operator-facing durable prompt-cache section to Run Flow

Add a dedicated section near the existing session prompt-cache UI, but keep it clearly separate.

Minimum useful controls:

- inspect durable bloc availability / route support
- look up a bloc by `bloc_id` or `sha256`
- inspect existing KV artifacts for a provider/model
- `ensure` / `load` a KV artifact and display the returned `prompt_cache_binding`
- show key metadata such as `bloc_id`, `sha256`, provider, model, artifact path/id, and binding id

The UI should describe this as exact durable reuse, not as a warmed volatile cache.

### 3. Expose `prompt_cache_binding` explicitly on text-generation nodes

Add an advanced optional input pin to:

- `llm_call`
- `agent`

The pin should accept:

- a binding object
- or a binding id string if Runtime still accepts that form

This lets Flow consume a binding cleanly once it exists, without pretending that the graph can
produce one magically.

### 4. Do not add a fake durable-bloc workflow node yet

Do **not** create a first-class Flow node that performs bloc `upsert/ensure/load` through Gateway
host routes during a normal run unless Runtime later owns a real ledgered effect for that work.

For now:

- the graph may consume `prompt_cache_binding`
- Run Flow may offer operator controls to fetch/load a binding before the run
- a later item can add a node only if the lower layer gives Flow a real run-owned effect

### 5. Make the UX precise

- Session prompt cache stays framed as volatile reuse.
- Durable bloc UX stays framed as exact reusable prefixes.
- Host-local export/import should not be promoted into normal Flow authoring.
- If a loaded binding is shown in the modal, provide copy/export affordances rather than silent
  hidden mutation of unrelated nodes.

## Scope

- Gateway contract typing in Flow.
- Run Flow modal/operator UX for durable bloc inspection and binding loading.
- `llm_call` / `agent` node pin model updates for explicit binding consumption.
- Frontend and backend tests needed to prove contract parsing and authoring behavior.

## Non-goals

- Do not expose host-local prompt-cache export/import as the main Flow prompt-cache UX.
- Do not add provider-private cache controls to Flow.
- Do not hide durable bloc host calls inside ordinary run execution.
- Do not promise a first-class in-run durable-bloc effect unless Runtime owns it publicly.
- Do not collapse session prompt cache and durable blocs into one ambiguous panel.

## Dependencies and related tasks

- `../proposed/2026-05-09_abstractflow_gateway_migration_roadmap.md`
- `../proposed/2026-05-19_model_residency_flow_controls.md`
- `../proposed/2026-05-20_flow_core_boundary_and_local_compatibility_mode.md`
- `../completed/040_gateway_capability_schema_and_connection_contract.md`
- Runtime completed: `../../../abstractruntime/docs/backlog/completed/027_runtime_durable_bloc_prompt_cache_facade.md`
- Runtime completed: `../../../abstractruntime/docs/backlog/completed/028_runtime_bloc_kv_lifecycle_and_pruning.md`
- Gateway completed: `../../../abstractgateway/docs/backlog/completed/2026-05-20_gateway_durable_bloc_prompt_cache_contract.md`
- Core ADR: `../../../abstractcore/docs/adr/0007-durable-memory-bloc-cache-binding.md`

## Expected outcomes

- Flow can detect durable bloc capability from the Gateway contract.
- Users can inspect/load durable prompt-cache bindings without reaching into provider-private logic.
- `llm_call` and `agent` can consume explicit `prompt_cache_binding` values.
- Flow remains honest about what is operator-side host control versus what is actual run-owned ledgered behavior.

## Validation

- Extend `tests/test_frontend_gateway_contract.py` for `common.prompt_cache.durable_blocs`.
- Add frontend tests for durable-bloc route normalization and unavailable states.
- Add UI tests for the Run Flow modal durable prompt-cache section:
  - available state
  - unsupported/unavailable state
  - binding load result rendering
- Add graph/node tests proving `llm_call` and `agent` surface a `prompt_cache_binding` input pin
  without regressing existing provider/model pin UX.
- Add backend/compiler validation proving a supplied `prompt_cache_binding` can traverse Flow into
  Runtime-backed execution, or explicitly document and track any remaining lower-layer blocker
  before implementation.

## Progress checklist

- [ ] Add Flow-side typing for `common.prompt_cache.durable_blocs`.
- [ ] Add readiness/optional-feature helpers for durable blocs.
- [ ] Add a durable prompt-cache operator section in Run Flow.
- [ ] Add explicit `prompt_cache_binding` input pins for `llm_call` and `agent`.
- [ ] Add tests for contract parsing, unavailable states, and binding display.
- [ ] Audit compiler/runtime lowering for explicit binding pass-through before shipping.

## Guidance for the implementing agent

Do not invent a fake shortcut that hides host-level Gateway bloc operations inside a normal
workflow run.

The lower layers are finally clean enough that Flow should preserve that discipline:

- use the Gateway contract
- keep durable exact reuse separate from volatile session cache
- expose `prompt_cache_binding` explicitly
- only introduce a first-class graph node for bloc preparation if Runtime later owns that work as a
  real ledgered effect
