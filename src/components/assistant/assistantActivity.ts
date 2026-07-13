import type { PlannerUsage } from '../../utils/plannerUsage';

/**
 * Status/activity model of the authoring assistant loop. This is a leaf
 * module: the drawer (loop owner) and the presentation components both import
 * from here, never from each other, so extraction cannot create import
 * cycles.
 */

export type AuthoringProgressStage =
  | 'resolving_model'
  | 'loading_tools'
  | 'planning_graph'
  | 'validating_plan'
  | 'applying_commands'
  | 'checking_graph'
  | 'done'
  | 'blocked';

export interface WorkingStatus {
  stage: AuthoringProgressStage;
  label: string;
  applied: number;
  issues: number;
  runId?: string;
  rootRunId?: string;
  activeRunId?: string;
  detail?: string;
  /** Current planning cycle (1-based) for the header label. */
  cycle?: number;
  /** Cycle cap captured at turn start; header renders "Cycle N/MAX". */
  maxCycles?: number;
  /** When the current stage started; drives the per-stage elapsed ticker. */
  stageStartedAt?: number;
  /** Cumulative turn token usage (absent until the first usage report). */
  usage?: PlannerUsage;
  /**
   * How a blocked stage ended: waiting on the user (needs_user, stall,
   * interrupt, pause) vs a hard failure. Waiting must never wear error
   * styling — the assistant is asking, not broken.
   */
  outcome?: 'waiting' | 'failed';
  /** Model-declared workflow plan steps (live plan strip; declared only, never invented checkmarks). */
  planSteps?: string[];
  /** Model-declared next step, refreshed each cycle. */
  nextStep?: string;
}

/** One real-time event in the authoring activity feed shown while the loop runs. */
export interface AuthoringActivityEntry {
  id: string;
  ts: number;
  /**
   * 'notice' marks routine self-corrections (language/format/empty-response
   * retries, no-command nudges, batch-rejected-then-repaired): expected loop
   * behavior in warning tint, distinct from real errors.
   */
  kind: 'info' | 'model' | 'apply' | 'error' | 'review' | 'notice';
  text: string;
  /** Planning cycle this entry belongs to; the panel renders a divider when it changes. */
  cycle?: number;
  /**
   * Full inspectable payload behind this entry (the exact prompt sent or raw
   * response received), expandable + copyable in the panel. Held in memory for
   * the session only — persistence strips it to protect the localStorage
   * quota (the visible entry text is always persisted untouched).
   */
  detail?: string;
}

/** Per-workflow persisted state of the authoring status card (plan/activity feed). */
export interface PersistedActivityState {
  activity: AuthoringActivityEntry[];
  turnStartedAt: number | null;
  statusCollapsed: boolean;
  workingStatus: WorkingStatus | null;
}

export function emptyActivityState(): PersistedActivityState {
  return { activity: [], turnStartedAt: null, statusCollapsed: false, workingStatus: null };
}

/**
 * Rebuild the activity panel state from its persisted JSON. The status card
 * and its log are per-workflow durable: they survive tab switches and page
 * reloads and only Clear Chat removes them. A persisted non-terminal stage
 * means the client authoring loop did not survive a reload (the loop itself
 * is in-memory), so the restored card reports the interruption honestly
 * instead of pretending the run is still progressing.
 */
export function restoreActivityPanelState(raw: string | null): PersistedActivityState {
  if (!raw) return emptyActivityState();
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedActivityState>;
    const activity = Array.isArray(parsed.activity)
      ? parsed.activity.filter((entry): entry is AuthoringActivityEntry =>
          Boolean(entry && typeof entry === 'object' && typeof (entry as AuthoringActivityEntry).text === 'string')
        )
      : [];
    let workingStatus =
      parsed.workingStatus && typeof parsed.workingStatus === 'object' ? (parsed.workingStatus as WorkingStatus) : null;
    if (workingStatus && workingStatus.stage !== 'done' && workingStatus.stage !== 'blocked') {
      // An interrupted reload is a waiting state, not an error: nothing broke,
      // the user just has to resend.
      workingStatus = {
        ...workingStatus,
        stage: 'blocked',
        label: 'Interrupted (editor reloaded)',
        detail: undefined,
        outcome: 'waiting',
      };
    }
    return {
      activity,
      turnStartedAt: typeof parsed.turnStartedAt === 'number' ? parsed.turnStartedAt : null,
      statusCollapsed: parsed.statusCollapsed === true,
      workingStatus,
    };
  } catch {
    return emptyActivityState();
  }
}

/** Semantic UI state of the assistant pill/status card. */
export type AssistantPillState = 'idle' | 'running' | 'waiting' | 'done' | 'failed';

/**
 * One state machine for the pill, the status-card tint, and the header label
 * tone. needs_user / stall / interrupt / pause all land on 'waiting' —
 * warning hue, never error styling.
 */
