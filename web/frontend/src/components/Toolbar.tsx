/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import { useWebSocket } from '../hooks/useWebSocket';
import { RunFlowModal } from './RunFlowModal';
import { UserPromptModal } from './UserPromptModal';
import type { ExecutionEvent, FlowRunResult, VisualFlow } from '../types/flow';

// Fetch list of saved flows
async function listFlows(): Promise<VisualFlow[]> {
  const response = await fetch('/api/flows');
  if (!response.ok) {
    throw new Error('Failed to fetch flows');
  }
  return response.json();
}

// Load a specific flow
async function fetchFlow(flowId: string): Promise<VisualFlow> {
  const response = await fetch(`/api/flows/${flowId}`);
  if (!response.ok) {
    throw new Error('Failed to load flow');
  }
  return response.json();
}

// API functions
async function saveFlow(
  flow: VisualFlow,
  existingFlowId: string | null
): Promise<VisualFlow> {
  // Use existingFlowId to determine if this is an update or create
  // flow.id may have a generated value even for new flows
  const method = existingFlowId ? 'PUT' : 'POST';
  const url = existingFlowId ? `/api/flows/${existingFlowId}` : '/api/flows';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: flow.name,
      description: flow.description,
      nodes: flow.nodes,
      edges: flow.edges,
      entryNode: flow.entryNode,
    }),
  });

  if (!response.ok) {
    // Get detailed error from backend
    const error = await response.json().catch(() => ({}));
    const message = error.detail
      ? (Array.isArray(error.detail)
        ? error.detail.map((e: { msg: string }) => e.msg).join(', ')
        : error.detail)
      : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}

