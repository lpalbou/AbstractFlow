/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import { useWebSocket } from '../hooks/useWebSocket';
import { RunFlowModal } from './RunFlowModal';
import { RunHistoryModal } from './RunHistoryModal';
import { UserPromptModal } from './UserPromptModal';
import { FlowLibraryModal } from './FlowLibraryModal';
import type { ExecutionEvent, FlowRunResult, VisualFlow, RunHistoryResponse, RunSummary } from '../types/flow';
import { computeRunPreflightIssues } from '../utils/preflight';

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

async function deleteFlow(flowId: string): Promise<void> {
  const response = await fetch(`/api/flows/${flowId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete flow');
}

async function renameFlow(flowId: string, name: string): Promise<VisualFlow> {
  const response = await fetch(`/api/flows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

async function updateFlowDescription(flowId: string, description: string): Promise<VisualFlow> {
  const response = await fetch(`/api/flows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

async function duplicateFlow(source: VisualFlow, newName: string): Promise<VisualFlow> {
  const response = await fetch('/api/flows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: newName,
      description: source.description || '',
      nodes: source.nodes,
      edges: source.edges,
      entryNode: source.entryNode,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
    throw new Error(message);
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
  const queryClient = useQueryClient();
  const {
    flowId,
    flowName,
    setFlowName,
    setFlowId,
    getFlow,
    loadFlow,
    clearFlow,
    isRunning,
    setIsRunning,
    nodes,
    edges,
    setPreflightIssues,
    clearPreflightIssues,
  } = useFlowStore();

  const [showRunModal, setShowRunModal] = useState(false);
  const [showFlowLibrary, setShowFlowLibrary] = useState(false);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [runResult, setRunResult] = useState<FlowRunResult | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [traceEvents, setTraceEvents] = useState<ExecutionEvent[]>([]);
  const [inspectedRun, setInspectedRun] = useState<RunSummary | null>(null);
  const [inspectedEvents, setInspectedEvents] = useState<ExecutionEvent[]>([]);
  const [inspectedTraceEvents, setInspectedTraceEvents] = useState<ExecutionEvent[]>([]);

  async function fetchRunHistory(runId: string): Promise<RunHistoryResponse> {
    const response = await fetch(`/api/runs/${runId}/history`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return response.json();
  }

  // When viewing a persisted run that is still active (running/waiting), keep the UI fresh by
  // polling its durable ledger state. This provides "reattach" behavior even if the original
  // WebSocket session was interrupted.
  useEffect(() => {
    if (!showRunModal) return;
    if (!inspectedRun?.run_id) return;

    const st = (inspectedRun.status || '').toLowerCase();
    if (st === 'completed' || st === 'failed' || st === 'cancelled') return;

    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchRunHistory(inspectedRun.run_id);
        if (cancelled) return;
        setInspectedRun(data.run);
        setInspectedEvents(Array.isArray(data.events) ? data.events : []);
      } catch {
        // ignore transient errors (user may be offline / server restarting)
      }
    };

    // Immediate refresh + then poll.
    void tick();
    const interval = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [inspectedRun?.run_id, inspectedRun?.status, showRunModal]);

  // Query for listing saved flows
  const flowsQuery = useQuery({
    queryKey: ['flows'],
    queryFn: listFlows,
    enabled: showFlowLibrary, // Only fetch when modal is open
  });

  // Handle loading a flow
  const handleLoadFlow = useCallback(
    async (selectedFlowId: string) => {
      try {
        const flow = await fetchFlow(selectedFlowId);
        loadFlow(flow);
        setShowFlowLibrary(false);
        toast.success(`Loaded "${flow.name}"`);
      } catch (error) {
        toast.error('Failed to load flow');
      }
    },
    [loadFlow]
  );

  const handleRenameFlow = useCallback(
    async (id: string, nextName: string) => {
      const name = nextName.trim();
      if (!name) return;
      const updated = await renameFlow(id, name);
      if (flowId && id === flowId) setFlowName(updated.name);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Renamed');
    },
    [flowId, queryClient, setFlowName]
  );

  const handleUpdateDescription = useCallback(
    async (id: string, nextDescription: string) => {
      const updated = await updateFlowDescription(id, nextDescription);
      // If we are currently editing that flow, keep the in-editor description in sync by reloading.
      if (flowId && id === flowId) {
        // We only have the flow name in store; description lives in the saved flow object.
        // Loading is the simplest way to keep all metadata consistent.
        loadFlow(updated);
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Description updated');
    },
    [flowId, loadFlow, queryClient]
  );

  const handleDeleteFlow = useCallback(
    async (id: string) => {
      await deleteFlow(id);
      if (flowId && id === flowId) {
        // Keep the current graph but mark it as unsaved.
        setFlowId(null);
        toast.success('Deleted (editor is now unsaved)');
      } else {
        toast.success('Deleted');
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
    },
    [flowId, queryClient, setFlowId]
  );

  const handleDuplicateFlow = useCallback(
    async (id: string) => {
      const all = flowsQuery.data || [];
      const src = all.find((f) => f.id === id);
      if (!src) return;
      const base = (src.name || 'Untitled').trim() || 'Untitled';
      const created = await duplicateFlow(src, `${base} (copy)`);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      loadFlow(created);
      setShowFlowLibrary(false);
      toast.success(`Duplicated as "${created.name}"`);
    },
    [flowsQuery.data, loadFlow, queryClient]
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
  const { isWaiting, isPaused, waitingInfo, resumeFlow, runFlow, pauseRun, resumeRun, cancelRun } = useWebSocket({
    flowId: flowId || '',
    onEvent: (event) => {
      console.log('Execution event:', event);
      if (event.type === 'flow_start') {
        // Switching back to live mode.
        setInspectedRun(null);
        setInspectedEvents([]);
        setInspectedTraceEvents([]);
        setRunResult(null);
        setExecutionEvents([event]);
        setTraceEvents([]);
        return;
      }
      if (event.type === 'trace_update') {
        setTraceEvents((prev) => [...prev, event]);
        return;
      }
      setExecutionEvents((prev) => [...prev, event]);

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
          toast.error('Workflow failed');
        } else {
          setRunResult({
            success: true,
            result: payload,
          });
          toast.success('Workflow executed successfully');
        }
      } else if (event.type === 'flow_error') {
        setRunResult({
          success: false,
          error: event.error || 'Unknown error',
        });
        toast.error('Workflow failed');
      } else if (event.type === 'flow_cancelled') {
        setRunResult({
          success: false,
          error: 'Cancelled',
        });
        toast('Workflow cancelled');
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
    const issues = computeRunPreflightIssues(nodes, edges);
    if (issues.length > 0) {
      setPreflightIssues(issues);
      setShowRunModal(false);
      return;
    }
    clearPreflightIssues();
    setRunResult(null); // Clear previous result
    setShowRunModal(true);
  }, [clearPreflightIssues, edges, flowId, nodes, setPreflightIssues]);

  // Handle run from modal
  const handleRunExecute = useCallback((inputData: Record<string, unknown>) => {
    if (!flowId) return;
    setIsRunning(true);
    setInspectedRun(null);
    setInspectedEvents([]);
    setInspectedTraceEvents([]);
    setRunResult(null);
    setExecutionEvents([]);
    setTraceEvents([]);
    runFlow(inputData);
  }, [flowId, runFlow, setIsRunning]);

  // Handle modal close
  const handleRunModalClose = useCallback(() => {
    if (inspectedRun) {
      setShowRunModal(false);
      setInspectedRun(null);
      setInspectedEvents([]);
      setInspectedTraceEvents([]);
      return;
    }
    if (!isRunning) {
      setShowRunModal(false);
      setRunResult(null);
      setExecutionEvents([]);
      setTraceEvents([]);
    }
  }, [inspectedRun, isRunning]);

  const handleRunAgain = useCallback(() => {
    if (isRunning) return;
    if (inspectedRun) {
      setInspectedRun(null);
      setInspectedEvents([]);
      setInspectedTraceEvents([]);
    }
    setRunResult(null);
    setExecutionEvents([]);
    setTraceEvents([]);
  }, [inspectedRun, isRunning]);

  const inspectRunById = useCallback(
    async (runId: string, opts?: { closeHistory?: boolean }) => {
      const rid = String(runId || '').trim();
      if (!rid) return;
      try {
        const data = await fetchRunHistory(rid);
        setInspectedRun(data.run);
        setInspectedEvents(Array.isArray(data.events) ? data.events : []);
        setInspectedTraceEvents([]);
        setRunResult(null);
        if (opts?.closeHistory) setShowRunHistory(false);
        setShowRunModal(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load run history');
      }
    },
    []
  );

  const handleSelectHistoryRun = useCallback((runId: string) => {
    void inspectRunById(runId, { closeHistory: true });
  }, [inspectRunById]);

  const handleSelectRunFromModal = useCallback((runId: string) => {
    void inspectRunById(runId, { closeHistory: false });
  }, [inspectRunById]);

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
          onClick={() => setShowFlowLibrary(true)}
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

        <button
          className="toolbar-button"
          onClick={() => setShowRunHistory(true)}
          disabled={!flowId}
          title="Run history"
          aria-label="Open run history"
        >
          🕘
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
      {(() => {
        const viewing = inspectedRun !== null;
        const evs = viewing ? inspectedEvents : executionEvents;
        const traces = viewing ? inspectedTraceEvents : traceEvents;
        const status = inspectedRun?.status || '';
        const runningLike =
          status === 'running' ||
          (status === 'waiting' && inspectedRun?.wait_reason === 'subworkflow' && !inspectedRun?.paused);
        const waitingLike =
          status === 'waiting' && !inspectedRun?.paused && inspectedRun?.wait_reason !== 'subworkflow';
        const pausedLike = Boolean(inspectedRun?.paused);
        const waitingInfo2 = waitingLike
          ? {
              prompt: inspectedRun?.prompt || 'Please respond:',
              choices: inspectedRun?.choices || [],
              allowFreeText: inspectedRun?.allow_free_text !== false,
              nodeId: inspectedRun?.current_node || null,
            }
          : waitingInfo;

        return (
      <RunFlowModal
        isOpen={showRunModal}
        onClose={handleRunModalClose}
        onRun={handleRunExecute}
        onRunAgain={handleRunAgain}
        isRunning={viewing ? runningLike : isRunning}
        isPaused={viewing ? pausedLike : isPaused}
        result={viewing ? null : runResult}
        events={evs}
        traceEvents={traces}
        isWaiting={viewing ? waitingLike : isWaiting}
        waitingInfo={viewing ? waitingInfo2 : waitingInfo}
        onResume={resumeFlow}
        onPause={() => pauseRun(inspectedRun?.run_id)}
        onResumeRun={() => resumeRun(inspectedRun?.run_id)}
        onCancelRun={() => cancelRun(inspectedRun?.run_id)}
        onSelectRunId={handleSelectRunFromModal}
      />
        );
      })()}

      <RunHistoryModal
        isOpen={showRunHistory}
        workflowId={flowId || ''}
        onClose={() => setShowRunHistory(false)}
        onSelectRun={handleSelectHistoryRun}
      />

      <FlowLibraryModal
        isOpen={showFlowLibrary}
        currentFlowId={flowId}
        flows={flowsQuery.data || []}
        isLoading={flowsQuery.isLoading}
        error={flowsQuery.error}
        onClose={() => setShowFlowLibrary(false)}
        onRefresh={() => flowsQuery.refetch()}
        onLoadFlow={handleLoadFlow}
        onRenameFlow={handleRenameFlow}
        onUpdateDescription={handleUpdateDescription}
        onDuplicateFlow={handleDuplicateFlow}
        onDeleteFlow={handleDeleteFlow}
      />

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
