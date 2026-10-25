/**
 * `VisualFlow.automation_defaults` (Automations v1, contracts C and C6).
 *
 * Pure functions: parse/normalize the document field, validate a trigger
 * config against the source's own `config_schema`, and convert between that
 * config and a schema-driven form. Nothing here knows a particular source:
 * schedule@1, manual@1 and any future adapter go through the same code.
 *
 * Document field (the gateway accepts it on save and publishes it as
 * `manifest.metadata.automation_defaults[<flow id>]`):
 *
 *   automation_defaults = {
 *     schema_version: 1,
 *     title?: string,
 *     trigger: { source_id, source_version, config, connection_id? },
 *     context: { mode: "independent" | "growing" },
 *     input_data: object,
 *   }
 *
 * No `binding_id`, credentials, timestamps or revisions: those are
 * server-owned and minted when an automation is created. `connection_id`
 * names one of the author's trigger connections (sources with
 * `needs_connection`, root backlog 1047); the gateway refuses a foreign one
 * when an automation is created.
 */
import type {
  AutomationContextMode,
  AutomationDefaults,
  JsonValue,
} from '../types/flow';
import type { AvailableTriggerSource, JsonSchema, TriggerSourceItem } from './triggerSources';

export const AUTOMATION_DEFAULTS_SCHEMA_VERSION = 1 as const;
export const AUTOMATION_CONTEXT_MODES: readonly AutomationContextMode[] = ['independent', 'growing'];

export interface AutomationDefaultsIssue {
  /** Dotted path inside `automation_defaults` (e.g. `trigger.config.every`). */
  field: string;
  message: string;
}

export class AutomationDefaultsError extends Error {
  readonly issues: AutomationDefaultsIssue[];
  constructor(issues: AutomationDefaultsIssue[]) {
    super(`Invalid automation defaults: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`);
    this.name = 'AutomationDefaultsError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

const TOP_KEYS = new Set(['schema_version', 'title', 'trigger', 'context', 'input_data']);
const TRIGGER_KEYS = new Set(['source_id', 'source_version', 'config', 'connection_id']);
const CONTEXT_KEYS = new Set(['mode']);

/**
 * Structural parse of the document field. Unknown keys are rejected (so a
 * `binding_id` or any instantiated id never rides along); `context` and
 * `input_data` get their contract defaults; an empty title is dropped.
 */
export function parseAutomationDefaults(raw: unknown): AutomationDefaults {
  const issues: AutomationDefaultsIssue[] = [];
  if (!isRecord(raw)) throw new AutomationDefaultsError([{ field: '', message: 'must be an object' }]);
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) issues.push({ field: key, message: 'unknown field' });
  }
  if (raw.schema_version !== AUTOMATION_DEFAULTS_SCHEMA_VERSION) {
    issues.push({ field: 'schema_version', message: `must be ${AUTOMATION_DEFAULTS_SCHEMA_VERSION}` });
  }
  let title: string | undefined;
  if (raw.title !== undefined && raw.title !== null) {
    if (typeof raw.title !== 'string') issues.push({ field: 'title', message: 'must be a string' });
    else if (raw.title.trim()) title = raw.title.trim();
  }

  const trigger = raw.trigger;
  let sourceId = '';
  let sourceVersion = 0;
  let config: Record<string, JsonValue> = {};
  let connectionId: string | undefined;
  if (!isRecord(trigger)) {
    issues.push({ field: 'trigger', message: 'must be an object' });
  } else {
    for (const key of Object.keys(trigger)) {
      if (!TRIGGER_KEYS.has(key)) issues.push({ field: `trigger.${key}`, message: 'unknown field' });
    }
    if (typeof trigger.source_id !== 'string' || !trigger.source_id.trim()) {
      issues.push({ field: 'trigger.source_id', message: 'must be a non-empty string' });
    } else {
      sourceId = trigger.source_id;
    }
    if (typeof trigger.source_version !== 'number' || !Number.isInteger(trigger.source_version) || trigger.source_version < 1) {
      issues.push({ field: 'trigger.source_version', message: 'must be an integer >= 1' });
    } else {
      sourceVersion = trigger.source_version;
    }
    if (!isRecord(trigger.config) || !isJsonValue(trigger.config)) {
      issues.push({ field: 'trigger.config', message: 'must be a JSON object' });
    } else {
      config = trigger.config as Record<string, JsonValue>;
    }
    if (trigger.connection_id !== undefined) {
      if (typeof trigger.connection_id !== 'string' || !trigger.connection_id.trim()) {
        issues.push({ field: 'trigger.connection_id', message: 'must be a non-empty string' });
      } else {
        connectionId = trigger.connection_id.trim();
      }
    }
  }

