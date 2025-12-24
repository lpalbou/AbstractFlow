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
    waiting?: {
      prompt: string;
      choices: string[];
      allowFreeText: boolean;
      waitKey?: string;
      reason?: string;
    };
  };

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
      if (!text) return '';
      if (text.length <= 120) return text;
      return text.slice(0, 120) + '…';
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
        const meta = nodeMeta(ev.nodeId);
        const step: Step = {
          id: `node_start:${ev.nodeId || 'unknown'}:${i}`,
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
          };
          openByNode.delete(nodeId!);
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
          status: 'waiting',
          nodeId,
          nodeLabel: meta?.label,
          nodeType: meta?.type,
          nodeIcon: meta?.icon,
          nodeColor: meta?.color,
          waiting,
        });
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
      const preview = content ? (content.length <= 140 ? content : content.slice(0, 140) + '…') : '';

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
          preview = text.length <= 140 ? text : text.slice(0, 140) + '…';
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
      const preview = text ? (text.length <= 140 ? text : text.slice(0, 140) + '…') : '';
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
                            {s.provider ? <span className="run-metric-badge metric-provider">{s.provider}</span> : null}
                            {s.model ? <span className="run-metric-badge metric-model">{s.model}</span> : null}
                            {s.nodeId ? <span className="run-step-id">{s.nodeId}</span> : null}
                            {s.status === 'completed' && s.metrics ? (
                              <span className="run-step-metrics">
                                {s.metrics.duration_ms != null ? (
                                  <span className="run-metric-badge metric-duration">{formatDuration(s.metrics.duration_ms)}</span>
                                ) : null}
                                {formatTokenBadge(s.metrics) ? (
                                  <span className="run-metric-badge metric-tokens">{formatTokenBadge(s.metrics)}</span>
                                ) : null}
                                {formatTpsBadge(s.metrics) ? (
                                  <span className="run-metric-badge metric-throughput">{formatTpsBadge(s.metrics)}</span>
                                ) : null}
                              </span>
                            ) : null}
                            <span className={`run-step-status ${s.status}`}>
                              {s.status === 'running' ? <span className="run-spinner" aria-label="running" /> : null}
                              {statusLabel}
                            </span>
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
                    <div className="run-working">
                      <span className="run-spinner" aria-label="working" />
                      <div>
                        <div className="run-working-title">Working…</div>
                        <div className="run-working-note">This node is still processing. The output will appear when it completes.</div>
                      </div>
                    </div>
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
                        <button type="button" className="modal-button" onClick={() => copyToClipboard(outputPreview?.cleaned ?? selectedStep.output)}>
                          Copy raw
                        </button>
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

                      {outputPreview ? (
                        <div className="run-output-preview">
                          {outputPreview.task ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Task</div>
                              <pre className="run-details-output">{outputPreview.task}</pre>
                            </div>
                          ) : null}

                          {(outputPreview.provider || outputPreview.model || outputPreview.usage) ? (
                            <div className="run-output-section">
                              <div className="run-output-title">Meta</div>
                              <div className="run-output-meta">
                                {(outputPreview.provider || outputPreview.model) ? (
                                  <div>
                                    <span className="run-output-meta-key">Model</span>
                                    <span className="run-output-meta-val">
                                      <span className="run-output-meta-badges">
                                        {outputPreview.provider ? (
                                          <span className="run-metric-badge metric-provider">{outputPreview.provider}</span>
                                        ) : null}
                                        {outputPreview.model ? (
                                          <span className="run-metric-badge metric-model">{outputPreview.model}</span>
                                        ) : null}
                                      </span>
                                    </span>
                                  </div>
                                ) : null}
                                {outputPreview.usage ? (
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

                          {outputPreview.previewText ? (
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

                          {traceSteps ? (
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
                                <pre className="run-details-output">{formatValue(outputPreview.scratchpad)}</pre>
                              </details>
                            </div>
                          ) : outputPreview.scratchpad != null ? (
                            <details className="run-raw-details">
                              <summary>Scratchpad</summary>
                              <pre className="run-details-output">{formatValue(outputPreview.scratchpad)}</pre>
                            </details>
                          ) : null}
                        </div>
                      ) : null}

                      <details className="run-raw-details" open={!outputPreview}>
                        <summary>Raw JSON</summary>
                        <pre className="run-details-output">{formatValue(outputPreview?.cleaned ?? selectedStep.output)}</pre>
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
                              rows={pin.type === 'string' ? 4 : 5}
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
