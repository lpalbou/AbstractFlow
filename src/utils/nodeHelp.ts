/**
 * Node help (QA 2026-10-28): what a node is for, each of its inputs and
 * outputs, and examples, shown in a dialog (components/NodeHelpModal.tsx),
 * never as prose on the canvas. Every node has a help: its template's
 * description and pin descriptions; the nodes people trip on have a written
 * one (HELP below). Pure: node data in, words out.
 */
import type { FlowNodeData, Pin, PinType } from '../types/flow';
import { getNodeTemplate } from '../types/nodes';
import { isNotifyMeNode } from './afterTheRun';
import { COMPARE_OPS } from './operatorNodes';
import { NOTIFY_COMPAT_PIN_ID } from './triggerPins';

export interface PinHelp {
  id: string;
  label: string;
  type: PinType;
  text: string;
}

export interface NodeHelp {
  title: string;
  /** What the node is for, in one or two sentences. */
  purpose: string;
  /** How it behaves: rules worth knowing before using it. */
  details: string[];
  inputs: PinHelp[];
  outputs: PinHelp[];
  examples: string[];
}

type Written = {
  purpose: string;
  details?: string[];
  pins?: Record<string, string>;
  examples?: string[];
};

const COMPARE_WORDS = COMPARE_OPS.map((o) => `${o.value} ${o.words}`).join(', ');

const HELP: Record<string, Written> = {
  on_flow_end: {
    purpose:
      'Ends the run here and records its outcome. It reaches nobody: to be notified, put a Notify me step before it.',
    details: [
      'A flow can have several On Flow End nodes, one per way the run can end (for example one after Notify me, one when there is nothing to report). The run ends at the first one it reaches.',
      'Each input becomes a field of the run’s result. In an automation, the result is what After the run and the run history show.',
    ],
    pins: {
      response: 'What the person sees as the run’s answer: a sentence such as “Sent a notification of 2 important emails”.',
      success: 'The run’s own verdict. False marks the run failed: an automation retries it, then an alert says so.',
      note: 'A short line of what happened and why, kept with the run and shown in After the run. It reaches nobody.',
      [NOTIFY_COMPAT_PIN_ID]:
        'Older flows only (saved before Notify me existed): an object {title, body}. A title here notifies you on all your channels after the run; empty, nothing rings. When nothing is connected to it and it has no value, the pin is removed from the node. To be notified, use Notify me before On Flow End instead: it says what it sends and where, and After the run lists its deliveries.',
    },
    examples: [
      'Email triage: Has Important Emails? → true → Notify me → On Flow End (response “Sent a notification of important emails”); false → On Flow End (response “No important emails”).',
    ],
  },
  notify_me: {
    purpose: 'Notifies you: the one node that reaches a person. On Flow End only records the outcome.',
    details: [
      'Where: all your channels (the tray, the watch or the phone, email when a mailbox is connected), or the ones you choose in Properties. The console lists every alert.',
      'The title is required: an empty title fails the step (it never sends a blank notification).',
      'After the run lists the alert and each delivery: channel, route, device and time.',
    ],
    pins: {
      title: 'What the notification says, in a few words (required, at most 120 characters).',
      body: 'More text under the title (optional): for example the subjects of the emails, one per line (Join with New line). Join writes objects as raw text, so join their subjects, not the emails.',
      data: 'Any extra JSON kept with the alert, for applications (optional).',
      result: 'The published alert: event_id, sequence, alerted.',
      success: 'True when the alert was published.',
    },
    examples: [
      'Title “Emails requiring your attention”; body = Join(the important emails’ subjects, delimiter New line).',
    ],
  },
  compare: {
    purpose: 'Compares a with b and gives true or false, for an If or a While.',
    details: [
      `Operators: ${COMPARE_WORDS}.`,
      'With no operator chosen it compares with == (equal to). The folded node shows the operator it uses.',
      'Numbers compare as numbers; text compares alphabetically. Values that cannot be ordered (a number and a text) give false for <, <=, > and >=.',
    ],
    pins: {
      a: 'The left value.',
      op: 'The operator. Not set: ==.',
      b: 'The right value.',
      result: 'True when “a op b” holds.',
    },
    examples: [
      'Has items: Array Length → a, op >, b 0 gives true when the list has at least one item.',
      'Equal: a = the status, op ==, b “done”.',
    ],
  },
  is_empty_string: {
    purpose: 'True when the text is empty. Nothing connected counts as empty.',
    pins: { text: 'The text to check.', result: 'True when the text is empty.' },
    examples: ['If (Is Empty(summary)) → true → On Flow End (response “Nothing to summarize”).'],
  },
  join: {
    purpose: 'Joins the items of a list into one text, with a delimiter between them.',
    details: [
      'The delimiter defaults to a comma. Choose New line to put each item on its own line, or Blank line for a gap between them.',
      'Typed delimiters understand \\n (new line) and \\t (tab).',
      'Each item is written as text; nothing connected gives an empty text.',
    ],
    pins: {
      items: 'The list to join.',
      delimiter: 'What goes between two items: a comma, a new line, a space, or any text you type.',
      result: 'The joined text.',
    },
    examples: ['Subjects one per line: items = the subjects, delimiter New line → “Invoice due\\nMeeting moved”.'],
  },
  add_to_list: {
    purpose: 'Adds to a list variable in one step: item adds one element, items adds each element of a list.',
    details: [
      'A variable not set yet starts as an empty list. A variable that holds something other than a list fails the step, naming it.',
      'Read the list later with Get Variable (same name); the new list is also this node’s list output.',
    ],
    pins: {
      name: 'The list variable to add to.',
      item: 'Added as one element (whatever it is, a list too).',
      items: 'Each element of this list is added.',
      list: 'The list after the addition.',
    },
    examples: ['In a ForEach over emails: If important → Add to List (name “triage”, item = the email).'],
  },
  get_var: {
    purpose: 'Reads a run variable by name, at the moment the node that uses it runs.',
    details: ['A dotted path reads inside an object (state.provider). When the variable or path is missing, default is returned.'],
    pins: {
      name: 'The variable (or dotted path) to read.',
      default: 'Returned when the variable or path is missing (not set: nothing).',
      value: 'The variable’s value.',
    },
    examples: ['After a ForEach: Get Variable “triage” → Array Length gives how many emails were added.'],
  },
  array_length: {
    purpose: 'How many items a list has. Nothing connected counts as 0.',
    pins: { array: 'The list.', result: 'Its number of items.' },
    examples: ['Array Length → Compare (op >, b 0) → If: true when the list has items.'],
  },
  if: {
    purpose: 'Takes the true or the false path, by its condition.',
    details: ['The condition is read when the If runs: a value computed before it (a list filled by a loop) is the current one.'],
    pins: { condition: 'True or false (a Compare, an Is Empty, a boolean field).' },
  },
};

