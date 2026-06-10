import { sanitizePythonIdentifier } from './codegen';

export type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'enum' | 'any';
export type SchemaArrayItemType = Exclude<SchemaFieldType, 'any' | 'enum'>;

export interface SchemaField {
  id: string;
  originalName?: string;
  name: string;
  type: SchemaFieldType;
  required: boolean;
  itemsType?: SchemaArrayItemType;
  description?: string;
  enumValues?: string[];
  enumDraft?: string;
}

export const SCHEMA_FIELD_TYPE_OPTIONS: Array<{ value: SchemaFieldType; label: string }> = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Integer' },
  { value: 'boolean', label: 'True / False' },
  { value: 'enum', label: 'Choice' },
  { value: 'object', label: 'Object' },
  { value: 'array', label: 'List' },
  { value: 'any', label: 'Any' },
];

export const SCHEMA_ARRAY_ITEM_TYPE_OPTIONS: Array<{ value: SchemaArrayItemType; label: string }> = [
  { value: 'string', label: 'items: Text' },
  { value: 'number', label: 'items: Number' },
  { value: 'integer', label: 'items: Integer' },
  { value: 'boolean', label: 'items: True / False' },
  { value: 'object', label: 'items: Object' },
  { value: 'array', label: 'items: List' },
];

export function newOpaqueId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`;
}

function normalizePinId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '_');
}

export function uniquePinId(base: string, used: Set<string>): string {
  const normalized = normalizePinId(base);
  const candidateBase = normalized || 'field';
  if (!used.has(candidateBase)) return candidateBase;
  let idx = 2;
  while (used.has(`${candidateBase}_${idx}`)) idx++;
  return `${candidateBase}_${idx}`;
}

export function sanitizeSchemaFieldName(raw: string, used: Set<string>): string {
  return uniquePinId(sanitizePythonIdentifier(raw), used);
}

function isIdentifier(name: string): boolean {
  // Match Python's `str.isidentifier()` subset that's also friendly for JSON keys:
  // letters/underscore start, then letters/digits/underscore.
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function coerceEnumValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') continue;
    const value = String(item).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function normalizeEnumValues(raw: unknown): string[] {
  return coerceEnumValues(raw);
}

function hasArraySchemaClause(root: Record<string, any>): boolean {
  return ['allOf', 'anyOf', 'oneOf'].some((key) => Array.isArray(root[key]) && root[key].length > 0);
}

export function schemaFieldsFromJsonSchema(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const root = schema as Record<string, any>;
  if (typeof root.type === 'string' && root.type !== 'object') return [];
  const props = root.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [];

  const required = new Set<string>(
    Array.isArray(root.required) ? root.required.filter((x): x is string => typeof x === 'string') : []
  );

  const out: SchemaField[] = [];
  for (const [name, spec] of Object.entries(props as Record<string, any>)) {
    if (!name) continue;
    const specObj = spec && typeof spec === 'object' && !Array.isArray(spec) ? (spec as Record<string, any>) : {};
    const enumValues = coerceEnumValues(specObj.enum);
    const rawType = typeof specObj.type === 'string' ? specObj.type : undefined;
    const type: SchemaFieldType =
      enumValues.length > 0
        ? 'enum'
        : rawType === 'string' ||
            rawType === 'number' ||
            rawType === 'integer' ||
            rawType === 'boolean' ||
            rawType === 'object' ||
            rawType === 'array'
          ? rawType
          : 'any';

    let itemsType: SchemaArrayItemType | undefined = undefined;
    if (type === 'array') {
      const items = specObj.items;
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        const itemsTypeRaw = (items as Record<string, any>).type;
        if (
          itemsTypeRaw === 'string' ||
          itemsTypeRaw === 'number' ||
          itemsTypeRaw === 'integer' ||
          itemsTypeRaw === 'boolean' ||
          itemsTypeRaw === 'object' ||
          itemsTypeRaw === 'array'
        ) {
          itemsType = itemsTypeRaw;
        }
      }
    }

    out.push({
      id: newOpaqueId('field'),
      originalName: name,
      name,
      type,
      required: required.has(name),
      itemsType,
      enumValues,
      description: typeof specObj.description === 'string' ? specObj.description : undefined,
    });
  }
  return out;
}

function jsonClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return Array.isArray(value) ? ([...value] as T) : ({ ...(value as Record<string, unknown>) } as T);
  }
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

export function addJsonSchemaFields(baseSchema: unknown, additionsSchema: unknown): Record<string, any> {
  const baseRoot = jsonClone(objectRecord(baseSchema));
  const additionsRoot = jsonClone(objectRecord(additionsSchema));
  if (Object.keys(baseRoot).length === 0) return additionsRoot;
  if (Object.keys(additionsRoot).length === 0) return baseRoot;

  const baseProperties = objectRecord(baseRoot.properties);
  const additionsProperties = objectRecord(additionsRoot.properties);
  const properties: Record<string, any> = { ...baseProperties };
  const addedNames = new Set<string>();
  for (const [name, spec] of Object.entries(additionsProperties)) {
    if (!name || Object.prototype.hasOwnProperty.call(properties, name)) continue;
    properties[name] = spec;
    addedNames.add(name);
  }

  const required = new Set<string>();
  for (const item of Array.isArray(baseRoot.required) ? baseRoot.required : []) {
    if (typeof item === 'string' && item.trim()) required.add(item);
  }
  for (const item of Array.isArray(additionsRoot.required) ? additionsRoot.required : []) {
    if (typeof item === 'string' && item.trim() && addedNames.has(item)) required.add(item);
  }

  const merged: Record<string, any> = {
    ...baseRoot,
    type: baseRoot.type ?? additionsRoot.type ?? 'object',
    properties,
  };
  for (const defsKey of ['$defs', 'definitions']) {
    const baseDefs = objectRecord(baseRoot[defsKey]);
    const additionsDefs = objectRecord(additionsRoot[defsKey]);
    if (Object.keys(additionsDefs).length === 0) continue;
    const nextDefs = { ...baseDefs };
    for (const [name, spec] of Object.entries(additionsDefs)) {
      if (!Object.prototype.hasOwnProperty.call(nextDefs, name)) nextDefs[name] = spec;
    }
    merged[defsKey] = nextDefs;
  }

  if (required.size > 0) merged.required = Array.from(required);
  else delete merged.required;
  return merged;
}

function propertySpecFromField(field: SchemaField, existingSpec: unknown): Record<string, any> {
  const base = jsonClone(objectRecord(existingSpec));
  const desc = typeof field.description === 'string' ? field.description.trim() : '';

  delete base.enumDraft;

  if (field.type === 'any') {
    delete base.type;
    delete base.enum;
    delete base.items;
    if (desc) base.description = desc;
    else delete base.description;
    return base;
  }

  if (field.type === 'array') {
    base.type = 'array';
    delete base.enum;
    delete base.properties;
    if (field.itemsType) {
      const existingItems = objectRecord(base.items);
      base.items = { ...existingItems, type: field.itemsType };
    } else if (!base.items || typeof base.items !== 'object' || Array.isArray(base.items)) {
      base.items = {};
    }
    if (desc) base.description = desc;
    else delete base.description;
    return base;
  }

  if (field.type === 'enum') {
    base.type = 'string';
    base.enum = coerceEnumValues(field.enumValues);
    if (base.enum.length === 0) base.enum = ['option'];
    delete base.items;
    delete base.properties;
    if (desc) base.description = desc;
    else delete base.description;
    return base;
  }

  base.type = field.type;
  delete base.enum;
  delete base.items;
  if (field.type !== 'object') delete base.properties;
  if (desc) base.description = desc;
  else delete base.description;
  return base;
}

export function jsonSchemaFromFields(fields: SchemaField[], baseSchema?: unknown): Record<string, any> {
  const baseRoot = objectRecord(baseSchema);
  const baseProperties = objectRecord(baseRoot.properties);
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;

    const originalName = typeof field.originalName === 'string' && field.originalName.trim()
      ? field.originalName.trim()
      : name;
    properties[name] = propertySpecFromField(field, baseProperties[originalName] ?? baseProperties[name]);

    if (field.required) required.push(name);
  }

  const schema: Record<string, any> = { ...jsonClone(baseRoot), type: 'object', properties };
  if (required.length > 0) schema.required = required;
  else delete schema.required;
  return schema;
}

export function validateStructuredOutputSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'Schema must be a JSON object.';
  const root = schema as Record<string, any>;
  // Allow `$ref`-only schemas (resolved at runtime, e.g. `abstractsemantics:*`).
  if (typeof root.$ref === 'string' && root.$ref.trim()) return null;
  if (typeof root.type === 'string' && root.type !== 'object') return 'Root schema must have type "object".';

  const props = root.properties;
  const hasComposition = hasArraySchemaClause(root);
  if (props === undefined) {
    return hasComposition ? null : 'Schema must define a "properties" object or a JSON Schema composition.';
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    return 'Schema "properties" must be a JSON object.';
  }
  const names = Object.keys(props);
  if (names.length === 0 && !hasComposition) return 'Schema "properties" must not be empty.';
  for (const n of names) {
    if (!isIdentifier(n)) {
      return `Invalid property name "${n}". Use identifier-style names (letters/digits/underscore).`;
    }
  }
  return null;
}

export function defaultStructuredOutputSchema(): Record<string, any> {
  return { type: 'object', properties: { output: { type: 'string' } }, required: ['output'] };
}
