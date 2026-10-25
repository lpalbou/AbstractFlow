/**
 * "Run as if triggered" (operator ruling 2026-10-25): the Run dialog of a flow
 * with an automation trigger reads the saved trigger and runs the flow on a
 * sample of what it would deliver (utils/triggerSample.ts). One control per
 * kind: the last N messages / items / calls, "as if it fired now" for a
 * schedule, nothing for by hand.
 */
import type { AutomationTriggerDefaults } from '../../types/flow';
import { triggerSentence, type AutomationWords } from '../../utils/automationChoice';
import { triggerPinKind } from '../../utils/triggerPins';
import { sampleNoun, sampleSourceName } from '../../utils/triggerSample';
import { LoadingLine, ReadFailed } from '../ReadState';

export function TriggeredRunPanel({
  trigger,
  words,
  count,
  onCount,
  busy,
  error,
  edited,
  onUseSample,
}: {
  trigger: AutomationTriggerDefaults;
  words?: AutomationWords;
  count: number;
  onCount: (n: number) => void;
  busy: boolean;
  error: string;
  /** The person typed into the advanced inputs in this dialog: Run uses them as they are. */
  edited: boolean;
  onUseSample: () => void;
}) {
  const kind = triggerPinKind(trigger);
  const noun = sampleNoun(kind);
  // The panel says what Run (the dialog's one Run button) will do.
  const plan = edited
    ? null
    : noun
      ? `Run reads the last ${Number.isFinite(count) ? count : '…'} ${noun} of ${sampleSourceName(trigger, words)} again and runs the flow on them.`
      : kind === 'schedule'
        ? 'Run runs the flow as if the schedule fired now.'
        : 'Run runs the flow as if someone pressed Run now.';
  return (
    <section className="run-form-section run-triggered" aria-labelledby="run-triggered-title">
      <div className="run-form-section-header">
        <div className="run-form-section-title" id="run-triggered-title">
          Run as if triggered
        </div>
      </div>
      <div className="run-form-section-body run-triggered-body">
        <p className="run-triggered-using">Using: {triggerSentence(trigger, words)}</p>
        {noun && !edited ? (
          <label className="automation-inline-field run-triggered-count">
            <span>Use the last</span>
            <input
              className="run-form-input automation-amount"
              type="number"
              min={1}
              step={1}
              value={Number.isFinite(count) ? count : ''}
              aria-label={`How many ${noun}`}
              onChange={(e) => onCount(e.target.value === '' ? NaN : Math.max(1, Math.floor(Number(e.target.value))))}
            />
            <span>{noun}</span>
          </label>
        ) : null}
        {edited ? (
          <p className="run-triggered-edited">
            Using your edited inputs.{' '}
            <button type="button" className="automation-link-button" onClick={onUseSample}>
              Use the sample again
            </button>
          </p>
        ) : busy ? (
          // The sample is out (tried up to 3 times, ADR-0039): a spinner, never the plan or an error.
          <LoadingLine text="Reading what would arrive" />
        ) : (
          <p className="automation-help">{plan}</p>
        )}
        {/* Failed after every try. Its retry is the dialog's one Run button
            (operator ruling: one Run starts it), so the line says so. */}
        {error && !busy ? (
          <ReadFailed>
            {error}
            {/[.!?]$/.test(error.trim()) ? '' : '.'} Press Run to try again.
          </ReadFailed>
        ) : null}
        <p className="automation-muted">A test run: nothing is turned on.</p>
      </div>
    </section>
  );
}
