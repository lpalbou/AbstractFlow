/**
 * Smart Run Flow Modal
 *
 * Auto-generates form fields based on the entry node's output pins.
 * Shows execution progress and results.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useFlowStore } from '../hooks/useFlow';
import type { ExecutionEvent, ExecutionMetrics, Pin, FlowRunResult, RunSummary } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import { RECALL_LEVEL_OPTIONS } from '../types/recall';
import type { WaitingInfo } from '../hooks/useWebSocket';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentSubrunTracePanel } from './AgentSubrunTracePanel';
import AfSelect from './inputs/AfSelect';
import AfMultiSelect from './inputs/AfMultiSelect';
import { useProviders, useModels } from '../hooks/useProviders';
import { useTools } from '../hooks/useTools';
import { useExecutionWorkspace } from '../hooks/useExecutionWorkspace';
import { RunSwitcherDropdown } from './RunSwitcherDropdown';
import { JsonViewer } from './JsonViewer';
import { KgActiveMemoryPanel } from './KgActiveMemoryPanel';

interface RunFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRun: (inputData: Record<string, unknown>) => void;
  onRunAgain: () => void;
  isRunning: boolean;
  isPaused?: boolean;
  result: FlowRunResult | null;
  events?: ExecutionEvent[];
  traceEvents?: ExecutionEvent[];
  isWaiting?: boolean;
  waitingInfo?: WaitingInfo | null;
  onResume?: (response: string) => void;
  onPause?: () => void;
  onResumeRun?: () => void;
  onCancelRun?: () => void;
  onSelectRunId?: (runId: string) => void;
  runSummary?: RunSummary | null;
}

type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseJson<T>(raw: string): JsonParseResult<T> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { ok: false, error: 'Empty' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return { ok: false, error: msg };
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function MinimizeWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M7 9l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15 4h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 20H4v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RestoreWindowIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5 15h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 9h-5V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 10l6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 14l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function randomUuidHex(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // ignore
  }
  try {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // ignore
  }
  // Non-crypto fallback (best-effort; still unique enough for UI defaults).
  return (
    Math.random().toString(16).slice(2).padEnd(16, '0') +
    Math.random().toString(16).slice(2).padEnd(16, '0')
  ).slice(0, 32);
}

function joinPath(base: string, child: string): string {
  const b = String(base || '');
  const c = String(child || '');
  if (!b) return c;
  if (!c) return b;
  const sep = b.includes('\\') ? '\\' : '/';
  const b2 = b.endsWith('/') || b.endsWith('\\') ? b.slice(0, -1) : b;
  const c2 = c.replace(/^[/\\]+/, '');
  return `${b2}${sep}${c2}`;
}

function ArrayParamEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  // Support empty -> []
  const trimmed = (value || '').trim();
  const parsed = trimmed ? parseJson<unknown>(trimmed) : ({ ok: true, value: [] } as const);

  const canUseList = parsed.ok && isStringArray(parsed.value);
  const items = canUseList ? parsed.value : [];

  const setItems = (nextItems: string[]) => {
    onChange(stringifyJson(nextItems));
  };

  if (!canUseList) {
    const hint =
      !trimmed
        ? 'Enter a JSON array (e.g., ["a","b"]).'
        : !parsed.ok
          ? `Invalid JSON: ${parsed.error}`
          : 'This array contains non-string items. Use Raw JSON to edit advanced arrays.';

    return (
      <div className="array-editor">
        <span className="property-hint">{hint}</span>
        <textarea
          className="run-form-input property-textarea code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="[ ]"
          rows={5}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div className="array-editor">
      {items.map((item, index) => (
        <div key={index} className="array-item">
          <input
            type="text"
            className="run-form-input array-item-input"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[index] = e.target.value;
              setItems(next);
            }}
            placeholder={`Item ${index + 1}`}
            disabled={disabled}
          />
          <button
            type="button"
            className="array-item-remove"
            onClick={() => setItems(items.filter((_, i) => i !== index))}
            title="Remove item"
            disabled={disabled}
          >
            &times;
          </button>
        </div>
      ))}

      <button
        type="button"
        className="array-add-button"
        onClick={() => setItems([...items, ''])}
        disabled={disabled}
      >
        + Add Item
      </button>

      <span className="property-hint">{items.length} items</span>

      <details className="raw-json-details">
        <summary>Raw JSON (advanced)</summary>
        <textarea
          className="run-form-input property-textarea code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='[\n  "item"\n]'
          rows={6}
          disabled={disabled}
        />
      </details>
    </div>
  );
}

// Map pin types to input field types
function getInputTypeForPin(pinType: string): 'text' | 'number' | 'checkbox' | 'textarea' {
  switch (pinType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'checkbox';
    case 'string':
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
    case 'provider':
      return 'Select provider…';
    case 'model':
      return 'Select model…';
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
  isPaused = false,
  result,
  events = [],
  traceEvents = [],
  isWaiting = false,
  waitingInfo = null,
  onResume,
  onPause,
  onResumeRun,
  onCancelRun,
  onSelectRunId,
  runSummary = null,
}: RunFlowModalProps) {
  const { nodes, edges, flowName, flowId, lastLoopProgress, loopProgressByNodeId } = useFlowStore();

  const memoryScopeOptions = useMemo(() => {
    // Heuristic: `scope` is a platform-wide memory routing enum.
    // - `all` is only meaningful for query-like operations (fan-out over run+session+global).
    const allowAll = nodes.some((n) => {
      const t = n?.data?.nodeType;
      if (t === 'memory_query' || t === 'memory_tag' || t === 'memory_kg_query') return true;
      if (t === 'subflow') {
        const ins = Array.isArray(n?.data?.inputs) ? n.data.inputs : [];
        return ins.some((p: any) => p && (p.id === 'query_text' || p.id === 'query'));
      }
      return false;
    });
    return allowAll ? ['run', 'session', 'global', 'all'] : ['run', 'session', 'global'];
  }, [nodes]);

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

  const formInputPins = useMemo(() => {
    return inputPins.filter((p) => p.id !== 'workspace_root');
  }, [inputPins]);

  // Form state for each input pin
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [toolsValues, setToolsValues] = useState<Record<string, string[]>>({});
  const [workspaceRandom, setWorkspaceRandom] = useState(true);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [manualWorkspaceRoot, setManualWorkspaceRoot] = useState('');
  const [workspaceAccessMode, setWorkspaceAccessMode] = useState<'workspace_only' | 'all_except_ignored'>('workspace_only');
  const [workspaceIgnoredPathsText, setWorkspaceIgnoredPathsText] = useState('');
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [rawJsonOpen, setRawJsonOpen] = useState(true);
  // Nested subflow observability: folded by default; per-step expansion keyed by the
  // parent step id (stable across this modal's event stream).
  const [expandedSubflows, setExpandedSubflows] = useState<Record<string, boolean>>({});
  const [resumeDraft, setResumeDraft] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [rehydrateArtifactMarkdown, setRehydrateArtifactMarkdown] = useState<string | null>(null);
  const [rehydrateArtifactError, setRehydrateArtifactError] = useState<string | null>(null);
  const [rehydrateArtifactLoading, setRehydrateArtifactLoading] = useState(false);

  const providerPinId = useMemo(() => {
    const pin = formInputPins.find((p) => p.type === 'provider' || p.id === 'provider');
    return pin?.id || null;
  }, [formInputPins]);

  const selectedProvider = useMemo(() => {
    return providerPinId ? (formValues[providerPinId] || '') : '';
  }, [formValues, providerPinId]);

  const wantProviderDropdown = Boolean(isOpen && formInputPins.some((p) => p.type === 'provider' || p.id === 'provider'));
  const wantModelDropdown = Boolean(isOpen && formInputPins.some((p) => p.type === 'model' || p.id === 'model'));
  const providersQuery = useProviders(wantProviderDropdown);
  const modelsQuery = useModels(selectedProvider || undefined, wantModelDropdown);
  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];

  const wantToolsDropdown = Boolean(isOpen && formInputPins.some((p) => p.type === 'tools'));
  const toolsQuery = useTools(wantToolsDropdown);
  const toolSpecs = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];
  const toolOptions = useMemo(() => {
    const out = toolSpecs
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({ value: t.name.trim(), label: t.name.trim() }));
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [toolSpecs]);

  const executionWorkspaceQuery = useExecutionWorkspace(isOpen);
  const defaultRandomRoot =
    executionWorkspaceQuery.data && typeof executionWorkspaceQuery.data.default_random_root === 'string'
      ? executionWorkspaceQuery.data.default_random_root
      : '';
  const createRandomWorkspaceRoot = useCallback(() => {
    const base = String(defaultRandomRoot || '').trim();
    if (!base) return '';
    return joinPath(base, randomUuidHex());
  }, [defaultRandomRoot]);

  // When the modal is opened, start expanded (predictable UX).
  useEffect(() => {
    if (isOpen) setIsMinimized(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!workspaceRandom) return;
    if (workspaceRoot.trim()) return;
    const next = createRandomWorkspaceRoot();
    if (next) setWorkspaceRoot(next);
  }, [createRandomWorkspaceRoot, isOpen, workspaceRandom, workspaceRoot]);

  // Initialize form values when modal opens
  useEffect(() => {
    if (isOpen && formInputPins.length > 0) {
      const initialValues: Record<string, string> = {};
      const initialTools: Record<string, string[]> = {};
      const defaults =
        entryNode && entryNode.data && typeof (entryNode.data as any).pinDefaults === 'object'
          ? ((entryNode.data as any).pinDefaults as Record<string, unknown>)
          : null;
      formInputPins.forEach(pin => {
        if (pin.type === 'tools') {
          const raw = defaults && pin.id in defaults ? defaults[pin.id] : undefined;
          if (Array.isArray(raw)) {
            initialTools[pin.id] = raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
          } else if (typeof raw === 'string' && raw.trim()) {
            // Convenience: allow comma-separated lists.
            initialTools[pin.id] = raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
          } else {
            initialTools[pin.id] = [];
          }
          // Tools are driven by toolsValues, not formValues.
          return;
        }
        const raw = defaults && pin.id in defaults ? defaults[pin.id] : undefined;
        if (raw === undefined) {
          initialValues[pin.id] = '';
          return;
        }
        if (typeof raw === 'boolean') {
          initialValues[pin.id] = raw ? 'true' : 'false';
          return;
        }
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          initialValues[pin.id] = String(raw);
          return;
        }
        // Strings (provider/model/workspace_root/etc.)
        if (typeof raw === 'string') {
          initialValues[pin.id] = raw;
          return;
        }
        // Objects/arrays/assertions (render as JSON in textarea pins).
        if (pin.type === 'object' || pin.type === 'array' || pin.type === 'assertion' || pin.type === 'assertions') {
          try {
            initialValues[pin.id] = JSON.stringify(raw, null, 2);
            return;
          } catch {
            initialValues[pin.id] = '';
            return;
          }
        }
        // Fallback: preserve existing behavior (empty).
        initialValues[pin.id] = '';
      });
      setFormValues(initialValues);
      setToolsValues(initialTools);
    }
  }, [isOpen, formInputPins, entryNode]);

  // Clear resume draft when leaving waiting state
  useEffect(() => {
    if (!isWaiting) setResumeDraft('');
  }, [isWaiting]);

  // Update a form field
  const handleFieldChange = useCallback((pinId: string, value: string) => {
    setFormValues(prev => ({ ...prev, [pinId]: value }));
  }, []);

  const handleWorkspaceRootChange = useCallback(
    (next: string) => {
      setWorkspaceRoot(next);
      if (!workspaceRandom) setManualWorkspaceRoot(next);
    },
    [workspaceRandom]
  );

  const handleWorkspaceRandomChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setWorkspaceRandom(true);
        const next = createRandomWorkspaceRoot();
        if (next) setWorkspaceRoot(next);
        return;
      }
      setWorkspaceRandom(false);
      if (manualWorkspaceRoot.trim()) setWorkspaceRoot(manualWorkspaceRoot);
    },
    [createRandomWorkspaceRoot, manualWorkspaceRoot]
  );

  // Submit the form
  const handleSubmit = useCallback(() => {
    // Build input data from form values
    const inputData: Record<string, unknown> = {};

    formInputPins.forEach(pin => {
      if (pin.type === 'tools') {
        inputData[pin.id] = Array.isArray(toolsValues[pin.id]) ? toolsValues[pin.id] : [];
        return;
      }
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
        case 'assertion':
        case 'assertions':
          try {
            const defaultJson =
              pin.type === 'array' || pin.type === 'assertions'
                ? '[]'
                : '{}';
            inputData[pin.id] = JSON.parse(value || defaultJson);
          } catch {
            inputData[pin.id] = pin.type === 'array' || pin.type === 'assertions' ? [] : {};
          }
          break;
        default:
          inputData[pin.id] = value;
      }
    });

    const workspaceValue = String(workspaceRoot || '').trim();
    if (workspaceValue) {
      inputData.workspace_root = workspaceValue;
    }
    inputData.workspace_access_mode = workspaceAccessMode;
    const ignored = String(workspaceIgnoredPathsText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ignored.length > 0) {
      inputData.workspace_ignored_paths = ignored;
    }

    onRun(inputData);
  }, [formInputPins, formValues, onRun, toolsValues, workspaceAccessMode, workspaceIgnoredPathsText, workspaceRoot]);

  type StepStatus = 'running' | 'completed' | 'waiting' | 'failed';
  type Step = {
    id: string;
    status: StepStatus;
    runId?: string;
    nodeId?: string;
    nodeLabel?: string;
    nodeType?: string;
    nodeIcon?: string;
    nodeColor?: string;
    provider?: string;
    model?: string;
    summary?: string;
    output?: unknown;
    error?: string;
    metrics?: ExecutionMetrics;
    startedAt?: string;
    endedAt?: string;
    waiting?: {
      prompt: string;
      choices: string[];
      allowFreeText: boolean;
      waitKey?: string;
      reason?: string;
    };
  };

  const formatStepTime = useCallback((ts?: string) => {
    const raw = typeof ts === 'string' ? ts.trim() : '';
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    // Discreet, local time with seconds.
    // Prefer a compact HH:MM:SS (avoid locale AM/PM width churn).
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }, []);

  const formatDuration = (rawMs: unknown): string => {
    const ms = typeof rawMs === 'number' ? rawMs : rawMs == null ? NaN : Number(rawMs);
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 950) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(0)}s`;
  };

  const formatTokenBadge = (m?: ExecutionMetrics | null): string => {
    if (!m) return '';
    const input = typeof m.input_tokens === 'number' ? m.input_tokens : null;
    const output = typeof m.output_tokens === 'number' ? m.output_tokens : null;
    if (input == null && output == null) return '';
    if (input != null && output != null) return `${input}→${output} tk`;
    if (input != null) return `${input} in`;
    return `${output} out`;
  };

  const formatTpsBadge = (m?: ExecutionMetrics | null): string => {
    if (!m) return '';
    const tps = typeof m.tokens_per_s === 'number' ? m.tokens_per_s : null;
    if (tps == null || !Number.isFinite(tps) || tps <= 0) return '';
    return `${tps.toFixed(tps < 10 ? 2 : 1)} tk/s`;
  };

  type UsageBadge = { label: string; value: number };

  const getUsageBadges = (usage: unknown): UsageBadge[] => {
    if (!usage || typeof usage !== 'object') return [];
    const u = usage as Record<string, unknown>;
    const num = (key: string): number | null => {
      const v = u[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    const inputTokens = num('input_tokens');
    const outputTokens = num('output_tokens');
    const promptTokens = num('prompt_tokens');
    const completionTokens = num('completion_tokens');
    const totalTokens = num('total_tokens');

    const inVal = inputTokens ?? promptTokens;
    const outVal = outputTokens ?? completionTokens;

    const badges: UsageBadge[] = [];
    if (inVal != null) badges.push({ label: 'in', value: inVal });
    if (outVal != null) badges.push({ label: 'out', value: outVal });
    if (totalTokens != null) badges.push({ label: 'total', value: totalTokens });

    // Only show prompt/completion if they differ from the chosen in/out values.
    if (promptTokens != null && inVal != null && promptTokens !== inVal) badges.push({ label: 'prompt', value: promptTokens });
    if (completionTokens != null && outVal != null && completionTokens !== outVal)
      badges.push({ label: 'completion', value: completionTokens });

    const cached = num('cache_read_tokens') ?? num('cached_tokens');
    if (cached != null && cached > 0) badges.push({ label: 'cached', value: cached });

    return badges;
  };

  const runSteps = useMemo(() => {
    const openByNode = new Map<string, number>();
    const all: Step[] = [];

    const rootRunId = (() => {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === 'flow_start' && ev.runId) return ev.runId;
      }
      return null;
    })();

    const safeString = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

    const extractSubRunId = (value: unknown): string | null => {
      if (!value || typeof value !== 'object') return null;
      const obj = value as Record<string, unknown>;
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

      // Common shapes:
      // - { sub_run_id: "..." }
      // - { result: { sub_run_id: "..." } }
      // - { scratchpad: { sub_run_id: "..." } }
      // - { scratchpad: { sub_run_id: "..." }, result: {...} } (Agent node output)
      const direct =
        pick(obj['sub_run_id']) ?? pick(obj['sub_runId']) ?? pick(obj['subRunId']);
      if (direct) return direct;

      const nestedResult = obj['result'];
      if (nestedResult && typeof nestedResult === 'object') {
        const r = nestedResult as Record<string, unknown>;
        const fromResult = pick(r['sub_run_id']) ?? pick(r['sub_runId']) ?? pick(r['subRunId']);
        if (fromResult) return fromResult;
      }

      const scratchpad = obj['scratchpad'];
      if (scratchpad && typeof scratchpad === 'object') {
        const sp = scratchpad as Record<string, unknown>;
        const fromScratch = pick(sp['sub_run_id']) ?? pick(sp['sub_runId']) ?? pick(sp['subRunId']);
        if (fromScratch) return fromScratch;
      }

      return null;
    };

    const mergeMetricsPreferLonger = (
      prior?: ExecutionMetrics | null,
      next?: ExecutionMetrics | null
    ): ExecutionMetrics | undefined => {
      if (!prior) return next ?? undefined;
      if (!next) return prior ?? undefined;

      const num = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

      const priorDur = num(prior.duration_ms);
      const nextDur = num(next.duration_ms);
      const preferNext = nextDur != null && (priorDur == null || nextDur > priorDur);
      const primary = preferNext ? next : prior;
      const secondary = preferNext ? prior : next;

      const merged: ExecutionMetrics = {
        duration_ms: num(primary.duration_ms) ?? num(secondary.duration_ms) ?? undefined,
        input_tokens:
          typeof primary.input_tokens === 'number'
            ? primary.input_tokens
            : typeof secondary.input_tokens === 'number'
              ? secondary.input_tokens
              : undefined,
        output_tokens:
          typeof primary.output_tokens === 'number'
            ? primary.output_tokens
            : typeof secondary.output_tokens === 'number'
              ? secondary.output_tokens
              : undefined,
        tokens_per_s:
          typeof primary.tokens_per_s === 'number'
            ? primary.tokens_per_s
            : typeof secondary.tokens_per_s === 'number'
              ? secondary.tokens_per_s
              : undefined,
      };

      // Avoid returning an object with all fields undefined.
      if (
        merged.duration_ms == null &&
        merged.input_tokens == null &&
        merged.output_tokens == null &&
        merged.tokens_per_s == null
      ) {
        return undefined;
      }
      return merged;
    };

    const extractModelInfo = (value: unknown): { provider?: string; model?: string } => {
      if (!value || typeof value !== 'object') return {};
      const obj = value as Record<string, unknown>;
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

      // Common shapes:
      // - llm_call: { response: "...", raw: { provider, model, usage, ... } }
      // - agent: { result: { provider, model, ... }, scratchpad: ... }
      let provider = pick(obj.provider);
      let model = pick(obj.model);

      const raw = obj.raw;
      if ((!provider || !model) && raw && typeof raw === 'object') {
        const r = raw as Record<string, unknown>;
        provider = provider ?? pick(r.provider);
        model = model ?? pick(r.model);
      }

      const nested = obj.result;
      if ((!provider || !model) && nested && typeof nested === 'object') {
        const n = nested as Record<string, unknown>;
        provider = provider ?? pick(n.provider);
        model = model ?? pick(n.model);
      }

      // Agent nodes may not expose provider/model directly; try to infer from the last llm_call
      // step inside the scratchpad trace.
      const scratchpad = obj.scratchpad;
      if ((!provider || !model) && scratchpad && typeof scratchpad === 'object') {
        const sp = scratchpad as Record<string, unknown>;
        const steps = Array.isArray(sp.steps) ? sp.steps : [];
        for (let i = steps.length - 1; i >= 0; i--) {
          const st = steps[i];
          if (!st || typeof st !== 'object') continue;
          const stepObj = st as Record<string, unknown>;
          const effect = stepObj.effect && typeof stepObj.effect === 'object' ? (stepObj.effect as Record<string, unknown>) : null;
          const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
          if (effectType !== 'llm_call') continue;

          const payload =
            effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
          provider = provider ?? pick(payload?.provider);
          model = model ?? pick(payload?.model);

          const result = stepObj.result && typeof stepObj.result === 'object' ? (stepObj.result as Record<string, unknown>) : null;
          provider = provider ?? pick(result?.provider);
          model = model ?? pick(result?.model);

          if (provider || model) break;
        }
      }

      return { provider, model };
    };

    const pickSummary = (value: unknown): string => {
      if (value == null) return '';
      if (typeof value === 'string') return value;
      if (typeof value !== 'object') return String(value);

      const obj = value as Record<string, unknown>;
      const direct =
        (typeof obj.message === 'string' && obj.message) ||
        (typeof obj.response === 'string' && obj.response) ||
        '';
      if (direct) return direct;

      const nested = obj.result;
      if (nested && typeof nested === 'object') {
        const nestedObj = nested as Record<string, unknown>;
        if (typeof nestedObj.result === 'string' && nestedObj.result) return nestedObj.result;
        if (typeof nestedObj.message === 'string' && nestedObj.message) return nestedObj.message;
        if (typeof nestedObj.response === 'string' && nestedObj.response) return nestedObj.response;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const summarize = (value: unknown): string => {
      const text = safeString(pickSummary(value)).replace(/\s+/g, ' ').trim();
      return text;
    };

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
      // We show only node steps in the left timeline; flow-level status is surfaced in the header / final result.
      if (ev.type === 'flow_start' || ev.type === 'flow_complete') continue;

      if (ev.type === 'node_start') {
        const key = `${ev.runId || ''}:${ev.nodeId || ''}`;
        const meta = nodeMeta(ev.nodeId);
        const step: Step = {
          id: `node_start:${ev.nodeId || 'unknown'}:${i}`,
          status: 'running',
          runId: ev.runId,
          nodeId: ev.nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          startedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
        };
        all.push(step);
        if (ev.nodeId) openByNode.set(key, all.length - 1);
        continue;
      }

      if (ev.type === 'node_complete') {
        const nodeId = ev.nodeId;
        const key = `${ev.runId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;
        const mi = extractModelInfo(ev.result);
        if (typeof idx === 'number') {
          all[idx] = {
            ...all[idx],
            status: 'completed',
            output: ev.result,
            summary: summarize(ev.result),
            metrics: ev.meta,
            provider: mi.provider,
            model: mi.model,
            endedAt: typeof ev.ts === 'string' ? ev.ts : all[idx].endedAt,
          };
          openByNode.delete(key);
          continue;
        }

        // Dedupe: some runs can emit a duplicate `node_complete` for an Agent node
        // (same node + same sub_run_id) due to start_subworkflow/wait/resume edge cases.
        // Prefer to merge into the most recent completed step rather than rendering two.
        const meta = nodeMeta(nodeId);
        if (meta?.type === 'agent' && nodeId && typeof ev.runId === 'string' && ev.runId.trim()) {
          const subRunId = extractSubRunId(ev.result);
          if (subRunId) {
            const rid = ev.runId.trim();
            let deduped = false;
            for (let j = all.length - 1; j >= 0; j--) {
              const prior = all[j];
              if (prior.status !== 'completed') continue;
              if (prior.runId !== rid) continue;
              if (prior.nodeId !== nodeId) continue;
              const priorSub = extractSubRunId(prior.output);
              if (!priorSub || priorSub !== subRunId) continue;

              all[j] = {
                ...prior,
                output: ev.result ?? prior.output,
                summary: summarize(ev.result ?? prior.output),
                metrics: mergeMetricsPreferLonger(prior.metrics ?? null, ev.meta ?? null),
                provider: mi.provider ?? prior.provider,
                model: mi.model ?? prior.model,
                endedAt: typeof ev.ts === 'string' ? ev.ts : prior.endedAt,
              };
              // Do not append a duplicate step.
              deduped = true;
              break;
            }
            if (deduped) continue;
          }
        }

        all.push({
          id: `node_complete:${nodeId || 'unknown'}:${i}`,
          status: 'completed',
          runId: ev.runId,
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          provider: mi.provider,
          model: mi.model,
          output: ev.result,
          summary: summarize(ev.result),
          metrics: ev.meta,
          startedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
          endedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
        });
        continue;
      }

      if (ev.type === 'flow_waiting') {
        const nodeId = ev.nodeId;
        const key = `${ev.runId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;

        const waiting = {
          prompt: ev.prompt || 'Please respond:',
          choices: Array.isArray(ev.choices) ? ev.choices : [],
          allowFreeText: ev.allow_free_text !== false,
          waitKey: ev.wait_key,
          reason: ev.reason,
        };

        if (typeof idx === 'number') {
          all[idx] = { ...all[idx], status: 'waiting', waiting };
          continue;
        }

        const meta = nodeMeta(nodeId);
        all.push({
          id: `flow_waiting:${nodeId || 'unknown'}:${i}`,
          status: 'waiting',
          runId: ev.runId,
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          waiting,
        });
        if (nodeId) openByNode.set(key, all.length - 1);
        continue;
      }

      if (ev.type === 'flow_error') {
        const nodeId = ev.nodeId;
        const key = `${ev.runId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;
        if (typeof idx === 'number') {
          all[idx] = { ...all[idx], status: 'failed', error: ev.error || 'Unknown error' };
          openByNode.delete(key);
          continue;
        }
        // Best-effort: attach to the most recent step if we can't map to a node.
        if (all.length > 0) {
          const lastIdx = all.length - 1;
          all[lastIdx] = { ...all[lastIdx], status: 'failed', error: ev.error || 'Unknown error' };
        }
      }
    }

    const stepById = new Map<string, Step>();
    const stepsByRunId = new Map<string, Step[]>();
    for (const s of all) {
      stepById.set(s.id, s);
      const rid = typeof s.runId === 'string' ? s.runId.trim() : '';
      if (!rid) continue;
      const bucket = stepsByRunId.get(rid);
      if (bucket) bucket.push(s);
      else stepsByRunId.set(rid, [s]);
    }

    const rootSteps =
      rootRunId && stepsByRunId.get(rootRunId) ? (stepsByRunId.get(rootRunId) as Step[]) : [];

    return { rootRunId, rootSteps, stepById, stepsByRunId };
  }, [events, nodeById]);
  const rootRunId = runSteps.rootRunId;
  const steps = runSteps.rootSteps;
  const stepById = runSteps.stepById;
  const stepsByRunId = runSteps.stepsByRunId;

  // Map (parentRunId:nodeId) -> sub_run_id for subworkflow waits, so the UI can show
  // child run steps even before the parent subflow node completes.
  const subworkflowLinks = useMemo(() => {
    const out = new Map<string, string>();
    for (const ev of events) {
      if (ev.type !== 'subworkflow_update') continue;
      const parentRunId = typeof ev.runId === 'string' ? ev.runId.trim() : '';
      const parentNodeId = typeof ev.nodeId === 'string' ? ev.nodeId.trim() : '';
      const childRunId = typeof ev.sub_run_id === 'string' ? ev.sub_run_id.trim() : '';
      if (!parentRunId || !parentNodeId || !childRunId) continue;
      out.set(`${parentRunId}:${parentNodeId}`, childRunId);
    }
    return out;
  }, [events]);

  // New run => collapse all nested subflow sections (predictable UX).
  useEffect(() => {
    if (!isOpen) return;
    setExpandedSubflows({});
  }, [isOpen, rootRunId]);

  const flowSummary = useMemo<ExecutionMetrics | null>(() => {
    if (!events || events.length === 0) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === 'flow_complete' && ev.meta) return ev.meta;
    }
    return null;
  }, [events]);

  const benchmarkProgress = useMemo(() => {
    const isBenchmark = flowId === 'be0a6c01' || flowName === 'benchmark-agentic';
    if (!isBenchmark) return null;

    const asRecord = (v: unknown): Record<string, unknown> | null => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return v as Record<string, unknown>;
    };

    const isBenchmarkRecord = (v: unknown): v is Record<string, unknown> => {
      const rec = asRecord(v);
      if (!rec) return false;
      const mode = typeof rec.mode === 'string' ? rec.mode.trim() : '';
      const promptId = typeof rec.prompt_id === 'string' ? rec.prompt_id.trim() : '';
      if (!mode || !promptId) return false;
      return 'metrics' in rec || 'correct' in rec || 'signature' in rec;
    };

    const parseArray = (pinId: string): unknown[] => {
      const raw = typeof formValues[pinId] === 'string' ? formValues[pinId] : '';
      const parsed = raw.trim() ? parseJson<unknown>(raw) : ({ ok: true, value: [] } as const);
      return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
    };

    const parseClampedInt = (pinId: string, fallback: number, min: number, max: number): number => {
      const raw = typeof formValues[pinId] === 'string' ? formValues[pinId] : '';
      const n = Number.parseInt(raw.trim(), 10);
      const out = Number.isFinite(n) ? n : fallback;
      return Math.max(min, Math.min(max, out));
    };

    const runsPinId = inputPins.find((p) => p.id === 'runs')?.id ?? 'runs';
    const promptsPinId = inputPins.find((p) => p.id === 'prompts')?.id ?? 'prompts';
    const repeatsPinId = inputPins.find((p) => p.id === 'repeats')?.id ?? 'repeats';

    const runsRaw = parseArray(runsPinId);
    const runsCount = runsRaw.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).length || 1;

    const promptsRaw = parseArray(promptsPinId);
    const prompts = promptsRaw.filter((p) => p && typeof p === 'object' && !Array.isArray(p)) as Array<Record<string, unknown>>;
    const promptsCount = prompts.length || 0;

    // Mirror `Build repeats_array` behavior (clamped to 1..20).
    const repeatsCount = parseClampedInt(repeatsPinId, 3, 1, 20);

    const totalRecords = runsCount * promptsCount * repeatsCount * 2;

    const findLoopNodeId = (needle: RegExp): string | null => {
      const n = nodes.find((n) => n.data?.nodeType === 'loop' && needle.test(String(n.data?.label || '')));
      return n?.id || null;
    };

    const runsLoopId = findLoopNodeId(/runs/i);
    const promptsLoopId = findLoopNodeId(/prompts/i);
    const repeatsLoopId = findLoopNodeId(/repeats/i);

    const runsLoop = runsLoopId ? loopProgressByNodeId[runsLoopId] : null;
    const promptsLoop = promptsLoopId ? loopProgressByNodeId[promptsLoopId] : null;
    const repeatsLoop = repeatsLoopId ? loopProgressByNodeId[repeatsLoopId] : null;

    const promptIndex = promptsLoop && typeof promptsLoop.index === 'number' ? promptsLoop.index : null;
    const promptObj = promptIndex != null && promptIndex >= 0 && promptIndex < prompts.length ? prompts[promptIndex] : null;
    const promptId = typeof promptObj?.id === 'string' ? promptObj.id : null;
    const promptLabel = typeof promptObj?.label === 'string' ? promptObj.label : null;

    let completedRecords = 0;
    if (rootRunId) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type !== 'node_complete') continue;
        if (ev.runId && ev.runId !== rootRunId) continue;

        const r = ev.result as unknown;
        const obj = asRecord(r);

        const candidate =
          (obj && Array.isArray(obj.value) ? obj.value : null) ||
          (obj && Array.isArray(obj.run_results) ? obj.run_results : null) ||
          (Array.isArray(r) ? r : null);

        if (!candidate || !Array.isArray(candidate)) continue;
        if (!candidate.some(isBenchmarkRecord)) continue;
        completedRecords = candidate.length;
        break;
      }
    }

    const findSubflowNodeId = (needle: RegExp): string | null => {
      const n = nodes.find((n) => n.data?.nodeType === 'subflow' && needle.test(String(n.data?.label || '')));
      return n?.id || null;
    };

    const reactSubflowId = findSubflowNodeId(/react\s*run/i);
    const codeactSubflowId = findSubflowNodeId(/codeact\s*run/i);

    const durations: number[] = [];
    if (rootRunId && (reactSubflowId || codeactSubflowId)) {
      for (const ev of events) {
        if (ev.type !== 'node_complete') continue;
        if (ev.runId && ev.runId !== rootRunId) continue;
        if (!ev.nodeId) continue;
        if (ev.nodeId !== reactSubflowId && ev.nodeId !== codeactSubflowId) continue;
        const ms = ev.meta && typeof ev.meta.duration_ms === 'number' ? ev.meta.duration_ms : null;
        if (ms != null && Number.isFinite(ms) && ms > 0) durations.push(ms);
      }
    }

    const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const remaining = totalRecords > 0 ? Math.max(0, totalRecords - completedRecords) : 0;
    const etaMs = avgMs != null && remaining > 0 ? avgMs * remaining : null;

    return {
      totalRecords,
      completedRecords,
      runsLoop,
      promptsLoop,
      repeatsLoop,
      promptId,
      promptLabel,
      etaMs,
    };
  }, [events, flowId, flowName, formValues, inputPins, loopProgressByNodeId, nodes, rootRunId]);

  const toggleSubflowExpansion = useCallback((stepId: string) => {
    const id = String(stepId || '').trim();
    if (!id) return;
    setExpandedSubflows((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  type StepTreeNode = { stepId: string; depth: number; children: StepTreeNode[]; childRunId?: string };
  const MAX_STEP_TREE_DEPTH = 3;

  const stepTree = useMemo<StepTreeNode[]>(() => {
    const rid0 = typeof rootRunId === 'string' ? rootRunId.trim() : '';
    if (!rid0) return [];

    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const childRunIdFromOutput = (out: unknown): string | null => {
      if (!out || typeof out !== 'object') return null;
      const o = out as Record<string, unknown>;
      const sr = pick(o.sub_run_id);
      if (!sr) return null;
      // Heuristic: only treat this as a subworkflow-like output when it looks like the
      // visual START_SUBWORKFLOW mapping (compiler populates child_output/output fields).
      if (!('child_output' in o) && !('output' in o)) return null;
      return sr;
    };

	    const childRunIdFromStep = (s: Step): string | null => {
	      // Agent nodes have their own dedicated live trace panel; expanding the internal
	      // ReAct sub-run nodes (init/reason/act/...) in the execution list is noisy and
	      // not actionable (they are not VisualFlow nodes and typically have no details).
	      if (s.nodeType === 'agent') return null;
	      const fromOutput = childRunIdFromOutput(s.output);
	      if (fromOutput) return fromOutput;
	      const parentRunId = pick(s.runId);
	      const parentNodeId = pick(s.nodeId);
      if (!parentRunId || !parentNodeId) return null;
      return subworkflowLinks.get(`${parentRunId}:${parentNodeId}`) || null;
    };

    const seen = new Set<string>();
    const buildForRun = (rid: string, depth: number): StepTreeNode[] => {
      const rid2 = String(rid || '').trim();
      if (!rid2) return [];
      if (seen.has(rid2)) return [];
      seen.add(rid2);

      const bucket = stepsByRunId.get(rid2);
      if (!bucket || bucket.length === 0) return [];

      const nodes: StepTreeNode[] = [];
      for (const s of bucket) {
        const childRunId = childRunIdFromStep(s);
        const children =
          depth < MAX_STEP_TREE_DEPTH &&
          childRunId &&
          stepsByRunId.get(childRunId) &&
          (stepsByRunId.get(childRunId) as Step[]).length > 0
            ? buildForRun(childRunId, depth + 1)
            : [];
        nodes.push({ stepId: s.id, depth, children, childRunId: childRunId || undefined });
      }
      return nodes;
    };

    return buildForRun(rid0, 0);
  }, [rootRunId, stepsByRunId, subworkflowLinks]);

  // Auto-expand running subflows so long-running nested runs are observable by default.
  // If the user explicitly collapses (sets false), do not override.
  useEffect(() => {
    if (!isOpen) return;
    if (stepTree.length === 0) return;
    setExpandedSubflows((prev) => {
      let changed = false;
      const next: Record<string, boolean> = { ...prev };

      const visit = (nodes: StepTreeNode[]) => {
        for (const n of nodes) {
          if (!n.children || n.children.length === 0) continue;
          // Keep the execution list readable: only auto-expand direct subflows (depth 0).
          if (n.depth > 0) continue;
          const s = stepById.get(n.stepId);
          if (!s) continue;

          const isRunningish = s.status === 'running' || s.status === 'waiting';
          if (isRunningish && !(n.stepId in prev)) {
            next[n.stepId] = true;
            changed = true;
          }
        }
      };
      visit(stepTree);

      return changed ? next : prev;
    });
  }, [isOpen, stepById, stepTree]);

  // Keep selection valid; default to last step.
  useEffect(() => {
    if (!isOpen) return;
    if (steps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && stepById.has(selectedStepId)) return;
    setSelectedStepId(steps[steps.length - 1].id);
  }, [isOpen, steps, selectedStepId, stepById]);

  // Follow the live execution: when new steps arrive during a run (or waiting),
  // auto-select the latest step so the user always sees what's happening.
  useEffect(() => {
    if (!isOpen) return;
    if (!(isRunning || isWaiting)) return;
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    if (!last) return;
    setSelectedStepId(last.id);
  }, [isOpen, isRunning, isWaiting, steps]);

  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    return stepById.get(selectedStepId) || null;
  }, [selectedStepId, stepById]);

  // Keep the per-step Raw JSON section predictably unfolded when switching steps.
  useEffect(() => {
    if (!isOpen) return;
    if (!selectedStepId) return;
    setRawJsonOpen(true);
  }, [isOpen, selectedStepId]);

  const parentRunId = useMemo(() => {
    const raw = runSummary?.parent_run_id;
    const pid = typeof raw === 'string' ? raw.trim() : '';
    return pid || null;
  }, [runSummary?.parent_run_id]);

  const selectedAgentSubRunId = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    const out = selectedStep.output;
    if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>;
      const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const direct = pick(o.sub_run_id);
      if (direct) return direct;
      const scratchpad = o.scratchpad;
      if (scratchpad && typeof scratchpad === 'object') {
        const sp = scratchpad as Record<string, unknown>;
        const sr = pick(sp.sub_run_id);
        if (sr) return sr;
      }
      const resultObj = o.result;
      if (resultObj && typeof resultObj === 'object') {
        const ro = resultObj as Record<string, unknown>;
        const sr = pick(ro.sub_run_id);
        if (sr) return sr;
      }
    }
    // Running agents don't have final output yet. Best-effort: use the latest sub-run trace_update runId.
    for (let i = traceEvents.length - 1; i >= 0; i--) {
      const ev = traceEvents[i];
      if (ev.type !== 'trace_update') continue;
      if (typeof ev.runId === 'string' && ev.runId.trim() && ev.runId !== rootRunId) return ev.runId.trim();
    }
    return null;
  }, [selectedStep, traceEvents, rootRunId]);

  const selectedSubflowRunId = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'subflow') return null;
    const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const out = selectedStep.output;
    if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>;
      const direct = pick(o.sub_run_id);
      if (direct) return direct;
      const childOut = o.child_output;
      if (childOut && typeof childOut === 'object') {
        const co = childOut as Record<string, unknown>;
        const sr = pick(co.sub_run_id);
        if (sr) return sr;
      }
    }

    const parentRunId = pick(selectedStep.runId);
    const parentNodeId = pick(selectedStep.nodeId);
    if (!parentRunId || !parentNodeId) return null;
    return subworkflowLinks.get(`${parentRunId}:${parentNodeId}`) || null;
  }, [selectedStep, subworkflowLinks]);

  const hasRunData = isRunning || result != null || events.length > 0;

  const showFinalResult = useMemo(() => {
    if (!result || isRunning) return false;
    if (steps.length === 0) return true;
    const last = steps[steps.length - 1];
    return Boolean(last && selectedStepId === last.id);
  }, [isRunning, result, selectedStepId, steps]);

  const runStatusLabel = useMemo(() => {
    if (isRunning) return 'RUNNING';
    if (isWaiting) return 'WAITING';
    if (result) return result.success ? 'SUCCESS' : 'FAILED';
    return '';
  }, [isRunning, isWaiting, result]);

  // Minimized view (run minibar): show current step + status and keep the canvas visible.
  // This uses only local state (isMinimized) so it never affects run execution itself.
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const currentStepLabel = (lastStep?.nodeLabel || lastStep?.nodeId || 'Starting…') as string;
  const currentStepStatus = runStatusLabel || (lastStep?.status ? String(lastStep.status).toUpperCase() : 'READY');

  const minibarAgentMeta = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'agent') return null;
    if (!selectedAgentSubRunId) return null;

    // Find the latest trace step for this Agent execution instance.
    let lastTraceStep: Record<string, unknown> | null = null;
    for (let i = traceEvents.length - 1; i >= 0; i--) {
      const ev = traceEvents[i];
      if (ev.type !== 'trace_update') continue;
      if (!ev.runId || ev.runId !== selectedAgentSubRunId) continue;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      for (let j = steps.length - 1; j >= 0; j--) {
        const st = steps[j];
        if (st && typeof st === 'object') {
          lastTraceStep = st as Record<string, unknown>;
          break;
        }
      }
      if (lastTraceStep) break;
    }
    if (!lastTraceStep) return null;

    const effect = lastTraceStep.effect && typeof lastTraceStep.effect === 'object' ? (lastTraceStep.effect as Record<string, unknown>) : null;
    const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
    const effectLabel = effectType ? effectType.toUpperCase() : 'EFFECT';

    // Token badges (LLM_CALL)
    const res = lastTraceStep.result && typeof lastTraceStep.result === 'object' ? (lastTraceStep.result as Record<string, unknown>) : null;
    const raw = res && res.raw && typeof res.raw === 'object' ? (res.raw as Record<string, unknown>) : null;
    const usage =
      (res && res.usage && typeof res.usage === 'object' ? (res.usage as Record<string, unknown>) : null) ||
      (raw && raw.usage && typeof raw.usage === 'object' ? (raw.usage as Record<string, unknown>) : null) ||
      (raw && raw.usage_metadata && typeof raw.usage_metadata === 'object' ? (raw.usage_metadata as Record<string, unknown>) : null) ||
      null;

    const toNum = (v: unknown): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };

    const inTokens = toNum(usage?.input_tokens) ?? toNum(usage?.prompt_tokens) ?? toNum(res?.input_tokens) ?? toNum(res?.prompt_tokens);
    const outTokens = toNum(usage?.output_tokens) ?? toNum(usage?.completion_tokens) ?? toNum(res?.output_tokens) ?? toNum(res?.completion_tokens);
    const totalTokens = toNum(usage?.total_tokens) ?? toNum(res?.total_tokens);

    const tokenBadges: Array<{ label: string; value: number }> = [];
    if (inTokens != null) tokenBadges.push({ label: 'in', value: inTokens });
    if (outTokens != null) tokenBadges.push({ label: 'out', value: outTokens });
    if (totalTokens != null) tokenBadges.push({ label: 'total', value: totalTokens });

    // Tool badges (TOOL_CALLS)
    const payload = effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
    const toolCalls =
      (payload && Array.isArray(payload.tool_calls) ? payload.tool_calls : null) ||
      (payload && Array.isArray(payload.tool_calls_raw) ? payload.tool_calls_raw : null) ||
      (payload && Array.isArray(payload.calls) ? payload.calls : null) ||
      null;
    const toolNames: string[] = [];
    if (toolCalls) {
      for (const c of toolCalls) {
        if (!c || typeof c !== 'object') continue;
        const name = typeof (c as any).name === 'string' ? String((c as any).name).trim() : '';
        if (name) toolNames.push(name);
      }
    }
    const uniqueToolNames = Array.from(new Set(toolNames));

    return { effectLabel, tokenBadges, toolNames: uniqueToolNames };
  }, [selectedStep, selectedAgentSubRunId, traceEvents]);

  const minibar = (
    <div className="run-minibar" role="region" aria-label="Run Flow mini bar">
      <button type="button" className="run-minibar-main" onClick={() => setIsMinimized(false)}>
        <span className="run-minibar-title">Run</span>
        <span
          className={[
            'run-minibar-status',
            isRunning ? 'running' : '',
            isPaused ? 'paused' : '',
            isWaiting ? 'waiting' : '',
            result ? (result.success ? 'success' : 'failed') : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {currentStepStatus}
        </span>
        <span className="run-minibar-step" title={currentStepLabel}>
          {currentStepLabel}
        </span>
          {lastLoopProgress ? (
            <span className="run-minibar-loop" title={`Loop progress (${lastLoopProgress.nodeId})`}>
              {Math.min(lastLoopProgress.index + 1, lastLoopProgress.total)}/{lastLoopProgress.total}
            </span>
          ) : null}
          {lastStep?.nodeType === 'agent' && minibarAgentMeta ? (
            <span className="run-minibar-agent-meta" title={minibarAgentMeta.effectLabel}>
              <span className="run-minibar-effect">{minibarAgentMeta.effectLabel}</span>
              {minibarAgentMeta.tokenBadges.map((b) => (
                <span key={b.label} className="run-metric-badge metric-tokens">
                  {b.label}: {b.value}
                </span>
              ))}
              {minibarAgentMeta.toolNames.slice(0, 3).map((n) => (
                <span key={n} className="run-metric-badge metric-tool">
                  {n}
                </span>
              ))}
              {minibarAgentMeta.toolNames.length > 3 ? (
                <span className="run-metric-badge metric-tool">+{minibarAgentMeta.toolNames.length - 3}</span>
              ) : null}
            </span>
          ) : null}
        <span className="run-minibar-flow" title={flowName || 'Untitled Flow'}>
          {flowName || 'Untitled Flow'}
        </span>
      </button>

      <div className="run-minibar-actions">
        {onCancelRun ? (
          <button
            type="button"
            className="run-minibar-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              onCancelRun();
            }}
            disabled={!(isRunning || isPaused || isWaiting)}
            title="Cancel"
            aria-label="Cancel run"
          >
            ⏹
          </button>
        ) : null}

        {(onPause || onResumeRun) ? (
          <button
            type="button"
            className="run-minibar-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (isPaused) onResumeRun?.();
              else onPause?.();
            }}
            disabled={isPaused ? !isPaused : !(isRunning && !isWaiting)}
            title={isPaused ? 'Resume' : 'Pause'}
            aria-label={isPaused ? 'Resume run' : 'Pause run'}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
        ) : null}

        <button
          type="button"
          className="run-minibar-btn"
          onClick={() => setIsMinimized(false)}
          title="Expand"
          aria-label="Expand run modal"
        >
          <ChevronUpIcon />
        </button>
      </div>
    </div>
  );

  const shouldRenderMarkdown = useCallback(
    (nodeType?: string | null) => {
      const t = typeof nodeType === 'string' ? nodeType.trim() : '';
      if (!t) return false;
      return (
        t === 'ask_user' ||
        t === 'answer_user' ||
        t === 'llm_call' ||
        t === 'code' ||
        t === 'agent' ||
        t === 'on_flow_end' ||
        // Subflows often contain markdown-ish artifacts (e.g. raw LLM answers with code fences).
        t === 'subflow'
      );
    },
    []
  );

  const hexToRgba = (hex: string, alpha: number) => {
    const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return `rgba(255,255,255,${alpha})`;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const formatValue = useCallback((value: unknown) => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

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

  const openWorkspaceFolder = async () => {
    if (!rootRunId) return;
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(rootRunId)}/open-workspace`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to open workspace (HTTP ${res.status})`);
      }
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'Failed to open workspace');
    }
  };

  const outputPreview = useMemo(() => {
    if (!selectedStep?.output) return null;
    const value = selectedStep.output;

    if (typeof value === 'string') {
      const text = value.trim();
      return text ? { previewText: text, task: null, scratchpad: null, raw: value, cleaned: value } : null;
    }

    if (!value || typeof value !== 'object') {
      return { previewText: String(value), task: null, scratchpad: null, raw: value, cleaned: value };
    }

    const obj = value as Record<string, unknown>;

	    let task: string | null = null;
	    let previewText: string | null = null;
	    let scratchpad: unknown = null;
	    let provider: string | null = null;
	    let model: string | null = null;
	    let usage: unknown = null;
	    let benchmark: Record<string, unknown> | null = null;
	    let subRunId: string | null = null;

    const asRecord = (v: unknown): Record<string, unknown> | null => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return v as Record<string, unknown>;
    };

    const isBenchmarkRecord = (v: unknown): v is Record<string, unknown> => {
      const rec = asRecord(v);
      if (!rec) return false;
      const mode = typeof rec.mode === 'string' ? rec.mode.trim() : '';
      const promptId = typeof rec.prompt_id === 'string' ? rec.prompt_id.trim() : '';
      if (!mode || !promptId) return false;
      return 'metrics' in rec || 'correct' in rec || 'signature' in rec;
    };

    // Many nodes return wrappers (e.g. subflow: { output: { record }, record }).
    // Detect our benchmark record shape so we can show a richer preview.
    benchmark =
      (isBenchmarkRecord(obj) ? obj : null) ||
      (isBenchmarkRecord(obj.record) ? (obj.record as Record<string, unknown>) : null) ||
      (() => {
        const out = asRecord(obj.output);
        const nested = out ? out.record : null;
        return isBenchmarkRecord(nested) ? (nested as Record<string, unknown>) : null;
      })();

    // Agent output shape: { result: { task, result, ... }, scratchpad: ... }
    if (obj.result && typeof obj.result === 'object') {
      const res = obj.result as Record<string, unknown>;
      if (typeof res.task === 'string' && res.task.trim()) task = res.task.trim();
      if (typeof res.result === 'string' && res.result.trim()) previewText = res.result.trim();
      if (!previewText && typeof res.message === 'string' && res.message.trim()) previewText = res.message.trim();
      if (!previewText && typeof res.response === 'string' && res.response.trim()) previewText = res.response.trim();
      if (typeof res.provider === 'string' && res.provider.trim()) provider = res.provider.trim();
      if (typeof res.model === 'string' && res.model.trim()) model = res.model.trim();
      if ('usage' in res) usage = res.usage;
    }

    if (!previewText && typeof obj.message === 'string' && obj.message.trim()) previewText = obj.message.trim();
    if (!previewText && typeof obj.response === 'string' && obj.response.trim()) previewText = obj.response.trim();
	    if (!previewText && typeof obj.result === 'string' && obj.result.trim()) previewText = obj.result.trim();
	    if (!provider && typeof obj.provider === 'string' && obj.provider.trim()) provider = obj.provider.trim();
	    if (!model && typeof obj.model === 'string' && obj.model.trim()) model = obj.model.trim();
	    if (!usage && 'usage' in obj) usage = obj.usage;
	    if (!subRunId && typeof obj.sub_run_id === 'string' && obj.sub_run_id.trim()) subRunId = obj.sub_run_id.trim();

    // Benchmark records store provider/model under `config`.
    if ((!provider || !model) && benchmark) {
      const cfg = asRecord(benchmark.config);
      if (!provider && typeof cfg?.provider === 'string' && cfg.provider.trim()) provider = cfg.provider.trim();
      if (!model && typeof cfg?.model === 'string' && cfg.model.trim()) model = cfg.model.trim();
    }

    // llm_call output shape stores provider/model/usage under `raw`.
    if ((!provider || !model || !usage) && obj.raw && typeof obj.raw === 'object') {
      const raw = obj.raw as Record<string, unknown>;
      if (!provider && typeof raw.provider === 'string' && raw.provider.trim()) provider = raw.provider.trim();
      if (!model && typeof raw.model === 'string' && raw.model.trim()) model = raw.model.trim();
      if (!usage && 'usage' in raw) usage = raw.usage;
    }

    if ('scratchpad' in obj) scratchpad = obj.scratchpad;

    // Agent nodes: infer provider/model from the last llm_call inside scratchpad steps if needed.
    if ((!provider || !model) && scratchpad && typeof scratchpad === 'object') {
      const sp = scratchpad as Record<string, unknown>;
      const steps = Array.isArray(sp.steps) ? sp.steps : [];
      for (let i = steps.length - 1; i >= 0; i--) {
        const st = steps[i];
        if (!st || typeof st !== 'object') continue;
        const stepObj = st as Record<string, unknown>;
        const effect = stepObj.effect && typeof stepObj.effect === 'object' ? (stepObj.effect as Record<string, unknown>) : null;
        const effectType = effect && typeof effect.type === 'string' ? effect.type : '';
        if (effectType !== 'llm_call') continue;

        const payload =
          effect && effect.payload && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
        if (!provider && typeof payload?.provider === 'string' && payload.provider.trim()) provider = payload.provider.trim();
        if (!model && typeof payload?.model === 'string' && payload.model.trim()) model = payload.model.trim();

        const result = stepObj.result && typeof stepObj.result === 'object' ? (stepObj.result as Record<string, unknown>) : null;
        if (!provider && typeof result?.provider === 'string' && result.provider.trim()) provider = result.provider.trim();
        if (!model && typeof result?.model === 'string' && result.model.trim()) model = result.model.trim();

        if (provider || model) break;
      }
    }

	    // If no previewText yet, fall back to the benchmark raw answer (often contains code fences).
	    if (!previewText && benchmark) {
	      const dbg = asRecord(benchmark.debug);
	      const rawAnswer = dbg && typeof dbg.raw_answer === 'string' ? dbg.raw_answer.trim() : '';
	      if (rawAnswer) previewText = rawAnswer;
	    }

    let cleaned: unknown = value;
    if (obj && typeof obj === 'object') {
      const copy = { ...obj };
      delete (copy as Record<string, unknown>)._pending_effect;
      cleaned = copy;
    }

	    if (!task && !previewText && scratchpad == null && !provider && !model && !usage && !benchmark && !subRunId) return null;
	    return { task, previewText, scratchpad, provider, model, usage, benchmark, subRunId, raw: value, cleaned };
	  }, [selectedStep?.output]);

  const selectedEventIndex = useMemo(() => {
    if (!selectedStep?.id) return null;
    const parts = selectedStep.id.split(':');
    const raw = parts.length > 0 ? parts[parts.length - 1] : '';
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }, [selectedStep?.id]);

  const memorizeContentPreview = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_note') return null;
    if (!selectedStep.nodeId) return null;

    // Prefer the *actual* content wired into the node (full fidelity).
    // The runtime meta `note_preview` is intentionally shortened for observability,
    // so we only use it as a fallback.
    let fallbackPreview: string | null = null;
    const out = selectedStep.output;
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      const obj = out as Record<string, unknown>;
      const raw = obj.raw;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const rawObj = raw as Record<string, unknown>;
        const results = rawObj.results;
        if (Array.isArray(results) && results.length > 0) {
          const first = results[0];
          if (first && typeof first === 'object') {
            const meta = (first as Record<string, unknown>).meta;
            if (meta && typeof meta === 'object') {
              const notePreview = (meta as Record<string, unknown>).note_preview;
              if (typeof notePreview === 'string' && notePreview.trim()) fallbackPreview = notePreview.trim();
            }
          }
        }
      }
    }

    const targetNodeId = selectedStep.nodeId;
    const edge = edges.find((e) => e.target === targetNodeId && e.targetHandle === 'content');
    if (!edge || !edge.source) return null;

    const sourceNodeId = edge.source;
    const sourceHandle = edge.sourceHandle || '';

    const startAt = Math.max(0, (typeof selectedEventIndex === 'number' ? selectedEventIndex : events.length) - 1);
    for (let i = startAt; i >= 0; i--) {
      const ev = events[i];
      if (ev.type !== 'node_complete') continue;
      if (rootRunId && ev.runId && ev.runId !== rootRunId) continue;
      if (ev.nodeId !== sourceNodeId) continue;

      const r = ev.result as unknown;
      let value: unknown = r;
      if (sourceHandle && r && typeof r === 'object' && !Array.isArray(r)) {
        value = (r as Record<string, unknown>)[sourceHandle];
      }
      if (value == null) return null;
      const text = typeof value === 'string' ? value : formatValue(value);
      const trimmed = text.trim();
      return trimmed ? trimmed : null;
    }

    // Fallback for pure/literal nodes: no node_complete event exists.
    const srcNode = nodes.find((n) => n.id === sourceNodeId);
    const lv = srcNode?.data?.literalValue;
    if (lv != null) {
      const text = typeof lv === 'string' ? lv : formatValue(lv);
      const trimmed = text.trim();
      return trimmed ? trimmed : null;
    }

    return fallbackPreview;
  }, [edges, events, formatValue, nodes, rootRunId, selectedEventIndex, selectedStep]);

  const recallIntoContextArtifacts = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate') return [];
    const out = selectedStep.output;
    if (!out || typeof out !== 'object' || Array.isArray(out)) return [];
    const obj = out as Record<string, unknown>;
    const artifactsRaw = obj.artifacts;
    const artifacts = Array.isArray(artifactsRaw) ? artifactsRaw : [];
    if (!artifacts.length) return [];

    const entries: Array<{ artifact_id: string; inserted?: number; skipped?: number; preview?: string; error?: string }> = [];
    for (const a of artifacts) {
      if (!a || typeof a !== 'object') continue;
      const ao = a as Record<string, unknown>;
      const artifact_id = typeof ao.artifact_id === 'string' ? ao.artifact_id.trim() : '';
      if (!artifact_id) continue;
      const inserted = typeof ao.inserted === 'number' ? ao.inserted : undefined;
      const skipped = typeof ao.skipped === 'number' ? ao.skipped : undefined;
      const preview = typeof ao.preview === 'string' ? ao.preview : undefined;
      const error = typeof ao.error === 'string' ? ao.error : undefined;
      entries.push({ artifact_id, inserted, skipped, preview, error });
    }
    return entries;
  }, [selectedStep]);

  const recallIntoContextPreview = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate') return null;
    if (!recallIntoContextArtifacts.length) return null;

    const blocks: string[] = [];
    for (const a of recallIntoContextArtifacts) {
      const preview = typeof a.preview === 'string' ? a.preview.trim() : '';
      if (!preview) continue;
      const title = `**artifact** \`${a.artifact_id}\``;
      blocks.push(`${title}\n${preview}`);
    }
    const text = blocks.join('\n\n').trim();
    return text ? text : null;
  }, [recallIntoContextArtifacts, selectedStep]);

  useEffect(() => {
    if (!isOpen) return;
    if (!selectedStep || selectedStep.nodeType !== 'memory_rehydrate' || !rootRunId) {
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(null);
      setRehydrateArtifactLoading(false);
      return;
    }
    if (!recallIntoContextArtifacts.length) {
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(null);
      setRehydrateArtifactLoading(false);
      return;
    }

    let cancelled = false;
    const artifactIds = recallIntoContextArtifacts.map((a) => a.artifact_id);

    setRehydrateArtifactLoading(true);
    setRehydrateArtifactError(null);
    setRehydrateArtifactMarkdown(null);

    (async () => {
      const fetched = await Promise.all(
        artifactIds.map(async (aid) => {
          const res = await fetch(`/api/runs/${encodeURIComponent(rootRunId)}/artifacts/${encodeURIComponent(aid)}`);
          if (!res.ok) throw new Error(`Failed to fetch artifact ${aid} (HTTP ${res.status})`);
          return res.json() as Promise<{ artifact_id: string; payload: unknown }>;
        })
      );

      const blocks: string[] = [];
      for (const entry of recallIntoContextArtifacts) {
        const found = fetched.find((x) => x && x.artifact_id === entry.artifact_id);
        const payload = found ? found.payload : null;

        const metaLines: string[] = [];
        if (typeof entry.inserted === 'number') metaLines.push(`- inserted: ${entry.inserted}`);
        if (typeof entry.skipped === 'number') metaLines.push(`- skipped: ${entry.skipped}`);
        if (typeof entry.error === 'string' && entry.error.trim()) metaLines.push(`- error: ${entry.error.trim()}`);

        let body = '';
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const obj = payload as Record<string, unknown>;
          const note = typeof obj.note === 'string' ? obj.note : '';
          const messages = Array.isArray(obj.messages) ? obj.messages : null;
          if (note && note.trim()) {
            body = note.trim();
          } else if (messages) {
            const lines: string[] = [];
            for (const m of messages) {
              if (!m || typeof m !== 'object') continue;
              const mo = m as Record<string, unknown>;
              const role = typeof mo.role === 'string' ? mo.role : 'unknown';
              const ts = typeof mo.timestamp === 'string' ? mo.timestamp : '';
              const content = typeof mo.content === 'string' ? mo.content : '';
              const prefix = ts ? `${ts} ${role}: ` : `${role}: `;
              lines.push(prefix + content);
            }
            body = `\`\`\`text\n${lines.join('\n\n')}\n\`\`\``;
          } else {
            body = `\`\`\`json\n${formatValue(payload)}\n\`\`\``;
          }
        } else if (payload != null) {
          body = `\`\`\`json\n${formatValue(payload)}\n\`\`\``;
        }

        const header = `**artifact** \`${entry.artifact_id}\``;
        const block = [header, metaLines.join('\n'), body].filter((s) => s && s.trim()).join('\n\n');
        blocks.push(block);
      }

      const markdown = blocks.join('\n\n---\n\n').trim();
      if (!cancelled) {
        setRehydrateArtifactMarkdown(markdown || null);
        setRehydrateArtifactLoading(false);
      }
    })().catch((e) => {
      if (cancelled) return;
      setRehydrateArtifactMarkdown(null);
      setRehydrateArtifactError(e instanceof Error ? e.message : 'Failed to fetch artifacts');
      setRehydrateArtifactLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [formatValue, isOpen, recallIntoContextArtifacts, rootRunId, selectedStep]);

  const recallIntoContextDisplay = rehydrateArtifactMarkdown || recallIntoContextPreview;

  const onFlowStartParams = useMemo(() => {
    if (!selectedStep || selectedStep.nodeType !== 'on_flow_start') return null;
    const out = selectedStep.output;
    if (!out || typeof out !== 'object') return null;
    if (Array.isArray(out)) return null;

    const obj = out as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([k]) => k && k !== 'exec-out' && !k.startsWith('_'));
    if (entries.length === 0) return null;

    const weight = (k: string) => {
      if (k === 'prompt') return 0;
      if (k === 'provider') return 1;
      if (k === 'model') return 2;
      return 10;
    };

    entries.sort((a, b) => {
      const wa = weight(a[0]);
      const wb = weight(b[0]);
      if (wa !== wb) return wa - wb;
      return a[0].localeCompare(b[0]);
    });

    return entries;
  }, [selectedStep]);

  const shouldDefaultRawJsonOpen = useMemo(() => {
    if (!selectedStep || selectedStep.output == null) return false;
    const hasPreviewBlocks =
      Boolean(memorizeContentPreview) ||
      Boolean(recallIntoContextDisplay) ||
      (selectedStep.nodeType === 'on_flow_start' && Boolean(onFlowStartParams)) ||
      Boolean(outputPreview?.task) ||
      Boolean(outputPreview?.benchmark) ||
      Boolean(outputPreview?.previewText) ||
      Boolean(outputPreview?.usage) ||
      Boolean(outputPreview?.provider) ||
      Boolean(outputPreview?.model) ||
      outputPreview?.scratchpad != null;
    return !hasPreviewBlocks;
  }, [memorizeContentPreview, onFlowStartParams, outputPreview, recallIntoContextDisplay, selectedStep]);

  const lastRawJsonStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedStep?.id || null;
    if (!id) {
      lastRawJsonStepIdRef.current = null;
      return;
    }
    if (lastRawJsonStepIdRef.current === id) return;
    lastRawJsonStepIdRef.current = id;
    setRawJsonOpen(shouldDefaultRawJsonOpen);
  }, [selectedStep?.id, shouldDefaultRawJsonOpen]);

  const usageBadges = useMemo(() => getUsageBadges(outputPreview?.usage), [outputPreview?.usage]);

  const traceSteps = useMemo(() => {
    const scratchpad = outputPreview?.scratchpad;
    if (!scratchpad || typeof scratchpad !== 'object') return null;
    const stepsRaw = (scratchpad as Record<string, unknown>).steps;
    if (!Array.isArray(stepsRaw)) return null;
    return stepsRaw.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object');
  }, [outputPreview?.scratchpad]);

  const formatTraceTime = (raw: unknown) => {
    const ts = typeof raw === 'string' ? raw : '';
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString();
  };

  const traceStatusLabel = (raw: unknown) => {
    const s = typeof raw === 'string' ? raw : '';
    if (s === 'completed') return 'OK';
    if (s === 'failed') return 'FAILED';
    if (s === 'waiting') return 'WAITING';
    return s ? s.toUpperCase() : 'UNKNOWN';
  };

  const traceEffectSummary = (step: Record<string, unknown>) => {
    const effect = step.effect && typeof step.effect === 'object' ? (step.effect as Record<string, unknown>) : null;
    const effectType = effect && typeof effect.type === 'string' ? effect.type : 'effect';
    const payload = effect && typeof effect.payload === 'object' ? (effect.payload as Record<string, unknown>) : null;
    const result = step.result && typeof step.result === 'object' ? (step.result as Record<string, unknown>) : null;
    const wait = step.wait && typeof step.wait === 'object' ? (step.wait as Record<string, unknown>) : null;
    const durationMs = typeof step.duration_ms === 'number' ? step.duration_ms : null;

    if (effectType === 'llm_call') {
      const provider =
        (payload && typeof payload.provider === 'string' ? payload.provider : '') ||
        (result && typeof result.provider === 'string' ? result.provider : '') ||
        '';
      const model =
        (payload && typeof payload.model === 'string' ? payload.model : '') ||
        (result && typeof result.model === 'string' ? result.model : '') ||
        '';

      const usageRaw = result ? result.usage : null;
      const usage = usageRaw && typeof usageRaw === 'object' ? (usageRaw as Record<string, unknown>) : null;
      const inTokens =
        usage && typeof usage.prompt_tokens === 'number'
          ? usage.prompt_tokens
          : usage && typeof usage.input_tokens === 'number'
            ? usage.input_tokens
            : null;
      const outTokens =
        usage && typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : usage && typeof usage.output_tokens === 'number'
            ? usage.output_tokens
            : null;
      const totalTokens = usage && typeof usage.total_tokens === 'number' ? usage.total_tokens : null;

      const toolCallsRaw = result ? result.tool_calls : null;
      const toolCalls = Array.isArray(toolCallsRaw) ? toolCallsRaw.length : null;

      const contentRaw = result ? result.content : null;
      const content = typeof contentRaw === 'string' ? contentRaw.trim() : '';
      const preview = content;

      const tps =
        typeof outTokens === 'number' && outTokens > 0 && typeof durationMs === 'number' && durationMs > 0
          ? outTokens / (durationMs / 1000)
          : null;

      const meta = [
        provider && model ? `${provider}/${model}` : provider || model,
        durationMs != null ? formatDuration(durationMs) : null,
        inTokens != null || outTokens != null ? `${inTokens ?? 0}→${outTokens ?? 0} tk` : null,
        tps != null ? `${tps.toFixed(tps < 10 ? 2 : 1)} tk/s` : null,
        totalTokens != null ? `${totalTokens} total` : null,
        toolCalls != null ? `${toolCalls} tool_calls` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { title: 'LLM_CALL', meta, preview };
    }

    if (effectType === 'tool_calls') {
      const callsRaw = payload ? payload.tool_calls : null;
      const calls = Array.isArray(callsRaw) ? callsRaw : [];
      const names = calls
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).name : null))
        .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n) => n.trim());
      const uniqueNames = Array.from(new Set(names));

      const resultsRaw = result ? result.results : null;
      const results = Array.isArray(resultsRaw) ? resultsRaw : [];
      const okCount = results.filter((r) => r && typeof r === 'object' && (r as Record<string, unknown>).success === true).length;
      const failCount = results.filter((r) => r && typeof r === 'object' && (r as Record<string, unknown>).success === false).length;

      let preview = '';
      const first = results.find((r) => r && typeof r === 'object') as Record<string, unknown> | undefined;
      if (first) {
        const success = first.success === true;
        const rawOut = success ? first.output : (first.error ?? first.output);
        if (rawOut != null) {
          const text = typeof rawOut === 'string' ? rawOut : (() => {
            try {
              return JSON.stringify(rawOut);
            } catch {
              return String(rawOut);
            }
          })();
          preview = text;
        }
      }

      const meta = [
        durationMs != null ? formatDuration(durationMs) : null,
        uniqueNames.length ? uniqueNames.join(', ') : null,
        results.length ? `${okCount} ok${failCount ? ` · ${failCount} failed` : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return { title: 'TOOL_CALLS', meta, preview };
    }

    if (effectType === 'ask_user') {
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt : typeof wait?.prompt === 'string' ? wait.prompt : '';
      const text = prompt.trim();
      const preview = text;
      return { title: 'ASK_USER', meta: '', preview };
    }

    return { title: String(effectType).toUpperCase(), meta: '', preview: '' };
  };

  const submitResume = () => {
    const response = resumeDraft.trim();
    if (!response) return;
    onResume?.(response);
  };

  if (!isOpen) return null;

  return isMinimized ? minibar : (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal run-modal${isMaximized ? ' run-modal-maximized' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="run-modal-header">
          <div className="run-modal-header-left">
            <h3>▶ Run Flow</h3>
            <span className="run-modal-flow-name">{flowName || 'Untitled Flow'}</span>
          </div>
          <div className="run-modal-header-right">
            {flowId && onSelectRunId ? (
              <RunSwitcherDropdown workflowId={flowId} currentRunId={rootRunId} onSelectRun={onSelectRunId} />
            ) : null}
            <button
              type="button"
              className="run-minimize-btn"
              onClick={() => setIsMinimized(true)}
              title="Minimize"
              aria-label="Minimize run modal"
            >
              <MinimizeWindowIcon />
            </button>
            <button
              type="button"
              className="run-maximize-btn"
              onClick={() => setIsMaximized((v) => !v)}
              title={isMaximized ? 'Restore' : 'Maximize'}
              aria-label={isMaximized ? 'Restore run modal size' : 'Maximize run modal'}
            >
              {isMaximized ? <RestoreWindowIcon /> : <MaximizeWindowIcon />}
            </button>
          </div>
        </div>

        {/* Body (scrollable) */}
        <div className="run-modal-body">
          {/* Execution (Steps + Details) */}
          {hasRunData && (
            <div className="run-modal-execution">
            <div className="run-steps">
              <div className="run-steps-header">
                <div className="run-steps-title">Execution</div>
                <div className="run-steps-subtitle">
                  {isRunning ? <span className="run-spinner" aria-label="running" /> : null}
                  {runStatusLabel}
                  {flowSummary ? (
                    <span className="run-metrics-inline">
                      {formatDuration(flowSummary.duration_ms) ? (
                        <span className="run-metric-badge metric-duration">{formatDuration(flowSummary.duration_ms)}</span>
                      ) : null}
                      {formatTokenBadge(flowSummary) ? (
                        <span className="run-metric-badge metric-tokens">{formatTokenBadge(flowSummary)}</span>
                      ) : null}
                      {formatTpsBadge(flowSummary) ? (
                        <span className="run-metric-badge metric-throughput">{formatTpsBadge(flowSummary)}</span>
                      ) : null}
                    </span>
                  ) : null}
                  {benchmarkProgress && benchmarkProgress.totalRecords > 0 ? (
                    <span className="run-metrics-inline">
                      <span className="run-metric-badge metric-benchmark" title="Completed benchmark sub-runs">
                        Bench {benchmarkProgress.completedRecords}/{benchmarkProgress.totalRecords}
                      </span>
                      {benchmarkProgress.runsLoop ? (
                        <span className="run-metric-badge metric-benchmark" title="Run preset">
                          run {Math.min(benchmarkProgress.runsLoop.index + 1, benchmarkProgress.runsLoop.total)}/{benchmarkProgress.runsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.promptsLoop ? (
                        <span
                          className="run-metric-badge metric-benchmark"
                          title={
                            benchmarkProgress.promptLabel
                              ? `${benchmarkProgress.promptId || 'prompt'} — ${benchmarkProgress.promptLabel}`
                              : (benchmarkProgress.promptId || 'System prompt')
                          }
                        >
                          {(benchmarkProgress.promptId || 'prompt')}{' '}
                          {Math.min(benchmarkProgress.promptsLoop.index + 1, benchmarkProgress.promptsLoop.total)}/{benchmarkProgress.promptsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.repeatsLoop ? (
                        <span className="run-metric-badge metric-benchmark" title="Repeat">
                          rep {Math.min(benchmarkProgress.repeatsLoop.index + 1, benchmarkProgress.repeatsLoop.total)}/{benchmarkProgress.repeatsLoop.total}
                        </span>
                      ) : null}
                      {benchmarkProgress.etaMs != null ? (
                        <span className="run-metric-badge metric-duration" title="ETA (rough; based on average sub-run duration)">
                          ETA {formatDuration(benchmarkProgress.etaMs)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="run-steps-list">
                {stepTree.length === 0 ? (
                  <div className="run-steps-empty">No execution events yet.</div>
                ) : (
                  (() => {
                    const renderNodes = (nodes: StepTreeNode[]): Array<JSX.Element | null> => {
                      return nodes.map((n, idx) => {
                        const s = stepById.get(n.stepId);
                        if (!s) return null;

                        const selected = s.id === selectedStepId;
                        const color = s.nodeColor || '#888888';
                        const bg = hexToRgba(color, 0.12);
                        const statusLabel =
                          s.status === 'running'
                            ? 'RUNNING'
                            : s.status === 'completed'
                              ? 'OK'
                              : s.status === 'waiting'
                                ? 'WAITING'
                                : 'FAILED';
                        const startedAtLabel = formatStepTime(s.startedAt);
                        const durationLabel =
                          s.status === 'completed' && s.metrics && s.metrics.duration_ms != null
                            ? formatDuration(s.metrics.duration_ms)
                            : '';

                        const hasChildren = Array.isArray(n.children) && n.children.length > 0;
                        const expanded = hasChildren && expandedSubflows[s.id] === true;
                        const depth = typeof n.depth === 'number' && n.depth > 0 ? n.depth : 0;

                        return (
                          <div key={s.id} className="run-step-tree-item">
                            <button
                              type="button"
                              className={selected ? 'run-step selected' : 'run-step'}
                              onClick={() => setSelectedStepId(s.id)}
                            >
                              <div className="run-step-border" style={{ background: color }} />
                              <div className="run-step-main">
                                <div className="run-step-top">
                                  <div className="run-step-left">
                                    {hasChildren ? (
                                      <span
                                        className="run-step-toggle"
                                        title={expanded ? 'Collapse subflow steps' : 'Expand subflow steps'}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleSubflowExpansion(s.id);
                                        }}
                                      >
                                        {expanded ? '▾' : '▸'}
                                      </span>
                                    ) : null}
                                    <span className="run-step-index">#{idx + 1}</span>
                                    {s.nodeIcon ? (
                                      <span
                                        className="run-step-icon"
                                        style={{ color }}
                                        dangerouslySetInnerHTML={{ __html: s.nodeIcon }}
                                      />
                                    ) : null}
                                    <span className="run-step-label">{s.nodeLabel || s.nodeId || 'node'}</span>
                                  </div>
                                  <span className="run-step-right">
                                    <span className={`run-step-status ${s.status}`}>
                                      {s.status === 'running' ? <span className="run-spinner" aria-label="running" /> : null}
                                      {statusLabel}
                                    </span>
                                    {durationLabel ? (
                                      <span className="run-metric-badge metric-duration" title="Duration">
                                        {durationLabel}
                                      </span>
                                    ) : null}
                                    {startedAtLabel ? (
                                      <span className="run-step-time" title={`Started at ${startedAtLabel}`}>
                                        {startedAtLabel}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                                <div className="run-step-meta">
                                  <span className="run-step-type" style={{ background: bg, borderColor: color }}>
                                    {s.nodeType || 'node'}
                                  </span>
                                  {depth > 0 ? <span className="run-metric-badge metric-depth">d{depth}</span> : null}
                                  {s.provider ? <span className="run-metric-badge metric-provider">{s.provider}</span> : null}
                                  {s.model ? <span className="run-metric-badge metric-model">{s.model}</span> : null}
                                  {s.nodeId ? <span className="run-step-id">{s.nodeId}</span> : null}
                                  {s.status === 'completed' && s.metrics ? (
                                    <span className="run-step-metrics">
                                      {formatTokenBadge(s.metrics) ? (
                                        <span className="run-metric-badge metric-tokens">{formatTokenBadge(s.metrics)}</span>
                                      ) : null}
                                      {formatTpsBadge(s.metrics) ? (
                                        <span className="run-metric-badge metric-throughput">{formatTpsBadge(s.metrics)}</span>
                                      ) : null}
                                    </span>
                                  ) : null}
                                </div>
                                {s.status === 'failed' && s.error ? (
                                  <div className="run-step-error">{s.error}</div>
                                ) : s.status === 'waiting' && s.waiting ? (
                                  <div className="run-step-waiting">
                                    {s.waiting.reason ? `waiting · ${s.waiting.reason}` : 'waiting'}
                                    {s.waiting.prompt ? ` · ${s.waiting.prompt}` : ''}
                                  </div>
                                ) : s.status === 'completed' && s.summary ? (
                                  <div className="run-step-summary">{s.summary}</div>
                                ) : null}
                              </div>
                            </button>

                            {hasChildren && expanded ? (
                              <div className="run-step-children">{renderNodes(n.children)}</div>
                            ) : null}
                          </div>
                        );
                      });
                    };

                    return renderNodes(stepTree);
                  })()
                )}
              </div>
            </div>

            <div className="run-details">
              <div className="run-details-header">
                <div className="run-details-title">
                  {selectedStep ? selectedStep.nodeLabel || selectedStep.nodeId || 'Step' : 'Details'}
                </div>
                {selectedStep?.nodeType ? (
                  <div className="run-details-header-badges">
                    {selectedStep.provider ? <span className="run-metric-badge metric-provider">{selectedStep.provider}</span> : null}
                    {selectedStep.model ? <span className="run-metric-badge metric-model">{selectedStep.model}</span> : null}
                    {parentRunId && onSelectRunId ? (
                      <button
                        type="button"
                        className="run-details-parent-link"
                        onClick={() => onSelectRunId(parentRunId)}
                        title={`Back to parent run: ${parentRunId}`}
                      >
                        Main flow
                      </button>
                    ) : null}
                    <span
                      className="run-details-type"
                      style={{
                        borderColor: selectedStep.nodeColor || '#888888',
                        background: hexToRgba(selectedStep.nodeColor || '#888888', 0.12),
                      }}
                    >
                      {selectedStep.nodeType}
                    </span>
                  </div>
                ) : null}
              </div>

	              {selectedStep ? (
	                <div className="run-details-body">
	                  {selectedStep.status === 'running' ? (
	                    <>
	                      <div className="run-working">
	                        <span className="run-spinner" aria-label="working" />
	                        <div>
	                          <div className="run-working-title">Working…</div>
	                          <div className="run-working-note">This node is still processing. The output will appear when it completes.</div>
	                        </div>
	                      </div>
	                      {selectedStep.nodeType === 'subflow' ? (
	                        selectedSubflowRunId ? (
	                          <AgentSubrunTracePanel
	                            rootRunId={rootRunId}
	                            events={traceEvents}
	                            subRunId={selectedSubflowRunId}
	                            title="Subflow calls"
	                            subtitle="Live per-effect trace (LLM/tool calls)."
	                            onOpenSubRun={onSelectRunId ? () => onSelectRunId(selectedSubflowRunId) : undefined}
	                          />
	                        ) : (
	                          <div className="agent-trace-panel">
	                            <div className="agent-trace-header">
	                              <div className="agent-trace-title">Subflow calls</div>
	                              <div className="agent-trace-subtitle">Waiting for sub_run_id…</div>
	                            </div>
	                            <div className="agent-trace-empty">No trace entries yet.</div>
	                          </div>
	                        )
	                      ) : null}
	                      {selectedStep.nodeType === 'agent' ? (
	                        <AgentSubrunTracePanel rootRunId={rootRunId} events={traceEvents} subRunId={selectedAgentSubRunId} />
	                      ) : null}
	                    </>
	                  ) : selectedStep.status === 'waiting' && (waitingInfo || selectedStep.waiting) ? (
                    <div className="run-waiting">
                      <div className="run-waiting-prompt">
                        <MarkdownRenderer
                          markdown={(selectedStep.waiting?.prompt || waitingInfo?.prompt || 'Please respond:').trim()}
                        />
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
                      {selectedStep.nodeType === 'agent' ? (
                        <AgentSubrunTracePanel rootRunId={rootRunId} events={traceEvents} subRunId={selectedAgentSubRunId} />
                      ) : null}
                      {selectedStep.metrics ? (
                        <div className="run-details-metrics">
                          <div className="run-details-metrics-row">
                            <span className="run-details-metrics-label">Duration</span>
                            <span className="run-details-metrics-value">{formatDuration(selectedStep.metrics.duration_ms)}</span>
                          </div>
                          {(typeof selectedStep.metrics.input_tokens === 'number' || typeof selectedStep.metrics.output_tokens === 'number') ? (
                            <div className="run-details-metrics-row">
                              <span className="run-details-metrics-label">Tokens</span>
                              <span className="run-details-metrics-value">{formatTokenBadge(selectedStep.metrics)}</span>
                            </div>
                          ) : null}
                          {formatTpsBadge(selectedStep.metrics) ? (
                            <div className="run-details-metrics-row">
                              <span className="run-details-metrics-label">Throughput</span>
                              <span className="run-details-metrics-value">{formatTpsBadge(selectedStep.metrics)}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
	                      <div className="run-details-actions">
	                        <button type="button" className="modal-button" onClick={() => copyToClipboard(selectedStep.output)}>
	                          Copy raw
	                        </button>
	                        {outputPreview?.subRunId && onSelectRunId ? (
	                          <button
	                            type="button"
	                            className="modal-button"
	                            onClick={() => onSelectRunId(outputPreview.subRunId ?? '')}
	                            title="Open the subflow run in the run switcher"
	                          >
	                            Open sub-run
	                          </button>
	                        ) : null}
	                        {memorizeContentPreview ? (
	                          <button type="button" className="modal-button" onClick={() => copyToClipboard(memorizeContentPreview)}>
	                            Copy content
	                          </button>
	                        ) : null}
                        {outputPreview?.previewText ? (
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(outputPreview.previewText)}>
                            Copy preview
                          </button>
                        ) : null}
                        {outputPreview?.scratchpad != null ? (
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(outputPreview.scratchpad)}>
                            Copy trace
                          </button>
                        ) : null}
                      </div>

                      {(outputPreview ||
                        memorizeContentPreview ||
                        recallIntoContextDisplay ||
                        (selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams) ||
                        (selectedStep?.nodeType === 'memory_kg_query' && selectedStep.output != null)) ? (
                        <div className="run-output-preview">
                          {selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Run parameters</div>
                              <div className="run-param-grid">
                                {onFlowStartParams.map(([k, v]) => {
                                  const isProvider = k === 'provider' && typeof v === 'string' && v.trim();
                                  const isModel = k === 'model' && typeof v === 'string' && v.trim();
                                  const isPrompt = k === 'prompt' && typeof v === 'string' && v.trim();
                                  const isSessionId = k === 'sessionId' && typeof v === 'string' && v.trim();
                                  const isWorkspaceRoot = k === 'workspace_root' && typeof v === 'string' && v.trim();

                                  return (
                                    <div key={k} className="run-param-row">
                                      <div className="run-param-key">{k}</div>
                                      <div className="run-param-val">
                                        {isProvider ? (
                                          <span className="run-metric-badge metric-provider">{String(v).trim()}</span>
                                        ) : isModel ? (
                                          <span className="run-metric-badge metric-model">{String(v).trim()}</span>
                                        ) : isSessionId ? (
                                          <div className="run-param-inline">
                                            <span className="run-param-text">{String(v)}</span>
                                            <button
                                              type="button"
                                              className="run-param-copy"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void copyToClipboard(v);
                                              }}
                                              title="Copy session id"
                                              aria-label="Copy session id"
                                            >
                                              ⧉
                                            </button>
                                          </div>
                                        ) : isWorkspaceRoot ? (
                                          <div className="run-param-inline">
                                            <button
                                              type="button"
                                              className="run-param-link"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void openWorkspaceFolder();
                                              }}
                                              title="Open workspace folder"
                                              aria-label="Open workspace folder"
                                            >
                                              {String(v)}
                                            </button>
                                            <button
                                              type="button"
                                              className="run-param-copy"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void copyToClipboard(v);
                                              }}
                                              title="Copy workspace path"
                                              aria-label="Copy workspace path"
                                            >
                                              ⧉
                                            </button>
                                          </div>
                                        ) : typeof v === 'boolean' ? (
                                          <span className="run-metric-badge metric-bool">{v ? 'true' : 'false'}</span>
                                        ) : typeof v === 'number' ? (
                                          <span className="run-metric-badge metric-number">{String(v)}</span>
                                        ) : isPrompt ? (
                                          <div className="run-details-markdown run-param-markdown">
                                            <MarkdownRenderer markdown={String(v).trim()} />
                                          </div>
                                        ) : typeof v === 'string' ? (
                                          <span className="run-param-text">{v}</span>
                                        ) : (
                                          <JsonViewer value={v} className="run-param-json" />
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_note' ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Memorized content</div>
                              {memorizeContentPreview ? (
                                <div className="run-details-markdown run-param-markdown">
                                  <MarkdownRenderer markdown={memorizeContentPreview} />
                                </div>
                              ) : (
                                <div className="run-details-empty">No preview available.</div>
                              )}
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_rehydrate' ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Recalled content</div>
                              {rehydrateArtifactLoading ? (
                                <div className="run-details-empty">Loading recalled content…</div>
                              ) : rehydrateArtifactError ? (
                                <div className="run-details-error">{rehydrateArtifactError}</div>
                              ) : recallIntoContextDisplay ? (
                                <div className="run-details-markdown run-param-markdown">
                                  <MarkdownRenderer markdown={recallIntoContextDisplay} />
                                </div>
                              ) : (
                                <div className="run-details-empty">No preview available.</div>
                              )}
                            </div>
                          ) : null}

                          {outputPreview?.task ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Task</div>
                              <pre className="run-details-output">{outputPreview.task}</pre>
                            </div>
                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            <div className="run-output-section">
	                              <div className="run-output-title">Benchmark</div>
	                              <div className="run-output-meta">
                                <div>
                                  <span className="run-output-meta-key">Mode</span>
                                  <span className="run-output-meta-val">{String(outputPreview.benchmark.mode ?? '')}</span>
                                </div>
                                <div>
                                  <span className="run-output-meta-key">Prompt</span>
                                  <span className="run-output-meta-val">
                                    {String(outputPreview.benchmark.prompt_id ?? '')}
                                    {outputPreview.benchmark.prompt_label ? ` — ${String(outputPreview.benchmark.prompt_label)}` : ''}
                                  </span>
                                </div>
	                                {outputPreview.benchmark.repeat != null ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Repeat</span>
	                                    <span className="run-output-meta-val">{String(outputPreview.benchmark.repeat)}</span>
	                                  </div>
	                                ) : null}
	                                {outputPreview.subRunId ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Sub-run</span>
	                                    <span className="run-output-meta-val">{outputPreview.subRunId}</span>
	                                  </div>
	                                ) : null}
	                                {typeof outputPreview.benchmark.correct === 'boolean' ? (
	                                  <div>
	                                    <span className="run-output-meta-key">Correct</span>
	                                    <span className="run-output-meta-val">{outputPreview.benchmark.correct ? 'true' : 'false'}</span>
	                                  </div>
	                                ) : null}
                                {Array.isArray(outputPreview.benchmark.issues) && outputPreview.benchmark.issues.length ? (
                                  <div>
                                    <span className="run-output-meta-key">Issues</span>
                                    <span className="run-output-meta-val">{outputPreview.benchmark.issues.join(', ')}</span>
                                  </div>
                                ) : null}
                                {typeof outputPreview.benchmark.signature === 'string' && outputPreview.benchmark.signature.trim() ? (
                                  <div>
                                    <span className="run-output-meta-key">Signature</span>
                                    <span className="run-output-meta-val">{outputPreview.benchmark.signature}</span>
                                  </div>
                                ) : null}
                                {(() => {
                                  const metrics =
                                    outputPreview.benchmark && typeof outputPreview.benchmark.metrics === 'object'
                                      ? (outputPreview.benchmark.metrics as Record<string, unknown>)
                                      : null;
                                  const stopReason = metrics && typeof metrics.stop_reason === 'string' ? metrics.stop_reason : null;
                                  return stopReason ? (
                                    <div>
                                      <span className="run-output-meta-key">Stop</span>
                                      <span className="run-output-meta-val">{stopReason}</span>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            (() => {
	                              const modelOutput = outputPreview.benchmark.model_output ?? outputPreview.benchmark.output;
	                              if (modelOutput == null) return null;
	                              return (
	                                <div className="run-output-section">
	                                  <div className="run-output-title">Model output</div>
	                                  <JsonViewer value={modelOutput} />
	                                </div>
	                              );
	                            })()
	                          ) : null}

	                          {outputPreview?.benchmark ? (
	                            (() => {
	                              const dbg =
	                                outputPreview.benchmark.debug && typeof outputPreview.benchmark.debug === 'object' && !Array.isArray(outputPreview.benchmark.debug)
	                                  ? (outputPreview.benchmark.debug as Record<string, unknown>)
	                                  : null;
	                              const rawAnswer = dbg && typeof dbg.raw_answer === 'string' ? dbg.raw_answer.trim() : '';
	                              if (!rawAnswer) return null;
	                              return (
	                                <div className="run-output-section">
	                                  <div className="run-output-title">Raw answer</div>
	                                  <div className="run-details-markdown">
	                                    <MarkdownRenderer markdown={rawAnswer} />
	                                  </div>
	                                </div>
	                              );
	                            })()
	                          ) : null}

	                          {outputPreview?.benchmark && outputPreview.benchmark.expected != null ? (
	                            <details className="run-raw-details">
	                              <summary>Expected</summary>
	                              <JsonViewer value={outputPreview.benchmark.expected} />
	                            </details>
	                          ) : null}

                          {outputPreview?.benchmark && outputPreview.benchmark.metrics != null ? (
                            <details className="run-raw-details">
                              <summary>Metrics</summary>
                              <JsonViewer value={outputPreview.benchmark.metrics} />
                            </details>
                          ) : null}

                          {outputPreview?.benchmark && outputPreview.benchmark.debug != null ? (
                            <details className="run-raw-details">
                              <summary>Debug</summary>
                              <JsonViewer value={outputPreview.benchmark.debug} />
                            </details>
                          ) : null}

                          {(outputPreview?.provider || outputPreview?.model || outputPreview?.usage) ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Meta</div>
                              <div className="run-output-meta">
                                {(outputPreview?.provider || outputPreview?.model) ? (
                                  <div>
                                    <span className="run-output-meta-key">Model</span>
                                    <span className="run-output-meta-val">
                                      <span className="run-output-meta-badges">
                                        {outputPreview?.provider ? (
                                          <span className="run-metric-badge metric-provider">{outputPreview.provider}</span>
                                        ) : null}
                                        {outputPreview?.model ? (
                                          <span className="run-metric-badge metric-model">{outputPreview.model}</span>
                                        ) : null}
                                      </span>
                                    </span>
                                  </div>
                                ) : null}
                                {outputPreview?.usage ? (
                                  <div>
                                    <span className="run-output-meta-key">Usage</span>
                                    <div className="run-output-meta-val">
                                      {usageBadges.length ? (
                                        <span className="run-output-meta-badges">
                                          {usageBadges.map((b) => (
                                            <span key={b.label} className="run-metric-badge metric-tokens">
                                              {b.label}: {b.value}
                                            </span>
                                          ))}
                                        </span>
                                      ) : (
                                        <JsonViewer value={outputPreview.usage} className="run-output-meta-json" />
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {outputPreview?.previewText ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Preview</div>
                              {shouldRenderMarkdown(selectedStep?.nodeType) ? (
                                <div className="run-details-markdown">
                                  <MarkdownRenderer markdown={outputPreview.previewText} />
                                </div>
                              ) : (
                                <pre className="run-details-output">{outputPreview.previewText}</pre>
                              )}
                            </div>
                          ) : null}

                          {selectedStep?.nodeType === 'memory_kg_query' && selectedStep.output != null ? (
                            <div className="run-output-section">
                              <div className="run-output-title">KG / Active Memory Explorer</div>
                              <KgActiveMemoryPanel
                                runId={rootRunId || null}
                                title={selectedStep.nodeLabel || selectedStep.nodeId || 'KG'}
                                output={selectedStep.output}
                              />
                            </div>
                          ) : null}

                          {/* Agent nodes have a dedicated live trace panel (AgentSubrunTracePanel) fed by trace_update events.
                              The legacy Trace/Scratchpad section is redundant for agents and can be confusing. */}
                          {selectedStep?.nodeType !== 'agent' && traceSteps ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Trace</div>
                              <div className="run-trace">
                                {traceSteps.map((t, idx) => {
                                  const status = typeof t.status === 'string' ? t.status : 'unknown';
                                  const label = traceStatusLabel(status);
                                  const summary = traceEffectSummary(t);
                                  return (
                                    <div key={idx} className={`run-trace-step ${status}`}>
                                      <div className="run-trace-top">
                                        <span className={`run-trace-status ${status}`}>{label}</span>
                                        <span className="run-trace-effect">{summary.title}</span>
                                        {summary.meta ? <span className="run-trace-meta">{summary.meta}</span> : null}
                                        <span className="run-trace-time">{formatTraceTime(t.ts)}</span>
                                      </div>
                                      {summary.preview ? <div className="run-trace-preview">{summary.preview}</div> : null}
                                    </div>
                                  );
                                })}
                              </div>

                              <details className="run-raw-details">
                                <summary>Trace JSON</summary>
                                <JsonViewer value={outputPreview?.scratchpad} />
                              </details>
                            </div>
                          ) : selectedStep?.nodeType !== 'agent' && outputPreview?.scratchpad != null ? (
                            <details className="run-raw-details">
                              <summary>Scratchpad</summary>
                              <JsonViewer value={outputPreview?.scratchpad} />
                            </details>
                          ) : null}
                        </div>
                      ) : null}

                      <details
                        className="run-raw-details"
                        open={rawJsonOpen}
                        onToggle={(e) => setRawJsonOpen((e.currentTarget as HTMLDetailsElement).open)}
                      >
                        <summary>Raw JSON</summary>
                        {rawJsonOpen ? <JsonViewer key={selectedStep.id} value={selectedStep.output} /> : null}
                      </details>
                    </>
                  ) : (
                    <div className="run-details-empty">No output for this step.</div>
                  )}

                  {showFinalResult && result ? (
                    <div className="run-final">
                      <div className={`run-final-header ${result.success ? 'success' : 'error'}`}>
                        <span className="run-final-title">{result.success ? 'Final Result (SUCCESS)' : 'Final Result (FAILED)'}</span>
                        <div className="run-details-actions">
                          <button type="button" className="modal-button" onClick={() => copyToClipboard(result.error ?? result.result)}>
                            Copy
                          </button>
                        </div>
                      </div>
                      {result.error ? (
                        <div className="run-details-error">{result.error}</div>
                      ) : (
                        <JsonViewer value={result.result} />
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

                  <div className="run-form-fields">
                    <div className="run-form-field">
                      <label className="run-form-label">
                        Execution folder
                        <span className="run-form-type">(workspace_root)</span>
                        <span className="run-form-required">required</span>
                      </label>

                      <div className="run-form-inline">
                        <input
                          type="text"
                          className="run-form-input"
                          value={workspaceRoot}
                          onChange={(e) => handleWorkspaceRootChange(e.target.value)}
                          placeholder={
                            workspaceRandom && !workspaceRoot.trim()
                              ? executionWorkspaceQuery.isLoading
                                ? 'Generating…'
                                : 'Will be generated on Run'
                              : 'Folder path…'
                          }
                          readOnly={workspaceRandom}
                          disabled={isRunning}
                        />

                        <label className="run-form-checkbox run-form-inline-checkbox">
                          <input
                            type="checkbox"
                            checked={workspaceRandom}
                            onChange={(e) => handleWorkspaceRandomChange(e.target.checked)}
                            disabled={isRunning}
                          />
                          <span>Random</span>
                          <span
                            className="run-form-tooltip"
                            title="When enabled, a new folder is generated for the next execution to keep runs isolated. Uncheck to run in a specific folder."
                            aria-label="Execution folder randomization help"
                          >
                            i
                          </span>
                        </label>
                      </div>

                      {executionWorkspaceQuery.isError ? (
                        <p className="run-form-note">Could not fetch defaults; the server will generate a folder on Run.</p>
                      ) : null}
                    </div>

                    <div className="run-form-field">
                      <label className="run-form-label">
                        Filesystem access
                        <span className="run-form-type">(workspace_access_mode)</span>
                      </label>
                      <AfSelect
                        value={workspaceAccessMode}
                        placeholder="workspace_only"
                        options={[
                          { value: 'workspace_only', label: 'workspace_only (restrict to workspace_root)' },
                          { value: 'all_except_ignored', label: 'all_except_ignored (allow absolute paths outside workspace_root)' },
                        ]}
                        searchable={false}
                        disabled={isRunning}
                        onChange={(v) =>
                          setWorkspaceAccessMode(v === 'all_except_ignored' ? 'all_except_ignored' : 'workspace_only')
                        }
                      />
                      <p className="run-form-note">
                        Relative paths still resolve under <code>workspace_root</code>. This only affects absolute paths.
                      </p>
                    </div>

                    <div className="run-form-field">
                      <label className="run-form-label">
                        Ignored folders (denylist)
                        <span className="run-form-type">(workspace_ignored_paths)</span>
                      </label>
                      <textarea
                        className="run-form-input run-form-textarea"
                        value={workspaceIgnoredPathsText}
                        onChange={(e) => setWorkspaceIgnoredPathsText(e.target.value)}
                        placeholder={'.git\nnode_modules\n.venv\n~/Library\n/Users/albou/.ssh'}
                        rows={5}
                        disabled={isRunning}
                      />
                      <p className="run-form-note">
                        One path per line. Relative entries are resolved under <code>workspace_root</code>.
                      </p>
                    </div>

                    {formInputPins.length === 0 ? (
                      <p className="run-form-note">
                        This flow has no input parameters. Click Run to execute.
                      </p>
                    ) : null}

                    {formInputPins.map(pin => {
                      const inputType = getInputTypeForPin(pin.type);
                      const value = formValues[pin.id] || '';

                      if (pin.type === 'provider' || pin.id === 'provider') {
                        return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>
                            <AfSelect
                              value={value}
                              placeholder={providersQuery.isLoading ? 'Loading…' : 'Select…'}
                              options={providers.map((p) => ({ value: p.name, label: p.display_name || p.name }))}
                              disabled={providersQuery.isLoading}
                              loading={providersQuery.isLoading}
                              searchable
                              searchPlaceholder="Search providers…"
                              onChange={(v) => handleFieldChange(pin.id, v)}
                            />
                          </div>
                        );
                      }

	                      if (pin.type === 'model' || pin.id === 'model') {
	                        return (
	                          <div key={pin.id} className="run-form-field">
	                            <label className="run-form-label">
	                              {pin.label}
	                              <span className="run-form-type">({pin.type})</span>
	                            </label>
	                            <AfSelect
	                              value={value}
	                              placeholder={
	                                !selectedProvider ? 'Pick provider…' : modelsQuery.isLoading ? 'Loading…' : 'Select…'
	                              }
	                              options={models.map((m) => ({ value: m, label: m }))}
	                              disabled={!selectedProvider}
	                              loading={modelsQuery.isLoading}
	                              allowCustom
	                              searchable
	                              searchPlaceholder="Search models…"
	                              onChange={(v) => handleFieldChange(pin.id, v)}
	                            />
	                          </div>
                        );
                      }

                      if (pin.type === 'tools') {
                        const values = Array.isArray(toolsValues[pin.id]) ? toolsValues[pin.id] : [];
                        return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>
                            <AfMultiSelect
                              values={values}
                              placeholder={toolsQuery.isLoading ? 'Loading…' : 'Select…'}
                              options={toolOptions}
                              disabled={isRunning || toolsQuery.isLoading}
                              loading={toolsQuery.isLoading}
                              searchable
                              searchPlaceholder="Search tools…"
                              clearable
                              minPopoverWidth={340}
                              onChange={(next) => setToolsValues((prev) => ({ ...prev, [pin.id]: next }))}
                            />
                          </div>
                        );
                      }

                      if (pin.id === 'scope') {
                        const options = memoryScopeOptions.map((v) => ({ value: v, label: v }));
                        return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>
                            <AfSelect
                              value={value}
                              placeholder="run"
                              options={options}
                              searchable={false}
                              disabled={isRunning}
                              onChange={(v) => handleFieldChange(pin.id, v || 'run')}
                            />
                          </div>
                        );
                      }

                      if (pin.id === 'recall_level') {
                        const options = RECALL_LEVEL_OPTIONS.map((v) => ({ value: v, label: v }));
                        return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>
                            <AfSelect
                              value={value}
                              placeholder="standard"
                              options={options}
                              searchable={false}
                              disabled={isRunning}
                              onChange={(v) => handleFieldChange(pin.id, v || 'standard')}
                            />
                          </div>
                        );
                      }

                      if (pin.type === 'array') {
                        return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>
                            <ArrayParamEditor
                              value={value}
                              disabled={isRunning}
                              onChange={(next) => handleFieldChange(pin.id, next)}
                            />
                          </div>
                        );
                      }

                      return (
                          <div key={pin.id} className="run-form-field">
                            <label className="run-form-label">
                              {pin.label}
                              <span className="run-form-type">({pin.type})</span>
                            </label>

                            {inputType === 'textarea' ? (
                              <textarea
                                className="run-form-input"
                                value={value}
                                onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                                placeholder={getPlaceholderForPin(pin)}
                                rows={pin.type === 'string' ? 3 : 5}
                                disabled={isRunning}
                              />
                            ) : inputType === 'checkbox' ? (
                              <label className="run-form-checkbox">
                                <input
                                  type="checkbox"
                                  checked={value === 'true'}
                                  onChange={(e) => handleFieldChange(pin.id, e.target.checked ? 'true' : 'false')}
                                  disabled={isRunning}
                                />
                                <span>{pin.label}</span>
                              </label>
                            ) : (
                              <input
                                type={inputType}
                                className="run-form-input"
                                value={value}
                                onChange={(e) => handleFieldChange(pin.id, e.target.value)}
                                placeholder={getPlaceholderForPin(pin)}
                                disabled={isRunning}
                              />
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ) : (
                <p className="run-form-note">
                  No nodes in this flow. Add an entry node to run.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-actions run-modal-footer">
          {onCancelRun && (
            <button
              className="modal-button cancel"
              onClick={onCancelRun}
              disabled={!(isRunning || isPaused || isWaiting)}
            >
              Cancel Run
            </button>
          )}

          {(onPause || onResumeRun) && (
            <button
              className={isPaused ? 'modal-button primary' : 'modal-button cancel'}
              onClick={() => {
                if (isPaused) onResumeRun?.();
                else onPause?.();
              }}
              disabled={isPaused ? !isPaused : !(isRunning && !isWaiting)}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          )}

          <button
            className="modal-button cancel"
            onClick={onClose}
          >
            {(isRunning || isPaused || isWaiting) ? 'Hide' : (hasRunData || result ? 'Close' : 'Cancel')}
          </button>

          {!hasRunData && !result && (
            <button
              className="modal-button primary"
              onClick={handleSubmit}
              disabled={
                isRunning || !entryNode || (!workspaceRoot.trim() && !(workspaceRandom && executionWorkspaceQuery.isError))
              }
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
          )}

          {(hasRunData || result) && (
            <button
              className="modal-button primary"
              onClick={() => {
                if (workspaceRandom) {
                  const next = createRandomWorkspaceRoot();
                  if (next) setWorkspaceRoot(next);
                }
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
