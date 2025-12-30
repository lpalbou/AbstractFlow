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

interface AgentSubrunTracePanelProps {
  rootRunId: string | null;
  events: ExecutionEvent[];
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
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
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
    return prompt.length > 160 ? `${prompt.slice(0, 160)}…` : prompt;
  }

  return '';
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

export function AgentSubrunTracePanel({ rootRunId, events }: AgentSubrunTracePanelProps) {
  const items = useMemo<TraceItem[]>(() => {
    if (!rootRunId) return [];
    const out: TraceItem[] = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type !== 'trace_update') continue;
      if (!ev.runId || ev.runId === rootRunId) continue;
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
  }, [events, rootRunId]);

  if (!rootRunId) return null;

  return (
    <div className="agent-trace-panel">
      <div className="agent-trace-header">
        <div className="agent-trace-title">Agent calls</div>
        <div className="agent-trace-subtitle">Live per-effect trace (LLM/tool calls).</div>
      </div>

      {items.length === 0 ? (
        <div className="agent-trace-empty">No agent trace entries yet.</div>
      ) : (
        <div className="agent-trace-list">
          {items.map((item) => {
            const statusRaw = item.status;
            const statusLabel = statusRaw === 'completed' ? 'OK' : statusRaw === 'failed' ? 'FAILED' : statusRaw === 'waiting' ? 'WAITING' : statusRaw.toUpperCase();
            const title = titleForStep(item.step);
            const preview = previewForStep(item.step);
            return (
              <details key={item.id} className={`agent-trace-entry ${statusRaw}`} open={false}>
                <summary className="agent-trace-summary">
                  <span className={`agent-trace-status ${statusRaw}`}>{statusLabel}</span>
                  <span className="agent-trace-kind">{title}</span>
                  <span className="agent-trace-node">{item.nodeId}</span>
                  <span className="agent-trace-run">{item.runId}</span>
                </summary>
                {preview ? <div className="agent-trace-preview">{preview}</div> : null}
                <PanelBody item={item} />
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}


