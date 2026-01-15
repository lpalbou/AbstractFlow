import { useMemo, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';
import { JsonViewer } from './JsonViewer';

type TabId = 'system' | 'user' | 'tools' | 'response' | 'reasoning' | 'errors' | 'raw';
type TabSpec = { id: TabId; label: string; hidden?: boolean };

type TraceStep = Record<string, unknown>;

type TraceItem = {
  id: string;
  runId: string;
  nodeId: string;
  ts?: string;
  status: string;
  step: TraceStep;
};

type ToolResult = {
  call_id?: string;
  name: string;
  success: boolean;
  output?: unknown;
  error?: unknown;
};

type ToolCall = {
  call_id?: string;
  name: string;
  args: Record<string, unknown>;
};

interface AgentSubrunTracePanelProps {
  rootRunId: string | null;
  events: ExecutionEvent[];
  subRunId?: string | null;
  title?: string;
  subtitle?: string;
  onOpenSubRun?: () => void;
}

async function copyText(text: string): Promise<void> {
  const value = String(text || '');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function safeString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function clampInline(text: string, maxLen: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function effectOf(step: TraceStep): Record<string, unknown> | null {
  const e = step.effect;
  if (!e || typeof e !== 'object') return null;
  return e as Record<string, unknown>;
}

function effectTypeOf(step: TraceStep): string {
  const effect = effectOf(step);
  const t = effect && typeof effect.type === 'string' ? effect.type : '';
  return t || 'effect';
}

function payloadOf(step: TraceStep): Record<string, unknown> | null {
  const effect = effectOf(step);
  const p = effect?.payload;
  if (!p || typeof p !== 'object') return null;
  return p as Record<string, unknown>;
}

function resultOf(step: TraceStep): Record<string, unknown> | null {
  const r = step.result;
  if (!r || typeof r !== 'object') return null;
  return r as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toolResultsForStep(step: TraceStep): ToolResult[] {
  const t = effectTypeOf(step);
  if (t !== 'tool_calls') return [];
  const res = resultOf(step);
  const raw = res && Array.isArray(res.results) ? res.results : null;
  if (!raw) return [];
  const out: ToolResult[] = [];
  for (const r of raw) {
    const ro = asRecord(r);
    if (!ro) continue;
    const name = typeof ro.name === 'string' ? ro.name.trim() : '';
    if (!name) continue;
    out.push({
      call_id: typeof ro.call_id === 'string' ? ro.call_id : typeof ro.callId === 'string' ? ro.callId : undefined,
      name,
      success: ro.success === true,
      output: ro.output,
      error: ro.error,
    });
  }
  return out;
}

function reasoningTextOfResult(res: Record<string, unknown> | null): string {
  const direct = res?.reasoning;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const raw =
    asRecord(res?.raw_response) ||
    asRecord(res?.raw) ||
    asRecord((res as any)?.rawResponse) ||
    null;

  const fromMessage = (msg: unknown): string => {
    const mo = asRecord(msg);
    if (!mo) return '';
    const candidates = [
      mo.reasoning,
      (mo as any).reasoning_content,
      (mo as any).thinking,
      (mo as any).thinking_content,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return '';
  };

  if (raw) {
    const choices = Array.isArray(raw.choices) ? raw.choices : null;
    if (choices) {
      for (const c of choices) {
        const co = asRecord(c);
        const r = fromMessage(co?.message);
        if (r) return r;
        const r2 = fromMessage(co?.delta);
        if (r2) return r2;
      }
    }
    const top = fromMessage(raw.message);
    if (top) return top;
  }

  return '';
}

function tokenBadgesForStep(step: TraceStep): Array<{ label: string; value: number }> {
  const t = effectTypeOf(step);
  if (t !== 'llm_call') return [];

  const res = resultOf(step);
  const raw = asRecord(res?.raw);
  const usage = asRecord(res?.usage) || asRecord(raw?.usage) || asRecord(raw?.usage_metadata);

  const inTokens = asNumber(usage?.input_tokens) ?? asNumber(usage?.prompt_tokens) ?? asNumber(res?.input_tokens) ?? asNumber(res?.prompt_tokens);
  const outTokens =
    asNumber(usage?.output_tokens) ?? asNumber(usage?.completion_tokens) ?? asNumber(res?.output_tokens) ?? asNumber(res?.completion_tokens);
  const totalTokens = asNumber(usage?.total_tokens) ?? asNumber(res?.total_tokens);

  const out: Array<{ label: string; value: number }> = [];
  if (inTokens != null) out.push({ label: 'in', value: inTokens });
  if (outTokens != null) out.push({ label: 'out', value: outTokens });
  if (totalTokens != null) out.push({ label: 'total', value: totalTokens });
  return out;
}

function toolNamesForStep(step: TraceStep): string[] {
  const t = effectTypeOf(step);
  if (t !== 'tool_calls') return [];
  const payload = payloadOf(step);
  const candidates =
    (Array.isArray(payload?.tool_calls) ? payload?.tool_calls : null) ||
    (Array.isArray(payload?.tool_calls_raw) ? payload?.tool_calls_raw : null) ||
    (Array.isArray(payload?.calls) ? payload?.calls : null) ||
    null;
  if (!candidates) return [];

  const names: string[] = [];
  for (const c of candidates) {
    const co = asRecord(c);
    const name = co && typeof co.name === 'string' ? co.name.trim() : '';
    if (name) names.push(name);
  }

  return Array.from(new Set(names));
}

function toolCallsForStep(step: TraceStep): ToolCall[] {
  const t = effectTypeOf(step);
  if (t !== 'tool_calls') return [];
  const payload = payloadOf(step);
  const calls =
    (Array.isArray(payload?.tool_calls) ? payload?.tool_calls : null) ||
    (Array.isArray(payload?.tool_calls_raw) ? payload?.tool_calls_raw : null) ||
    (Array.isArray(payload?.calls) ? payload?.calls : null) ||
    null;
  if (!calls) return [];

  const out: ToolCall[] = [];
  for (const c of calls) {
    const co = asRecord(c);
    if (!co) continue;
    const name = typeof co.name === 'string' ? co.name.trim() : '';
    if (!name) continue;
    const args = (asRecord(co.arguments) ?? {}) as Record<string, unknown>;
    out.push({
      call_id: typeof co.call_id === 'string' ? co.call_id : typeof co.callId === 'string' ? co.callId : undefined,
      name,
      args,
    });
  }
  return out;
}

function toolDefsFromThinkStep(step: TraceStep): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (effectTypeOf(step) !== 'llm_call') return out;
  const payload = payloadOf(step);
  const tools = Array.isArray(payload?.tools) ? payload?.tools : null;
  if (!tools) return out;

  for (const t of tools) {
    const to = asRecord(t);
    const name = typeof to?.name === 'string' ? to.name.trim() : '';
    if (!name) continue;

    const requiredArgs = Array.isArray(to?.required_args) ? to?.required_args : Array.isArray((to as any)?.requiredArgs) ? (to as any).requiredArgs : null;
    const required = (requiredArgs || []).filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0);

    const params = asRecord(to?.parameters);
    const paramKeys = params ? Object.keys(params) : [];

    const order: string[] = [];
    for (const r of required) {
      if (!order.includes(r)) order.push(r);
    }
    for (const k of paramKeys) {
      if (!order.includes(k)) order.push(k);
    }

    out.set(name, order);
  }

  return out;
}

function formatToolSignature(toolName: string, args: Record<string, unknown>, paramOrder: string[] | null): string {
  const order = Array.isArray(paramOrder) && paramOrder.length ? paramOrder : Object.keys(args || {});
  const primaryKey = order.length ? order[0] : '';
  const primaryValue = primaryKey ? (args || {})[primaryKey] : undefined;
  const rendered =
    primaryKey && primaryValue !== undefined
      ? typeof primaryValue === 'string'
        ? JSON.stringify(primaryValue)
        : Array.isArray(primaryValue) || (primaryValue && typeof primaryValue === 'object')
          ? JSON.stringify(primaryValue)
          : String(primaryValue)
      : '';
  const inside = rendered ? clampInline(rendered, 90) : '…';
  return `${toolName}(${inside})`;
}

function errorTextOf(step: TraceStep): string {
  const direct = step.error;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const effectType = effectTypeOf(step);
  if (effectType === 'llm_call') {
    const res = resultOf(step);
    const finish =
      (typeof res?.finish_reason === 'string' ? res.finish_reason : '') ||
      (typeof (res as any)?.finishReason === 'string' ? (res as any).finishReason : '');
    const toolCalls = Array.isArray(res?.tool_calls) ? res.tool_calls : null;
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
    const content = typeof res?.content === 'string' ? res.content.trim() : '';
    const reasoning = reasoningTextOfResult(res);
    if (finish === 'length' && !hasToolCalls && !content && !reasoning) {
      return 'LLM output was truncated (finish_reason=length) and no tool calls were parsed.';
    }
    if (finish === 'length' && !hasToolCalls) {
      return 'LLM output was truncated (finish_reason=length).';
    }
  }

  const res = resultOf(step);
  const results = res && Array.isArray(res.results) ? res.results : null;
  if (!results) return '';
  const failed = results
    .map((r) => asRecord(r))
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .filter((r) => r.success === false);
  if (!failed.length) return '';
  return failed
    .map((r) => (typeof r.error === 'string' && r.error.trim() ? r.error.trim() : 'tool_failed'))
    .join('\n');
}

function titleForStep(step: TraceStep): string {
  const t = effectTypeOf(step);
  return t.toUpperCase();
}

function previewForStep(step: TraceStep): string {
  const t = effectTypeOf(step);
  const payload = payloadOf(step);
  const res = resultOf(step);

  const clamp = (s: string, maxLen: number) => {
    const text = s.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  };

  if (t === 'llm_call') {
    const content = res?.content;
    const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
    const reasoning = reasoningTextOfResult(res);
    const toolCalls = Array.isArray(res?.tool_calls) ? res?.tool_calls : null;
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
    // Prefer reasoning for tool-using turns; prefer response for the final turn.
    const preferred = hasToolCalls ? reasoning || text : text || reasoning;
    return clamp(preferred, 220);
  }

  if (t === 'tool_calls') {
    const results = res && Array.isArray(res.results) ? res.results : null;
    if (!results) return '';
    const failed = results.filter((r) => asRecord(r)?.success === false);
    if (failed.length > 0) return `${failed.length} tool call(s) failed`;
    return `${results.length} tool call(s) executed`;
  }

  if (t === 'ask_user') {
    const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    return prompt;
  }

  return '';
}

type AgentCycle = {
  id: string;
  index: number;
  items: TraceItem[];
  think: TraceItem | null;
  acts: TraceItem[];
  others: TraceItem[];
  status: string;
  ts?: string;
};

function effectiveStatusForItem(item: TraceItem): string {
  const status = typeof item.status === 'string' ? item.status : 'unknown';
  if (status === 'failed') return 'failed';
  const errs = errorTextOf(item.step);
  if (errs) return 'failed';
  return status;
}

function combineStatus(items: TraceItem[]): string {
  const statuses = items.map((i) => effectiveStatusForItem(i));
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'waiting')) return 'waiting';
  if (statuses.some((s) => s === 'running')) return 'running';
  return 'completed';
}

function visibleTabs(tabs: TabSpec[]): TabSpec[] {
  return tabs.filter((t) => !t.hidden);
}

function tabsForStep(step: TraceStep): TabSpec[] {
  const t = effectTypeOf(step);
  const errs = errorTextOf(step);
  if (t === 'llm_call') {
    return visibleTabs([
      { id: 'system', label: 'System' },
      { id: 'user', label: 'User' },
      { id: 'tools', label: 'Tools' },
      { id: 'response', label: 'Response' },
      { id: 'reasoning', label: 'Reasoning' },
      { id: 'errors', label: 'Errors', hidden: !errs },
      { id: 'raw', label: 'Raw' },
    ]);
  }
  if (t === 'tool_calls') {
    return visibleTabs([
      { id: 'tools', label: 'Tools' },
      { id: 'errors', label: 'Errors', hidden: !errs },
      { id: 'raw', label: 'Raw' },
    ]);
  }
  return visibleTabs([
    { id: 'errors', label: 'Errors', hidden: !errs },
    { id: 'raw', label: 'Raw' },
  ]);
}

function defaultTabForStep(step: TraceStep): TabId {
  const t = effectTypeOf(step);
  if (t === 'llm_call') return 'user';
  if (t === 'tool_calls') return 'tools';
  return 'raw';
}

function renderSystem(step: TraceStep): string {
  const payload = payloadOf(step);
  const sys = payload?.system_prompt;
  if (typeof sys === 'string' && sys.trim()) return sys;
  return '';
}

function renderUser(step: TraceStep): string {
  const payload = payloadOf(step);
  const prompt = payload?.prompt;
  if (typeof prompt === 'string' && prompt.trim()) return prompt;
  const messages = payload?.messages;
  if (!Array.isArray(messages)) return '';
  const chunks: string[] = [];
  for (const m of messages) {
    const mo = asRecord(m);
    if (!mo) continue;
    if (safeString(mo.role) !== 'user') continue;
    const content = mo.content;
    if (typeof content === 'string' && content.trim()) chunks.push(content);
  }
  return chunks.join('\n\n---\n\n');
}

function renderTools(step: TraceStep): unknown {
  const t = effectTypeOf(step);
  if (t === 'tool_calls') {
    const payload = payloadOf(step);
    return payload?.tool_calls ?? payload?.tool_calls_raw ?? payload?.calls ?? payload ?? null;
  }
  // For llm_call, show the *available tools* config (if present).
  const payload = payloadOf(step);
  return payload?.tools ?? null;
}

function renderResponse(step: TraceStep): string {
  const res = resultOf(step);
  const content = typeof res?.content === 'string' ? res.content : '';
  return content && content.trim() ? content : '';
}

function renderReasoning(step: TraceStep): string {
  const res = resultOf(step);
  const reasoning = reasoningTextOfResult(res);
  return reasoning && reasoning.trim() ? reasoning : '';
}

function PanelBody({ item }: { item: TraceItem }) {
  const step = item.step;
  const [tab, setTab] = useState<TabId>(() => defaultTabForStep(step));

  const tabs = tabsForStep(step);
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'raw';

  const errors = errorTextOf(step);
  const system = renderSystem(step);
  const user = renderUser(step);
  const tools = renderTools(step);
  const response = renderResponse(step);
  const reasoning = renderReasoning(step);

  const rawResponseValue = useMemo(() => {
    if (effectTypeOf(step) !== 'llm_call') return null;
    const res = resultOf(step);
    return (
      res?.raw_response ||
      res?.raw ||
      (res as any)?.rawResponse ||
      (res as any)?.raw_response ||
      null
    );
  }, [step]);

  const render = () => {
    if (active === 'system') return <pre className="run-details-output">{system || '(none)'}</pre>;
    if (active === 'user') return <pre className="run-details-output">{user || '(none)'}</pre>;
    if (active === 'tools')
      return tools ? <JsonViewer value={tools} /> : <div className="run-details-output">(none)</div>;
    if (active === 'response') return <pre className="run-details-output">{response || '(empty)'}</pre>;
    if (active === 'reasoning') return <pre className="run-details-output">{reasoning || '(none)'}</pre>;
    if (active === 'errors') return <pre className="run-details-output">{errors || '(none)'}</pre>;
    const rawValue = rawResponseValue ?? step;
    return <JsonViewer value={rawValue} />;
  };

  return (
    <div className="agent-trace-body">
      <div className="agent-trace-tabs" role="tablist" aria-label="Agent trace tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === active ? 'agent-trace-tab active' : 'agent-trace-tab'}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={t.id === active}
          >
            {t.label}
          </button>
        ))}
      </div>
      {render()}
    </div>
  );
}

