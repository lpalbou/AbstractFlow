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
  { type: 'json_schema', label: 'JSON Schema', shape: '\u25CF', description: 'JSON Schema object' },
  { type: 'artifact', label: 'Artifact', shape: '\u25CF', description: 'Generic Gateway artifact reference' },
  { type: 'artifact_image', label: 'Image Artifact', shape: '\u25CF', description: 'Image artifact reference' },
  { type: 'artifact_audio', label: 'Audio Artifact', shape: '\u25CF', description: 'Audio, voice, or music artifact reference' },
  { type: 'artifact_text', label: 'Text Artifact', shape: '\u25CF', description: 'Text or transcript artifact reference' },
  { type: 'artifact_video', label: 'Video Artifact', shape: '\u25CF', description: 'Video artifact reference' },
  { type: 'assertion', label: 'Assertion', shape: '\u25CF', description: 'KG assertion object' },
  { type: 'assertions', label: 'Assertions', shape: '\u25A0', description: 'KG assertions list (assertion[])' },
  { type: 'array', label: 'Array', shape: '\u25A0', description: 'Collections' },
  { type: 'tools', label: 'Tools', shape: '\u25A0', description: 'Tool allowlist (string[])' },
  { type: 'provider_text', label: 'Text Provider', shape: '\u25CF', description: 'Text/LLM provider id/name' },
  { type: 'provider_image', label: 'Image Provider', shape: '\u25CF', description: 'Image-generation provider id' },
  { type: 'provider_voice', label: 'Voice Provider', shape: '\u25CF', description: 'Voice/TTS/STT provider id' },
  { type: 'provider_music', label: 'Music Provider', shape: '\u25CF', description: 'Music-generation provider id' },
  { type: 'provider', label: 'Provider (legacy)', shape: '\u25CF', description: 'Legacy unscoped provider id/name' },
  { type: 'model', label: 'Model', shape: '\u25CF', description: 'Model id/name scoped by the selected provider' },
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
              <li>Assertion is compatible with Object</li>
              <li>"Tools" is compatible with Array (specialized string[])</li>
              <li>"Assertions" is compatible with Array (specialized assertion[])</li>
              <li>Providers are modality-scoped; model pins stay generic and are scoped by the selected provider</li>
              <li>Artifact pins are modality-scoped; generic Object remains the advanced escape hatch</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default PinLegend;
