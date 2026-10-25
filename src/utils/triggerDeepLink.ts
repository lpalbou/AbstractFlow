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
 * it) and opens the New flow dialog with "What starts it?" on that trigger
 * and a proposed title ("<connection name> digest", "<mailbox> handling").
 * A trigger that is not among the person's connections leaves the picker on
 * "When something arrives" with one plain line saying so.
 *
 * The ids are the ones TriggerChoice carries (utils/automationChoice.ts):
 * `{kind:'connection', connectionId}` and `{kind:'mail', account}`; the
 * picker keys them `conn:<id>` and `mail:<id>` (utils/automationPicker.ts).
 */
import { arrivalOptions, type PickerState } from './automationPicker';
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
