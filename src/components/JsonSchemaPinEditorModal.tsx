import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Pin } from '../types/flow';
import {
  defaultStructuredOutputSchema,
  JsonSchemaEditor,
  validateStructuredOutputSchema,
} from './JsonSchemaEditor';
import { hasJsonSchemaPinDefault } from '../utils/jsonSchemaPins';

interface JsonSchemaPinEditorModalProps {
  isOpen: boolean;
  nodeLabel: string;
  pin: Pin | null;
  schema: unknown;
  hint?: string;
  onClose: () => void;
  onSave: (schema: Record<string, any>) => void;
  onClear: () => void;
}

function schemaRecord(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  return defaultStructuredOutputSchema();
}

function titleForPin(pin: Pin): string {
  const raw = (pin.label || pin.id || '').trim();
  if (raw === 'resp_schema' || raw === 'response_schema') return 'Response schema';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

export function JsonSchemaPinEditorModal({
  isOpen,
  nodeLabel,
  pin,
  schema,
  hint,
  onClose,
  onSave,
  onClear,
}: JsonSchemaPinEditorModalProps) {
  const initialDraft = useMemo(() => schemaRecord(schema), [schema, pin?.id, isOpen]);
  const [draftSchema, setDraftSchema] = useState<Record<string, any>>(initialDraft);
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    const nextDraft = schemaRecord(schema);
    setDraftSchema(nextDraft);
    setIsValid(validateStructuredOutputSchema(nextDraft) === null);
  }, [isOpen, pin?.id, schema]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    document.body.classList.add('af-schema-editor-open');
    return () => document.body.classList.remove('af-schema-editor-open');
  }, [isOpen]);

  if (!isOpen || !pin) return null;
  if (typeof document === 'undefined') return null;

  const hasExistingSchema = hasJsonSchemaPinDefault(schema);
  const pinTitle = titleForPin(pin);

  return createPortal(
    <div className="modal-overlay schema-pin-editor-overlay" onClick={onClose}>
      <div
        className="modal schema-pin-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${pinTitle} JSON Schema`}
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
            <h3>{pinTitle}</h3>
            <p className="schema-pin-editor-subtitle">
              {nodeLabel ? `${nodeLabel} · ${pin.id}` : pin.id}
            </p>
          </div>
          <button type="button" className="modal-button schema-pin-editor-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        <div className="modal-body schema-pin-editor-body">
          <JsonSchemaEditor
            nodeId={`${nodeLabel}:${pin.id}:${isOpen ? 'open' : 'closed'}`}
            schema={initialDraft}
            onChange={setDraftSchema}
            onValidityChange={setIsValid}
            commitJsonOnChange
            jsonHeight="360px"
            label="Object shape"
            fieldsTabLabel="Builder"
            jsonTabLabel="JSON Schema"
            hint={hint || 'Define the object the model should return when this pin is not connected. Connected schema inputs override this default.'}
          />
        </div>

        <div className="modal-actions schema-pin-editor-actions">
          {hasExistingSchema && (
            <button
              type="button"
              className="modal-button danger schema-pin-editor-clear"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              Clear
            </button>
          )}
          <button type="button" className="modal-button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-button primary"
            disabled={!isValid}
            onClick={() => {
              if (!isValid) return;
              onSave(draftSchema);
              onClose();
            }}
          >
            Save Schema
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
