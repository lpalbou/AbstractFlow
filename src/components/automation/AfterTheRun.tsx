/**
 * "After the run" (framework ADR-0041): the last section of a triggered run's
 * view, from `GET /api/gateway/runs/{run_id}/after` — what arrived, when it
 * ran, the note On Flow End recorded, the alert it raised (or why nothing
 * rang) and each delivery with its channel, route and time. Nothing a flow
 * sends to a person happens out of sight.
 *
 * `AfterTheRunView` is pure (rendered by the tests in every state);
 * `AfterTheRunSection` reads the route (spinner until the read answered,
 * ADR-0039) and reads again while deliveries are still being recorded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AFTER_REREAD_MS,
  alertSource,
  askedSentence,
  alertTitle,
  arrivedSentence,
  deliverySentence,
  quietSentence,
  readRunAfter,
  shouldReadAgain,
  type RunAfter,
} from '../../utils/afterTheRun';
import { LoadingLine, ReadFailed } from '../ReadState';

export type AfterTheRunState =
  | { status: 'loading' }
  | { status: 'failed'; error: string; onRetry?: () => void }
  | { status: 'ready'; after: RunAfter; refreshing?: boolean };

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AfterTheRunView({ state }: { state: AfterTheRunState }) {
  return (
    <section className="run-after" aria-labelledby="run-after-title" data-section="after-the-run">
      <h4 className="run-after-title" id="run-after-title">
        After the run
      </h4>
      {state.status === 'loading' ? (
        <LoadingLine text="Reading what happened after the run" />
      ) : state.status === 'failed' ? (
        <ReadFailed onRetry={state.onRetry}>Could not read what happened after the run: {state.error}</ReadFailed>
      ) : (
        <AfterTheRunBody after={state.after} refreshing={Boolean(state.refreshing)} />
      )}
    </section>
  );
}

function AfterTheRunBody({ after, refreshing }: { after: RunAfter; refreshing: boolean }) {
  const arrived = arrivedSentence(after);
  const started = when(after.run.started);
  const ended = when(after.run.ended);
  const alerts = after.alerts && after.alerts.length ? after.alerts : after.attention ? [after.attention] : [];
  return (
    <dl className="run-after-facts">
      {after.trigger ? (
        <>
          <dt>What arrived</dt>
          <dd data-field="arrived">
            {arrived || after.trigger.text || 'Started by its automation'}
            {after.trigger.text && arrived ? <span className="run-after-muted"> · {after.trigger.text}</span> : null}
          </dd>
        </>
      ) : null}
      <dt>Ran</dt>
      <dd data-field="ran">
        {started ? `Started ${started}` : 'Started'}
        {ended ? ` · ended ${ended}` : ' · still running'}
        {after.run.status && after.run.status !== 'completed' ? ` · ${after.run.status}` : ''}
      </dd>
      {after.run.note ? (
        <>
          <dt>Note</dt>
          <dd data-field="note">{after.run.note}</dd>
        </>
      ) : null}
      <dt>Notified</dt>
      <dd data-field="notified">
        {alerts.length ? (
          <ul className="run-after-alerts">
            {alerts.map((a) => {
              const rows = after.deliveries.filter((d) => !d.record_key || d.record_key === a.record_key);
              return (
                <li key={a.record_key}>
                  <span className="run-after-alert-title">{alertTitle(a)}</span>
                  <span className="run-after-muted"> · {alertSource(a)}{a.raised_at ? ` · ${when(a.raised_at)}` : ''}</span>
                  {askedSentence(a) ? (
                    <span className="run-after-muted" data-field="asked"> · {askedSentence(a)}</span>
                  ) : null}
                  {rows.length ? (
                    <ul className="run-after-deliveries">
                      {rows.map((d, i) => (
                        <li key={`${d.channel}:${d.device || ''}:${i}`} data-state={d.state}>
                          {deliverySentence(d)}
                          {d.time ? <span className="run-after-muted"> · {when(d.time)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="run-after-muted">No delivery recorded yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <span data-field="quiet">{quietSentence(after.quiet_reason)}</span>
        )}
      </dd>
      {refreshing ? (
        <dd className="run-after-refresh">
          <LoadingLine inline text="Checking for deliveries" />
        </dd>
      ) : null}
    </dl>
  );
}

/** Reads the route for `runId` once the run has ended, and again while deliveries are filling in. */
export function AfterTheRunSection({ runId, read = readRunAfter }: { runId: string; read?: (runId: string) => Promise<RunAfter> }) {
  const [state, setState] = useState<AfterTheRunState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    const go = async () => {
      tries += 1;
      try {
        const after = await read(runId);
        if (!alive) return;
        const again = shouldReadAgain(after, tries);
        setState({ status: 'ready', after, refreshing: again });
        if (again) timer.current = setTimeout(go, AFTER_REREAD_MS);
      } catch (error) {
        if (!alive) return;
        setState((cur) =>
          // A later re-read that fails keeps what was already read.
          cur.status === 'ready'
            ? { ...cur, refreshing: false }
            : { status: 'failed', error: error instanceof Error ? error.message : String(error), onRetry: retry }
        );
      }
    };
    void go();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId, read, attempt, retry]);

  return <AfterTheRunView state={state} />;
}
