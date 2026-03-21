"""Gateway CLI option helpers for AbstractFlow."""

from __future__ import annotations

import os


DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080"


def resolve_gateway_url(url_override: str | None = None) -> str:
    raw = (
        str(url_override or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTGATEWAY_URL") or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTFLOW_GATEWAY_URL") or "").strip().rstrip("/")
    )
    return raw or DEFAULT_GATEWAY_URL


def resolve_gateway_token(token_override: str | None = None) -> str:
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


def require_gateway_connection(*, gateway_url: str | None = None, gateway_token: str | None = None) -> tuple[str, str]:
    url = resolve_gateway_url(gateway_url)
    token = resolve_gateway_token(gateway_token)
    if token:
        return url, token
    raise ValueError(
        "AbstractFlow requires gateway authentication. "
        "Export ABSTRACTGATEWAY_AUTH_TOKEN or pass --gateway-token <token>."
    )
