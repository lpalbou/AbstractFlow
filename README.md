# AbstractFlow

AbstractFlow is the visual workflow editor for AbstractFramework.

It is a web package (`@abstractframework/flow`). It runs a browser editor and a small Node server that serves the built UI and proxies `/api/*` to AbstractGateway. AbstractGateway owns users, sessions, runtime routing, provider configuration, workflow storage, run execution, ledgers, artifacts, and media catalogs.

## Install

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

For a local checkout:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3003
```

Open http://localhost:3003 and sign in with the Gateway user and token created by AbstractGateway.
Leave provider/model selectors on `Auto (Gateway default)` for portable
workflows. Gateway/Core capability defaults choose the actual provider/model at
run time for the current user/runtime.

Text model selectors use Gateway's Core-backed `capability_route` discovery
filters, so normal LLM pickers request `output.text` models. The Models Catalog
node can store a route such as `input.image,output.text` to discover provider
models for a specific input/output shape while the workflow runs.

LLM Call and Agent nodes include a Reasoning control backed by Core's
`thinking` option. Leave it on Auto to inherit the Gateway/runtime default, or
set/pin values such as `off`, `low`, `medium`, `high`, or `xhigh` for reasoning
models that support explicit effort controls.

Media artifact inputs can be wired from another node or uploaded directly on
the node when the artifact pin is unconnected. Uploaded browser files are stored
as Gateway artifacts. During `Listen Voice` waits, Flow records in the browser,
uploads the captured audio artifact, and resumes the Gateway run; Flow does not
execute local audio or transcription logic itself.

## Gateway Setup

```bash
export ABSTRACTGATEWAY_USER_AUTH=1
export ABSTRACTGATEWAY_DATA_DIR="$PWD/runtime/gateway"
abstractgateway serve --host 127.0.0.1 --port 8080
cat "$ABSTRACTGATEWAY_DATA_DIR/auth/bootstrap-admin-token"
```

Use:

- Gateway URL: `http://127.0.0.1:8080`
- User: `admin`
- Token: the `agw_...` token printed by Gateway or stored in `auth/bootstrap-admin-token`

## What Lives Here

- `src/` - React/Vite visual editor.
- `bin/cli.js` - npm CLI/static server and Gateway proxy.
- `examples/flows/` - sample VisualFlow JSON files kept for reference/import tests.
- `docs/` - external documentation for users and maintainers.

AbstractFlow does not ship a Python package or local execution host. VisualFlow compilation, bundle execution, runtime state, and provider calls are handled by AbstractGateway and AbstractRuntime.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run docs:llms
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Web editor](docs/web-editor.md)
- [Architecture](docs/architecture.md)
- [API and contracts](docs/api.md)
- [VisualFlow JSON](docs/visualflow.md)
- [CLI](docs/cli.md)
- [FAQ](docs/faq.md)

## Related Projects

- AbstractFramework: https://github.com/lpalbou/AbstractFramework
- AbstractGateway: https://github.com/lpalbou/AbstractGateway
- AbstractRuntime: https://github.com/lpalbou/AbstractRuntime
- AbstractCore: https://github.com/lpalbou/AbstractCore

## Policies

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)
- License: [LICENSE](LICENSE)
