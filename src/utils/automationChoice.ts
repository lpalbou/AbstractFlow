/**
 * What starts a flow, in human words (operator 2026-10-25: "the list of
 * triggers is absolutely not actionable by a human").
 *
 * The person picks a CHOICE ("On a schedule: every day at 08:00", "When mail
 * arrives in me@example.org", "When Release notes has a new item", "By hand");
 * this module maps it to and from `automation_defaults.trigger`:
 *
 *   schedule  -> schedule@2 {kind: daily|weekly|monthly|every|once, at, days,
 *                day, every, time_zone}; schedule@1 is never written for a new
 *                automation, but an old flow's schedule@1 is read and shown;
 *   mail      -> the source whose descriptor says `connection_provider:
 *                email_accounts` (email.received), `config.account` = the
 *                mailbox id (`GET /api/gateway/me/email` -> accounts);
 *   connection-> a feed / webhook source (`uses_trigger_connection`), the
 *                connection saved as `trigger.connection_id`;
 *   manual    -> the source whose capability kind is `manual`.
 *
 * Source ids and versions never reach the main text of the UI; the copy
 * here is what the person reads.
 */
import type { AutomationDefaults, AutomationTriggerDefaults, JsonValue } from '../types/flow';
import type { AvailableTriggerSource, TriggerSourceItem } from './triggerSources';
import type { TriggerConnection } from './triggerConnections';
import { zoneCity } from './timeZones';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export type ScheduleRule =
  | { repeat: 'daily'; at: string }
  | { repeat: 'weekly'; days: Weekday[]; at: string }
  | { repeat: 'monthly'; day: number | 'last'; at: string }
  | { repeat: 'every'; amount: number; unit: 'm' | 'h' }
  | { repeat: 'once'; date: string; at: string };

export type ScheduleRepeat = ScheduleRule['repeat'];

export type TriggerChoice =
  | { kind: 'schedule'; rule: ScheduleRule; timeZone: string }
  | { kind: 'mail'; account: string }
  | { kind: 'connection'; connectionId: string; sourceId: string; sourceVersion: number }
  | { kind: 'manual' };

/** The New flow question adds "A person, in a chat" (no automation). */
export type StartChoice = { kind: 'chat' } | TriggerChoice;
export type StartKind = 'chat' | 'schedule' | 'arrives' | 'manual';

/** One of the person's mailboxes (`GET /api/gateway/me/email` -> `accounts`). */
export interface Mailbox {
  account_id: string;
  primary: boolean;
  address: string | null;
  configured: boolean;
  can_read: boolean;
  /** It has an outgoing server: Send / Reply / Forward can use it (false = read-only). */
  can_send: boolean;
  enabled: boolean;
}

export class AutomationChoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationChoiceError';
  }
}

const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function available(sources: readonly TriggerSourceItem[]): AvailableTriggerSource[] {
  return sources.filter((s): s is AvailableTriggerSource => s.available);
}

function latest(list: AvailableTriggerSource[]): AvailableTriggerSource | null {
  return list.reduce<AvailableTriggerSource | null>((best, s) => (!best || s.version > best.version ? s : best), null);
}

/** schedule@2: the calendar schedule (time zone aware). Null when the gateway does not serve it. */
export function scheduleSource(sources: readonly TriggerSourceItem[]): AvailableTriggerSource | null {
  return available(sources).find((s) => s.capabilities.kind === 'time' && s.version === 2 && s.id === 'schedule') || null;
}

/** The mailbox-backed source (email.received). */
export function mailSource(sources: readonly TriggerSourceItem[]): AvailableTriggerSource | null {
  return latest(available(sources).filter((s) => s.needs_connection && s.connection_provider === 'email_accounts'));
}

/** The "Run now only" source. */
export function manualSource(sources: readonly TriggerSourceItem[]): AvailableTriggerSource | null {
  return latest(available(sources).filter((s) => s.capabilities.kind === 'manual'));
}

/** The feed / webhook sources (trigger connections). */
export function connectionSources(sources: readonly TriggerSourceItem[]): AvailableTriggerSource[] {
  return available(sources).filter((s) => s.uses_trigger_connection);
}

