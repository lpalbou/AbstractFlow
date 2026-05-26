# Custom Code Languages And Dependencies

## State
- Status: proposed
- Created: 2026-05-25

## Context
Python Code nodes now use the Runtime sandbox and expose a standard `success`/`output` pin contract for ordinary flow composition. The next step is broader than an editor/UI fix: supporting additional languages and user-declared lightweight dependencies changes bundle packaging, validation, execution isolation, and reproducibility.

## Decision To Make
Define a clean custom-code execution abstraction for:
- supported languages beyond Python, such as JavaScript/TypeScript or shell-free expression languages;
- dependency declarations that can be included in WorkflowBundles;
- deterministic install/lock behavior per dependency set;
- sandbox and resource limits per language backend;
- editor intelligence and simulation support for each language.

## Acceptance Criteria
- A Code node declares `language`, `runtime`, and dependency metadata explicitly.
- WorkflowBundle packaging includes dependency manifests without silently vendoring environment state.
- Gateway/Runtime validation rejects unsupported languages or missing dependency backends with actionable errors.
- The Flow editor offers language-specific editor services only for configured languages.
- Tests cover packaging, validation, simulation, and execution for at least Python plus one additional language.

## Notes
- Avoid implicit imports from the host Python environment. Dependency availability must be declared and reproducible.
- Keep the existing Python sandbox path as the reference implementation until a multi-language contract is accepted.
