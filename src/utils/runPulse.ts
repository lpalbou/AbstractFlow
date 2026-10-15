/**
 * Run pulse (operator 2026-10-11): while a run goes on, what it has done so far
 * and how long it may still take, from what the runtime recorded. Totals cover
 * the whole run tree (the root run and every agent / subflow sub-run).
 */
import type { ExecutionEvent } from '../types/flow';
import { ledgerStepKey } from './ledgerSteps';

export interface RunPulse {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens reported only as a total (the provider gave no input/output split). */
  unsplitTokens: number;
  toolCalls: number;
  toolFailures: number;
  filesRead: number;
  filesWritten: number;
  searches: number;
  webSearches: number;
  pagesFetched: number;
  commands: number;
  approvals: number;
  subRuns: number;
}

/** What a tool does, for the pulse's counters. */
export function toolKind(name: string): 'read' | 'write' | 'search' | 'web_search' | 'fetch' | 'command' | 'other' {
  if (/^(read_file|skim_files|open_attachment|analyze_code)$/.test(name)) return 'read';
  if (/^(write_file|edit_file|apply_patch|delete_file|move_file)$/.test(name)) return 'write';
  if (/^(search_files|list_files|skim_folders|glob_files)$/.test(name)) return 'search';
  if (/^(web_search|search_web)$/.test(name)) return 'web_search';
  if (/^(fetch_url|browser_probe|open_url)$/.test(name)) return 'fetch';
  if (/^(execute_command|shell_exec|execute_python)$/.test(name)) return 'command';
  return 'other';
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function computeRunPulse(events: ExecutionEvent[], rootRunId: string | null): RunPulse {
  const pulse: RunPulse = {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    unsplitTokens: 0,
    toolCalls: 0,
    toolFailures: 0,
    filesRead: 0,
    filesWritten: 0,
    searches: 0,
    webSearches: 0,
    pagesFetched: 0,
    commands: 0,
    approvals: 0,
    subRuns: 0,
  };
  // The latest record of each step (STARTED / WAITING / COMPLETED share a step,
  // an approved tool call's execution included: ledgerStepKey).
  const latest = new Map<string, Record<string, unknown>>();
  const runs = new Set<string>();
  for (const ev of events) {
    if (ev.type !== 'trace_update' || !ev.runId) continue;
    runs.add(ev.runId);
    for (const step of Array.isArray(ev.steps) ? ev.steps : []) {
      if (!step || typeof step !== 'object') continue;
      const rec = step as Record<string, unknown>;
      const stepId = typeof rec.step_id === 'string' ? rec.step_id : '';
      if (!stepId) continue;
      const key = `${ev.runId}:${ledgerStepKey(rec, stepId)}`;
      latest.set(key, rec);
      const result = rec.result as Record<string, unknown> | undefined;
      const wait = result?.wait as Record<string, unknown> | undefined;
      if (rec.status === 'waiting' && typeof wait?.wait_key === 'string' && wait.wait_key.startsWith('tool_approval:')) {
        latest.set(`${key}:approval`, { approval: true });
      }
    }
  }
  pulse.subRuns = [...runs].filter((id) => id !== rootRunId).length;
  for (const rec of latest.values()) {
    if (rec.approval === true) {
      pulse.approvals += 1;
      continue;
    }
    if (rec.status !== 'completed') continue;
    const effect = rec.effect as Record<string, unknown> | undefined;
    const result = (rec.result || {}) as Record<string, unknown>;
    if (effect?.type === 'llm_call') {
      pulse.modelCalls += 1;
      const usage = (result.usage || {}) as Record<string, unknown>;
      // Some OpenAI-compatible servers answer in the Responses dialect: the
      // normalised usage keeps the total but zeroes the split, which the raw
      // response still carries (AbstractCore fix filed: AbstractAssistant
      // backlog 0011). Read the split from there when it is missing.
      const raw = ((result.raw_response as Record<string, unknown> | undefined)?.usage || {}) as Record<string, unknown>;
      const input = num(usage.input_tokens) || num(usage.prompt_tokens) || num(raw.input_tokens) || num(raw.prompt_tokens);
      const output = num(usage.output_tokens) || num(usage.completion_tokens) || num(raw.output_tokens) || num(raw.completion_tokens);
      if (input || output) {
        pulse.inputTokens += input;
        pulse.outputTokens += output;
      } else {
        pulse.unsplitTokens += num(usage.total_tokens);
      }
    } else if (effect?.type === 'tool_calls') {
      for (const item of Array.isArray(result.results) ? result.results : []) {
        if (!item || typeof item !== 'object') continue;
        const call = item as Record<string, unknown>;
        pulse.toolCalls += 1;
        if (call.success === false) pulse.toolFailures += 1;
        const kind = toolKind(String(call.name || ''));
        if (kind === 'read') pulse.filesRead += 1;
        else if (kind === 'write') pulse.filesWritten += 1;
        else if (kind === 'search') pulse.searches += 1;
        else if (kind === 'web_search') pulse.webSearches += 1;
        else if (kind === 'fetch') pulse.pagesFetched += 1;
        else if (kind === 'command') pulse.commands += 1;
      }
    }
  }
  return pulse;
}

export interface RunEstimate {
  /** Median duration of this flow's finished runs. */
  typicalMs: number;
  /** How many finished runs the median comes from. */
  sample: number;
  /** Best estimate of what is left; null once the run is past the typical time. */
  remainingMs: number | null;
}

/**
 * The best estimate available today: the median duration of this flow's
 * previous completed runs, minus the time already spent. Null with no history.
 * (A loop's item i of n would be better; the runtime does not record it yet,
 * root backlog 1013.)
 */
export function estimateRemaining(
  elapsedMs: number,
  pastRuns: ReadonlyArray<{ status: string; created_at?: string | null; updated_at?: string | null }>
): RunEstimate | null {
  const durations = pastRuns
    .filter((r) => r.status === 'completed' && r.created_at && r.updated_at)
    .map((r) => Date.parse(String(r.updated_at)) - Date.parse(String(r.created_at)))
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  const typicalMs = durations.length % 2 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
  return { typicalMs, sample: durations.length, remainingMs: typicalMs > elapsedMs ? typicalMs - elapsedMs : null };
}
