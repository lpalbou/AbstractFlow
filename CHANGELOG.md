# Changelog

All notable changes to AbstractFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Notes
- In this monorepo, `abstractflow` contains a working Flow compiler/runner and VisualFlow execution utilities. Packaging/docs alignment is tracked in `docs/backlog/planned/093-framework-packaging-alignment-flow-runtime.md`.

### Fixed
- VisualFlow execution now ignores unreachable/disconnected execution nodes (e.g. orphan `llm_call` / `subflow` nodes) so they cannot fail run initialization.

### Planned
- Visual workflow editor with drag-and-drop interface
- Real-time workflow execution and monitoring
- Integration with AbstractCore for multi-provider LLM support
- Custom node development SDK
- Cloud deployment capabilities
- Collaborative workflow development features

## [0.1.0] - 2025-01-15

### Added
- Initial placeholder package to reserve PyPI name
- Basic project structure and packaging configuration
- Comprehensive README with project vision and roadmap
- MIT license and contribution guidelines
- CLI placeholder with planned command structure

### Notes
- This is a placeholder release to secure the `abstractflow` name on PyPI
- No functional code is included in this version
- Follow the GitHub repository for development updates and release timeline