const TYPE_WORDS: Partial<Record<PinType, string>> = {
  string: 'A text.',
  number: 'A number.',
  boolean: 'True or false.',
  object: 'An object (JSON).',
  array: 'A list.',
  any: 'Any value.',
};

function helpKey(data: Pick<FlowNodeData, 'nodeType' | 'inputs'>): string {
  return isNotifyMeNode(data) ? 'notify_me' : data.nodeType;
}

function pinHelps(pins: ReadonlyArray<Pin>, templatePins: ReadonlyArray<Pin>, written: Record<string, string> | undefined): PinHelp[] {
  return pins
    .filter((p) => p.type !== 'execution')
    .map((p) => {
      const fromTemplate = templatePins.find((t) => t.id === p.id)?.description;
      const text = written?.[p.id] || p.description || fromTemplate || TYPE_WORDS[p.type] || 'A value.';
      return { id: p.id, label: p.label || p.id, type: p.type, text };
    });
}

/** The help of a node, from its current pins (an older flow's notify included). */
export function nodeHelp(data: Pick<FlowNodeData, 'nodeType' | 'label' | 'inputs' | 'outputs'>): NodeHelp {
  const template = getNodeTemplate(data.nodeType);
  const key = helpKey(data);
  const written = HELP[key];
  const title = key === 'notify_me' ? 'Notify me' : template?.label || data.label || data.nodeType;
  return {
    title,
    purpose: written?.purpose || template?.description || 'No description yet.',
    details: written?.details || [],
    inputs: pinHelps(data.inputs || [], template?.inputs || [], written?.pins),
    outputs: pinHelps(data.outputs || [], template?.outputs || [], written?.pins),
    examples: written?.examples || [],
  };
}

/** Does this node have a written help (beyond its template's words)? */
export function hasWrittenHelp(data: Pick<FlowNodeData, 'nodeType' | 'inputs'>): boolean {
  return Object.prototype.hasOwnProperty.call(HELP, helpKey(data));
}
