# Proposed: Code node execution permissions

## Metadata
- Created: 2026-05-25
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: Needs new ADR

## Context
Code nodes execute Python transform bodies through AbstractRuntime's code executor. Flow now exposes an explicit `permissions` pin, editor simulation sends that value to Gateway, Runtime/Gateway share the same `sandbox` / `full_access` contract, and Gateway advertises the effective policy through `contracts.common.execution.code`. Full access is still host-policy gated and disabled by default.

## Current code reality
- `abstractruntime.visualflow_compiler.visual.code_executor.create_code_handler(..., permissions=...)` accepts `sandbox` and `full_access`.
- `sandbox` validates Python AST and executes with RestrictedPython when available.
- `full_access` executes normal Python only when the Runtime host process has `ABSTRACTRUNTIME_CODE_FULL_ACCESS=1`; otherwise it fails closed.
- `abstractgateway.routes.gateway.simulate_visualflow_code` accepts `permissions`, reports requested/effective mode diagnostics, and uses the same Runtime code executor for editor test runs.
- `abstractflow.web.frontend` exposes a Code-node `permissions` pin/dropdown, derives availability from Gateway policy discovery, keeps that control out of generated Python variables, and sends it to simulation.
- Runtime Code-node execution adds the effective permissions mode to the `execution` output object.
- Runtime Code-node failures now preserve the standard Code output envelope (`success: false`, `output: null`, `result: null`, `error`, and `execution`) for run observability.
- Remaining gaps: no out-of-process full-access isolation, no average CPU/memory sampler, and no ADR for elevated-code trust boundaries beyond the current local-trust env gate.

## Problem or opportunity
The first implementation is deliberately narrow. Full-access code still runs in-process when enabled, so it is suitable only for trusted local deployments. A stronger framework policy should make the available modes discoverable to clients, audit the selected mode explicitly, and eventually run elevated code through a better isolated backend.

## Proposed direction
Extend the current Code execution policy model:
- Keep `sandbox` as the default and protected path.
- Keep `full_access` as explicit deployment policy, never a silent frontend choice.
- Keep the Gateway capability policy as the Flow discovery source for available modes.
- Record the selected/effective policy in run ledger/audit metadata beyond the current `execution` output object.
- Label process-level timing/RSS metrics honestly unless or until a separate sampler/worker can provide true average CPU and memory.
- Consider a separate process or worker backend for elevated code to avoid granting broad rights inside the Runtime process.

## Why it might matter
Some workflows need controlled file or package access, but unsafe execution is a security-sensitive feature. A clean policy model prevents hidden privilege escalation and makes code-node behavior portable across local and remote Gateway deployments.

## Promotion criteria
- The host policy can answer whether a run may request each mode without relying only on environment variables.
- Audit/ledger fields for code execution permissions are defined.
- The UX can disable unavailable modes without pretending they will work.
- A safer elevated execution backend is selected or explicitly rejected by ADR.

## Validation ideas
- Unit tests proving sandbox remains the default for run execution and editor simulation.
- Gateway tests proving unsupported permission modes are rejected deterministically.
- Runtime tests proving elevated modes cannot be selected unless the host explicitly enables them.
- Flow UI tests proving the selector reflects Gateway capability/policy state.

## Non-goals
- Do not enable full access by default.
- Do not bypass RestrictedPython from Flow without a Gateway/Runtime policy.
- Do not implement package dependency bundling here; that remains tracked by `0077_custom_code_languages_and_dependencies.md`.

## Guidance for future agents
Start with an ADR before broadening elevated execution. Treat the current implementation as a narrow local-trust primitive: one default protected sandbox plus one explicitly enabled local full-access mode, with clear rejection when policy denies it.