function TraceStepCard({ item, label, toolDefs }: { item: TraceItem; label: string; toolDefs: Map<string, string[]> }) {
  const step = item.step;
  const statusRaw = effectiveStatusForItem(item);
  const statusLabel =
    statusRaw === 'completed' ? 'OK' : statusRaw === 'failed' ? 'ERROR' : statusRaw === 'waiting' ? 'WAITING' : statusRaw.toUpperCase();
  const statusIcon = statusRaw === 'completed' ? '✓' : statusRaw === 'failed' ? '✗' : '';
  const statusText = statusIcon ? `${statusIcon} ${statusLabel}` : statusLabel;
  const title = titleForStep(step);
  const preview = previewForStep(step);
  const tokenBadges = tokenBadgesForStep(step);
  const toolNames = toolNamesForStep(step);
  const toolCallSigs = useMemo(() => {
    if (effectTypeOf(step) !== 'tool_calls') return [];
    const calls = toolCallsForStep(step);
    return calls.map((c) => {
      const order = toolDefs.get(c.name) || null;
      return formatToolSignature(c.name, c.args, order);
    });
  }, [step, toolDefs]);

  return (
    <details className={`agent-trace-entry ${statusRaw}`} open={false}>
      <summary className="agent-trace-summary">
        <span className={`agent-trace-status ${statusRaw}`}>{statusText}</span>
        <span className="agent-cycle-stage">{label}</span>
        <span className="agent-trace-kind">{title}</span>
        {tokenBadges.length ? (
          <span className="agent-trace-badges">
            {tokenBadges.map((b) => (
              <span key={b.label} className="run-metric-badge metric-tokens">
                {b.label}: {b.value}
              </span>
            ))}
          </span>
        ) : null}
        {toolCallSigs.length ? (
          <span className="agent-trace-badges">
            {toolCallSigs.slice(0, 4).map((sig) => (
              <span key={sig} className="run-metric-badge metric-tool" title={sig}>
                {clampInline(sig, 56)}
              </span>
            ))}
            {toolCallSigs.length > 4 ? <span className="run-metric-badge metric-tool">+{toolCallSigs.length - 4}</span> : null}
          </span>
        ) : toolNames.length ? (
          <span className="agent-trace-badges">
            {toolNames.slice(0, 6).map((n) => (
              <span key={n} className="run-metric-badge metric-tool">
                {n}
              </span>
            ))}
            {toolNames.length > 6 ? <span className="run-metric-badge metric-tool">+{toolNames.length - 6}</span> : null}
          </span>
        ) : null}
      </summary>
      {preview ? <div className="agent-trace-preview">{preview}</div> : null}
      <PanelBody item={item} />
    </details>
  );
}

