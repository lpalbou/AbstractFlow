/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import { useWebSocket, type WaitingInfo } from '../hooks/useWebSocket';
import { RunFlowModal } from './RunFlowModal';
import { RunHistoryModal } from './RunHistoryModal';
import { UserPromptModal } from './UserPromptModal';
import { FlowLibraryModal } from './FlowLibraryModal';
import { PublishFlowModal } from './PublishFlowModal';
import { WorkflowLifecycleModal } from './WorkflowLifecycleModal';
import { closeOpenNodes, createLedgerMappingState, mapLedgerRecordToEvents, type LedgerRecord } from '../utils/ledgerEvents';
import { mapGatewayRunSummary } from '../utils/gatewayRuns';
import type { ExecutionEvent, FlowRunResult, VisualFlow, RunHistoryResponse, RunSummary } from '../types/flow';
import { computeRunPreflightIssues } from '../utils/preflight';

// Fetch list of saved flows
async function listFlows(): Promise<VisualFlow[]> {
  const response = await fetch('/api/gateway/visualflows');
  if (!response.ok) {
    throw new Error('Failed to fetch flows');
  }
  return response.json();
}

// Load a specific flow
async function fetchFlow(flowId: string): Promise<VisualFlow> {
  const response = await fetch(`/api/gateway/visualflows/${flowId}`);
  if (!response.ok) {
    throw new Error('Failed to load flow');
  }
  return response.json();
}

