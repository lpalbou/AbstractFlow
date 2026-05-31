"""Gateway connection configuration for AbstractFlow Web.

AbstractFlow is a thin client. In multi-user mode, browser requests must use
only the browser-owned Gateway session cookie; process env/config credentials
are server/operator state and must not become an ambient browser login.

This module provides:
- a small persisted Gateway URL config (runtime dir)
- browser-session cookie resolution for per-user Gateway auth
"""

from __future__ import annotations

from datetime import datetime, timezone
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .paths import resolve_runtime_dir

DEFAULT_GATEWAY_URL = "http://127.0.0.1:8080"
GATEWAY_SESSION_URL_COOKIE = "abstractflow_gateway_url"
GATEWAY_SESSION_ID_COOKIE = "abstractflow_gateway_session"
GATEWAY_SESSION_CSRF_COOKIE = "abstractflow_gateway_csrf"
GATEWAY_SESSION_TOKEN_COOKIE = "abstractflow_gateway_token"  # Legacy raw-token cookie; deleted on next sign-in/out.
GATEWAY_SESSION_HEADER = "X-AbstractGateway-Session"
GATEWAY_CSRF_HEADER = "X-AbstractGateway-CSRF"
_TRUE = {"1", "true", "yes", "y", "on"}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_bool(name: str, *, default: bool = False) -> bool:
    raw = os.getenv(str(name))
    if raw is None or not str(raw).strip():
        return bool(default)
    return str(raw).strip().lower() in _TRUE


def _host_header_hostname(host: Optional[str]) -> str:
    value = str(host or "").strip().split(",", 1)[0].strip()
    if not value:
        return ""
    if value.startswith("["):
        return value[1:].split("]", 1)[0].strip().lower()
    if value.count(":") == 1:
        value = value.rsplit(":", 1)[0]
    return value.strip().lower()


def _is_loopback_hostname(hostname: str) -> bool:
    if hostname in {"localhost", "localhost.localdomain", "::1"}:
        return True
    if hostname.startswith("127."):
        return True
    return False


def browser_gateway_connection_config_allowed(host: Optional[str]) -> bool:
    """Return whether this browser request may change Flow's Gateway URL."""

    if _env_bool("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", default=False):
        return True
    return _is_loopback_hostname(_host_header_hostname(host))


def browser_gateway_request_host(headers: Any) -> str:
    """Return the host used for browser-supplied Gateway URL policy checks."""

    try:
        host = str((headers or {}).get("host") or "").strip()
        trust_proxy = _env_bool("ABSTRACTFLOW_TRUST_PROXY_HEADERS", default=False) or _env_bool(
            "ABSTRACTGATEWAY_TRUST_PROXY_HEADERS",
            default=False,
        )
        if trust_proxy:
            return str((headers or {}).get("x-forwarded-host") or host).strip()
        return host
    except Exception:
        return ""


def browser_gateway_connection_config_denial(host: Optional[str]) -> str:
    hostname = _host_header_hostname(host) or "unknown host"
    return (
        "Browser-supplied Gateway URL changes are disabled for this non-local Flow host "
        f"({hostname}). Use the server-configured Gateway URL, or set "
        "ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG=1 only behind your own "
        "access control."
    )


def _runtime_dir() -> Path:
    return resolve_runtime_dir()


def _config_path() -> Path:
    return _runtime_dir() / "gateway_connection.json"


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        if not path.exists() or not path.is_file():
            return {}
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Best-effort: keep local secrets private (may no-op on some FS).
    try:
        os.chmod(path, 0o600)
    except Exception:
        pass


def resolve_gateway_url_from_env() -> Optional[str]:
    raw = os.getenv("ABSTRACTGATEWAY_URL") or os.getenv("ABSTRACTFLOW_GATEWAY_URL") or ""
    url = str(raw or "").strip().rstrip("/")
    return url if url else None


def resolve_gateway_token_from_env() -> Optional[str]:
    raw = os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") or ""
    token = str(raw or "").strip()
    if token:
        return token
    return None


def load_persisted_gateway_connection() -> Dict[str, Any]:
    return _read_json(_config_path())


def save_persisted_gateway_connection(
    *,
    gateway_url: Optional[str],
    gateway_token: Optional[str],
) -> Dict[str, Any]:
    url = str(gateway_url or "").strip().rstrip("/")
    payload: Dict[str, Any] = {
        "version": 1,
        "updated_at": _utc_now_iso(),
    }
    if url:
        payload["gateway_url"] = url
    _write_json(_config_path(), payload)
    return payload


def clear_persisted_gateway_connection() -> None:
    path = _config_path()
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def apply_gateway_connection_to_env(*, gateway_url: Optional[str], gateway_token: Optional[str]) -> None:
    url = str(gateway_url or "").strip().rstrip("/")

    if url:
        os.environ["ABSTRACTFLOW_GATEWAY_URL"] = url
        # Keep canonical env var too (some callers read it).
        os.environ["ABSTRACTGATEWAY_URL"] = url


