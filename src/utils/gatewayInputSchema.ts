import type { PinType } from '../types/flow';

export interface GatewayInputPin {
  id: string;
  label?: string;
  type?: string;
  default?: unknown;
  required?: boolean;
  schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayRunInputSchema {
  version?: number;
  bundle_id?: string;
  bundle_version?: string;
  bundle_ref?: string;
  flow_id?: string;
  workflow_id?: string;
  inputs?: GatewayInputPin[];
  defaults?: Record<string, unknown>;
  input_data_schema?: {
    type?: string;
    additionalProperties?: boolean;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  [key: string]: unknown;
}

export interface NormalizedRunInputData {
  inputData: Record<string, unknown>;
  missingRequired: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function schemaType(schema: Record<string, unknown> | undefined): string {
  const raw = schema?.type;
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v !== 'null');
    return typeof first === 'string' ? first : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function parseJsonish(value: string, fallback: unknown): unknown {
  const text = value.trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function isProviderOrModelVisualType(value: string): boolean {
  return [
    'provider',
    'model',
    'provider_text',
    'model_text',
    'provider_image',
    'model_image',
    'provider_video',
    'model_video',
    'provider_voice',
    'model_voice',
    'provider_music',
    'model_music',
  ].includes(value);
}

function isArtifactVisualType(value: string): boolean {
  return ['artifact', 'artifact_image', 'artifact_audio', 'artifact_text', 'artifact_video'].includes(value);
}

function isArtifactListVisualType(value: string): boolean {
  return ['artifacts', 'artifacts_image', 'artifacts_audio', 'artifacts_text', 'artifacts_video'].includes(value);
}

function coerceArtifactRef(value: unknown): unknown {
  if (isRecord(value)) {
    const raw = value.$artifact ?? value.artifact_id;
    if (typeof raw === 'string' && raw.trim()) {
      const artifactId = raw.trim();
      return { ...value, $artifact: artifactId, artifact_id: artifactId };
    }
    return value;
  }
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (text.startsWith('{')) {
    const parsed = parseJsonish(text, null);
    if (isRecord(parsed)) return coerceArtifactRef(parsed);
    return value;
  }
  return { $artifact: text, artifact_id: text };
}

function coerceArtifactRefList(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => coerceArtifactRef(item));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      const parsed = parseJsonish(text, []);
      if (Array.isArray(parsed)) return parsed.map((item) => coerceArtifactRef(item));
    }
    const single = coerceArtifactRef(text);
    return single ? [single] : [];
  }
  if (isRecord(value)) {
    return [coerceArtifactRef(value)];
  }
  return value;
}

function coerceValue(value: unknown, pin: GatewayInputPin): unknown {
  const visualType = typeof pin.type === 'string' ? pin.type.trim().toLowerCase() : '';
  const jsonType = schemaType(pin.schema).toLowerCase();
  const target = visualType || jsonType;

  if (value == null) return value;
  if (isArtifactVisualType(target)) {
    return coerceArtifactRef(value);
  }
  if (isArtifactListVisualType(target)) {
    return coerceArtifactRefList(value);
  }
  if (target === 'string' || target === 'workspace_file' || target === 'workspace_folder' || isProviderOrModelVisualType(target)) {
    return typeof value === 'string' ? value : String(value);
  }
  if (target === 'number' || target === 'integer') {
    if (typeof value === 'number' && Number.isFinite(value)) return target === 'integer' ? Math.trunc(value) : value;
    if (typeof value === 'string') {
      const n = Number(value.trim());
      return Number.isFinite(n) ? (target === 'integer' ? Math.trunc(n) : n) : value;
    }
    return value;
  }
  if (target === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) return true;
      if (['false', '0', 'no', 'off'].includes(s)) return false;
    }
    return Boolean(value);
  }
  if (target === 'array' || target === 'tools' || target === 'assertions') {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return parseJsonish(value, []);
    return value;
  }
  if (target === 'object' || target === 'json_schema' || target === 'memory' || target === 'assertion') {
    if (isRecord(value)) return value;
    if (typeof value === 'string') return parseJsonish(value, {});
    return value;
  }
  return value;
}

export function normalizeRunInputData(
  inputData: Record<string, unknown>,
  schema: GatewayRunInputSchema | null | undefined
): NormalizedRunInputData {
  if (!schema || !Array.isArray(schema.inputs)) {
    return { inputData: { ...(inputData || {}) }, missingRequired: [], warnings: [] };
  }

  const defaults = isRecord(schema.defaults) ? schema.defaults : {};
  const out: Record<string, unknown> = { ...defaults, ...(inputData || {}) };
  const warnings: string[] = [];
  const pins = schema.inputs.filter((p): p is GatewayInputPin => isRecord(p) && typeof p.id === 'string' && p.id.trim().length > 0);
  const requiredFromSchema = Array.isArray(schema.input_data_schema?.required)
    ? schema.input_data_schema.required.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  const required = new Set<string>(requiredFromSchema);

  for (const pin of pins) {
    const id = pin.id.trim();
    if (!id) continue;
    if (pin.required === true) required.add(id);
    if (!(id in out)) continue;
    const before = out[id];
    const after = coerceValue(before, pin);
    out[id] = after;
    if (before !== after && typeof before === 'string') {
      const label = pin.label || id;
      warnings.push(`Coerced ${label} from string to ${String(pin.type || schemaType(pin.schema) || 'schema type')}`);
    }
  }

  const missingRequired = Array.from(required.values()).filter((id) => !(id in out) || out[id] === undefined || out[id] === null);
  return { inputData: out, missingRequired, warnings };
}

export function gatewayPinTypeToVisualPinType(pin: GatewayInputPin): PinType {
  const raw = typeof pin.type === 'string' ? pin.type.trim().toLowerCase() : '';
  if (
    raw === 'execution' ||
    raw === 'string' ||
    raw === 'number' ||
    raw === 'boolean' ||
    raw === 'object' ||
    raw === 'json_schema' ||
    raw === 'memory' ||
    raw === 'assertion' ||
    raw === 'assertions' ||
    raw === 'array' ||
    raw === 'tools' ||
    raw === 'provider' ||
    raw === 'model' ||
    raw === 'provider_text' ||
    raw === 'model_text' ||
    raw === 'provider_image' ||
    raw === 'model_image' ||
    raw === 'provider_video' ||
    raw === 'model_video' ||
    raw === 'provider_voice' ||
    raw === 'model_voice' ||
    raw === 'provider_music' ||
    raw === 'model_music' ||
    raw === 'artifact' ||
    raw === 'artifact_image' ||
    raw === 'artifact_audio' ||
    raw === 'artifact_text' ||
    raw === 'artifact_video' ||
    raw === 'artifacts' ||
    raw === 'artifacts_image' ||
    raw === 'artifacts_audio' ||
    raw === 'artifacts_text' ||
    raw === 'artifacts_video' ||
    raw === 'workspace_file' ||
    raw === 'workspace_folder' ||
    raw === 'agent' ||
    raw === 'any'
  ) {
    return raw;
  }
  const st = schemaType(pin.schema).toLowerCase();
  if (st === 'integer' || st === 'number') return 'number';
  if (st === 'boolean') return 'boolean';
  if (st === 'array') return 'array';
  if (st === 'object') return 'object';
  if (st === 'string') return 'string';
  return 'any';
}
