from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient


_WEB_ROOT = Path(__file__).resolve().parents[1] / "web"
sys.path.insert(0, str(_WEB_ROOT))


class _FakeGatewayResponse:
    status = 200
    headers = {"content-type": "application/json"}

    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")
        self._sent = False

    def read(self, _size: int = -1) -> bytes:
        if self._sent:
            return b""
        self._sent = True
        return self._body

    def close(self) -> None:
        pass


def test_python_web_gateway_proxy_injects_gateway_auth(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ABSTRACTFLOW_RUNTIME_DIR", str(tmp_path))
    monkeypatch.setenv("ABSTRACTGATEWAY_URL", "http://gateway.local:8080")
    monkeypatch.setenv("ABSTRACTGATEWAY_AUTH_TOKEN", "secret-token")

    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["authorization"] = req.headers.get("Authorization")
        captured["timeout"] = timeout
        return _FakeGatewayResponse({"ok": True})

    import backend.main as main

    monkeypatch.setattr(main, "urlopen", fake_urlopen)

    with TestClient(main.app) as client:
        res = client.get("/api/gateway/discovery/capabilities")

    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert captured["url"] == "http://gateway.local:8080/api/gateway/discovery/capabilities"
    assert captured["authorization"] == "Bearer secret-token"
