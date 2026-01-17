from __future__ import annotations

import os

from abstractflow.visual.executor import _resolve_gateway_auth_token


def test_resolve_gateway_auth_token_prefers_canonical_env(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTCODE_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKENS", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKENS", raising=False)

    monkeypatch.setenv("ABSTRACTCODE_GATEWAY_TOKEN", "code-token")
    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", "flow-token")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "gateway-token")

    assert _resolve_gateway_auth_token() == "gateway-token"


def test_resolve_gateway_auth_token_falls_back_to_token_list(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTCODE_GATEWAY_TOKEN", raising=False)
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKENS", raising=False)
    monkeypatch.delenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKENS", raising=False)

    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKENS", "t1, t2, t3")
    assert _resolve_gateway_auth_token() == "t1"


def test_resolve_gateway_auth_token_returns_none_when_missing(monkeypatch) -> None:
    for k in list(os.environ.keys()):
        if k.startswith("ABSTRACT") and "TOKEN" in k:
            monkeypatch.delenv(k, raising=False)
    assert _resolve_gateway_auth_token() is None

