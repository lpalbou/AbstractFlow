"""Connection/configuration endpoints for the AbstractFlow UI.

These endpoints are intentionally small and local-dev friendly:
- keep browser sign-in state in HTTP-only cookies
- do not ever return tokens to the browser
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..services.gateway_connection import (
    GATEWAY_SESSION_CSRF_COOKIE,
    GATEWAY_SESSION_ID_COOKIE,
    GATEWAY_SESSION_TOKEN_COOKIE,
    GATEWAY_SESSION_URL_COOKIE,
    browser_gateway_connection_config_allowed,
    browser_gateway_connection_config_denial,
    browser_gateway_request_host,
    create_gateway_browser_session,
    fetch_gateway_connection_check,
    fetch_gateway_session_check,
    logout_gateway_browser_session,
    resolve_effective_gateway_connection_for_request,
    resolve_gateway_csrf_for_request,
    resolve_gateway_url_from_server_config,
)


router = APIRouter(prefix="/connection", tags=["connection"])


def _browser_config_host(request: Request) -> str | None:
    return browser_gateway_request_host(request.headers)


def _cookie_secure(request: Request) -> bool:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return str(proto or "").strip().lower() == "https"


def _set_gateway_session_cookies(
    response: Response,
    request: Request,
    *,
    gateway_url: str,
    session_id: str,
    csrf_token: str,
    remember: bool,
) -> None:
    base_kwargs: Dict[str, Any] = {
        "httponly": True,
        "samesite": "lax",
        "secure": _cookie_secure(request),
        "path": "/",
    }
    if remember:
        base_kwargs["max_age"] = 60 * 60 * 24 * 30
    response.set_cookie(GATEWAY_SESSION_URL_COOKIE, str(gateway_url or "").strip().rstrip("/"), **base_kwargs)
    response.set_cookie(GATEWAY_SESSION_ID_COOKIE, str(session_id or "").strip(), **base_kwargs)
    csrf_kwargs = dict(base_kwargs)
    csrf_kwargs["httponly"] = False
    response.set_cookie(GATEWAY_SESSION_CSRF_COOKIE, str(csrf_token or "").strip(), **csrf_kwargs)
    response.delete_cookie(GATEWAY_SESSION_TOKEN_COOKIE, path="/", samesite="lax", secure=_cookie_secure(request))


def _clear_gateway_session_cookies(response: Response, request: Request) -> None:
    response.delete_cookie(GATEWAY_SESSION_URL_COOKIE, path="/", samesite="lax", secure=_cookie_secure(request))
    response.delete_cookie(GATEWAY_SESSION_ID_COOKIE, path="/", samesite="lax", secure=_cookie_secure(request))
    response.delete_cookie(GATEWAY_SESSION_CSRF_COOKIE, path="/", samesite="lax", secure=_cookie_secure(request))
    response.delete_cookie(GATEWAY_SESSION_TOKEN_COOKIE, path="/", samesite="lax", secure=_cookie_secure(request))


def _public_gateway_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return Gateway status without session credentials or raw tokens."""

    out = dict(payload or {})
    session = out.get("session") if isinstance(out.get("session"), dict) else {}
    if session:
        public_session: Dict[str, Any] = {}
        expires_at = session.get("expires_at")
        if isinstance(expires_at, str) and expires_at.strip():
            public_session["expires_at"] = expires_at.strip()
        out["session"] = public_session
    for key in ("token", "gateway_token", "session_id", "csrf_token"):
        out.pop(key, None)
    return out


class GatewayConnectionUpdate(BaseModel):
    gateway_url: str | None = Field(default=None, description="Base URL of AbstractGateway (e.g. http://127.0.0.1:8080).")
    gateway_user_id: str | None = Field(default=None, description="Expected Gateway user id for hosted user-auth mode.")
    gateway_token: str | None = Field(default=None, description="Gateway user bearer token (exchanged for browser session cookies).")
    persist: bool = Field(default=True, description="Persist the connection config to the runtime dir.")
    validate_only: bool = Field(default=False, description="Validate the candidate connection without applying or persisting it.")


def _validate_expected_principal(gateway: Dict[str, Any], payload: GatewayConnectionUpdate) -> None:
    expected_user = str(payload.gateway_user_id or "").strip()
    if not expected_user:
        raise HTTPException(status_code=400, detail="Gateway user is required")
    principal = gateway.get("principal")
    if not isinstance(principal, dict):
        raise HTTPException(
            status_code=401,
            detail="Gateway did not return a user principal; cannot validate hosted user login.",
    )
    actual_user = str(principal.get("user_id") or "").strip()
    if expected_user and actual_user != expected_user:
        raise HTTPException(
            status_code=401,
            detail=f"Gateway token resolved to user '{actual_user or 'unknown'}', not '{expected_user}'.",
        )
    auth = gateway.get("auth") if isinstance(gateway.get("auth"), dict) else {}
    auth_mode = str(auth.get("mode") or "").strip()
    user_auth_enabled = auth.get("user_auth_enabled")
    source = str(principal.get("source") or "").strip()
    if auth_mode == "legacy-token" or user_auth_enabled is False or source == "legacy-token":
        raise HTTPException(
            status_code=401,
            detail="Only Gateway user tokens can be used for browser sign-in.",
        )
    if source != "user-registry" and not (auth_mode == "users" and user_auth_enabled is True):
        raise HTTPException(
            status_code=401,
            detail="Gateway did not confirm user-auth mode; cannot validate hosted user login.",
        )


