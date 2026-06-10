import type { Pin } from '../types/flow';

const JSON_SCHEMA_PIN_IDS = new Set([
  'resp_schema',
  'response_schema',
  'json_schema',
  'input_schema',
  'output_schema',
]);

function normalizeKey(value: string | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isJsonSchemaInputPin(pin: Pin): boolean {
  if (pin.type === 'json_schema') return true;
  if (pin.type !== 'object') return false;
  const id = normalizeKey(pin.id);
  const label = normalizeKey(pin.label);
  const description = String(pin.description || '').toLowerCase();
  const hasJsonSchemaDescription = description.includes('json schema');

  if (JSON_SCHEMA_PIN_IDS.has(id) || JSON_SCHEMA_PIN_IDS.has(label)) return true;
  if (hasJsonSchemaDescription && (id.endsWith('_schema') || label.endsWith('_schema'))) return true;
  return false;
}

export function hasJsonSchemaPinDefault(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return Object.keys(value).length > 0;
}
