/**
 * "After the run" (framework ADR-0041, "No hidden effects after a flow"):
 * On Flow End records the outcome (response, success, note) and acts on
 * nobody; every effect toward a person is an explicit node (Notify me). What
 * happened after a run — what arrived, when it ran, the alert it raised or
 * why nothing rang, and each delivery with its channel and route — is read
 * from the gateway (`GET /api/gateway/runs/{run_id}/after`) and said in words
 * here. Pure: the shape in, sentences out.
 */
import { gatewayJson } from './gatewayClient';

export type RunAfterDelivery = {
  record_key?: string | null;
  channel: string;
  via: 'push' | 'stream' | 'outbox' | string;
  device?: string;
  device_name?: string;
  time?: string | null;
  state: 'sent' | 'failed' | string;
  reason?: string;
};

export type RunAfterAlert = {
  record_key: string;
  kind?: string | null;
  title?: string | null;
  raised_at?: string | null;
  from?: 'flow_end' | 'failure' | 'notify_me' | 'publish' | 'wait' | 'email_when_done' | string;
  step_id?: string | null;
  /** A wait (the run or a sub-run parked on the person): the run it is on, and whether it is still open. */
  run_id?: string | null;
  prompt_ref?: string | null;
  open?: boolean;
  /** A published alert (Notify me): whom it was for ("me") and the channels it asked for ("all" = every channel). */
  recipient?: string | null;
  asked?: string[] | 'all' | null;
};

export type RunAfter = {
  run_id: string;
  trigger: {
    automation_id?: string;
    automation_title?: string | null;
    source?: string | null;
    text?: string | null;
    connection?: string | null;
    fired_at?: string | null;
    arrived?: { count: number; noun: string; line?: string | null } | null;
  } | null;
  run: {
    run_id?: string;
    status?: string;
    started?: string | null;
    ended?: string | null;
    response_excerpt?: string | null;
    note?: string | null;
  };
  attention: RunAfterAlert | null;
  alerts?: RunAfterAlert[];
  deliveries: RunAfterDelivery[];
  quiet_reason?: string;
};

/** The route of one run (a read: tried up to 3 times, ADR-0039). */
export function readRunAfter(runId: string): Promise<RunAfter> {
  return gatewayJson<RunAfter>(`api/gateway/runs/${encodeURIComponent(runId)}/after`);
}

const CHANNEL_WORDS: Record<string, string> = {
  console: 'Console',
  tray: 'Tray',
  watch: 'Watch',
  phone: 'Phone',
  email: 'Email',
  assistant: 'Assistant',
  code: 'Code',
};

export function channelWord(channel: string): string {
  return CHANNEL_WORDS[channel] || channel;
}

/** How it travelled, in words. */
export function routeWord(via: string): string {
  if (via === 'push') return 'push notification';
  if (via === 'outbox') return 'email';
  return 'shown by the app';
}

/** Why nothing rang, in words (the gateway's `quiet_reason`). */
export function quietSentence(reason: string | undefined): string {
  switch (reason) {
    case 'empty title':
      return 'Nothing to notify: the title was empty.';
    case 'no notify':
      return 'Nothing to notify: this flow has no Notify me step.';
    case 'still running':
      return 'Still running: nothing has been sent yet.';
    case 'not recorded yet':
      return 'Finished; the automation has not recorded what it sends yet.';
    default:
      return reason ? `Nothing was sent (${reason}).` : 'Nothing was sent.';
  }
}

/** "4 new emails: “O” from codex@… and 3 more" (null when nothing arrived: a schedule, by hand). */
export function arrivedSentence(after: RunAfter): string | null {
  const a = after.trigger?.arrived;
  if (!a) return null;
  return a.line ? `${a.count} ${a.noun}: ${a.line}` : `${a.count} ${a.noun}`;
}

/** What the alert says, in words (a wait has no title of its own). */
export function alertTitle(alert: RunAfterAlert): string {
  if (alert.title) return `“${alert.title}”`;
  if (alert.from === 'wait') return alert.kind === 'question' ? 'A question for you' : 'An approval for you';
  if (alert.from === 'email_when_done') return alert.kind === 'failure' ? 'It failed' : 'It finished';
  return 'Untitled';
}

/** Where the alert came from, in words. */
export function alertSource(alert: RunAfterAlert): string {
  if (alert.from === 'wait') return alert.open ? 'waiting for your answer' : 'answered';
  if (alert.from === 'email_when_done') return 'Email me when done';
  if (alert.from === 'notify_me') return 'Notify me';
  if (alert.from === 'failure') return 'The run failed';
  if (alert.from === 'publish') return 'Publish to channel, with Alert on';
  return 'On Flow End’s notify (older flows)';
}

/** What a Notify me alert asked for, in words: "asked: watch, phone", "asked: all my channels" (null: not a Notify me alert). */
export function askedSentence(alert: RunAfterAlert): string | null {
  if (alert.asked === 'all') return 'asked: all my channels';
  if (Array.isArray(alert.asked) && alert.asked.length) return `asked: ${alert.asked.join(', ')}`;
  return null;
}

