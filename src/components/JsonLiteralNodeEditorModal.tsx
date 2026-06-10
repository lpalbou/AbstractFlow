import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JsonValue } from '../types/flow';
import {
  defaultStructuredOutputSchema,
  JsonSchemaEditor,
  validateStructuredOutputSchema,
} from './JsonSchemaEditor';
import { JsonValueEditor } from './JsonValueEditor';

type JsonLiteralEditorKind = 'json' | 'json_schema';

interface JsonLiteralNodeEditorModalProps {
  isOpen: boolean;
  kind: JsonLiteralEditorKind;
  nodeId: string;
  nodeLabel: string;
  title?: string;
  subtitle?: string;
  jsonHint?: string;
  schemaHint?: string;
  value: unknown;
  onClose: () => void;
  onSave: (nextValue: JsonValue) => void;
}

function jsonValueFrom(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(jsonValueFrom);
  if (value && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonValueFrom(item);
    }
    return out;
  }
  return {};
}

function objectJsonValueFrom(value: unknown): Record<string, JsonValue> {
  const parsed = jsonValueFrom(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  return {};
}

function schemaRecordFrom(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return defaultStructuredOutputSchema();
}

export function JsonLiteralNodeEditorModal({
  isOpen,
  kind,
  nodeId,
  nodeLabel,
  title,
  subtitle,
  jsonHint = 'Define the JSON object emitted by this node.',
  schemaHint = 'Define the JSON Schema object emitted by this node.',
  value,
  onClose,
  onSave,
}: JsonLiteralNodeEditorModalProps) {
  const initialJsonDraft = useMemo(() => objectJsonValueFrom(value), [value, isOpen]);
  const initialSchemaDraft = useMemo(() => schemaRecordFrom(value), [value, isOpen]);
  const [jsonDraft, setJsonDraft] = useState<JsonValue>(initialJsonDraft);
  const [schemaDraft, setSchemaDraft] = useState<Record<string, any>>(initialSchemaDraft);
  const [schemaValid, setSchemaValid] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const nextSchema = schemaRecordFrom(value);
    setJsonDraft(objectJsonValueFrom(value));
    setSchemaDraft(nextSchema);
    setSchemaValid(validateStructuredOutputSchema(nextSchema) === null);
  }, [isOpen, kind, value]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    document.body.classList.add('af-schema-editor-open');
    return () => document.body.classList.remove('af-schema-editor-open');
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const isSchema = kind === 'json_schema';
  const modalTitle = title || (isSchema ? 'JSON Schema' : 'JSON');
  const modalSubtitle = subtitle || (nodeLabel ? `${nodeLabel} - ${nodeId}` : nodeId);

  return createPortal(
    <div className="modal-overlay schema-pin-editor-overlay" onClick={onClose}>
      <div
        className="modal schema-pin-editor-modal json-literal-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${modalTitle}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3>{modalTitle}</h3>
            <p className="schema-pin-editor-subtitle">{modalSubtitle}</p>
          </div>
          <button type="button" className="modal-button schema-pin-editor-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className="modal-body schema-pin-editor-body">
          {isSchema ? (
            <JsonSchemaEditor
              nodeId={`${nodeId}:json-schema-node:${isOpen ? 'open' : 'closed'}`}
              schema={initialSchemaDraft}
              onChange={setSchemaDraft}
              onValidityChange={setSchemaValid}
              commitJsonOnChange
              jsonHeight="360px"
              label="Object shape"
              fieldsTabLabel="Builder"
              jsonTabLabel="JSON Schema"
              hint={schemaHint}
            />
          ) : (
            <JsonValueEditor
              label="Fields"
              rootKind="object"
              value={jsonDraft}
              onChange={setJsonDraft}
              hint={jsonHint}
            />
          )}
        </div>

        <div className="modal-actions schema-pin-editor-actions">
          <button type="button" className="modal-button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-button primary"
            disabled={isSchema && !schemaValid}
            onClick={() => {
              if (isSchema) {
                if (!schemaValid) return;
                onSave(schemaDraft as JsonValue);
              } else {
                onSave(jsonDraft);
              }
              onClose();
            }}
          >
            {isSchema ? 'Save Schema' : 'Save JSON'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
