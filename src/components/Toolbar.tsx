/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useFlowStore } from '../hooks/useFlow';
import { useWebSocket } from '../hooks/useWebSocket';
import { RunFlowModal } from './RunFlowModal';
import { RunHistoryModal } from './RunHistoryModal';
import { FlowLibraryModal } from './FlowLibraryModal';
import { PublishFlowModal } from './PublishFlowModal';
import { WorkflowLifecycleModal } from './WorkflowLifecycleModal';
import { ModelResidencyPanel } from './ModelResidencyPanel';
import { AfTooltip } from './AfTooltip';
import {
  IconChip,
  IconContrast,
  IconCopy,
  IconExport,
  IconFilePlus,
  IconFolder,
  IconHistory,
  IconImport,
  IconLifecycle,
  IconPackage,
  IconPlay,
  IconSave,
  IconSparkle,
  IconSpinner,
} from './ToolbarIcons';
import { closeOpenNodes, createLedgerMappingState, mapLedgerRecordToEvents, type LedgerRecord } from '../utils/ledgerEvents';
import { mapGatewayRunSummary } from '../utils/gatewayRuns';
import { extractPendingApprovalWait, extractReplayTraceEvents } from '../utils/runHistoryReplay';
import type { ExecutionEvent, FlowRunResult, VisualFlow, RunHistoryResponse, RunSummary } from '../types/flow';
import { computeRunPreflightIssues } from '../utils/preflight';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../hooks/useGatewayCapabilities';
import {
  endpointFromDescriptor,
  gatewayFetch,
  gatewayJson,
  gatewayPath,
  descriptorEndpointAvailable,
  getGatewayFlowEditorReadiness,
  jsonRequest,
  type GatewayContracts,
} from '../utils/gatewayClient';

// Fetch list of saved flows
async function listFlows(contracts: GatewayContracts | null): Promise<VisualFlow[]> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.collection_endpoint || '/api/gateway/visualflows';
  return gatewayJson<VisualFlow[]>(gatewayPath(endpoint));
}

// Load a specific flow
async function fetchFlow(flowId: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }));
}

async function deleteFlow(flowId: string, contracts: GatewayContracts | null): Promise<void> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}';
  await gatewayFetch(gatewayPath(endpoint, { flow_id: flowId }), { method: 'DELETE' });
}

async function renameFlow(flowId: string, name: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ name }, { method: 'PUT' }));
}

async function updateFlowDescription(flowId: string, description: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ description }, { method: 'PUT' }));
}

async function updateFlowInterfaces(flowId: string, interfaces: string[], contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ interfaces }, { method: 'PUT' }));
}

async function duplicateFlow(source: VisualFlow, newName: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.collection_endpoint || '/api/gateway/visualflows';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint), jsonRequest({
      name: newName,
      description: source.description || '',
      interfaces: Array.isArray(source.interfaces) ? source.interfaces : [],
      nodes: source.nodes,
      edges: source.edges,
      entryNode: source.entryNode,
    }, { method: 'POST' }));
}

/**
 * Toolbar button wrapped in a fast AfTooltip (consistent with the palette,
 * nicer than slow native `title` hints). The wrapper still receives pointer
 * events when the inner button is disabled, so "why is this disabled" hints
 * remain discoverable.
 */
