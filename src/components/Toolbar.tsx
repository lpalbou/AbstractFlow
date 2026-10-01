/**
 * Toolbar component with Run, Save, Export, Import actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { copyWithFeedback } from '../lib/copy_feedback';
import { loadEdgeNotice, useFlowStore } from '../hooks/useFlow';
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
  IconCopy,
  IconExecFlow,
  IconExport,
  IconFilePlus,
  IconFolder,
  IconHistory,
  IconImport,
  IconLifecycle,
  IconPackage,
  IconPlay,
  IconRedo,
  IconSave,
  IconSpinner,
  IconUndo,
} from './ToolbarIcons';
import { closeOpenNodes, createLedgerMappingState, mapLedgerRecordToEvents, type LedgerRecord } from '../utils/ledgerEvents';
import { mapGatewayRunSummary } from '../utils/gatewayRuns';
import { pickFollowUpPromptKey } from '../utils/followUpInputs';
import { extractPendingApprovalWait, extractReplayTraceEvents } from '../utils/runHistoryReplay';
import type { AutomationDefaults, ExecutionEvent, FlowRunResult, VisualFlow, RunHistoryResponse, RunSummary } from '../types/flow';
import { parseAutomationDefaults } from '../utils/triggerBindings';
import { computeRunPreflightIssues } from '../utils/preflight';
import { waitNotificationText } from '../utils/waitClassification';
import { duplicateFlowFamily, type DuplicateFamilyIO } from '../utils/duplicateFlowFamily';
import { getBundledRunTarget, listBundledFlows, mergeFlowCatalogs } from '../utils/bundledFlows';
import { INTERFACE_PINS_ADDED_NOTICE } from '../utils/flowFamilies';
import {
  interfacesFromPutResponse,
  putAutomationDefaults,
  updateOpenFlowMetadata,
} from '../hooks/openFlowMetadata';
import { errorSnippet } from '../utils/errorSnippet';
import { saveButtonDisabled, saveGateTooltip, type SaveGateInput } from '../utils/saveGate';
import { savedBaselineSnapshot, shouldRebaselineOnIdentityChange } from '../utils/saveBaseline';
import type { PublishedBundleTarget } from '../utils/workflowBundles';
import {
  SHIPPED_BANNER,
  deepLinkErrorSentence,
  loadBundleDeepLink,
  parseBundleDeepLink,
  type BundleManifestView,
} from '../utils/bundleDeepLink';
import { useDeepLinkBanner } from '../hooks/deepLinkBanner';
import { useGatewayCapabilities, gatewayContractsFromCapabilities } from '../hooks/useGatewayCapabilities';
import {
  endpointFromDescriptor,
  gatewayFetch,
  gatewayJson,
  gatewayPath,
  descriptorEndpointAvailable,
  getGatewayFlowEditorReadiness,
  GatewayHttpError,
  jsonRequest,
  type GatewayContracts,
} from '../utils/gatewayClient';

// Fetch list of saved flows
async function listFlows(contracts: GatewayContracts | null): Promise<VisualFlow[]> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.collection_endpoint || 'api/gateway/visualflows';
  return gatewayJson<VisualFlow[]>(gatewayPath(endpoint));
}

// Load a specific flow
async function fetchFlow(flowId: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }));
}

async function deleteFlow(flowId: string, contracts: GatewayContracts | null): Promise<void> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  await gatewayFetch(gatewayPath(endpoint, { flow_id: flowId }), { method: 'DELETE' });
}

async function renameFlow(flowId: string, name: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ name }, { method: 'PUT' }));
}

async function updateFlowDescription(flowId: string, description: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ description }, { method: 'PUT' }));
}

async function updateFlowInterfaces(flowId: string, interfaces: string[], contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint, { flow_id: flowId }), jsonRequest({ interfaces }, { method: 'PUT' }));
}

/** `null` clears the defaults (the gateway must treat an explicit null as "remove"). */
async function updateFlowAutomationDefaults(
  flowId: string,
  automationDefaults: AutomationDefaults | null,
  contracts: GatewayContracts | null
): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return gatewayJson<VisualFlow>(
    gatewayPath(endpoint, { flow_id: flowId }),
    jsonRequest({ automation_defaults: automationDefaults }, { method: 'PUT' })
  );
}

/**
 * The document's automation defaults for a save/duplicate body: omitted when
 * the flow has none (older gateways reject unknown fields), structurally
 * validated when present (a malformed value fails the save loudly).
 */
function automationDefaultsBody(flow: VisualFlow): { automation_defaults?: AutomationDefaults } {
  if (!flow.automation_defaults) return {};
  return { automation_defaults: parseAutomationDefaults(flow.automation_defaults) };
}

/**
 * In-app confirmation prompt (never `window.confirm` — browser dialogs are
 * banned in this UI). Rendered by Toolbar as a `.modal-overlay` modal; Cancel
 * or clicking the overlay dismisses without running `onConfirm`.
 */
interface ConfirmPrompt {
  title: string;
  message: string;
  confirmLabel: string;
  /** Destructive confirms render the red danger button. */
  danger?: boolean;
  onConfirm: () => void;
}

/**
 * Confirm before an action replaces the editor's graph.
 *
 * loadFlow() clears the undo stack (`past: []`, `future: []`), so replacing a
 * dirty document is unrecoverable in-app. Open and Import used to do it with no
 * prompt at all — a single Enter on a highlighted library row could delete an
 * afternoon of authoring. The New Flow modal already warns; these must too.
 */
function discardUnsavedChangesPrompt(action: string): Omit<ConfirmPrompt, 'onConfirm'> {
  return {
    title: 'Unsaved changes',
    message: `${action} will replace the flow in the editor, and this cannot be undone.\n\nYou have unsaved changes. Save or export them first if you want to keep them.`,
    confirmLabel: 'Continue',
    danger: true,
  };
}

/** Bundled families duplicate to the gateway — confirm so operators do not spam "(copy)" rows. */
function duplicateFlowPrompt(baseName: string, isBundledFamily: boolean): Omit<ConfirmPrompt, 'onConfirm'> {
  const kind = isBundledFamily ? 'bundled workflow family' : 'workflow';
  return {
    title: 'Duplicate flow',
    message: `Duplicate "${baseName}" as a new ${kind}?\n\nThis saves an editable copy on the gateway. Prefer opening bundled workflows directly — duplicates clutter the library.`,
    confirmLabel: 'Duplicate',
  };
}

async function duplicateFlow(source: VisualFlow, newName: string, contracts: GatewayContracts | null): Promise<VisualFlow> {
  const endpoint = contracts?.flow_editor?.visualflows?.crud?.collection_endpoint || 'api/gateway/visualflows';
  return gatewayJson<VisualFlow>(gatewayPath(endpoint), jsonRequest({
      name: newName,
      description: source.description || '',
      interfaces: Array.isArray(source.interfaces) ? source.interfaces : [],
      nodes: source.nodes,
      edges: source.edges,
      entryNode: source.entryNode,
      // The function library is part of the document — omitting it here
      // silently stripped every function on duplicate (adversary P0-2).
      functions: Array.isArray(source.functions) ? source.functions : [],
      ...automationDefaultsBody(source),
    }, { method: 'POST' }));
}

