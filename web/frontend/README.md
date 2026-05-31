# @abstractframework/flow (AbstractFlow Visual Editor UI)

This package ships the **browser UI** for the AbstractFlow visual editor (React + ReactFlow).

It is designed to run alongside **AbstractGateway**. The package server proxies
same-origin `/api/*` requests to Gateway and injects the browser session's
opaque Gateway session, including for SSE ledger streams. A server/admin
Gateway token does not sign in browsers, and user tokens are used only during
sign-in.

## Quick start

Terminal 1 (Gateway):

```bash
pip install abstractgateway abstractflow
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway --port 8080
```

Terminal 2 (UI):

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Open: http://localhost:3003

Sign in with:
- Gateway URL: `http://127.0.0.1:8080`
- User: a Gateway user id, for example `admin`
- Gateway token: that user's token

## CLI options

```bash
npx @abstractframework/flow --port 3003 --host 0.0.0.0 --gateway-url http://127.0.0.1:8080
```

Environment variables:
- `PORT`, `HOST`
- `ABSTRACTGATEWAY_URL` (or `ABSTRACTFLOW_GATEWAY_URL`)

`--gateway-token` is accepted only as a deprecated no-op for older scripts. User
auth is kept in HTTP-only browser cookies after sign-in.