function ToolbarAction({
  tooltip,
  label,
  onClick,
  disabled = false,
  iconOnly = true,
  className = '',
  children,
}: {
  tooltip: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = ['toolbar-button', iconOnly ? 'icon-button' : '', className].filter(Boolean).join(' ');
  return (
    <AfTooltip content={tooltip} delayMs={500} maxWidthPx={340} minWidthPx={0}>
      <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={label}>
        {children}
      </button>
    </AfTooltip>
  );
}

// API functions
async function saveFlow(
  flow: VisualFlow,
  existingFlowId: string | null,
  contracts: GatewayContracts | null
): Promise<VisualFlow> {
  // Use existingFlowId to determine if this is an update or create
  // flow.id may have a generated value even for new flows
  const method = existingFlowId ? 'PUT' : 'POST';
  const crud = contracts?.flow_editor?.visualflows?.crud;
  const url = existingFlowId
    ? gatewayPath(crud?.item_endpoint || '/api/gateway/visualflows/{flow_id}', { flow_id: existingFlowId })
    : gatewayPath(crud?.collection_endpoint || '/api/gateway/visualflows');

  return gatewayJson<VisualFlow>(url, jsonRequest({
      name: flow.name,
      description: flow.description,
      interfaces: Array.isArray(flow.interfaces) ? flow.interfaces : [],
      nodes: flow.nodes,
      edges: flow.edges,
      entryNode: flow.entryNode,
    }, { method }));
}

function flowSignatureFor(flow: Partial<VisualFlow> | null | undefined): string {
  const value = flow || {};
  const normalizeNode = (node: any) => {
    if (!node || typeof node !== 'object') return node;
    return {
      id: node.id,
      type: node.type,
      position: node.position || null,
      data: node.data || null,
      parentNode: node.parentNode,
      parentId: node.parentId,
      extent: node.extent,
    };
  };
  const normalizeEdge = (edge: any) => {
    if (!edge || typeof edge !== 'object') return edge;
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      type: edge.type,
      data: edge.data || null,
      label: edge.label,
    };
  };
  return JSON.stringify({
    name: String(value.name || '').trim(),
    description: String(value.description || ''),
    interfaces: Array.isArray(value.interfaces) ? value.interfaces : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeNode) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(normalizeEdge) : [],
    entryNode: value.entryNode || null,
  });
}

