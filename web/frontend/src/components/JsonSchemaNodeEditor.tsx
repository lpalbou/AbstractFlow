import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { sanitizePythonIdentifier } from '../utils/codegen';

type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'any';

interface SchemaField {
  id: string;
  name: string;
  type: SchemaFieldType;
  required: boolean;
  itemsType?: Exclude<SchemaFieldType, 'any'>;
}

export interface JsonSchemaNodeEditorProps {
  nodeId: string;
  schema: unknown;
  onChange: (nextSchema: Record<string, any>) => void;
}

function newOpaqueId(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`;
}

function normalizePinId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, '_');
}

function uniquePinId(base: string, used: Set<string>): string {
  const normalized = normalizePinId(base);
  const candidateBase = normalized || 'field';
  if (!used.has(candidateBase)) return candidateBase;
  let idx = 2;
  while (used.has(`${candidateBase}_${idx}`)) idx++;
  return `${candidateBase}_${idx}`;
}

function isIdentifier(name: string): boolean {
  // Match Python's `str.isidentifier()` subset that's also friendly for JSON keys:
  // letters/underscore start, then letters/digits/underscore.
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function schemaFieldsFromJsonSchema(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const root = schema as Record<string, any>;
  if (root.type !== 'object') return [];
  const props = root.properties;
  if (!props || typeof props !== 'object') return [];

  const required = new Set<string>(
    Array.isArray(root.required) ? root.required.filter((x): x is string => typeof x === 'string') : []
  );

  const out: SchemaField[] = [];
  for (const [name, spec] of Object.entries(props as Record<string, any>)) {
    if (!name) continue;
    const specObj = spec && typeof spec === 'object' ? (spec as Record<string, any>) : {};
    const rawType = typeof specObj.type === 'string' ? specObj.type : undefined;
    const type: SchemaFieldType =
      rawType === 'string' ||
      rawType === 'number' ||
      rawType === 'integer' ||
      rawType === 'boolean' ||
      rawType === 'object' ||
      rawType === 'array'
        ? rawType
        : 'any';

    let itemsType: Exclude<SchemaFieldType, 'any'> | undefined = undefined;
    if (type === 'array') {
      const items = specObj.items;
      if (items && typeof items === 'object') {
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
      name,
      type,
      required: required.has(name),
      itemsType,
    });
  }
  return out;
}

function jsonSchemaFromFields(fields: SchemaField[]): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    const name = field.name.trim();
    if (!name) continue;

    const t = field.type;
    if (t === 'any') {
      properties[name] = {};
    } else if (t === 'array') {
      const itemsType = field.itemsType;
      properties[name] = { type: 'array', items: itemsType ? { type: itemsType } : {} };
    } else {
      properties[name] = { type: t };
    }

    if (field.required) required.push(name);
  }

  const schema: Record<string, any> = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function validateStructuredOutputSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'Schema must be a JSON object.';
  const root = schema as Record<string, any>;
  if (root.type !== 'object') return 'Root schema must have type "object".';
  const props = root.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    return 'Schema must define a "properties" object.';
  }
  const names = Object.keys(props);
  if (names.length === 0) return 'Schema "properties" must not be empty.';
  for (const n of names) {
    if (!isIdentifier(n)) {
      return `Invalid property name "${n}". Use identifier-style names (letters/digits/underscore).`;
    }
  }
  return null;
}

export function JsonSchemaNodeEditor({ nodeId, schema, onChange }: JsonSchemaNodeEditorProps) {
  const initialSchema = useMemo<Record<string, any>>(() => {
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) return schema as Record<string, any>;
    return { type: 'object', properties: { output: { type: 'string' } }, required: ['output'] };
  }, [schema]);

  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [fields, setFields] = useState<SchemaField[]>([]);

  const [baselineJson, setBaselineJson] = useState('');
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    // Only resync when switching nodes. This avoids clobbering in-progress edits while typing.
    const parsedFields = schemaFieldsFromJsonSchema(initialSchema);
    const nextFields =
      parsedFields.length > 0
        ? parsedFields
        : [
            {
              id: newOpaqueId('field'),
              name: 'output',
              type: 'string' as const,
              required: true,
            },
          ];
    setFields(nextFields);

    const effective = initialSchema && typeof initialSchema === 'object' ? initialSchema : jsonSchemaFromFields(nextFields);
    const asJson = JSON.stringify(effective, null, 2);
    setBaselineJson(asJson);
    setJsonDraft(asJson);
    setJsonDirty(false);
    setJsonError(null);
    setMode('fields');
  }, [nodeId]); // intentionally not dependent on schema

  const commitFields = (nextFields: SchemaField[]) => {
    const nextSchema = jsonSchemaFromFields(nextFields);
    onChange(nextSchema);
    const asJson = JSON.stringify(nextSchema, null, 2);
    setBaselineJson(asJson);
    setJsonDraft(asJson);
    setJsonDirty(false);
    setJsonError(null);
  };

  return (
    <div className="property-section">
      <label className="property-label">JSON Schema</label>

      <span className="property-hint">
        Use this node to define a structured output schema for LLM/Agent. Advanced JSON Schema features (e.g.{' '}
        <code>$ref</code>/<code>$defs</code>) may not be enforced yet. Examples:{' '}
        <a href="https://json-schema.org/learn/miscellaneous-examples" target="_blank" rel="noreferrer">
          JSON Schema examples
        </a>
        .
      </span>

      <div className="property-group schema-mode">
        <label className="property-sublabel">Editor</label>
        <select
          className="property-select"
          value={mode}
          onChange={(e) => {
            const nextMode = e.target.value === 'json' ? 'json' : 'fields';
            setMode(nextMode);
            setJsonError(null);
            if (nextMode === 'fields') {
              // Best-effort conversion: keep existing fields, or derive them from current JSON.
              try {
                const parsed = JSON.parse(jsonDraft);
                const derived = schemaFieldsFromJsonSchema(parsed);
                if (derived.length > 0) setFields(derived);
              } catch {
                // Keep current fields; user can fix JSON then re-derive.
              }
            }
          }}
        >
          <option value="fields">Fields (recommended)</option>
          <option value="json">JSON Schema (advanced)</option>
        </select>
      </div>

      {mode === 'fields' && (
        <div className="schema-fields">
          {fields.map((field) => (
            <div key={field.id} className="schema-field-row">
              <div className="schema-field-top">
                <input
                  className="property-input schema-field-name"
                  value={field.name}
                  placeholder="field_name"
                  onChange={(e) => {
                    const next = fields.map((f) => (f.id === field.id ? { ...f, name: e.target.value } : f));
                    setFields(next);
                    commitFields(next);
                  }}
                  onBlur={() => {
                    const used = new Set(fields.filter((f) => f.id !== field.id).map((f) => f.name));
                    const sanitized = uniquePinId(sanitizePythonIdentifier(field.name), used);
                    if (sanitized === field.name) return;
                    const next = fields.map((f) => (f.id === field.id ? { ...f, name: sanitized } : f));
                    setFields(next);
                    commitFields(next);
                  }}
                />

                <button
                  type="button"
                  className="array-item-remove"
                  onClick={() => {
                    const next = fields.filter((f) => f.id !== field.id);
                    setFields(next);
                    commitFields(next);
                  }}
                  title="Remove field"
                >
                  ×
                </button>
              </div>

              <div className="schema-field-bottom">
                <select
                  className="property-select schema-field-type"
                  value={field.type}
                  onChange={(e) => {
                    const nextType = (e.target.value || 'string') as SchemaFieldType;
                    const next = fields.map((f) => {
                      if (f.id !== field.id) return f;
                      if (nextType === 'array') return { ...f, type: 'array', itemsType: f.itemsType ?? 'string' } as SchemaField;
                      return { ...f, type: nextType, itemsType: undefined } as SchemaField;
                    });
                    setFields(next);
                    commitFields(next);
                  }}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="integer">integer</option>
                  <option value="boolean">boolean</option>
                  <option value="object">object</option>
                  <option value="array">array</option>
                  <option value="any">any</option>
                </select>

                {field.type === 'array' && (
                  <select
                    className="property-select schema-field-items"
                    value={field.itemsType ?? 'string'}
                    onChange={(e) => {
                      const itemsType = (e.target.value || 'string') as Exclude<SchemaFieldType, 'any'>;
                      const next = fields.map((f) => (f.id === field.id ? { ...f, itemsType } : f));
                      setFields(next);
                      commitFields(next);
                    }}
                  >
                    <option value="string">items: string</option>
                    <option value="number">items: number</option>
                    <option value="integer">items: integer</option>
                    <option value="boolean">items: boolean</option>
                    <option value="object">items: object</option>
                    <option value="array">items: array</option>
                  </select>
                )}

                <label className="schema-optional" title="When enabled, this field may be omitted.">
                  <input
                    type="checkbox"
                    checked={!field.required}
                    onChange={(e) => {
                      const optional = e.target.checked;
                      const next = fields.map((f) => (f.id === field.id ? { ...f, required: !optional } : f));
                      setFields(next);
                      commitFields(next);
                    }}
                  />
                  <span>optional</span>
                </label>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="array-add-button"
            onClick={() => {
              const used = new Set(fields.map((f) => f.name));
              const nextName = uniquePinId('field', used);
              const next = [
                ...fields,
                { id: newOpaqueId('field'), name: nextName, type: 'string' as const, required: true },
              ];
              setFields(next);
              commitFields(next);
            }}
          >
            + Add field
          </button>
        </div>
      )}

      {mode === 'json' && (
        <div className="schema-json">
          <div className="code-editor-container">
            <Editor
              height="340px"
              defaultLanguage="json"
              theme="vs-dark"
              value={jsonDraft}
              onChange={(v) => {
                setJsonDraft(v ?? '');
                setJsonDirty(true);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          </div>

          {jsonError && <span className="property-error">{jsonError}</span>}

          <div className="schema-actions">
            <button
              type="button"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonDraft);
                  const err = validateStructuredOutputSchema(parsed);
                  if (err) {
                    setJsonError(err);
                    return;
                  }
                  onChange(parsed);
                  const asJson = JSON.stringify(parsed, null, 2);
                  setBaselineJson(asJson);
                  setJsonDraft(asJson);
                  setJsonDirty(false);
                  setJsonError(null);
                  setFields(schemaFieldsFromJsonSchema(parsed));
                } catch (e) {
                  setJsonError(String(e));
                }
              }}
              disabled={!jsonDirty}
            >
              Apply JSON Schema
            </button>

            <button
              type="button"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonDraft);
                  const asJson = JSON.stringify(parsed, null, 2);
                  setJsonDraft(asJson);
                  setJsonDirty(true);
                  setJsonError(null);
                } catch (e) {
                  setJsonError(String(e));
                }
              }}
            >
              Format
            </button>

            <button
              type="button"
              onClick={() => {
                setJsonDraft(baselineJson);
                setJsonDirty(false);
                setJsonError(null);
              }}
            >
              Reset
            </button>
          </div>

          <span className="property-hint">
            Root must be <code>{`{"type":"object","properties":{...}}`}</code>. Property names must be identifier-style (
            <code>snake_case</code>) to match runtime validation.
          </span>
        </div>
      )}
    </div>
  );
}


