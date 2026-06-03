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

## What The CLI Does

- Serves `dist/` static assets.
- Proxies Gateway HTTP and SSE routes.
- Handles browser-session cookie forwarding and CSRF headers.
- Rejects unsafe hosted Gateway URL changes by default.

It does not execute workflows locally. Workflow execution is a Gateway/Runtime responsibility.
