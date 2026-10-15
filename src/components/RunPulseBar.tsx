import type { RunEstimate, RunPulse } from '../utils/runPulse';

/**
 * Run pulse (operator 2026-10-11): while a run goes on, how long it has run,
 * the best estimate of what is left, and what it has done so far across the
 * whole run tree (utils/runPulse.ts).
 */
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function estimateText(estimate: RunEstimate | null | undefined): string {
  if (!estimate) return 'No estimate yet: this flow has no finished run to compare with';
  const typical = `typical run ${minutes(estimate.typicalMs)}, median of ${estimate.sample}`;
  return estimate.remainingMs == null
    ? `Longer than the typical run (${typical})`
    : `About ${minutes(estimate.remainingMs)} left (${typical})`;
}

export function pulseChips(p: RunPulse): string[] {
  const chips: string[] = [];
  if (p.modelCalls) chips.push(`${count(p.modelCalls)} model call${p.modelCalls === 1 ? '' : 's'}`);
  if (p.inputTokens || p.outputTokens) chips.push(`${count(p.inputTokens)} tokens in · ${count(p.outputTokens)} out`);
  if (p.unsplitTokens) chips.push(`${count(p.unsplitTokens)} tokens (no in/out split)`);
  if (p.toolCalls) chips.push(`${count(p.toolCalls)} tool call${p.toolCalls === 1 ? '' : 's'}${p.toolFailures ? ` (${p.toolFailures} failed)` : ''}`);
  if (p.filesRead) chips.push(`${count(p.filesRead)} file read${p.filesRead === 1 ? '' : 's'}`);
  if (p.filesWritten) chips.push(`${count(p.filesWritten)} file write${p.filesWritten === 1 ? '' : 's'}`);
  if (p.searches) chips.push(`${count(p.searches)} file search${p.searches === 1 ? '' : 'es'}`);
  if (p.webSearches) chips.push(`${count(p.webSearches)} web search${p.webSearches === 1 ? '' : 'es'}`);
  if (p.pagesFetched) chips.push(`${count(p.pagesFetched)} page${p.pagesFetched === 1 ? '' : 's'} fetched`);
  if (p.commands) chips.push(`${count(p.commands)} command${p.commands === 1 ? '' : 's'}`);
  if (p.approvals) chips.push(`${count(p.approvals)} approval${p.approvals === 1 ? '' : 's'}`);
  if (p.subRuns) chips.push(`${count(p.subRuns)} sub-run${p.subRuns === 1 ? '' : 's'}`);
  return chips;
}

export function RunPulseBar({ elapsedMs, estimate, pulse }: { elapsedMs: number; estimate: RunEstimate | null | undefined; pulse: RunPulse }) {
  const chips = pulseChips(pulse);
  return (
    <div className="run-pulse" aria-live="off">
      <div className="run-pulse-time">
        <span className="run-pulse-elapsed" title="Time since the run started">
          {clock(elapsedMs)}
        </span>
        <span className="run-pulse-estimate">{estimateText(estimate)}</span>
      </div>
      {chips.length ? (
        <ul className="run-pulse-chips" aria-label="What the run has done so far">
          {chips.map((chip) => (
            <li key={chip}>{chip}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
