# @abstractframework/flow (AbstractFlow Visual Editor UI)

This package ships the **browser UI** for the AbstractFlow visual editor (React + ReactFlow).

It is designed to run alongside **AbstractGateway**. The package server proxies same-origin `/api/*` requests to Gateway and injects the configured bearer token, including for SSE ledger streams.

## Quick start

Terminal 1 (Gateway):

```bash
pip install "abstractgateway[http]" abstractflow
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway --port 8080
```

Terminal 2 (UI):

```bash
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080
```

Open: http://localhost:3003

## CLI options

```bash
npx @abstractframework/flow --port 3003 --host 0.0.0.0 --gateway-url http://127.0.0.1:8080 --gateway-token dev-token
```

Environment variables:
- `PORT`, `HOST`
- `ABSTRACTGATEWAY_URL` (or `ABSTRACTFLOW_GATEWAY_URL`)
- `ABSTRACTGATEWAY_AUTH_TOKEN`
