# 044: Provider/Model Discovery for Visual Editor

**Status**: Proposed (Backlog)
**Priority**: P1 - High
**Effort**: Medium (3-5 hours)
**Target Version**: 1.0.0

---

## Executive Summary

The AbstractFlow visual editor currently has hardcoded provider options (Ollama, OpenAI, Anthropic) and a free-text model input field. Neither are functional - they lack onChange handlers and don't save to node data. This needs to be replaced with dynamic dropdowns that query AbstractCore's provider registry for available providers and their models.

**Key Benefits:**
- Shows only available providers (with running servers/models)
- Model dropdown populated dynamically based on selected provider
- Proper state management with values saved to node data
- Leverages AbstractCore's existing `get_all_providers_with_models()` API

---

## Problem Statement

### Current State

**PropertiesPanel.tsx (lines 156-174)**:
```tsx
// HARDCODED - Only 3 providers
<select className="property-select">
  <option value="ollama">Ollama</option>
  <option value="openai">OpenAI</option>
  <option value="anthropic">Anthropic</option>
</select>

// FREE TEXT - No validation, no onChange
<input
  type="text"
  className="property-input"
  placeholder="e.g., qwen3:4b"
/>
```

**Issues:**
1. Only shows 3 providers (AbstractCore has 8)
2. No onChange handlers - values never saved
3. Free text model input - no validation
4. Doesn't respect environment variables (`OLLAMA_BASE_URL`, etc.)
5. Shows unavailable providers (e.g., Anthropic without API key)

### Desired State

- Dynamic provider dropdown showing only available providers
- Model dropdown populated when provider selected
- Values persisted to `node.data.agentConfig`
- Real-time updates when providers/models change

---

## Implementation

### Phase 1: Backend API (1-2 hours)

**Create `web/backend/routes/providers.py`:**

```python
"""Provider discovery endpoints for the visual editor."""

from fastapi import APIRouter
from typing import List, Dict, Any

router = APIRouter(prefix="/api", tags=["providers"])

@router.get("/providers")
async def list_providers(include_models: bool = False) -> List[Dict[str, Any]]:
    """
    List available providers with their models.

    Query params:
        include_models: If true, include model lists (slower)

    Returns only providers that are currently available
    (have running servers or valid API keys).
    """
    from abstractcore.providers.registry import get_all_providers_with_models

    providers = get_all_providers_with_models(include_models=include_models)

    # Filter to only available providers
    return [
        p for p in providers
        if p.get("status") == "available" and p.get("model_count", 0) > 0
    ]

@router.get("/providers/{provider}/models")
async def list_models(provider: str) -> List[str]:
    """
    Get available models for a specific provider.

    Args:
        provider: Provider name (e.g., "ollama", "openai")

    Returns:
        List of model names
    """
    from abstractcore.providers.registry import get_available_models_for_provider

    return get_available_models_for_provider(provider)
```

**Modify `web/backend/main.py`:**

```python
from .routes import providers

app.include_router(providers.router)
```

### Phase 2: Frontend Integration (2-3 hours)

**Modify `web/frontend/src/components/PropertiesPanel.tsx`:**

1. Add state for providers and models:
```tsx
const [providers, setProviders] = useState<ProviderInfo[]>([]);
const [models, setModels] = useState<string[]>([]);
const [loading, setLoading] = useState(false);
```

2. Fetch providers on mount:
```tsx
useEffect(() => {
  fetch('/api/providers')
    .then(res => res.json())
    .then(setProviders)
    .catch(console.error);
}, []);
```

3. Fetch models when provider changes:
```tsx
useEffect(() => {
  const provider = data.agentConfig?.provider;
  if (provider) {
    setLoading(true);
    fetch(`/api/providers/${provider}/models`)
      .then(res => res.json())
      .then(setModels)
      .finally(() => setLoading(false));
  }
}, [data.agentConfig?.provider]);
```

4. Replace dropdowns with dynamic versions:
```tsx
<select
  value={data.agentConfig?.provider || ''}
  onChange={(e) => {
    updateNodeData(selectedNode, {
      agentConfig: {
        ...data.agentConfig,
        provider: e.target.value,
        model: '' // Reset model when provider changes
      }
    });
  }}
>
  <option value="">Select provider...</option>
  {providers.map(p => (
    <option key={p.name} value={p.name}>
      {p.display_name} ({p.model_count} models)
    </option>
  ))}
</select>

<select
  value={data.agentConfig?.model || ''}
  onChange={(e) => {
    updateNodeData(selectedNode, {
      agentConfig: { ...data.agentConfig, model: e.target.value }
    });
  }}
  disabled={!data.agentConfig?.provider || loading}
>
  <option value="">
    {loading ? 'Loading...' : 'Select model...'}
  </option>
  {models.map(m => (
    <option key={m} value={m}>{m}</option>
  ))}
</select>
```

---

## Testing

### Backend Tests

```python
# tests/test_providers_api.py

def test_list_providers():
    """Test /api/providers returns available providers."""
    response = client.get("/api/providers")
    assert response.status_code == 200
    providers = response.json()
    # Should have at least one available provider (Ollama if running)
    for p in providers:
        assert "name" in p
        assert "display_name" in p
        assert p["status"] == "available"

def test_list_models():
    """Test /api/providers/{provider}/models returns models."""
    response = client.get("/api/providers/ollama/models")
    assert response.status_code == 200
    models = response.json()
    assert isinstance(models, list)
```

### Manual Testing

1. Start backend: `PYTHONPATH=web:../abstractruntime/src:../abstractcore uvicorn backend.main:app --port 8080`
2. Start frontend: `cd web/frontend && npm run dev`
3. Open http://localhost:5173
4. Add an Agent node to canvas
5. Select node and verify:
   - Provider dropdown shows available providers
   - Selecting provider loads models
   - Model dropdown populates correctly
   - Values persist when selecting different nodes

---

## Success Criteria

- [ ] `/api/providers` endpoint returns available providers
- [ ] `/api/providers/{provider}/models` endpoint returns models
- [ ] Provider dropdown populated dynamically
- [ ] Model dropdown populated on provider selection
- [ ] Values saved to `node.data.agentConfig`
- [ ] Loading state shown while fetching models
- [ ] Only available providers shown (not all 8)

---

## Files to Modify

| File | Change |
|------|--------|
| `web/backend/routes/providers.py` | **NEW** - Provider discovery endpoints |
| `web/backend/main.py` | Include provider router |
| `web/frontend/src/components/PropertiesPanel.tsx` | Dynamic dropdowns |
| `web/frontend/src/types/flow.ts` | ProviderInfo type (if needed) |

---

## Dependencies

- AbstractCore must be installed with provider registry (`abstractcore.providers.registry`)
- At least one provider must be available (e.g., Ollama running locally)
