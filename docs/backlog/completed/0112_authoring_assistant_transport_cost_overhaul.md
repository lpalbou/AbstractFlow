# Planned: Authoring assistant transport overhaul (cache-first prompt, session isolation, usage honesty)

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: ADR-0026 (lossless compaction; no size budgets on prompts)
- ADR impact: None (transport ordering/session change, no content loss)

## Context
2026-07-11 adversarial review (assistant lane) measured the authoring loop's
transport as its weakest part: the ~21k-token stable context (skill + node
catalog + tools) is placed AFTER volatile content in every cycle prompt, so
provider prefix caching can never hit; and every cycle starts a new gateway
`basic-agent` run inside one durable replaying session, so cycle N carries
cycles 1..N-1's prompts+responses — quadratic in-turn token growth at up to 40
cycles/turn. The context meter shows only the client-built prompt, ignoring
session replay.

## Current code reality
- Prompt assembly: `src/components/AuthoringAssistantDrawer.tsx` ~1328-1352 —
  USER REQUEST first, conversation next, then skill/catalog/tools.
- Cycle runs: `~1946` starts each planner cycle in the same durable session;
  session rotates only on Clear Chat (~439-449).
- The client already passes conversation history + cycle notes + the full
  current document explicitly in the prompt, so gateway session replay is
  redundant context duplication for planner cycles.
- Usage collection exists (`src/utils/plannerUsage.ts`) but no cumulative
  warning; context meter at ~2529-2533 estimates the client prompt only.
- Recorded product decision (2026-06-10, docs/web-editor.md): one durable
  session per workflow for CONVERSATION continuity. The client-side persisted
  conversation (localStorage) already provides that continuity content-wise.

## Problem
Authoring turns are far more expensive and slower than they need to be; a typo
repair cycle re-bills the entire context; the meter under-reports real context.

## What we want to do
1. Reorder the prompt stable-first: [skill, node catalog, tool schemas] →
   [conversation history] → [current graph document, cycle notes, USER REQUEST].
   No content is dropped (ADR-0026: compaction must be lossless; this is
   ordering only).
2. Isolate planner cycles from durable-session replay: planner cycle runs use a
   per-cycle throwaway session id; all context stays client-provided (it
   already is). Cross-turn continuity remains via the persisted client
   conversation, which the prompt includes.
3. Cumulative usage honesty: show per-turn cumulative input/output tokens and
   warn (labeled, non-blocking) past a threshold; label the context meter as a
   client-estimate.

## Requirements
- Round-trip and stall-guard behavior unchanged (existing tests must pass).
- The stable prefix must be byte-identical across cycles within a turn (assert
  in a test) so provider prefix caches can hit.
- No truncation of any block (ADR-0026); language anchoring stays at the
  request site (2026-06-10 lesson: the request block carries the language
  directive).
- Session change must not break Clear Chat or draft→flow promotion carryover.

## Suggested implementation
- Extract prompt assembly into `src/utils/plannerPrompt.ts` returning
  `{ stablePrefix, volatileSuffix }`; drawer concatenates. Unit-test prefix
  stability across synthetic cycles.
- Session: `plannerSessionId = <workflowKey>-turn<N>-c<cycle>` or omit
  session_id if the gateway accepts absent sessions for runs.
- Usage: sum plannerUsage per turn; render cumulative line + threshold warning.

## Scope
Flow client only. No gateway/runtime changes.

## Non-goals
- No prompt content reduction/compaction (ADR-0026 forbids silent truncation).
- No assistant test-run loop (see 0122).

## Dependencies and related tasks
- Reviewer 1C findings 1-4 (2026-07-11); ADR-0026; docs/web-editor.md session
  policy note (update it in the same pass).

## Expected outcomes
Same authoring behavior and quality with a flat (non-quadratic) in-turn token
bill and cache-friendly prompts; honest usage reporting.

## Validation
- New unit tests: stable-prefix byte equality across cycles; volatile block
  contains request+document; session id derivation.
- Existing drawer/document tests green; tsc + build green.
- Manual: one authoring turn against a live gateway; compare per-cycle
  input_tokens in ledgers before/after (expect flat, not growing).

## Progress checklist
- [ ] plannerPrompt extraction + ordering + tests
- [ ] per-cycle session isolation
- [ ] cumulative usage line + warning
- [ ] web-editor.md session note update + CHANGELOG

## Guidance for the implementing agent
Do not silently change what the model sees — only the order and the session
transport. If the gateway rejects sessionless runs, fall back to per-cycle
unique session ids (same effect: no replay).

## Completion report
- Completed: 2026-07-11
- Shipped (adversarial-review corrected): stable context block (skill +
  catalog + tools, ~21k tokens) extracted and byte-stability tested across
  cycles; placed on the SYSTEM message after the review proved the runtime
  prepends a volatile grounding envelope to every user prompt (a user-prompt
  prefix can never be wire-stable); planner + acceptance-review runs are now
  SESSIONLESS (the review found per-cycle derived sessions mint one orphan
  __session_memory__ owner run per start; omission avoids replay AND
  orphans); retry notes ride the volatile block; cumulative usage note at
  500k tokens/turn checked after planner and review usage; context meter
  labeled as client estimate; activity log mirrors the actual wire placement.
- Validation: prefix-stability + language-adjacency tests green; full vitest
  275, tsc, build green. docs/web-editor.md session/prompt sections updated.
- Residual: wire-level cache hits should be confirmed against a live
  provider ledger (client-side placement is now correct; the runtime-side
  grounding contract text is stable so the system prefix should cache).
