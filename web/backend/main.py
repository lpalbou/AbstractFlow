"""AbstractFlow Visual Editor - FastAPI Application."""

from __future__ import annotations

import os
import logging
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request as UrlRequest, urlopen

from abstractflow.gateway_options import local_runtime_enabled, require_gateway_connectivity
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse

from .routes.connection import router as connection_router
from .routes.gateway_metrics import router as gateway_metrics_router
from .routes.ui_config import router as ui_config_router
from .services.gateway_connection import bootstrap_gateway_connection_env, resolve_effective_gateway_connection

# Best-effort bootstrap so the backend can call the gateway without requiring a restart after UI config.
bootstrap_gateway_connection_env()


# Create FastAPI app
app = FastAPI(
    title="AbstractFlow Visual Editor",
    description="Blueprint-style visual workflow editor for AbstractFlow",
    version="0.1.0",
)

# Configure CORS for development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(gateway_metrics_router, prefix="/api")
app.include_router(connection_router, prefix="/api")
app.include_router(ui_config_router, prefix="/api")

if local_runtime_enabled():
    from .routes.flows import router as flows_router
    from .routes.providers import router as providers_router
    from .routes.runs import router as runs_router
    from .routes.semantics import router as semantics_router
    from .routes.memory_kg import router as memory_kg_router
    from .routes.tools import router as tools_router
    from .routes.ws import router as ws_router

    app.include_router(flows_router, prefix="/api")
    app.include_router(providers_router, prefix="/api")
    app.include_router(runs_router, prefix="/api")
    app.include_router(semantics_router, prefix="/api")
    app.include_router(memory_kg_router, prefix="/api")
    app.include_router(tools_router, prefix="/api")
    app.include_router(ws_router, prefix="/api")


def _runtime_mode() -> str:
    return "gateway-only" if not local_runtime_enabled() else "gateway+local-compat"


def local_runtime_routes_enabled() -> bool:
    """Backward-compatible alias for existing checks/tests."""
    return local_runtime_enabled()

def _runtime_health() -> dict[str, object]:
    local_enabled = local_runtime_enabled()
    gateway_url, gateway_token, token_source = resolve_effective_gateway_connection()
    return {
        "runtime_mode": _runtime_mode(),
        "local_runtime_enabled": local_enabled,
        "gateway_url": gateway_url,
        "gateway_token_configured": bool(gateway_token),
        "gateway_token_source": token_source,
    }

@app.on_event("startup")
async def _startup_connectivity_guard() -> None:
    if local_runtime_enabled():
        logging.getLogger(__name__).warning(
            "ABSTRACTFLOW_ENABLE_LOCAL_RUNTIME is enabled. Local runtime compatibility routes are active; "
            "this is a transitional mode and should be avoided for thin-client deployments."
        )
        return

    try:
        gateway_url, gateway_token, _ = resolve_effective_gateway_connection()
        require_gateway_connectivity(gateway_url=gateway_url, gateway_token=gateway_token, timeout_s=4.0)
        logging.getLogger(__name__).info(
            "Connected to AbstractGateway at %s",
            gateway_url,
        )
    except ValueError as e:
        raise RuntimeError(
            "AbstractFlow is running in Gateway-only mode and could not complete the startup check. "
            "Set ABSTRACTGATEWAY_URL (or ABSTRACTFLOW_GATEWAY_URL) and ABSTRACTGATEWAY_AUTH_TOKEN, and verify the Gateway is reachable. "
            f"Connectivity check failed: {e}"
        ) from e


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    runtime = _runtime_health()
    status = "healthy"
    if not runtime["local_runtime_enabled"] and not runtime["gateway_token_configured"]:
        status = "error"
    return {"status": status, "service": "abstractflow-visual-editor", **runtime}


_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _gateway_proxy_response_headers(headers: object) -> dict[str, str]:
    out: dict[str, str] = {}
    items = getattr(headers, "items", lambda: [])()
    for key, value in items:
        k = str(key).lower()
        if k in _HOP_BY_HOP_HEADERS or k == "content-length":
            continue
        out[str(key)] = str(value)
    return out


