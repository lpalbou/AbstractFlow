# Flow Core Boundary And Local Compatibility Mode

## Problem

AbstractFlow is supposed to be gateway-first for real remote execution, with local compatibility paths remaining clearly
secondary.

Today Flow still owns part of the Core transport/control logic directly:

- local residency-only execution resolves `ABSTRACTCORE_SERVER_BASE_URL`
- Flow constructs `RemoteAbstractCoreLLMClient` itself
- Flow therefore special-cases Core topology in the app layer

That is the wrong abstraction boundary.

There is also a separate UX truthfulness issue: optional residency steps that complete with `ok:false` can still render
as plain success.

## Goals

- Keep Flow gateway-first.
- Keep local compatibility mode available only where it is intentional.
- Remove Flow-owned Core env/transport/auth/client construction.
- Render soft residency no-ops honestly.

## Proposed Direction

### 1. Flow should not construct Core clients

If local Flow needs access to standalone-Core-backed residency or discovery, it should obtain that through Runtime's
public host facade, not by constructing `RemoteAbstractCoreLLMClient` in Flow code.

Flow may still own editor/workflow UX and local dev toggles, but not the Core transport/integration logic itself.
Flow code should not resolve `ABSTRACTCORE_SERVER_BASE_URL` directly either; that belongs to the backend host or the
Runtime wiring layer.

### 2. Demote the current path to explicit compatibility mode

Standalone-Core-backed local Flow can remain supported for development or migration if needed.

But it should be framed as compatibility mode:

- explicit
- documented
- backed by a Runtime instance that exposes the same public host facade used by higher layers

It should not be a first-class independent integration path.

Runtime already exposes the public host facade needed for residency cleanup, so this Flow fix should not require a new
Flow-owned Core transport path.
Runtime also now exposes a public durable run facade for host-triggered media work, which reinforces the same rule:
Flow should consume Gateway or Runtime surfaces, not invent a parallel Core-execution path in the app layer.

### 3. Keep Flow consuming Gateway contracts remotely

For remote usage, Flow should continue to rely on Gateway capability/discovery/residency contracts rather than owning
parallel Core discovery logic.

### 4. Fix step truthfulness in the run UI

Flow must distinguish:

- lifecycle completion
- semantic success

For `model_residency`:

- `completed + ok:true` => success
- `completed + ok:false` => warning / no-op / degraded
- `failed` => failure

The overall run can still succeed when the workflow author set `required=false`.

### 5. Keep media identity separate from runtime orchestration identity

Once Runtime exposes separate runtime/media identities, Flow should render the actual media backend model/provider for
image/voice/transcription steps instead of displaying the orchestration chat/runtime model as if it produced the media.

## Acceptance Criteria

- Flow no longer constructs remote Core clients directly or resolves Core-server env/config in app-layer execution code.
- Any supported local standalone-Core path goes through a Runtime instance and Runtime's host facade.
- Remote Flow continues to use Gateway as the source of truth.
- Optional unsupported residency steps render as warning/degraded, not green success.
- Media-step badges use media backend identity rather than runtime orchestration identity once the upstream contract is
  available.

## Initial Follow-On Work

1. Remove direct Core-client construction and Core env resolution from local residency paths.
2. Rewire any remaining standalone-Core local compatibility logic through a Runtime instance and Runtime's public host
   facade.
3. Update run-modal status mapping for `completed + ok:false`.
4. Align node shortcuts/panels with the Gateway contract and upstream runtime/media identity split.
