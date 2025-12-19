/**
 * Pin editor component for adding/removing/editing node inputs/outputs.
 */

import type { Pin, PinType } from '../types/flow';
import { PIN_COLORS } from '../types/flow';

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
        <button onClick={handleAdd} className="add-pin-btn" title="Add pin">+</button>
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
            placeholder="Pin name"
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
            title="Remove pin"
          >
            x
          </button>
        </div>
      ))}

      {dataPins.length === 0 && (
        <div className="no-pins">No data pins</div>
      )}
    </div>
  );
}

export default PinEditor;
