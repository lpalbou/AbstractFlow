/**
 * What starts a flow, in human words (operator 2026-10-25: "the list of
 * triggers is absolutely not actionable by a human").
 *
 * The person picks a CHOICE ("When mail arrives in me@example.org", "When
 * Release notes has a new item", "By hand"); this module maps it to and from
 * `automation_defaults.trigger`:
 *
 *   mail      -> the source whose descriptor says `connection_provider:
 *                email_accounts` (email.received), `config.account` = the
 *                mailbox id (`GET /api/gateway/me/email` -> accounts);
 *   connection-> a feed / webhook source (`uses_trigger_connection`), the
 *                connection saved as `trigger.connection_id`;
 *   manual    -> the source whose capability kind is `manual`.
 *
 * Flow never sets a schedule (operator ruling 2026-10-25: a schedule is a
 * property of an automation, set in Observer or the Assistant; Flow designs
 * and tests workflows). A flow saved earlier with a schedule trigger
 * (schedule@1 or @2) still loads: it is described in words
 * (triggerSentence) and kept until the person picks another start.
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

export type TriggerChoice =
  | { kind: 'mail'; account: string }
  | { kind: 'connection'; connectionId: string; sourceId: string; sourceVersion: number }
  | { kind: 'manual' };

/** The New flow question adds "A person, in a chat" (no automation). */
export type StartChoice = { kind: 'chat' } | TriggerChoice;
export type StartKind = 'chat' | 'arrives' | 'manual';

/** Where a schedule is set (never in Flow), said wherever a schedule shows. */
export const SCHEDULE_ELSEWHERE = 'Schedules are set in Observer or the Assistant.';

/** Is this saved trigger a schedule (an older save: Flow no longer offers one)? */
export function isScheduleTrigger(trigger: Pick<AutomationTriggerDefaults, 'source_id'> | null | undefined): boolean {
  return Boolean(trigger && trigger.source_id === 'schedule');
}

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

function available(sources: readonly TriggerSourceItem[]): AvailableTriggerSource[] {
  return sources.filter((s): s is AvailableTriggerSource => s.available);
}

function latest(list: AvailableTriggerSource[]): AvailableTriggerSource | null {
  return list.reduce<AvailableTriggerSource | null>((best, s) => (!best || s.version > best.version ? s : best), null);
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
// A saved schedule (an older save) in words
// ---------------------------------------------------------------------------

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

/** A schedule@2 config back to a rule, for its sentence (null when it cannot be said). */
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

/**
 * What a saved trigger is, as a choice. Null: one the picker does not offer
 * (a schedule from an older save, an unknown source): the dialog keeps it
 * and says it in words until the person picks another start.
 */
export function choiceFromTrigger(trigger: AutomationTriggerDefaults, sources: readonly TriggerSourceItem[]): TriggerChoice | null {
  if (isScheduleTrigger(trigger)) return null;
  const source = available(sources).find((s) => s.id === trigger.source_id && s.version === trigger.source_version);
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
export function choiceHelp(choice: { kind: StartChoice['kind']; sourceId?: string }): string {
  switch (choice.kind) {
    case 'chat':
      return 'Someone writes to it in the Assistant or Code, and each message runs the flow.';
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

/** The trigger of saved defaults in words ("When mail arrives in me@x"; an older save's "Every day at 08:00 (Paris)"). */
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
