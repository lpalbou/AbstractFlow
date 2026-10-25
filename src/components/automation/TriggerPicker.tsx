/**
 * "What starts it?" — the human trigger picker (operator 2026-10-25), shared
 * by the New flow dialog and the Automation dialog. Plain choices, one line
 * of help each; source ids and versions never appear here.
 */
import { useState, type ReactNode } from 'react';
import { zoneChoicesFor, zoneCity } from '../../utils/timeZones';
import {
  WEEKDAYS,
  WEEKDAY_NAMES,
  choiceHelp,
  connectionSources,
  defaultRule,
  mailSource,
  manualSource,
  scheduleSource,
  scheduleSentenceWithZone,
  type ScheduleRepeat,
  type ScheduleRule,
  type StartKind,
  type Weekday,
} from '../../utils/automationChoice';
import { ARRIVAL_GROUP_TITLES, arrivalOptions, choiceFromPicker, type ArrivalGroup, type PickerData, type PickerState } from '../../utils/automationPicker';
import type { AutomationFacts } from './useAutomationFacts';

const START_CHOICES: Array<{ kind: StartKind; title: string; sub: string }> = [
  { kind: 'chat', title: 'A person, in a chat', sub: 'Someone writes to it and it answers.' },
  { kind: 'schedule', title: 'On a schedule', sub: 'Every day, every week, every few minutes, or once.' },
  { kind: 'arrives', title: 'When something arrives', sub: 'New mail, a new feed item, a webhook call.' },
  { kind: 'manual', title: 'By hand (Run now only)', sub: 'Only when someone presses Run now.' },
];

const REPEAT_LABELS: Record<ScheduleRepeat, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  every: 'Every few minutes or hours',
  once: 'Once, on a date',
};