// ---------------------------------------------------------------------------
// Schedule rule <-> schedule@2 config
// ---------------------------------------------------------------------------

/** Plain-words problems with a rule (empty = valid). */
export function scheduleRuleProblems(rule: ScheduleRule, timeZone: string): string[] {
  const out: string[] = [];
  if (rule.repeat !== 'every') {
    if (!HHMM_RE.test(rule.at)) out.push('Choose a time of day.');
    if (!timeZone.trim()) out.push('The time zone is missing.');
  }
  if (rule.repeat === 'weekly' && !rule.days.length) out.push('Choose at least one day of the week.');
  if (rule.repeat === 'monthly' && rule.day !== 'last' && !(Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31)) {
    out.push('Choose a day of the month between 1 and 31, or the last day.');
  }
  if (rule.repeat === 'every' && !(Number.isInteger(rule.amount) && rule.amount >= 1)) out.push('Enter how often, as a whole number of at least 1.');
  if (rule.repeat === 'once' && !DATE_RE.test(rule.date)) out.push('Choose the date.');
  return out;
}

/** The schedule@2 config of a rule. Throws on an invalid rule. */
export function scheduleConfig(rule: ScheduleRule, timeZone: string): Record<string, JsonValue> {
  const problems = scheduleRuleProblems(rule, timeZone);
  if (problems.length) throw new AutomationChoiceError(problems.join(' '));
  const zone = timeZone.trim();
  switch (rule.repeat) {
    case 'daily':
      return { kind: 'daily', at: rule.at, time_zone: zone };
    case 'weekly':
      return { kind: 'weekly', days: WEEKDAYS.filter((d) => rule.days.includes(d)), at: rule.at, time_zone: zone };
    case 'monthly':
      return { kind: 'monthly', day: rule.day, at: rule.at, time_zone: zone };
    case 'every':
      return { kind: 'every', every: `${rule.amount}${rule.unit}` };
    case 'once':
      return { kind: 'once', at: `${rule.date}T${rule.at}`, time_zone: zone };
  }
}

const EVERY_RE = /^([1-9][0-9]*)([smhd])$/;

function everyRule(every: string): ScheduleRule | null {
  const m = EVERY_RE.exec(every);
  if (!m) return null;
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n % 60 === 0 ? { repeat: 'every', amount: n / 60, unit: 'm' } : null;
    case 'm':
      return { repeat: 'every', amount: n, unit: 'm' };
    case 'h':
      return { repeat: 'every', amount: n, unit: 'h' };
    case 'd':
      return { repeat: 'every', amount: n * 24, unit: 'h' };
  }
  return null;
}

/** A schedule@2 config back to a rule (null when the editor cannot show it). */
export function ruleFromScheduleConfig(config: Record<string, JsonValue>): { rule: ScheduleRule; timeZone: string | null } | null {
  const zone = typeof config.time_zone === 'string' ? config.time_zone : null;
  const at = typeof config.at === 'string' ? config.at : '';
  const kind = config.kind ?? (config.every !== undefined ? 'every' : 'once');
  switch (kind) {
    case 'daily':
      return { rule: { repeat: 'daily', at }, timeZone: zone };
    case 'weekly': {
      const days = Array.isArray(config.days) ? (config.days.filter((d) => (WEEKDAYS as readonly JsonValue[]).includes(d)) as Weekday[]) : [];
      return { rule: { repeat: 'weekly', days, at }, timeZone: zone };
    }
    case 'monthly': {
      const day = config.day === 'last' ? 'last' : typeof config.day === 'number' ? config.day : 1;
      return { rule: { repeat: 'monthly', day, at }, timeZone: zone };
    }
    case 'every': {
      const rule = typeof config.every === 'string' ? everyRule(config.every) : null;
      return rule ? { rule, timeZone: zone } : null;
    }
    case 'once':
      if (at.length === 16 && at[10] === 'T') return { rule: { repeat: 'once', date: at.slice(0, 10), at: at.slice(11) }, timeZone: zone };
      return null;
  }
  return null;
}

