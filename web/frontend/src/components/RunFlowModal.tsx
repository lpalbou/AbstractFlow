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
import type { WaitingInfo } from '../hooks/useWebSocket';

interface RunFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (inputData: Record<string, unknown>) => void;
  onRunAgain: () => void;
  isRunning: boolean;
  result: FlowRunResult | null;
  events?: ExecutionEvent[];
  isWaiting?: boolean;
  waitingInfo?: WaitingInfo | null;
  onResume?: (response: string) => void;
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
  onRunAgain,
  isRunning,
  result,
  events = [],
  isWaiting = false,
  waitingInfo = null,
  onResume,
}: RunFlowModalProps) {
  const { nodes, flowName } = useFlowStore();

  const nodeById = useMemo(() => {
    const map = new Map<string, (typeof nodes)[number]>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

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
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [resumeDraft, setResumeDraft] = useState('');

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

  // Clear resume draft when leaving waiting state
  useEffect(() => {
    if (!isWaiting) setResumeDraft('');
  }, [isWaiting]);

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

  type StepStatus = 'running' | 'completed' | 'waiting' | 'failed';
  type StepKind = 'node' | 'flow';

  type Step = {
    id: string;
    kind: StepKind;
    status: StepStatus;
    nodeId?: string;
    nodeLabel?: string;
    nodeType?: string;
    nodeIcon?: string;
    nodeColor?: string;
    output?: unknown;
    error?: string;
    waiting?: {
      prompt: string;
      choices: string[];
      allowFreeText: boolean;
      waitKey?: string;
      reason?: string;
    };
  };

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    const openByNode = new Map<string, number>();

    const nodeMeta = (nodeId: string | undefined) => {
      if (!nodeId) return null;
      const n = nodeById.get(nodeId);
      if (!n) return null;
      return {
        label: n.data.label || nodeId,
        type: n.data.nodeType,
        icon: n.data.icon,
        color: n.data.headerColor,
      };
    };

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'flow_start') {
        out.push({ id: `flow_start:${i}`, kind: 'flow', status: 'running' });
        continue;
      }

      if (ev.type === 'flow_complete') {
        out.push({ id: `flow_complete:${i}`, kind: 'flow', status: 'completed', output: ev.result });
        continue;
      }

      if (ev.type === 'flow_error') {
        out.push({ id: `flow_error:${i}`, kind: 'flow', status: 'failed', error: ev.error || 'Unknown error' });
        continue;
      }

      if (ev.type === 'node_start') {
        const meta = nodeMeta(ev.nodeId);
        const step: Step = {
          id: `node_start:${ev.nodeId || 'unknown'}:${i}`,
          kind: 'node',
          status: 'running',
          nodeId: ev.nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
        };
        out.push(step);
        if (ev.nodeId) openByNode.set(ev.nodeId, out.length - 1);
        continue;
      }

      if (ev.type === 'node_complete') {
        const nodeId = ev.nodeId;
        const idx = nodeId ? openByNode.get(nodeId) : undefined;
        if (typeof idx === 'number') {
          out[idx] = { ...out[idx], status: 'completed', output: ev.result };
          openByNode.delete(nodeId!);
          continue;
        }
        const meta = nodeMeta(nodeId);
        out.push({
          id: `node_complete:${nodeId || 'unknown'}:${i}`,
          kind: 'node',
          status: 'completed',
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          output: ev.result,
        });
        continue;
      }

      if (ev.type === 'flow_waiting') {
        const nodeId = ev.nodeId;
        const idx = nodeId ? openByNode.get(nodeId) : undefined;

        const waiting = {
          prompt: ev.prompt || 'Please respond:',
          choices: Array.isArray(ev.choices) ? ev.choices : [],
          allowFreeText: ev.allow_free_text !== false,
          waitKey: ev.wait_key,
          reason: ev.reason,
        };

        if (typeof idx === 'number') {
          out[idx] = { ...out[idx], status: 'waiting', waiting };
          openByNode.delete(nodeId!);
          continue;
        }

        const meta = nodeMeta(nodeId);
        out.push({
          id: `flow_waiting:${nodeId || 'unknown'}:${i}`,
          kind: 'node',
          status: 'waiting',
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          waiting,
        });
      }
    }

    return out;
  }, [events, nodeById]);

  // Keep selection valid; default to last step.
  useEffect(() => {
    if (!isOpen) return;
    if (steps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && steps.some((s) => s.id === selectedStepId)) return;
    setSelectedStepId(steps[steps.length - 1].id);
  }, [isOpen, steps, selectedStepId]);

  const selectedStep = useMemo(() => steps.find((s) => s.id === selectedStepId) || null, [steps, selectedStepId]);

  const hasRunData = isRunning || result != null || events.length > 0;

  const hexToRgba = (hex: string, alpha: number) => {
    const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return `rgba(255,255,255,${alpha})`;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const formatValue = (value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const copyToClipboard = async (value: unknown) => {
    const text = formatValue(value);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: best-effort legacy copy
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
  };

  const submitResume = () => {
    const response = resumeDraft.trim();
    if (!response) return;
    onResume?.(response);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal run-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="run-modal-header">
          <h3>▶ Run Flow</h3>
          <span className="run-modal-flow-name">{flowName || 'Untitled Flow'}</span>
        </div>

        {/* Execution (Steps + Details) */}
        {hasRunData && (
          <div className="run-modal-execution">
            <div className="run-steps">
              <div className="run-steps-header">
                <div className="run-steps-title">Execution</div>
                <div className="run-steps-subtitle">{isRunning ? 'Running…' : result ? 'Finished' : ''}</div>
              </div>

              <div className="run-steps-list">
                {steps.length === 0 ? (
                  <div className="run-steps-empty">No execution events yet.</div>
                ) : (
                  steps.map((s, idx) => {
                    const selected = s.id === selectedStepId;
                    const color = s.nodeColor || '#888888';
                    const bg = hexToRgba(color, 0.12);
                    const statusLabel =
                      s.status === 'running' ? 'running' : s.status === 'completed' ? 'completed' : s.status;

                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={selected ? 'run-step selected' : 'run-step'}
                        onClick={() => setSelectedStepId(s.id)}
                      >
                        <div className="run-step-border" style={{ background: color }} />
                        <div className="run-step-main">
                          <div className="run-step-top">
                            <span className="run-step-index">#{idx + 1}</span>
                            {s.kind === 'node' ? (
                              <>
                                {s.nodeIcon ? (
                                  <span
                                    className="run-step-icon"
                                    style={{ color }}
                                    dangerouslySetInnerHTML={{ __html: s.nodeIcon }}
                                  />
                                ) : null}
                                <span className="run-step-label">{s.nodeLabel || s.nodeId || 'node'}</span>
                                <span className="run-step-type" style={{ background: bg, borderColor: color }}>
                                  {s.nodeType || 'node'}
                                </span>
                              </>
                            ) : (
                              <span className="run-step-label">flow</span>
                            )}
                            <span className={`run-step-status ${s.status}`}>{statusLabel}</span>
                          </div>
                          {s.status === 'failed' && s.error ? (
                            <div className="run-step-error">{s.error}</div>
                          ) : s.status === 'waiting' && s.waiting ? (
                            <div className="run-step-waiting">{s.waiting.reason ? `waiting · ${s.waiting.reason}` : 'waiting'}</div>
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="run-details">
              <div className="run-details-header">
                <div className="run-details-title">
                  {selectedStep?.kind === 'node'
                    ? selectedStep.nodeLabel || selectedStep.nodeId || 'Step'
                    : selectedStep
                      ? 'Flow'
                      : 'Details'}
                </div>
                {selectedStep?.nodeType ? (
                  <span
                    className="run-details-type"
                    style={{
                      borderColor: selectedStep.nodeColor || '#888888',
                      background: hexToRgba(selectedStep.nodeColor || '#888888', 0.12),
                    }}
                  >
                    {selectedStep.nodeType}
                  </span>
                ) : null}
              </div>

              {selectedStep ? (
                <div className="run-details-body">
                  {selectedStep.status === 'waiting' && (waitingInfo || selectedStep.waiting) ? (
                    <div className="run-waiting">
                      <div className="run-waiting-prompt">
                        {(selectedStep.waiting?.prompt || waitingInfo?.prompt || 'Please respond:').trim()}
                      </div>

                      {(selectedStep.waiting?.choices?.length || waitingInfo?.choices?.length) ? (
                        <div className="run-waiting-choices">
                          {(selectedStep.waiting?.choices || waitingInfo?.choices || []).map((c) => (
                            <button
                              key={c}
                              type="button"
                              className="run-waiting-choice"
                              onClick={() => onResume?.(c)}
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {(selectedStep.waiting?.allowFreeText ?? waitingInfo?.allowFreeText ?? true) && (
                        <div className="run-waiting-input">
                          <textarea
                            className="run-waiting-textarea"
                            value={resumeDraft}
                            onChange={(e) => setResumeDraft(e.target.value)}
                            placeholder="Type your response…"
                            rows={3}
                          />
                          <div className="run-waiting-actions">
                            <button
                              type="button"
                              className="modal-button primary"
                              onClick={submitResume}
                              disabled={!resumeDraft.trim()}
                            >
                              Continue
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : selectedStep.status === 'failed' && selectedStep.error ? (
                    <div className="run-details-error">{selectedStep.error}</div>
                  ) : selectedStep.output != null ? (
                    <>
                      <div className="run-details-actions">
                        <button type="button" className="modal-button" onClick={() => copyToClipboard(selectedStep.output)}>
                          Copy
                        </button>
                      </div>
                      <pre className="run-details-output">{formatValue(selectedStep.output)}</pre>
                    </>
                  ) : (
                    <div className="run-details-empty">No output for this step.</div>
                  )}

                  {result && !isRunning ? (
                    <div className="run-final">
                      <div className={`run-final-header ${result.success ? 'success' : 'error'}`}>
                        <span className="run-final-title">{result.success ? 'Final Result' : 'Flow Failed'}</span>
                        <div className="run-details-actions">
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(result.error ?? result.result)}>
                            Copy
                          </button>
                        </div>
                      </div>
                      {result.error ? (
                        <div className="run-details-error">{result.error}</div>
                      ) : (
                        <pre className="run-details-output">{formatValue(result.result)}</pre>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="run-details-body">
                  <div className="run-details-empty">Select a step to inspect outputs.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input form */}
        {!hasRunData && !result && (
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
            {hasRunData || result ? 'Close' : 'Cancel'}
          </button>

          {!hasRunData && !result && (
            <button
              className="modal-button primary"
              onClick={handleSubmit}
              disabled={isRunning || !entryNode}
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
          )}

          {(hasRunData || result) && (
            <button
              className="modal-button primary"
              onClick={() => {
                onRunAgain();
              }}
              disabled={isRunning}
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
