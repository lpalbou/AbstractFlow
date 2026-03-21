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


DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080"


def _resolve_gateway_url(url_override: str | None = None) -> str:
    raw = (
        str(url_override or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTGATEWAY_URL") or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTFLOW_GATEWAY_URL") or "").strip().rstrip("/")
    )
    return raw or DEFAULT_GATEWAY_URL


def _resolve_gateway_token(token_override: str | None = None) -> str:
    token = (
        str(token_override or "").strip()
        or str(os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") or "").strip()
        or str(os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN") or "").strip()
        or str(os.getenv("ABSTRACTCODE_GATEWAY_TOKEN") or "").strip()
    )
    if token:
        return token
    raw_list = str(os.getenv("ABSTRACTGATEWAY_AUTH_TOKENS") or os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKENS") or "").strip()
    if raw_list:
        return raw_list.split(",", 1)[0].strip()
    return ""


def _require_gateway_connection(gateway_url: str | None = None, gateway_token: str | None = None) -> tuple[str, str]:
    url = _resolve_gateway_url(gateway_url)
    token = _resolve_gateway_token(gateway_token)
    if token:
        return url, token
    raise ValueError(
        "AbstractFlow requires gateway authentication. "
        "Export ABSTRACTGATEWAY_AUTH_TOKEN or pass --gateway-token <token>."
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

        gateway_url, gateway_token = _require_gateway_connection(args.gateway_url, args.gateway_token)
        os.environ["ABSTRACTGATEWAY_URL"] = _resolve_gateway_url(gateway_url)
        os.environ["ABSTRACTFLOW_GATEWAY_URL"] = _resolve_gateway_url(gateway_url)
        os.environ["ABSTRACTGATEWAY_AUTH_TOKEN"] = _resolve_gateway_token(gateway_token)
        os.environ["ABSTRACTFLOW_GATEWAY_AUTH_TOKEN"] = _resolve_gateway_token(gateway_token)

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
