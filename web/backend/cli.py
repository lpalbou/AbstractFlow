"""Local/dev runner for the AbstractFlow web backend.

Why:
- `uvicorn` rejects unknown flags, so we can't do `uvicorn ... --monitor-gpu`.
- We still want a simple CLI switch (`--monitor-gpu`) for local runs.
"""

from __future__ import annotations

import argparse
import os
import sys

import uvicorn
from abstractflow.gateway_options import (
    local_runtime_enabled,
    require_gateway_connectivity,
    resolve_gateway_token,
    resolve_gateway_url,
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m backend", add_help=True)
    p.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    p.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    p.add_argument("--reload", action="store_true", help="Enable auto-reload (dev)")
    p.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "info"))
    p.add_argument("--monitor-gpu", action="store_true", help="Show the small GPU widget in the UI")
    p.add_argument("--gateway-url", default=None)
    p.add_argument("--gateway-token", default=None)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    try:
        args = _parse_args(argv)

        if args.monitor_gpu:
            os.environ["ABSTRACTFLOW_MONITOR_GPU"] = "1"

        local_mode = local_runtime_enabled()
        if local_mode:
            print("Running in local runtime compatibility mode (ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME=1).")
        else:
            gateway_url = resolve_gateway_url(args.gateway_url)
            gateway_token = resolve_gateway_token(args.gateway_token)
            os.environ["ABSTRACTGATEWAY_URL"] = gateway_url
            os.environ["ABSTRACTFLOW_GATEWAY_URL"] = gateway_url
            if gateway_token:
                require_gateway_connectivity(gateway_url=gateway_url, gateway_token=gateway_token)
                os.environ["ABSTRACTGATEWAY_AUTH_TOKEN"] = gateway_token
            else:
                print(
                    "AbstractFlow started without a gateway token. "
                    "Use the browser connection dialog to configure AbstractGateway.",
                    file=sys.stderr,
                )

        if args.gateway_url:
            os.environ["ABSTRACTGATEWAY_URL"] = resolve_gateway_url(args.gateway_url)
            os.environ["ABSTRACTFLOW_GATEWAY_URL"] = resolve_gateway_url(args.gateway_url)
        if args.gateway_token:
            os.environ["ABSTRACTGATEWAY_AUTH_TOKEN"] = resolve_gateway_token(args.gateway_token)

        uvicorn.run(
            "backend.main:app",
            host=str(args.host),
            port=int(args.port),
            reload=bool(args.reload),
            log_level=str(args.log_level),
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2) from e


if __name__ == "__main__":
    main()
