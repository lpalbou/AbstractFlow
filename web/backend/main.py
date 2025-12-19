"""AbstractFlow Visual Editor - FastAPI Application."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .routes import flows_router, providers_router, ws_router

# Create FastAPI app
app = FastAPI(
    title="AbstractFlow Visual Editor",
    description="Blueprint-style visual workflow editor for AbstractFlow",
    version="0.1.0",
)

# Configure CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(flows_router, prefix="/api")
app.include_router(providers_router, prefix="/api")
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

    @app.get("/")
    async def serve_frontend():
        """Serve the frontend SPA."""
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/{path:path}")
    async def serve_frontend_fallback(path: str):
        """Fallback to index.html for SPA routing (excluding API routes)."""
        # API routes are handled by the routers above
        if path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API endpoint not found")
        file_path = FRONTEND_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "abstractflow.web.backend.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
    )
