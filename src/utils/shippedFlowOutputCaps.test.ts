import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { listBundledFlows } from './bundledFlows';

// ADR-0026 §2 (operator ruling 2026-09-28): no shipped workflow caps a
// model's output by default. The verify/judge agents of the coding families
// (coding, multiagent, spec, spec-std) carried `max_output_tokens: 4000` on
// their structured verdict call; the model default applies now, and the pin
// remains for an author who wants an explicit budget.
const FLOWS_DIR = join(__dirname, '..', '..', 'examples', 'flows');
const MODEL_NODE_TYPES = new Set(['agent', 'llm_call']);

type FlowNode = {
  id: string;
  data?: { nodeType?: string; pinDefaults?: Record<string, unknown>; codeBody?: string };
};
type FlowDoc = { id: string; nodes?: FlowNode[] };

function outputCapDefaults(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(FLOWS_DIR).filter((name) => name.endsWith('.json')).sort()) {
    const flow = JSON.parse(readFileSync(join(FLOWS_DIR, file), 'utf8')) as FlowDoc;
    for (const node of flow.nodes || []) {
      const nodeType = String(node.data?.nodeType || '');
      const value = node.data?.pinDefaults?.max_output_tokens;
      if (MODEL_NODE_TYPES.has(nodeType) && value !== undefined && value !== null && value !== '') {
        found.push(`${file}:${node.id} max_output_tokens=${String(value)}`);
      }
    }
  }
  return found;
}

