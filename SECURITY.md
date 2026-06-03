# Security Policy

Please do not open a public GitHub issue for security-sensitive reports.

Report vulnerabilities by email:

- `contact@abstractflow.ai`

Include:

- impact and reproduction steps
- affected package version (`@abstractframework/flow`)
- browser/server deployment details
- Gateway URL topology when relevant
- logs with secrets redacted
- minimal VisualFlow JSON when relevant

## Scope

This repository covers the AbstractFlow web editor, npm CLI/static server, and Gateway proxy behavior.

Gateway authentication, provider secrets, runtime isolation, workflow execution, artifacts, and user management are owned by AbstractGateway/AbstractRuntime. Security reports for those surfaces should still be reported; they may be fixed in the owning package.

## Supported Versions

AbstractFlow is pre-1.0. Use the latest released version.