/** Gateway-backed IO for family-aware duplication of bundled flows. */
function familyDuplicateIO(contracts: GatewayContracts | null): DuplicateFamilyIO {
  const collection = contracts?.flow_editor?.visualflows?.crud?.collection_endpoint || 'api/gateway/visualflows';
  const item = contracts?.flow_editor?.visualflows?.crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}';
  return {
    createFlow: (flow) => gatewayJson<VisualFlow>(gatewayPath(collection), jsonRequest(flow, { method: 'POST' })),
    updateFlowNodes: (flowId, flow, nodes) =>
      gatewayJson<VisualFlow>(
        gatewayPath(item, { flow_id: flowId }),
        jsonRequest(
          {
            name: flow.name,
            description: flow.description || '',
            interfaces: Array.isArray(flow.interfaces) ? flow.interfaces : [],
            nodes,
            edges: flow.edges,
            entryNode: flow.entryNode,
            functions: Array.isArray(flow.functions) ? flow.functions : [],
            ...automationDefaultsBody(flow),
          },
          { method: 'PUT' }
        )
      ),
    deleteFlow: async (flowId) => {
      await gatewayFetch(gatewayPath(item, { flow_id: flowId }), { method: 'DELETE' });
    },
  };
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
  pressed,
  className = '',
  children,
}: {
  tooltip: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  iconOnly?: boolean;
  /** For toggle buttons: renders aria-pressed + the active style. */
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = ['toolbar-button', iconOnly ? 'icon-button' : '', pressed ? 'active' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <AfTooltip content={tooltip} delayMs={500} maxWidthPx={340} minWidthPx={0}>
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
      >
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
  const crud = contracts?.flow_editor?.visualflows?.crud;
  const collectionUrl = gatewayPath(crud?.collection_endpoint || 'api/gateway/visualflows');
  const body = jsonRequest({
    name: flow.name,
    description: flow.description,
    interfaces: Array.isArray(flow.interfaces) ? flow.interfaces : [],
    nodes: flow.nodes,
    edges: flow.edges,
    entryNode: flow.entryNode,
    // Part of the document (adversary P0-1: Save used to toast success
    // while the gateway never received the library).
    functions: Array.isArray(flow.functions) ? flow.functions : [],
    ...automationDefaultsBody(flow),
  });

  if (!existingFlowId) {
    return gatewayJson<VisualFlow>(collectionUrl, { ...body, method: 'POST' });
  }

  const itemUrl = gatewayPath(crud?.item_endpoint || 'api/gateway/visualflows/{flow_id}', {
    flow_id: existingFlowId,
  });
  try {
    return await gatewayJson<VisualFlow>(itemUrl, { ...body, method: 'PUT' });
  } catch (error) {
    // The record we are updating is gone: deleted from another tab or session,
    // or the gateway was restarted against a different data dir. A PUT can only
    // ever 404 from here on, which would leave the document PERMANENTLY
    // unsaveable with the work stranded in the tab. Re-create it instead —
    // saving under a new id beats not saving at all, and onSuccess rebinds the
    // editor to the id the gateway returns.
    if (error instanceof GatewayHttpError && error.status === 404) {
      return gatewayJson<VisualFlow>(collectionUrl, { ...body, method: 'POST' });
    }
    throw error;
  }
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
  const normalizeFunction = (fn: any) => {
    if (!fn || typeof fn !== 'object') return fn;
    return {
      name: fn.name,
      code: fn.code,
      kind: fn.kind || null,
      description: fn.description || null,
    };
  };
  return JSON.stringify({
    name: String(value.name || '').trim(),
    description: String(value.description || ''),
    interfaces: Array.isArray(value.interfaces) ? value.interfaces : [],
    nodes: Array.isArray(value.nodes) ? value.nodes.map(normalizeNode) : [],
    edges: Array.isArray(value.edges) ? value.edges.map(normalizeEdge) : [],
    entryNode: value.entryNode || null,
    // Flow-level function library (tier 2): the code IS a runtime artifact, so
    // a function-only edit MUST dirty the flow — otherwise the drawer's whole
    // "edit shared logic in one place" pitch silently loses edits (the save
    // gate returns early on "no unsaved changes"). Adversary P0-1.
    functions: Array.isArray((value as any).functions)
      ? (value as any).functions.map(normalizeFunction)
      : [],
    automation_defaults: value.automation_defaults ?? null,
  });
}

// The assistant/appearance/connection controls moved to the kit's
// AfTopBarActions cluster rendered by App.tsx (unified top-bar contract:
// assistant → appearance → extras → Disconnect, always rightmost).
export function Toolbar() {
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
  // A discovery error only blocks CRUD while we have NO contracts to work from.
  // Once capabilities have resolved once, react-query keeps the last good data
  // across a later transient failure (expired session, gateway blip) — blocking
  // on that error turned Save into a dead control that healed on its own minutes
  // later, with no way for the user to learn why. Keep the last known-good
  // contracts and let the save attempt surface the real HTTP error instead.
  const gatewayBlockReason = gatewayCheckPending
    ? 'Checking Gateway capabilities'
    : gatewayDiscoveryError && !gatewayContracts
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
    flowFunctions,
    execView,
    setExecView,
    foldReads,
    setFoldReads,
    setPreflightIssues,
    clearPreflightIssues,
    past,
    future,
    undo,
    redo,
  } = useFlowStore();
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const [showRunModal, setShowRunModal] = useState(false);
  const [showFlowLibrary, setShowFlowLibrary] = useState(false);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);
  const [showModelResidency, setShowModelResidency] = useState(false);
  const [showNewFlowModal, setShowNewFlowModal] = useState(false);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null);
  const [runResult, setRunResult] = useState<FlowRunResult | null>(null);
  const [executionEvents, setExecutionEvents] = useState<ExecutionEvent[]>([]);
  const [traceEvents, setTraceEvents] = useState<ExecutionEvent[]>([]);
  const [loadedBundledRunTarget, setLoadedBundledRunTarget] = useState<PublishedBundleTarget | null>(null);
  const clearDeepLinkBanner = useDeepLinkBanner((s) => s.clear);
  const resetLoadedDocument = useCallback(() => {
    setLoadedBundledRunTarget(null);
    clearDeepLinkBanner();
  }, [clearDeepLinkBanner]);
  const [threadRootRunId, setThreadRootRunId] = useState<string | null>(null);
  const [runWorkflowId, setRunWorkflowId] = useState<string | null>(null);
  const threadRootRunIdRef = useRef<string | null>(null);
  /** The live ROOT run (last flow_start): terminal events from subrun ledger
   * streams are filtered against it — one failed subrun record must never
   * report the whole workflow failed. */
  const liveRootRunIdRef = useRef<string | null>(null);
  const threadRunMapRef = useRef<Map<string, string>>(new Map());
  const followUpPendingThreadRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | null>(flowId || null);
  const [inspectedRun, setInspectedRun] = useState<RunSummary | null>(null);
  const [inspectedEvents, setInspectedEvents] = useState<ExecutionEvent[]>([]);
  const [inspectedTraceEvents, setInspectedTraceEvents] = useState<ExecutionEvent[]>([]);
  const isEmptyFlow = nodes.length === 0 && edges.length === 0;
  const currentFlowSignature = useMemo(
    () => flowSignatureFor(getFlow()),
    // flowFunctions is load-bearing: a function-only edit changes the flow's
    // saved bytes but touches no node/edge, so without it here the signature
    // never recomputes and Save stays disabled on a real change (adversary P0-1).
    [edges, flowInterfaces, flowName, flowFunctions, getFlow, nodes]
  );
  const [savedFlowSignature, setSavedFlowSignature] = useState(() => flowSignatureFor(getFlow()));
  const savedFlowIdentityRef = useRef<string | null>(flowId || null);
  const hasUnsavedChanges = !isEmptyFlow && currentFlowSignature !== savedFlowSignature;
  const runnableFlowId = flowId || loadedBundledRunTarget?.flowId || '';
  const loadedBundledTargetDirty = Boolean(loadedBundledRunTarget && hasUnsavedChanges);

  useEffect(() => {
    const nextFlowId = flowId || null;
    if (savedFlowIdentityRef.current === nextFlowId) return;
    savedFlowIdentityRef.current = nextFlowId;
    // A just-completed save already published the authoritative baseline: the
    // bytes that actually reached the gateway. Re-baselining to the CURRENT
    // graph here would declare every edit made WHILE the request was in flight
    // to be already-saved — the dot goes clean, Save disables, the beforeunload
    // guard unregisters and the local draft is dropped, so that delta is gone
    // with no affordance anywhere to recover it. It fires exactly once per
    // document, on the first save: the end of a long authoring session.
    const saveJustSucceeded = saveJustSucceededRef.current;
    saveJustSucceededRef.current = false;
    const loadBaselineFlowId = loadBaselineFlowIdRef.current;
    loadBaselineFlowIdRef.current = null;
    if (shouldRebaselineOnIdentityChange({ nextFlowId, isEmptyFlow, saveJustSucceeded, loadBaselineFlowId })) {
      setSavedFlowSignature(currentFlowSignature);
    }
  }, [currentFlowSignature, flowId, isEmptyFlow]);

  const saveJustSucceededRef = useRef(false);

  /**
   * What the last loadFlow changed or could not draw — shown after EVERY way a
   * document enters the editor (open, duplicate, rename-copy, file import).
   */
  const showLoadNotices = useCallback(() => {
    const state = useFlowStore.getState();
    if (state.interfacePinsAddedOnLoad > 0) toast(INTERFACE_PINS_ADDED_NOTICE);
    // Edges the canvas could not draw are never lost silently.
    const edgeNotice = loadEdgeNotice(state.loadEdgeReport);
    if (edgeNotice) {
      if (state.loadEdgeReport.dropped.length > 0) toast.error(edgeNotice, { duration: 12000 });
      else toast(edgeNotice, { duration: 8000 });
      console.warn('[AbstractFlow] load: connections not drawn', state.loadEdgeReport);
    }
  }, []);
  // Flow id a load just published its baseline for (see adoptLoadedDocument).
  const loadBaselineFlowIdRef = useRef<string | null>(null);

  /**
   * Baseline a freshly loaded document: `loadFlow` returns the flow AS STORED,
   * so pins it added for the declared interfaces show as unsaved changes,
   * with a one-line notice. The identity-change effect keeps this baseline.
   */
  const adoptLoadedDocument = useCallback((loaded: VisualFlow) => {
    loadBaselineFlowIdRef.current = useFlowStore.getState().flowId || null;
    setSavedFlowSignature(flowSignatureFor(loaded));
    showLoadNotices();
  }, [showLoadNotices]);

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

  const showWorkflowFailedToast = useCallback(
    (fullError: unknown) => {
      const full = formatValue(fullError) || 'Unknown error';
      const snippet = errorSnippet(fullError, full);

      toast.error(
        <div
          role="button"
          tabIndex={0}
          title="Click to copy full error"
          style={{ cursor: 'pointer' }}
          onClick={() => {
            void (async () => {
              await copyWithFeedback(full, 'Copied error to clipboard');
            })();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            void (async () => {
              await copyWithFeedback(full, 'Copied error to clipboard');
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
    [formatValue]
  );

  async function fetchRunHistory(runId: string): Promise<RunHistoryResponse> {
    const historyBundleDescriptor =
      gatewayContracts?.common?.runs?.history_bundle || gatewayContracts?.flow_editor?.runs?.history_bundle;
    const hasHistoryBundleDescriptor = descriptorEndpointAvailable(historyBundleDescriptor);
    const historyBundlePath = (() => {
      if (hasHistoryBundleDescriptor) {
        return endpointFromDescriptor(
          historyBundleDescriptor,
          'api/gateway/runs/{run_id}/history_bundle',
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
        'api/gateway/runs/{run_id}/history_bundle',
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
    queryKey: ['flows', flowEditorContract?.visualflows?.crud?.collection_endpoint || 'api/gateway/visualflows'],
    queryFn: () => listFlows(gatewayContracts),
    enabled: showFlowLibrary && !visualflowCrudUnavailable && !gatewayCapabilitiesQuery.isLoading,
  });
  const bundledFlows = useMemo(() => listBundledFlows(), []);
  const flowLibraryCatalog = useMemo(
    () => mergeFlowCatalogs(flowsQuery.data || [], bundledFlows),
    [bundledFlows, flowsQuery.data]
  );
  const bundledFlowIdSet = useMemo(
    () => new Set(flowLibraryCatalog.bundledFlowIds),
    [flowLibraryCatalog.bundledFlowIds]
  );

  // Load a flow into the editor (no unsaved-changes gate — see handleLoadFlow).
  const doLoadFlow = useCallback(
    async (selectedFlowId: string) => {
      try {
        if (bundledFlowIdSet.has(selectedFlowId)) {
          const bundled = flowLibraryCatalog.flows.find((f) => f.id === selectedFlowId);
          if (!bundled) throw new Error('Bundled flow is unavailable');
          const target = getBundledRunTarget(bundled.id);
          const loaded = loadFlow(bundled);
          setFlowId(null);
          setLoadedBundledRunTarget(target);
          adoptLoadedDocument(loaded);
          setShowFlowLibrary(false);
          toast.success(
            target
              ? `Loaded bundled "${bundled.name}" as ${target.bundleRef}`
              : `Loaded bundled "${bundled.name}" as an unsaved draft`
          );
          return;
        }
        const flow = await fetchFlow(selectedFlowId, gatewayContracts);
        const loaded = loadFlow(flow);
        resetLoadedDocument();
        adoptLoadedDocument(loaded);
        setShowFlowLibrary(false);
        toast.success(`Loaded "${flow.name}"`);
      } catch (error) {
        toast.error('Failed to load flow');
      }
    },
    [bundledFlowIdSet, flowLibraryCatalog.flows, gatewayContracts, loadFlow, setFlowId]
  );

  // `?bundle=<id>&version=<v>[&flow=<flow_id>]` (gateway "Open in AbstractFlow",
  // utils/bundleDeepLink.ts): once per page load, after the gateway answered
  // its capability probe. A shipped bundle opens as an unsaved copy with a banner.
  const deepLinkHandledRef = useRef(false);
  const showDeepLinkBanner = useDeepLinkBanner((s) => s.show);
  useEffect(() => {
    if (deepLinkHandledRef.current || gatewayCapabilitiesQuery.isLoading) return;
    const link = parseBundleDeepLink(typeof window !== 'undefined' ? window.location.search : '');
    if (!link) return;
    deepLinkHandledRef.current = true;
    if ('error' in link) {
      toast.error(link.error, { duration: 10000 });
      return;
    }
    void (async () => {
      try {
        const res = await loadBundleDeepLink(link, {
          getBundle: (bundleId, version) =>
            gatewayJson<BundleManifestView>(
              gatewayPath('api/gateway/bundles/{bundle_id}', { bundle_id: bundleId }, version ? { bundle_version: version } : {})
            ),
          getBundleFlow: async (bundleId, flowId, version) =>
            (
              await gatewayJson<{ flow: VisualFlow }>(
                gatewayPath(
                  'api/gateway/bundles/{bundle_id}/flows/{flow_id}',
                  { bundle_id: bundleId, flow_id: flowId },
                  version ? { bundle_version: version } : {}
                )
              )
            ).flow,
          getVisualFlow: async (flowId) => {
            try {
              return await fetchFlow(flowId, gatewayContracts);
            } catch (error) {
              if (error instanceof GatewayHttpError && error.status === 404) return null;
              throw error;
            }
          },
        });
        const loaded = loadFlow(res.flow);
        resetLoadedDocument();
        if (res.kind === 'copy') setFlowId(null);
        adoptLoadedDocument(loaded);
        if (res.shipped) showDeepLinkBanner(SHIPPED_BANNER);
        toast.success(res.kind === 'saved' ? `Opened your flow "${res.flow.name}" (${res.bundleRef})` : `Opened ${res.bundleRef} as an unsaved copy`);
      } catch (error) {
        toast.error(deepLinkErrorSentence(error, link), { duration: 12000 });
      }
    })();
  }, [adoptLoadedDocument, gatewayCapabilitiesQuery.isLoading, gatewayContracts, loadFlow, resetLoadedDocument, setFlowId, showDeepLinkBanner]);

  // Handle loading a flow
  const handleLoadFlow = useCallback(
    (selectedFlowId: string) => {
      if (hasUnsavedChanges) {
        setConfirmPrompt({
          ...discardUnsavedChangesPrompt('Opening another flow'),
          onConfirm: () => void doLoadFlow(selectedFlowId),
        });
        return;
      }
      void doLoadFlow(selectedFlowId);
    },
    [doLoadFlow, hasUnsavedChanges]
  );

  // Family-aware duplicate for read-only bundled flows: copies the root plus
  // its readonly subflow closure into gateway storage with references
  // remapped, so the copy is self-contained (runnable + editable). Operator
  // ruling 2026-07-20: bundled selections must rename/duplicate, not refuse.
  const duplicateBundledFamily = useCallback(
    async (rootId: string, rootName: string): Promise<VisualFlow | null> => {
      if (visualflowCrudUnavailable) {
        toast.error(saveUnavailableReason);
        return null;
      }
      const { root, copies } = await duplicateFlowFamily({
        rootId,
        rootName,
        flows: flowLibraryCatalog.flows,
        readonlyIds: bundledFlowIdSet,
        io: familyDuplicateIO(gatewayContracts),
      });
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      const helpers = copies.length - 1;
      toast.success(
        helpers > 0
          ? `Copied "${root.name}" with ${helpers} subflow${helpers === 1 ? '' : 's'} into editable storage`
          : `Copied "${root.name}" into editable storage`
      );
      return root;
    },
    [
      bundledFlowIdSet,
      flowLibraryCatalog.flows,
      gatewayContracts,
      queryClient,
      saveUnavailableReason,
      visualflowCrudUnavailable,
    ]
  );

  const handleRenameFlow = useCallback(
    async (id: string, nextName: string) => {
      const name = nextName.trim();
      if (!name) return;
      if (bundledFlowIdSet.has(id)) {
        // The shipped bundle cannot be mutated; renaming it means "give me an
        // editable workflow under this name" — a family copy delivers exactly
        // that without pretending the bundled original changed.
        const root = await duplicateBundledFamily(id, name);
        if (root) {
          const loaded = loadFlow(root);
          resetLoadedDocument();
          adoptLoadedDocument(loaded);
          setShowFlowLibrary(false);
        }
        return;
      }
      // If this flow is (still) the open document when the PUT returns, update
      // it in place — never reload it, which would discard unsaved edits and
      // the undo history. A clean editor stays clean: the gateway holds this name.
      const { baseline } = await updateOpenFlowMetadata({
        id,
        hasUnsavedChanges,
        request: () => renameFlow(id, name, gatewayContracts),
        patchFrom: (updated) => ({ name: updated.name || name }),
      });
      if (baseline) setSavedFlowSignature(flowSignatureFor(baseline));
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Renamed');
    },
    [bundledFlowIdSet, duplicateBundledFamily, gatewayContracts, hasUnsavedChanges, loadFlow, queryClient]
  );

  const handleUpdateDescription = useCallback(
    async (id: string, nextDescription: string) => {
      if (bundledFlowIdSet.has(id)) {
        toast.error('Bundled flows are read-only. Load or duplicate first.');
        return;
      }
      // The description lives only in the saved flow (the editor document has
      // no description field), so the open document needs no update — and
      // must not be reloaded, which would discard unsaved edits.
      await updateFlowDescription(id, nextDescription, gatewayContracts);
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Description updated');
    },
    [bundledFlowIdSet, gatewayContracts, queryClient]
  );

  const handleUpdateInterfaces = useCallback(
    async (id: string, nextInterfaces: string[]) => {
      if (bundledFlowIdSet.has(id)) {
        toast.error('Bundled flows are read-only. Load or duplicate first.');
        return;
      }
      // If this flow is (still) the open document when the PUT returns, update
      // it in place: unsaved edits and undo history are kept, and the On Flow
      // Start / On Flow End nodes receive the pins the interfaces require (one
      // undo step). The gateway holds the new interfaces but not those pins
      // yet, so the flow shows unsaved changes until Save stores both; a clean
      // editor with nothing to add stays clean.
      const { baseline } = await updateOpenFlowMetadata({
        id,
        hasUnsavedChanges,
        request: () => updateFlowInterfaces(id, nextInterfaces, gatewayContracts),
        patchFrom: (updated) => ({ interfaces: interfacesFromPutResponse(updated) }),
      });
      if (baseline) setSavedFlowSignature(flowSignatureFor(baseline));
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Interfaces updated');
    },
    [bundledFlowIdSet, gatewayContracts, hasUnsavedChanges, queryClient]
  );

  const handleUpdateAutomationDefaults = useCallback(
    async (id: string, next: AutomationDefaults | null) => {
      if (bundledFlowIdSet.has(id)) {
        toast.error('Bundled flows are read-only. Load or duplicate first.');
        return;
      }
      // Same metadata path as interfaces: PUT, then patch the open document
      // (if it is still this flow) with what the gateway stored.
      const { baseline } = await putAutomationDefaults({
        id,
        next,
        hasUnsavedChanges,
        put: () => updateFlowAutomationDefaults(id, next, gatewayContracts),
      });
      if (baseline) setSavedFlowSignature(flowSignatureFor(baseline));
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success(next ? 'Automation defaults saved' : 'Automation defaults removed');
    },
    [bundledFlowIdSet, gatewayContracts, hasUnsavedChanges, queryClient]
  );

  const handleDeleteFlow = useCallback(
    async (id: string) => {
      if (bundledFlowIdSet.has(id)) {
        toast.error('Bundled flows are read-only. Load or duplicate first.');
        return;
      }
      await deleteFlow(id, gatewayContracts);
      if (flowId && id === flowId) {
        // Keep the current graph but mark it as unsaved.
        setFlowId(null);
        resetLoadedDocument();
        setSavedFlowSignature('');
        toast.success('Deleted (editor is now unsaved)');
      } else {
        toast.success('Deleted');
      }
      queryClient.invalidateQueries({ queryKey: ['flows'] });
    },
    [bundledFlowIdSet, flowId, gatewayContracts, queryClient, setFlowId]
  );

  const handleDuplicateFlow = useCallback(
    (id: string) => {
      if (visualflowCrudUnavailable) {
        toast.error(saveUnavailableReason);
        return;
      }
      const all = flowLibraryCatalog.flows;
      const src = all.find((f) => f.id === id);
      if (!src) return;
      const base = (src.name || 'Untitled').trim() || 'Untitled';
      const isBundled = bundledFlowIdSet.has(id);
      setConfirmPrompt({
        ...duplicateFlowPrompt(base, isBundled),
        onConfirm: () => {
          void (async () => {
            try {
              if (isBundled) {
                const root = await duplicateBundledFamily(id, `${base} (copy)`);
                if (root) {
                  const loaded = loadFlow(root);
                  resetLoadedDocument();
                  adoptLoadedDocument(loaded);
                  setShowFlowLibrary(false);
                }
                return;
              }
              const created = await duplicateFlow(src, `${base} (copy)`, gatewayContracts);
              queryClient.invalidateQueries({ queryKey: ['flows'] });
              const loaded = loadFlow(created);
              resetLoadedDocument();
              adoptLoadedDocument(loaded);
              setShowFlowLibrary(false);
              toast.success(`Duplicated as "${created.name}"`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Duplicate failed');
            }
          })();
        },
      });
    },
    [
      bundledFlowIdSet,
      duplicateBundledFamily,
      flowLibraryCatalog.flows,
      gatewayContracts,
      loadFlow,
      queryClient,
      saveUnavailableReason,
      visualflowCrudUnavailable,
    ]
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
      resetLoadedDocument();
      // The baseline must be the bytes we SENT, never the server's echo. The
      // dirty flag is `flowSignatureFor(getFlow()) !== savedFlowSignature`, and
      // getFlow() is the only thing that produces the left-hand side — so any
      // field taken from the response that getFlow() cannot reproduce pins the
      // flow to "dirty" forever. That is not hypothetical: the signature counts
      // `description`, the gateway faithfully returns the stored description,
      // and the store has no description field at all (FlowState in
      // hooks/useFlow.ts), so every flow with a description used to come back
      // from a successful save still showing the amber dot — and Run refused it
      // with "Save the flow before running current changes", permanently.
      setSavedFlowSignature(flowSignatureFor(savedBaselineSnapshot(variables.flow, savedId)));
      // Any transition of flowId can trip the identity effect into overwriting
      // the baseline we just set: a create (null -> id), and also the 404
      // fallback in saveFlow, which re-creates a deleted record under a NEW id.
      // A plain PUT keeps the same id, so the effect early-returns and the flag
      // is neither set nor left stranded.
      if (savedId && savedId !== variables.existingFlowId) saveJustSucceededRef.current = true;
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Flow saved!');
    },
    onError: (error) => {
      // An expired browser session is the single most common save failure and
      // the least self-explanatory: the top-bar pill still reads "connected"
      // (it is probed once at mount), so "HTTP 401" alone tells the user
      // nothing about what to do. Name the fix, and keep the graph in the
      // editor — nothing was lost, it just was not written.
      if (error instanceof GatewayHttpError && (error.status === 401 || error.status === 403)) {
        toast.error(
          'Save failed: your Gateway session expired. Reconnect from the top bar, then save again — your unsaved graph is still here.',
          { duration: 8000 }
        );
        return;
      }
      // 413: the gateway caps request bodies at 256KB
      // (abstractgateway security policy max_body_bytes). A large flow can sit
      // permanently over that line, so "Save failed: HTTP 413" would be a dead
      // end. Name the one action that still preserves the work.
      if (error instanceof GatewayHttpError && error.status === 413) {
        toast.error(
          'Save failed: this flow is larger than the Gateway accepts in one request. Export to JSON now so the work is safe, then split the flow into subflows or raise the Gateway body limit.',
          { duration: 12000 }
        );
        return;
      }
      toast.error(`Save failed: ${error.message}`);
    },
  });

  const saveGate: SaveGateInput = {
    savePending: saveMutation.isPending,
    isEmptyFlow,
    hasUnsavedChanges,
    crudUnavailable: visualflowCrudUnavailable,
    crudUnavailableReason: saveUnavailableReason,
    bundledReadOnly: Boolean(loadedBundledRunTarget),
  };
  const saveDisabledReason = saveGateTooltip(saveGate);

  // WebSocket for real-time execution (if flow is saved)
  const {
    isWaiting,
    isPaused,
    waitingInfo,
    resumeFlow,
    emitEvent,
    runFlow,
    runPublishedFlow,
    pauseRun,
    resumeRun,
    cancelRun,
    resetSession,
    stableSessionId,
    autoApproveSessions,
    setAutoApproveForSession,
    setAutoApproveForRunRoot,
  } = useWebSocket({
    flowId: runnableFlowId,
    onEvent: (event) => {
      console.log('Execution event:', event);
      if (event.type === 'flow_start') {
        const actualRunId = typeof event.runId === 'string' ? event.runId.trim() : '';
        if (actualRunId) liveRootRunIdRef.current = actualRunId;
        if (actualRunId && runnableFlowId) setRunWorkflowId((prev) => prev || runnableFlowId);
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

      // Update run result when flow completes via WebSocket. Terminal events
      // carry a ROOT-run guard: a failed record streamed from a subrun ledger
      // must not report the whole workflow failed while the root still runs
      // (adversary find — node events had this guard, terminal events did not).
      const isTerminalEvent =
        event.type === 'flow_complete' || event.type === 'flow_error' || event.type === 'flow_cancelled';
      if (
        isTerminalEvent &&
        typeof event.runId === 'string' &&
        event.runId.trim() &&
        liveRootRunIdRef.current &&
        event.runId.trim() !== liveRootRunIdRef.current
      ) {
        return;
      }
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
          cancelled: true,
          error: 'Cancelled',
        });
        toast('Workflow cancelled');
      }
    },
    onWaiting: (info) => {
      // Reason-aware (backlog 0138): only interrupt for waits that actually
      // need the user. Event/deadline parks (a resident agent on wait_event,
      // a wait_until timer) keep running in the background — no force-open,
      // no "respond" toast. The toolbar badge surfaces interactive waits for
      // users who navigated away from the modal.
      const interactivity = info.interactivity ?? 'prompt';
      const text = waitNotificationText(interactivity);
      if (interactivity === 'park') {
        // A park is honest run state, not an interruption; the run modal (if
        // open) still shows it, and the toolbar badge does not light up.
        return;
      }
      if (text) toast(text);
      setShowRunModal(true);
    },
  });

  // Handle save
  const handleSave = useCallback(() => {
    // Ctrl/⌘+S calls this directly, bypassing the button's disabled state — so
    // the in-flight guard has to live here too. Without it, two saves fired
    // before the first response both see existingFlowId === null and both POST,
    // creating two library records for one flow (the gateway mints a fresh
    // uuid per POST and does no dedup).
    if (saveMutation.isPending) return;
    if (visualflowCrudUnavailable) {
      toast.error(saveUnavailableReason);
      return;
    }
    if (loadedBundledRunTarget) {
      toast.error(
        'Bundled workflow families are read-only. Use Duplicate to keep your edits as your own workflow, or Export to JSON.',
        { duration: 8000 }
      );
      return;
    }
    if (isEmptyFlow) {
      toast.error('Add at least one node before saving');
      return;
    }
    if (!hasUnsavedChanges) {
      // Reachable only via Ctrl/⌘+S (the button is disabled here). A keystroke
      // that produces no visible response is indistinguishable from the bug
      // this whole gate exists to prevent — always answer.
      toast('No unsaved changes');
      return;
    }
    const flow = getFlow();
    if (!flow.name.trim()) {
      toast.error('Please enter a flow name');
      return;
    }
    saveMutation.mutate({ flow, existingFlowId: flowId });
  }, [flowId, getFlow, hasUnsavedChanges, isEmptyFlow, loadedBundledRunTarget, saveMutation, saveUnavailableReason, visualflowCrudUnavailable]);

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

  // Closing/refreshing the tab with unsaved graph changes (or a save still in
  // flight) asks the browser-native confirmation.
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
    if (!runnableFlowId) {
      toast.error('Please save the flow first or load a runnable bundled workflow');
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
      toast.error(
        loadedBundledRunTarget
          ? 'Bundled workflow families run from the shipped bundle; reload it before running after local edits.'
          : 'Save the flow before running current changes'
      );
      return;
    }
    const issues = computeRunPreflightIssues(nodes, edges, {
      gatewayReadiness,
      gatewayCapabilitiesLoading: gatewayCapabilitiesQuery.isLoading,
      gatewayCapabilitiesKnown: Boolean(gatewayContracts && !gatewayCapabilitiesQuery.isError),
      flowFunctions: useFlowStore.getState().flowFunctions,
      flowInterfaces: useFlowStore.getState().flowInterfaces,
    });
    // Only DEFINITE defects block the Run button; advisory 'warning' issues
    // (heuristics that admit uncertainty) surface in the panel but never gate.
    const blocking = issues.filter((issue) => issue.severity !== 'warning');
    if (blocking.length > 0) {
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
    loadedBundledRunTarget,
    nodes,
    runnableFlowId,
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
    const nextFlowId = runnableFlowId || null;
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
  }, [runnableFlowId, resetThreadState]);

  // Handle run from modal
  const handleRunExecute = useCallback((inputData: Record<string, unknown>) => {
    if (!runnableFlowId) return;
    setIsRunning(true);
    setInspectedRun(null);
    setInspectedEvents([]);
    setInspectedTraceEvents([]);
    setRunResult(null);
    setExecutionEvents([]);
    setTraceEvents([]);
    const target = loadedBundledRunTarget;
    setRunWorkflowId(target?.flowId || flowId);
    resetThreadState();
    if (target) {
      void runPublishedFlow(target, inputData);
      return;
    }
    runFlow(inputData);
  }, [flowId, loadedBundledRunTarget, resetThreadState, runFlow, runPublishedFlow, runnableFlowId, setIsRunning]);

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

  // Approve-All revoke (backlog 0138): the hook setters already accept
  // enabled=false — this is the first caller. After revoke, the hook's
  // auto-approve check no longer matches this session/run root, so the next
  // tool-approval wait surfaces a prompt again.
  const handleRevokeAutoApprove = useCallback(
    (ctx?: { rootRunId?: string; sessionId?: string }) => {
      const sid =
        typeof ctx?.sessionId === 'string' && ctx.sessionId.trim()
          ? ctx.sessionId.trim()
          : typeof stableSessionId === 'string' && stableSessionId.trim()
            ? stableSessionId.trim()
            : '';
      if (sid) setAutoApproveForSession?.(sid, false);
      const rootId = typeof ctx?.rootRunId === 'string' ? ctx.rootRunId.trim() : '';
      if (rootId) setAutoApproveForRunRoot?.(rootId, false);
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
            'api/gateway/attachments/upload'
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
      // Prompt-key fidelity (backlog 0115): write the follow-up message to the
      // SAME key the prior run's prompt was read from (task/query/...), not a
      // hardcoded `prompt` — otherwise a task-keyed flow re-runs the old task
      // with the new message parked in an unused key.
      nextInputData[pickFollowUpPromptKey(baseDefaults)] = payload.message;
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

  // Open the file picker and import (no unsaved-changes gate — see handleImport).
  const doImport = useCallback(() => {
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
        // An imported file's id is not OUR storage identity: a minted
        // export id would PUT to a 404, and a stored flow's id would let
        // Save silently overwrite the original (adversary P1-1). Import
        // always lands as a NEW unsaved document; Save creates it.
        setFlowId(null);
        resetLoadedDocument();
        setSavedFlowSignature('');
        toast.success('Flow imported as a new draft — Save stores it');
        showLoadNotices();
      } catch (err) {
        toast.error('Failed to import flow');
      }
    };

    input.click();
  }, [loadFlow, setFlowId, showLoadNotices]);

  // Handle import
  const handleImport = useCallback(() => {
    if (hasUnsavedChanges) {
      setConfirmPrompt({
        ...discardUnsavedChangesPrompt('Importing a flow'),
        onConfirm: doImport,
      });
      return;
    }
    doImport();
  }, [doImport, hasUnsavedChanges]);

  const createNewFlow = useCallback(() => {
    setShowNewFlowModal(false);
    clearRunState();
    clearFlow();
    resetLoadedDocument();
    setSavedFlowSignature(flowSignatureFor({ name: 'Untitled Flow', description: '', interfaces: [], nodes: [], edges: [] }));
    toast.success('Created new flow');
  }, [clearFlow, clearRunState, resetLoadedDocument]);

  // Handle new flow — only ask for confirmation when there is something to lose.
  const handleNew = useCallback(() => {
    if (!hasUnsavedChanges) {
      createNewFlow();
      return;
    }
    setShowNewFlowModal(true);
  }, [createNewFlow, hasUnsavedChanges]);

  // Duplicate the current flow in-place (keeps current editor state as the source).
  const handleDuplicateCurrent = useCallback(() => {
    if (visualflowCrudUnavailable) {
      toast.error(saveUnavailableReason);
      return;
    }
    if (loadedBundledRunTarget) {
      // A loaded bundle-target family duplicates as a FAMILY copy (root +
      // readonly subflow closure, references remapped) — the standalone-copy
      // refusal is retired (operator ruling 2026-07-20).
      const base = (getFlow().name || loadedBundledRunTarget.flowId || 'Untitled').trim() || 'Untitled';
      // ...but the family copy is built from the SHIPPED catalog entry, not
      // from the editor. Running it against an edited bundle would duplicate
      // the pristine original and then overwrite the user's graph with it —
      // silently destroying every change they made. Opening a flagship example
      // and adapting it is a primary authoring path, and Save refuses bundled
      // targets, so this is the only route their work has out. When the editor
      // is dirty, their bytes win: copy what is on screen.
      if (loadedBundledTargetDirty) {
        const flow = getFlow();
        setConfirmPrompt({
          title: 'Save edits as a new workflow',
          message: `Save your edits to "${base}" as a new standalone workflow?\n\nThis copies the graph currently in the editor. It will not carry the bundled family's subflow closure — duplicate the unmodified bundle for that.`,
          confirmLabel: 'Save copy',
          onConfirm: () => {
            void (async () => {
              try {
                const created = await duplicateFlow(flow, `${base} (copy)`, gatewayContracts);
                queryClient.invalidateQueries({ queryKey: ['flows'] });
                setFlowId(created.id);
                resetLoadedDocument();
                setSavedFlowSignature(flowSignatureFor(savedBaselineSnapshot(flow, created.id)));
                toast.success(`Saved your edits as "${created.name}"`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Duplicate failed');
              }
            })();
          },
        });
        return;
      }
      const bundledFlowId = loadedBundledRunTarget.flowId;
      setConfirmPrompt({
        ...duplicateFlowPrompt(base, true),
        onConfirm: () => {
          void (async () => {
            try {
              const root = await duplicateBundledFamily(bundledFlowId, `${base} (copy)`);
              if (root) {
                const loaded = loadFlow(root);
                resetLoadedDocument();
                adoptLoadedDocument(loaded);
              }
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Duplicate failed');
            }
          })();
        },
      });
      return;
    }
    const flow = getFlow();
    const base = (flow.name || 'Untitled').trim() || 'Untitled';
    setConfirmPrompt({
      ...duplicateFlowPrompt(base, false),
      onConfirm: () => {
        void (async () => {
          try {
            const created = await duplicateFlow(flow, `${base} (copy)`, gatewayContracts);
            queryClient.invalidateQueries({ queryKey: ['flows'] });
            const loaded = loadFlow(created);
            resetLoadedDocument();
            adoptLoadedDocument(loaded);
            toast.success(`Duplicated as "${created.name}"`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Duplicate failed');
          }
        })();
      },
    });
  }, [duplicateBundledFamily, gatewayContracts, getFlow, loadFlow, loadedBundledRunTarget, loadedBundledTargetDirty, queryClient, saveUnavailableReason, setFlowId, visualflowCrudUnavailable]);

  const handlePublish = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    if (loadedBundledRunTarget) {
      toast.error('Bundled workflow families are already shipped as WorkflowBundles.');
      return;
    }
    if (visualflowPublishUnavailable) {
      toast.error(visualflowPublishHint || 'Gateway cannot publish VisualFlows');
      return;
    }
    setShowPublishModal(true);
  }, [flowId, loadedBundledRunTarget, visualflowPublishHint, visualflowPublishUnavailable]);

  const handleLifecycle = useCallback(() => {
    if (!flowId) {
      toast.error('Please save the flow first');
      return;
    }
    setShowLifecycleModal(true);
  }, [flowId]);

  const needsSaveFirst = !runnableFlowId;
  const runTooltip = visualflowRunUnavailable
    ? visualflowRunHint || 'Gateway cannot run VisualFlows'
    : loadedBundledTargetDirty
      ? 'Reload the bundled workflow before running; local edits cannot run as the shipped bundle'
    : needsSaveFirst
      ? 'Save the flow first to run it'
      : isRunning
        ? 'Open current run'
        : 'Run flow';
  const publishTooltip = visualflowPublishUnavailable
    ? visualflowPublishHint || 'Gateway cannot publish VisualFlows'
    : loadedBundledRunTarget
      ? 'Bundled workflow families are already shipped as WorkflowBundles'
    : needsSaveFirst
      ? 'Save the flow first to publish it'
      : 'Publish as WorkflowBundle (.flow)';
  const lifecycleTooltip = loadedBundledRunTarget
    ? 'Bundled workflow families use their shipped bundle lifecycle'
    : needsSaveFirst
      ? 'Save the flow first'
      : 'Bundle lifecycle on gateway';
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
          aria-label="Flow name"
        />

        {/* The action groups. On desktop this wrapper is display: contents (the
            groups sit in the toolbar row exactly as before); below 1024 px it is
            a horizontally scrolling strip so the header never overflows. */}
        <div className="toolbar-actions" role="toolbar" aria-label="Flow actions">
        {/* Edit: undo / redo */}
        <div className="toolbar-group" role="group" aria-label="Edit history">
          <ToolbarAction
            tooltip={canUndo ? 'Undo (Ctrl/Cmd+Z)' : 'Nothing to undo'}
            label="Undo"
            onClick={undo}
            disabled={!canUndo}
          >
            <IconUndo />
          </ToolbarAction>
          <ToolbarAction
            tooltip={canRedo ? 'Redo (Shift+Ctrl/Cmd+Z)' : 'Nothing to redo'}
            label="Redo"
            onClick={redo}
            disabled={!canRedo}
          >
            <IconRedo />
          </ToolbarAction>
        </div>

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
            // A dirty flow's Save button is NEVER a dead control — see
            // utils/saveGate.ts for the rule and its regression test.
            disabled={saveButtonDisabled(saveGate)}
            className={hasUnsavedChanges ? 'save-button dirty' : 'save-button'}
          >
            <IconSave />
            {hasUnsavedChanges ? <span className="save-dirty-dot" aria-hidden="true" /> : null}
          </ToolbarAction>
          <ToolbarAction
            tooltip={
              visualflowCrudUnavailable
                ? saveUnavailableReason
                : loadedBundledTargetDirty
                  ? 'Save your edits to this bundled workflow as your own copy'
                  : loadedBundledRunTarget
                    ? 'Duplicate this bundled family as an editable copy'
                    : 'Duplicate this flow'
            }
            label="Duplicate Flow"
            onClick={handleDuplicateCurrent}
            // Not disabled for a loaded bundled target: with Save refusing those,
            // Duplicate is the only way edits made to a bundled example can be
            // kept, and a disabled button cannot say so.
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
            disabled={!runnableFlowId || visualflowRunUnavailable || loadedBundledTargetDirty}
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
            disabled={!runnableFlowId || runHistoryUnavailable}
          >
            <IconHistory />
          </ToolbarAction>
          {/* Waiting-for-you badge (backlog 0138): only for INTERACTIVE waits
              (approval/prompt), so a user who navigated away from the modal
              still sees that the run needs them — event/deadline parks stay
              silent. Jumps back into the run modal. */}
          {isWaiting && !isPaused && waitingInfo && waitingInfo.interactivity !== 'park' ? (
            <button
              type="button"
              className="toolbar-wait-badge"
              onClick={() => setShowRunModal(true)}
              title="This run needs you — open it"
            >
              <span className="toolbar-wait-badge-dot" aria-hidden="true" />
              {waitingInfo.interactivity === 'approval' ? 'Approval needed' : 'Waiting for you'}
            </button>
          ) : null}
        </div>

        {/* Gateway: publish / lifecycle / loaded models */}
        <div className="toolbar-group" role="group" aria-label="Gateway actions">
          <ToolbarAction
            tooltip={publishTooltip}
            label="Publish WorkflowBundle"
            onClick={handlePublish}
            disabled={isRunning || !flowId || Boolean(loadedBundledRunTarget) || visualflowPublishUnavailable}
          >
            <IconPackage />
          </ToolbarAction>
          <ToolbarAction
            tooltip={lifecycleTooltip}
            label="Lifecycle on gateway"
            onClick={handleLifecycle}
            disabled={isRunning || !flowId || Boolean(loadedBundledRunTarget)}
          >
            <IconLifecycle />
          </ToolbarAction>
          <ToolbarAction
            tooltip={
              gatewayReadiness.optional.modelResidency
                ? 'Host resources: loaded models, memory, session caches'
                : 'Model residency unavailable from Gateway'
            }
            label="Open resources"
            onClick={() => setShowModelResidency(true)}
            iconOnly={false}
          >
            <IconChip />
            <span>Resources</span>
          </ToolbarAction>
        </div>

        {/* Canvas view: condensed execution-flow toggle */}
        <div className="toolbar-group" role="group" aria-label="Canvas view">
          <ToolbarAction
            tooltip={
              execView
                ? 'Back to the full graph (all nodes and data edges)'
                : 'Execution view: condensed graph showing only the execution flow'
            }
            label="Toggle execution view"
            onClick={() => setExecView(!execView)}
            pressed={execView}
          >
            <IconExecFlow />
          </ToolbarAction>
          <ToolbarAction
            tooltip={
              foldReads
                ? 'Unfold reads: draw every Get Variable as a node card'
                : 'Fold reads: single-consumer Get Variables render on their consumer pin rows'
            }
            label="Toggle folded reads"
            onClick={() => setFoldReads(!foldReads)}
            pressed={foldReads}
          >
            <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>&#x1F4E5;</span>
          </ToolbarAction>
        </div>

        </div>

        <div className="toolbar-spacer" />
      </div>

      {/* The toolbar's dialogs render into <body>, not inside the page
          <header>: a dialog is not part of the banner landmark (screen
          readers announced the run window as header content), and the
          header's own layout and stacking no longer reach the sheets. */}
      {createPortal(
        <>
        {showNewFlowModal ? (
          <div className="modal-overlay" onClick={() => setShowNewFlowModal(false)} role="presentation">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>New flow</h3>
              <p>Create a new flow? Any unsaved changes will be lost.</p>
              <div className="modal-actions">
                <button className="modal-button cancel" onClick={() => setShowNewFlowModal(false)}>
                  Cancel
                </button>
                <button className="modal-button danger" onClick={createNewFlow}>
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
          onRevokeAutoApprove={handleRevokeAutoApprove}
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
          onEmitEvent={emitEvent}
          onPause={() => pauseRun(inspectedRun?.run_id)}
          onResumeRun={() => resumeRun(inspectedRun?.run_id)}
          onCancelRun={() =>
            cancelRun(inspectedRun?.run_id).then((confirmed) => {
              // Surface the failure path visibly (adversary A1): without this,
              // a refused/timed-out cancel wrote an error nobody rendered.
              if (!confirmed) toast.error('Cancel not confirmed — the gateway may still be processing it. Try again.');
            })
          }
          onSelectRunId={handleSelectRunFromModal}
          runSummary={viewing ? inspectedRun : null}
        />
          );
        })()}

        <RunHistoryModal
          isOpen={showRunHistory}
          workflowId={runnableFlowId || ''}
          workflowName={flowName}
          gatewayContracts={gatewayContracts}
          onClose={() => setShowRunHistory(false)}
          onSelectRun={handleSelectHistoryRun}
        />

        <FlowLibraryModal
          isOpen={showFlowLibrary}
          currentFlowId={flowId}
          flows={flowLibraryCatalog.flows}
          readonlyFlowIds={flowLibraryCatalog.bundledFlowIds}
          bundledRunTargetIds={flowLibraryCatalog.bundledRunTargetIds}
          isLoading={flowsQuery.isLoading && flowLibraryCatalog.flows.length === 0}
          isRefreshing={flowsQuery.isFetching && flowLibraryCatalog.flows.length > 0 && !flowsQuery.data}
          // `flows` ALWAYS contains the ~25 bundled examples (a static glob), so
          // gating this on `length === 0` made the error branch unreachable: when
          // the session expired and the user opened the library to find their
          // work, they saw the shipped examples and no explanation — their own
          // flows looked deleted. Surface the fetch error whenever there is one.
          error={flowsQuery.error}
          onClose={() => setShowFlowLibrary(false)}
          onRefresh={() => flowsQuery.refetch()}
          onLoadFlow={handleLoadFlow}
          onRenameFlow={handleRenameFlow}
          onUpdateDescription={handleUpdateDescription}
          onUpdateInterfaces={handleUpdateInterfaces}
          onUpdateAutomationDefaults={handleUpdateAutomationDefaults}
          gatewayContracts={gatewayContracts}
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

        {/* In-app confirmation modal (browser dialogs are banned in this UI).
            Rendered last so it stacks above any other open modal. */}
        {confirmPrompt ? (
          <div className="modal-overlay" onClick={() => setConfirmPrompt(null)} role="presentation">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>{confirmPrompt.title}</h3>
              <p style={{ whiteSpace: 'pre-line' }}>{confirmPrompt.message}</p>
              <div className="modal-actions">
                <button className="modal-button cancel" onClick={() => setConfirmPrompt(null)}>
                  Cancel
                </button>
                <button
                  className={confirmPrompt.danger ? 'modal-button danger' : 'modal-button primary'}
                  onClick={() => {
                    const action = confirmPrompt.onConfirm;
                    setConfirmPrompt(null);
                    action();
                  }}
                >
                  {confirmPrompt.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        </>,
        document.body,
      )}
    </>
  );
}

export default Toolbar;