  let mode: AutomationContextMode = 'independent';
  if (raw.context !== undefined) {
    if (!isRecord(raw.context)) {
      issues.push({ field: 'context', message: 'must be an object' });
    } else {
      for (const key of Object.keys(raw.context)) {
        if (!CONTEXT_KEYS.has(key)) issues.push({ field: `context.${key}`, message: 'unknown field' });
      }
      const m = raw.context.mode;
      if (m !== undefined) {
        if (typeof m !== 'string' || !(AUTOMATION_CONTEXT_MODES as readonly string[]).includes(m)) {
          issues.push({ field: 'context.mode', message: `must be one of ${AUTOMATION_CONTEXT_MODES.join(', ')}` });
        } else {
          mode = m as AutomationContextMode;
        }
      }
    }
  }

  let inputData: Record<string, JsonValue> = {};
  if (raw.input_data !== undefined) {
    if (!isRecord(raw.input_data) || !isJsonValue(raw.input_data)) {
      issues.push({ field: 'input_data', message: 'must be a JSON object' });
    } else {
      inputData = raw.input_data as Record<string, JsonValue>;
    }
  }

  if (issues.length) throw new AutomationDefaultsError(issues);
  return {
    schema_version: AUTOMATION_DEFAULTS_SCHEMA_VERSION,
    ...(title ? { title } : {}),
    trigger: { source_id: sourceId, source_version: sourceVersion, config, ...(connectionId ? { connection_id: connectionId } : {}) },
    context: { mode },
    input_data: inputData,
  };
}

// ---------------------------------------------------------------------------
// JSON Schema subset: validation
// ---------------------------------------------------------------------------

/**
 * Keywords the form renders as fields (operator 2026-10-25: a schema with a
 * keyword the editor does not know never blocks the whole source; that
 * PROPERTY is edited as JSON, and the gateway re-validates everything when an
 * automation is created).
 */
const FORM_KEYWORDS = new Set([
  'type',
  'title',
  'description',
  'enum',
  'default',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'examples',
  'x-secret',
]);
/** Extra keywords of a list (array of strings) field. */
const LIST_KEYWORDS = new Set([...FORM_KEYWORDS, 'items', 'minItems', 'maxItems', 'uniqueItems']);
/** Extra keywords of a group (object with properties) field. */
const GROUP_KEYWORDS = new Set([...FORM_KEYWORDS, 'properties', 'required', 'additionalProperties']);

/** Keywords the validator implements (annotations included). */
const VALIDATED_KEYWORDS = new Set([
  ...LIST_KEYWORDS,
  'properties',
  'required',
  'additionalProperties',
  '$schema',
  '$comment',
]);
const VALIDATED_FORMATS = new Set(['date-time', 'duration', 'email', 'uri']);

/**
 * JSON Schema keywords (and formats) in `schema` that this editor does NOT
 * check, as `path: keyword`. Informational: the properties using them are
 * edited as JSON and checked by the gateway, never refused here.
 */
