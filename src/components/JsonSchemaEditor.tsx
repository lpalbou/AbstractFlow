import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  SCHEMA_ARRAY_ITEM_TYPE_OPTIONS,
  SCHEMA_FIELD_TYPE_OPTIONS,
  defaultStructuredOutputSchema,
  jsonSchemaFromFields,
  newOpaqueId,
  sanitizeSchemaFieldName,
  schemaFieldsFromJsonSchema,
  validateStructuredOutputSchema,
  type SchemaArrayItemType,
  type SchemaField,
  type SchemaFieldType,
} from '../utils/jsonSchemaEditor';

export {
  defaultStructuredOutputSchema,
  jsonSchemaFromFields,
  schemaFieldsFromJsonSchema,
  validateStructuredOutputSchema,
};

export interface JsonSchemaEditorProps {
  nodeId: string;
  schema: unknown;
  onChange: (nextSchema: Record<string, any>) => void;
  onValidityChange?: (valid: boolean) => void;
  label?: string;
  hint?: ReactNode;
  className?: string;
  jsonHeight?: string;
  fieldsTabLabel?: string;
  jsonTabLabel?: string;
  commitJsonOnChange?: boolean;
}

export function JsonSchemaEditor({
  nodeId,
  schema,
  onChange,
  onValidityChange,
  label = 'JSON Schema',
  hint,
  className,
  jsonHeight = '340px',
  fieldsTabLabel = 'Builder',
  jsonTabLabel = 'JSON Schema',
  commitJsonOnChange = false,
}: JsonSchemaEditorProps) {
  const initialSchema = useMemo<Record<string, any>>(() => {
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) return schema as Record<string, any>;
    return defaultStructuredOutputSchema();
  }, [schema]);

  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [fields, setFields] = useState<SchemaField[]>([]);

  const [baselineJson, setBaselineJson] = useState('');
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    // Only resync when switching nodes/editing targets. This avoids clobbering in-progress edits while typing.
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
    onValidityChange?.(validateStructuredOutputSchema(effective) === null);
    setMode('fields');
  }, [nodeId]); // intentionally not dependent on schema

  const commitFields = (nextFields: SchemaField[]) => {
    const nextSchema = jsonSchemaFromFields(nextFields, initialSchema);
    const err = validateStructuredOutputSchema(nextSchema);
    onChange(nextSchema);
    onValidityChange?.(err === null);
    const asJson = JSON.stringify(nextSchema, null, 2);
    setBaselineJson(asJson);
    setJsonDraft(asJson);
    setJsonDirty(false);
    setJsonError(err);
  };

  const applyJsonDraft = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      const err = validateStructuredOutputSchema(parsed);
      if (err) {
        setJsonError(err);
        onValidityChange?.(false);
        return;
      }
      onChange(parsed);
      onValidityChange?.(true);
      const asJson = JSON.stringify(parsed, null, 2);
      setBaselineJson(asJson);
      setJsonDraft(asJson);
      setJsonDirty(false);
      setJsonError(null);
      setFields(schemaFieldsFromJsonSchema(parsed));
    } catch (e) {
      setJsonError(String(e));
      onValidityChange?.(false);
    }
  };

  return (
    <div className={className ? `property-section ${className}` : 'property-section'}>
      <label className="property-label">{label}</label>
      {hint && <span className="property-hint">{hint}</span>}

      <div className="schema-editor-tabs" role="tablist" aria-label="JSON Schema editor mode">
        <button
          type="button"
          className={mode === 'fields' ? 'active' : undefined}
          role="tab"
          aria-selected={mode === 'fields'}
          onClick={() => {
            setMode('fields');
            setJsonError(null);
            try {
              const parsed = JSON.parse(jsonDraft);
              const derived = schemaFieldsFromJsonSchema(parsed);
              if (derived.length > 0) setFields(derived);
            } catch {
              // Keep current fields; user can fix JSON then re-derive.
            }
          }}
        >
          {fieldsTabLabel}
        </button>
        <button
          type="button"
          className={mode === 'json' ? 'active' : undefined}
          role="tab"
          aria-selected={mode === 'json'}
          onClick={() => {
            setMode('json');
            setJsonError(null);
          }}
        >
          {jsonTabLabel}
        </button>
      </div>

      {mode === 'fields' && (
        <div className="schema-fields" role="tabpanel">
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
                    const sanitized = sanitizeSchemaFieldName(field.name, used);
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
                      if (nextType === 'enum') {
                        return {
                          ...f,
                          type: 'enum',
                          itemsType: undefined,
                          enumValues: f.enumValues && f.enumValues.length > 0 ? f.enumValues : ['option'],
                        } as SchemaField;
                      }
                      return { ...f, type: nextType, itemsType: undefined, enumValues: undefined } as SchemaField;
                    });
                    setFields(next);
                    commitFields(next);
                  }}
                >
                  {SCHEMA_FIELD_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {field.type === 'array' && (
                  <select
                    className="property-select schema-field-items"
                    value={field.itemsType ?? 'string'}
                    onChange={(e) => {
                      const itemsType = (e.target.value || 'string') as SchemaArrayItemType;
                      const next = fields.map((f) => (f.id === field.id ? { ...f, itemsType } : f));
                      setFields(next);
                      commitFields(next);
                    }}
                  >
                    {SCHEMA_ARRAY_ITEM_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
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

              {field.type === 'enum' && (
                <div className="schema-choice-editor">
                  <div className="schema-choice-label">Allowed values</div>
                  <div className="schema-choice-grid">
                    {(field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['option']).map((value, idx) => (
                      <div key={`${field.id}:choice:${idx}`} className="schema-choice-chip">
                        <input
                          className="schema-choice-input"
                          value={value}
                          placeholder="value"
                          onChange={(e) => {
                            const values = [...(field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['option'])];
                            values[idx] = e.target.value;
                            const next = fields.map((f) => (f.id === field.id ? { ...f, enumValues: values } : f));
                            setFields(next);
                            commitFields(next);
                          }}
                        />
                        <button
                          type="button"
                          className="schema-choice-remove"
                          title="Remove value"
                          onClick={() => {
                            const values = [...(field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['option'])];
                            values.splice(idx, 1);
                            const nextValues = values.length > 0 ? values : ['option'];
                            const next = fields.map((f) => (f.id === field.id ? { ...f, enumValues: nextValues } : f));
                            setFields(next);
                            commitFields(next);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="schema-choice-add">
                    <input
                      className="property-input schema-choice-new"
                      value={field.enumDraft ?? ''}
                      placeholder="Add choice value"
                      onChange={(e) => {
                        const next = fields.map((f) => (f.id === field.id ? { ...f, enumDraft: e.target.value } : f));
                        setFields(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const draft = (field.enumDraft ?? '').trim();
                        if (!draft) return;
                        const values = field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['option'];
                        const nextValues = values.includes(draft) ? values : [...values, draft];
                        const next = fields.map((f) =>
                          f.id === field.id ? { ...f, enumValues: nextValues, enumDraft: '' } : f
                        );
                        setFields(next);
                        commitFields(next);
                      }}
                    />
                    <button
                      type="button"
                      className="schema-choice-add-button"
                      onClick={() => {
                        const draft = (field.enumDraft ?? '').trim();
                        if (!draft) return;
                        const values = field.enumValues && field.enumValues.length > 0 ? field.enumValues : ['option'];
                        const nextValues = values.includes(draft) ? values : [...values, draft];
                        const next = fields.map((f) =>
                          f.id === field.id ? { ...f, enumValues: nextValues, enumDraft: '' } : f
                        );
                        setFields(next);
                        commitFields(next);
                      }}
                    >
                      Add value
                    </button>
                  </div>
                </div>
              )}

              <input
                className="property-input schema-field-desc"
                value={field.description ?? ''}
                placeholder="Description (optional)"
                onChange={(e) => {
                  const next = fields.map((f) => (f.id === field.id ? { ...f, description: e.target.value } : f));
                  setFields(next);
                  commitFields(next);
                }}
              />
            </div>
          ))}

          {jsonError && <span className="property-error">{jsonError}</span>}

          <button
            type="button"
            className="array-add-button"
            onClick={() => {
              const used = new Set(fields.map((f) => f.name));
              const nextName = sanitizeSchemaFieldName('field', used);
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
        <div className="schema-json" role="tabpanel">
          <div className="code-editor-container">
            <Editor
              height={jsonHeight}
              defaultLanguage="json"
              theme="vs-dark"
              value={jsonDraft}
              onChange={(v) => {
                const nextDraft = v ?? '';
                setJsonDraft(nextDraft);
                setJsonDirty(true);
                if (!commitJsonOnChange) return;
                try {
                  const parsed = JSON.parse(nextDraft);
                  const err = validateStructuredOutputSchema(parsed);
                  if (err) {
                    setJsonError(err);
                    onValidityChange?.(false);
                    return;
                  }
                  onChange(parsed);
                  onValidityChange?.(true);
                  setJsonError(null);
                  setFields(schemaFieldsFromJsonSchema(parsed));
                } catch (e) {
                  setJsonError(String(e));
                  onValidityChange?.(false);
                }
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
            <button type="button" onClick={applyJsonDraft} disabled={!jsonDirty}>
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
                  onValidityChange?.(true);
                } catch (e) {
                  setJsonError(String(e));
                  onValidityChange?.(false);
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
                onValidityChange?.(true);
              }}
            >
              Reset
            </button>
          </div>

          <span className="property-hint">
            Root must be an object schema, a <code>$ref</code>, or an object schema composition.
          </span>
        </div>
      )}
    </div>
  );
}
