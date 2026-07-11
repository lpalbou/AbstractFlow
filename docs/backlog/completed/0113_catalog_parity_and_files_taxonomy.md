# Planned: Node catalog parity (runtime-honored pins) + Files/Memory taxonomy split

## Metadata
- Created: 2026-07-11
- Status: Planned
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 adversarial reviews (nodes lane + assistant/FS lane) found (a) pins
the runtime already honors that the UI never declares, and (b) all file/artifact
IO nodes hiding under a palette category literally labeled "Memory" with a brain
icon — which worsens the Artifact vs Server File confusion the docs work hard to
teach.

## Current code reality
- `abstractruntime/.../compiler.py` ~1486-1494: agent effect reads a
  `max_out_tokens`/`max_output_tokens` input; `visual/executor.py` ~2851-2867:
  llm_call honors `max_output_tokens`; neither template declares the pin
  (`src/types/nodes.ts` — llm_call has only `max_in_tokens`).
- `wait_event` gained `until`/`details` pins but
  `src/utils/nodePinDisclosure.ts` ~500-504 omits them from `advancedInputs`,
  so they render unmanaged instead of folding away.
- File/artifact nodes carry `category: 'memory'` (`src/types/nodes.ts` ~1626,
  ~2117-2121) and render under the "Memory" palette section.
- Generated docs: `docs/workflow-node-catalog.md` via
  `scripts/generate-workflow-node-catalog.mjs`; assistant context via
  `scripts/generate-llms-full.mjs`.

## Problem
Authors cannot set output-token caps the runtime supports; wait_event's new
advanced pins clutter default disclosure; files are taught as "memory",
confusing two documented concepts.

## What we want to do
1. Add `max_output_tokens` (advanced, number) to `llm_call` and `agent`
   templates, wired to the exact payload keys the runtime honors (verify names
   in compiler/executor before wiring).
2. Fold `wait_event.until`/`details` into advanced pin disclosure.
3. Split a `files` palette category out of `memory`: Read/Write File, Read PDF,
   Write PDF, Write DOCX, List Folder Files, Import Server File, Read Artifact,
   Export Artifact move to "Files"; notes/KG/session nodes stay "Memory".
4. Regenerate the node catalog + llms-full so docs and assistant inherit the
   taxonomy.

## Requirements
- Saved flows must load unchanged (additive pins only; category is palette
  metadata, not serialized semantics — verify).
- The compiler must receive the token cap only when set (no default-value
  spam in payloads).
- Disclosure behavior covered by tests.

## Scope
Flow templates, disclosure, palette sections, generated docs.

## Non-goals
- No runtime changes (pins added only where the runtime already honors them).
- No new file operations (see 0123).
- No ask_user deadline (requires runtime ASK_USER support first; see 0117 note).

## Dependencies and related tasks
- Reviewer 1A finding 7-8, reviewer 1C finding 14 (2026-07-11).

## Expected outcomes
Authors can cap LLM/agent output tokens from the canvas; wait_event's advanced
pins fold; the palette teaches Files and Memory as distinct concepts.

## Validation
- Unit tests: template pin presence + payload key wiring; disclosure folding
  for wait_event.
- Regenerated catalog diff shows the new category + pins; vitest/tsc/build
  green.

## Progress checklist
- [ ] Verify runtime payload key names for output-token caps
- [ ] llm_call/agent pins + disclosure
- [ ] wait_event advanced folding
- [ ] files category split + palette section
- [ ] regen catalog + llms-full; CHANGELOG

## Guidance for the implementing agent
Verify the exact payload key the compiler reads for each node before naming the
pin; a mismatched key is worse than no pin (silently ignored).

## Completion report
- Completed: 2026-07-11
- Shipped: `max_output_tokens` pins on llm_call + agent (runtime key
  precedence verified in compiler.py/executor.py by adversarial review);
  advanced disclosure folding for the new pin and wait_event until/details;
  Files palette category split from Memory (9 file/artifact IO nodes);
  node catalog + llms-full regenerated; legacy-flow migration added in
  `serialization.ts` after the review caught that saved nodes override
  template pins on load (the pin now appears on existing flows too).
- Validation: nodes/disclosure/serialization tests green (vitest 275);
  review confirmed no consumer keys on the old category grouping and pin
  defaults reach input_data keyed by pin id with no default-value spam.
