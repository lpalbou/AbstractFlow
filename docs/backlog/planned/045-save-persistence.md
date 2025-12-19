# 045: Fix Save Failures and Add File Persistence

**Status**: Proposed (Backlog)
**Priority**: P1 - High
**Effort**: Medium (2-3 hours)
**Target Version**: 1.0.0

---

## Executive Summary

The visual editor's "Save" button always fails with a generic "Save failed: Failed to save flow" error. Additionally, flows are stored in an in-memory dictionary that is lost on server restart. This document covers:

1. **Investigation**: Debug why save always fails
2. **Fix**: Resolve the root cause
3. **Enhancement**: Add file-based persistence for durability

---

## Problem Statement

### Current Behavior

When clicking "Save" in the toolbar, user sees:
```
Save failed: Failed to save flow
```

This happens 100% of the time, regardless of flow content.

### Current Implementation

**Frontend (`Toolbar.tsx` lines 13-28):**
```typescript
const saveFlow = async (flow: VisualFlow): Promise<VisualFlow> => {
  const method = flow.id ? 'PUT' : 'POST';
  const url = flow.id ? `/api/flows/${flow.id}` : '/api/flows';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flow),
  });

  if (!response.ok) {
    throw new Error('Failed to save flow');  // Generic error
  }
  return response.json();
};
```

**Backend (`flows.py`):**
- In-memory storage: `_flows: Dict[str, VisualFlow] = {}`
- No file persistence
- Pydantic validation errors may not be returned properly

### Suspected Root Causes

1. **CORS issue**: Frontend on :5173, backend on :8080
2. **Pydantic validation failure**: Flow data doesn't match `FlowUpdateRequest` schema
3. **Missing flow ID**: New flows may not get IDs properly
4. **Request format mismatch**: Frontend sends full flow, backend expects partial

---

## Implementation

### Phase 1: Investigation (30 min)

1. **Add debug logging to backend:**
```python
@router.post("/api/flows")
async def create_flow(request: FlowCreateRequest):
    logger.info(f"Creating flow: {request}")
    # ...

@router.put("/api/flows/{flow_id}")
async def update_flow(flow_id: str, request: FlowUpdateRequest):
    logger.info(f"Updating flow {flow_id}: {request}")
    # ...
```

2. **Check browser console and network tab** for actual error response

3. **Test with curl** to isolate frontend vs backend issue:
```bash
curl -X POST http://localhost:8080/api/flows \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Flow"}'
```

### Phase 2: Fix Root Cause (1 hour)

Based on investigation, apply appropriate fix. Common fixes:

**If CORS issue:**
```python
# main.py - ensure CORS allows frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**If validation error - improve error handling:**
```python
from fastapi import HTTPException
from pydantic import ValidationError

@router.put("/api/flows/{flow_id}")
async def update_flow(flow_id: str, request: FlowUpdateRequest):
    try:
        # ... update logic
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
```

**If request format mismatch - adjust frontend:**
```typescript
// Send only what the endpoint expects
const payload = {
  name: flow.name,
  description: flow.description,
  nodes: flow.nodes,
  edges: flow.edges,
  entryNode: flow.entryNode,
};
```

### Phase 3: Add File Persistence (1 hour)

**Modify `flows.py`:**

```python
import json
from pathlib import Path
from datetime import datetime

FLOWS_DIR = Path("./flows")
FLOWS_DIR.mkdir(exist_ok=True)

def _load_flows() -> Dict[str, VisualFlow]:
    """Load all flows from disk."""
    flows = {}
    for path in FLOWS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text())
            flows[data["id"]] = VisualFlow(**data)
        except Exception as e:
            logger.warning(f"Failed to load flow from {path}: {e}")
    return flows

def _save_flow(flow: VisualFlow) -> None:
    """Persist a single flow to disk."""
    path = FLOWS_DIR / f"{flow.id}.json"
    path.write_text(flow.model_dump_json(indent=2))

# Initialize from disk on module load
_flows = _load_flows()

@router.post("/api/flows")
async def create_flow(request: FlowCreateRequest):
    flow = VisualFlow(
        id=str(uuid4()),
        name=request.name,
        description=request.description,
        nodes=[],
        edges=[],
        created_at=datetime.now().isoformat(),
        updated_at=datetime.now().isoformat(),
    )
    _flows[flow.id] = flow
    _save_flow(flow)  # Persist to disk
    return flow

@router.put("/api/flows/{flow_id}")
async def update_flow(flow_id: str, request: FlowUpdateRequest):
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail="Flow not found")

    flow = _flows[flow_id]
    # Apply updates
    if request.name is not None:
        flow.name = request.name
    if request.nodes is not None:
        flow.nodes = request.nodes
    # ... other fields

    flow.updated_at = datetime.now().isoformat()
    _flows[flow_id] = flow
    _save_flow(flow)  # Persist to disk
    return flow
```

### Phase 4: Improve Frontend Error Handling (30 min)

**Modify `Toolbar.tsx`:**

```typescript
const saveFlow = async (flow: VisualFlow): Promise<VisualFlow> => {
  const method = flow.id ? 'PUT' : 'POST';
  const url = flow.id ? `/api/flows/${flow.id}` : '/api/flows';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: flow.name,
      description: flow.description,
      nodes: flow.nodes,
      edges: flow.edges,
      entryNode: flow.entryNode,
    }),
  });

  if (!response.ok) {
    // Get detailed error from backend
    const error = await response.json().catch(() => ({}));
    const message = error.detail
      ? (Array.isArray(error.detail)
        ? error.detail.map((e: any) => e.msg).join(', ')
        : error.detail)
      : `HTTP ${response.status}`;
    throw new Error(`Save failed: ${message}`);
  }

  return response.json();
};
```

---

## Testing

### Manual Testing

1. Start backend with logging enabled
2. Open browser dev tools Network tab
3. Create a flow, add a node
4. Click Save
5. Verify:
   - No error shown
   - Network request returns 200
   - Flow appears in `./flows/` directory

### After Server Restart

1. Stop backend
2. Start backend again
3. Click "Load" or check flow list
4. Verify saved flows are still available

### Curl Tests

```bash
# Create flow
curl -X POST http://localhost:8080/api/flows \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "description": "Test flow"}'

# Update flow
curl -X PUT http://localhost:8080/api/flows/{flow_id} \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Test"}'

# List flows
curl http://localhost:8080/api/flows

# Check file exists
ls -la ./flows/
```

---

## Success Criteria

- [ ] Root cause of save failure identified
- [ ] Save button works without errors
- [ ] Flows persist to `./flows/` directory as JSON
- [ ] Flows survive server restart
- [ ] Error messages are specific (not generic "Failed")
- [ ] Validation errors displayed to user

---

## Files to Modify

| File | Change |
|------|--------|
| `web/backend/routes/flows.py` | File persistence, better error handling |
| `web/frontend/src/components/Toolbar.tsx` | Detailed error messages |
| `web/backend/main.py` | Verify CORS configuration |

---

## Notes

The investigation phase is critical - we need to understand WHY save fails before fixing it. The fix may be simpler than expected (e.g., CORS misconfiguration) or more complex (schema mismatch).
