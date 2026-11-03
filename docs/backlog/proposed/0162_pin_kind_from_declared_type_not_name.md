# 0162 — A pin's kind comes from its declared type, never from its name

- Status: PROPOSED 2026-11-03
- Created: 2026-11-03
- Owner: flow
- Source: adversarial review of Flow #8 (decision Run dialog, `review-flow-8.md` in the framework's
  `untracked/release-2026-11-03/`), finding 2; the example rename in the same PR is the evidence.

## Problem

Several editor functions decide what a pin IS (a model picker, a provider picker) from its NAME as
well as from its declared type. A pin named `model` or `<something>_model` is treated as a model
picker even when its type is `string`:

- `src/utils/pinCatalog.ts:51-61` `isModelPin`: `pin.id === 'model' || pin.id.endsWith('_model')`
  next to the `model*` types; `isProviderPin` (`:38-48`) does the same for `provider` /
  `*_provider`. `modelCatalogScopeForPin` and `providerCatalogScopeForPin` then derive the catalog
  from name prefixes (`image_model`, `tts_model`, `stt_model`, `music_model`, ...).
- `src/components/RunFlowModal.tsx` `isModelInputPin` (about line 1881) repeats the same rule for
  the Run dialog.
- `src/hooks/useFlow.ts:2458` (load migration "promote well-known LLM routing pins"): a `string`
  pin whose id AND label are `model` is retyped to `model` on every load (`provider` likewise to
  `provider_text`), for inputs and outputs, on every node.

What it broke: the "Decision triage" example's On Flow End had a `string` input named `model` (the
provider/model that answered, wired from the Decision node's `model` output, a `string`). The load
migration retyped it to `model`, and the editor then refused the wire ("Type mismatch: cannot connect
string to model"), so the connection was kept hidden. Flow #8 fixed the example by renaming the pin
`answered_by`; the rule that caused it is unchanged. Any flow that names a text value `model` meets
the same thing.

## Proposal

1. The kind of a pin is its declared type. `isModelPin` / `isProviderPin` / `isModelInputPin` read
   `pin.type` only; the scope comes from the type (`model_image`, `model_voice`, ...) and, for a
   generic `model`, from the provider pin of the same node or the node type (as today).
2. Migrate on load, once and visibly: a saved pin whose type is `string` but whose name says model
   or provider keeps `string`. Pins that relied on the name (old flows whose model pins were saved
   as `string` with a picker shown because of the name) are listed by an audit over the example and
   bundled corpus. Each one gets its declared type written in the source (builder scripts, bundled
   JSON), not inferred at load.
3. Retire the `useFlow.ts:2458` promotion after the corpus is migrated. A flow saved before that keeps
   working because its migrated pins carry their type.

## Acceptance

- A `string` pin named `model` on any node (On Flow End included) accepts a `string` wire and shows
  a text box, not a model picker.
- Every shipped example and bundled flow loads with no hidden connection
  (`loadFlowEdges.test.ts` corpus test stays green) and with the same pickers as today where the
  type says model or provider.
- A test that a `string` pin named `model` / `x_model` is not a model pin (it goes red with the
  name rule restored).

## Notes

- Root ADR 0049 (typed pin literals) already moved typed VALUES to come from the graph, not from
  the wording. This item does the same for pin KINDS.
- Not urgent for 0.14.0: the example no longer meets it; flows authored by people may.
