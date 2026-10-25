/**
 * Open Flow straight into "New flow for this trigger" (the gateway console's
 * Triggers page links here from a trigger row).
 *
 *   <flow>/?trigger=<connection id>        a feed or webhook connection
 *   <flow>/?trigger=mail:<mailbox id>      a mailbox (email.received)
 *
 * Standalone (http://127.0.0.1:3005/?trigger=…) and through the gateway
 * (/apps/flow/?trigger=…) alike. Once the gateway connection is up, the
 * toolbar removes the parameter from the address (a reload does not reopen
 * it) and opens the New flow dialog with the link. The dialog keeps it
 * PENDING (`settleLinkedTrigger`) while its lists load, showing "When
 * something arrives" with a spinner where the list will be; once the
 * mailboxes and connections have answered (on a public gateway that can take
 * 15 s), it applies the link ONCE: that trigger picked and a proposed title
 * ("<connection name> digest", "<mailbox> handling"), unless the person
 * already changed the picker or the title. A trigger that is not among the
 * person's connections leaves the picker on "When something arrives" with
 * one plain line saying so. A list that could not be read keeps the link
 * pending: its Retry applies it when the list answers.
 *
 * The ids are the ones TriggerChoice carries (utils/automationChoice.ts):
 * `{kind:'connection', connectionId}` and `{kind:'mail', account}`; the
 * picker keys them `conn:<id>` and `mail:<id>` (utils/automationPicker.ts).
 */
import { arrivalOptions, emptyPicker, type PickerState } from './automationPicker';
import { pickerSupport } from '../components/automation/TriggerPicker';
import type { AutomationFacts } from '../components/automation/useAutomationFacts';

export const TRIGGER_PARAM = 'trigger';

export type TriggerLink =
  | { kind: 'connection'; connectionId: string; raw: string }
  | { kind: 'mail'; account: string; raw: string };

export const TRIGGER_LINK_MISSING_ID =
  'This link does not name a trigger: it needs ?trigger=<connection id> or ?trigger=mail:<mailbox id>.';

/** `null` when the page was opened without `?trigger=` (the normal editor start). */
export function parseTriggerLink(search: string): TriggerLink | { error: string } | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return null;
  }
  if (!params.has(TRIGGER_PARAM)) return null;
  const raw = String(params.get(TRIGGER_PARAM) || '').trim();
  if (raw.startsWith('mail:')) {
    const account = raw.slice('mail:'.length).trim();
    return account ? { kind: 'mail', account, raw } : { error: TRIGGER_LINK_MISSING_ID };
  }
  return raw ? { kind: 'connection', connectionId: raw, raw } : { error: TRIGGER_LINK_MISSING_ID };
}

/** The same address without `?trigger=` (other parameters and the hash kept), relative to the origin. */
export function withoutTriggerParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(TRIGGER_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The picker key of a linked trigger (`conn:<id>` / `mail:<id>`). */
export function triggerLinkKey(link: TriggerLink): string {
  return link.kind === 'mail' ? `mail:${link.account}` : `conn:${link.connectionId}`;
}

export function triggerNotFoundLine(link: TriggerLink): string {
  return `The trigger ${link.raw} is not among your connections.`;
}

export type TriggerLinkResolution =
  /** The person's mailboxes / connections are still loading. */
  | { state: 'waiting'; picker: PickerState }
  /** Preselected, with a proposed title. */
  | { state: 'found'; picker: PickerState; name: string }
  /** Not among the person's connections (or it cannot start a flow): say so in one line. */
  | { state: 'missing'; picker: PickerState; line: string }
  /** The list could not be read: the picker already says why (its arrivals note). */
  | { state: 'unreadable'; picker: PickerState };

const ARRIVES: PickerState = { start: 'arrives', arrival: '' };

/** Where a linked trigger lands in the New flow dialog, from the loaded facts (pure). */
export function resolveTriggerLink(
  link: TriggerLink,
  facts: Pick<AutomationFacts, 'sources' | 'mailboxes' | 'connections'>
): TriggerLinkResolution {
  const list = link.kind === 'mail' ? facts.mailboxes : facts.connections;
  if (facts.sources.state === 'loading' || list.state === 'loading') return { state: 'waiting', picker: ARRIVES };
  const { data } = pickerSupport(facts);
  if (list.state === 'error' || (link.kind === 'mail' ? !data.mailboxes : !data.connections) || !data.sources.length) {
    return { state: 'unreadable', picker: ARRIVES };
  }
  const key = triggerLinkKey(link);
  const option = arrivalOptions(data).find((o) => o.key === key);
  if (!option) return { state: 'missing', picker: ARRIVES, line: triggerNotFoundLine(link) };
  if (option.disabled) {
    return { state: 'missing', picker: ARRIVES, line: `The trigger ${link.raw} cannot start a flow (${option.hint || 'it is not available'}).` };
  }
  return { state: 'found', picker: { start: 'arrives', arrival: key }, name: proposedFlowName(link, data) };
}

/** "<connection name> digest" / "<mailbox> handling" (the person edits it freely). */
export function proposedFlowName(link: TriggerLink, data: ReturnType<typeof pickerSupport>['data']): string {
  if (link.kind === 'mail') {
    const box = (data.mailboxes || []).find((b) => b.account_id === link.account);
    const label = box?.address || (box?.primary ? 'Main mailbox' : link.account);
    return `${label} handling`;
  }
  const conn = (data.connections || []).find((c) => c.connection_id === link.connectionId);
  return `${(conn?.label || '').trim() || link.connectionId} digest`;
}

/**
 * "What starts it?" and the title in the New flow dialog. `null` means not
 * touched by the person: the picker shows "When something arrives" (a link)
 * or chat (no link), the title shows `proposedName`.
 */
export interface NewFlowStartState {
  picker: PickerState | null;
  name: string | null;
  /** The linked trigger, kept until the lists it needs have answered. */
  pending: TriggerLink | null;
  /** The title the link proposes (set when it is applied). */
  proposedName: string;
  /** Why the link picked nothing; shown until the person changes the picker. */
  line: string;
}

export function initialNewFlowStart(link: TriggerLink | null): NewFlowStartState {
  return { picker: link ? null : emptyPicker('chat'), name: null, pending: link, proposedName: '', line: '' };
}

/** The picker the dialog shows. */
export function newFlowPicker(state: NewFlowStartState): PickerState {
  return state.picker ?? ARRIVES;
}

/**
 * Applies a pending link once its lists have answered (pure; returns `state`
 * itself while there is nothing to do, so a render can call it every time):
 * found = that trigger picked and a proposed title; missing = nothing picked
 * and one line saying so. What the person already changed is kept. While the
 * lists load, or after a read failed, the link stays pending.
 */
export function settleLinkedTrigger(
  state: NewFlowStartState,
  facts: Pick<AutomationFacts, 'sources' | 'mailboxes' | 'connections'>
): NewFlowStartState {
  if (!state.pending) return state;
  const out = resolveTriggerLink(state.pending, facts);
  if (out.state === 'waiting' || out.state === 'unreadable') return state;
  const untouched = state.picker === null;
  if (out.state === 'found') {
    return { ...state, pending: null, picker: untouched ? out.picker : state.picker, proposedName: out.name, line: '' };
  }
  return { ...state, pending: null, picker: untouched ? out.picker : state.picker, line: untouched ? out.line : '' };
}
