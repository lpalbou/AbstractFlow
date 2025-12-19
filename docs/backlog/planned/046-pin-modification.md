# 046: Dynamic Pin/Input/Output Modification

**Status**: Proposed (Backlog)
**Priority**: P2 - Medium
**Effort**: Medium (3-4 hours)
**Target Version**: 1.0.0

---

## Executive Summary

Node inputs and outputs (pins) are currently defined by templates and cannot be modified after a node is created. Users should be able to add, remove, and rename data pins to customize nodes for their specific use cases.

**Key Benefits:**
- Users can create custom inputs/outputs for nodes
- More flexible workflow design
- Better support for variable-arity operations

**Constraints:**
- Execution pins (exec-in, exec-out) remain protected/non-removable
- Pin types must be from the 8 supported types

---

## Problem Statement

### Current State

**Node Templates (`types/nodes.ts`):**
```typescript
// Agent node has fixed inputs/outputs
{
  type: 'agent',
  inputs: [
    { id: 'exec-in', label: '', type: 'execution' },
    { id: 'task', label: 'task', type: 'string' },
    { id: 'context', label: 'context', type: 'object' },
  ],
  outputs: [
    { id: 'exec-out', label: '', type: 'execution' },
    { id: 'result', label: 'result', type: 'object' },
  ],
}
```

**PropertiesPanel.tsx:**
- Displays pins as read-only labels
- No UI to add/remove/edit pins

### Desired State

- PropertiesPanel shows editable list of pins
- "Add Input" / "Add Output" buttons
- Delete button for each data pin (not execution pins)
- Type dropdown for each pin
- Label text input for each pin

---

## Implementation

### Phase 1: Pin Editor UI Component (2 hours)

**Create `web/frontend/src/components/PinEditor.tsx`:**

```tsx
import { Pin, PinType, PIN_COLORS } from '../types/flow';

interface PinEditorProps {
  pins: Pin[];
  direction: 'input' | 'output';
  onUpdate: (pins: Pin[]) => void;
}

const PIN_TYPES: PinType[] = [
  'string', 'number', 'boolean', 'object', 'array', 'agent', 'any'
];

export function PinEditor({ pins, direction, onUpdate }: PinEditorProps) {
  const dataPins = pins.filter(p => p.type !== 'execution');
  const execPin = pins.find(p => p.type === 'execution');

  const handleAdd = () => {
    const newPin: Pin = {
      id: `${direction}-${Date.now()}`,
      label: `new_${direction}`,
      type: 'any',
    };
    // Keep execution pin first for inputs, last for outputs
    if (direction === 'input') {
      onUpdate([execPin, ...dataPins, newPin].filter(Boolean) as Pin[]);
    } else {
      onUpdate([...dataPins, newPin, execPin].filter(Boolean) as Pin[]);
    }
  };

  const handleRemove = (id: string) => {
    onUpdate(pins.filter(p => p.id !== id));
  };

  const handleLabelChange = (id: string, label: string) => {
    onUpdate(pins.map(p => p.id === id ? { ...p, label } : p));
  };

  const handleTypeChange = (id: string, type: PinType) => {
    onUpdate(pins.map(p => p.id === id ? { ...p, type } : p));
  };

  return (
    <div className="pin-editor">
      <div className="pin-editor-header">
        <span>{direction === 'input' ? 'Inputs' : 'Outputs'}</span>
        <button onClick={handleAdd} className="add-pin-btn">+</button>
      </div>

      {dataPins.map(pin => (
        <div key={pin.id} className="pin-row">
          <span
            className="pin-color"
            style={{ backgroundColor: PIN_COLORS[pin.type] }}
          />
          <input
            type="text"
            value={pin.label}
            onChange={(e) => handleLabelChange(pin.id, e.target.value)}
            className="pin-label-input"
          />
          <select
            value={pin.type}
            onChange={(e) => handleTypeChange(pin.id, e.target.value as PinType)}
            className="pin-type-select"
          >
            {PIN_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={() => handleRemove(pin.id)}
            className="remove-pin-btn"
          >
            ×
          </button>
        </div>
      ))}

      {dataPins.length === 0 && (
        <div className="no-pins">No data pins</div>
      )}
    </div>
  );
}
```

