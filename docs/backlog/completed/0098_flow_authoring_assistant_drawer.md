# Completed: Flow authoring assistant drawer

## Metadata
- Created: 2026-06-05
- Status: Completed
- Completed: 2026-06-05

## ADR status
- Governing ADRs: root `docs/adr/0026-truncation-policy-and-contract.md`, root `docs/adr/0031-workflow-llm-routing-overrides-provider-model-and-base-url.md`, root `docs/adr/0035-capability-routing-defaults.md`, `abstractcore/docs/adr/0001-engineering-guardrails-and-no-silent-degradation.md`
- ADR impact: The assistant must fail closed on Gateway/default/model/JSON/command errors. It must not silently synthesize a compensating local workflow.

## Context
AbstractFlow is the browser authoring surface for VisualFlow. It owns graph editing, node templates, connection validation, and serialization, while AbstractGateway owns user auth, provider credentials, workflow persistence, publish/run lifecycle, ledgers, artifacts, and runtime routing.

The requested feature is a conversational assistant in the Flow UI that helps authors create and refine workflows such as internet research, deep research, news digests, and job-search flows. The assistant should understand current AbstractFlow documentation, especially `llms-full.txt`, and should visibly fill the current draft graph as it works.

## Current code reality
- `src/App.tsx` mounts the toolbar, left palette, canvas, and a right Properties drawer driven by `selectedNode`.
- `src/components/Toolbar.tsx` owns the navbar actions and Gateway readiness checks.
- `src/hooks/useFlow.ts` owns graph state, selection, load/save serialization, and local graph mutation actions.
- `src/types/nodes.ts` is the canonical node-template and pin source for authoring.
- `src/utils/validation.ts` validates typed connections.
- `src/utils/preflight.ts` checks run readiness before execution.
- `llms-full.txt` exists at the package root and is generated from the core docs by `scripts/generate-llms-full.mjs`.
- Gateway already provides durable run start and ledger routes through the existing Flow proxy; the assistant should use those Gateway-owned execution paths instead of direct provider calls.

## Problem
Users currently build workflows manually by dragging nodes and configuring pins. There is no guided authoring loop that can translate a workflow goal into an editable VisualFlow draft, explain the resulting graph, and refine it across turns.

The dangerous implementation path would let an LLM emit raw VisualFlow JSON or call arbitrary Gateway APIs. That would bypass existing node templates, pin validation, capability boundaries, and user-controlled save/publish/run steps.

## What we want to do
Add an AbstractFlow authoring assistant drawer opened from the toolbar. The assistant keeps a local multi-turn conversation, calls the Gateway default text model unless the user pins a provider/model, and applies only validated typed graph commands to the in-memory draft graph.

The assistant should end every turn with a concise explanation of how the workflow works, how to test it, and what to expect.

## Why
This improves first-run and expert workflow authoring without changing the Gateway/Runtime execution contract. The graph remains a normal draft until the user explicitly saves, publishes, or runs it.

## Requirements
- Add a toolbar affordance for the authoring assistant.
- Add an assistant right drawer that can coexist with the Properties drawer as an explicit drawer mode.
- Use current `llms-full.txt` content as assistant reference context.
- Show the Gateway prompt-size context, display selected model context/output limits from Gateway model-capability discovery when available, and provide a Clear Chat control; never silently truncate assistant conversation, selected docs sections, or graph summary to fit a local request limit.
- Keep provider calls behind the existing Gateway session/proxy boundary; do not call providers directly from the browser with secrets.
- Treat model output as untrusted graph commands, not as raw graph state.
- Validate commands against node templates, pin ids, connection rules, and high-risk controls before applying.
- Auto-apply only safe draft authoring changes; block or warn on high-risk commands such as full-access code execution or tool calls without allowlists.
- Keep Save, Publish, and Run explicit existing user actions.
- Surface Gateway default resolution failures, planner run failures, invalid JSON, and rejected commands without applying graph changes.