export function unsupportedSchemaKeywords(schema: unknown, path = 'config_schema'): string[] {
  if (!isRecord(schema)) return [`${path}: not an object`];
  const found: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (!VALIDATED_KEYWORDS.has(key)) found.push(`${path}: ${key}`);
    else if (key === 'format' && !(typeof value === 'string' && VALIDATED_FORMATS.has(value))) {
      found.push(`${path}: format ${JSON.stringify(value)}`);
    } else if (
      key === 'type' &&
      !(typeof value === 'string' || (Array.isArray(value) && value.every((t) => typeof t === 'string')))
    ) {
      found.push(`${path}: type ${JSON.stringify(value)}`);
    }
  }
  if (isRecord(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      found.push(...unsupportedSchemaKeywords(child, `${path}.properties.${name}`));
    }
  } else if (schema.properties !== undefined) {
    found.push(`${path}: properties`);
  }
  if (isRecord(schema.additionalProperties)) {
    found.push(...unsupportedSchemaKeywords(schema.additionalProperties, `${path}.additionalProperties`));
  }
  if (isRecord(schema.items)) found.push(...unsupportedSchemaKeywords(schema.items, `${path}.items`));
  return found;
}

// RFC 3339 date-time (the JSON Schema `date-time` format), checked by shape.
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isRecord(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

const TYPE_WORDS: Record<string, string> = {
  integer: 'a whole number',
  number: 'a number',
  string: 'text',
  boolean: 'yes or no',
  object: 'a group of settings',
  array: 'a list',
  null: 'empty',
};

function validateValue(schema: unknown, value: unknown, path: string, issues: AutomationDefaultsIssue[]): void {
  if (!isRecord(schema)) return;
  const type = schema.type;
  if (typeof type === 'string' && !typeMatches(type, value)) {
    issues.push({ field: path, message: `must be ${TYPE_WORDS[type] || `a ${type}`}` });
    return;
  }
  if (Array.isArray(type) && !type.some((t) => typeof t === 'string' && typeMatches(t, value))) {
    issues.push({ field: path, message: `must be one of: ${type.map((t) => TYPE_WORDS[String(t)] || t).join(', ')}` });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    issues.push({ field: path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push({ field: path, message: `does not have the expected form (${schema.pattern})` });
    }
    if (schema.format === 'date-time' && (!DATE_TIME_RE.test(value) || Number.isNaN(Date.parse(value)))) {
      issues.push({ field: path, message: 'must be a date and time such as 2026-09-27T08:00:00Z' });
    }
    if (schema.format === 'email' && !EMAIL_RE.test(value)) {
      issues.push({ field: path, message: `"${value}" is not an email address` });
    }
    if (schema.format === 'uri' && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(value)) {
      issues.push({ field: path, message: `"${value}" is not a web address` });
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ field: path, message: schema.minLength === 1 ? 'cannot be empty' : `must be at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ field: path, message: `must be at most ${schema.maxLength} characters` });
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ field: path, message: `must be at least ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ field: path, message: `must be at most ${schema.maximum}` });
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ field: path, message: schema.minItems === 1 ? 'needs at least one entry' : `needs at least ${schema.minItems} entries` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ field: path, message: `takes at most ${schema.maxItems} entries` });
    }
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      issues.push({ field: path, message: 'lists the same entry twice' });
    }
    if (isRecord(schema.items)) value.forEach((item, i) => validateValue(schema.items, item, `${path}.${i}`, issues));
  }
  if (isRecord(value)) {
    const props = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !(key in value)) issues.push({ field: `${path}.${key}`, message: 'is required' });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key in props) validateValue(props[key], child, `${path}.${key}`, issues);
      else if (schema.additionalProperties === false) issues.push({ field: `${path}.${key}`, message: 'is not a setting of this trigger' });
      else if (isRecord(schema.additionalProperties)) validateValue(schema.additionalProperties, child, `${path}.${key}`, issues);
    }
  }
}

/**
 * Validate a trigger config against the source's `config_schema`, on the
 * keywords this editor implements (the rest are the gateway's to check).
 */
export function validateTriggerConfig(schema: JsonSchema, config: unknown): AutomationDefaultsIssue[] {
  const issues: AutomationDefaultsIssue[] = [];
  validateValue(schema, config, 'trigger.config', issues);
  return issues;
}

