import { Fragment, type RefObject } from 'react';
import {
  activityMark,
  formatActivityTime,
  formatElapsed,
  readinessProgressText,
  stageChip,
  stageTickerText,
  statusPillState,
  type AuthoringActivityEntry,
  type WorkingStatus,
} from './assistantActivity';
import { formatTokenCount } from '../../utils/plannerUsage';
import { IconChevron, IconCopy } from './icons';

interface AssistantStatusCardProps {
  workingStatus: WorkingStatus;
  busy: boolean;
  statusCollapsed: boolean;
  onToggleCollapsed: () => void;
  activity: AuthoringActivityEntry[];
  turnStartedAt: number | null;
  elapsedSeconds: number;
  stopRequested: boolean;
  onStop: () => void;
  onCopyActivity: () => void;
  /** Follow-live scroll wiring for the activity log (owned by the drawer). */
  logRef: RefObject<HTMLDivElement>;
  onLogScroll: () => void;
  following: boolean;
  onFollow: () => void;
}

/** Status header + live activity feed of the authoring loop (pure render). */
export function AssistantStatusCard({
  workingStatus,
  busy,
  statusCollapsed,
  onToggleCollapsed,
  activity,
  turnStartedAt,
  elapsedSeconds,
  stopRequested,
  onStop,
  onCopyActivity,
  logRef,
  onLogScroll,
  following,
  onFollow,
}: AssistantStatusCardProps) {
  const pillState = statusPillState(workingStatus, busy);
  const chip = busy ? stageChip(workingStatus.stage) : null;
  const cycleText = workingStatus.cycle
    ? `Cycle ${workingStatus.cycle}${workingStatus.maxCycles ? `/${workingStatus.maxCycles}` : ''} · `
    : '';
  const budgetPercent =
    workingStatus.cycle && workingStatus.maxCycles && workingStatus.maxCycles > 0
      ? Math.min(100, Math.round((workingStatus.cycle / workingStatus.maxCycles) * 100))
      : null;

  return (
    <div className={`assistant-run-status state-${pillState}`}>
      <button
        type="button"
        className="assistant-run-status-header"
        onClick={onToggleCollapsed}
        aria-expanded={!statusCollapsed}
        title={statusCollapsed ? 'Expand authoring activity' : 'Collapse authoring activity'}
      >
        <IconChevron collapsed={statusCollapsed} />
        {busy ? (
          <span className="assistant-run-spinner" aria-hidden="true" />
        ) : (
          <span className={`assistant-run-status-dot state-${pillState}`} aria-hidden="true" />
        )}
        <span className="assistant-run-status-label">
          {cycleText}
          {workingStatus.label}
        </span>
        {chip ? <span className={`assistant-stage-chip ${chip.tone}`}>{chip.text}</span> : null}
        <span className="assistant-run-status-meta">{formatElapsed(elapsedSeconds)}</span>
        <span
          role="button"
          tabIndex={0}
          className="assistant-status-copy"
          onClick={(event) => {
            event.stopPropagation();
            onCopyActivity();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              onCopyActivity();
            }
          }}
          title="Copy authoring activity to clipboard"
          aria-label="Copy authoring activity"
        >
          <IconCopy size={14} />
        </span>
        {busy ? (
          <span
            role="button"
            tabIndex={0}
            className={`assistant-stop-button ${stopRequested ? 'disabled' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onStop();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onStop();
              }
            }}
            title="Stop the authoring loop; applied edits are kept"
          >
            {stopRequested ? 'Stopping…' : 'Stop'}
          </span>
        ) : null}
      </button>
      {budgetPercent !== null && busy ? (
        <div className="assistant-cycle-budget" aria-hidden="true">
          <div className="assistant-cycle-budget-fill" style={{ width: `${budgetPercent}%` }} />
        </div>
      ) : null}
      {!statusCollapsed && (workingStatus.planSteps?.length || workingStatus.nextStep) ? (
        <div className="assistant-plan-strip" aria-label="Model-declared plan">
          {(workingStatus.planSteps || []).map((step, index) => (
            <span key={`${index}-${step.slice(0, 24)}`} className="assistant-plan-step">
              <span className="assistant-plan-step-index">{index + 1}</span>
              {step}
            </span>
          ))}
          {workingStatus.nextStep ? (
            <span className="assistant-plan-next">Next: {workingStatus.nextStep}</span>
          ) : null}
        </div>
      ) : null}
      {!statusCollapsed ? (
        <>
          <div
            className="assistant-activity-log"
            role="log"
            aria-label="Authoring activity"
            ref={logRef}
            onScroll={onLogScroll}
          >
            {activity.map((entry, index) => {
              const prevCycle = index > 0 ? activity[index - 1].cycle : undefined;
              const showCycleDivider = entry.cycle !== undefined && entry.cycle !== prevCycle;
              const mark = activityMark(entry.kind);
              return (
                <Fragment key={entry.id}>
                  {showCycleDivider ? (
                    <div className="assistant-activity-cycle" role="separator" aria-label={`Cycle ${entry.cycle}`}>
                      <span>Cycle {entry.cycle}</span>
                    </div>
                  ) : null}
                  <div className={`assistant-activity-entry ${entry.kind}`}>
                    <span className="assistant-activity-time">{formatActivityTime(entry.ts, turnStartedAt)}</span>
                    <span className={`assistant-activity-mark tone-${mark.tone}`} aria-hidden="true">
                      {mark.glyph}
                    </span>
                    <span className="assistant-activity-text">
                      {entry.text}
                      {entry.detail ? (
                        <details className="assistant-activity-detail">
                          <summary>
                            Inspect payload ({Math.round(entry.detail.length / 1000)}k chars)
                            <span
                              role="button"
                              tabIndex={0}
                              className="assistant-activity-detail-copy"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void navigator.clipboard.writeText(entry.detail || '');
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void navigator.clipboard.writeText(entry.detail || '');
                                }
                              }}
                              title="Copy full payload to clipboard"
                              aria-label="Copy full payload"
                            >
                              <IconCopy size={12} />
                            </span>
                          </summary>
                          <pre className="assistant-activity-detail-body">{entry.detail}</pre>
                        </details>
                      ) : null}
                    </span>
                  </div>
                </Fragment>
              );
            })}
            {busy && workingStatus.stage !== 'done' && workingStatus.stage !== 'blocked' ? (
              <div className="assistant-activity-live" role="status" aria-live="polite">
                <span className="assistant-activity-live-text">{stageTickerText(workingStatus)}</span>
                <span className="assistant-activity-live-elapsed">
                  {formatElapsed(workingStatus.stageStartedAt ? (Date.now() - workingStatus.stageStartedAt) / 1000 : elapsedSeconds)}
                </span>
              </div>
            ) : null}
            {!following ? (
              <button type="button" className="assistant-follow-pill" onClick={onFollow} title="Jump to the latest activity">
                Follow ↓
              </button>
            ) : null}
          </div>
          <div className="assistant-run-status-footer">
            <span>
              {workingStatus.applied > 0
                ? `${workingStatus.applied} change${workingStatus.applied === 1 ? '' : 's'} applied`
                : 'No graph changes applied yet'}
            </span>
            {workingStatus.usage ? (
              <span title="Cumulative planner token usage this turn (from Gateway run ledgers)">
                {formatTokenCount(workingStatus.usage.inputTokens)} in / {formatTokenCount(workingStatus.usage.outputTokens)} out tokens
              </span>
            ) : null}
            <span>{readinessProgressText(workingStatus)}</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
