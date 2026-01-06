/**
 * Smart Run Flow Modal
 *
 * Auto-generates form fields based on the entry node's output pins.
 * Shows execution progress and results.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useFlowStore } from '../hooks/useFlow';
import type { ExecutionEvent, ExecutionMetrics, Pin, FlowRunResult } from '../types/flow';
import { isEntryNodeType } from '../types/flow';
import type { WaitingInfo } from '../hooks/useWebSocket';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AgentSubrunTracePanel } from './AgentSubrunTracePanel';
import AfSelect from './inputs/AfSelect';
import AfMultiSelect from './inputs/AfMultiSelect';
import { useProviders, useModels } from '../hooks/useProviders';
import { useTools } from '../hooks/useTools';
import { RunSwitcherDropdown } from './RunSwitcherDropdown';
import { JsonCodeBlock } from './JsonCodeBlock';

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
}: RunFlowModalProps) {
  const { nodes, edges, flowName, flowId, lastLoopProgress } = useFlowStore();

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
  const [toolsValues, setToolsValues] = useState<Record<string, string[]>>({});
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [resumeDraft, setResumeDraft] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [rehydrateArtifactMarkdown, setRehydrateArtifactMarkdown] = useState<string | null>(null);
  const [rehydrateArtifactError, setRehydrateArtifactError] = useState<string | null>(null);
  const [rehydrateArtifactLoading, setRehydrateArtifactLoading] = useState(false);

  const providerPinId = useMemo(() => {
    const pin = inputPins.find((p) => p.type === 'provider' || p.id === 'provider');
    return pin?.id || null;
  }, [inputPins]);

  const selectedProvider = useMemo(() => {
    return providerPinId ? (formValues[providerPinId] || '') : '';
  }, [formValues, providerPinId]);

  const wantProviderDropdown = Boolean(isOpen && inputPins.some((p) => p.type === 'provider' || p.id === 'provider'));
  const wantModelDropdown = Boolean(isOpen && inputPins.some((p) => p.type === 'model' || p.id === 'model'));
  const providersQuery = useProviders(wantProviderDropdown);
  const modelsQuery = useModels(selectedProvider || undefined, wantModelDropdown);
  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];

  const wantToolsDropdown = Boolean(isOpen && inputPins.some((p) => p.type === 'tools'));
  const toolsQuery = useTools(wantToolsDropdown);
  const toolSpecs = Array.isArray(toolsQuery.data) ? toolsQuery.data : [];
  const toolOptions = useMemo(() => {
    const out = toolSpecs
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({ value: t.name.trim(), label: t.name.trim() }));
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [toolSpecs]);

  // When the modal is opened, start expanded (predictable UX).
  useEffect(() => {
    if (isOpen) setIsMinimized(false);
  }, [isOpen]);

  // Initialize form values when modal opens
  useEffect(() => {
    if (isOpen && inputPins.length > 0) {
      const initialValues: Record<string, string> = {};
      const initialTools: Record<string, string[]> = {};
      const defaults =
        entryNode && entryNode.data && typeof (entryNode.data as any).pinDefaults === 'object'
          ? ((entryNode.data as any).pinDefaults as Record<string, unknown>)
          : null;
      inputPins.forEach(pin => {
        if (pin.type === 'tools') {
          initialTools[pin.id] = [];
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
        // Fallback: preserve existing behavior (empty).
        initialValues[pin.id] = '';
      });
      setFormValues(initialValues);
      setToolsValues(initialTools);
    }
  }, [isOpen, inputPins, entryNode]);

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
  }, [formValues, inputPins, onRun, toolsValues]);

  type StepStatus = 'running' | 'completed' | 'waiting' | 'failed';
  type Step = {
    id: string;
    status: StepStatus;
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

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    const openByNode = new Map<string, number>();

    const rootRunId = (() => {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.type === 'flow_start' && ev.runId) return ev.runId;
      }
      return null;
    })();

    const safeString = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

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

      // Hide internal/sub-run node events from the main (visual) timeline.
      // These will be rendered in the Agent details panel instead.
      if (
        rootRunId &&
        ev.runId &&
        ev.runId !== rootRunId &&
        (ev.type === 'node_start' || ev.type === 'node_complete' || ev.type === 'flow_waiting')
      ) {
        continue;
      }

      if (ev.type === 'node_start') {
        const key = `${ev.runId || ''}:${ev.nodeId || ''}`;
        const meta = nodeMeta(ev.nodeId);
        const step: Step = {
          id: `node_start:${ev.nodeId || 'unknown'}:${i}`,
          status: 'running',
          nodeId: ev.nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          startedAt: typeof ev.ts === 'string' ? ev.ts : undefined,
        };
        out.push(step);
        if (ev.nodeId) openByNode.set(key, out.length - 1);
        continue;
      }

      if (ev.type === 'node_complete') {
        const nodeId = ev.nodeId;
        const key = `${ev.runId || ''}:${nodeId || ''}`;
        const idx = nodeId ? openByNode.get(key) : undefined;
        const mi = extractModelInfo(ev.result);
        if (typeof idx === 'number') {
          out[idx] = {
            ...out[idx],
            status: 'completed',
            output: ev.result,
            summary: summarize(ev.result),
            metrics: ev.meta,
            provider: mi.provider,
            model: mi.model,
            endedAt: typeof ev.ts === 'string' ? ev.ts : out[idx].endedAt,
          };
          openByNode.delete(key);
          continue;
        }
        const meta = nodeMeta(nodeId);
        out.push({
          id: `node_complete:${nodeId || 'unknown'}:${i}`,
          status: 'completed',
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
          out[idx] = { ...out[idx], status: 'waiting', waiting };
          continue;
        }

        const meta = nodeMeta(nodeId);
        out.push({
          id: `flow_waiting:${nodeId || 'unknown'}:${i}`,
          status: 'waiting',
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          waiting,
        });
        if (nodeId) openByNode.set(key, out.length - 1);
        continue;
      }

      if (ev.type === 'flow_error') {
        const nodeId = ev.nodeId;
        const idx = nodeId ? openByNode.get(nodeId) : undefined;
        if (typeof idx === 'number') {
          out[idx] = { ...out[idx], status: 'failed', error: ev.error || 'Unknown error' };
          openByNode.delete(nodeId!);
          continue;
        }
        // Best-effort: attach to the most recent step if we can't map to a node.
        if (out.length > 0) {
          const lastIdx = out.length - 1;
          out[lastIdx] = { ...out[lastIdx], status: 'failed', error: ev.error || 'Unknown error' };
        }
      }
    }

    return out;
  }, [events, nodeById]);

  const rootRunId = useMemo<string | null>(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === 'flow_start' && ev.runId) return ev.runId;
    }
    return null;
  }, [events]);

  const flowSummary = useMemo<ExecutionMetrics | null>(() => {
    if (!events || events.length === 0) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === 'flow_complete' && ev.meta) return ev.meta;
    }
    return null;
  }, [events]);

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

  const selectedStep = useMemo(() => steps.find((s) => s.id === selectedStepId) || null, [steps, selectedStepId]);

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
          ⬆
        </button>
      </div>
    </div>
  );

  const shouldRenderMarkdown = useCallback(
    (nodeType?: string | null) => {
      if (!nodeType) return false;
      return nodeType === 'ask_user' || nodeType === 'answer_user' || nodeType === 'llm_call' || nodeType === 'agent';
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

    let cleaned: unknown = value;
    if (obj && typeof obj === 'object') {
      const copy = { ...obj };
      delete (copy as Record<string, unknown>)._pending_effect;
      cleaned = copy;
    }

    if (!task && !previewText && scratchpad == null && !provider && !model && !usage) return null;
    return { task, previewText, scratchpad, provider, model, usage, raw: value, cleaned };
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
      if (k === 'request') return 0;
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
      <div className="modal run-modal" onClick={(e) => e.stopPropagation()}>
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
              ▾
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
                </div>
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
                      s.status === 'running' ? 'RUNNING' : s.status === 'completed' ? 'OK' : s.status === 'waiting' ? 'WAITING' : 'FAILED';
                    const startedAtLabel = formatStepTime(s.startedAt);
                    const durationLabel =
                      s.status === 'completed' && s.metrics && s.metrics.duration_ms != null
                        ? formatDuration(s.metrics.duration_ms)
                        : '';

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
                            <div className="run-step-left">
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
                    );
                  })
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

                      {(outputPreview || memorizeContentPreview || recallIntoContextDisplay || (selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams)) ? (
                        <div className="run-output-preview">
                          {selectedStep?.nodeType === 'on_flow_start' && onFlowStartParams ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Run parameters</div>
                              <div className="run-param-grid">
                                {onFlowStartParams.map(([k, v]) => {
                                  const isProvider = k === 'provider' && typeof v === 'string' && v.trim();
                                  const isModel = k === 'model' && typeof v === 'string' && v.trim();
                                  const isRequest = k === 'request' && typeof v === 'string' && v.trim();

                                  return (
                                    <div key={k} className="run-param-row">
                                      <div className="run-param-key">{k}</div>
                                      <div className="run-param-val">
                                        {isProvider ? (
                                          <span className="run-metric-badge metric-provider">{String(v).trim()}</span>
                                        ) : isModel ? (
                                          <span className="run-metric-badge metric-model">{String(v).trim()}</span>
                                        ) : typeof v === 'boolean' ? (
                                          <span className="run-metric-badge metric-bool">{v ? 'true' : 'false'}</span>
                                        ) : typeof v === 'number' ? (
                                          <span className="run-metric-badge metric-number">{String(v)}</span>
                                        ) : isRequest ? (
                                          <div className="run-details-markdown run-param-markdown">
                                            <MarkdownRenderer markdown={String(v).trim()} />
                                          </div>
                                        ) : typeof v === 'string' ? (
                                          <span className="run-param-text">{v}</span>
                                        ) : (
                                          <pre className="run-details-output run-param-json">{formatValue(v)}</pre>
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
                                    <span className="run-output-meta-val">
                                      {usageBadges.length ? (
                                        <span className="run-output-meta-badges">
                                          {usageBadges.map((b) => (
                                            <span key={b.label} className="run-metric-badge metric-tokens">
                                              {b.label}: {b.value}
                                            </span>
                                          ))}
                                        </span>
                                      ) : (
                                        formatValue(outputPreview.usage)
                                      )}
                                    </span>
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
                                <JsonCodeBlock value={outputPreview?.scratchpad} className="run-details-output" />
                              </details>
                            </div>
                          ) : selectedStep?.nodeType !== 'agent' && outputPreview?.scratchpad != null ? (
                            <details className="run-raw-details">
                              <summary>Scratchpad</summary>
                              <JsonCodeBlock value={outputPreview?.scratchpad} className="run-details-output" />
                            </details>
                          ) : null}
                        </div>
                      ) : null}

                      <details className="run-raw-details" open={!outputPreview}>
                        <summary>Raw JSON</summary>
                        <JsonCodeBlock value={selectedStep.output} className="run-details-output" />
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
                              disabled={!selectedProvider || modelsQuery.isLoading}
                              loading={modelsQuery.isLoading}
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
                  )}
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