/**
 * Full validation of parsed defaults against the discovered sources. The
 * source must be served, available and at the bound version; the config must
 * satisfy its `config_schema`.
 */
export function validateAutomationDefaults(
  defaults: AutomationDefaults,
  sources: readonly TriggerSourceItem[]
): AutomationDefaultsIssue[] {
  const { source_id, source_version, config } = defaults.trigger;
  const matches = sources.filter((s) => s.id === source_id);
  if (!matches.length) {
    return [{ field: 'trigger.source_id', message: `trigger source "${source_id}" is not served by this gateway` }];
  }
  const unavailable = matches.find((s) => !s.available);
  if (unavailable && !unavailable.available) {
    return [{ field: 'trigger.source_id', message: `trigger source "${source_id}" is unavailable: ${unavailable.unavailable_reason}` }];
  }
  const source = matches.find((s): s is AvailableTriggerSource => s.available && s.version === source_version);
  if (!source) {
    const served = matches.map((s) => s.version).filter((v) => v !== undefined).join(', ');
    return [{
      field: 'trigger.source_version',
      message: `trigger source "${source_id}" version ${source_version} is not served (served: ${served})`,
    }];
  }
  const connectionIssue = source.uses_trigger_connection
    ? (defaults.trigger.connection_id ? null : { field: 'trigger.connection_id', message: `trigger source "${source_id}" listens to a connection: choose one` })
    : (defaults.trigger.connection_id ? { field: 'trigger.connection_id', message: `trigger source "${source_id}" takes no connection` } : null);
  // The gateway folds `trigger.connection_id` into the binding's config
  // (automation_defaults.fold_connection_id): validate what it will check.
  const declares = isRecord(source.config_schema.properties) && 'connection_id' in source.config_schema.properties;
  const checked = declares && defaults.trigger.connection_id ? { ...config, connection_id: defaults.trigger.connection_id } : config;
  return [...(connectionIssue ? [connectionIssue] : []), ...validateTriggerConfig(source.config_schema, checked)];
}

/** Parse + validate; throws `AutomationDefaultsError` listing every issue. */
export function assertValidAutomationDefaults(
  raw: unknown,
  sources: readonly TriggerSourceItem[]
): AutomationDefaults {
  const parsed = parseAutomationDefaults(raw);
  const issues = validateAutomationDefaults(parsed, sources);
  if (issues.length) throw new AutomationDefaultsError(issues);
  return parsed;
}

/** A fresh draft bound to `source` (config empty: the source fills its defaults). */
export function draftAutomationDefaults(source: AvailableTriggerSource): AutomationDefaults {
  return {
    schema_version: AUTOMATION_DEFAULTS_SCHEMA_VERSION,
    trigger: { source_id: source.id, source_version: source.version, config: {} },
    context: { mode: 'independent' },
    input_data: {},
  };
}

// ---------------------------------------------------------------------------
// JSON Schema subset: form
// ---------------------------------------------------------------------------

export const DURATION_UNITS = ['s', 'm', 'h', 'd'] as const;
/** The contract's `every` pattern (schedule@1); a string with it is a duration. */
export const DURATION_PATTERN = '^[1-9][0-9]*[smhd]$';
export type DurationUnit = (typeof DURATION_UNITS)[number];

/**
 * `list`: an array of strings (one per line); `group`: an object with its own
 * properties (a section of fields); `json`: a property using a keyword the
 * form does not render, edited as JSON for that property only.
 */
export type ConfigFieldKind = 'string' | 'datetime' | 'duration' | 'integer' | 'number' | 'boolean' | 'enum' | 'list' | 'group' | 'json';

export interface ConfigFormField {
  /** Dotted path inside the config (`filter.from_in`). */
  key: string;
  label: string;
  description?: string;
  kind: ConfigFieldKind;
  required: boolean;
  /** `enum` options (JSON-encoded for the <select>). */
  options?: JsonValue[];
  /** `group` fields. */
  children?: ConfigFormField[];
  /** The property schema. */
  schema: JsonSchema;
}

