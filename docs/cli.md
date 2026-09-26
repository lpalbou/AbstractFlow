# CLI

AbstractFlow ships one CLI through npm:

```bash
npx @abstractframework/flow
```

It serves the built editor and proxies `/api/*` to AbstractGateway.

## Usage

```bash
npx @abstractframework/flow \
  --host 0.0.0.0 \
  --port 3003 \
  --gateway-url http://127.0.0.1:8080
```

Equivalent installed command:

```bash
npm install -g @abstractframework/flow
abstractflow-editor --gateway-url http://127.0.0.1:8080
```

`npx @abstractframework/flow --help` prints the options. Defaults: host
`0.0.0.0`, port `3003`, Gateway `http://127.0.0.1:8080`. See
[API and contracts](api.md#cli) for the environment variables and the order in
which the Gateway URL is resolved.

## What The CLI Does

- Serves `dist/` static assets.
- Answers `GET /api/health` (and `/health`) with its own readiness and the Gateway URL it targets.
- Proxies Gateway HTTP, SSE, and WebSocket routes under `/api/*`.
- Handles browser-session cookie forwarding and CSRF headers.
- Sets `X-Forwarded-For` (the browser connection's address) and `X-AbstractFramework-App-Proxy: abstractflow` on every Gateway-bound request, dropping any forwarding headers the browser sends.
- Rejects unsafe hosted Gateway URL changes by default.

It does not execute workflows locally. Workflow execution is a Gateway/Runtime responsibility.

For error messages and fixes, see [Troubleshooting](troubleshooting.md).
