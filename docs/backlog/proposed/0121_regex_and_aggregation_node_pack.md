# Proposed: Regex + aggregation pure-node pack

## Metadata
- Created: 2026-07-11
- Status: Proposed
- Completed: N/A

## ADR status
- Governing ADRs: None
- ADR impact: None

## Context
2026-07-11 nodes-lane review: `contains` is substring-only, `replace` is
literal-only (abstractruntime visual/builtins ~292-342); no regex
match/extract/split anywhere; math nodes are scalar-only (no min/max/sum/avg);
arrays lack sort/slice/reverse/reduce; `array_filter` is equality-only
(~921-935); `merge` is shallow. Extracting an ID from LLM output today
requires a full sandboxed Code node.

## Current code reality
Both registries (UI templates + runtime builtins) are cleanly symmetric, so
additions are mechanical on both sides.

## Problem or opportunity
One-line text/data chores force the heavyweight Code sandbox, hurting
authoring speed and flow readability.

## Proposed direction
Add pure builtins + templates: `regex_match`, `regex_extract` (groups),
`regex_replace`, `regex_split`; `sum`/`min`/`max`/`avg` over number arrays;
`array_sort` (key + direction), `array_slice`, `array_reverse`. Bounded regex
execution (length caps, no catastrophic patterns — use re2-style guards or
timeouts runtime-side).

## Why it might matter
Cheap, high-frequency wins; parity with every comparable tool's expression
layer.

## Promotion criteria
Runtime seat bandwidth (builtins live in abstractruntime); agreement on regex
safety bounds.

## Validation ideas
Builtin unit tests both sides; catalog regen; an example flow replacing a Code
node with the new primitives.

## Non-goals
No general expression language / formula fields (bigger design, separate
track).

## Guidance for future agents
Keep names and pin shapes consistent with the existing string/array family;
regen docs + llms-full in the same pass.