export function statusPillState(status: Pick<WorkingStatus, 'stage' | 'outcome'> | null, busy: boolean): AssistantPillState {
  if (busy) return 'running';
  if (!status) return 'idle';
  if (status.stage === 'done') return 'done';
  if (status.stage === 'blocked') return status.outcome === 'failed' ? 'failed' : 'waiting';
  // A non-terminal stage without a running loop is a restored/interrupted
  // card; treat it as waiting on the user.
  return 'waiting';
}

export const PILL_STATE_LABELS: Record<AssistantPillState, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Waiting',
  done: 'Done',
  failed: 'Failed',
};

/** In-flight stage chip: coarse phase + hue rendered beside the header label. */
export function stageChip(stage: AuthoringProgressStage): { text: string; tone: 'info' | 'warning' | 'success' } | null {
  switch (stage) {
    case 'resolving_model':
    case 'loading_tools':
    case 'planning_graph':
      return { text: 'PLANNING', tone: 'info' };
    case 'validating_plan':
      return { text: 'VALIDATING', tone: 'info' };
    case 'applying_commands':
      return { text: 'APPLYING', tone: 'warning' };
    case 'checking_graph':
      return { text: 'CHECKING', tone: 'success' };
    default:
      return null;
  }
}

/** Glyph + tone per activity kind for the [time][mark][text] entry grid. */
export function activityMark(kind: AuthoringActivityEntry['kind']): { glyph: string; tone: string } {
  switch (kind) {
    case 'model':
      return { glyph: '◇', tone: 'info' };
    case 'apply':
      return { glyph: '✓', tone: 'success' };
    case 'error':
      return { glyph: '✕', tone: 'error' };
    case 'review':
      return { glyph: '◎', tone: 'warning' };
    case 'notice':
      return { glyph: '△', tone: 'warning' };
    default:
      return { glyph: '·', tone: 'muted' };
  }
}

/** Format seconds as m:ss for the live status header. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Format an activity timestamp as offset from turn start (m:ss). */
export function formatActivityTime(ts: number, turnStartedAt: number | null): string {
  if (!turnStartedAt || ts < turnStartedAt) return formatElapsed(0);
  return formatElapsed((ts - turnStartedAt) / 1000);
}

/**
 * Wall-clock span of each planning cycle in the feed: first entry of cycle N
 * to first entry of cycle N+1 (last entry of the feed for the newest cycle).
 * Rendered in the sticky cycle headers.
 */
export function cycleElapsedSeconds(entries: AuthoringActivityEntry[]): Map<number, number> {
  const firstTs = new Map<number, number>();
  let lastTs = 0;
  for (const entry of entries) {
    lastTs = Math.max(lastTs, entry.ts);
    if (entry.cycle !== undefined && !firstTs.has(entry.cycle)) {
      firstTs.set(entry.cycle, entry.ts);
    }
  }
  const cycles = Array.from(firstTs.keys()).sort((a, b) => a - b);
  const spans = new Map<number, number>();
  for (let i = 0; i < cycles.length; i += 1) {
    const start = firstTs.get(cycles[i]) || 0;
    const end = i + 1 < cycles.length ? firstTs.get(cycles[i + 1]) || lastTs : lastTs;
    spans.set(cycles[i], Math.max(0, (end - start) / 1000));
  }
  return spans;
}

/** Plain-text export of the live activity panel: header summary plus entries grouped by planning cycle. */
export function activityClipboardText(
  label: string,
  entries: AuthoringActivityEntry[],
  turnStartedAt: number | null
): string {
  const lines: string[] = [`# Authoring Activity — ${label}`];
  let lastCycle: number | undefined;
  for (const entry of entries) {
    if (entry.cycle !== undefined && entry.cycle !== lastCycle) {
      lines.push('', `## Cycle ${entry.cycle}`);
      lastCycle = entry.cycle;
    }
    lines.push(`[${formatActivityTime(entry.ts, turnStartedAt)}] ${entry.text}`);
  }
  return lines.join('\n');
}

/** Live in-flight ticker line: "Cycle 3 · Planner run abc is running" with the stage purpose. */
export function stageTickerText(status: Pick<WorkingStatus, 'label' | 'detail' | 'cycle'>): string {
  const prefix = status.cycle && status.cycle > 0 ? `Cycle ${status.cycle} · ` : '';
  return `${prefix}${status.detail || status.label}`;
}

export function readinessProgressText(status: Pick<WorkingStatus, 'stage' | 'applied' | 'issues'>): string {
  if (status.issues <= 0) return 'Readiness checks passed';
  const noun = status.issues === 1 ? 'readiness check' : 'readiness checks';
  if (status.applied === 0 && status.stage !== 'blocked') return `${status.issues} ${noun} to satisfy`;
  return `${status.issues} ${noun} pending`;
}
