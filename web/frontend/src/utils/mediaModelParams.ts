import type { JsonValue } from '../types/flow';

export type MediaModelParameterMetadata = {
  parameterDefaults?: Record<string, JsonValue>;
  parameterConstraints?: Record<string, unknown>;
};

const IMAGE_PARAMETER_PIN_KEYS = new Set([
  'size',
  'width',
  'height',
  'steps',
  'guidance_scale',
  'negative_prompt',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    const record = asRecord(value);
    if (record && Object.keys(record).length > 0) return record;
  }
  return undefined;
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.filter((item) => asJsonValue(item) !== undefined).map((item) => asJsonValue(item) as JsonValue);
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    const json = asJsonValue(item);
    if (json !== undefined) out[key] = json;
  }
  return out;
}

function jsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    const json = asJsonValue(item);
    if (json !== undefined) out[key] = json;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function extractImageModelParameterMetadata(record: Record<string, unknown>): MediaModelParameterMetadata {
  const raw = asRecord(record.raw);
  const parameters = firstRecord(record.parameters, raw?.parameters);
  return {
    parameterDefaults: jsonRecord(firstRecord(
      record.parameter_defaults,
      record.default_parameters,
      record.generation_defaults,
      parameters?.defaults,
      raw?.parameter_defaults,
      raw?.default_parameters,
      raw?.generation_defaults,
    )),
    parameterConstraints: firstRecord(
      record.parameter_constraints,
      record.constraints,
      parameters?.constraints,
      raw?.parameter_constraints,
      raw?.constraints,
    ),
  };
}

export function imagePinDefaultPatchForModel(metadata: MediaModelParameterMetadata | null | undefined): Record<string, JsonValue | undefined> {
  const patch: Record<string, JsonValue | undefined> = {};
  const defaults = metadata?.parameterDefaults || {};
  for (const [key, value] of Object.entries(defaults)) {
    if (IMAGE_PARAMETER_PIN_KEYS.has(key)) patch[key] = value;
  }
  const constraints = metadata?.parameterConstraints || {};
  for (const [key, rawConstraint] of Object.entries(constraints)) {
    if (!IMAGE_PARAMETER_PIN_KEYS.has(key)) continue;
    const constraint = asRecord(rawConstraint);
    if (!constraint) continue;
    if (Object.prototype.hasOwnProperty.call(constraint, 'const')) {
      patch[key] = asJsonValue(constraint.const);
    }
    if (key === 'negative_prompt' && constraint.supported === false) {
      patch[key] = undefined;
    }
  }
  return patch;
}

export function applyImagePinDefaultPatch(
  current: Record<string, JsonValue | undefined>,
  metadata: MediaModelParameterMetadata | null | undefined
): Record<string, JsonValue> {
  const next = { ...current };
  const patch = imagePinDefaultPatchForModel(metadata);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as Record<string, JsonValue>;
}