export function Toolbar() {
  const { flowId, flowName, nodes, setFlowName, getFlow, loadFlow, clearFlow, isRunning, setIsRunning } =
    useFlowStore();

  const [showRunModal, setShowRunModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [runResult, setRunResult] = useState<FlowRunResult | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);

  // Query for listing saved flows
  const flowsQuery = useQuery({
    queryKey: ['flows'],
    queryFn: listFlows,
    enabled: showLoadModal, // Only fetch when modal is open
  });

  // Handle loading a flow
  const handleLoadFlow = useCallback(
    async (selectedFlowId: string) => {
      try {
        const flow = await fetchFlow(selectedFlowId);
        loadFlow(flow);
        setShowLoadModal(false);
        toast.success(`Loaded "${flow.name}"`);
      } catch (error) {
        toast.error('Failed to load flow');
      }
    },
    [loadFlow]
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ flow, existingFlowId }: { flow: VisualFlow; existingFlowId: string | null }) =>
      saveFlow(flow, existingFlowId),
    onSuccess: (savedFlow) => {
      loadFlow(savedFlow);
      toast.success('Flow saved!');
    },
    onError: (error) => {
      toast.error(`Save failed: ${error.message}`);
    },
  });

  // WebSocket for real-time execution (if flow is saved)
  const { isWaiting, waitingInfo, resumeFlow, runFlow } = useWebSocket({
    flowId: flowId || '',
    onEvent: (event) => {
      console.log('Execution event:', event);
      if (event.type === 'flow_start') {
        setRunResult(null);
        setExecutionEvents([event]);
        return;
      }
      setExecutionEvents((prev) => [...prev, event]);

      if (event.type === 'node_complete' && event.nodeId) {
        const node = nodes.find((n) => n.id === event.nodeId);
        if (node?.data.nodeType === 'answer_user') {
          const payload = event.result as unknown;
          const message =
            typeof payload === 'string'
              ? payload
              : payload && typeof payload === 'object' && 'message' in (payload as Record<string, unknown>)
                ? String((payload as Record<string, unknown>).message ?? '')
                : '';
          if (message.trim()) toast(message.trim());
        }
      }

      // Update run result when flow completes via WebSocket
      if (event.type === 'flow_complete') {
        const payload = event.result as unknown;
        const payloadObj = payload as Record<string, unknown> | null;
        const reportedSuccess =
          payloadObj &&
          typeof payloadObj === 'object' &&
          'success' in payloadObj &&
          payloadObj.success === false
            ? false
            : true;

        if (!reportedSuccess) {
          setRunResult({
            success: false,
            error:
              (payloadObj && typeof payloadObj.error === 'string' ? payloadObj.error : null) ||
              'Flow failed',
            result: payloadObj?.result ?? null,
          });
          toast.error('Flow failed');
        } else {
          setRunResult({
            success: true,
            result: payload,
          });
          toast.success('Flow completed!');
        }
      } else if (event.type === 'flow_error') {
        setRunResult({
          success: false,
          error: event.error || 'Unknown error',
        });
        toast.error(`Flow failed: ${event.error || 'Unknown error'}`);
      }
    },
    onWaiting: (info) => {
      console.log('Flow waiting for user input:', info);
      toast('Flow is waiting for your response');
    },
  });

  // Handle user prompt response (legacy/fallback modal)
  const handlePromptSubmit = useCallback((response: string) => {
    resumeFlow(response);
  }, [resumeFlow]);

  // Handle save
  const handleSave = useCallback(() => {
    const flow = getFlow();
    if (!flow.name.trim()) {
      toast.error('Please enter a flow name');
      return;
    }
    saveMutation.mutate({ flow, existingFlowId: flowId });
  }, [getFlow, saveMutation, flowId]);

  // Handle run - open modal
  const handleRun = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setRunResult(null); // Clear previous result
    setShowRunModal(true);
  }, [flowId]);

  // Handle run from modal
  const handleRunExecute = useCallback((inputData: Record<string, unknown>) => {
    if (!flowId) return;
    setIsRunning(true);
    setRunResult(null);
    setExecutionEvents([]);
    runFlow(inputData);
  }, [flowId, runFlow, setIsRunning]);

  // Handle modal close
  const handleRunModalClose = useCallback(() => {
    if (!isRunning) {
      setShowRunModal(false);
      setRunResult(null);
      setExecutionEvents([]);
    }
  }, [isRunning]);

  const handleRunAgain = useCallback(() => {
    if (isRunning) return;
    setRunResult(null);
    setExecutionEvents([]);
  }, [isRunning]);

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
          📄 New
        </button>

        <button
          className="toolbar-button"
          onClick={() => setShowLoadModal(true)}
          title="Load Flow"
        >
          📂 Load
        </button>

        <button
          className="toolbar-button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          title="Save Flow"
        >
          💾 Save
        </button>

        <button
          className="toolbar-button primary"
          onClick={handleRun}
          disabled={isRunning || !flowId}
          title="Run Flow"
        >
          {isRunning ? '⏳ Running...' : '▶ Run'}
        </button>

        <div className="toolbar-divider" />

        <button
          className="toolbar-button"
          onClick={handleExport}
          title="Export Flow"
        >
          📤 Export
        </button>

        <button
          className="toolbar-button"
          onClick={handleImport}
          title="Import Flow"
        >
          📥 Import
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

      {/* Smart Run Modal */}
      <RunFlowModal
        isOpen={showRunModal}
        onClose={handleRunModalClose}
        onRun={handleRunExecute}
        onRunAgain={handleRunAgain}
        isRunning={isRunning}
        result={runResult}
        events={executionEvents}
        isWaiting={isWaiting}
        waitingInfo={waitingInfo}
        onResume={resumeFlow}
      />

      {/* Load flows modal */}
      {showLoadModal && (
        <div className="modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Load Flow</h3>
            {flowsQuery.isLoading ? (
              <p>Loading saved flows...</p>
            ) : flowsQuery.error ? (
              <p className="error-text">Failed to load flows</p>
            ) : flowsQuery.data?.length === 0 ? (
              <p>No saved flows found.</p>
            ) : (
              <ul className="flow-list">
                {flowsQuery.data?.map((flow) => (
                  <li key={flow.id} className="flow-list-item">
                    <button
                      className="flow-list-button"
                      onClick={() => handleLoadFlow(flow.id)}
                    >
                      <span className="flow-list-name">{flow.name}</span>
                      <span className="flow-list-meta">
                        {flow.nodes.length} nodes &bull; {flow.edges.length} edges
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <button
                className="modal-button cancel"
                onClick={() => setShowLoadModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Prompt Modal (fallback) */}
      <UserPromptModal
        isOpen={isWaiting && !showRunModal}
        prompt={waitingInfo?.prompt || 'Please respond:'}
        choices={waitingInfo?.choices || []}
        allowFreeText={waitingInfo?.allowFreeText ?? true}
        onSubmit={handlePromptSubmit}
      />
    </>
  );
}

export default Toolbar;
