# Prompt-Free Variable Name Selector

## Date

- Completed: 2026-05-25

## Status

Completed

## Priority

P1

## Context / Problem Statement

AbstractFlow should never fall back to browser-native dialogs for product UI. The node inline variable-name selector still used a `Create new...` sentinel that called `window.prompt("New variable name...")`, which broke the themed AbstractFlow interaction model and created a second variable-creation path outside the shared selector abstraction.

## Decision

Use the existing `AfSelect` custom-entry path for `get_var` and `set_var` variable names. Typing a new variable name in the selector now produces the themed `Use "..."` option and commits through the existing `setVariableName(...)` handler, preserving trimming, pin-default updates, auto-labeling, and declared-type inference.

## Scope

- Remove the variable selector's fake `Create new...` option and browser-native prompt.
- Keep variable-name creation inside the existing selector popover instead of adding a separate modal.
- Stop wheel events inside the portaled selector popover so graph zoom does not fire while the user is interacting with a dropdown.
- Add a frontend source regression test proving native prompt/confirm/alert calls stay out of the frontend source and the variable selector uses `allowCustom`.

## Non-goals

- Do not introduce a new variable declaration modal.
- Do not change `setVariableName` semantics.
- Do not add stricter variable-name validation in this pass; current runtime semantics continue to accept the same names as before.

## Validation

- `pytest tests/test_frontend_gateway_contract.py::test_frontend_variable_name_selector_avoids_native_browser_prompt -q`
- `npm --prefix web/frontend run build`

## Report

The variable-name pin selector now supports prompt-free custom variable entry through the shared `AfSelect` popover. The old sentinel and all frontend `window.prompt` / `window.confirm` / `window.alert` usage are covered by a regression test.
