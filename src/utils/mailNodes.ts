/**
 * The Mail and Publish nodes' design-time rules (operator wave 2026-10-25):
 * which mailbox a node uses when none is chosen, the plain refusal for
 * sending from a read-only mailbox, the mailbox folders for Move to folder,
 * and the publish channel's rules (the gateway's own, events_stream.py
 * `record_published`: lowercase letters, digits, '.', '_' or '-', not the
 * gateway's `attention` channel).
 */
import type { AutomationTriggerDefaults } from '../types/flow';
import type { Mailbox } from './automationChoice';
import { GatewayHttpError, gatewayJson } from './gatewayClient';

export const MAIL_NODE_TYPES = [
  'mail_search',
  'mail_get',
  'mail_mark_read',
  'mail_mark_unread',
  'mail_flag',
  'mail_unflag',
  'mail_add_label',
  'mail_remove_label',
  'mail_move',
  'mail_delete',
  'mail_send',
  'mail_reply',
  'mail_forward',
  'mail_get_attachment',
] as const;
export const PUBLISH_NODE_TYPES = ['publish_event', 'notify_me'] as const;

/** Nodes that send mail (refused on a read-only mailbox). */
const SENDING = new Set(['mail_send', 'mail_reply', 'mail_forward']);

/** Channel names offered while typing (a channel is the person's own name). */
export const PUBLISH_CHANNEL_SUGGESTIONS = ['results', 'reports', 'alerts', 'mail'];

const CHANNEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A channel the gateway would refuse, in words (null = fine). */
export function publishChannelProblem(channel: string): string | null {
  const c = channel.trim();
  if (!c) return 'Name the channel applications subscribe to, e.g. results.';
  if (c === 'attention') return 'attention is the gateway’s own channel: turn on Also notify me to reach yourself.';
  if (!CHANNEL_RE.test(c)) return 'A channel name uses lowercase letters, digits, “.”, “_” or “-” (at most 64), e.g. results.';
  return null;
}

/**
 * The mailbox a node uses when none is chosen: the flow's trigger mailbox
 * (an email trigger's `config.account`), else the primary one.
 */
export function defaultMailboxFor(
  trigger: AutomationTriggerDefaults | null,
  mailboxes: readonly Mailbox[]
): { mailbox: Mailbox | null; fromTrigger: boolean; label: string } {
  if (trigger && trigger.source_id.startsWith('email')) {
    const account = typeof trigger.config.account === 'string' && trigger.config.account !== 'self' ? trigger.config.account : 'default';
    const box = mailboxes.find((m) => m.account_id === account) || null;
    return { mailbox: box, fromTrigger: true, label: `The trigger’s mailbox${box?.address ? ` (${box.address})` : ''}` };
  }
  const primary = mailboxes.find((m) => m.primary) || null;
  return { mailbox: primary, fromTrigger: false, label: `Your main mailbox${primary?.address ? ` (${primary.address})` : ''}` };
}

/**
 * Sending from a read-only mailbox, said plainly — only when the mailbox is
 * known at design time: a chosen one, the default for Send, or the trigger's
 * mailbox for Reply / Forward (they answer from the mailbox the email is in).
 */
export function mailSendRefusal(
  nodeType: string,
  mailbox: Mailbox | null,
  context: { mailboxChosen: boolean; triggerIsMail: boolean }
): string | null {
  if (!SENDING.has(nodeType) || !mailbox || mailbox.can_send) return null;
  const name = mailbox.address || mailbox.account_id;
  if (nodeType === 'mail_send') return `${name} is read-only: it can be watched but cannot send mail. Choose a mailbox that can send.`;
  if (!context.triggerIsMail && !context.mailboxChosen) return null;
  return `${name} is read-only: replies and forwards go out from it, and it cannot send mail. Connect its outgoing server in My email.`;
}

/** The mailbox's folders (`GET /api/gateway/me/email/accounts/{id}/folders` -> {folders: [{name}] | [name]}). */
export async function fetchMailboxFolders(
  accountId: string,
  fetchJson: (path: string) => Promise<unknown> = (path) => gatewayJson<unknown>(path)
): Promise<{ status: 'ok'; folders: string[] } | { status: 'unavailable'; reason: string }> {
  try {
    const raw = (await fetchJson(`api/gateway/me/email/accounts/${encodeURIComponent(accountId)}/folders`)) as { folders?: unknown };
    if (!raw || !Array.isArray(raw.folders)) throw new Error('the gateway answered without a folders list');
    const folders = raw.folders
      .map((f) => (typeof f === 'string' ? f : f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' ? (f as { name: string }).name : ''))
      .filter(Boolean);
    return { status: 'ok', folders };
  } catch (error) {
    if (error instanceof GatewayHttpError && error.status === 404) {
      return { status: 'unavailable', reason: 'This gateway does not list folders yet: type the folder name on the node.' };
    }
    throw error;
  }
}