/**
 * Form field string values, keyed by dotted path. `duration` fields use
 * `{key}` for the amount and `{key}#unit` for the unit; `list` fields one
 * entry per line; `json` fields JSON text. An empty string means "not set".
 */
export type ConfigFormValues = Record<string, string>;

function onlyKeywords(schema: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(schema).every((k) => allowed.has(k));
}

function fieldKind(schema: Record<string, unknown>): ConfigFieldKind {
  if (schema.type === 'array') {
    const items = schema.items;
    if (onlyKeywords(schema, LIST_KEYWORDS) && isRecord(items) && items.type === 'string' && onlyKeywords(items, FORM_KEYWORDS) && !Array.isArray(items.enum)) return 'list';
    return 'json';
  }
  if (schema.type === 'object') {
    if (onlyKeywords(schema, GROUP_KEYWORDS) && isRecord(schema.properties) && Object.keys(schema.properties).length) return 'group';
    return 'json';
  }
  if (!onlyKeywords(schema, FORM_KEYWORDS)) return 'json';
  if (Array.isArray(schema.enum)) return 'enum';
  switch (schema.type) {
    case 'string':
      if (schema.format === 'duration' || schema.pattern === DURATION_PATTERN) return 'duration';
      if (schema.format === 'date-time') return 'datetime';
      return 'string';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'json';
  }
}

/** A setting's name for a person: the schema title, else its key in sentence case ("max_batch" -> "Max batch"). */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/**
 * Form fields for an object `config_schema` (one per property, schema
 * order; groups nest). `labels` names known settings in plain words
 * (keyed by dotted path); `omit` hides settings another control owns.
 */
export function configFormFields(
  schema: JsonSchema,
  options: {
    prefix?: string;
    labels?: Record<string, { label?: string; description?: string }>;
    omit?: readonly string[];
    /** configFromFormValues only: false = build the config, leave the checks to the caller. */
    validate?: boolean;
  } = {}
): ConfigFormField[] {
  const props = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : []);
  const omit = new Set(options.omit || []);
  return Object.entries(props)
    .filter(([key]) => !omit.has(options.prefix ? `${options.prefix}.${key}` : key))
    .map(([name, raw]) => {
      const key = options.prefix ? `${options.prefix}.${name}` : name;
      const prop = (isRecord(raw) ? raw : {}) as JsonSchema;
      const kind = isRecord(raw) ? fieldKind(raw) : 'json';
      const copy = options.labels?.[key];
      const title = typeof prop.title === 'string' && prop.title.trim() ? prop.title : '';
      const description = copy?.description || (typeof prop.description === 'string' && prop.description.trim() ? prop.description : '');
      return {
        key,
        label: copy?.label || title || humanizeKey(name),
        ...(description ? { description } : {}),
        kind,
        required: required.has(name),
        ...(kind === 'enum' && Array.isArray(prop.enum) ? { options: prop.enum } : {}),
        ...(kind === 'group' ? { children: configFormFields(prop, { ...options, prefix: key }) } : {}),
        schema: prop,
      };
    });
}

const DURATION_RE = /^([1-9][0-9]*)([smhd])$/;

function getPath(config: Record<string, JsonValue>, key: string): JsonValue | undefined {
  let node: JsonValue | undefined = config;
  for (const part of key.split('.')) {
    if (!isRecord(node)) return undefined;
    node = (node as Record<string, JsonValue>)[part];
  }
  return node;
}