/** A fresh rule of each kind, for the editor's repeat selector. */
export function defaultRule(repeat: ScheduleRepeat, today: Date = new Date()): ScheduleRule {
  switch (repeat) {
    case 'daily':
      return { repeat: 'daily', at: '08:00' };
    case 'weekly':
      return { repeat: 'weekly', days: ['mon'], at: '08:00' };
    case 'monthly':
      return { repeat: 'monthly', day: 1, at: '08:00' };
    case 'every':
      return { repeat: 'every', amount: 1, unit: 'h' };
    case 'once': {
      const d = new Date(today.getTime() + 24 * 3600 * 1000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { repeat: 'once', date: iso, at: '09:00' };
    }
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "Every day at 08:00", "Every Monday and Thursday at 08:00", "Every 15 minutes", "Once on 2026-11-02 at 09:00". */
export function scheduleSentence(rule: ScheduleRule): string {
  switch (rule.repeat) {
    case 'daily':
      return `Every day at ${rule.at}`;
    case 'weekly': {
      const days = WEEKDAYS.filter((d) => rule.days.includes(d));
      if (!days.length) return 'Every week: pick at least one day';
      if (days.length === 7) return `Every day at ${rule.at}`;
      if (days.length === 5 && !days.includes('sat') && !days.includes('sun')) return `Every weekday at ${rule.at}`;
      return `Every ${joinWords(days.map((d) => WEEKDAY_NAMES[d]))} at ${rule.at}`;
    }
    case 'monthly':
      return `Every month on the ${rule.day === 'last' ? 'last day' : ordinal(rule.day)} at ${rule.at}`;
    case 'every':
      return rule.amount === 1 ? `Every ${rule.unit === 'm' ? 'minute' : 'hour'}` : `Every ${rule.amount} ${rule.unit === 'm' ? 'minutes' : 'hours'}`;
    case 'once':
      return `Once, on ${rule.date} at ${rule.at}`;
  }
}

/** A rule's sentence with its clock ("… (Europe/Paris)"); intervals have no clock. */
export function scheduleSentenceWithZone(rule: ScheduleRule, timeZone: string | null): string {
  const sentence = scheduleSentence(rule);
  return rule.repeat === 'every' || !timeZone ? sentence : `${sentence} (${zoneCity(timeZone)})`;
}

/** The pre-calendar schedule (schedule@1, fixed UTC intervals) in words. */
export function legacyScheduleSentence(config: Record<string, JsonValue>): string {
  if (typeof config.every === 'string') {
    const rule = everyRule(config.every);
    if (rule) return scheduleSentence(rule);
    return `Every ${config.every}`;
  }
  if (typeof config.start_at === 'string') return `Once, at ${config.start_at.replace('T', ' ').replace(/:00(\.\d+)?Z$/, ' UTC')}`;
  return 'Once, when created';
}

// ---------------------------------------------------------------------------
// Choice <-> trigger
// ---------------------------------------------------------------------------

/**
 * The `automation_defaults.trigger` of a choice, resolved against the served
 * sources. Throws (in plain words) when the gateway does not serve what the
 * choice needs: never a silent fallback to another source.
 */
export function triggerFromChoice(choice: TriggerChoice, sources: readonly TriggerSourceItem[]): AutomationTriggerDefaults {
  switch (choice.kind) {
    case 'schedule': {
      const source = scheduleSource(sources);
      if (!source) throw new AutomationChoiceError('This gateway cannot run calendar schedules yet: update the gateway.');
      return { source_id: source.id, source_version: source.version, config: scheduleConfig(choice.rule, choice.timeZone) };
    }
    case 'mail': {
      const source = mailSource(sources);
      if (!source) throw new AutomationChoiceError('This gateway cannot watch mailboxes.');
      if (!choice.account.trim()) throw new AutomationChoiceError('Choose a mailbox.');
      return { source_id: source.id, source_version: source.version, config: { account: choice.account } };
    }
    case 'connection': {
      const source = connectionSources(sources).find((s) => s.id === choice.sourceId && s.version === choice.sourceVersion);
      if (!source) throw new AutomationChoiceError('This gateway no longer serves that kind of connection.');
      if (!choice.connectionId.trim()) throw new AutomationChoiceError('Choose a connection.');
      return { source_id: source.id, source_version: source.version, config: {}, connection_id: choice.connectionId };
    }
    case 'manual': {
      const source = manualSource(sources);
      if (!source) throw new AutomationChoiceError('This gateway has no Run now trigger.');
      return { source_id: source.id, source_version: source.version, config: {} };
    }
  }
}

/** What a saved trigger is, as a choice (null: a source the picker does not know). */
export function choiceFromTrigger(
  trigger: AutomationTriggerDefaults,
  sources: readonly TriggerSourceItem[],
  fallbackTimeZone: string
): TriggerChoice | { kind: 'legacy-schedule'; sentence: string; seed: ScheduleRule | null } | null {
  const source = available(sources).find((s) => s.id === trigger.source_id && s.version === trigger.source_version);
  if (trigger.source_id === 'schedule' && trigger.source_version === 1) {
    const seed = typeof trigger.config.every === 'string' ? everyRule(trigger.config.every) : null;
    return { kind: 'legacy-schedule', sentence: legacyScheduleSentence(trigger.config), seed };
  }
  if (trigger.source_id === 'schedule' && trigger.source_version === 2) {
    const parsed = ruleFromScheduleConfig(trigger.config);
    return parsed ? { kind: 'schedule', rule: parsed.rule, timeZone: parsed.timeZone || fallbackTimeZone } : null;
  }
  if (!source) return null;
  if (source.capabilities.kind === 'manual') return { kind: 'manual' };
  if (source.connection_provider === 'email_accounts' && source.needs_connection) {
    const account = typeof trigger.config.account === 'string' ? trigger.config.account : 'default';
    return { kind: 'mail', account: account === 'self' ? 'default' : account };
  }
  if (source.uses_trigger_connection) {
    const cid = trigger.connection_id || (typeof trigger.config.connection_id === 'string' ? trigger.config.connection_id : '');
    return { kind: 'connection', connectionId: cid, sourceId: source.id, sourceVersion: source.version };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A mailbox's name for a person: its address, else "your main mailbox" / its id. */
export function mailboxName(account: string, mailboxes: readonly Mailbox[] | null): string {
  const id = account === 'self' || !account ? 'default' : account;
  const box = mailboxes?.find((m) => m.account_id === id);
  if (box?.address) return box.address;
  return id === 'default' ? 'your main mailbox' : id;
}

/** Mailboxes the person can pick (connected, with an incoming server), the primary first. */
export function readableMailboxes(mailboxes: readonly Mailbox[]): Mailbox[] {
  return [...mailboxes].filter((m) => m.configured && m.can_read).sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** The kind of thing a connection source delivers, for its sentence. */
export function connectionKind(sourceId: string): 'feed' | 'webhook' | 'other' {
  if (sourceId.startsWith('feed')) return 'feed';
  if (sourceId.startsWith('webhook')) return 'webhook';
  return 'other';
}

/** "When Release notes has a new item" / "When CI hook is called". */
export function connectionSentence(label: string, sourceId: string): string {
  switch (connectionKind(sourceId)) {
    case 'feed':
      return `When ${label} has a new item`;
    case 'webhook':
      return `When ${label} is called`;
    default:
      return `When ${label} sends something`;
  }
}

/** One line of plain help under the chosen trigger. */
export function choiceHelp(choice: { kind: StartChoice['kind'] | 'legacy-schedule'; sourceId?: string }): string {
  switch (choice.kind) {
    case 'chat':
      return 'Someone writes to it in the Assistant or Code, and each message runs the flow.';
    case 'schedule':
    case 'legacy-schedule':
      return 'Runs on this clock, even when nobody is around.';
    case 'mail':
      return 'Runs every time a new message lands in that mailbox; the flow receives the messages.';
    case 'connection':
      return connectionKind(choice.sourceId || '') === 'webhook'
        ? 'Runs every time that address is called; the flow receives what was sent.'
        : connectionKind(choice.sourceId || '') === 'feed'
          ? 'Runs every time the feed publishes something new; the flow receives the new items.'
          : 'Runs every time it delivers something new; the flow receives it.';
    case 'manual':
      return 'Runs only when someone presses Run now in Observer or the Assistant.';
  }
}

export interface AutomationWords {
  mailboxes?: readonly Mailbox[] | null;
  connections?: readonly TriggerConnection[] | null;
}

/** The trigger of saved defaults in words ("Every day at 08:00 (Europe/Paris)", "When mail arrives in me@x"). */
export function triggerSentence(trigger: AutomationTriggerDefaults, words: AutomationWords = {}): string {
  const { source_id, source_version, config } = trigger;
  if (source_id === 'schedule' && source_version === 1) return legacyScheduleSentence(config);
  if (source_id === 'schedule') {
    const parsed = ruleFromScheduleConfig(config);
    return parsed ? scheduleSentenceWithZone(parsed.rule, parsed.timeZone) : 'On a schedule';
  }
  if (source_id === 'manual') return 'By hand (Run now)';
  if (source_id.startsWith('email')) {
    return `When mail arrives in ${mailboxName(typeof config.account === 'string' ? config.account : 'default', words.mailboxes || null)}`;
  }
  const cid = trigger.connection_id || (typeof config.connection_id === 'string' ? config.connection_id : '');
  if (cid) {
    const conn = words.connections?.find((c) => c.connection_id === cid);
    const label = conn ? conn.label : connectionKind(source_id) === 'feed' ? 'a feed' : connectionKind(source_id) === 'webhook' ? 'a webhook' : 'a connection';
    return connectionSentence(label, source_id);
  }
  return 'When an event arrives';
}

/** The nature of a flow, for the editor header and the library row ("Automation · …", "Chat"). */
export function flowNature(
  flow: { automation_defaults?: AutomationDefaults | null },
  executable: boolean,
  words: AutomationWords = {}
): { kind: 'automation' | 'chat' | 'none'; text: string } {
  if (flow.automation_defaults) return { kind: 'automation', text: `Automation · ${triggerSentence(flow.automation_defaults.trigger, words)}` };
  if (executable) return { kind: 'chat', text: 'Chat' };
  return { kind: 'none', text: '' };
}

/** Does this choice deliver content as the run's event (the flow needs the Trigger event node)? */
export function choiceDeliversEvent(choice: StartChoice): boolean {
  return choice.kind === 'mail' || choice.kind === 'connection';
}

/** The person's time zone: the account's (from the gateway) else this browser's. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Fresh automation defaults for a choice (independent runs, no inputs yet). */
export function automationFromChoice(choice: TriggerChoice, sources: readonly TriggerSourceItem[]): AutomationDefaults {
  return { schema_version: 1, trigger: triggerFromChoice(choice, sources), context: { mode: 'independent' }, input_data: {} };
}

// ---------------------------------------------------------------------------
// Context: independent runs, or a growing conversation with a token budget
// ---------------------------------------------------------------------------

/** 12000 -> "12,000". */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

/** The budget field's text for saved context (the saved budget, else the gateway's default). */
export function budgetText(context: AutomationDefaults['context'] | undefined, historyDefault: number | null): string {
  const saved = context?.growing?.max_tokens;
  if (typeof saved === 'number') return formatTokens(saved);
  return historyDefault ? formatTokens(historyDefault) : '';
}

/**
 * The context to save. A budget equal to the gateway's default is not
 * written: the automation follows the ONE central default (change it there,
 * every automation follows). An empty field means the default too.
 */
export function contextFromForm(
  mode: AutomationDefaults['context']['mode'],
  text: string,
  historyDefault: number | null
): { context: AutomationDefaults['context'] } | { problem: string } {
  if (mode !== 'growing') return { context: { mode } };
  const raw = text.replace(/[\s,_]/g, '');
  if (!raw) return { context: { mode } };
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1) return { problem: 'Remembers up to: enter a whole number of tokens, at least 1.' };
  if (historyDefault !== null && n === historyDefault) return { context: { mode } };
  return { context: { mode, growing: { max_tokens: n } } };
}
