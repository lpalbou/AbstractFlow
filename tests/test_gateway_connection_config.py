from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace


# Backend lives under `abstractflow/web/backend` (dev package). Add `abstractflow/web` to sys.path for tests.
_WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
sys.path.insert(0, str(_WEB_ROOT))


def test_gateway_connection_modal_uses_three_field_user_login() -> None:
    modal = (_WEB_ROOT / "frontend" / "src" / "components" / "GatewayConnectionModal.tsx").read_text(
        encoding="utf-8"
    )
    shared_card = (
        Path(__file__).resolve().parents[2] / "abstractuic" / "ui-kit" / "src" / "gateway_session_signin.tsx"
    ).read_text(encoding="utf-8")
    combined = modal + "\n" + shared_card
    assert "GatewaySessionSignInCard" in modal
    assert "Gateway URL" in shared_card
    assert "Gateway user" in shared_card
    assert "Gateway token" in shared_card
    assert "useState('admin')" in modal
    assert "HTTP-only browser session" in modal
    assert "gateway_user_id: gatewayUserId" in modal
    assert "Tenant" not in modal
    assert "tenant_id" not in modal
    assert "gateway_tenant_id" not in modal
    assert "Sign in" in combined
    assert ">Test<" not in combined


def _patch_gateway_session(monkeypatch, connection_route, *, principal: dict | None = None) -> None:
    def _create_gateway_browser_session(*, gateway_url, user_id, token, remember):
        user = dict(principal or {"user_id": user_id, "tenant_id": "default", "source": "user-registry", "admin": False})
        user.setdefault("user_id", user_id)
        user.setdefault("source", "user-registry")
        return {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": user,
            "auth": {"mode": "users", "user_auth_enabled": True, "session": "gateway-browser-session"},
            "routing": {"mode": "per-principal", "one_user_one_runtime": True},
            "session": {"session_id": "agws_test.session", "csrf_token": "agcsrf_test", "expires_at": "2099-01-01T00:00:00+00:00"},
        }

    monkeypatch.setattr(connection_route, "create_gateway_browser_session", _create_gateway_browser_session)


def test_create_gateway_browser_session_reads_gateway_set_cookie_without_body_secrets(monkeypatch) -> None:
    from backend.services import gateway_connection

    class _Headers:
        def get_all(self, name):
            if str(name).lower() != "set-cookie":
                return []
            return [
                "abstractgateway_session=agws_cookie.session; HttpOnly; Path=/; SameSite=Lax",
                "abstractgateway_csrf=agcsrf_cookie; Path=/; SameSite=Lax",
            ]

    class _Response:
        status = 200
        headers = _Headers()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return (
                b'{"ok": true, "principal": {"user_id": "alice", "source": "user-registry"}, '
                b'"session": {"expires_at": "2099-01-01T00:00:00+00:00"}}'
            )

    monkeypatch.setattr(gateway_connection, "urlopen", lambda *_args, **_kwargs: _Response())

    payload = gateway_connection.create_gateway_browser_session(
        gateway_url="http://127.0.0.1:8080",
        user_id="alice",
        token="alice-token",
        remember=False,
    )

    assert payload["ok"] is True
    assert payload["session"]["session_id"] == "agws_cookie.session"
    assert payload["session"]["csrf_token"] == "agcsrf_cookie"


def test_gateway_connection_persistence_and_bootstrap(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))

    # Ensure a clean env baseline (the module reads env).
    for k in [
        "ABSTRACTFLOW_GATEWAY_URL",
        "ABSTRACTGATEWAY_URL",
        "ABSTRACTGATEWAY_AUTH_TOKEN",
    ]:
        monkeypatch.delenv(k, raising=False)

    from backend.services.gateway_connection import (
        bootstrap_gateway_connection_env,
        load_persisted_gateway_connection,
        save_persisted_gateway_connection,
    )

    save_persisted_gateway_connection(gateway_url="http://127.0.0.1:8081", gateway_token="dev-token")
    persisted = load_persisted_gateway_connection()
    assert persisted.get("gateway_url") == "http://127.0.0.1:8081"
    assert "gateway_token" not in persisted

    # Only the URL is server-persisted; browser login tokens stay in browser cookies.
    bootstrap_gateway_connection_env()
    assert os.getenv("ABSTRACTFLOW_GATEWAY_URL") == "http://127.0.0.1:8081"
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_bootstrap_does_not_override_explicit_env(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))

    from backend.services.gateway_connection import bootstrap_gateway_connection_env, save_persisted_gateway_connection

    save_persisted_gateway_connection(gateway_url="http://127.0.0.1:8081", gateway_token="persisted-token")

    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://example.invalid:8081")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "env-token")

    bootstrap_gateway_connection_env()
    assert os.getenv("ABSTRACTFLOW_GATEWAY_URL") == "http://example.invalid:8081"
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") == "env-token"


