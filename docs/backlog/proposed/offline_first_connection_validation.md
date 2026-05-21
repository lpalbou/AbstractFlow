# Offline-first Flow connection validation

## Problem

AbstractFlow is a thin client, but connecting to Gateway was validated through
`/api/gateway/discovery/capabilities`. That endpoint can legitimately touch
optional capability registries and local/remote provider probes. In offline mode
or with unavailable commercial providers, this made Flow look disconnected even
when Gateway auth and routing were healthy.

## Direction

- Flow connection/login should call only `GET /api/gateway/ping` with the
  configured Bearer token and a short timeout.
- Provider/model/voice/vision discovery should happen after connection and
  degrade independently.
- Startup checks should warn but not block the server from booting; the browser
  connection modal owns interactive recovery.

## Follow-up

- Surface discovery warnings in the UI as capability-specific degraded states,
  not as a global Gateway connection failure.
