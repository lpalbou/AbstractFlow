from __future__ import annotations

import pytest

from abstractflow.gateway_options import require_gateway_connection, resolve_gateway_token, resolve_gateway_url


def test_resolve_gateway_url_defaults_to_local_gateway(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_URL", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_URL", raising=False)

    assert resolve_gateway_url() == "http://127.0.0.1:8080"


def test_resolve_gateway_token_prefers_canonical_env(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", "legacy-token")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "canonical-token")

    assert resolve_gateway_token() == "canonical-token"


def test_require_gateway_connection_requires_token(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTCODE_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKENS", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKENS", raising=False)

    with pytest.raises(ValueError, match="ABSTRACTGATEWAY_AUTH_TOKEN"):
        require_gateway_connection()
