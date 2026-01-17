"""Connection/configuration endpoints for the AbstractFlow UI.

These endpoints are intentionally small and local-dev friendly:
- store gateway URL + token needed for embeddings-backed features (memory KG semantic search)
- do not ever return tokens to the browser
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.gateway_connection import (
    apply_gateway_connection_to_env,
    bootstrap_gateway_connection_env,
    clear_persisted_gateway_connection,
    fetch_gateway_embeddings_config,
    resolve_effective_gateway_connection,
    save_persisted_gateway_connection,
)


router = APIRouter(prefix="/connection", tags=["connection"])


class GatewayConnectionUpdate(BaseModel):
    gateway_url: str | None = Field(default=None, description="Base URL of AbstractGateway (e.g. http://127.0.0.1:8081).")
    gateway_token: str | None = Field(default=None, description="Bearer token for gateway (stored server-side).")
    persist: bool = Field(default=True, description="Persist the connection config to the runtime dir.")


@router.get("/gateway")
async def get_gateway_connection() -> Dict[str, Any]:
    bootstrap_gateway_connection_env()
    url, token, source = resolve_effective_gateway_connection()
    embeddings = fetch_gateway_embeddings_config(gateway_url=url, token=token)
    return {
        "ok": True,
        "gateway_url": url,
        "has_token": bool(token),
        "token_source": source,
        "embeddings": embeddings,
    }


@router.post("/gateway")
async def set_gateway_connection(payload: GatewayConnectionUpdate) -> Dict[str, Any]:
    url = (payload.gateway_url or "").strip().rstrip("/") or None
    token = (payload.gateway_token or "").strip() or None

    # Apply immediately for the current process (used by runner wiring).
    apply_gateway_connection_to_env(gateway_url=url, gateway_token=token)

    # Persist if requested.
    if bool(payload.persist):
        try:
            save_persisted_gateway_connection(gateway_url=url, gateway_token=token)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to persist gateway connection: {e}") from e

    # Re-check embeddings status (no token is returned).
    url2, token2, source2 = resolve_effective_gateway_connection()
    embeddings = fetch_gateway_embeddings_config(gateway_url=url2, token=token2)

    return {
        "ok": True,
        "gateway_url": url2,
        "has_token": bool(token2),
        "token_source": source2,
        "embeddings": embeddings,
    }


@router.delete("/gateway")
async def clear_gateway_connection() -> Dict[str, Any]:
    try:
        clear_persisted_gateway_connection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear config: {e}") from e
    # Do not mutate env on delete (explicit env vars should win).
    return {"ok": True}

