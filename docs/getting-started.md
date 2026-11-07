# Getting Started

AbstractFlow is a web editor. It needs a reachable AbstractGateway because Gateway owns workflow storage, execution, auth, providers, artifacts, and user/runtime routing.

## 1. Start Gateway

```bash
export ABSTRACTGATEWAY_USER_AUTH=1
export ABSTRACTGATEWAY_DATA_DIR="$PWD/runtime/gateway"
abstractgateway serve --host 127.0.0.1 --port 8080
```

Gateway creates the default admin account on first start. Read the browser-login token:

```bash
cat "$ABSTRACTGATEWAY_DATA_DIR/auth/bootstrap-admin-token"
```

## 2. Start AbstractFlow

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Open http://127.0.0.1:3003/.

Sign in with:

- Gateway URL: `http://127.0.0.1:8080`
- User: `admin`
- Token: the `agw_...` token from Gateway

## 3. Author And Run

Use the canvas to create VisualFlow graphs. The editor sends VisualFlow JSON to Gateway, publishes workflows through Gateway, starts Gateway runs, and renders Gateway ledger/artifact streams.

Provider and model selectors come from Gateway discovery. Configure providers, endpoint profiles, API keys, and default models in the Gateway console.

Agent and LLM Call nodes choose provider, model, reasoning and **MTP depth** with the shared
AbstractFramework model picker. Off and the depths appear only when the gateway says the
selected model supports MTP; otherwise the control is disabled and says why. Changing the
provider or the model puts reasoning and MTP back on the default, in Properties, in On Flow
Start defaults and in the Run dialog, and a saved level or depth the selected model cannot use
is not sent from the Run dialog (a level is kept when the gateway does not describe the model's
reasoning). MTP is set per node; the Run
dialog asks only for the flow's own inputs. A connected `speculation` pin wins over the node
setting, then the execution host's Core default. Inheritance sends no override; Off sends
`false`. A depth saved earlier for a model the gateway says has no MTP does not fail the run: the gateway
(0.21.0 and later) runs that step without MTP and the step's record says so.

Discovery is read-only: these controls do not download heads or load models. Unknown support,
head readiness, reload requirements, and saved unavailable choices are shown explicitly.
For graphs with multiple model routes, choose a depth on individual nodes; the run picker
does not invent a shared supported-depth list. Fresh Core configurations default to depth 2
for compatible models only; Flow itself does not impose that default.

## Local Development

A local checkout needs Node.js 20+ and a sibling [AbstractUIC](https://github.com/lpalbou/AbstractUIC) checkout: the editor builds the monitor widgets from `../abstractuic`. `@abstractframework/ui-kit` installs from npm with `npm install`.

```bash
git clone https://github.com/lpalbou/AbstractUIC.git abstractuic
git clone https://github.com/lpalbou/AbstractFlow.git abstractflow
cd abstractflow
npm install
npm run dev
```

The Vite dev server uses the same server-side Gateway session as the built server (`@abstractframework/app-server`). Its Gateway is `ABSTRACTFLOW_GATEWAY_URL` / `ABSTRACTGATEWAY_URL` when set, else the Gateway installed on this computer, else `http://127.0.0.1:8080`.

## Build

```bash
npm run build
npm start -- --gateway-url http://127.0.0.1:8080
```

The server in `bin/cli.js` serves `dist/` on `127.0.0.1:3003` and forwards API and SSE calls to the Gateway with the browser's session. When AbstractGateway manages the editor, open it from the Gateway console at `/apps/flow/` instead. See [CLI](cli.md).

## Next Steps

- [Web editor](web-editor.md): the editor's features, including flow interfaces, automations, and the About dialog.
- [VisualFlow JSON](visualflow.md): the workflow document format.
- [Architecture](architecture.md): how the editor, the Flow server, and Gateway fit together.
- [Troubleshooting](troubleshooting.md): sign-in, proxy, and build problems.
- [README](../README.md): project overview.
