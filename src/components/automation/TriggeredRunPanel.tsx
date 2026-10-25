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
import { sampleNoun } from '../../utils/triggerSample';

export function TriggeredRunPanel({
  trigger,
  words,
  count,
  onCount,
  busy,
  error,
  disabled,
  onRun,
}: {
  trigger: AutomationTriggerDefaults;
  words?: AutomationWords;
  count: number;
  onCount: (n: number) => void;
  busy: boolean;
  error: string;
  disabled?: boolean;
  onRun: () => void;
}) {
  const kind = triggerPinKind(trigger);
  const noun = sampleNoun(kind);
  return (
    <section className="run-form-section run-triggered" aria-labelledby="run-triggered-title">
      <div className="run-form-section-header">
        <div className="run-form-section-title" id="run-triggered-title">
          Run as if triggered
        </div>
      </div>
      <div className="run-form-section-body run-triggered-body">
        <p className="run-triggered-using">Using: {triggerSentence(trigger, words)}</p>
        {noun ? (
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
        ) : kind === 'schedule' ? (
          <p className="automation-help">As if it fired now.</p>
        ) : null}
        {error ? (
          <p className="automation-problem" role="alert">
            {error}
          </p>
        ) : null}
        <div className="run-triggered-actions">
          <button type="button" className="modal-button primary run-cta" onClick={onRun} disabled={busy || disabled || (Boolean(noun) && !(count >= 1))}>
            {busy ? 'Reading what would arrive…' : 'Run'}
          </button>
          <span className="automation-muted">A test run: nothing is turned on.</span>
        </div>
      </div>
    </section>
  );
}
