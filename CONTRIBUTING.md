# Contributing

Thanks for contributing to AbstractFlow.

## Development Setup

Requirements:

- Node.js 20+ (the CI uses Node.js 24)
- npm
- a sibling [AbstractUIC](https://github.com/lpalbou/AbstractUIC) checkout at `../abstractuic`: the editor builds the shared UI packages (`@abstractframework/ui-kit` and the monitor widgets) from it
- a reachable AbstractGateway for integration testing

```bash
git clone https://github.com/lpalbou/AbstractUIC.git ../abstractuic
npm install
npm run dev
```

Run quality checks:

```bash
npm run build
npm run lint
npm test
```

`npm run build` first checks the bundled multi-agent coding workflow
(`npm run verify:multiagent`, Python 3).

The bundled-flow smokes run the shipped workflows through the real
AbstractRuntime with scripted models (no network, no provider keys). With
`pip install "abstractruntime>=0.7.0"`:

```bash
for smoke in entity_life_smoke entity_life_loop_smoke multiagent_coding_smoke \
             coding_agent_v2_gates_smoke goal_agent_smoke react_coder_smoke \
             ralph_coder_smoke coscientist_smoke; do
  python "scripts/$smoke.py" || break
done
```

CI runs the build, lint, `npm test` and these smokes on every push and pull
request.

## Repository Shape

- `src/`: React/Vite editor.
- `bin/cli.js`, `bin/flags.js`, `bin/server.js`: the CLI, its launch flags and the server (static files, base path, Gateway session proxy) on `@abstractframework/app-server`. `npm run build` also runs `scripts/check_relative_urls.mjs`, which fails on any app-absolute `/api/` or `/assets/` URL.
- `examples/flows/`: sample and shipped VisualFlow JSON files.
- `scripts/`: workflow generators, bundle packers, and documentation generators.
- `docs/`: user and contributor docs (see [docs/README.md](docs/README.md)).

Do not add local Python execution/server code to this repository. Runtime execution belongs to AbstractGateway and AbstractRuntime.

Read [docs/architecture.md](docs/architecture.md) for component boundaries and
[docs/api.md](docs/api.md) for the server and module surface before changing them.

## Docs

- Write the docs around the web package layout: `src/`, `bin/`, `examples/flows/`, `docs/`.
- List every `docs/*.md` page in [docs/README.md](docs/README.md).
- Regenerate the node catalog and the LLM context in the same change as any doc edit:

```bash
npm run docs:llms
```

This rewrites `docs/workflow-node-catalog.md` from `src/types/nodes.ts` and
`llms-full.txt` from the documentation set.

## Releases

Release version source of truth is `package.json`.

For a release:

1. Update `package.json`.
2. Add the matching `CHANGELOG.md` entry.
3. Run `npm run build`, `npm run lint`, `npm test` and the bundled-flow smokes.
4. Publish through the GitHub release workflow to npm.

## Pull Request Checklist

- `npm run build` passes.
- `npm run lint` passes or any failures are explicitly documented.
- `npm test` passes.
- The bundled-flow smokes pass when you change a shipped workflow or its generator.
- User-facing behavior changes are reflected in docs and changelog.
- Security-relevant changes follow [SECURITY.md](SECURITY.md).

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