def _gateway_proxy_request_headers(request: Request, token: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in request.headers.items():
        k = key.lower()
        if k in _HOP_BY_HOP_HEADERS or k in {"host", "content-length"}:
            continue
        out[key] = value
    if token and not any(k.lower() == "authorization" for k in out):
        out["Authorization"] = f"Bearer {token}"
    return out


@app.api_route("/api/gateway/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_gateway_api(path: str, request: Request):
    """Proxy Gateway API calls and inject server-held auth for the browser UI."""
    gateway_url, token, _source = resolve_effective_gateway_connection()
    base = str(gateway_url or "").strip().rstrip("/")
    safe_path = "/".join(quote(part, safe="") for part in str(path or "").split("/"))
    target = f"{base}/api/gateway/{safe_path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()
    data = body if body and request.method.upper() not in {"GET", "HEAD"} else None
    req = UrlRequest(
        url=target,
        data=data,
        method=request.method.upper(),
        headers=_gateway_proxy_request_headers(request, token),
    )

    try:
        resp = urlopen(req)
    except HTTPError as e:
        detail = e.read()
        return Response(
            content=detail,
            status_code=int(e.code),
            headers=_gateway_proxy_response_headers(e.headers),
            media_type=e.headers.get("content-type") if e.headers else None,
        )
    except URLError as e:
        return Response(
            content=f'{{"detail":"Gateway not reachable at {base}: {e}"}}',
            status_code=502,
            media_type="application/json",
        )

    def _iter_response():
        try:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                resp.close()
            except Exception:
                pass

    return StreamingResponse(
        _iter_response(),
        status_code=int(getattr(resp, "status", 200) or 200),
        headers=_gateway_proxy_response_headers(getattr(resp, "headers", {})),
        media_type=getattr(resp, "headers", {}).get("content-type") if getattr(resp, "headers", None) else None,
    )


# Serve static frontend files (in production)
# IMPORTANT: These routes must be defined AFTER all /api/* routes
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

    def _monitor_gpu_enabled() -> bool:
        raw = str(os.getenv("ABSTRACTFLOW_MONITOR_GPU") or os.getenv("ABSTRACT_MONITOR_GPU") or "").strip().lower()
        return raw in {"1", "true", "yes", "on"}

    def _inject_ui_config(html: str) -> str:
        if "window.__ABSTRACT_UI_CONFIG__" in html:
            return html
        snippet = (
            "<script>"
            "window.__ABSTRACT_UI_CONFIG__=Object.assign(window.__ABSTRACT_UI_CONFIG__||{}, { monitor_gpu: true });"
            "</script>"
        )
        if "</head>" in html:
            return html.replace("</head>", f"{snippet}\n</head>")
        if "</body>" in html:
            return html.replace("</body>", f"{snippet}\n</body>")
        return f"{html}\n{snippet}\n"

    def _serve_index():
        index_path = FRONTEND_DIR / "index.html"
        if not _monitor_gpu_enabled():
            return FileResponse(index_path)
        html = index_path.read_text(encoding="utf-8")
        return HTMLResponse(content=_inject_ui_config(html))

    @app.get("/")
    async def serve_frontend():
        """Serve the frontend SPA."""
        return _serve_index()

    @app.get("/{path:path}")
    async def serve_frontend_fallback(path: str):
        """Fallback to index.html for SPA routing (excluding API routes)."""
        # API routes are handled by the routers above
        if path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = FRONTEND_DIR / path
        if file_path.exists() and file_path.is_file():
            if file_path.name == "index.html":
                return _serve_index()
            return FileResponse(file_path)
        return _serve_index()


if __name__ == "__main__":
    import uvicorn
    import sys

    if "--monitor-gpu" in sys.argv:
        os.environ["ABSTRACTFLOW_MONITOR_GPU"] = "1"

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
