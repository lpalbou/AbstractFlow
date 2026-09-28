# CLI

AbstractFlow ships one CLI through npm:

```bash
npx @abstractframework/flow
```

It serves the built editor and forwards `/api/*` to AbstractGateway through a
server-side browser session.

## Usage

```bash
npx @abstractframework/flow --gateway-url http://127.0.0.1:8080 --port 3003
```

Equivalent installed command:

```bash
npm install -g @abstractframework/flow
abstractflow-editor --gateway-url http://127.0.0.1:8080
```

Options (the launch flags every AbstractFramework browser app takes):

| Flag | Meaning |
|---|---|
| `--gateway-url <url>` | The Gateway to talk to. Aliases: `--gateway`, `--url`. |
| `--port <n>` | The port to listen on (default `3003`). |
| `--host <addr>` | The address to listen on (default `127.0.0.1`). Use `--host 0.0.0.0` only when other computers must reach this server directly. |
| `--help`, `-h` | Print the usage. |

`--name value` and `--name=value` both work. An unknown flag or a missing value
stops the command with exit code 2.

Without `--gateway-url`, the Gateway is, in order: the legacy environment
variables (`ABSTRACTFLOW_GATEWAY_URL`, then `ABSTRACTGATEWAY_URL`), the Gateway
URL saved in `~/.abstractflow/gateway_connection.json`, the Gateway installed
on this computer (`~/.abstractframework/gateway.json`, written by the
installer and by `abstractgateway serve`), and finally `http://127.0.0.1:8080`.
When the Gateway came from that file or the default, a running editor re-reads
the file whenever the Gateway refuses a connection, so it follows a Gateway
that moved to another port. See [API and contracts](api.md#cli).

## Served Through The Gateway

When AbstractGateway manages the Flow editor as an app, the Gateway serves it at
`/apps/flow/` on the Gateway's own address: one port and one tunnel for the
console, the API and every app. Open it from the Gateway console (**Apps >
Flow Editor > Open**); you arrive signed in. The same `abstractflow-editor`
server runs in both cases:

- run on its own, the editor is at `http://127.0.0.1:3003/`;
- through the Gateway, the editor is at `<gateway address>/apps/flow/`.

## What The CLI Does

- Serves the built editor (`dist/`) at `/` or under `/apps/flow/`.
- Answers `GET /api/health` (and `/health`) with its own readiness, the Gateway URL it targets and the base path it is served under.
- Forwards Gateway HTTP and SSE routes under `/api/*` with the browser's session, and refuses WebSocket upgrades (the editor opens none).
- Handles browser-session cookies and CSRF headers.
- Tells the Gateway the browser's real address (`X-Forwarded-For`) and `X-AbstractFramework-App-Proxy: abstractflow` on every Gateway-bound request.
- Refuses a browser-chosen Gateway URL from any browser that is not on this computer.

It does not execute workflows locally. Workflow execution is a Gateway/Runtime responsibility.

For error messages and fixes, see [Troubleshooting](troubleshooting.md).
