/**
 * Pin type legend component for the visual editor.
 * Shows all pin types with their colors, shapes, and descriptions.
 */

import { useState } from 'react';
import type { PinType } from '../types/flow';
import { PIN_COLORS } from '../types/flow';

interface PinInfo {
  type: PinType;
  label: string;
  shape: string;
  description: string;
}

const PIN_INFO: PinInfo[] = [
  { type: 'execution', label: 'Execution', shape: '\u25B7', description: 'Controls flow order' },
  { type: 'string', label: 'String', shape: '\u25CF', description: 'Text data' },
  { type: 'number', label: 'Number', shape: '\u25CF', description: 'Integer or float' },
  { type: 'boolean', label: 'Boolean', shape: '\u25C7', description: 'True/False' },
  { type: 'object', label: 'Object', shape: '\u25CF', description: 'JSON objects' },
  { type: 'array', label: 'Array', shape: '\u25A0', description: 'Collections' },
  { type: 'provider', label: 'Provider', shape: '\u25CF', description: 'LLM provider id/name (string-like)' },
  { type: 'model', label: 'Model', shape: '\u25CF', description: 'LLM model id/name (string-like)' },
  { type: 'agent', label: 'Agent', shape: '\u2B22', description: 'Agent reference' },
  { type: 'any', label: 'Any', shape: '\u25CF', description: 'Accepts any type' },
];

export function PinLegend() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="pin-legend">
      <button
        className="pin-legend-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title="Pin Type Legend"
      >
        {collapsed ? '?' : '\u00D7'} Pin Types
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
              <li>Execution connects to Execution only</li>
              <li>"Any" type accepts all data types</li>
              <li>Same types always compatible</li>
              <li>Array and Object are interchangeable</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default PinLegend;
