# Validated Variable Name Selectors

## Date

- Completed: 2026-05-25

## Status

Completed

## Priority

P1

## Context / Problem Statement

Variable authoring was mostly prompt-free after item `0080`, but it still had weak edges:

- `get_var` and `set_var` accepted any custom selector text, even names that Runtime later normalizes or rejects.
- `bool_var` and `var_decl` still used browser-native `<datalist>` controls instead of AbstractFlow's themed selector surface.
- Runtime variable paths are dotted names, so UI should reject ambiguous names such as `state..name` instead of silently allowing paths that execution may normalize differently.

## Decision

Make variable names a first-class frontend contract: a variable name is a dotted path of identifier segments, normalized by trimming only. Valid names include `state`, `user_name`, and `state.user_name`; invalid names include empty strings, `_runtime`, `123name`, `user name`, `state..name`, `.state`, `state.`, and `state-name`.

Extend the shared `AfSelect` custom-entry abstraction with optional validation hooks so variable selectors can reject bad custom entries without constraining provider/model selectors that intentionally allow arbitrary values.

## Scope

- Add a `variableNames.ts` helper for normalization, validation, and variable-specific custom option labels.
- Add validated custom-entry support to AbstractFlow's `AfSelect`.
- Add matching validated custom-entry and disabled-option support to the shared AbstractUIC `AfSelect`.
- Replace `bool_var` and `var_decl` native datalist controls with the themed `AfSelect`.
- Apply the same validation hook to `get_var` and `set_var`.
- Keep existing saved invalid values inspectable; only new custom commits are blocked.

## Non-goals

- Do not remove unrelated native controls such as event-name datalist in this slice.
- Do not rename Runtime variable semantics or change execution behavior.
- Do not constrain provider/model custom entries.
- Do not add a compatibility sentinel or browser prompt fallback.

## Validation

- `pytest abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_variable_name_selector_avoids_native_browser_prompt abstractflow/tests/test_frontend_gateway_contract.py::test_frontend_variable_name_validation_contract -q`
- `npm --prefix abstractflow/web/frontend run build`
- `npm --prefix abstractuic/ui-kit run build`

## Report

Variable name creation now uses the same themed selector behavior across `get_var`, `set_var`, `bool_var`, and `var_decl`. Invalid custom entries remain visible with an inline reason but are disabled, while provider/model selectors remain permissive unless they opt into validation. The shared UI-kit selector now supports the same disabled custom-entry contract so future AbstractFramework apps can reuse the behavior instead of reintroducing native datalists.
