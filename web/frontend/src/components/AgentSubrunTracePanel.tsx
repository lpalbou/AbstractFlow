import { useMemo, useState } from 'react';
import type { ExecutionEvent } from '../types/flow';

type TabId = 'system' | 'user' | 'tools' | 'response' | 'errors' | 'raw';
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

function formatJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

function errorTextOf(step: TraceStep): string {
  const direct = step.error;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
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

  if (t === 'llm_call') {
    const content = res?.content;
    const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
    return text;
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

function combineStatus(items: TraceItem[]): string {
  const statuses = items.map((i) => i.status);
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

function renderTools(step: TraceStep): string {
  const t = effectTypeOf(step);
  if (t === 'tool_calls') {
    const payload = payloadOf(step);
    return formatJson(payload?.tool_calls ?? payload?.tool_calls_raw ?? payload?.calls ?? payload) || '';
  }
  // For llm_call, show the *available tools* config (if present).
  const payload = payloadOf(step);
  return formatJson(payload?.tools) || '';
}

function renderResponse(step: TraceStep): string {
  const res = resultOf(step);
  const content = res?.content;
  if (typeof content === 'string') return content;
  return formatJson(res) || '';
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

  const render = () => {
    if (active === 'system') return <pre className="run-details-output">{system || '(none)'}</pre>;
    if (active === 'user') return <pre className="run-details-output">{user || '(none)'}</pre>;
    if (active === 'tools') return <pre className="run-details-output">{tools || '(none)'}</pre>;
    if (active === 'response') return <pre className="run-details-output">{response || '(none)'}</pre>;
    if (active === 'errors') return <pre className="run-details-output">{errors || '(none)'}</pre>;
    return <pre className="run-details-output">{formatJson(step) || '(none)'}</pre>;
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

function TraceStepCard({ item, label }: { item: TraceItem; label: string }) {
  const step = item.step;
  const statusRaw = item.status;
  const statusLabel =
    statusRaw === 'completed' ? 'OK' : statusRaw === 'failed' ? 'FAILED' : statusRaw === 'waiting' ? 'WAITING' : statusRaw.toUpperCase();
  const title = titleForStep(step);
  const preview = previewForStep(step);
  const tokenBadges = tokenBadgesForStep(step);
  const toolNames = toolNamesForStep(step);

  return (
    <details className={`agent-trace-entry ${statusRaw}`} open={false}>
      <summary className="agent-trace-summary">
        <span className={`agent-trace-status ${statusRaw}`}>{statusLabel}</span>
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
        {toolNames.length ? (
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
                  <pre className="run-details-output">{formatJson(output) || '(none)'}</pre>
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
          status: item.status,
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
          status: item.status,
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
                  ? 'FAILED'
                  : statusRaw === 'waiting'
                    ? 'WAITING'
                    : statusRaw.toUpperCase();
            const thinkPreview = c.think ? previewForStep(c.think.step) : '';
            const toolCount = c.acts.flatMap((a) => toolResultsForStep(a.step)).length;
            const openByDefault = c.index === cycles.length;
            return (
              <details key={c.id} className={`agent-cycle ${statusRaw}`} open={openByDefault}>
                <summary className="agent-cycle-summary">
                  <span className={`agent-trace-status ${statusRaw}`}>{statusLabel}</span>
                  <span className="agent-cycle-label">cycle</span>
                  <span className="agent-cycle-index">#{c.index}</span>
                  {toolCount ? <span className="run-metric-badge metric-tool">{toolCount} tool result(s)</span> : null}
                  <span className="agent-cycle-spacer" />
                  {thinkPreview ? <span className="agent-cycle-preview">{thinkPreview}</span> : null}
                </summary>
                <div className="agent-cycle-body">
                  {c.think ? <TraceStepCard item={c.think} label="think" /> : null}
                  {c.acts.map((a) => (
                    <TraceStepCard key={a.id} item={a} label="act" />
                  ))}
                  <ObserveCard acts={c.acts} />
                  {c.others.length ? (
                    <div className="agent-cycle-others">
                      <div className="agent-cycle-others-title">other</div>
                      {c.others.map((o) => (
                        <TraceStepCard key={o.id} item={o} label="other" />
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
