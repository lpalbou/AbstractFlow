# Security policy

We take security reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Instead, report vulnerabilities by email:
- `contact@abstractflow.ai`

Include as much of the following as possible:
- A clear description of the issue and potential impact
- Steps to reproduce (or a minimal proof-of-concept)
- Affected component(s) (e.g. `abstractflow` library vs the `web/` editor backend)
- Version information (`abstractflow.__version__`, Python version, OS)
- Any relevant logs/config (please redact secrets)
- If applicable: the smallest `VisualFlow` JSON that reproduces the issue

We will respond as quickly as we can and coordinate a fix and disclosure timeline with you.

## Scope (what to report here)

This policy covers:
- The published Python package (`abstractflow/`)
- The reference visual editor app shipped in this repository (`web/`)
- Packaging/release issues affecting published artifacts (PyPI / npm), when applicable

## Coordinated disclosure

- Please avoid testing on systems you don’t own or have permission to test.
- If you’d like public credit for your report, tell us what name/handle to use.
- If you need encrypted communication, email us and we’ll coordinate a safe channel.

## Supported versions

AbstractFlow is currently **Pre-alpha**. We recommend staying on the latest patch release.

Evidence: `pyproject.toml` (`Development Status :: 2 - Pre-Alpha`).
