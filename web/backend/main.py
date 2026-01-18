"""AbstractFlow Visual Editor - FastAPI Application."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse

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
from .services.gateway_connection import bootstrap_gateway_connection_env

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
        "abstractflow.web.backend.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