async function deleteFlow(flowId: string): Promise<void> {
  const response = await fetch(`/api/gateway/visualflows/${flowId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete flow');
}

async function renameFlow(flowId: string, name: string): Promise<VisualFlow> {
  const response = await fetch(`/api/gateway/visualflows/${flowId}`, {
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
  const response = await fetch(`/api/gateway/visualflows/${flowId}`, {
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

async function updateFlowInterfaces(flowId: string, interfaces: string[]): Promise<VisualFlow> {
  const response = await fetch(`/api/gateway/visualflows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interfaces }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

async function duplicateFlow(source: VisualFlow, newName: string): Promise<VisualFlow> {
  const response = await fetch('/api/gateway/visualflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: newName,
      description: source.description || '',
      interfaces: Array.isArray(source.interfaces) ? source.interfaces : [],
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
  const url = existingFlowId ? `/api/gateway/visualflows/${existingFlowId}` : '/api/gateway/visualflows';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: flow.name,
      description: flow.description,
      interfaces: Array.isArray(flow.interfaces) ? flow.interfaces : [],
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

export function Toolbar({ onOpenAppearance }: { onOpenAppearance?: () => void }) {
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
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);
  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [runResult, setRunResult] = useState<FlowRunResult | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [traceEvents, setTraceEvents] = useState<ExecutionEvent[]>([]);
  const [threadRootRunId, setThreadRootRunId] = useState<string | null>(null);
  const threadRootRunIdRef = useRef<string | null>(null);
  const threadRunMapRef = useRef<Map<string, string>>(new Map());
  const followUpPendingThreadRef = useRef<string | null>(null);
  const [inspectedRun, setInspectedRun] = useState<RunSummary | null>(null);
  const [inspectedEvents, setInspectedEvents] = useState<ExecutionEvent[]>([]);
  const [inspectedTraceEvents, setInspectedTraceEvents] = useState<ExecutionEvent[]>([]);

  const formatValue = useCallback((value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      const msg = value.stack || `${value.name}: ${value.message}`;
      return msg || String(value);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  const copyTextToClipboard = useCallback(async (text: string) => {
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
  }, []);

  const showWorkflowFailedToast = useCallback(
    (fullError: unknown) => {
      const full = formatValue(fullError) || 'Unknown error';
      const firstLine = full.split('\n').find((l) => l.trim()) || full;
      const snippet = firstLine.length > 180 ? `${firstLine.slice(0, 179)}…` : firstLine;

      toast.error(
        <div
          role="button"
          tabIndex={0}
          title="Click to copy full error"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            void (async () => {
              await copyTextToClipboard(full);
              toast.success('Copied error to clipboard');
            })();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            void (async () => {
              await copyTextToClipboard(full);
              toast.success('Copied error to clipboard');
            })();
          }}
        >
          <div style={{ fontWeight: 600 }}>Workflow failed</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, whiteSpace: 'pre-wrap' }}>{snippet}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9, textDecoration: 'underline' }}>
            Click to copy full error
          </div>
        </div>
      );
    },
    [copyTextToClipboard, formatValue]
  );

  async function fetchRunHistory(runId: string): Promise<RunHistoryResponse> {
    const response = await fetch(
      `/api/gateway/runs/${encodeURIComponent(runId)}/history_bundle?include_subruns=true&ledger_mode=full`
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.detail ? String(error.detail) : `HTTP ${response.status}`;
      throw new Error(message);
    }
    const bundle = (await response.json()) as {
      run?: Record<string, unknown>;
      ledgers?: Record<string, { items?: Array<{ record?: LedgerRecord }> }>;
    };

  if (!bundle || typeof bundle.run !== 'object') {
    console.warn('#FALLBACK: run history bundle missing run summary; using empty summary');
  }
  const runRaw = bundle && typeof bundle.run === 'object' ? (bundle.run as Record<string, unknown>) : {};
    const run = mapGatewayRunSummary(runRaw);

    const state = createLedgerMappingState();
    const events: ExecutionEvent[] = [];
    const startTs = run.created_at || run.updated_at || new Date().toISOString();
    if (run.run_id) {
      events.push({ type: 'flow_start', runId: run.run_id, ts: startTs });
    }

  if (!bundle || typeof bundle.ledgers !== 'object') {
    console.warn('#FALLBACK: run history bundle missing ledgers; events may be incomplete');
  }
  const ledgers = bundle && typeof bundle.ledgers === 'object' ? bundle.ledgers : {};
    const items: Array<{ record: LedgerRecord; ts: string; order: number }> = [];
    let order = 0;
    for (const entry of Object.values(ledgers || {})) {
      const rows = Array.isArray(entry?.items) ? entry.items : [];
      for (const row of rows) {
        const rec = row?.record;
        if (!rec || typeof rec !== 'object') continue;
        const r = rec as LedgerRecord;
        const ts =
          typeof r.ended_at === 'string'
            ? r.ended_at
            : typeof r.started_at === 'string'
              ? r.started_at
              : '';
        items.push({ record: r, ts, order: order++ });
      }
    }

    items.sort((a, b) => {
      if (a.ts && b.ts) return a.ts.localeCompare(b.ts);
      return a.order - b.order;
    });

    for (const it of items) {
      const mapped = mapLedgerRecordToEvents(it.record, state);
      if (mapped.length) events.push(...mapped);
    }

    const status = (run.status || '').toLowerCase();
    const updatedAt = run.updated_at || startTs;
    if (run.run_id && (status === 'completed' || status === 'failed' || status === 'cancelled')) {
      const closeEvents = closeOpenNodes({ runId: run.run_id, state, ts: updatedAt });
      events.push(...closeEvents);
    }
    if (status === 'completed' && run.run_id) {
      events.push({ type: 'flow_complete', runId: run.run_id, ts: updatedAt });
    } else if (status === 'failed' && run.run_id) {
      events.push({ type: 'flow_error', runId: run.run_id, ts: updatedAt, error: run.error || 'Run failed' });
    } else if (status === 'cancelled' && run.run_id) {
      events.push({ type: 'flow_cancelled', runId: run.run_id, ts: updatedAt });
    } else if (status === 'waiting' && run.run_id) {
      if (run.paused) {
        events.push({ type: 'flow_paused', runId: run.run_id, ts: updatedAt });
      } else {
        events.push({
          type: 'flow_waiting',
          runId: run.run_id,
          ts: updatedAt,
          prompt: run.prompt || undefined,
          choices: run.choices || undefined,
          allow_free_text: run.allow_free_text !== false,
          wait_key: run.wait_key || undefined,
          reason: run.wait_reason || undefined,
        });
      }
    }

    return { run, events };
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

  const handleUpdateInterfaces = useCallback(
    async (id: string, nextInterfaces: string[]) => {
      const updated = await updateFlowInterfaces(id, nextInterfaces);
      if (flowId && id === flowId) {
        loadFlow(updated);
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Interfaces updated');
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
  const {
    isWaiting,
    isPaused,
    waitingInfo,
    resumeFlow,
    runFlow,
    pauseRun,
    resumeRun,
    cancelRun,
    resetSession,
    stableSessionId,
    setAutoApproveForSession,
    setAutoApproveForRunRoot,
  } = useWebSocket({
    flowId: flowId || '',
    onEvent: (event) => {
      console.log('Execution event:', event);
      if (event.type === 'flow_start') {
        const actualRunId = typeof event.runId === 'string' ? event.runId.trim() : '';
        const pendingThreadId = followUpPendingThreadRef.current;
        const isFollowUp = Boolean(pendingThreadId);
        const resolvedThreadId = pendingThreadId || threadRootRunIdRef.current || actualRunId;
        if (actualRunId && resolvedThreadId) {
          threadRunMapRef.current.set(actualRunId, resolvedThreadId);
        }
        if (!threadRootRunIdRef.current && resolvedThreadId) {
          threadRootRunIdRef.current = resolvedThreadId;
        }
        if (resolvedThreadId) setThreadRootRunId(resolvedThreadId);
        const eventWithThread =
          resolvedThreadId && actualRunId ? { ...event, threadRunId: resolvedThreadId } : event;
        if (isFollowUp) {
          followUpPendingThreadRef.current = null;
          setExecutionEvents((prev) => [...prev, eventWithThread]);
          return;
        }
        // Switching back to live mode.
        setInspectedRun(null);
        setInspectedEvents([]);
        setInspectedTraceEvents([]);
        setRunResult(null);
        setExecutionEvents([eventWithThread]);
        setTraceEvents([]);
        return;
      }
      const threadedRunId = event.runId ? threadRunMapRef.current.get(event.runId) : null;
      const eventWithThread = threadedRunId ? { ...event, threadRunId: threadedRunId } : event;
      if (event.type === 'trace_update') {
        setTraceEvents((prev) => [...prev, eventWithThread]);
        return;
      }
      setExecutionEvents((prev) => [...prev, eventWithThread]);

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
          const fullError = {
            type: 'flow_complete',
            success: false,
            error: payloadObj && typeof payloadObj.error === 'string' ? payloadObj.error : null,
            result: payloadObj?.result ?? payloadObj ?? payload,
          };
          setRunResult({
            success: false,
            error:
              (payloadObj && typeof payloadObj.error === 'string' ? payloadObj.error : null) ||
              'Flow failed',
            result: payloadObj?.result ?? null,
          });
          showWorkflowFailedToast(fullError);
        } else {
          setRunResult({
            success: true,
            result: payload,
          });
          toast.success('Workflow executed successfully');
        }
      } else if (event.type === 'flow_error') {
        const fullError = { ...event };
        setRunResult({
          success: false,
          error: event.error || 'Unknown error',
        });
        showWorkflowFailedToast(fullError);
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
    // If we already have an active/previous run in memory, opening the modal should
    // *not* reset anything. Users should be able to hide/reopen the run modal to
    // observe progress and revisit results.
    if (isRunning || inspectedRun || runResult || executionEvents.length > 0 || traceEvents.length > 0) {
      setShowRunModal(true);
      return;
    }
    const issues = computeRunPreflightIssues(nodes, edges);
    if (issues.length > 0) {
      setPreflightIssues(issues);
      setShowRunModal(false);
      return;
    }
    clearPreflightIssues();
    setShowRunModal(true);
  }, [clearPreflightIssues, edges, executionEvents.length, flowId, inspectedRun, isRunning, nodes, runResult, setPreflightIssues, traceEvents.length]);

  const resetThreadState = useCallback(() => {
    threadRootRunIdRef.current = null;
    threadRunMapRef.current.clear();
    followUpPendingThreadRef.current = null;
    setThreadRootRunId(null);
  }, []);

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
    resetThreadState();
    runFlow(inputData);
  }, [flowId, resetThreadState, runFlow, setIsRunning]);

  // Handle modal close
  const handleRunModalClose = useCallback(() => {
    // Close = hide. Keep state so the user can reopen the modal (even after completion).
    setShowRunModal(false);
  }, []);

  const clearRunState = useCallback(() => {
    if (inspectedRun) {
      setInspectedRun(null);
      setInspectedEvents([]);
      setInspectedTraceEvents([]);
    }
    setRunResult(null);
    setExecutionEvents([]);
    setTraceEvents([]);
    resetThreadState();
  }, [inspectedRun, resetThreadState]);

  const handleNewRun = useCallback(() => {
    if (isRunning) return;
    resetSession?.();
    clearRunState();
  }, [clearRunState, isRunning, resetSession]);

  const handleApproveAll = useCallback(
    (ctx?: { rootRunId?: string; sessionId?: string }) => {
      const sid =
        typeof ctx?.sessionId === 'string' && ctx.sessionId.trim()
          ? ctx.sessionId.trim()
          : typeof stableSessionId === 'string' && stableSessionId.trim()
            ? stableSessionId.trim()
            : '';
      if (sid) setAutoApproveForSession?.(sid, true);
      const rootId = typeof ctx?.rootRunId === 'string' ? ctx.rootRunId.trim() : '';
      if (rootId) setAutoApproveForRunRoot?.(rootId, true);
    },
    [setAutoApproveForRunRoot, setAutoApproveForSession, stableSessionId]
  );

  const resolveThreadRootId = useCallback(
    (fallback?: string | null): string | null => {
      const direct = typeof fallback === 'string' ? fallback.trim() : '';
      if (direct) return direct;
      if (threadRootRunIdRef.current) return threadRootRunIdRef.current;
      for (let i = executionEvents.length - 1; i >= 0; i--) {
        const ev = executionEvents[i];
        const rid = typeof ev.threadRunId === 'string' ? ev.threadRunId.trim() : typeof ev.runId === 'string' ? ev.runId.trim() : '';
        if (ev.type === 'flow_start' && rid) return rid;
      }
      return null;
    },
    [executionEvents]
  );

  const handleFollowUpSubmit = useCallback(
    async (payload: {
      message: string;
      attachments: File[];
      contextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
      sessionId?: string;
      threadRootRunId?: string;
      inputDataDefaults?: Record<string, unknown> | null;
    }) => {
      if (!flowId) return;
      const threadId = resolveThreadRootId(payload.threadRootRunId);
      if (threadId) {
        threadRootRunIdRef.current = threadId;
        setThreadRootRunId(threadId);
      }

      const sessionId =
        typeof payload.sessionId === 'string' && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : typeof stableSessionId === 'string' && stableSessionId.trim()
            ? stableSessionId.trim()
            : '';

      const attachmentRefs: Record<string, unknown>[] = [];
      if (payload.attachments?.length) {
        if (!sessionId) {
          throw new Error('Session ID is required to upload attachments.');
        }
        for (const file of payload.attachments) {
          const form = new FormData();
          form.append('session_id', sessionId);
          form.append('file', file, file.name);
          const res = await fetch('/api/gateway/attachments/upload', { method: 'POST', body: form });
          if (!res.ok) {
            throw new Error(await res.text());
          }
          const data = (await res.json()) as Record<string, unknown>;
          const attachment = data && typeof data.attachment === 'object' ? (data.attachment as Record<string, unknown>) : null;
          if (attachment) attachmentRefs.push(attachment);
        }
      }

      if (threadId) {
        const ts = new Date().toISOString();
        const followUpNodeId = '__follow_up__';
        const resultPayload: Record<string, unknown> = { message: payload.message };
        if (attachmentRefs.length) resultPayload.attachments = attachmentRefs;
        setExecutionEvents((prev) => [
          ...prev,
          {
            type: 'node_start',
            runId: threadId,
            threadRunId: threadId,
            nodeId: followUpNodeId,
            ts,
          },
          {
            type: 'node_complete',
            runId: threadId,
            threadRunId: threadId,
            nodeId: followUpNodeId,
            result: resultPayload,
            ts,
          },
        ]);
      }

      const baseDefaults =
        payload.inputDataDefaults && typeof payload.inputDataDefaults === 'object' && !Array.isArray(payload.inputDataDefaults)
          ? payload.inputDataDefaults
          : {};
      const nextInputData: Record<string, unknown> = { ...baseDefaults };
      nextInputData.prompt = payload.message;
      if (sessionId) nextInputData.sessionId = sessionId;

      const context: Record<string, unknown> = {};
      const prevCtx = baseDefaults.context;
      if (prevCtx && typeof prevCtx === 'object' && !Array.isArray(prevCtx)) {
        Object.assign(context, prevCtx as Record<string, unknown>);
      }
      if (Array.isArray(payload.contextMessages) && payload.contextMessages.length > 0) {
        context.messages = payload.contextMessages;
      }
      if (attachmentRefs.length > 0) {
        context.attachments = attachmentRefs;
      }
      if (Object.keys(context).length > 0) {
        nextInputData.context = context;
      }

      followUpPendingThreadRef.current = threadId;
      setIsRunning(true);
      setInspectedRun(null);
      setInspectedEvents([]);
      setInspectedTraceEvents([]);
      setRunResult(null);
      runFlow(nextInputData);
    },
    [executionEvents, flowId, resolveThreadRootId, runFlow, setIsRunning, stableSessionId]
  );

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
    setShowNewFlowModal(true);
  }, []);

  // Duplicate the current flow in-place (keeps current editor state as the source).
  const handleDuplicateCurrent = useCallback(async () => {
    const flow = getFlow();
    const base = (flow.name || 'Untitled').trim() || 'Untitled';
    try {
      const created = await duplicateFlow(flow, `${base} (copy)`);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      loadFlow(created);
      toast.success(`Duplicated as "${created.name}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Duplicate failed';
      toast.error(msg);
    }
  }, [getFlow, loadFlow, queryClient]);

  const handlePublish = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setShowPublishModal(true);
  }, [flowId]);

  const handleLifecycle = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setShowLifecycleModal(true);
  }, [flowId]);

  const extractApprovalWait = useCallback((events: ExecutionEvent[]): WaitingInfo | null => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type !== 'flow_waiting') continue;
      const details = ev.details && typeof ev.details === 'object' ? (ev.details as Record<string, unknown>) : null;
      if (!details) continue;
      const mode = typeof details.mode === 'string' ? details.mode.toLowerCase() : '';
      const kind = typeof details.kind === 'string' ? details.kind.toLowerCase() : '';
      if (mode !== 'approval_required' && kind !== 'tool_approval') continue;
      return {
        prompt: ev.prompt || 'Please respond:',
        choices: ev.choices || [],
        allowFreeText: ev.allow_free_text !== false,
        nodeId: ev.nodeId || null,
        waitKey: ev.wait_key,
        runId: ev.runId || undefined,
        reason: typeof ev.reason === 'string' ? ev.reason : undefined,
        details,
      };
    }
    return null;
  }, []);

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
          onClick={handleDuplicateCurrent}
          title="Duplicate Flow"
        >
          📑 Duplicate
        </button>

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
          disabled={!flowId}
          title={isRunning ? 'Open current run' : 'Run Flow'}
        >
          {isRunning ? '⏳ Running...' : '▶ Run'}
        </button>

        <button
          className="toolbar-button"
          onClick={handlePublish}
          disabled={isRunning || !flowId}
          title="Publish WorkflowBundle (.flow)"
        >
          📦 Publish
        </button>

        <button className="toolbar-button" onClick={handleLifecycle} disabled={isRunning || !flowId} title="Deprecate/undeprecate workflow on gateway">
          🧬 Lifecycle
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


        <button
          className="toolbar-button"
          onClick={() => onOpenAppearance?.()}
          title="Appearance (theme + typography)"
          aria-label="Open appearance settings"
        >
          🎨
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

      {showNewFlowModal ? (
        <div className="modal-overlay" onClick={() => setShowNewFlowModal(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New flow</h3>
            <p>Create a new flow? Any unsaved changes will be lost.</p>
            <div className="modal-actions">
              <button className="modal-button cancel" onClick={() => setShowNewFlowModal(false)}>
                Cancel
              </button>
              <button
                className="modal-button danger"
                onClick={() => {
                  setShowNewFlowModal(false);
                  clearFlow();
                  toast.success('Created new flow');
                }}
              >
                Create new flow
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {/* Smart Run Modal */}
      {(() => {
        const viewing = inspectedRun !== null;
        const evs = viewing ? inspectedEvents : executionEvents;
        const traces = viewing ? inspectedTraceEvents : traceEvents;
        const status = inspectedRun?.status || '';
        const runningLike =
          status === 'running' ||
          (status === 'waiting' && inspectedRun?.wait_reason === 'subworkflow' && !inspectedRun?.paused);
        const approvalWaitInfo = viewing ? extractApprovalWait(evs) : null;
        const waitingLike =
          Boolean(approvalWaitInfo) ||
          (status === 'waiting' && !inspectedRun?.paused && inspectedRun?.wait_reason !== 'subworkflow');
        const pausedLike = Boolean(inspectedRun?.paused);
        const waitingInfo2 =
          approvalWaitInfo ||
          (waitingLike
            ? {
                prompt: inspectedRun?.prompt || 'Please respond:',
                choices: inspectedRun?.choices || [],
                allowFreeText: inspectedRun?.allow_free_text !== false,
                nodeId: inspectedRun?.current_node || null,
              }
            : waitingInfo);

        return (
      <RunFlowModal
        isOpen={showRunModal}
        onClose={handleRunModalClose}
        onRun={handleRunExecute}
        onFollowUpSubmit={handleFollowUpSubmit}
        onNewRun={handleNewRun}
        onApproveAll={handleApproveAll}
        isRunning={viewing ? runningLike : isRunning}
        isPaused={viewing ? pausedLike : isPaused}
        result={viewing ? null : runResult}
        events={evs}
        traceEvents={traces}
        isWaiting={viewing ? waitingLike : isWaiting}
        waitingInfo={viewing ? waitingInfo2 : waitingInfo}
        stableSessionId={stableSessionId}
        threadRootRunId={viewing ? undefined : threadRootRunId || undefined}
        onResume={resumeFlow}
        onPause={() => pauseRun(inspectedRun?.run_id)}
        onResumeRun={() => resumeRun(inspectedRun?.run_id)}
        onCancelRun={() => cancelRun(inspectedRun?.run_id)}
        onSelectRunId={handleSelectRunFromModal}
        runSummary={viewing ? inspectedRun : null}
      />
        );
      })()}

      <RunHistoryModal
        isOpen={showRunHistory}
        workflowId={flowId || ''}
        workflowName={flowName}
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
        onUpdateInterfaces={handleUpdateInterfaces}
        onDuplicateFlow={handleDuplicateFlow}
        onDeleteFlow={handleDeleteFlow}
      />

      <PublishFlowModal
        isOpen={showPublishModal}
        flowId={flowId}
        flowName={flowName}
        onClose={() => setShowPublishModal(false)}
      />

      <WorkflowLifecycleModal
        isOpen={showLifecycleModal}
        flowName={flowName}
        onClose={() => setShowLifecycleModal(false)}
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