@router.get("/gateway")
async def get_gateway_connection(request: Request) -> Dict[str, Any]:
    url, session_id, source = resolve_effective_gateway_connection_for_request(request)
    gateway = (
        fetch_gateway_session_check(gateway_url=url, session_id=session_id)
        if session_id
        else {
            "ok": False,
            "error": "Gateway sign-in required",
            "gateway_url": url,
            "auth_checked": False,
        }
    )
    return {
        "ok": bool(gateway.get("ok")),
        "gateway_url": url,
        "has_token": bool(session_id),
        "has_session": bool(session_id),
        "token_source": source,
        "embeddings": gateway,
        "gateway": gateway,
    }


@router.post("/gateway")
async def set_gateway_connection(
    payload: GatewayConnectionUpdate,
    request: Request,
    response: Response,
) -> Dict[str, Any]:
    config_host = _browser_config_host(request)
    can_mutate_server_config = browser_gateway_connection_config_allowed(config_host)

    current_url, _current_session, _current_source = resolve_effective_gateway_connection_for_request(request)
    url = (payload.gateway_url or "").strip().rstrip("/") or current_url
    token = (payload.gateway_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Gateway token is required")

    if not can_mutate_server_config:
        server_url = resolve_gateway_url_from_server_config()
        requested_url = (payload.gateway_url or "").strip().rstrip("/")
        allowed_url = str(server_url or current_url or "").strip().rstrip("/")
        if requested_url and requested_url != allowed_url:
            raise HTTPException(
                status_code=403,
                detail=(
                    browser_gateway_connection_config_denial(config_host)
                    + " Remote hosted Flow sessions may provide a user token for the server-configured Gateway URL, "
                    "but may not change the Gateway URL."
                ),
            )
        url = allowed_url or current_url

    gateway = fetch_gateway_connection_check(gateway_url=url, token=token)
    if not bool(gateway.get("ok")):
        detail = str(gateway.get("error") or "Gateway connection failed")
        raise HTTPException(status_code=401, detail=detail)
    _validate_expected_principal(gateway, payload)

    if not can_mutate_server_config:
        if bool(payload.validate_only):
            public_gateway = _public_gateway_payload(gateway)
            return {
                "ok": True,
                "gateway_url": url,
                "has_token": bool(token),
                "token_source": "candidate",
                "embeddings": public_gateway,
                "gateway": public_gateway,
            }
        session = create_gateway_browser_session(
            gateway_url=url,
            user_id=str(payload.gateway_user_id or "").strip(),
            token=token,
            remember=bool(payload.persist),
        )
        if not bool(session.get("ok")):
            raise HTTPException(status_code=401, detail=str(session.get("error") or "Gateway browser session failed"))
        session_data = session.get("session") if isinstance(session.get("session"), dict) else {}
        session_id = str(session_data.get("session_id") or "").strip()
        csrf_token = str(session_data.get("csrf_token") or "").strip()
        if not session_id or not csrf_token:
            raise HTTPException(status_code=502, detail="Gateway did not issue a browser session")
        _set_gateway_session_cookies(
            response,
            request,
            gateway_url=url,
            session_id=session_id,
            csrf_token=csrf_token,
            remember=bool(payload.persist),
        )
        public_session = _public_gateway_payload(session)
        return {
            "ok": True,
            "gateway_url": url,
            "has_token": True,
            "has_session": True,
            "token_source": "browser-session",
            "embeddings": public_session,
            "gateway": public_session,
        }

    if bool(payload.validate_only):
        public_gateway = _public_gateway_payload(gateway)
        return {
            "ok": True,
            "gateway_url": url,
            "has_token": bool(token),
            "token_source": "candidate",
            "embeddings": public_gateway,
            "gateway": public_gateway,
        }

    session = create_gateway_browser_session(
        gateway_url=url,
        user_id=str(payload.gateway_user_id or "").strip(),
        token=token,
        remember=bool(payload.persist),
    )
    if not bool(session.get("ok")):
        raise HTTPException(status_code=401, detail=str(session.get("error") or "Gateway browser session failed"))
    session_data = session.get("session") if isinstance(session.get("session"), dict) else {}
    session_id = str(session_data.get("session_id") or "").strip()
    csrf_token = str(session_data.get("csrf_token") or "").strip()
    if not session_id or not csrf_token:
        raise HTTPException(status_code=502, detail="Gateway did not issue a browser session")
    _set_gateway_session_cookies(
        response,
        request,
        gateway_url=url,
        session_id=session_id,
        csrf_token=csrf_token,
        remember=bool(payload.persist),
    )
    public_session = _public_gateway_payload(session)
    return {
        "ok": True,
        "gateway_url": url,
        "has_token": True,
        "has_session": True,
        "token_source": "browser-session",
        "embeddings": public_session,
        "gateway": public_session,
    }


@router.delete("/gateway")
async def clear_gateway_connection(request: Request, response: Response) -> Dict[str, Any]:
    url, session_id, _source = resolve_effective_gateway_connection_for_request(request)
    csrf_token = resolve_gateway_csrf_for_request(request)
    if session_id:
        logout_gateway_browser_session(gateway_url=url, session_id=session_id, csrf_token=csrf_token)
    _clear_gateway_session_cookies(response, request)
    return {"ok": True}
