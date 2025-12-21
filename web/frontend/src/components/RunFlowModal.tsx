/**
 * Smart Run Flow Modal
 *
 * Auto-generates form fields based on the entry node's output pins.
 * Shows execution progress and results.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useFlowStore } from '../hooks/useFlow';
import type { ExecutionEvent, Pin, FlowRunResult } from '../types/flow';
import { isEntryNodeType } from '../types/flow';

interface RunFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (inputData: Record<string, unknown>) => void;
  isRunning: boolean;
  result: FlowRunResult | null;
  events?: ExecutionEvent[];
}

// Map pin types to input field types
function getInputTypeForPin(pinType: string): 'text' | 'number' | 'checkbox' | 'textarea' {
  switch (pinType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'object':
    case 'array':
      return 'textarea';
    default:
      return 'text';
  }
}

// Get placeholder text for pin type
function getPlaceholderForPin(pin: Pin): string {
  switch (pin.type) {
    case 'string':
      return `Enter ${pin.label}...`;
    case 'number':
      return '0';
    case 'object':
      return '{ }';
    case 'array':
      return '[ ]';
    default:
      return '';
  }
}

export function RunFlowModal({
  isOpen,
  onClose,
  onRun,
  isRunning,
  result,
  events = [],
}: RunFlowModalProps) {
  const { nodes, flowName } = useFlowStore();

  // Find the entry node (node with no incoming execution edges, typically event nodes)
  const entryNode = useMemo(() => {
    // Look for event nodes first
    const eventNode = nodes.find((n) => isEntryNodeType(n.data.nodeType));
    if (eventNode) return eventNode;

    // Fallback to first node
    return nodes[0];
  }, [nodes]);

  // Get output pins from entry node (these become the input form)
  const inputPins = useMemo(() => {
    if (!entryNode) return [];
    return entryNode.data.outputs.filter(p => p.type !== 'execution');
  }, [entryNode]);

  // Form state for each input pin
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  // Initialize form values when modal opens
  useEffect(() => {
    if (isOpen && inputPins.length > 0) {
      const initialValues: Record<string, string> = {};
      inputPins.forEach(pin => {
        initialValues[pin.id] = '';
      });
      setFormValues(initialValues);
    }
  }, [isOpen, inputPins]);

  // Update a form field
  const handleFieldChange = useCallback((pinId: string, value: string) => {
    setFormValues(prev => ({ ...prev, [pinId]: value }));
  }, []);

  // Submit the form
  const handleSubmit = useCallback(() => {
    // Build input data from form values
    const inputData: Record<string, unknown> = {};

    inputPins.forEach(pin => {
      const value = formValues[pin.id] || '';

      // Parse based on type
      switch (pin.type) {
        case 'number':
          inputData[pin.id] = parseFloat(value) || 0;
          break;
        case 'boolean':
          inputData[pin.id] = value === 'true' || value === '1';
          break;
        case 'object':
        case 'array':
          try {
            inputData[pin.id] = JSON.parse(value || (pin.type === 'array' ? '[]' : '{}'));
          } catch {
            inputData[pin.id] = pin.type === 'array' ? [] : {};
          }
          break;
        default:
          inputData[pin.id] = value;
      }
    });

    onRun(inputData);
  }, [formValues, inputPins, onRun]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal run-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="run-modal-header">
          <h3>▶ Run Flow</h3>
          <span className="run-modal-flow-name">{flowName || 'Untitled Flow'}</span>
        </div>

        {/* Show result if available */}
        {result && !isRunning && (
          <div className={`run-result ${result.success ? 'success' : 'error'}`}>
            <div className="run-result-header">
              <span className="run-result-icon">{result.success ? '✓' : '✗'}</span>
              <span className="run-result-title">
                {result.success ? 'Flow Completed Successfully' : 'Flow Failed'}
              </span>
            </div>
            <div className="run-result-body">
              {result.error ? (
                <p className="run-result-error">{result.error}</p>
              ) : (
                <pre className="run-result-output">
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Execution timeline */}
        {events.length > 0 && (
          <div className="run-execution">
            <h4 className="run-execution-title">Execution</h4>
            <div className="run-execution-events">
              {events.map((ev, idx) => {
                const label =
                  ev.type === 'node_start'
                    ? `node_start · ${ev.nodeId || ''}`
                    : ev.type === 'node_complete'
                      ? `node_complete · ${ev.nodeId || ''}`
                      : ev.type === 'flow_waiting'
                        ? `flow_waiting · ${ev.nodeId || ''}`
                        : ev.type === 'flow_error'
                          ? 'flow_error'
                          : ev.type;

                const hasResult = ev.type === 'node_complete' && ev.result != null;

                return (
                  <div key={`${idx}-${ev.type}-${ev.nodeId || ''}`} className="run-execution-event">
                    <div className="run-execution-event-header">
                      <span className="run-execution-event-type">{label}</span>
                      {ev.type === 'flow_error' && ev.error && (
                        <span className="run-execution-event-error">{ev.error}</span>
                      )}
                    </div>
                    {hasResult && (
                      <details className="run-execution-event-details">
                        <summary>output</summary>
                        <pre className="run-execution-event-output">
                          {JSON.stringify(ev.result, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Input form */}
        {!result && (
          <>
            {entryNode ? (
              <div className="run-form">
                <p className="run-form-intro">
                  Entry point: <strong>{entryNode.data.label}</strong>
                </p>

                {inputPins.length === 0 ? (
                  <p className="run-form-note">
                    This flow has no input parameters. Click Run to execute.
                  </p>
                ) : (
                  <div className="run-form-fields">
                    {inputPins.map(pin => {
                      const inputType = getInputTypeForPin(pin.type);

                      return (
                        <div key={pin.id} className="run-form-field">
                          <label className="run-form-label">
                            {pin.label}
                            <span className="run-form-type">({pin.type})</span>
                          </label>

                          {inputType === 'textarea' ? (
                            <textarea
                              className="run-form-input"
                              value={formValues[pin.id] || ''}
                              onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                              placeholder={getPlaceholderForPin(pin)}
                              rows={3}
                              disabled={isRunning}
                            />
                          ) : inputType === 'checkbox' ? (
                            <label className="run-form-checkbox">
                              <input
                                type="checkbox"
                                checked={formValues[pin.id] === 'true'}
                                onChange={(e) => handleFieldChange(pin.id, e.target.checked ? 'true' : 'false')}
                                disabled={isRunning}
                              />
                              <span>{pin.label}</span>
                            </label>
                          ) : (
                            <input
                              type={inputType}
                              className="run-form-input"
                              value={formValues[pin.id] || ''}
                              onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                              placeholder={getPlaceholderForPin(pin)}
                              disabled={isRunning}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="run-form-note">
                No nodes in this flow. Add an entry node to run.
              </p>
            )}
          </>
        )}

        {/* Actions */}
        <div className="modal-actions">
          <button
            className="modal-button cancel"
            onClick={onClose}
            disabled={isRunning}
          >
            {result ? 'Close' : 'Cancel'}
          </button>

          {!result && (
            <button
              className="modal-button primary"
              onClick={handleSubmit}
              disabled={isRunning || !entryNode}
            >
              {isRunning ? '⏳ Running...' : '▶ Run'}
            </button>
          )}

          {result && (
            <button
              className="modal-button primary"
              onClick={() => {
                // Reset to run again
                setFormValues({});
                onClose();
              }}
            >
              Run Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RunFlowModal;
