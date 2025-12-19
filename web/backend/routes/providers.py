"""Provider discovery endpoints for the visual editor.

Uses AbstractCore's provider registry to list available providers
and their models dynamically.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["providers"])


@router.get("/providers")
async def list_providers(include_models: bool = False) -> List[Dict[str, Any]]:
    """
    List available providers with their models.

    Query params:
        include_models: If true, include model lists (slower, default False)

    Returns only providers that are currently available
    (have running servers or valid API keys).
    """
    try:
        from abstractcore.providers.registry import get_all_providers_with_models
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="AbstractCore not installed. Run: pip install abstractcore"
        )

    try:
        providers = get_all_providers_with_models(include_models=include_models)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to query providers: {str(e)}"
        )

    # Filter to only available providers
    # Convert model_count to number (may be 'unknown' string from AbstractCore)
    available = []
    for p in providers:
        if p.get("status") == "available":
            # Ensure model_count is always a number, not "unknown" string
            model_count = p.get("model_count")
            if not isinstance(model_count, int):
                model_count = 0
            available.append({
                **p,
                "model_count": model_count
            })

    return available


@router.get("/providers/{provider}/models")
async def list_models(provider: str) -> List[str]:
    """
    Get available models for a specific provider.

    Args:
        provider: Provider name (e.g., "ollama", "openai")

    Returns:
        List of model names
    """
    try:
        from abstractcore.providers.registry import get_available_models_for_provider
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="AbstractCore not installed. Run: pip install abstractcore"
        )

    try:
        models = get_available_models_for_provider(provider)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to query models for {provider}: {str(e)}"
        )

    return models
