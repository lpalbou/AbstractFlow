"""Gateway CLI option helpers for AbstractFlow."""

from __future__ import annotations

import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080"


def local_runtime_enabled() -> bool:
    raw = str(os.getenv("ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def resolve_gateway_url(url_override: str | None = None) -> str:
    raw = (
        str(url_override or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTGATEWAY_URL") or "").strip().rstrip("/")
        or str(os.getenv("ABSTRACTFLOW_GATEWAY_URL") or "").strip().rstrip("/")
    )
    return raw or DEFAULT_GATEWAY_URL


def resolve_gateway_token(token_override: str | None = None) -> str:
    token = str(token_override or "").strip()
    if token:
        return token

    token = str(os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") or "").strip()
    if token:
        return token

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


def check_gateway_connection(
    *,
    gateway_url: str | None = None,
    gateway_token: str | None = None,
    timeout_s: float = 3.0,
) -> tuple[bool, str | None]:
    """Verify connectivity to AbstractGateway's discovery endpoint.

    Returns `(True, None)` on success and `(False, error_message)` on failure.
    """
    url = resolve_gateway_url(gateway_url).rstrip("/")
    token = resolve_gateway_token(gateway_token)
    if not token:
        return (
            False,
            "AbstractFlow requires gateway authentication. "
            "Export ABSTRACTGATEWAY_AUTH_TOKEN or pass --gateway-token <token>.",
        )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    req = Request(url=f"{url}/api/gateway/discovery/capabilities", headers=headers, method="GET")
    try:
        with urlopen(req, timeout=float(timeout_s)) as resp:
            if int(getattr(resp, "status", 200)) >= 400:
                return False, f"Gateway returned HTTP {getattr(resp, 'status', 'unknown')} for {url}/api/gateway/discovery/capabilities"
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = ""
        return (
            False,
            f"Cannot reach AbstractGateway at {url} (HTTP {e.code}): {detail or e.reason}",
        )
    except URLError as e:
        return False, f"Cannot reach AbstractGateway at {url}: {e}"
    except Exception as e:
        return False, f"Gateway connectivity check failed: {e}"

    return True, None


def require_gateway_connectivity(
    *,
    gateway_url: str | None = None,
    gateway_token: str | None = None,
    timeout_s: float = 3.0,
) -> None:
    """Require that AbstractGateway is reachable before starting editor/runtime paths."""
    ok, detail = check_gateway_connection(
        gateway_url=gateway_url,
        gateway_token=gateway_token,
        timeout_s=timeout_s,
    )
    if not ok:
        raise ValueError(detail or "AbstractFlow cannot reach AbstractGateway.")
