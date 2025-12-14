/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import { useWebSocket } from '../hooks/useWebSocket';
import type { FlowRunResult, VisualFlow } from '../types/flow';

// API functions
async function saveFlow(flow: VisualFlow): Promise<VisualFlow> {
  const method = flow.id ? 'PUT' : 'POST';
  const url = flow.id ? `/api/flows/${flow.id}` : '/api/flows';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flow),
  });

  if (!response.ok) {
    throw new Error('Failed to save flow');
  }

  return response.json();
}

async function runFlow(
  flowId: string,
  inputData: Record<string, unknown>
): Promise<FlowRunResult> {
  const response = await fetch(`/api/flows/${flowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_data: inputData }),
  });

  if (!response.ok) {
    throw new Error('Failed to run flow');
  }

  return response.json();
}

export function Toolbar() {
  const { flowId, flowName, setFlowName, getFlow, loadFlow, clearFlow, isRunning, setIsRunning } =
    useFlowStore();

  const [showInputModal, setShowInputModal] = useState(false);
  const [runInput, setRunInput] = useState('{}');

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: saveFlow,
    onSuccess: (savedFlow) => {
      loadFlow(savedFlow);
      toast.success('Flow saved!');
    },
    onError: (error) => {
      toast.error(`Save failed: ${error.message}`);
    },
  });

  // Run mutation
  const runMutation = useMutation({
    mutationFn: ({
      flowId,
      inputData,
    }: {
      flowId: string;
      inputData: Record<string, unknown>;
    }) => runFlow(flowId, inputData),
    onMutate: () => {
      setIsRunning(true);
    },
    onSuccess: (result) => {
      setIsRunning(false);
      if (result.success) {
        toast.success('Flow completed!');
        console.log('Flow result:', result.result);
      } else {
        toast.error(`Flow failed: ${result.error}`);
      }
    },
    onError: (error) => {
      setIsRunning(false);
      toast.error(`Run failed: ${error.message}`);
    },
  });

  // WebSocket for real-time execution (if flow is saved)
  useWebSocket({
    flowId: flowId || '',
    onEvent: (event) => {
      console.log('Execution event:', event);
    },
  });

  // Handle save
  const handleSave = useCallback(() => {
    const flow = getFlow();
    if (!flow.name.trim()) {
      toast.error('Please enter a flow name');
      return;
    }
    saveMutation.mutate(flow);
  }, [getFlow, saveMutation]);

  // Handle run
  const handleRun = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setShowInputModal(true);
  }, [flowId]);

  const handleRunConfirm = useCallback(() => {
    if (!flowId) return;

    try {
      const inputData = JSON.parse(runInput);
      runMutation.mutate({ flowId, inputData });
      setShowInputModal(false);
    } catch (e) {
      toast.error('Invalid JSON input');
    }
  }, [flowId, runInput, runMutation]);

  // Handle export
  const handleExport = useCallback(() => {
    const flow = getFlow();
    const json = JSON.stringify(flow, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${flow.name || 'flow'}.json`;
    a.click();

    URL.revokeObjectURL(url);
    toast.success('Flow exported!');
  }, [getFlow]);

  // Handle import
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const flow = JSON.parse(text) as VisualFlow;
        loadFlow(flow);
        toast.success('Flow imported!');
      } catch (err) {
        toast.error('Failed to import flow');
      }
    };

    input.click();
  }, [loadFlow]);

  // Handle new flow
  const handleNew = useCallback(() => {
    if (
      confirm(
        'Create a new flow? Any unsaved changes will be lost.'
      )
    ) {
      clearFlow();
      toast.success('Created new flow');
    }
  }, [clearFlow]);

  return (
    <>
      <div className="toolbar">
        {/* Flow name input */}
        <input
          type="text"
          className="flow-name-input"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder="Flow name..."
        />

        <div className="toolbar-divider" />

        {/* Actions */}
        <button
          className="toolbar-button"
          onClick={handleNew}
          title="New Flow"
        >
          &#x1F4C4; New
        </button>

        <button
          className="toolbar-button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          title="Save Flow"
        >
          &#x1F4BE; Save
        </button>

        <button
          className="toolbar-button primary"
          onClick={handleRun}
          disabled={isRunning || !flowId}
          title="Run Flow"
        >
          {isRunning ? '&#x23F3; Running...' : '&#x25B6; Run'}
        </button>

        <div className="toolbar-divider" />

        <button
          className="toolbar-button"
          onClick={handleExport}
          title="Export Flow"
        >
          &#x1F4E4; Export
        </button>

        <button
          className="toolbar-button"
          onClick={handleImport}
          title="Import Flow"
        >
          &#x1F4E5; Import
        </button>

        {/* Status indicator */}
        <div className="toolbar-status">
          <span
            className={`status-dot ${
              isRunning ? 'running' : flowId ? 'saved' : 'unsaved'
            }`}
          />
          <span className="status-text">
            {isRunning
              ? 'Running'
              : flowId
              ? 'Saved'
              : 'Unsaved'}
          </span>
        </div>
      </div>

      {/* Run input modal */}
      {showInputModal && (
        <div className="modal-overlay" onClick={() => setShowInputModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Run Flow</h3>
            <p>Enter input data (JSON):</p>
            <textarea
              className="modal-textarea"
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              rows={6}
              placeholder='{"key": "value"}'
            />
            <div className="modal-actions">
              <button
                className="modal-button cancel"
                onClick={() => setShowInputModal(false)}
              >
                Cancel
              </button>
              <button
                className="modal-button primary"
                onClick={handleRunConfirm}
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Toolbar;
