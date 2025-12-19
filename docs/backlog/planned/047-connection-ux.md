# 047: Pin Connection UX Improvements

**Status**: Proposed (Backlog)
**Priority**: P3 - Low
**Effort**: Low (2 hours)
**Target Version**: 1.1.0

---

## Executive Summary

Users are confused about the visual language of pins (white triangles vs colored circles, what can connect to what). This document proposes UX improvements to make the connection system more discoverable and intuitive.

**Key Features:**
- Pin type legend showing all 8 types with colors and shapes
- Tooltips on pin hover showing type name
- Visual feedback during connection (highlight compatible pins)

---

## Problem Statement

### User Feedback

From user testing session:
> "I can link some nodes together, but this was random, I have no idea what the differences are between the white circles and the plain white triangle. I couldn't connect any of the input/output either. It's very confusing."

### Current State

The pin system uses a well-designed visual language:
- **Execution pins**: White triangles (▷) for flow control
- **Data pins**: Colored shapes for different types

But there's no documentation or discoverability within the UI. Users must guess or read source code to understand the system.

### Visual Language Reference

| Type | Color | Shape | Purpose |
|------|-------|-------|---------|
| execution | #FFFFFF (White) | ▷ Triangle | Flow control |
| string | #FF00FF (Magenta) | ○ Circle | Text data |
| number | #00FF00 (Green) | ○ Circle | Numeric data |
| boolean | #FF0000 (Red) | ◇ Diamond | True/False |
| object | #00FFFF (Cyan) | ○ Circle | JSON objects |
| array | #FF8800 (Orange) | □ Square | Collections |
| agent | #4488FF (Blue) | ⬡ Hexagon | Agent references |
| any | #888888 (Gray) | ○ Circle | Accepts any type |

---

## Implementation

### Phase 1: Pin Legend Component (1 hour)

**Create `web/frontend/src/components/PinLegend.tsx`:**

```tsx
import { useState } from 'react';
import { PinType, PIN_COLORS } from '../types/flow';

const PIN_INFO: Array<{
  type: PinType;
  label: string;
  shape: string;
  description: string;
}> = [
  { type: 'execution', label: 'Execution', shape: '▷', description: 'Controls flow order' },
  { type: 'string', label: 'String', shape: '○', description: 'Text data' },
  { type: 'number', label: 'Number', shape: '○', description: 'Integer or float' },
  { type: 'boolean', label: 'Boolean', shape: '◇', description: 'True/False' },
  { type: 'object', label: 'Object', shape: '○', description: 'JSON objects' },
  { type: 'array', label: 'Array', shape: '□', description: 'Collections' },
  { type: 'agent', label: 'Agent', shape: '⬡', description: 'Agent reference' },
  { type: 'any', label: 'Any', shape: '○', description: 'Accepts any type' },
];

export function PinLegend() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="pin-legend">
      <button
        className="pin-legend-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? '?' : '×'} Pin Types
      </button>

      {!collapsed && (
        <div className="pin-legend-content">
          {PIN_INFO.map(info => (
            <div key={info.type} className="pin-legend-row">
              <span
                className="pin-legend-shape"
                style={{ color: PIN_COLORS[info.type] }}
              >
                {info.shape}
              </span>
              <span className="pin-legend-label">{info.label}</span>
              <span className="pin-legend-desc">{info.description}</span>
            </div>
          ))}

          <div className="pin-legend-rules">
            <strong>Connection Rules:</strong>
            <ul>
              <li>Execution → Execution only</li>
              <li>"Any" accepts all types</li>
              <li>Number/Boolean → String (auto-convert)</li>
              <li>Array → Object (compatible)</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Add styles:**

```css
.pin-legend {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 100;
  background: var(--bg-secondary);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}

.pin-legend-toggle {
  padding: 8px 16px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
}

.pin-legend-content {
  padding: 16px;
  max-width: 300px;
}

.pin-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.pin-legend-shape {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.pin-legend-label {
  font-weight: 500;
  min-width: 60px;
}

.pin-legend-desc {
  color: var(--text-secondary);
  font-size: 12px;
}

.pin-legend-rules {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  font-size: 12px;
}

.pin-legend-rules ul {
  margin: 4px 0 0 16px;
  padding: 0;
}

.pin-legend-rules li {
  color: var(--text-secondary);
}
```

### Phase 2: Add to Canvas (15 min)

**Modify `Canvas.tsx`:**

```tsx
import { PinLegend } from './PinLegend';

// At the end of the Canvas component's return:
return (
  <div className="canvas-container">
    <ReactFlow ... />
    <PinLegend />
  </div>
);
```

### Phase 3: Pin Tooltips (30 min)

**Modify `BaseNode.tsx` to add tooltips:**

```tsx
// For each pin handle:
<Handle
  ...
  title={`${pin.label} (${pin.type})`}  // Native tooltip
/>
```

Or for richer tooltips, use a tooltip library or CSS:

```tsx
<div className="pin-container" data-tooltip={`${pin.type}: ${getTypeDescription(pin.type)}`}>
  <Handle ... />
  <span className="pin-label">{pin.label}</span>
</div>
```

### Phase 4: Connection Highlighting (Optional, 15 min)

**Enhance `Canvas.tsx` for visual feedback:**

React Flow provides `onConnectStart` and `onConnectEnd` events. Use these to highlight compatible pins:

```tsx
const [connectingFrom, setConnectingFrom] = useState<{
  nodeId: string;
  handleId: string;
  type: PinType;
} | null>(null);

const handleConnectStart = (event, { nodeId, handleId }) => {
  // Find the pin type
  const node = nodes.find(n => n.id === nodeId);
  const pin = [...(node?.data.inputs || []), ...(node?.data.outputs || [])]
    .find(p => p.id === handleId);
  if (pin) {
    setConnectingFrom({ nodeId, handleId, type: pin.type });
  }
};

const handleConnectEnd = () => {
  setConnectingFrom(null);
};

// Pass to ReactFlow:
<ReactFlow
  onConnectStart={handleConnectStart}
  onConnectEnd={handleConnectEnd}
  ...
/>
```

Then in `BaseNode.tsx`, apply a class to highlight compatible pins:

```tsx
const isCompatible = connectingFrom &&
  areTypesCompatible(connectingFrom.type, pin.type);

<Handle
  className={isCompatible ? 'pin-compatible' : ''}
  ...
/>
```

---

## Testing

### Manual Testing

1. Open visual editor
2. Look for "? Pin Types" button in bottom-left
3. Click to expand legend
4. Verify all 8 types listed with correct colors
5. Hover over pins to see tooltips
6. Start dragging a connection - verify compatible pins highlight (if implemented)

### Accessibility

- Legend should be keyboard accessible
- Tooltips should have sufficient contrast
- Colors should not be the only differentiator (shapes matter)

---

## Success Criteria

- [ ] Pin legend component visible in canvas
- [ ] Legend collapsible/expandable
- [ ] All 8 pin types documented with colors and descriptions
- [ ] Connection rules explained
- [ ] Tooltips show pin type on hover
- [ ] (Optional) Compatible pins highlight during connection

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `web/frontend/src/components/PinLegend.tsx` | **NEW** - Legend component |
| `web/frontend/src/components/Canvas.tsx` | Include PinLegend |
| `web/frontend/src/components/nodes/BaseNode.tsx` | Add tooltips |
| `web/frontend/src/styles/canvas.css` | Legend and tooltip styles |

---

## Future Enhancements

- Animated connection preview showing data type flow
- Keyboard shortcut to toggle legend (e.g., `?`)
- Color-blind friendly mode with patterns
- Interactive tutorial for first-time users
