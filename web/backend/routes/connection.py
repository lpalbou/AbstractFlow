"""Connection/configuration endpoints for the AbstractFlow UI.

These endpoints are intentionally small and local-dev friendly:
- store gateway URL + token needed for embeddings-backed features (memory KG semantic search)
- do not ever return tokens to the browser
"""

from __future__ import annotations

import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.gateway_connection import (
    apply_gateway_connection_to_env,
    bootstrap_gateway_connection_env,
    clear_persisted_gateway_connection,
    fetch_gateway_connection_check,
    resolve_effective_gateway_connection,
    save_persisted_gateway_connection,
)


router = APIRouter(prefix="/connection", tags=["connection"])


class GatewayConnectionUpdate(BaseModel):
    gateway_url: str | None = Field(default=None, description="Base URL of AbstractGateway (e.g. http://127.0.0.1:8080).")
    gateway_token: str | None = Field(default=None, description="Bearer token for gateway (stored server-side).")
    persist: bool = Field(default=True, description="Persist the connection config to the runtime dir.")
    validate_only: bool = Field(default=False, description="Validate the candidate connection without applying or persisting it.")


@router.get("/gateway")
async def get_gateway_connection() -> Dict[str, Any]:
    bootstrap_gateway_connection_env()
    url, token, source = resolve_effective_gateway_connection()
    gateway = fetch_gateway_connection_check(gateway_url=url, token=token)
    return {
        "ok": bool(gateway.get("ok")),
        "gateway_url": url,
        "has_token": bool(token),
        "token_source": source,
        "embeddings": gateway,
        "gateway": gateway,
    }


@router.post("/gateway")
async def set_gateway_connection(payload: GatewayConnectionUpdate) -> Dict[str, Any]:
    current_url, current_token, _current_source = resolve_effective_gateway_connection()
    url = (payload.gateway_url or "").strip().rstrip("/") or current_url
    token = (payload.gateway_token or "").strip() or current_token

    gateway = fetch_gateway_connection_check(gateway_url=url, token=token)
    if not bool(gateway.get("ok")):
        detail = str(gateway.get("error") or "Gateway connection failed")
        raise HTTPException(status_code=401, detail=detail)

    if bool(payload.validate_only):
        return {
            "ok": True,
            "gateway_url": url,
            "has_token": bool(token),
            "token_source": "candidate",
            "embeddings": gateway,
            "gateway": gateway,
        }

    # Apply immediately for the current process (used by runner wiring).
    apply_gateway_connection_to_env(gateway_url=url, gateway_token=token)

    # Persist if requested.
    if bool(payload.persist):
        try:
            save_persisted_gateway_connection(gateway_url=url, gateway_token=token)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to persist gateway connection: {e}") from e

    # Re-read effective connection (no token is returned).
    url2, token2, source2 = resolve_effective_gateway_connection()

    return {
        "ok": True,
        "gateway_url": url2,
        "has_token": bool(token2),
        "token_source": source2,
        "embeddings": gateway,
        "gateway": gateway,
    }


@router.delete("/gateway")
async def clear_gateway_connection() -> Dict[str, Any]:
    try:
        clear_persisted_gateway_connection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear config: {e}") from e
    # Logout is a runtime action for this Flow server session. If credentials
    # came from the process environment, a restart may restore them.
    os.environ.pop("ABSTRACTGATEWAY_AUTH_TOKEN", None)
    return {"ok": True}