function fieldValues(fields: ConfigFormField[], config: Record<string, JsonValue>, values: ConfigFormValues): void {
  for (const field of fields) {
    const value = getPath(config, field.key);
    if (field.kind === 'group') {
      fieldValues(field.children || [], config, values);
      continue;
    }
    if (value === undefined) continue;
    if (field.kind === 'duration' && typeof value === 'string') {
      const m = DURATION_RE.exec(value);
      if (m) {
        values[field.key] = m[1];
        values[`${field.key}#unit`] = m[2];
      } else {
        values[field.key] = value;
      }
    } else if (field.kind === 'list' && Array.isArray(value)) {
      values[field.key] = value.map((v) => String(v)).join('\n');
    } else if (field.kind === 'enum') {
      values[field.key] = JSON.stringify(value);
    } else if (field.kind === 'json') {
      values[field.key] = JSON.stringify(value, null, 2);
    } else {
      values[field.key] = String(value);
    }
  }
}

/** Existing config → form values (for editing saved defaults). */
export function formValuesFromConfig(
  schema: JsonSchema,
  config: Record<string, JsonValue>,
  options: Parameters<typeof configFormFields>[1] = {}
): ConfigFormValues {
  const values: ConfigFormValues = {};
  fieldValues(configFormFields(schema, options), config, values);
  return values;
}

function fieldConfig(fields: ConfigFormField[], values: ConfigFormValues, issues: AutomationDefaultsIssue[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const field of fields) {
    const name = field.key.split('.').slice(-1)[0];
    const path = `trigger.config.${field.key}`;
    if (field.kind === 'group') {
      const child = fieldConfig(field.children || [], values, issues);
      if (Object.keys(child).length) out[name] = child;
      continue;
    }
    const raw = (values[field.key] ?? '').trim();
    if (!raw) continue;
    switch (field.kind) {
      case 'string':
      case 'datetime':
        out[name] = raw;
        break;
      case 'duration': {
        const unit = (values[`${field.key}#unit`] ?? '').trim();
        if (/^[0-9]+$/.test(raw) && (DURATION_UNITS as readonly string[]).includes(unit)) out[name] = `${raw}${unit}`;
        else out[name] = raw; // validated below against the schema's own pattern
        break;
      }
      case 'integer':
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) issues.push({ field: path, message: 'must be a number' });
        else out[name] = n;
        break;
      }
      case 'boolean':
        out[name] = raw === 'true';
        break;
      case 'enum':
        out[name] = JSON.parse(raw) as JsonValue;
        break;
      case 'list':
        out[name] = raw.split(/\n|,/).map((v) => v.trim()).filter(Boolean);
        break;
      case 'json':
        try {
          out[name] = JSON.parse(raw) as JsonValue;
        } catch (error) {
          issues.push({ field: path, message: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` });
        }
        break;
    }
  }
  return out;
}

/**
 * Form values → config, then validated against the schema. Empty values are
 * omitted (the source applies its defaults); an empty group is omitted.
 * Settings the form does not show (`omit`) keep their value from `previous`.
 */
export function configFromFormValues(
  schema: JsonSchema,
  values: ConfigFormValues,
  previous: Record<string, JsonValue> = {},
  options: Parameters<typeof configFormFields>[1] = {}
): { config: Record<string, JsonValue>; issues: AutomationDefaultsIssue[] } {
  const issues: AutomationDefaultsIssue[] = [];
  const config = fieldConfig(configFormFields(schema, options), values, issues);
  for (const key of options.omit || []) {
    if (!key.includes('.') && previous[key] !== undefined && config[key] === undefined) config[key] = previous[key];
  }
  if (options.validate !== false) issues.push(...validateTriggerConfig(schema, config));
  return { config, issues };
}

/** Short human summary for lists ("Schedule v1 · every 5m"). Structure only. */
export function describeAutomationDefaults(
  defaults: AutomationDefaults,
  sources: readonly TriggerSourceItem[] = []
): string {
  const source = sources.find((s) => s.id === defaults.trigger.source_id);
  const name = source ? source.label : defaults.trigger.source_id;
  const every = defaults.trigger.config.every;
  const parts = [`${name} v${defaults.trigger.source_version}`];
  if (typeof every === 'string') parts.push(`every ${every}`);
  if (defaults.trigger.connection_id) parts.push('with a connection');
  if (defaults.context.mode === 'growing') parts.push('growing context');
  return parts.join(' · ');
}
