/**
 * The trigger picker's state and its pure mapping to a choice
 * (utils/automationChoice.ts). Shared by the New flow question and the
 * Automation dialog, tested without a DOM.
 */
import type { AutomationTriggerDefaults } from '../types/flow';
import {
  choiceFromTrigger,
  connectionSentence,
  connectionSources,
  defaultRule,
  mailSource,
  readableMailboxes,
  scheduleRuleProblems,
  type Mailbox,
  type ScheduleRule,
  type StartChoice,
  type StartKind,
  type TriggerChoice,
} from './automationChoice';
import type { TriggerSourceItem } from './triggerSources';
import type { TriggerConnection } from './triggerConnections';

export interface PickerState {
  start: StartKind | null;
  rule: ScheduleRule;
  /** `mail:<account_id>` or `conn:<connection_id>`. */
  arrival: string;
  /** An old flow's schedule@1, kept as is until the person edits the schedule. */
  legacy: { trigger: AutomationTriggerDefaults; sentence: string } | null;
}

export interface PickerData {
  sources: readonly TriggerSourceItem[];
  mailboxes: readonly Mailbox[] | null;
  connections: readonly TriggerConnection[] | null;
  timeZone: string;
}

export interface ArrivalOption {
  key: string;
  text: string;
  hint?: string;
  disabled?: boolean;
  choice: TriggerChoice;
}

export function emptyPicker(start: StartKind | null = null): PickerState {
  return { start, rule: defaultRule('daily'), arrival: '', legacy: null };
}

/** The things that can start a flow when they receive something, by their names. */
export function arrivalOptions(data: Pick<PickerData, 'sources' | 'mailboxes' | 'connections'>): ArrivalOption[] {
  const out: ArrivalOption[] = [];
  if (mailSource(data.sources) && data.mailboxes) {
    const readable = readableMailboxes(data.mailboxes);
    for (const box of readable) {
      out.push({
        key: `mail:${box.account_id}`,
        text: `When mail arrives in ${box.address || (box.primary ? 'your main mailbox' : box.account_id)}`,
        ...(box.enabled ? {} : { hint: 'this mailbox is switched off in your settings' }),
        choice: { kind: 'mail', account: box.account_id },
      });
    }
    for (const box of data.mailboxes) {
      if (box.configured && !box.can_read) {
        out.push({
          key: `mail:${box.account_id}`,
          text: `When mail arrives in ${box.address || box.account_id}`,
          hint: 'cannot be watched: it has no incoming server',
          disabled: true,
          choice: { kind: 'mail', account: box.account_id },
        });
      }
    }
  }
  const served = connectionSources(data.sources);
  for (const conn of data.connections || []) {
    const source = served.find((s) => s.id === conn.source_id && s.version === conn.source_version);
    if (!source) continue;
    out.push({
      key: `conn:${conn.connection_id}`,
      text: connectionSentence(conn.label, conn.source_id),
      ...(conn.status && conn.status !== 'active' ? { hint: conn.status } : {}),
      choice: { kind: 'connection', connectionId: conn.connection_id, sourceId: source.id, sourceVersion: source.version },
    });
  }
  return out;
}

/** The picker's choice, or the plain-words reason it is not complete. */
export function choiceFromPicker(state: PickerState, data: PickerData): { choice: StartChoice } | { problem: string } {
  switch (state.start) {
    case null:
      return { problem: 'Choose what starts it.' };
    case 'chat':
      return { choice: { kind: 'chat' } };
    case 'manual':
      return { choice: { kind: 'manual' } };
    case 'schedule': {
      const problems = scheduleRuleProblems(state.rule, data.timeZone);
      if (problems.length) return { problem: problems.join(' ') };
      return { choice: { kind: 'schedule', rule: state.rule, timeZone: data.timeZone } };
    }
    case 'arrives': {
      if (!state.arrival) return { problem: 'Choose what it listens to.' };
      const option = arrivalOptions(data).find((o) => o.key === state.arrival);
      if (option && !option.disabled) return { choice: option.choice };
      // A saved choice not in the lists (yet): keep it, the gateway checks it.
      if (state.arrival.startsWith('mail:')) return { choice: { kind: 'mail', account: state.arrival.slice(5) } };
      return { problem: 'That connection is not one of yours on this gateway: choose another.' };
    }
  }
}

/** Seed the picker from saved defaults. */
export function pickerFromTrigger(trigger: AutomationTriggerDefaults, data: PickerData): PickerState {
  const read = choiceFromTrigger(trigger, data.sources, data.timeZone);
  if (!read) return emptyPicker(null);
  switch (read.kind) {
    case 'legacy-schedule':
      return { start: 'schedule', rule: read.seed || defaultRule('daily'), arrival: '', legacy: { trigger, sentence: read.sentence } };
    case 'schedule':
      return { start: 'schedule', rule: read.rule, arrival: '', legacy: null };
    case 'mail':
      return { ...emptyPicker('arrives'), arrival: `mail:${read.account}` };
    case 'connection':
      return { ...emptyPicker('arrives'), arrival: read.connectionId ? `conn:${read.connectionId}` : '' };
    case 'manual':
      return emptyPicker('manual');
  }
}
