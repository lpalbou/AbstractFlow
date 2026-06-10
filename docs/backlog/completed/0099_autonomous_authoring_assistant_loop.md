# Completed: Autonomous authoring assistant loop

## Metadata
- Created: 2026-06-05
- Status: Completed
- Completed: 2026-06-05

## ADR status
- Governing ADRs: root `docs/adr/0026-truncation-policy-and-contract.md`, root `docs/adr/0035-capability-routing-defaults.md`, `abstractcore/docs/adr/0001-engineering-guardrails-and-no-silent-degradation.md`
- ADR impact: No new ADR. This item enforces the existing fail-closed/no-silent-degradation and no-silent-truncation rules in the Flow authoring assistant.

## Context
The first authoring assistant drawer created validated graph patches, but it behaved as a single-shot planner. For deep research and similar workflows, that produced shallow graphs and did not loop over draft state, preflight/readiness issues, and repair attempts.

## Current code reality
- `src/components/AuthoringAssistantDrawer.tsx` owned the assistant prompt, Gateway planner run, ledger response extraction, command parsing, command application, and drawer UI.
- `src/utils/flowAuthoringCommands.ts` already provided the validated mutation boundary.
- `src/utils/preflight.ts` already provided reusable run-readiness checks.
- `src/utils/gatewayClient.ts` resolved Gateway capability defaults through advertised contracts.
- `src/types/nodes.ts`, `src/utils/serialization.ts`, and `src/utils/nodePinDisclosure.ts` carried an Agent `max_iterations` default that needed to match the existing 50-iteration UI/runtime policy.

## Problem
The assistant needed to act like an autonomous authoring agent, not a one-response template planner. It also needed to stop using hardcoded tool names or assistant-owned substitute endpoint/default behavior.

## What changed
- Replaced the one-shot submit path with a Flow-owned authoring loop that starts Gateway `basic-agent` planner runs, reads terminal responses from ledgers, applies validated commands, recomputes readiness, reflects, and continues until ready or explicitly blocked.
- Added strict response parsing: the Gateway model must return the requested JSON object with explicit `status`, command list, self-review, next-step, and final explanation fields.
- Added assistant-specific readiness checks for research-like workflows: On Flow Start, prompt builder, Agent, explicit tools, Agent `max_iterations=50`, and On Flow End report output.
- Loaded Gateway tool inventory from the advertised discovery endpoint and instructed the model to use only exact discovered tool names.
- Removed assistant-specific substitute behavior for `input.text` defaults and non-advertised capability-default endpoints.
- Kept prior user turns in prompt context while treating the current graph summary as the source of assistant-applied draft state.
- Added a visible loop status strip with phase, cycle, applied command count, and readiness issue count.
- Removed the dependency on Gateway's console sandbox request contract; the planner now uses normal Gateway run start and ledger routes and does not apply client-side prompt shortening.
- Tightened the command reducer to reject hidden/deprecated node templates and secret-looking `literalValue` payloads during node creation.
- Aligned Agent node defaults to `max_iterations: 50`.

## Scope
- AbstractFlow frontend and docs only.
- No AbstractGateway, AbstractRuntime, or AbstractCore code changes.
- No automatic save, publish, run, or server-side durable assistant session.

## Expected outcomes
- Research/news/job-search/deep-research requests produce richer multi-step drafts instead of a basic start-agent-end graph.
- Follow-up user turns refine the current graph through the same loop.
- Tool-dependent workflows fail closed if Gateway tool discovery is unavailable or empty.
- Invalid model JSON, rejected commands, premature `done`, and Gateway errors are surfaced to the user with no local substitute plan.

## Validation
- `npm run lint -- --max-warnings=0`
- `npm test`
- `npm run build`

## Progress checklist
- [x] Run architecture/review pass with distinct reviewer lenses.
- [x] Remove assistant-specific substitute paths.
- [x] Implement iterative authoring controller.
- [x] Reuse existing command reducer and preflight checks.
- [x] Add Gateway tool inventory context.
- [x] Update docs and regenerate `llms-full.txt`.
- [x] Run validation.

## Guidance for future work
If authoring needs durable audit, cancellation across page reloads, collaboration, or server-side policy controls, promote a Gateway-owned authoring-session contract as a new planned item. The current item is intentionally the Flow-owned reversible v1.
