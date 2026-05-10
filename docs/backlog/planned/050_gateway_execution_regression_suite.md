# Planned: Gateway Execution Regression Suite

## Metadata
- Created: 2026-05-09
- Status: In progress
- Completed: N/A

## Context

The migration to Gateway-first execution needs tests that prove the whole authoring/run chain:

AbstractFlow UI/client -> AbstractGateway -> AbstractRuntime -> AbstractAgent/AbstractCore ->
ledger/artifacts/history back to Flow.

This is a migration safety net: we must prevent accidental fallback to local runtime routes
while preserving modern Gateway UX.

## Current code reality

Files and symbols inspected:

- `tests/test_frontend_gateway_contract.py`: route-path and descriptor assertions for default transport.
- `tests/test_gateway_options.py`: Gateway URL/token resolution helpers.
- `tests/test_gateway_connection_config.py`: persisted Gateway connection.
- `web/frontend/src/hooks/useWebSocket.ts`: Gateway publish/start/stream path.
- `abstractgateway/tests/test_abstractflow_editor_gateway_contract.py`: Gateway-side editor contract
  test exists.

## Problem

Without explicit end-to-end checks, local runtime compatibility routes can be
reintroduced silently while discovery/contract checks still look correct.

## What we want to do

Create a regression gate that proves:

- the Flow UI path always starts with publish -> run start
- live/records flow through Gateway contracts and `/api/gateway/*`
- ledger streaming, artifacts, input schema, and history routes all resolve via Gateway helpers
- `/api/flows`, `/api/ws`, `/api/runs`, `/api/providers`, and local tool/provider routes are not used in default startup mode

## Why

This prevents confusion between local compatibility behavior and production editor behavior.

## Requirements

- Keep checks focused at stable seams (frontend path helpers + Python host route registry).
- No broad or brittle browser automation for every minor frontend refactor.
- Explicitly validate default startup behavior: gateway required in Gateway-only mode, local mode is explicit.
- Keep local-runtime route assertions as negative regression checks.

## Suggested implementation

- Keep existing frontend helper extraction if needed.
- Maintain/extend helper-level unit tests in `tests/test_frontend_gateway_contract.py`:
  - `gatewayPath(...)` always prefixes `/api/gateway`
  - run readiness requires helper descriptors for replay/stream contract
  - forbidden local routes are not present in frontend path surface
  - backend route snapshots exclude local routes when `ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME` is unset
- Add a documented smoke checklist in docs (publish/start/ledger/artifacts/history only through `/api/gateway/*`).
- Add one operational validation run in docs proving no `/api/flows` and no `/api/ws` for the default flow.

## Scope

- AbstractFlow frontend/backend contracts and test suite.
- Documentation of the cross-package smoke path.

## Non-goals

- Do not duplicate all Gateway contract tests in Flow.
- Do not require real provider API calls in CI.
- Do not require a live Gateway instance in unit tests.

## Dependencies and related tasks

- Completed Flow item: `../completed/010_gateway_only_remote_editor_transport.md`.
- Completed Flow item: `../completed/040_gateway_capability_schema_and_connection_contract.md`.
- Completed Flow item: `../completed/060_gateway_contract_helper_endpoint_strictness.md`.
- Gateway completed item:
  `abstractgateway/docs/backlog/completed/020_abstractflow_editor_first_contract.md`.

- Recommended follow-up: `../proposed/2026-05-09_abstractflow_gateway_migration_roadmap.md`.

## Expected outcomes

- One regression gate catches local runtime fallback before release.
- The migration can be validated quickly by maintainers and reviewers through an operational smoke command.

## Validation

- Flow Python tests pass.
- Frontend tests pass.
- Manual smoke checklist confirms publish/start/stream/history/artifacts through Gateway.
- `tests/test_frontend_gateway_contract.py` should remain the direct negative-local-fallback gate.

### Operational smoke command (example)

```bash
# 1) Start abstractgateway
export ABSTRACTGATEWAY_AUTH_TOKEN=dev-token
abstractgateway serve --port 18100

# 2) Start abstractflow host in gateway-only mode
export ABSTRACTGATEWAY_URL=http://127.0.0.1:18100
abstractflow serve --port 18101 --host 127.0.0.1
```

```bash
# 3) End-to-end assertions (shell/curl-level)
# ensure test flow has unique id and no local-only dependencies
FLOW_ID="smoke-$(date +%s)"
cp web/flows/07935658.json /tmp/flow-smoke.json
FLOW_ID=$FLOW_ID python - <<'PY'
import json, os, pathlib
path = pathlib.Path('/tmp/flow-smoke.json')
flow = json.loads(path.read_text())
flow['id'] = os.environ['FLOW_ID']
flow['name'] = f"smoke-{flow['id']}"
flow['description'] = "smoke run"
flow.pop('created_at', None)
flow.pop('updated_at', None)
path.write_text(json.dumps(flow))
PY

CREATE=$(curl -sS -H 'Content-Type: application/json' -d @/tmp/flow-smoke.json http://127.0.0.1:18101/api/gateway/visualflows)
FLOW_ID=$(python -c 'import json, sys; print(json.loads(sys.argv[1]).get("id",""))' "$CREATE")
PUBLISH=$(curl -sS -H 'Content-Type: application/json' -d '{"bundle_version":"dev","overwrite":true}' "http://127.0.0.1:18101/api/gateway/visualflows/$FLOW_ID/publish")
BUNDLE_ID=$(python -c 'import json, sys; print(json.loads(sys.argv[1]).get("bundle_id",""))' "$PUBLISH")

RUN_PAYLOAD=$(cat <<EOF2
{\"bundle_id\":\"$BUNDLE_ID\",\"bundle_version\":\"dev\",\"flow_id\":\"$FLOW_ID\",\"input_data\":{\"use_context\":false,\"memory\":{},\"context\":{},\"provider\":\"x\",\"model\":\"x\",\"system\":\"\",\"prompt\":\"hello\",\"tools\":[],\"max_iterations\":0,\"max_in_tokens\":0,\"temperature\":0,\"seed\":0,\"resp_schema\":{}}}
EOF2)
RUN=$(curl -sS -H 'Content-Type: application/json' -d "$RUN_PAYLOAD" http://127.0.0.1:18101/api/gateway/runs/start)
RUN_ID=$(python -c 'import json, sys; print(json.loads(sys.argv[1]).get("run_id",""))' "$RUN")

curl -sS http://127.0.0.1:18101/api/gateway/runs/$RUN_ID/ledger
curl -sS --max-time 4 http://127.0.0.1:18101/api/gateway/runs/$RUN_ID/ledger/stream
curl -sS http://127.0.0.1:18101/api/gateway/runs/$RUN_ID/artifacts
curl -sS http://127.0.0.1:18101/api/gateway/runs/$RUN_ID
```

Negative checks:
- `curl -sS -w '%{http_code}' http://127.0.0.1:18101/api/flows` should be `404` (no handler when local mode unset).
- `curl -sS -w '%{http_code}' http://127.0.0.1:18101/api/ws/<flow_id>` should be `404`.
- `curl -sS -w '%{http_code}' http://127.0.0.1:18101/api/runs` should be `404`.

## Progress checklist

- [x] Add no-local-fallback regression assertions in frontend helper + route registry tests.
- [ ] Extract testable frontend Gateway helpers further if needed.
- [ ] Add explicit capability-failure regression (`descriptor`/`contract-version` mismatch fail fast).
- [x] Document and run operational smoke across abstractgateway + abstractflow.

## Guidance for the implementing agent

Keep the suite narrow and high-value. The goal is to catch local fallback regressions,
not to retest every VisualFlow node type.
