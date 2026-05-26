# Voice Residency Component Display

## Date

- Completed: 2026-05-24

## Status

Completed

## Priority

P1

## Context / Problem Statement

The Model Residency modal showed local voice residency rows only as provider/model pairs. For Omnivoice workflows that use both ordinary TTS and cloned voices, this made two distinct resident components look like duplicate loaded models:

- base speech synthesis: `provider=omnivoice`, component `tts_engine`
- cloned voice synthesis: `provider=cloned`, component `cloning_engine`, model/engine `omnivoice`

The base TTS row could also display `local:tts:omnivoice:default` in the Model column when the residency selector intentionally used the provider default. That runtime id is useful for unload routing, but it is not a model name.

## Decision

Keep the Runtime/AbstractVoice residency semantics unchanged. A base TTS engine and a clone engine are separate resident components and should remain separately unloadable. Fix the Flow presentation layer so the table exposes the component type and uses resolved model metadata for display when the selector model is empty.

## Scope

- Add a component display column to the Flow Model Residency loaded-model table.
- Prefer `resolved_model`/`display_model`/`details.runtime_info.model_id` for the display model when `row.model` is absent.
- Keep unload payloads based on the canonical runtime id or raw provider/model selectors.

## Non-goals

- Do not merge base TTS and cloned TTS residency rows.
- Do not change AbstractVoice warmup behavior.
- Do not introduce voice-level residency rows for individual cloned voices.

## Validation

- `npm run build` in `abstractflow/web/frontend`.

## Report

Flow now makes voice residency rows explicit: `TTS engine` and `Clone engine` are visible as component types, and the model column no longer falls back to a runtime id before checking resolved model metadata.
