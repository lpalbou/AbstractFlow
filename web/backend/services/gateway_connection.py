"""Gateway connection configuration for AbstractFlow Web.

AbstractFlow's memory KG uses gateway-managed embeddings (via /api/gateway/embeddings).
When gateway security is enabled, the AbstractFlow backend must hold a Bearer token
to call those endpoints.

This module provides:
- a small persisted config (runtime dir)
- env bootstrapping for the running process
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_runtime_dir() -> Path:
    # Keep consistent with backend/services/runtime_stores.py.
    return Path(__file__).resolve().parents[2] / "runtime"


def _runtime_dir() -> Path:
    base = os.getenv("ABSTRACTFLOW_RUNTIME_DIR") or ""
    p = Path(str(base)).expanduser() if str(base).strip() else _default_runtime_dir()
    p = p.resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


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
    raw = os.getenv("ABSTRACTFLOW_GATEWAY_URL") or os.getenv("ABSTRACTGATEWAY_URL") or ""
    url = str(raw or "").strip().rstrip("/")
    return url if url else None


def resolve_gateway_token_from_env() -> Optional[str]:
    raw = (
        os.getenv("ABSTRACTGATEWAY_AUTH_TOKEN")
        or os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKEN")
        or os.getenv("ABSTRACTCODE_GATEWAY_TOKEN")
        or ""
    )
    token = str(raw or "").strip()
    if token:
        return token

    raw_list = os.getenv("ABSTRACTGATEWAY_AUTH_TOKENS") or os.getenv("ABSTRACTFLOW_GATEWAY_AUTH_TOKENS") or ""
    if isinstance(raw_list, str) and raw_list.strip():
        first = raw_list.split(",", 1)[0].strip()
        if first:
            return first
    return None


def load_persisted_gateway_connection() -> Dict[str, Any]:
    return _read_json(_config_path())


def save_persisted_gateway_connection(
    *,
    gateway_url: Optional[str],
    gateway_token: Optional[str],
) -> Dict[str, Any]:
    url = str(gateway_url or "").strip().rstrip("/")
    token = str(gateway_token or "").strip()
    payload: Dict[str, Any] = {
        "version": 1,
        "updated_at": _utc_now_iso(),
    }
    if url:
        payload["gateway_url"] = url
    if token:
        payload["gateway_token"] = token
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
    token = str(gateway_token or "").strip()

    if url:
        os.environ["ABSTRACTFLOW_GATEWAY_URL"] = url
        # Keep canonical env var too (some callers read it).
        os.environ.setdefault("ABSTRACTGATEWAY_URL", url)
    if token:
        os.environ["ABSTRACTGATEWAY_AUTH_TOKEN"] = token
        os.environ["ABSTRACTFLOW_GATEWAY_AUTH_TOKEN"] = token


def bootstrap_gateway_connection_env() -> None:
    """Load persisted gateway settings into env if env is not already set."""
    if resolve_gateway_url_from_env() and resolve_gateway_token_from_env():
        return

    data = load_persisted_gateway_connection()
    url = data.get("gateway_url") if isinstance(data.get("gateway_url"), str) else None
    token = data.get("gateway_token") if isinstance(data.get("gateway_token"), str) else None
    apply_gateway_connection_to_env(gateway_url=url, gateway_token=token)


def resolve_effective_gateway_connection() -> Tuple[str, Optional[str], str]:
    """Return (gateway_url, token, token_source)."""
    url = resolve_gateway_url_from_env()
    token = resolve_gateway_token_from_env()
    if token is not None:
        return (url or "http://127.0.0.1:8081", token, "env")

    data = load_persisted_gateway_connection()
    url2 = url or (data.get("gateway_url") if isinstance(data.get("gateway_url"), str) else None) or "http://127.0.0.1:8081"
    token2 = data.get("gateway_token") if isinstance(data.get("gateway_token"), str) else None
    return (str(url2).strip().rstrip("/"), token2.strip() if isinstance(token2, str) and token2.strip() else None, "config" if token2 else "none")


def fetch_gateway_embeddings_config(*, gateway_url: str, token: Optional[str], timeout_s: float = 4.0) -> Dict[str, Any]:
    base = str(gateway_url or "").strip().rstrip("/")
    url = f"{base}/api/gateway/embeddings/config"

    headers = {"Content-Type": "application/json"}
    if isinstance(token, str) and token.strip():
        headers["Authorization"] = f"Bearer {token.strip()}"

    req = Request(url=url, method="GET", headers=headers)
    try:
        with urlopen(req, timeout=float(timeout_s)) as resp:
            raw = resp.read().decode("utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {"ok": False, "error": "Invalid response"}
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

