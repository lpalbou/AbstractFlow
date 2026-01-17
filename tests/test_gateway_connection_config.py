from __future__ import annotations

import os
import sys
from pathlib import Path


# Backend lives under `abstractflow/web/backend` (dev package). Add `abstractflow/web` to sys.path for tests.
_WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
sys.path.insert(0, str(_WEB_ROOT))


def test_gateway_connection_persistence_and_bootstrap(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))

    # Ensure a clean env baseline (the module reads env).
    for k in [
        "ABSTRACTFLOW_GATEWAY_URL",
        "ABSTRACTGATEWAY_URL",
        "ABSTRACTGATEWAY_AUTH_TOKEN",
        "ABSTRACTFLOW_GATEWAY_AUTH_TOKEN",
        "ABSTRACTCODE_GATEWAY_TOKEN",
        "ABSTRACTGATEWAY_AUTH_TOKENS",
        "ABSTRACTFLOW_GATEWAY_AUTH_TOKENS",
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
    assert persisted.get("gateway_token") == "dev-token"

    # Env should be populated from persisted config.
    bootstrap_gateway_connection_env()
    assert os.getenv("ABSTRACTFLOW_GATEWAY_URL") == "http://127.0.0.1:8081"
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") == "dev-token"


def test_gateway_connection_bootstrap_does_not_override_explicit_env(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))

    from backend.services.gateway_connection import bootstrap_gateway_connection_env, save_persisted_gateway_connection

    save_persisted_gateway_connection(gateway_url="http://127.0.0.1:8081", gateway_token="persisted-token")

    monkeypatch.setenv("ABSTRACTFLOW_GATEWAY_URL", "http://example.invalid:8081")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "env-token")

    bootstrap_gateway_connection_env()
    assert os.getenv("ABSTRACTFLOW_GATEWAY_URL") == "http://example.invalid:8081"
    assert os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN") == "env-token"
