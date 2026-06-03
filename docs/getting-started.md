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

Open http://localhost:3003.

Sign in with:

- Gateway URL: `http://127.0.0.1:8080`
- User: `admin`
- Token: the `agw_...` token from Gateway

## 3. Author And Run

Use the canvas to create VisualFlow graphs. The editor sends VisualFlow JSON to Gateway, publishes workflows through Gateway, starts Gateway runs, and renders Gateway ledger/artifact streams.

Provider and model selectors come from Gateway discovery. Configure providers, endpoint profiles, API keys, and default models in the Gateway console.

## Local Development

```bash
git clone https://github.com/lpalbou/AbstractFlow.git
cd AbstractFlow
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to the Gateway URL selected in the connection UI or configured with `ABSTRACTGATEWAY_URL` / `ABSTRACTFLOW_GATEWAY_URL`.

## Build

```bash
npm run build
npm start -- --gateway-url http://127.0.0.1:8080
```

The static server in `bin/cli.js` serves `dist/` and proxies API/SSE calls to Gateway with browser-session auth injection.