export function Toolbar({
  onOpenAppearance,
  onOpenAssistant,
  onOpenConnection,
  onDisconnect,
  assistantOpen = false,
  gatewayConnected = false,
}: {
  onOpenAppearance?: () => void;
  onOpenAssistant?: () => void;
  onOpenConnection?: () => void;
  onDisconnect?: () => void;
  assistantOpen?: boolean;
  gatewayConnected?: boolean;
}) {
  const queryClient = useQueryClient();
  const gatewayCapabilitiesQuery = useGatewayCapabilities(true);
  const gatewayContracts = gatewayContractsFromCapabilities(gatewayCapabilitiesQuery.data);
  const flowEditorContract = gatewayContracts?.flow_editor;
  const gatewayReadiness = useMemo(() => getGatewayFlowEditorReadiness(gatewayContracts), [gatewayContracts]);
  const strictGatewayContract = Boolean(
    gatewayContracts && typeof gatewayContracts.version === 'number' && gatewayContracts.version >= 1
  );
  const gatewayDiscoveryError =
    gatewayCapabilitiesQuery.error instanceof Error
      ? gatewayCapabilitiesQuery.error.message
      : gatewayCapabilitiesQuery.isError
        ? 'Gateway capability discovery failed'
        : '';
  const gatewayCheckPending = gatewayCapabilitiesQuery.isLoading;
  const gatewayBlockReason = gatewayCheckPending
    ? 'Checking Gateway capabilities'
    : gatewayDiscoveryError
      ? `Gateway capability discovery failed: ${gatewayDiscoveryError}`
      : '';
  const visualflowCrudUnavailable = Boolean(gatewayBlockReason || !gatewayReadiness.operations.save.ready);
  const visualflowPublishUnavailable = Boolean(gatewayBlockReason || !gatewayReadiness.operations.publish.ready);
  const visualflowRunUnavailable = Boolean(gatewayBlockReason || !gatewayReadiness.operations.run.ready);
  const runHistoryUnavailable = Boolean(gatewayBlockReason || !gatewayReadiness.operations.history.ready);
  const saveUnavailableReason = gatewayBlockReason || gatewayReadiness.operations.save.reason || 'Gateway VisualFlow storage is unavailable';
  const visualflowPublishHint =
    gatewayBlockReason ||
    gatewayReadiness.operations.publish.reason ||
    (flowEditorContract?.visualflows?.publish && typeof flowEditorContract.visualflows.publish.install_hint === 'string'
      ? flowEditorContract.visualflows.publish.install_hint
      : '');
  const visualflowRunHint = gatewayBlockReason || gatewayReadiness.operations.run.reason || visualflowPublishHint;
  const runHistoryHint = gatewayBlockReason || gatewayReadiness.operations.history.reason || 'Gateway run history is unavailable';
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
    flowInterfaces,
    setPreflightIssues,
    clearPreflightIssues,
  } = useFlowStore();

  const [showRunModal, setShowRunModal] = useState(false);
  const [showFlowLibrary, setShowFlowLibrary] = useState(false);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);
  const [showModelResidency, setShowModelResidency] = useState(false);
  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [runResult, setRunResult] = useState<FlowRunResult | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [traceEvents, setTraceEvents] = useState<ExecutionEvent[]>([]);
  const [threadRootRunId, setThreadRootRunId] = useState<string | null>(null);
  const [runWorkflowId, setRunWorkflowId] = useState<string | null>(null);
  const threadRootRunIdRef = useRef<string | null>(null);
  const threadRunMapRef = useRef<Map<string, string>>(new Map());
  const followUpPendingThreadRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | null>(flowId || null);
  const [inspectedRun, setInspectedRun] = useState<RunSummary | null>(null);
  const [inspectedEvents, setInspectedEvents] = useState<ExecutionEvent[]>([]);
  const [inspectedTraceEvents, setInspectedTraceEvents] = useState<ExecutionEvent[]>([]);
  const isEmptyFlow = nodes.length === 0 && edges.length === 0;
  const currentFlowSignature = useMemo(
    () => flowSignatureFor(getFlow()),
    [edges, flowInterfaces, flowName, getFlow, nodes]
  );
  const [savedFlowSignature, setSavedFlowSignature] = useState(() => flowSignatureFor(getFlow()));
  const savedFlowIdentityRef = useRef<string | null>(flowId || null);
  const hasUnsavedChanges = !isEmptyFlow && currentFlowSignature !== savedFlowSignature;
  const saveDisabledReason = visualflowCrudUnavailable
    ? saveUnavailableReason
    : isEmptyFlow
      ? 'Add at least one node before saving'
      : !hasUnsavedChanges
        ? 'No unsaved changes'
        : 'Save Flow (Ctrl/⌘+S)';

  useEffect(() => {
    const nextFlowId = flowId || null;
    if (savedFlowIdentityRef.current === nextFlowId) return;
    savedFlowIdentityRef.current = nextFlowId;
    if (nextFlowId || isEmptyFlow) {
      setSavedFlowSignature(currentFlowSignature);
    }
  }, [currentFlowSignature, flowId, isEmptyFlow]);

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
    const historyBundleDescriptor =
      gatewayContracts?.common?.runs?.history_bundle || gatewayContracts?.flow_editor?.runs?.history_bundle;
    const hasHistoryBundleDescriptor = descriptorEndpointAvailable(historyBundleDescriptor);
    const historyBundlePath = (() => {
      if (hasHistoryBundleDescriptor) {
        return endpointFromDescriptor(
          historyBundleDescriptor,
          '/api/gateway/runs/{run_id}/history_bundle',
          { run_id: runId },
          {
            include_subruns: true,
            ledger_mode: 'full',
          }
        );
      }
      if (strictGatewayContract) {
        throw new Error('Gateway contract is missing runs.history_bundle; run history replay is unavailable.');
      }
      console.warn(
        '#FALLBACK: runs.history_bundle descriptor missing in discovery; using legacy canonical route for history replay compatibility.'
      );
      return gatewayPath(
        '/api/gateway/runs/{run_id}/history_bundle',
        { run_id: runId },
        {
          include_subruns: true,
          ledger_mode: 'full',
        }
      );
    })();
    const bundle = await gatewayJson<{
      run?: Record<string, unknown>;
      ledgers?: Record<string, { items?: Array<{ record?: LedgerRecord }> }>;
    }>(
      historyBundlePath
    );

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

    return { run, events, traceEvents: extractReplayTraceEvents(events) };
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
        setInspectedTraceEvents(Array.isArray(data.traceEvents) ? data.traceEvents : []);
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
    queryKey: ['flows', flowEditorContract?.visualflows?.crud?.collection_endpoint || '/api/gateway/visualflows'],
    queryFn: () => listFlows(gatewayContracts),
    enabled: showFlowLibrary && !visualflowCrudUnavailable && !gatewayCapabilitiesQuery.isLoading,
  });

  // Handle loading a flow
  const handleLoadFlow = useCallback(
    async (selectedFlowId: string) => {
      try {
        const flow = await fetchFlow(selectedFlowId, gatewayContracts);
        loadFlow(flow);
        setSavedFlowSignature(flowSignatureFor(flow));
        setShowFlowLibrary(false);
        toast.success(`Loaded "${flow.name}"`);
      } catch (error) {
        toast.error('Failed to load flow');
      }
    },
    [gatewayContracts, loadFlow]
  );

  const handleRenameFlow = useCallback(
    async (id: string, nextName: string) => {
      const name = nextName.trim();
      if (!name) return;
      const updated = await renameFlow(id, name, gatewayContracts);
      if (flowId && id === flowId) {
        setFlowName(updated.name);
        setSavedFlowSignature(flowSignatureFor(updated));
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Renamed');
    },
    [flowId, gatewayContracts, queryClient, setFlowName]
  );

  const handleUpdateDescription = useCallback(
    async (id: string, nextDescription: string) => {
      const updated = await updateFlowDescription(id, nextDescription, gatewayContracts);
      // If we are currently editing that flow, keep the in-editor description in sync by reloading.
      if (flowId && id === flowId) {
        // We only have the flow name in store; description lives in the saved flow object.
        // Loading is the simplest way to keep all metadata consistent.
        loadFlow(updated);
        setSavedFlowSignature(flowSignatureFor(updated));
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Description updated');
    },
    [flowId, gatewayContracts, loadFlow, queryClient]
  );

  const handleUpdateInterfaces = useCallback(
    async (id: string, nextInterfaces: string[]) => {
      const updated = await updateFlowInterfaces(id, nextInterfaces, gatewayContracts);
      if (flowId && id === flowId) {
        loadFlow(updated);
        setSavedFlowSignature(flowSignatureFor(updated));
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Interfaces updated');
    },
    [flowId, gatewayContracts, loadFlow, queryClient]
  );

  const handleDeleteFlow = useCallback(
    async (id: string) => {
      await deleteFlow(id, gatewayContracts);
      if (flowId && id === flowId) {
        // Keep the current graph but mark it as unsaved.
        setFlowId(null);
        setSavedFlowSignature('');
        toast.success('Deleted (editor is now unsaved)');
      } else {
        toast.success('Deleted');
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
    },
    [flowId, gatewayContracts, queryClient, setFlowId]
  );

  const handleDuplicateFlow = useCallback(
    async (id: string) => {
      const all = flowsQuery.data || [];
      const src = all.find((f) => f.id === id);
      if (!src) return;
      const base = (src.name || 'Untitled').trim() || 'Untitled';
      const created = await duplicateFlow(src, `${base} (copy)`, gatewayContracts);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      loadFlow(created);
      setSavedFlowSignature(flowSignatureFor(created));
      setShowFlowLibrary(false);
      toast.success(`Duplicated as "${created.name}"`);
    },
    [flowsQuery.data, gatewayContracts, loadFlow, queryClient]
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ flow, existingFlowId }: { flow: VisualFlow; existingFlowId: string | null }) =>
      saveFlow(flow, existingFlowId, gatewayContracts),
    onSuccess: (savedFlow, variables) => {
      const savedId = typeof savedFlow.id === 'string' && savedFlow.id.trim()
        ? savedFlow.id
        : variables.existingFlowId;
      if (savedId) {
        setFlowId(savedId);
      }
      const savedSnapshot: VisualFlow = {
        ...variables.flow,
        id: savedId || variables.flow.id,
        name: typeof savedFlow.name === 'string' ? savedFlow.name : variables.flow.name,
        description: typeof savedFlow.description === 'string' ? savedFlow.description : variables.flow.description,
        interfaces: Array.isArray(savedFlow.interfaces) ? savedFlow.interfaces : variables.flow.interfaces,
      };
      setSavedFlowSignature(flowSignatureFor(savedSnapshot));
      queryClient.invalidateQueries({ queryKey: ['flows'] });
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
    autoApproveSessions,
    setAutoApproveForSession,
    setAutoApproveForRunRoot,
  } = useWebSocket({
    flowId: flowId || '',
    onEvent: (event) => {
      console.log('Execution event:', event);
      if (event.type === 'flow_start') {
        const actualRunId = typeof event.runId === 'string' ? event.runId.trim() : '';
        if (actualRunId && flowId) setRunWorkflowId((prev) => prev || flowId);
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
      setShowRunModal(true);
    },
  });

  // Handle save
  const handleSave = useCallback(() => {
    if (visualflowCrudUnavailable) {
      toast.error(saveUnavailableReason);
      return;
    }
    if (isEmptyFlow) {
      toast.error('Add at least one node before saving');
      return;
    }
    if (!hasUnsavedChanges) {
      return;
    }
    const flow = getFlow();
    if (!flow.name.trim()) {
      toast.error('Please enter a flow name');
      return;
    }
    saveMutation.mutate({ flow, existingFlowId: flowId });
  }, [flowId, getFlow, hasUnsavedChanges, isEmptyFlow, saveMutation, saveUnavailableReason, visualflowCrudUnavailable]);

  // Cmd/Ctrl+S saves the flow. Always intercept so the browser "Save page"
  // dialog never appears inside the editor, even when there is nothing to save.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if ((e.key || '').toLowerCase() !== 's') return;
      e.preventDefault();
      handleSave();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handleSave]);

  // Guard against silent data loss: closing/refreshing the tab with unsaved
  // graph changes (or a save still in flight) asks for confirmation.
  useEffect(() => {
    if (!hasUnsavedChanges && !saveMutation.isPending) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges, saveMutation.isPending]);

  // Handle Run - open modal
  const handleRun = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    if (visualflowRunUnavailable) {
      toast.error(visualflowRunHint || 'Gateway cannot run VisualFlows');
      return;
    }
    // If we already have an active/previous run in memory, opening the modal should
    // *not* reset anything. Users should be able to hide/reopen the run modal to
    // observe progress and revisit results.
    if (isRunning || inspectedRun || runResult || executionEvents.length > 0 || traceEvents.length > 0) {
      setShowRunModal(true);
      return;
    }
    if (hasUnsavedChanges) {
      toast.error('Save the flow before running current changes');
      return;
    }
    const issues = computeRunPreflightIssues(nodes, edges, {
      gatewayReadiness,
      gatewayCapabilitiesLoading: gatewayCapabilitiesQuery.isLoading,
      gatewayCapabilitiesKnown: Boolean(gatewayContracts && !gatewayCapabilitiesQuery.isError),
    });
    if (issues.length > 0) {
      setPreflightIssues(issues);
      setShowRunModal(false);
      return;
    }
    clearPreflightIssues();
    setShowRunModal(true);
  }, [
    clearPreflightIssues,
    edges,
    executionEvents.length,
    flowId,
    gatewayCapabilitiesQuery.isError,
    gatewayCapabilitiesQuery.isLoading,
    gatewayContracts,
    gatewayReadiness,
    hasUnsavedChanges,
    inspectedRun,
    isRunning,
    nodes,
    runResult,
    setPreflightIssues,
    traceEvents.length,
    visualflowRunHint,
    visualflowRunUnavailable,
  ]);

  const resetThreadState = useCallback(() => {
    threadRootRunIdRef.current = null;
    threadRunMapRef.current.clear();
    followUpPendingThreadRef.current = null;
    setThreadRootRunId(null);
  }, []);

  useEffect(() => {
    const nextFlowId = flowId || null;
    if (activeFlowIdRef.current === nextFlowId) return;
    activeFlowIdRef.current = nextFlowId;
    setShowRunModal(false);
    setInspectedRun(null);
    setInspectedEvents([]);
    setInspectedTraceEvents([]);
    setRunResult(null);
    setExecutionEvents([]);
    setTraceEvents([]);
    setRunWorkflowId(null);
    resetThreadState();
  }, [flowId, resetThreadState]);

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
    setRunWorkflowId(flowId);
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
    setRunWorkflowId(null);
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
          const uploadUrl = endpointFromDescriptor(
            gatewayContracts?.common?.attachments?.upload,
            '/api/gateway/attachments/upload'
          );
          const res = await gatewayFetch(uploadUrl, { method: 'POST', body: form });
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
      setRunWorkflowId(flowId);
      setInspectedRun(null);
      setInspectedEvents([]);
      setInspectedTraceEvents([]);
      setRunResult(null);
      runFlow(nextInputData);
    },
    [executionEvents, flowId, gatewayContracts?.common?.attachments?.upload, resolveThreadRootId, runFlow, setIsRunning, stableSessionId]
  );

  const inspectRunById = useCallback(
    async (runId: string, opts?: { closeHistory?: boolean }) => {
      const rid = String(runId || '').trim();
      if (!rid) return;
      try {
        const data = await fetchRunHistory(rid);
        setInspectedRun(data.run);
        setInspectedEvents(Array.isArray(data.events) ? data.events : []);
        setInspectedTraceEvents(Array.isArray(data.traceEvents) ? data.traceEvents : []);
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
        setSavedFlowSignature('');
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
    if (visualflowCrudUnavailable) {
      toast.error(saveUnavailableReason);
      return;
    }
    const flow = getFlow();
    const base = (flow.name || 'Untitled').trim() || 'Untitled';
    try {
      const created = await duplicateFlow(flow, `${base} (copy)`, gatewayContracts);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      loadFlow(created);
      setSavedFlowSignature(flowSignatureFor(created));
      toast.success(`Duplicated as "${created.name}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Duplicate failed';
      toast.error(msg);
    }
  }, [gatewayContracts, getFlow, loadFlow, queryClient, saveUnavailableReason, visualflowCrudUnavailable]);

  const handlePublish = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    if (visualflowPublishUnavailable) {
      toast.error(visualflowPublishHint || 'Gateway cannot publish VisualFlows');
      return;
    }
    setShowPublishModal(true);
  }, [flowId, visualflowPublishHint, visualflowPublishUnavailable]);

  const handleLifecycle = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setShowLifecycleModal(true);
  }, [flowId]);

  const needsSaveFirst = !flowId;
  const runTooltip = visualflowRunUnavailable
    ? visualflowRunHint || 'Gateway cannot run VisualFlows'
    : needsSaveFirst
      ? 'Save the flow first to run it'
      : isRunning
        ? 'Open current run'
        : 'Run flow';
  const publishTooltip = visualflowPublishUnavailable
    ? visualflowPublishHint || 'Gateway cannot publish VisualFlows'
    : needsSaveFirst
      ? 'Save the flow first to publish it'
      : 'Publish as WorkflowBundle (.flow)';
  const lifecycleTooltip = needsSaveFirst ? 'Save the flow first' : 'Bundle lifecycle on gateway';
  const historyTooltip = runHistoryUnavailable
    ? runHistoryHint
    : needsSaveFirst
      ? 'Save the flow first to see its run history'
      : 'Run history';

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

        {/* File: create / open / save / duplicate */}
        <div className="toolbar-group" role="group" aria-label="Flow file actions">
          <ToolbarAction tooltip="New flow" label="New Flow" onClick={handleNew}>
            <IconFilePlus />
          </ToolbarAction>
          <ToolbarAction
            tooltip={visualflowCrudUnavailable ? saveUnavailableReason : 'Open a saved flow'}
            label="Open Flow"
            onClick={() => setShowFlowLibrary(true)}
            disabled={visualflowCrudUnavailable}
          >
            <IconFolder />
          </ToolbarAction>
          <ToolbarAction
            tooltip={saveDisabledReason}
            label="Save Flow"
            onClick={handleSave}
            disabled={saveMutation.isPending || visualflowCrudUnavailable || isEmptyFlow || !hasUnsavedChanges}
            className={hasUnsavedChanges ? 'save-button dirty' : 'save-button'}
          >
            <IconSave />
            {hasUnsavedChanges ? <span className="save-dirty-dot" aria-hidden="true" /> : null}
          </ToolbarAction>
          <ToolbarAction
            tooltip={visualflowCrudUnavailable ? saveUnavailableReason : 'Duplicate this flow'}
            label="Duplicate Flow"
            onClick={handleDuplicateCurrent}
            disabled={visualflowCrudUnavailable}
          >
            <IconCopy />
          </ToolbarAction>
        </div>

        {/* Transfer: JSON import/export */}
        <div className="toolbar-group" role="group" aria-label="Flow transfer">
          <ToolbarAction tooltip="Import flow from a JSON file" label="Import Flow" onClick={handleImport}>
            <IconImport />
          </ToolbarAction>
          <ToolbarAction tooltip="Export flow as a JSON file" label="Export Flow" onClick={handleExport}>
            <IconExport />
          </ToolbarAction>
        </div>

        {/* Execution: run + history */}
        <div className="toolbar-group" role="group" aria-label="Run actions">
          <ToolbarAction
            tooltip={runTooltip}
            label={isRunning ? 'Open current run' : 'Run flow'}
            onClick={handleRun}
            disabled={!flowId || visualflowRunUnavailable}
            iconOnly={false}
            className="primary run-button"
          >
            {isRunning ? <IconSpinner /> : <IconPlay />}
            <span>Run</span>
          </ToolbarAction>
          <ToolbarAction
            tooltip={historyTooltip}
            label="Open run history"
            onClick={() => setShowRunHistory(true)}
            disabled={!flowId || runHistoryUnavailable}
          >
            <IconHistory />
          </ToolbarAction>
        </div>

        {/* Gateway: publish / lifecycle / loaded models */}
        <div className="toolbar-group" role="group" aria-label="Gateway actions">
          <ToolbarAction
            tooltip={publishTooltip}
            label="Publish WorkflowBundle"
            onClick={handlePublish}
            disabled={isRunning || !flowId || visualflowPublishUnavailable}
          >
            <IconPackage />
          </ToolbarAction>
          <ToolbarAction
            tooltip={lifecycleTooltip}
            label="Lifecycle on gateway"
            onClick={handleLifecycle}
            disabled={isRunning || !flowId}
          >
            <IconLifecycle />
          </ToolbarAction>
          <ToolbarAction
            tooltip={
              gatewayReadiness.optional.modelResidency
                ? 'Models currently loaded on the gateway'
                : 'Loaded models unavailable from Gateway'
            }
            label="Open loaded models"
            onClick={() => setShowModelResidency(true)}
            iconOnly={false}
          >
            <IconChip />
            <span>Models</span>
          </ToolbarAction>
        </div>

        <div className="toolbar-spacer" />

        {/* Workspace: assistant + appearance */}
        <div className="toolbar-group" role="group" aria-label="Workspace tools">
          <ToolbarAction
            tooltip="Authoring assistant"
            label="Open authoring assistant"
            onClick={() => onOpenAssistant?.()}
            className={assistantOpen ? 'primary' : ''}
          >
            <IconSparkle />
          </ToolbarAction>
          <ToolbarAction
            tooltip="Appearance (theme + typography)"
            label="Open appearance settings"
            onClick={() => onOpenAppearance?.()}
          >
            <IconContrast />
          </ToolbarAction>
        </div>

        <ToolbarAction
          tooltip={gatewayConnected ? 'Disconnect from gateway' : 'Connect to gateway'}
          label={gatewayConnected ? 'Disconnect from gateway' : 'Connect to gateway'}
          onClick={() => (gatewayConnected ? onDisconnect?.() : onOpenConnection?.())}
          iconOnly={false}
          className={gatewayConnected ? 'connection-button' : 'primary connection-button'}
        >
          <span className={`connection-dot ${gatewayConnected ? 'online' : 'offline'}`} aria-hidden="true" />
          <span>{gatewayConnected ? 'Disconnect' : 'Connect'}</span>
        </ToolbarAction>
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
                  clearRunState();
                  clearFlow();
                  setSavedFlowSignature(flowSignatureFor({ name: 'Untitled Flow', description: '', interfaces: [], nodes: [], edges: [] }));
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
        const approvalWaitInfo = viewing ? extractPendingApprovalWait(evs) : null;
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
	        onFollowUpSubmit={!viewing && runWorkflowId && runWorkflowId === flowId ? handleFollowUpSubmit : undefined}
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
        autoApproveSessions={autoApproveSessions}
        threadRootRunId={viewing ? undefined : threadRootRunId || undefined}
        runWorkflowId={viewing ? inspectedRun?.workflow_id || flowId || null : runWorkflowId}
        gatewayContracts={gatewayContracts}
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
        gatewayContracts={gatewayContracts}
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
        gatewayContracts={gatewayContracts}
        onClose={() => setShowPublishModal(false)}
      />

      <WorkflowLifecycleModal
        isOpen={showLifecycleModal}
        flowName={flowName}
        gatewayContracts={gatewayContracts}
        onClose={() => setShowLifecycleModal(false)}
      />

      <ModelResidencyPanel
        isOpen={showModelResidency}
        gatewayContracts={gatewayContracts}
        onClose={() => setShowModelResidency(false)}
      />
    </>
  );
}

export default Toolbar;