## Suggested implementation
1. Add a pure command reducer under `src/utils/flowAuthoringCommands.ts`.
2. Add a store action in `useFlowStore` that applies validated commands transactionally and can restore a previous authoring snapshot.
3. Add `AuthoringAssistantDrawer.tsx` with local chat state, provider/model selectors, docs-context prompt building, Gateway planner run execution, fail-closed error handling, command application, and undo.
4. Update `App.tsx` and `Toolbar.tsx` for explicit right drawer modes and the toolbar button.
5. Update docs and regenerate `llms-full.txt`.

## Architecture review synthesis
Five adversarial reviewers compared alternatives:

- Minimalist: UI-only drawer with local graph patches is the smallest reversible change.
- Platform: a typed patch contract keeps Flow as the authoring surface and leaves Gateway/Core capability routing intact.
- Security: browser-only direct provider calls and raw graph writes are rejected; typed commands plus validation preserve the trust boundary.
- UX: the right drawer should be conversational, keep graph edits visible, and end every turn with explanation and testing guidance.
- Code quality: the mutation path needs a pure reducer with tests so it does not drift from existing templates, serialization, and validation.

Chosen first slice: Flow-owned UI plus typed command reducer, use of Gateway run start and ledger routes, no required lower-layer changes. Future Gateway-native authoring-assistant contracts remain a possible evolution if durable audit, collaboration, or server-side policy becomes required.

## Scope
- AbstractFlow frontend and package docs.
- Typed graph authoring commands for common node creation, labels, pin defaults, dynamic safe pins, literal values, and validated connections.
- Assistant drawer, toolbar integration, local conversation state, and undo of the last assistant turn.

## Non-goals
- No AbstractGateway, AbstractRuntime, or AbstractCore code changes in this item.
- No automatic workflow save, publish, run, or Gateway persistence.
- No arbitrary Gateway API calls from assistant output.
- No raw model-generated `nodes`/`edges` replacement.
- No durable assistant conversation storage.
- No collaborative multi-user draft editing.

## Dependencies and related tasks
- Related docs: `README.md`, `docs/web-editor.md`, `docs/architecture.md`, `docs/api.md`, `docs/visualflow.md`, `llms-full.txt`.
- Related backlog: `completed/0099_autonomous_authoring_assistant_loop.md`, `completed/010_gateway_only_remote_editor_transport.md`, `completed/040_gateway_capability_schema_and_connection_contract.md`, `completed/0087_gateway_aware_palette_and_preflight.md`.

## Expected outcomes
- Users can open an assistant drawer from the navbar.
- Asking for an internet research, deep research, news digest, or job search workflow creates a valid draft graph with start, agent, tools, prompt-building, and end nodes.
- The assistant can refine the current graph over multiple turns.
- The assistant response explains how the generated graph works, how to test it, and expected behavior.
- Invalid or unsafe commands are surfaced as errors without corrupting the graph.
- Assistant prompt sizing is visible without hardcoded model-window assumptions; Gateway/provider errors surface normally rather than being hidden behind local clipping.

## Validation
- `npm test`
- `npm run build`
- `npm run lint`
- Manual browser check: open Flow, open Assistant, submit a workflow request, verify nodes appear, undo works, Properties still opens for selected nodes, Save remains explicit.

## Progress checklist
- [x] Add backlog planning item and update overview.
- [x] Implement typed command reducer and tests.
- [x] Implement assistant drawer and toolbar/drawer integration.
- [x] Wire Gateway planner runs and fail-closed validation.
- [x] Update docs and regenerated LLM context.
- [x] Run validation and complete review.

## Guidance for the implementing agent
Preserve unrelated dirty worktree changes. Keep the assistant path conservative: build from existing templates, validate every edge, avoid arbitrary HTML/icon updates, keep secrets out of defaults, and fail closed when Gateway/model output cannot be trusted.
