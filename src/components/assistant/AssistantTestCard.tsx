import type { DraftTestReport, DraftTestWait } from '../../utils/draftTestRun';
import { formatElapsed } from './assistantActivity';

/** One editable test input row: entry pin id/type + the value to send. */
export interface TestInputRow {
  pin: string;
  type: string;
  required: boolean;
  value: string;
}

interface AssistantTestCardProps {
  visible: boolean;
  flowSaved: boolean;
  inputs: TestInputRow[];
  onInputChange: (pin: string, value: string) => void;
  running: boolean;
  onRunTest: () => void;
  onStopTest: () => void;
  report: DraftTestReport | null;
  wait: DraftTestWait | null;
  onApprove: (approved: boolean) => void;
  askReply: string;
  onAskReplyChange: (value: string) => void;
  onSendAskReply: () => void;
  onOpenRun: (runId: string) => void;
}

function verdictLabel(report: DraftTestReport): { text: string; tone: string } {
  switch (report.verdict) {
    case 'passed':
      return { text: 'Test passed', tone: 'success' };
    case 'timeout':
      return { text: 'Test timed out', tone: 'warning' };
    case 'cancelled':
      return { text: 'Test cancelled', tone: 'warning' };
    case 'needs_interactive_input':
      return { text: 'Needs interactive input', tone: 'warning' };
    default:
      return { text: 'Test failed', tone: 'error' };
  }
}

/**
 * Draft test-run card: consented test execution with model/user inputs, live
 * approval surfacing, and a compact verdict with per-step failures. Never
 * auto-runs — the Run test button is the only trigger (runs cost money and
 * tools can mutate).
 */
export function AssistantTestCard({
  visible,
  flowSaved,
  inputs,
  onInputChange,
  running,
  onRunTest,
  onStopTest,
  report,
  wait,
  onApprove,
  askReply,
  onAskReplyChange,
  onSendAskReply,
  onOpenRun,
}: AssistantTestCardProps) {
  if (!visible) return null;
  return (
    <div className="assistant-test-card">
      <div className="assistant-test-header">
        <span className="assistant-test-title">Test run</span>
        <span className="assistant-test-note">
          {flowSaved ? 'Runs the last saved version of this flow.' : 'Save the flow first to enable testing.'}
        </span>
        {running ? (
          <button type="button" className="assistant-test-stop" onClick={onStopTest}>
            Stop test
          </button>
        ) : (
          <button type="button" className="assistant-test-run" onClick={onRunTest} disabled={!flowSaved}>
            {report ? 'Re-test' : 'Run test'}
          </button>
        )}
      </div>

      {inputs.length > 0 ? (
        <div className="assistant-test-inputs">
          {inputs.map((row) => (
            <label key={row.pin} className="assistant-test-input-row">
              <span className="assistant-test-input-label">
                {row.pin}
                {row.required ? <span className="assistant-test-required">*</span> : null}
                <span className="assistant-test-input-type">{row.type}</span>
              </span>
              <input
                type="text"
                value={row.value}
                disabled={running}
                onChange={(event) => onInputChange(row.pin, event.target.value)}
                placeholder={row.required ? 'required' : 'optional'}
              />
            </label>
          ))}
        </div>
      ) : null}

      {wait && wait.kind === 'tool_approval' ? (
        <div className="assistant-test-wait">
          <span className="assistant-test-wait-text">
            The test run wants to execute{' '}
            {(wait.toolCalls || [])
              .map((call) => (call && typeof call === 'object' ? String((call as { name?: unknown }).name || 'a tool') : 'a tool'))
              .join(', ') || 'a tool batch'}
            .
          </span>
          <div className="assistant-test-wait-actions">
            <button type="button" className="assistant-test-approve" onClick={() => onApprove(true)}>
              Approve
            </button>
            <button type="button" className="assistant-test-deny" onClick={() => onApprove(false)}>
              Deny
            </button>
          </div>
        </div>
      ) : null}

      {wait && wait.kind === 'ask_user' ? (
        <div className="assistant-test-wait">
          <span className="assistant-test-wait-text">{wait.prompt || 'The test run is asking for input.'}</span>
          <div className="assistant-test-wait-actions">
            <input
              type="text"
              value={askReply}
              onChange={(event) => onAskReplyChange(event.target.value)}
              placeholder="Your reply to the running workflow"
            />
            <button type="button" className="assistant-test-approve" onClick={onSendAskReply}>
              Send
            </button>
          </div>
        </div>
      ) : null}

      {report ? (
        <div className={`assistant-test-report tone-${verdictLabel(report).tone}`}>
          <div className="assistant-test-report-head">
            <span className="assistant-test-verdict">{verdictLabel(report).text}</span>
            <span className="assistant-test-meta">
              {formatElapsed(report.durationMs / 1000)}
              {' · '}
              <button type="button" className="assistant-test-open-run" onClick={() => onOpenRun(report.runId)}>
                open run
              </button>
            </span>
          </div>
          {report.flowError ? <div className="assistant-test-error">{report.flowError}</div> : null}
          {report.failedSteps.slice(0, 4).map((step) => (
            <div key={`${step.nodeId}-${step.error.slice(0, 24)}`} className="assistant-test-step">
              ✕ {step.nodeLabel} ({step.effectType}): {step.error}
            </div>
          ))}
          {report.verdict === 'passed' && report.outputs ? (
            <div className="assistant-test-outputs">
              {Object.entries(report.outputs)
                .slice(0, 4)
                .map(([key, value]) => (
                  <div key={key} className="assistant-test-output-row">
                    <span>{key}:</span> {String(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 160)}
                  </div>
                ))}
            </div>
          ) : null}
          {report.verdict !== 'passed' ? (
            <div className="assistant-test-hint">
              The failure details feed my next turn — send “fix the test failures” (or any guidance) to continue.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