def bootstrap_gateway_connection_env() -> None:
    """Load persisted gateway URL into env if env is not already set.

    Browser login tokens are intentionally not bootstrapped into process env.
    """
    if resolve_gateway_url_from_env():
        return

    data = load_persisted_gateway_connection()
    url = data.get("gateway_url") if isinstance(data.get("gateway_url"), str) else None
    apply_gateway_connection_to_env(gateway_url=url, gateway_token=None)


def resolve_effective_gateway_connection() -> Tuple[str, Optional[str], str]:
    """Return server Gateway URL without any browser credential.

    Kept for older imports; multi-user browser auth is resolved per request by
    ``resolve_effective_gateway_connection_for_request``.
    """
    return (resolve_gateway_url_from_server_config(), None, "none")


def resolve_gateway_url_from_server_config() -> str:
    url = resolve_gateway_url_from_env()
    data = load_persisted_gateway_connection()
    url2 = data.get("gateway_url") if isinstance(data.get("gateway_url"), str) else None
    return str(url or url2 or DEFAULT_GATEWAY_URL).strip().rstrip("/")


def resolve_effective_gateway_connection_for_request(request: Any) -> Tuple[str, Optional[str], str]:
    """Return the Gateway connection for one browser/native request.

    Browser-session cookies are the only browser login authority. Server-held
    Gateway tokens are deliberately ignored here so one Flow process can serve
    multiple users without sharing one credential across browsers.
    """
    cookie_url = ""
    cookie_session = ""
    request_host = ""
    try:
        cookies = getattr(request, "cookies", {}) or {}
        cookie_url = str(cookies.get(GATEWAY_SESSION_URL_COOKIE) or "").strip().rstrip("/")
        cookie_session = str(cookies.get(GATEWAY_SESSION_ID_COOKIE) or "").strip()
        headers = getattr(request, "headers", {}) or {}
        request_host = browser_gateway_request_host(headers)
    except Exception:
        cookie_url = ""
        cookie_session = ""
        request_host = ""

    server_url = resolve_gateway_url_from_server_config()
    allow_cookie_url = _env_bool("ABSTRACTFLOW_ALLOW_BROWSER_GATEWAY_URL_COOKIE", default=False) or _env_bool(
        "ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG",
        default=False,
    ) or browser_gateway_connection_config_allowed(request_host)
    url = (
        cookie_url
        if cookie_url and (allow_cookie_url or cookie_url == server_url)
        else server_url
    )
    if cookie_session:
        return (url or DEFAULT_GATEWAY_URL, cookie_session, "browser-session")
    return (url or DEFAULT_GATEWAY_URL, None, "none")


def resolve_gateway_csrf_for_request(request: Any) -> Optional[str]:
    try:
        cookies = getattr(request, "cookies", {}) or {}
        csrf = str(cookies.get(GATEWAY_SESSION_CSRF_COOKIE) or "").strip()
        return csrf or None
    except Exception:
        return None


