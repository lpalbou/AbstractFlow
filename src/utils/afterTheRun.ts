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
 * node that reaches the person. Where it reaches them today, in words on the
 * node: the tray, the watch or the phone (push), the Assistant. Email is not
 * sent for it (the email outbox delivers automation results only).
 */
export const NOTIFY_ME_REACHES = 'You: tray · watch and phone · Assistant';

/** Is this node Notify me (Publish to channel with its channel fixed: no channel pin)? */
export function isNotifyMeNode(data: { nodeType?: string; inputs?: ReadonlyArray<{ id: string }> }): boolean {
  return data.nodeType === 'publish_event' && !(data.inputs || []).some((p) => p.id === 'channel');
}

/**
 * The channel choice of Notify me, in Properties. Only "All my channels" is
 * delivered today: choosing one channel needs the runtime to pass a
 * `channels` input to the gateway and each channel to honour it (ADR-0041,
 * Consequences), so the other choices are shown, not offered.
 */
export const NOTIFY_ME_CHANNEL_CHOICES: ReadonlyArray<{ value: string; label: string; available: boolean }> = [
  { value: 'all', label: 'All my channels', available: true },
  { value: 'tray', label: 'Tray only', available: false },
  { value: 'push', label: 'Phone and watch only', available: false },
  { value: 'email', label: 'Email only', available: false },
];
export const NOTIFY_ME_CHANNEL_HELP =
  'Today Notify me reaches every channel above except email. Choosing one channel, and notifying someone else, come later.';
