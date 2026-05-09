"""AbstractFlow Visual Editor - FastAPI Application."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse

from .routes import (
    connection_router,
    flows_router,
    gateway_metrics_router,
    memory_kg_router,
    providers_router,
    runs_router,
    semantics_router,
    tools_router,
    ui_config_router,
    ws_router,
)
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

# Include routers
app.include_router(flows_router, prefix="/api")
app.include_router(gateway_metrics_router, prefix="/api")
app.include_router(connection_router, prefix="/api")
app.include_router(providers_router, prefix="/api")
app.include_router(runs_router, prefix="/api")
app.include_router(semantics_router, prefix="/api")
app.include_router(memory_kg_router, prefix="/api")
app.include_router(tools_router, prefix="/api")
app.include_router(ui_config_router, prefix="/api")
app.include_router(ws_router, prefix="/api")

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "abstractflow-visual-editor"}


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