export interface TriggerPickerProps {
  value: PickerState;
  onChange: (next: PickerState) => void;
  data: PickerData;
  /** Offer "A person, in a chat" (the New flow question). */
  includeChat: boolean;
  /** Where the zone comes from, said next to it. */
  timeZoneOrigin: 'account' | 'browser';
  /** Zones the account may pick (the gateway's list); [] = this browser's list. */
  timeZoneChoices?: string[];
  gatewayUrl: string;
  /** Mailboxes / connections still loading, or why they could not be read. */
  arrivalsNote?: ReactNode;
  onRefreshArrivals?: () => void;
  /** Which choices the gateway can serve (missing ones are shown disabled with the reason). */
  unavailable?: Partial<Record<StartKind, string>>;
  idPrefix?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

/** HH:MM as two 24-hour selects: "08:00" reads the same everywhere (no AM/PM by locale). */
function TimeOfDay({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : ['08', '00'];
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort();
  return (
    <span className="automation-time" role="group" aria-label="Time of day">
      <select className="run-form-select" aria-label="Hour" value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)}>
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span aria-hidden="true">:</span>
      <select className="run-form-select" aria-label="Minute" value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)}>
        {minutes.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Every zone the gateway offers (else this browser's list), for the search. */
function allZones(choices: string[]): string[] {
  if (choices.length) return choices;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return supported ? supported('timeZone') : [];
  } catch {
    return [];
  }
}

/** The time zone: a short list of cities with their UTC offset, the person's first; search for any other. */
function ZonePicker({ zone, zones, onZone }: { zone: string; zones: string[]; onZone: (zone: string) => void }) {
  const [search, setSearch] = useState('');
  const everything = allZones(zones);
  const short = zoneChoicesFor(zone);
  const listId = 'automation-zone-search';
  return (
    <span className="automation-zone-picker">
      <select className="run-form-select automation-zone" aria-label="Time zone" value={zone} onChange={(e) => onZone(e.target.value)}>
        {short.map((z) => (
          <option key={z.zone} value={z.zone}>
            {z.label}
          </option>
        ))}
      </select>
      <input
        className="run-form-input automation-zone-search"
        list={listId}
        value={search}
        placeholder="Search another city…"
        aria-label="Search all time zones"
        onChange={(e) => {
          const v = e.target.value;
          setSearch(v);
          const hit = everything.find((z) => z === v || zoneCity(z).toLowerCase() === v.trim().toLowerCase());
          if (hit) {
            onZone(hit);
            setSearch('');
          }
        }}
      />
      <datalist id={listId}>
        {everything.map((z) => (
          <option key={z} value={zoneCity(z)}>
            {z}
          </option>
        ))}
      </datalist>
    </span>
  );
}

function ScheduleEditor({
  rule,
  onRule,
  timeZone,
  origin,
  zones,
  onTimeZone,
}: {
  rule: ScheduleRule;
  onRule: (rule: ScheduleRule) => void;
  timeZone: string;
  origin: 'account' | 'browser' | 'chosen';
  zones: string[];
  onTimeZone: (zone: string) => void;
}) {
  const timeField =
    rule.repeat !== 'every' ? (
      <label className="automation-inline-field">
        <span>at</span>
        <TimeOfDay value={rule.at} onChange={(at) => onRule({ ...rule, at })} />
      </label>
    ) : null;
  const noDay = rule.repeat === 'weekly' && rule.days.length === 0;
  return (
    <div className="automation-schedule">
      <div className="automation-schedule-row">
        <select
          className="run-form-select automation-repeat"
          aria-label="How often"
          value={rule.repeat}
          onChange={(e) => onRule(defaultRule(e.target.value as ScheduleRepeat))}
        >
          {(Object.keys(REPEAT_LABELS) as ScheduleRepeat[]).map((r) => (
            <option key={r} value={r}>
              {REPEAT_LABELS[r]}
            </option>
          ))}
        </select>
        {rule.repeat === 'monthly' ? (
          <label className="automation-inline-field">
            <span>on the</span>
            <select
              className="run-form-select"
              aria-label="Day of the month"
              value={String(rule.day)}
              onChange={(e) => onRule({ ...rule, day: e.target.value === 'last' ? 'last' : Number(e.target.value) })}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value="last">last day</option>
            </select>
          </label>
        ) : null}
        {rule.repeat === 'every' ? (
          <label className="automation-inline-field">
            <span>every</span>
            <input
              className="run-form-input automation-amount"
              type="number"
              min={1}
              step={1}
              aria-label="How many"
              value={Number.isFinite(rule.amount) ? rule.amount : ''}
              onChange={(e) => onRule({ ...rule, amount: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
            <select
              className="run-form-select"
              aria-label="Minutes or hours"
              value={rule.unit}
              onChange={(e) => onRule({ ...rule, unit: e.target.value as 'm' | 'h' })}
            >
              <option value="m">minutes</option>
              <option value="h">hours</option>
            </select>
          </label>
        ) : null}
        {rule.repeat === 'once' ? (
          <label className="automation-inline-field">
            <span>on</span>
            <input
              className="run-form-input"
              type="date"
              aria-label="Date"
              value={rule.date}
              onChange={(e) => onRule({ ...rule, date: e.target.value })}
            />
          </label>
        ) : null}
        {timeField}
      </div>
      {rule.repeat === 'weekly' ? (
        <div className="automation-days" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((d: Weekday) => {
            const on = rule.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                className={`automation-day${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={WEEKDAY_NAMES[d]}
                onClick={() => onRule({ ...rule, days: on ? rule.days.filter((x) => x !== d) : [...rule.days, d] })}
              >
                {WEEKDAY_NAMES[d].slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : null}
      {rule.repeat !== 'every' ? (
        <label className="automation-inline-field">
          <span>Time zone</span>
          <ZonePicker zone={timeZone} zones={zones} onZone={onTimeZone} />
          <span className="automation-muted">
            {origin === 'account' ? 'your account’s' : origin === 'browser' ? 'this browser’s' : 'chosen for this automation'}
          </span>
        </label>
      ) : null}
      <p className={noDay ? 'automation-problem' : 'automation-help'}>{noDay ? 'Pick at least one day.' : scheduleSentenceWithZone(rule, timeZone)}</p>
    </div>
  );
}

export function TriggerPicker({
  value,
  onChange,
  data,
  includeChat,
  timeZoneOrigin,
  timeZoneChoices = [],
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

      {value.start === 'schedule' ? (
        <div className="automation-detail">
          {value.legacy ? (
            <p className="automation-help">
              Now: {value.legacy.sentence} <span className="automation-muted">· an older schedule; change it below to use your clock</span>
            </p>
          ) : null}
          <ScheduleEditor
            rule={value.rule}
            onRule={(rule) => onChange({ ...value, rule, legacy: null })}
            timeZone={value.timeZone || data.timeZone}
            origin={value.timeZone && value.timeZone !== data.timeZone ? 'chosen' : timeZoneOrigin}
            zones={timeZoneChoices}
            onTimeZone={(zone) => onChange({ ...value, timeZone: zone === data.timeZone ? '' : zone, legacy: null })}
          />
        </div>
      ) : null}

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
export function pickerSupport(facts: Pick<AutomationFacts, 'sources' | 'mailboxes' | 'connections' | 'timeZone'>): {
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
    if (!scheduleSource(sourcesOk)) unavailable.schedule = 'This gateway cannot run calendar schedules yet.';
    if (!manualSource(sourcesOk)) unavailable.manual = 'This gateway has no Run now trigger.';
    if (!mailSource(sourcesOk) && !connectionSources(sourcesOk).length) unavailable.arrives = 'This gateway cannot listen to mail, feeds or webhooks.';
  }
  return {
    data: { sources: sourcesOk || [], mailboxes, connections, timeZone: facts.timeZone.zone },
    sourcesProblem,
    arrivalsNote: notes.length ? notes.join(' ') : null,
    unavailable,
  };
}