def test_gateway_connection_request_cookie_overrides_server_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://gateway.example")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "server-token")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)

    from backend.services.gateway_connection import (
        GATEWAY_SESSION_ID_COOKIE,
        GATEWAY_SESSION_TOKEN_COOKIE,
        GATEWAY_SESSION_URL_COOKIE,
        resolve_effective_gateway_connection_for_request,
    )

    class _Request:
        cookies = {
            GATEWAY_SESSION_URL_COOKIE: "http://gateway.example",
            GATEWAY_SESSION_ID_COOKIE: "alice-session",
            GATEWAY_SESSION_TOKEN_COOKIE: "alice-token",
        }

    url, token, source = resolve_effective_gateway_connection_for_request(_Request())
    assert url == "http://gateway.example"
    assert token == "alice-session"
    assert source == "browser-session"


def test_gateway_connection_request_without_cookie_ignores_server_token(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://gateway.example")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "server-token")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)

    from backend.services.gateway_connection import resolve_effective_gateway_connection_for_request

    class _Request:
        cookies = {}
        headers = {"host": "127.0.0.1:3003"}

    url, token, source = resolve_effective_gateway_connection_for_request(_Request())
    assert url == "http://gateway.example"
    assert token is None
    assert source == "none"


def test_health_does_not_treat_server_token_as_browser_login(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://gateway.example")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "server-token")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.get("/api/health")

    assert res.status_code == 200
    assert res.json()["status"] == "healthy"
    assert res.json()["gateway_token_configured"] is False
    assert res.json()["gateway_token_source"] == "browser-session"
    assert res.json()["browser_sign_in_required"] is True


def test_flow_cli_serve_ignores_gateway_token_for_browser_auth(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_URL", raising=False)

    captured: dict[str, object] = {}

    def _run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs

    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=_run))

    from abstractflow import cli as flow_cli

    rc = flow_cli.main(
        [
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            "3999",
            "--gateway-url",
            "http://gateway.example",
            "--gateway-token",
            "server-token",
        ]
    )

    assert rc == 0
    assert os.getenv("ABSTRACTGATEWAY_URL") == "http://gateway.example"
    assert os.getenv("ABSTRACTFLOW_GATEWAY_URL") == "http://gateway.example"
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None
    assert captured["kwargs"]["host"] == "127.0.0.1"
    assert captured["kwargs"]["port"] == 3999


def test_gateway_connection_remote_host_uses_browser_session_cookie(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": {"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False},
        },
    )
    _patch_gateway_session(monkeypatch, connection_route, principal={"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False})

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "alice",
                "gateway_token": "secret-token",
                "persist": False,
            },
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 200
    assert res.json()["token_source"] == "browser-session"
    assert res.json()["has_token"] is True
    assert "session_id" not in res.json().get("gateway", {}).get("session", {})
    assert "csrf_token" not in res.json().get("gateway", {}).get("session", {})
    assert "agws_test.session" not in res.text
    assert "agcsrf_test" not in res.text
    set_cookie = res.headers.get("set-cookie", "")
    assert "abstractflow_gateway_session=" in set_cookie
    assert "secret-token" not in set_cookie
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_accepts_user_registry_admin_principal(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": {
                "user_id": "admin",
                "tenant_id": "default",
                "roles": ["admin", "user"],
                "source": "user-registry",
                "admin": True,
            },
        },
    )
    _patch_gateway_session(
        monkeypatch,
        connection_route,
        principal={"user_id": "admin", "tenant_id": "default", "roles": ["admin", "user"], "source": "user-registry", "admin": True},
    )

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "admin",
                "gateway_token": "admin-user-token",
                "persist": False,
            },
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 200
    assert res.json()["token_source"] == "browser-session"
    assert res.json()["gateway"]["principal"]["admin"] is True
    assert "abstractflow_gateway_session=" in res.headers.get("set-cookie", "")
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_accepts_gateway_owned_user_auth_without_source(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "auth": {"mode": "users", "user_auth_enabled": True},
            "principal": {"user_id": "alice", "runtime_id": "alice-runtime", "admin": False},
        },
    )
    _patch_gateway_session(
        monkeypatch,
        connection_route,
        principal={"user_id": "alice", "runtime_id": "alice-runtime", "source": "user-registry", "admin": False},
    )

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "alice",
                "gateway_token": "alice-token",
                "persist": False,
            },
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 200
    assert res.json()["token_source"] == "browser-session"
    assert res.json()["gateway"]["principal"]["user_id"] == "alice"
    assert "abstractflow_gateway_session=" in res.headers.get("set-cookie", "")
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_rejects_legacy_gateway_token_principal(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "auth": {"mode": "legacy-token", "user_auth_enabled": False},
            "principal": {
                "user_id": "admin",
                "runtime_id": "local-admin",
                "source": "legacy-token",
                "admin": True,
            },
        },
    )

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "admin",
                "gateway_token": "server-token",
                "persist": False,
            },
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 401
    assert "Only Gateway user tokens" in res.json()["detail"]
    assert "abstractflow_gateway_token=" not in res.headers.get("set-cookie", "")
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_requires_user(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": {"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False},
        },
    )
    _patch_gateway_session(monkeypatch, connection_route, principal={"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False})

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={"gateway_url": "http://127.0.0.1:8080", "gateway_token": "secret-token", "persist": False},
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 400
    assert "Gateway user is required" in res.json()["detail"]
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_rejects_wrong_user_principal(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": {"user_id": "bob", "tenant_id": "default", "source": "user-registry", "admin": False},
        },
    )

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "alice",
                "gateway_token": "bob-token",
                "persist": False,
            },
            headers={"X-Forwarded-Host": "flow.abstractframework.ai"},
        )

    assert res.status_code == 401
    assert "not 'alice'" in res.json()["detail"]
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_remote_host_cannot_change_gateway_url(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://127.0.0.1:8080")
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main

    with TestClient(main.app, base_url="http://flow.abstractframework.ai") as client:
        res = client.post(
            "/api/connection/gateway",
            json={"gateway_url": "http://evil.example", "gateway_token": "secret-token", "persist": False},
            headers={"X-Forwarded-Host": "127.0.0.1"},
        )

    assert res.status_code == 403
    assert "may not change the Gateway URL" in res.json()["detail"]
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_connection_browser_config_allows_loopback_host(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.delenv("ABSTRACTFLOW_ALLOW_REMOTE_BROWSER_GATEWAY_CONFIG", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    from fastapi.testclient import TestClient

    import backend.main as main
    import backend.routes.connection as connection_route

    monkeypatch.setattr(
        connection_route,
        "fetch_gateway_connection_check",
        lambda *, gateway_url, token: {
            "ok": True,
            "gateway_url": gateway_url,
            "auth_checked": bool(token),
            "principal": {"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False},
        },
    )
    _patch_gateway_session(monkeypatch, connection_route, principal={"user_id": "alice", "tenant_id": "default", "source": "user-registry", "admin": False})

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.post(
            "/api/connection/gateway",
            json={
                "gateway_url": "http://127.0.0.1:8080",
                "gateway_user_id": "alice",
                "gateway_token": "secret-token",
                "persist": False,
            },
        )

    assert res.status_code == 200
    assert res.json()["has_token"] is True
    assert res.json()["token_source"] == "browser-session"
    assert "session_id" not in res.json().get("gateway", {}).get("session", {})
    assert "csrf_token" not in res.json().get("gateway", {}).get("session", {})
    assert "agws_test.session" not in res.text
    assert "agcsrf_test" not in res.text
    assert "abstractflow_gateway_session=" in res.headers.get("set-cookie", "")
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") is None


def test_gateway_proxy_strips_browser_auth_and_cookie_headers(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))

    from fastapi.testclient import TestClient

    import backend.main as main

    captured = {}

    class _Response:
        status = 200
        headers = {"content-type": "application/json"}

        def __init__(self) -> None:
            self._sent = False

        def read(self, _n: int = -1) -> bytes:
            if self._sent:
                return b""
            self._sent = True
            return b'{"ok": true}'

        def close(self) -> None:
            return None

    def _urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["headers"] = dict(req.header_items())
        return _Response()

    monkeypatch.setattr(
        main,
        "resolve_effective_gateway_connection_for_request",
        lambda request: ("http://gateway.example", "session-token", "browser-session"),
    )
    monkeypatch.setattr(main, "urlopen", _urlopen)

    with TestClient(main.app, base_url="http://127.0.0.1:3003") as client:
        res = client.get(
            "/api/gateway/me",
            headers={
                "Authorization": "Bearer browser-token",
                "Cookie": "abstractflow_gateway_session=browser-cookie",
                "X-Forwarded-For": "203.0.113.10",
                "Accept": "application/json",
            },
        )

    assert res.status_code == 200
    headers = {k.lower(): v for k, v in captured["headers"].items()}
    assert captured["url"] == "http://gateway.example/api/gateway/me"
    assert headers["x-abstractgateway-session"] == "session-token"
    assert "authorization" not in headers
    assert "cookie" not in headers
    assert "x-forwarded-for" not in headers
    assert headers["accept"] == "application/json"
