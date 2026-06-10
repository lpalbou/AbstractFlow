# Completed: Authoring assistant artifact readiness and persistence

## Metadata
- Created: 2026-06-05
- Status: Completed
- Completed: 2026-06-05

## ADR status
- Governing ADRs: root `docs/adr/0026-truncation-policy-and-contract.md`, root `docs/adr/0035-capability-routing-defaults.md`, `abstractcore/docs/adr/0001-engineering-guardrails-and-no-silent-degradation.md`
- ADR impact: No new ADR. This item continues the no-silent-truncation, Gateway-default routing, and fail-closed authoring behavior.

## Context
The autonomous authoring assistant could build a working draft graph, but it still accepted shallow research workflows as ready. It also lost the chat when the drawer was closed, produced noisy chat output by dumping every reducer operation, did not require an authored Agent system prompt, accepted `Agent.meta` as if it were research sources, and had no first-class command for authoring sandbox Code node bodies.

## What changed
- Persisted the assistant conversation, draft text, and planner session id in local storage; Clear Chat now resets the assistant session without changing the graph.
- Added `set_code_body` plus `add_node.codeBody` support to the validated authoring command reducer, while preserving sandbox permissions and rejecting Code `full_access`.
- Replaced `llms-full.txt` as the planner's graph-construction context with `docs/workflow-authoring-skill.md` plus a complete generated node catalog from `src/types/nodes.ts`, including every palette template, duplicate `templateLabel` requirements, pin contracts, gateway capability requirements, dynamic-pin policy, and authorable config commands.
- Hardened command validation so duplicate node templates fail closed without an exact `templateLabel`, `add_node.pinDefaults` cannot set unknown/output/execution pins, Break Object path commands stay synchronized with selected paths, Tool Calls must be created with an explicit allowlist, and event nodes can be configured through validated `set_event_config`.
- Passed the full live Gateway tool inventory, including tool parameter schemas, and the full current graph authorable config into the planner context so the assistant can reason from actual AbstractFlow capabilities rather than guessing node internals.
- Tightened research readiness checks so generated Agent nodes require non-empty `system` instructions, sources cannot be satisfied by `Agent.meta`, and `Agent Trace Report` cannot stand in for the final report.
- Added Markdown/PDF artifact readiness checks: Markdown requests require a connected `.md` `Write File`; PDF requests require PDF content produced by an explicit graph path, typically sandbox Code when no dedicated catalog node exists, before feeding a `.pdf` `Write File`; raw Markdown-to-`.pdf` writes do not pass.
- Replaced verbose successful chat output with a short applied summary while keeping detailed planner/validator diagnostics for failures.
- Updated `README.md`, `docs/web-editor.md`, `docs/architecture.md`, added `docs/workflow-authoring-skill.md`, and regenerated `llms-full.txt`.

## Scope
- AbstractFlow frontend, docs, and backlog only.
- No AbstractGateway, AbstractRuntime, or AbstractCore changes.
- No automatic save, publish, or run. Draft execution remains the existing explicit Run path.

## Expected outcomes
- A deep-research request must produce a more complete graph with authored agent behavior, real source/report/audit boundaries, and requested Markdown/PDF file outputs before the assistant can mark the draft ready.
- Follow-up turns survive drawer close/reopen and continue from the same assistant session.
- Successful assistant messages are readable; failure messages still expose the planner response, attempted commands, validator errors, and candidate graph for debugging.

## Validation
- `npm test -- AuthoringAssistantDrawer flowAuthoringCommands`
- `npm run lint`
- `npm run build`
- `npm run docs:llms`

## Progress checklist
- [x] Run architecture pass against Flow-owned vs Gateway-owned assistant session options.
- [x] Add persisted assistant conversation/session state.
- [x] Add Code body authoring commands.
- [x] Add generated node catalog and complete authoring guide for planner context.
- [x] Harden node/template/config command validation.
- [x] Add artifact-specific Markdown/PDF readiness checks.
- [x] Reject `Agent.meta` as research sources and trace reports as final reports.
- [x] Reduce successful chat output noise.
- [x] Update docs and regenerated LLM context.
- [x] Run focused tests, lint, and build.

## Guidance for future work
Automatic verification runs should be handled as a separate run-lifecycle feature. It needs an explicit policy for saving/publishing draft graphs, run input generation, artifact cleanup, cancellation, and user consent before mutating durable Gateway state.