### Phase 2: Integrate into PropertiesPanel (1 hour)

**Modify `PropertiesPanel.tsx`:**

```tsx
import { PinEditor } from './PinEditor';

// In the agent node section:
{data.nodeType === 'agent' && (
  <>
    {/* Existing agent config... */}

    <div className="property-section">
      <PinEditor
        pins={data.inputs || []}
        direction="input"
        onUpdate={(pins) => updateNodeData(selectedNode, { inputs: pins })}
      />
    </div>

    <div className="property-section">
      <PinEditor
        pins={data.outputs || []}
        direction="output"
        onUpdate={(pins) => updateNodeData(selectedNode, { outputs: pins })}
      />
    </div>
  </>
)}
```

### Phase 3: Add Styles (30 min)

**Add to `web/frontend/src/styles/properties.css`:**

```css
.pin-editor {
  background: var(--bg-secondary);
  border-radius: 4px;
  padding: 8px;
  margin-top: 8px;
}

.pin-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
}

.add-pin-btn {
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.pin-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.pin-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pin-label-input {
  flex: 1;
  min-width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.pin-type-select {
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.remove-pin-btn {
  background: transparent;
  color: var(--text-secondary);
  border: none;
  cursor: pointer;
  font-size: 18px;
}

.remove-pin-btn:hover {
  color: #ff4444;
}

.no-pins {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 12px;
}
```

### Phase 4: Update Node Rendering (30 min)

**Ensure `BaseNode.tsx` handles dynamic pins:**

The BaseNode component already reads from `data.inputs` and `data.outputs`, so it should automatically reflect changes. Verify that:

1. New pins appear on the node
2. Pin colors match their types
3. Connections can be made to new pins
4. Connections are removed when pins are deleted

---

## Testing

### Manual Testing

1. Add an Agent node
2. Select it to open PropertiesPanel
3. Verify "Inputs" and "Outputs" sections show
4. Click "+" to add a new input
5. Change the label and type
6. Verify the pin appears on the node with correct color
7. Connect another node to the new pin
8. Delete the pin - verify connection is removed
9. Save and reload - verify pins persist

### Edge Cases

- Adding pins with duplicate labels
- Maximum number of pins (should handle gracefully)
- Deleting pin with active connection
- Execution pins should never be removable

---

## Success Criteria

- [ ] PinEditor component created
- [ ] Add/remove data pins works
- [ ] Pin label editing works
- [ ] Pin type selection works (with correct colors)
- [ ] Execution pins are protected (not editable/removable)
- [ ] Node visually updates when pins change
- [ ] Connections work with new pins
- [ ] Pins persist when flow is saved

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `web/frontend/src/components/PinEditor.tsx` | **NEW** - Pin editor component |
| `web/frontend/src/components/PropertiesPanel.tsx` | Integrate PinEditor |
| `web/frontend/src/styles/properties.css` | Pin editor styles |
| `web/frontend/src/components/nodes/BaseNode.tsx` | Verify dynamic pin support |

---

## Design Decisions

### Why Protect Execution Pins?

Execution pins control the flow of execution through the graph. Allowing users to remove them could create:
- Orphaned nodes (no way to trigger them)
- Broken flow control
- Confusing behavior

Following Unreal Blueprints pattern where execution pins are always present on applicable nodes.

### Why Not Support Custom Pin Types?

The 8 pin types (string, number, boolean, object, array, agent, any, execution) cover most use cases. Custom types would require:
- Custom validation logic
- Custom colors/shapes
- Schema management

This can be added later if needed, but the 8 types are sufficient for v1.0.
