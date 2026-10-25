/**
 * The trigger picker's state and its pure mapping to a choice
 * (utils/automationChoice.ts). Shared by the New flow question and the
 * Automation dialog, tested without a DOM.
 */
import type { AutomationTriggerDefaults } from '../types/flow';
import {
  choiceFromTrigger,
  connectionKind,
  connectionSentence,
  connectionSources,
  mailSource,
  readableMailboxes,
  type Mailbox,
  type StartChoice,
  type StartKind,
  type TriggerChoice,
} from './automationChoice';
import type { TriggerSourceItem } from './triggerSources';
import type { TriggerConnection } from './triggerConnections';

/**
 * What the person picked. `start: null` on a saved flow = a start the picker
 * does not offer (a schedule from an older save): the Automation dialog keeps
 * the saved trigger until another start is picked.
 */
export interface PickerState {
  start: StartKind | null;
  /** `mail:<account_id>` or `conn:<connection_id>`. */
  arrival: string;
}

export interface PickerData {
  sources: readonly TriggerSourceItem[];
  mailboxes: readonly Mailbox[] | null;
  connections: readonly TriggerConnection[] | null;
}

export type ArrivalGroup = 'mailboxes' | 'feeds' | 'webhooks' | 'other';

export const ARRIVAL_GROUP_TITLES: Record<ArrivalGroup, string> = {
  mailboxes: 'Your mailboxes',
  feeds: 'Your feeds',
  webhooks: 'Your webhooks',
  other: 'Your other connections',
};

export interface ArrivalOption {
  key: string;
  text: string;
  group: ArrivalGroup;
  hint?: string;
  /** The hint is a problem (a broken or paused connection), shown in the warning tone. */
  warn?: boolean;
  disabled?: boolean;
  choice: TriggerChoice;
}

/** A connection's state in words: paused, or why it cannot read (its last error), else nothing. */
export function connectionStateWords(conn: Pick<TriggerConnection, 'status' | 'last_error'>): string {
  if (conn.last_error) {
    const cause = conn.last_error.cause || conn.last_error.code || 'it failed';
    return `not working: ${cause}${conn.last_error.fix ? ` ${conn.last_error.fix}` : ''}`.trim();
  }
  if (!conn.status || conn.status === 'active') return '';
  if (conn.status === 'paused') return 'paused';
  if (conn.status === 'error' || conn.status === 'failed') return 'not working';
  if (conn.status === 'disabled') return 'switched off';
  return conn.status;
}

export function emptyPicker(start: StartKind | null = null): PickerState {
  return { start, arrival: '' };
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
        group: 'mailboxes',
        ...(box.enabled ? {} : { hint: 'switched off in My email', warn: true }),
        choice: { kind: 'mail', account: box.account_id },
      });
    }
    for (const box of data.mailboxes) {
      if (box.configured && !box.can_read) {
        out.push({
          key: `mail:${box.account_id}`,
          text: `When mail arrives in ${box.address || box.account_id}`,
          group: 'mailboxes',
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
    const state = connectionStateWords(conn);
    const kind = connectionKind(conn.source_id);
    out.push({
      key: `conn:${conn.connection_id}`,
      text: connectionSentence(conn.label, conn.source_id),
      group: kind === 'feed' ? 'feeds' : kind === 'webhook' ? 'webhooks' : 'other',
      ...(state ? { hint: state, warn: true } : {}),
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

/** Seed the picker from saved defaults (nothing picked for a start it does not offer, e.g. an older schedule). */
export function pickerFromTrigger(trigger: AutomationTriggerDefaults, data: PickerData): PickerState {
  const read = choiceFromTrigger(trigger, data.sources);
  if (!read) return emptyPicker(null);
  switch (read.kind) {
    case 'mail':
      return { ...emptyPicker('arrives'), arrival: `mail:${read.account}` };
    case 'connection':
      return { ...emptyPicker('arrives'), arrival: read.connectionId ? `conn:${read.connectionId}` : '' };
    case 'manual':
      return emptyPicker('manual');
  }
}
