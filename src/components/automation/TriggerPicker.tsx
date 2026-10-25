/**
 * "What starts it?" — the human trigger picker (operator 2026-10-25), shared
 * by the New flow dialog and the Automation dialog. Plain choices, one line
 * of help each; source ids and versions never appear here.
 *
 * No schedule (operator ruling 2026-10-25): a schedule is a property of an
 * automation, set in Observer or the Assistant; Flow designs and tests
 * workflows. The picker says so under the choices.
 */
import type { ReactNode } from 'react';
import { SCHEDULE_ELSEWHERE, choiceHelp, connectionSources, mailSource, manualSource, type StartKind } from '../../utils/automationChoice';
import { ARRIVAL_GROUP_TITLES, arrivalOptions, choiceFromPicker, type ArrivalGroup, type PickerData, type PickerState } from '../../utils/automationPicker';
import type { AutomationFacts } from './useAutomationFacts';

const START_CHOICES: Array<{ kind: StartKind; title: string; sub: string }> = [
  { kind: 'chat', title: 'A person, in a chat', sub: 'Someone writes to it and it answers.' },
  { kind: 'arrives', title: 'When something arrives', sub: 'New mail, a new feed item, a webhook call.' },
  { kind: 'manual', title: 'By hand (Run now only)', sub: 'Only when someone presses Run now.' },
];

export interface TriggerPickerProps {
  value: PickerState;
  onChange: (next: PickerState) => void;
  data: PickerData;
  /** Offer "A person, in a chat" (the New flow question). */
  includeChat: boolean;
  gatewayUrl: string;
  /** Mailboxes / connections still loading, or why they could not be read. */
  arrivalsNote?: ReactNode;
  onRefreshArrivals?: () => void;
  /** Which choices the gateway can serve (missing ones are shown disabled with the reason). */
  unavailable?: Partial<Record<StartKind, string>>;
  idPrefix?: string;
}

