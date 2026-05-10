from __future__ import annotations

import os

from abstractflow.visual.executor import _resolve_gateway_auth_token


def test_resolve_gateway_auth_token_prefers_canonical_env(monkeypatch) -> None:
    monkeypatch.delenv("ABSTRACTGATEWAY_AUTH_TOKEN", raising=False)

    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "gateway-token")

    assert _resolve_gateway_auth_token() == "gateway-token"


def test_resolve_gateway_auth_token_returns_none_when_missing(monkeypatch) -> None:
    for k in list(os.environ.keys()):
        if k.startswith("ABSTRACT") and "TOKEN" in k:
            monkeypatch.delenv(k, raising=False)
    assert _resolve_gateway_auth_token() is None