def fetch_gateway_connection_check(*, gateway_url: str, token: Optional[str], timeout_s: float = 1.5) -> Dict[str, Any]:
    """Check that Flow can reach Gateway with the configured token.

    This is a login/reachability check only. It intentionally avoids provider,
    model, voice, vision, or embeddings discovery because those are optional
    capability probes and can legitimately be unavailable offline.
    """
    base = str(gateway_url or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "error": "Gateway URL is required"}
    if not isinstance(token, str) or not token.strip():
        return {"ok": False, "error": "Gateway token missing"}

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token.strip()}",
    }

    def _fetch(path: str) -> tuple[int, Dict[str, Any]]:
        req = Request(url=f"{base}{path}", method="GET", headers=headers)
        with urlopen(req, timeout=float(timeout_s)) as resp:
            status_code = int(getattr(resp, "status", 200))
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        return status_code, data if isinstance(data, dict) else {}

    try:
        try:
            status_code, data = _fetch("/api/gateway/me")
            model = "principal"
        except HTTPError as e:
            if int(getattr(e, "code", 0) or 0) != 404:
                raise
            status_code, data = _fetch("/api/gateway/ping")
            model = "ping"
        return {
            "ok": True,
            "provider": "gateway",
            "model": model,
            "auth_checked": True,
            "gateway_url": base,
            "http_status": status_code,
            "service": data.get("service"),
            "gateway_status": data.get("status"),
            "principal": data.get("principal"),
            "auth": data.get("auth"),
            "routing": data.get("routing"),
        }
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = ""
        return {"ok": False, "error": f"HTTP {e.code}: {detail or e.reason}"}
    except URLError as e:
        return {"ok": False, "error": f"Request failed: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fetch_gateway_embeddings_config(*, gateway_url: str, token: Optional[str], timeout_s: float = 1.5) -> Dict[str, Any]:
    """Backward-compatible name used by older Flow UI code paths."""
    return fetch_gateway_connection_check(gateway_url=gateway_url, token=token, timeout_s=timeout_s)


def fetch_gateway_session_check(*, gateway_url: str, session_id: Optional[str], timeout_s: float = 1.5) -> Dict[str, Any]:
    base = str(gateway_url or "").strip().rstrip("/")
    session = str(session_id or "").strip()
    if not base:
        return {"ok": False, "error": "Gateway URL is required"}
    if not session:
        return {"ok": False, "error": "Gateway sign-in required"}
    headers = {
        "Accept": "application/json",
        GATEWAY_SESSION_HEADER: session,
    }
    try:
        req = Request(url=f"{base}/api/gateway/me", method="GET", headers=headers)
        with urlopen(req, timeout=float(timeout_s)) as resp:
            status_code = int(getattr(resp, "status", 200))
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        data = data if isinstance(data, dict) else {}
        return {
            "ok": True,
            "provider": "gateway",
            "model": "principal",
            "auth_checked": True,
            "gateway_url": base,
            "http_status": status_code,
            "service": data.get("service"),
            "gateway_status": data.get("status"),
            "principal": data.get("principal"),
            "auth": data.get("auth"),
            "routing": data.get("routing"),
        }
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = ""
        return {"ok": False, "error": f"HTTP {e.code}: {detail or e.reason}"}
    except URLError as e:
        return {"ok": False, "error": f"Request failed: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def create_gateway_browser_session(
    *,
    gateway_url: str,
    user_id: str,
    token: str,
    remember: bool,
    timeout_s: float = 3.0,
) -> Dict[str, Any]:
    base = str(gateway_url or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "error": "Gateway URL is required"}
    if not str(user_id or "").strip():
        return {"ok": False, "error": "Gateway user is required"}
    if not str(token or "").strip():
        return {"ok": False, "error": "Gateway token missing"}
    body = json.dumps(
        {
            "user_id": str(user_id or "").strip(),
            "token": str(token or "").strip(),
            "remember": bool(remember),
        }
    ).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        req = Request(url=f"{base}/api/gateway/session/login", data=body, method="POST", headers=headers)
        with urlopen(req, timeout=float(timeout_s)) as resp:
            status_code = int(getattr(resp, "status", 200))
            try:
                set_cookie_headers = list(resp.headers.get_all("Set-Cookie") or [])
            except Exception:
                raw_cookie = resp.headers.get("Set-Cookie")
                set_cookie_headers = [raw_cookie] if raw_cookie else []
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            data = {}
        cookie = SimpleCookie()
        for header_value in set_cookie_headers:
            try:
                cookie.load(str(header_value or ""))
            except Exception:
                continue
        session_value = ""
        csrf_value = ""
        try:
            morsel = cookie.get("abstractgateway_session")
            if morsel is not None:
                session_value = str(morsel.value or "").strip()
        except Exception:
            session_value = ""
        try:
            morsel = cookie.get("abstractgateway_csrf")
            if morsel is not None:
                csrf_value = str(morsel.value or "").strip()
        except Exception:
            csrf_value = ""
        if session_value or csrf_value:
            session_payload = data.get("session") if isinstance(data.get("session"), dict) else {}
            session_payload = dict(session_payload)
            if session_value:
                session_payload["session_id"] = session_value
            if csrf_value:
                session_payload["csrf_token"] = csrf_value
            data["session"] = session_payload
        data.setdefault("ok", True)
        data["gateway_url"] = base
        data["http_status"] = status_code
        data["provider"] = "gateway"
        data["model"] = "principal"
        data["auth_checked"] = True
        return data
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8")
        except Exception:
            detail = ""
        return {"ok": False, "error": f"HTTP {e.code}: {detail or e.reason}"}
    except URLError as e:
        return {"ok": False, "error": f"Request failed: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def logout_gateway_browser_session(
    *,
    gateway_url: str,
    session_id: Optional[str],
    csrf_token: Optional[str],
    timeout_s: float = 2.0,
) -> Dict[str, Any]:
    base = str(gateway_url or "").strip().rstrip("/")
    session = str(session_id or "").strip()
    csrf = str(csrf_token or "").strip()
    if not base or not session:
        return {"ok": False, "error": "Gateway session missing"}
    headers = {
        "Accept": "application/json",
        GATEWAY_SESSION_HEADER: session,
    }
    if csrf:
        headers[GATEWAY_CSRF_HEADER] = csrf
    try:
        req = Request(url=f"{base}/api/gateway/session/logout", data=b"{}", method="POST", headers=headers)
        with urlopen(req, timeout=float(timeout_s)) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else {}
        return data if isinstance(data, dict) else {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