function ObserveCard({ acts }: { acts: TraceItem[] }) {
  const all = acts.flatMap((a) => toolResultsForStep(a.step));
  const ok = all.filter((r) => r.success).length;
  const failed = all.filter((r) => !r.success).length;
  const header = all.length ? `${ok} ok${failed ? ` · ${failed} failed` : ''}` : '(none)';
  const status = failed > 0 ? 'failed' : 'completed';
  const statusLabel = failed > 0 ? 'ERROR' : 'OK';

  return (
    <details className={`agent-trace-entry ${status}`} open={false}>
      <summary className="agent-trace-summary">
        <span className={`agent-trace-status ${status}`}>{statusLabel}</span>
        <span className="agent-cycle-stage">observe</span>
        <span className="agent-trace-kind">OBSERVATIONS</span>
        <span className="agent-trace-preview-inline">{header}</span>
      </summary>
      <div className="agent-observe-body">
        {all.length === 0 ? (
          <div className="agent-observe-empty">(no tool results)</div>
        ) : (
          <div className="agent-observe-results">
            {all.map((r, idx) => {
              const status = r.success ? 'completed' : 'failed';
              const badge = r.success ? 'OK' : 'ERROR';
              const output = r.success ? r.output : r.error ?? r.output;
              return (
                <details key={`${r.name}:${r.call_id || ''}:${idx}`} className={`agent-observe-result ${status}`} open={false}>
                  <summary className="agent-observe-summary">
                    <span className={`agent-trace-status ${status}`}>{badge}</span>
                    <span className="agent-observe-name">{r.name}</span>
                    {r.call_id ? <span className="agent-observe-callid">{r.call_id}</span> : null}
                  </summary>
                  {typeof output === 'string' ? (
                    <pre className="run-details-output">{output || '(none)'}</pre>
                  ) : (
                    <JsonViewer value={output} />
                  )}
                </details>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

export function AgentSubrunTracePanel({
  rootRunId,
  events,
  subRunId,
  title,
  subtitle,
  onOpenSubRun,
}: AgentSubrunTracePanelProps) {
  const items = useMemo<TraceItem[]>(() => {
    if (!rootRunId) return [];
    const out: TraceItem[] = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type !== 'trace_update') continue;
      if (!ev.runId || ev.runId === rootRunId) continue;
      if (subRunId && ev.runId !== subRunId) continue;
      const nodeId = ev.nodeId;
      if (!nodeId) continue;
      const steps = Array.isArray(ev.steps) ? ev.steps : [];
      for (let j = 0; j < steps.length; j++) {
        const st = steps[j];
        if (!st || typeof st !== 'object') continue;
        const step = st as Record<string, unknown>;
        const ts = typeof step.ts === 'string' ? step.ts : undefined;
        const status = typeof step.status === 'string' ? step.status : 'unknown';
        out.push({
          id: `trace:${ev.runId}:${nodeId}:${i}:${j}:${ts || ''}`,
          runId: ev.runId,
          nodeId,
          ts,
          status,
          step,
        });
      }
    }

    // Best-effort sort by trace timestamp (fallback to arrival order).
    out.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : NaN;
      const tb = b.ts ? new Date(b.ts).getTime() : NaN;
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      return 0;
    });

    return out;
  }, [events, rootRunId, subRunId]);

  const cycles = useMemo<AgentCycle[]>(() => {
    const out: AgentCycle[] = [];
    let current: AgentCycle | null = null;
    let idx = 0;

    for (const item of items) {
      const kind = effectTypeOf(item.step);
      if (kind === 'llm_call') {
        idx += 1;
        current = {
          id: `cycle:${item.runId}:${idx}:${item.ts || ''}`,
          index: idx,
          items: [item],
          think: item,
          acts: [],
          others: [],
          status: effectiveStatusForItem(item),
          ts: item.ts,
        };
        out.push(current);
        continue;
      }

      if (!current) {
        idx += 1;
        current = {
          id: `cycle:${item.runId}:${idx}:${item.ts || ''}`,
          index: idx,
          items: [],
          think: null,
          acts: [],
          others: [],
          status: effectiveStatusForItem(item),
          ts: item.ts,
        };
        out.push(current);
      }

      current.items.push(item);
      if (kind === 'tool_calls') current.acts.push(item);
      else current.others.push(item);
      current.status = combineStatus(current.items);
    }

    return out;
  }, [items]);

  if (!rootRunId) return null;

  const titleText = typeof title === 'string' && title.trim() ? title.trim() : 'Agent calls';
  const subtitleText =
    typeof subtitle === 'string' && subtitle.trim() ? subtitle.trim() : 'Live per-effect trace (LLM/tool calls).';

  return (
    <div className="agent-trace-panel">
      <div className="agent-trace-header">
        <div className="agent-trace-title">{titleText}</div>
        <div className="agent-trace-subtitle">
          {subtitleText}
          {subRunId ? (
            <span className="agent-trace-subrun">
              {' '}
              sub_run_id: {subRunId}
              <button
                type="button"
                className="agent-trace-copy"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyText(subRunId);
                }}
                title={`Copy sub_run_id: ${subRunId}`}
                aria-label="Copy sub run id"
              >
                ⧉
              </button>
              {onOpenSubRun ? (
                <button
                  type="button"
                  className="agent-trace-open"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSubRun();
                  }}
                  title="Open sub-run"
                >
                  Open
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="agent-trace-empty">No trace entries yet.</div>
      ) : (
        <div className="agent-cycle-list">
          <div className="agent-cycle-meta">{cycles.length} cycle(s)</div>
          {cycles.map((c) => {
            const statusRaw = c.status;
            const statusLabel =
              statusRaw === 'completed'
                ? 'OK'
                : statusRaw === 'failed'
                  ? 'ERROR'
                : statusRaw === 'waiting'
                  ? 'WAITING'
                    : statusRaw.toUpperCase();
            const statusIcon = statusRaw === 'completed' ? '✓' : statusRaw === 'failed' ? '✗' : '';
            const statusText = statusIcon ? `${statusIcon} ${statusLabel}` : statusLabel;
            const thinkPreview = c.think ? previewForStep(c.think.step) : '';
            const toolDefs = c.think ? toolDefsFromThinkStep(c.think.step) : new Map<string, string[]>();
            const cycleToolCalls = c.acts.flatMap((a) => toolCallsForStep(a.step));
            const cycleToolSigs = cycleToolCalls.map((tc) => formatToolSignature(tc.name, tc.args, toolDefs.get(tc.name) || null));
            const openByDefault = c.index === cycles.length;
            return (
              <details key={c.id} className={`agent-cycle ${statusRaw}`} open={openByDefault}>
                <summary className="agent-cycle-summary">
                  <span className={`agent-trace-status ${statusRaw}`}>{statusText}</span>
                  <span className="agent-cycle-label">cycle</span>
                  <span className="agent-cycle-index">#{c.index}</span>
                  {cycleToolSigs.length ? (
                    <span className="agent-trace-badges">
                      {cycleToolSigs.slice(0, 3).map((sig) => (
                        <span key={sig} className="run-metric-badge metric-tool" title={sig}>
                          {clampInline(sig, 62)}
                        </span>
                      ))}
                      {cycleToolSigs.length > 3 ? (
                        <span className="run-metric-badge metric-tool">+{cycleToolSigs.length - 3}</span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="agent-cycle-spacer" />
                  {thinkPreview ? <span className="agent-cycle-preview">{thinkPreview}</span> : null}
                </summary>
                <div className="agent-cycle-body">
                  {c.think ? <TraceStepCard item={c.think} label="think" toolDefs={toolDefs} /> : null}
                  {c.acts.map((a) => (
                    <TraceStepCard key={a.id} item={a} label="act" toolDefs={toolDefs} />
                  ))}
                  <ObserveCard acts={c.acts} />
                  {c.others.length ? (
                    <div className="agent-cycle-others">
                      <div className="agent-cycle-others-title">other</div>
                      {c.others.map((o) => (
                        <TraceStepCard key={o.id} item={o} label="other" toolDefs={toolDefs} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
