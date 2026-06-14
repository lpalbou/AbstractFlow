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

export const PIN_INFO: PinInfo[] = [
  { type: 'execution', label: 'Execution', shape: '\u25B7', description: 'Controls flow order' },
  { type: 'string', label: 'String', shape: '\u25CF', description: 'Text data' },
  { type: 'number', label: 'Number', shape: '\u25CF', description: 'Integer or float' },
  { type: 'boolean', label: 'Boolean', shape: '\u25C7', description: 'True/False' },
  { type: 'object', label: 'Object', shape: '\u25CF', description: 'JSON objects' },
  { type: 'json_schema', label: 'JSON Schema', shape: '\u25CF', description: 'JSON Schema object' },
  { type: 'artifact', label: 'File', shape: '\u25CF', description: 'Saved file value' },
  { type: 'artifact_image', label: 'Image File', shape: '\u25CF', description: 'Durable saved image file reference' },
  { type: 'artifact_audio', label: 'Audio File', shape: '\u25CF', description: 'Durable saved audio, voice, or music file reference' },
  { type: 'artifact_text', label: 'Text File', shape: '\u25CF', description: 'Durable saved text or transcript file reference' },
  { type: 'artifact_video', label: 'Video File', shape: '\u25CF', description: 'Durable saved video file reference' },
  { type: 'workspace_file', label: 'Server File', shape: '\u25CF', description: 'Live server workspace file path' },
  { type: 'workspace_folder', label: 'Server Folder', shape: '\u25A0', description: 'Live server workspace folder path' },
  { type: 'assertion', label: 'Assertion', shape: '\u25CF', description: 'KG assertion object' },
  { type: 'assertions', label: 'Assertions', shape: '\u25A0', description: 'KG assertions list (assertion[])' },
  { type: 'array', label: 'Array', shape: '\u25A0', description: 'Ordered collections; workflow boundaries can specialize arrays by item type' },
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

export const PIN_RULES: string[] = [
  'Execution connects to Execution only',
  '"Any" type accepts all data types',
  'Same types always compatible',
  'Array and Object are interchangeable',
  'Assertion is compatible with Object',
  '"Tools" is compatible with Array (specialized string[])',
  '"Assertions" is compatible with Array (specialized assertion[])',
  'Providers are modality-scoped; model pins stay generic and are scoped by the selected provider',
  'File pins are durable saved files and route through artifact-backed nodes',
  'Use array of file for multiple local files or for local folder contents',
  'Local Folder in the run form is a source for array<file>, not a live writable folder path',
  'Server File and Server Folder are live server workspace paths and remain string-compatible for backward compatibility',
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
              {PIN_RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default PinLegend;