/** One delivery in words: "Watch (Laurent’s Watch) · push notification · sent". */
export function deliverySentence(d: RunAfterDelivery): string {
  const where = d.device_name ? `${channelWord(d.channel)} (${d.device_name})` : channelWord(d.channel);
  // The console lists the item: that listing is its delivery.
  if (d.channel === 'console') return `${where} · listed · ${d.state === 'failed' ? 'not listed' : 'sent'}`;
  const state = d.state === 'failed' ? `not delivered${d.reason ? `: ${d.reason}` : ''}` : 'sent';
  return `${where} · ${routeWord(d.via)} · ${state}`;
}

/**
 * Deliveries are recorded after the run ends (the automation decides, then
 * the tray, the phone and the watch report): read again a few times while the
 * record is still filling. `tries` = reads already done.
 */
export const AFTER_REREAD_MS = 3_000;
export const AFTER_REREADS = 5;
export function shouldReadAgain(after: RunAfter, tries: number): boolean {
  if (tries > AFTER_REREADS) return false;
  if (after.quiet_reason === 'not recorded yet' || after.quiet_reason === 'still running') return true;
  return Boolean(after.attention) && after.deliveries.length === 0;
}

/** Should a run view show "After the run": a triggered flow, or a run an automation started. */
export function showsAfterTheRun(opts: { triggered: boolean; automationId?: string | null; originKind?: string | null }): boolean {
  return opts.triggered || Boolean(opts.automationId) || opts.originKind === 'trigger';
}

/**
 * Notify me (a Publish to channel preset: channel "me", Alert on) is the
 * node that reaches the person. Who: you (another account comes later).
 * Where: the channels saved in the node's effectConfig (`channels`), passed
 * by the compiled workflow to the gateway, where each deliverer honours them:
 * the tray, push (the watch first, else the phone), email (when a mailbox is
 * connected). No `channels` = every channel (older flows, "All my channels").
 * The console lists every alert: it is the record itself.
 */
export type NotifyChannel = 'tray' | 'watch' | 'phone' | 'email';
export const NOTIFY_CHANNELS: ReadonlyArray<NotifyChannel> = ['tray', 'watch', 'phone', 'email'];

/** Is this node Notify me (Publish to channel with its channel fixed: no channel pin)? */
export function isNotifyMeNode(data: { nodeType?: string; inputs?: ReadonlyArray<{ id: string }> }): boolean {
  return data.nodeType === 'publish_event' && !(data.inputs || []).some((p) => p.id === 'channel');
}

/** The channels a Notify me node saved (canonical order), or null: every channel. */
export function notifyMeChannels(data: { effectConfig?: { channels?: unknown } | null }): NotifyChannel[] | null {
  const raw = data.effectConfig?.channels;
  if (!Array.isArray(raw)) return null;
  const picked = NOTIFY_CHANNELS.filter((c) => raw.includes(c));
  return picked.length ? picked : null;
}

/**
 * The "Where" choices of Notify me, in Properties: chips, several allowed.
 * "All my channels" is the absence of a choice; the others add their channels.
 */
export const NOTIFY_ME_CHANNEL_CHOICES: ReadonlyArray<{ value: string; label: string; channels: ReadonlyArray<NotifyChannel> }> = [
  { value: 'all', label: 'All my channels', channels: [] },
  { value: 'tray', label: 'Tray', channels: ['tray'] },
  { value: 'push', label: 'Watch and phone', channels: ['watch', 'phone'] },
  { value: 'email', label: 'Email', channels: ['email'] },
];

/** Is this chip on for the saved channels? */
export function notifyChoiceOn(choice: { value: string; channels: ReadonlyArray<NotifyChannel> }, channels: NotifyChannel[] | null): boolean {
  if (choice.value === 'all') return channels === null;
  return channels !== null && choice.channels.every((c) => channels.includes(c));
}

/**
 * The channels after a chip is pressed: "All my channels" clears the choice;
 * another chip toggles its channels; none left = all again (null).
 */
export function toggleNotifyChoice(channels: NotifyChannel[] | null, value: string): NotifyChannel[] | null {
  const choice = NOTIFY_ME_CHANNEL_CHOICES.find((c) => c.value === value);
  if (!choice || choice.value === 'all') return null;
  const current = new Set<NotifyChannel>(channels || []);
  const on = notifyChoiceOn(choice, channels);
  for (const c of choice.channels) {
    if (on) current.delete(c);
    else current.add(c);
  }
  const next = NOTIFY_CHANNELS.filter((c) => current.has(c));
  return next.length ? next : null;
}

/** Whom Notify me reaches and how, in words on the node: "You: watch and phone", "You: all my channels". */
export function notifyMeReaches(channels: NotifyChannel[] | null): string {
  if (channels === null) return 'You: all my channels';
  const has = (c: NotifyChannel) => channels.includes(c);
  const words: string[] = [];
  if (has('tray')) words.push('tray');
  if (has('watch') && has('phone')) words.push('watch and phone');
  else if (has('watch')) words.push('watch');
  else if (has('phone')) words.push('phone');
  if (has('email')) words.push('email');
  return `You: ${words.join(' · ')}`;
}

/** The node line of a Notify me without a choice (older flows, "All my channels"). */
export const NOTIFY_ME_REACHES = notifyMeReaches(null);

export const NOTIFY_ME_CHANNEL_HELP =
  'All my channels: the tray, the watch or the phone (the watch first), email when a mailbox is connected. Choose one or several to narrow it. The console lists every alert. Notifying someone else comes later.';
