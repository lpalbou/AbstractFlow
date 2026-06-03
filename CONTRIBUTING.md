# Contributing

Thanks for contributing to AbstractFlow.

## Development Setup

Requirements:

- Node.js 18+
- npm
- a reachable AbstractGateway for integration testing

```bash
npm install
npm run dev
```

Run quality checks:

```bash
npm run build
npm run lint
```

## Repository Shape

- `src/`: React/Vite editor.
- `bin/cli.js`: static server and Gateway proxy.
- `examples/flows/`: sample VisualFlow JSON files.
- `docs/`: user and maintainer docs.

Do not add local Python execution/server code to this repository. Runtime execution belongs to AbstractGateway and AbstractRuntime.

## Docs

After doc changes:

```bash
npm run docs:llms
```

## Releases

Release version source of truth is `package.json`.

For a release:

1. Update `package.json`.
2. Add the matching `CHANGELOG.md` entry.
3. Run `npm run build` and `npm run lint`.
4. Publish through the GitHub release workflow to npm.

## Pull Request Checklist

- `npm run build` passes.
- `npm run lint` passes or any failures are explicitly documented.
- User-facing behavior changes are reflected in docs and changelog.
