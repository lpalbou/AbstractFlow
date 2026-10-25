/**
 * What kind of flow this is, by what starts it (operator 2026-10-25: the
 * library must say at a glance which flows are which). The words are the
 * New flow question's ("What starts it?": A person, in a chat / On a
 * schedule / When something arrives / By hand):
 *
 *   chat       declares a runnable interface: a person or an app runs it in
 *              a conversation;
 *   scheduled  `automation_defaults` with a schedule trigger (schedule@1 or @2);
 *   triggered  `automation_defaults` with any other trigger: mail, a feed, a
 *              webhook, or Run now (a manual trigger is an automation with no
 *              interface, created by the New flow automation path and run from
 *              Observer or the Assistant, never from a chat);
 *   other      neither: parts of other flows, and flows nothing starts yet.
 *
 * Automation defaults win over an interface (the editor header's badge says
 * "Automation · …" for such a flow, flowNature in automationChoice.ts).
 */
import type { AutomationTriggerDefaults, VisualFlow } from '../types/flow';
import { choiceHelp, connectionKind, triggerSentence, type AutomationWords } from './automationChoice';
import { isExecutableFlow } from './flowFamilies';

export type FlowKind = 'chat' | 'scheduled' | 'triggered' | 'other';

/** Display order: the three ways a flow starts, then the rest. */
export const FLOW_KINDS: readonly FlowKind[] = ['chat', 'scheduled', 'triggered', 'other'];

export interface FlowKindWords {
  /** Filter pill, group heading and detail-pane kind word. */
  label: string;
  /** One line under the group heading. */
  about: string;
  /** The list when the filter has no flow. */
  empty: string;
}

export const FLOW_KIND_WORDS: Record<FlowKind, FlowKindWords> = {
  chat: {
    label: 'Chat',
    about: 'A person or an app runs them in a conversation.',
    empty: 'No chat flows yet. Press New flow and choose “A person, in a chat”.',
  },
  scheduled: {
    label: 'Scheduled',
    about: 'They run by themselves, on a clock.',
    empty: 'No scheduled flows yet. Press New flow and choose “On a schedule”.',
  },
  triggered: {
    label: 'Triggered',
    about: 'They run by themselves when something arrives, or when someone presses Run now.',
    empty: 'No triggered flows yet. Press New flow and choose what starts it.',
  },
  other: {
    label: 'Other',
    about: 'Nothing starts these by themselves: parts of other flows, and flows you run from the editor.',
    empty: 'No other flows: every flow here has something that starts it.',
  },
};

function isScheduleTrigger(trigger: AutomationTriggerDefaults | undefined): boolean {
  return Boolean(trigger && trigger.source_id === 'schedule');
}

/** The kind of a flow (see the module comment). */
export function flowKind(flow: Pick<VisualFlow, 'interfaces' | 'automation_defaults'>): FlowKind {
  if (flow.automation_defaults) return isScheduleTrigger(flow.automation_defaults.trigger) ? 'scheduled' : 'triggered';
  if (isExecutableFlow(flow)) return 'chat';
  return 'other';
}

export type FlowKindCounts = Record<FlowKind, number>;

/** How many flows of each kind (every flow counts once, subflows included). */
export function flowKindCounts(flows: readonly Pick<VisualFlow, 'interfaces' | 'automation_defaults'>[]): FlowKindCounts {
  const counts: FlowKindCounts = { chat: 0, scheduled: 0, triggered: 0, other: 0 };
  for (const flow of flows) counts[flowKind(flow)] += 1;
  return counts;
}

/** "147 flows: 32 chat, 2 scheduled, 1 triggered and 112 other" (kinds with none are left out). */
export function libraryCountsSentence(total: number, counts: FlowKindCounts): string {
  const head = `${total} flow${total === 1 ? '' : 's'}`;
  const parts = FLOW_KINDS.filter((kind) => counts[kind] > 0).map((kind) => `${counts[kind]} ${FLOW_KIND_WORDS[kind].label.toLowerCase()}`);
  if (parts.length === 0) return head;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${head}: ${list}`;
}

/** "deep-research", "a and b", "a and 3 others". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

/**
 * What starts it, in words, for the row and the detail pane: "Runs when you
 * ask", the schedule or trigger sentence, "Runs inside deep-research",
 * "Nothing starts it yet".
 */
export function flowStartSentence(
  flow: Pick<VisualFlow, 'interfaces' | 'automation_defaults'>,
  words: AutomationWords = {},
  usedBy: readonly string[] = []
): string {
  const kind = flowKind(flow);
  if ((kind === 'scheduled' || kind === 'triggered') && flow.automation_defaults) {
    return triggerSentence(flow.automation_defaults.trigger, words);
  }
  if (kind === 'chat') return 'Runs when you ask';
  return usedBy.length > 0 ? `Runs inside ${nameList(usedBy)}` : 'Nothing starts it yet';
}

/** One line of plain help under the start sentence in the detail pane. */
export function flowStartHelp(flow: Pick<VisualFlow, 'interfaces' | 'automation_defaults'>, usedBy: readonly string[] = []): string {
  const kind = flowKind(flow);
  const trigger = flow.automation_defaults?.trigger;
  if (kind === 'chat') return choiceHelp({ kind: 'chat' });
  if (kind === 'scheduled') return choiceHelp({ kind: 'schedule' });
  if (kind === 'triggered' && trigger) {
    if (trigger.source_id === 'manual') return choiceHelp({ kind: 'manual' });
    if (trigger.source_id.startsWith('email')) return choiceHelp({ kind: 'mail' });
    if (connectionKind(trigger.source_id) !== 'other' || trigger.connection_id) return choiceHelp({ kind: 'connection', sourceId: trigger.source_id });
    return 'Runs every time its trigger fires.';
  }
  return usedBy.length > 0
    ? 'It runs as a step of the flows that use it; it does not start by itself.'
    : 'Run it from the editor, or declare an interface so a person or an app can run it.';
}
