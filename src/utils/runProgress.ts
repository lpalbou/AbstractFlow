export function progressNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function progressFractionToPercent(value: number): number {
  return Math.max(0, Math.min(100, value > 1 ? value : value * 100));
}

export function progressPercent(value: Record<string, unknown> | null | undefined): number | null {
  if (!value) return null;
  const directPercent = progressNumber(value.percent);
  if (directPercent != null) return progressFractionToPercent(directPercent);

  const stepProgress = progressNumber(value.step_progress);
  if (stepProgress != null) return progressFractionToPercent(stepProgress);

  const step = progressNumber(value.step);
  const totalSteps = progressNumber(value.total_steps);
  if (step != null && totalSteps != null && totalSteps > 0) {
    return Math.max(0, Math.min(100, (step / totalSteps) * 100));
  }

  const directProgress = progressNumber(value.progress);
  if (directProgress != null) return progressFractionToPercent(directProgress);

  const current = progressNumber(value.current);
  const total = progressNumber(value.total);
  if (current != null && total != null && total > 0) return Math.max(0, Math.min(100, (current / total) * 100));

  const frameProgress = progressNumber(value.frame_progress);
  if (frameProgress != null) return progressFractionToPercent(frameProgress);

  const frame = progressNumber(value.frame);
  const totalFrames = progressNumber(value.total_frames);
  if (frame != null && totalFrames != null && totalFrames > 0) {
    return Math.max(0, Math.min(100, (frame / totalFrames) * 100));
  }
  return null;
}

export function progressText(value: Record<string, unknown> | null | undefined, key: string): string {
  const raw = value ? value[key] : undefined;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function progressIsUnreported(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  if (value.reported === false) return true;
  const mode = progressText(value, 'progress_mode');
  if (mode === 'unreported') return true;
  const source = progressText(value, 'progress_source');
  const phase = progressText(value, 'phase') || progressText(value, 'stage') || progressText(value, 'message');
  if (source === 'runtime' && (phase === 'starting' || phase === 'starting generation')) return true;
  if ((phase === 'waiting_provider' || phase === 'waiting provider response') && progressPercent(value) == null) return true;
  return false;
}

export function progressIsFinalizing(value: Record<string, unknown> | null | undefined, stepStatus?: string): boolean {
  if (!value) return false;
  const mode = progressText(value, 'progress_mode');
  const phase = progressText(value, 'phase') || progressText(value, 'stage') || progressText(value, 'message');
  if (mode === 'finalizing' || phase === 'finalizing' || phase === 'finalizing output') return true;
  if (stepStatus === 'running') {
    const pct = progressPercent(value);
    if (pct != null && pct >= 99.9 && value.terminal !== true) return true;
  }
  return false;
}

export function progressDisplayPercent(value: Record<string, unknown> | null | undefined, stepStatus?: string): number | null {
  if (!value || progressIsUnreported(value)) return null;
  const pct = progressPercent(value);
  if (pct == null) return null;
  if (progressIsFinalizing(value, stepStatus)) return Math.min(pct, 99.9);
  return pct;
}

export function progressIsIndeterminate(value: Record<string, unknown> | null | undefined): boolean {
  if (!value || progressIsUnreported(value) || progressIsFinalizing(value)) return false;
  const mode = progressText(value, 'progress_mode');
  return mode === 'indeterminate';
}

function progressDurationMs(
  value: Record<string, unknown> | null | undefined,
  secondKeys: string[],
  msKeys: string[] = []
): number | null {
  if (!value) return null;
  for (const key of msKeys) {
    const raw = progressNumber(value[key]);
    if (raw != null && raw >= 0) return raw;
  }
  for (const key of secondKeys) {
    const raw = progressNumber(value[key]);
    if (raw != null && raw >= 0) return raw * 1000;
  }
  return null;
}

function parseTimeMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function formatProgressDurationMs(rawMs: unknown): string {
  const ms = typeof rawMs === 'number' ? rawMs : rawMs == null ? NaN : Number(rawMs);
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
}

export function progressTimingParts(
  value: Record<string, unknown> | null | undefined,
  startedAt: string | undefined,
  nowMs: number
): { elapsedLabel?: string; remainingLabel?: string; remainingApproximate?: boolean } | null {
  if (!value) return null;
  const directElapsedMs = progressDurationMs(
    value,
    ['elapsed_s', 'elapsed_seconds', 'elapsed'],
    ['elapsed_ms']
  );
  const startedMs = parseTimeMs(startedAt);
  const elapsedMs = directElapsedMs ?? (startedMs != null ? Math.max(0, nowMs - startedMs) : null);

  let remainingMs = progressDurationMs(
    value,
    ['remaining_s', 'remaining_seconds', 'eta_s', 'eta_seconds', 'eta'],
    ['remaining_ms', 'eta_ms']
  );
  let remainingApproximate = false;
  const pct = progressPercent(value);
  if (remainingMs == null && elapsedMs != null && pct != null && pct >= 1 && pct < 99.9) {
    remainingMs = (elapsedMs * (100 - pct)) / pct;
    remainingApproximate = true;
  }

  const elapsedLabel = elapsedMs != null ? `Elapsed ${formatProgressDurationMs(elapsedMs)}` : undefined;
  const remainingLabel = remainingMs != null
    ? `Remaining ${remainingApproximate ? '~' : ''}${formatProgressDurationMs(remainingMs)}`
    : undefined;
  return elapsedLabel || remainingLabel ? { elapsedLabel, remainingLabel, remainingApproximate } : null;
}

export function formatProgressSummary(value: Record<string, unknown> | null | undefined): string {
  if (!value) return '';
  if (progressIsUnreported(value)) return '';
  const finalizing = progressIsFinalizing(value);
  const phase =
    finalizing
      ? 'Finalizing output'
      :
    (typeof value.phase === 'string' && value.phase.trim()) ||
    (typeof value.stage === 'string' && value.stage.trim()) ||
    (typeof value.status === 'string' && value.status.trim()) ||
    (typeof value.message === 'string' && value.message.trim()) ||
    'running';
  const parts = [phase];
  const step = progressNumber(value.step);
  const totalSteps = progressNumber(value.total_steps);
  if (step != null && totalSteps != null) {
    parts.push(`step ${Math.floor(step)}/${Math.floor(totalSteps)}`);
  } else {
    const current = progressNumber(value.current);
    const total = progressNumber(value.total);
    if (current != null && total != null) {
      parts.push(`${Math.floor(current)}/${Math.floor(total)}`);
    } else {
      const frame = progressNumber(value.frame);
      const totalFrames = progressNumber(value.total_frames);
      if (frame != null && totalFrames != null) {
        parts.push(`frame ${Math.floor(frame)}/${Math.floor(totalFrames)}`);
      }
    }
  }
  return parts.join(' · ');
}