describe('shipped workflows carry no default output-token cap (ADR-0026)', () => {
  it('scans real model nodes (the check is not vacuous)', () => {
    const verifier = JSON.parse(readFileSync(join(FLOWS_DIR, 'coding-verify-gates.json'), 'utf8')) as {
      nodes: Array<{ id: string; data: { nodeType: string } }>;
    };
    expect(verifier.nodes.find((node) => node.id === 'verifier')?.data.nodeType).toBe('agent');
  });

  it('no agent or llm_call node in examples/flows sets a max_output_tokens default', () => {
    expect(outputCapDefaults()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ADR-0026 (operator ruling 2026-09-28): no count or char cap on what a model
// reads, in ANY shipped flow. "Shipped" = every flow the editor's bundled
// catalog carries (the real `listBundledFlows()` glob, so a new family is
// scanned the day it lands) plus goal-agent (the abstractcode.goal.v1 bundle,
// packed from this repo but not in the library catalog).
//
// Two scans:
// - CODE BODIES: every literal cut (`x[:N]`, `x[a:N]`, `x[-N:]`) and every
//   `len(x) > N` text guard (N >= 20) is a finding unless it is on the allowlist below, which
//   names WHY it is not a model-input cap. A stale allowlist entry also fails,
//   so the list cannot outlive the code it excuses. Prefix/suffix strips
//   (`x[7:]`, `x[:-4]`) are parsing, not cuts, and are not findings.
// - PIN DEFAULTS: a positive default on a char/token/message/entry budget pin
//   (`max_chars`, `max_input_tokens`, `warm_entries`, ...) — an unlabeled
//   default bound — is a finding. 0/absent = unbounded; an author may still
//   set one explicitly.
// ---------------------------------------------------------------------------

const EXTRA_SHIPPED_FILES = ['goal-agent.json'];

function shippedFlows(): FlowDoc[] {
  const flows = listBundledFlows() as unknown as FlowDoc[];
  for (const file of EXTRA_SHIPPED_FILES) {
    flows.push(JSON.parse(readFileSync(join(FLOWS_DIR, file), 'utf8')) as FlowDoc);
  }
  return flows;
}

type Allowed = { flow: string; node: string; snippet: string; why: string };

const TOURNAMENT = 'co-scientist tournament bookkeeping (pairing schedule / Elo statistic), not text a model reads';
const FIGURE =
  'co-scientist figure-layout bound on the spec the MODEL WROTE (render legibility), tagged #[WARNING:TRUNCATION]; listed for the operator';
const REPORT = 'co-scientist report display (PDF table cell / metadata title), labeled, tagged #[WARNING:TRUNCATION]';
const PROGRESS_LINE =
  'display-only progress-line preview (answer_user), labeled "… (truncated)", tagged #[WARNING:TRUNCATION]';
const ENTITY_ID = 'entity: identifier/timestamp formatting or a one-char parse, no content dropped';

const ALLOWED: Allowed[] = [
  { flow: 'co-scientist', node: 'rank_pairs', snippet: 'key=lambda x: -x)[:3]', why: TOURNAMENT },
  { flow: 'co-scientist', node: 'rank_pairs', snippet: 'for t in ids[:3]:', why: TOURNAMENT },
  { flow: 'co-scientist', node: 'fold', snippet: 'top3 = top_elos[:3]', why: TOURNAMENT },
  { flow: 'co-scientist', node: 'term_fold', snippet: 'top3 = top_elos[:3]', why: TOURNAMENT },
  { flow: 'co-scientist', node: 'fig_fold', snippet: '(s.get("layers") or [])[:4]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: '(l.get("nodes") or [])[:4]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: '"label": lab[:60]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: 'str(l.get("label") or "")[:34]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: '(s.get("edges") or [])[:16]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: 'str(e.get("label") or "")[:20]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: 'str(fallback_title_text or ""))[:110]', why: FIGURE },
  { flow: 'co-scientist', node: 'fig_fold', snippet: '_clean(s.get("caption") or "")[:300]', why: FIGURE },
  { flow: 'co-scientist', node: 'report_head', snippet: 'doc = derived_title[:160]', why: REPORT },
  { flow: 'co-scientist', node: 'report_ranked', snippet: 'return s[:117] + "..." if len(s) > 120', why: REPORT },
  { flow: 'co-scientist', node: 'report_ranked', snippet: 'if len(title) > 80:', why: REPORT },
  { flow: 'co-scientist', node: 'report_ranked', snippet: 'title = title[:77] + "..."', why: REPORT },
  { flow: 'react-coding', node: 'fold', snippet: 'if len(summary) > 160:', why: PROGRESS_LINE },
  { flow: 'react-coding', node: 'fold', snippet: 'summary = summary[:160] + "… (truncated)"', why: PROGRESS_LINE },
  { flow: 'ralph-coding', node: 'cycle_line', snippet: 'if len(note) > 120:', why: PROGRESS_LINE },
  { flow: 'ralph-coding', node: 'cycle_line', snippet: 'note = note[:120] + "… (truncated)"', why: PROGRESS_LINE },
  { flow: 'entity-cognition-turn', node: 'shelf', snippet: 'return tail[-8:] if len(tail) >= 8', why: ENTITY_ID },
  { flow: 'entity-cognition-turn', node: 'shelf', snippet: 'born = ts[:16]', why: ENTITY_ID },
  { flow: 'entity-cognition-turn', node: 'elections', snippet: 'nxt = s[7:8]', why: ENTITY_ID },
];

const SLICE = /\[\s*(-?\d*)\s*:\s*(-?\d*)\s*\]/g;
// A length guard on text: `len(x) > N` with N >= 20 (small counts are logic).
const LEN_GUARD = /len\([^)]*\)\s*>=?\s*(\d{3,}|[2-9]\d)\b/;

function isCut(start: string, end: string): boolean {
  if (end !== '' && Number(end) > 0) return true; // x[:N], x[a:N]
  if (end === '' && start !== '' && Number(start) < 0) return true; // x[-N:]
  return false;
}

function codeLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return '';
  const inline = trimmed.indexOf('  # ');
  return inline >= 0 ? trimmed.slice(0, inline) : trimmed;
}

type Finding = { flow: string; node: string; line: string };

function codeBodyCuts(flows: FlowDoc[]): Finding[] {
  const found: Finding[] = [];
  for (const flow of flows) {
    for (const node of flow.nodes || []) {
      for (const raw of String(node.data?.codeBody || '').split('\n')) {
        const line = codeLine(raw);
        if (!line) continue;
        const cut = [...line.matchAll(SLICE)].some((m) => isCut(m[1], m[2]));
        if (cut || LEN_GUARD.test(line)) found.push({ flow: flow.id, node: node.id, line });
      }
    }
  }
  return found;
}

const BUDGET_PIN = /^(max_\w*(chars|tokens|messages|items|entries)|\w*_entries)$/;

function budgetPinDefaults(flows: FlowDoc[]): string[] {
  const found: string[] = [];
  const visit = (where: string, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (BUDGET_PIN.test(key) && typeof v === 'number' && v > 0) found.push(`${where} ${key}=${v}`);
      visit(`${where}.${key}`, v);
    }
  };
  for (const flow of flows) {
    for (const node of flow.nodes || []) visit(`${flow.id}:${node.id}`, node.data?.pinDefaults);
  }
  return found;
}

describe('shipped workflows cut nothing a model reads (ADR-0026 count/char caps)', () => {
  const flows = shippedFlows();

  it('scans the whole shipped set (the check is not vacuous)', () => {
    const ids = new Set(flows.map((flow) => flow.id));
    for (const id of [
      'co-scientist',
      'diagram-render',
      'map-reduce',
      'goal-agent',
      'react-coding',
      'ralph-coding',
      'ralph-cycle',
      'coding-verify-gates',
      'multiagent-coding',
      'deep-research',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('every literal cut or length guard in a shipped code body is an allowlisted non-model-input bound', () => {
    const findings = codeBodyCuts(flows);
    const unexplained = findings
      .filter((f) => !ALLOWED.some((a) => a.flow === f.flow && a.node === f.node && f.line.includes(a.snippet)))
      .map((f) => `${f.flow}:${f.node}: ${f.line}`);
    expect(unexplained).toEqual([]);
  });

  it('no allowlist entry is stale (each still excuses a live line)', () => {
    const findings = codeBodyCuts(flows);
    const stale = ALLOWED.filter(
      (a) => !findings.some((f) => a.flow === f.flow && a.node === f.node && f.line.includes(a.snippet))
    ).map((a) => `${a.flow}:${a.node}: ${a.snippet}`);
    expect(stale).toEqual([]);
  });

  it('no shipped node carries a positive default on a char/token/message/entry budget pin', () => {
    expect(budgetPinDefaults(flows)).toEqual([]);
  });
});