export function TriggerPicker({
  value,
  onChange,
  data,
  includeChat,
  gatewayUrl,
  arrivalsNote,
  onRefreshArrivals,
  unavailable = {},
  idPrefix = 'trigger',
}: TriggerPickerProps) {
  const choices = START_CHOICES.filter((c) => includeChat || c.kind !== 'chat');
  const arrivals = arrivalOptions(data);
  const picked = choiceFromPicker(value, data);
  const base = gatewayUrl.trim().replace(/\/+$/, '');
  const selectedArrival = arrivals.find((a) => a.key === value.arrival);
  return (
    <div className="automation-picker">
      <div className="automation-choices" role="radiogroup" aria-label="What starts it?">
        {choices.map((c) => {
          const on = value.start === c.kind;
          const reason = unavailable[c.kind];
          return (
            <button
              key={c.kind}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={Boolean(reason)}
              className={`automation-choice${on ? ' is-selected' : ''}`}
              onClick={() => onChange({ ...value, start: c.kind })}
            >
              <span className="automation-choice-dot" aria-hidden="true" />
              <span className="automation-choice-text">
                <span className="automation-choice-title">{c.title}</span>
                <span className="automation-choice-sub">{reason || c.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="automation-help automation-schedule-elsewhere">On a schedule? {SCHEDULE_ELSEWHERE}</p>

      {value.start === 'arrives' ? (
        <div className="automation-detail">
          {arrivals.length ? (
            <div className="automation-arrivals" role="radiogroup" aria-label="What it listens to">
              {(['mailboxes', 'feeds', 'webhooks', 'other'] as ArrivalGroup[]).map((group) => {
                const rows = arrivals.filter((a) => a.group === group);
                if (!rows.length) return null;
                return (
                  <div key={group} className="automation-arrival-group">
                    <div className="automation-arrival-group-title">{ARRIVAL_GROUP_TITLES[group]}</div>
                    {rows.map((a) => (
                      <label key={a.key} className={`automation-arrival${a.disabled ? ' is-disabled' : ''}`}>
                        <input
                          type="radio"
                          name={`${idPrefix}-arrival`}
                          value={a.key}
                          checked={value.arrival === a.key}
                          disabled={a.disabled}
                          onChange={() => onChange({ ...value, arrival: a.key })}
                        />
                        <span>
                          {a.text}
                          {a.hint ? <span className={a.warn ? 'automation-warn' : 'automation-muted'}> · {a.hint}</span> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : arrivalsNote ? null : (
            <p className="automation-help">Nothing to listen to yet: add a mailbox, a feed or a webhook, then refresh.</p>
          )}
          {arrivalsNote ? <div className="automation-help">{arrivalsNote}</div> : null}
          <p className="automation-links">
            {base ? (
              <>
                <a href={`${base}/console#users`} target="_blank" rel="noreferrer">
                  Add a mailbox…
                </a>
                <a href={`${base}/console#triggers`} target="_blank" rel="noreferrer">
                  Add a feed or webhook…
                </a>
              </>
            ) : null}
            {onRefreshArrivals ? (
              <button type="button" className="automation-link-button" onClick={onRefreshArrivals}>
                Refresh
              </button>
            ) : null}
          </p>
        </div>
      ) : null}

      {value.start && value.start !== 'arrives' ? (
        <p className="automation-help automation-help--choice">{choiceHelp({ kind: value.start })}</p>
      ) : null}
      {value.start === 'arrives' && 'choice' in picked ? <p className="automation-help automation-help--choice">{choiceHelp(picked.choice)}</p> : null}
      {value.start === 'arrives' && !selectedArrival && value.arrival && 'problem' in picked ? (
        <p className="automation-problem">{picked.problem}</p>
      ) : null}
    </div>
  );
}

/**
 * The picker's data and notes from the loaded facts (pure): the served
 * sources, the person's mailboxes and connections, which choices this
 * gateway cannot serve, and why a list is missing.
 */
export function pickerSupport(facts: Pick<AutomationFacts, 'sources' | 'mailboxes' | 'connections'>): {
  data: PickerData;
  sourcesProblem: string;
  arrivalsNote: ReactNode;
  unavailable: Partial<Record<StartKind, string>>;
} {
  const sourcesOk = facts.sources.state === 'ok' && facts.sources.value.status === 'ok' ? facts.sources.value.items : null;
  const sourcesProblem =
    facts.sources.state === 'loading'
      ? 'Loading what this gateway can run…'
      : facts.sources.state === 'error'
        ? `The gateway could not say what can start a flow: ${facts.sources.message}`
        : facts.sources.value.status === 'unavailable'
          ? facts.sources.value.reason
          : '';
  const mailboxes = facts.mailboxes.state === 'ok' && facts.mailboxes.value.status === 'ok' ? facts.mailboxes.value.mailboxes : null;
  const connections = facts.connections.state === 'ok' && facts.connections.value.status === 'ok' ? facts.connections.value.connections : null;
  const notes: string[] = [];
  if (facts.mailboxes.state === 'loading' || facts.connections.state === 'loading') notes.push('Loading your mailboxes and connections…');
  if (facts.mailboxes.state === 'error') notes.push(`Your mailboxes could not be read: ${facts.mailboxes.message}`);
  if (facts.connections.state === 'error') notes.push(`Your feeds and webhooks could not be read: ${facts.connections.message}`);
  const unavailable: Partial<Record<StartKind, string>> = {};
  if (sourcesOk) {
    if (!manualSource(sourcesOk)) unavailable.manual = 'This gateway has no Run now trigger.';
    if (!mailSource(sourcesOk) && !connectionSources(sourcesOk).length) unavailable.arrives = 'This gateway cannot listen to mail, feeds or webhooks.';
  }
  return {
    data: { sources: sourcesOk || [], mailboxes, connections },
    sourcesProblem,
    arrivalsNote: notes.length ? notes.join(' ') : null,
    unavailable,
  };
}
