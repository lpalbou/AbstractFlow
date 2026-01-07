import { useMemo, useState } from 'react';
import type { JsonValue } from '../types/flow';

/**
 * Small, reusable editor for JSON-ish values (used by literal nodes).
 *
 * Design goals:
 * - Keep it simple and predictable (no “magic” coercions beyond obvious defaults).
 * - Prefer structured editing for objects/arrays, but always allow raw JSON escape hatch.
 * - Reuse the “schema-field-row” visual language used elsewhere in the Properties panel.
 */

type JsonValueKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

function isJsonObject(value: JsonValue): value is { [k: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is JsonValue[] {
  return Array.isArray(value);
}

function kindOf(value: JsonValue): JsonValueKind {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

function defaultForKind(kind: JsonValueKind): JsonValue {
  if (kind === 'string') return '';
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  if (kind === 'null') return null;
  if (kind === 'array') return [];
  return {};
}

function safeStringify(value: JsonValue): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export interface JsonValueEditorProps {
  label?: string;
  value: JsonValue;
  /**
   * If set, structured editing only applies when the top-level value is that kind.
   * - "object": the editor shows a field list for objects (and falls back to raw JSON for non-objects).
   * - "array":  the editor shows an item list for arrays (and falls back to raw JSON for non-arrays).
   */
  rootKind: 'object' | 'array';
  onChange: (next: JsonValue) => void;
  /**
   * Optional hint displayed above the editor.
   */
  hint?: string;
}

export function JsonValueEditor({ label, value, rootKind, onChange, hint }: JsonValueEditorProps) {
  const [rawDraft, setRawDraft] = useState<string>('');

  const isRootObject = rootKind === 'object';
  const isRootArray = rootKind === 'array';

  const objectValue: Record<string, JsonValue> = useMemo(() => {
    if (!isRootObject) return {};
    return isJsonObject(value) ? value : {};
  }, [isRootObject, value]);

  const arrayValue: JsonValue[] = useMemo(() => {
    if (!isRootArray) return [];
    return isJsonArray(value) ? value : [];
  }, [isRootArray, value]);

  const setObjectKey = (oldKey: string, newKeyRaw: string): boolean => {
    const newKey = newKeyRaw.trim();
    if (!newKey || newKey === oldKey) return false;
    if (Object.prototype.hasOwnProperty.call(objectValue, newKey)) return false;
    const next: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(objectValue)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
    return true;
  };

  const setObjectField = (key: string, nextVal: JsonValue) => {
    onChange({ ...objectValue, [key]: nextVal });
  };

  const removeObjectField = (key: string) => {
    const next: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(objectValue)) {
      if (k !== key) next[k] = v;
    }
    onChange(next);
  };

  const addObjectField = () => {
    let i = 1;
    let key = `field_${i}`;
    while (Object.prototype.hasOwnProperty.call(objectValue, key)) {
      i += 1;
      key = `field_${i}`;
    }
    onChange({ ...objectValue, [key]: '' });
  };

  const setObjectFieldType = (key: string, t: JsonValueKind) => {
    setObjectField(key, defaultForKind(t));
  };

  const setArrayItem = (index: number, nextVal: JsonValue) => {
    const next = [...arrayValue];
    next[index] = nextVal;
    onChange(next);
  };

  const removeArrayItem = (index: number) => {
    const next = arrayValue.filter((_, i) => i !== index);
    onChange(next);
  };

  const addArrayItem = () => {
    onChange([...arrayValue, '']);
  };

  const rawText = rawDraft !== '' ? rawDraft : safeStringify(value);

  return (
    <div className="property-section">
      {label ? <label className="property-label">{label}</label> : null}
      {hint ? <span className="property-hint">{hint}</span> : null}

      {isRootObject ? (
        <>
          {!isJsonObject(value) ? (
            <span className="property-hint">
              Structured editing supports JSON objects. Use Raw JSON below for arrays or advanced values.
            </span>
          ) : null}

          <div className="schema-fields">
            {Object.entries(objectValue).map(([key, v]) => {
              const t = kindOf(v);
              return (
                <div key={key} className="schema-field-row">
                  <div className="schema-field-top">
                    <input
                      type="text"
                      className="property-input schema-field-name"
                      defaultValue={key}
                      onBlur={(e) => {
                        const ok = setObjectKey(key, e.target.value);
                        if (!ok) {
                          e.currentTarget.value = key;
                        }
                      }}
                      placeholder="key"
                    />
                    <button
                      className="array-item-remove"
                      onClick={() => removeObjectField(key)}
                      title="Remove field"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="schema-field-bottom">
                    <select
                      className="property-select schema-field-type"
                      value={t}
                      onChange={(e) => setObjectFieldType(key, e.target.value as JsonValueKind)}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="null">null</option>
                      <option value="object">object</option>
                      <option value="array">array</option>
                    </select>
                  </div>

                  <div className="io-pin-default">
                    {t === 'string' ? (
                      <input
                        type="text"
                        className="property-input"
                        value={String(v ?? '')}
                        onChange={(e) => setObjectField(key, e.target.value)}
                        placeholder="value"
                      />
                    ) : null}

                    {t === 'number' ? (
                      <input
                        type="number"
                        className="property-input"
                        value={typeof v === 'number' ? v : Number(v ?? 0)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setObjectField(key, n);
                        }}
                        step="any"
                      />
                    ) : null}

                    {t === 'boolean' ? (
                      <label className="toggle-container">
                        <input
                          type="checkbox"
                          className="toggle-checkbox"
                          checked={Boolean(v)}
                          onChange={(e) => setObjectField(key, e.target.checked)}
                        />
                        <span className="toggle-label">{v ? 'True' : 'False'}</span>
                      </label>
                    ) : null}

                    {t === 'null' ? <div className="object-null">null</div> : null}

                    {(t === 'object' || t === 'array') ? (
                      <textarea
                        className="property-input property-textarea code"
                        value={safeStringify(v)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value) as JsonValue;
                            setObjectField(key, parsed);
                          } catch {
                            // Keep editing; don't update until valid.
                          }
                        }}
                        rows={4}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
            <button className="array-add-button" onClick={addObjectField}>
              + Add Field
            </button>
          </div>
        </>
      ) : null}

      {isRootArray ? (
        <div className="array-editor">
          {arrayValue.map((item, index) => (
            <div key={index} className="array-item">
              <input
                type="text"
                className="property-input array-item-input"
                value={String(item ?? '')}
                onChange={(e) => setArrayItem(index, e.target.value)}
                placeholder={`Item ${index + 1}`}
              />
              <button
                className="array-item-remove"
                onClick={() => removeArrayItem(index)}
                title="Remove item"
              >
                &times;
              </button>
            </div>
          ))}
          <button className="array-add-button" onClick={addArrayItem}>
            + Add Item
          </button>
          <span className="property-hint">{arrayValue.length} items</span>
        </div>
      ) : null}

      <details className="raw-json-details">
        <summary>Raw JSON (advanced)</summary>
        <textarea
          className="property-input property-textarea code"
          value={rawText}
          onChange={(e) => setRawDraft(e.target.value)}
          onBlur={() => {
            const v = rawText.trim();
            if (!v) {
              setRawDraft('');
              onChange(isRootArray ? [] : {});
              return;
            }
            try {
              const parsed = JSON.parse(v) as JsonValue;
              if (isRootObject && !isJsonObject(parsed)) {
                // Keep draft; user can fix.
                return;
              }
              if (isRootArray && !isJsonArray(parsed)) {
                return;
              }
              setRawDraft('');
              onChange(parsed);
            } catch {
              // Keep invalid JSON in the textarea but don't update state.
            }
          }}
          placeholder={isRootArray ? '[\n  \"item\"\n]' : '{\n  \"key\": \"value\"\n}'}
          rows={8}
        />
      </details>
    </div>
  );
}


