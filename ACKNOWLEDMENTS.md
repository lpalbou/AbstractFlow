# Acknowledgments

AbstractFlow is built on the shoulders of many projects and ideas.

## Inspiration

- The visual workflow UX is inspired by Unreal Engine (UE4/UE5) Blueprints: execution pins, typed pins, and “graph as program”.

Evidence: `docs/architecture.md`.

## Core building blocks

- AbstractRuntime (durable execution kernel: runs, waits, ledgers, artifacts)
- AbstractCore (providers/models/tools integration used by runtime effects)
- AbstractAgent (optional ReAct/CodeAct agent workflows used by the Visual Agent node)

See `README.md` for links to the upstream repositories.

## Open-source dependencies

The reference editor in `web/` uses the open-source ecosystem heavily, including (non-exhaustive):
- FastAPI (backend)
- React + Vite (frontend)
- React Flow (graph editor)
- Monaco editor integration
- Pydantic (portable VisualFlow models)

Thank you to the maintainers and contributors of these projects.
