// Framework ADR-0041 "No hidden effects after a flow" in Flow:
// - On Flow End records the outcome (response, success, note); new triggered
//   flows never get the notify pin; an older flow's notify pin says in words
//   what it does; the canvas note points at Notify me;
// - Notify me says on the node whom it reaches and how;
// - the run view's "After the run" section says what arrived, the note, the
//   alert or why nothing rang, and each delivery (spinner first, ADR-0039).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from 'reactflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeData, getAllNodeTemplates, getNodeTemplate } from '../../types/nodes';
import type { FlowNodeData } from '../../types/flow';
import { BaseNode } from '../nodes/BaseNode';
import { useFlowStore } from '../../hooks/useFlow';
import { AUTOMATION_CANVAS_NOTE, AUTOMATION_END_PINS, endPinHelp, withTriggerPins } from '../../utils/triggerPins';
import {
  NOTIFY_ME_CHANNEL_CHOICES,
  NOTIFY_ME_REACHES,
  askedSentence,
  deliverySentence,
  isNotifyMeNode,
  notifyChoiceOn,
  notifyMeChannels,
  notifyMeReaches,
  toggleNotifyChoice,
  quietSentence,
  shouldReadAgain,
  showsAfterTheRun,
  type RunAfter,
} from '../../utils/afterTheRun';
import { AfterTheRunView } from './AfterTheRun';
import { PublishNodeSection } from './MailNodeSection';
import { toVisualFlow } from '../../utils/serialization';

function renderNode(data: FlowNodeData): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const props = { id: 'n1', data, selected: false, type: 'custom', zIndex: 0, isConnectable: true, xPos: 0, yPos: 0, dragging: false } as any;
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ReactFlowProvider, null, createElement(BaseNode, props))));
}

const notifyMe = () => {
  const t = getAllNodeTemplates().find((x) => x.type === 'publish_event' && x.label === 'Notify me');
  if (!t) throw new Error('Notify me template missing');
  return createNodeData(t);
};

const GMAIL: RunAfter = {
  run_id: 'ce98246c',
  trigger: {
    automation_id: 'da8bc2b9',
    automation_title: 'Gmail watch',
    source: 'email.received',
    text: 'When mail arrives in lpalbou@gmail.com',
    connection: 'lpalbou@gmail.com',
    arrived: { count: 4, noun: 'new emails', line: '“O” from codex@athena.ovh and 3 more' },
  },
  run: { status: 'completed', started: '2026-10-26T00:16:00Z', ended: '2026-10-26T00:16:09Z', note: '4 mails judged; 4 suspicious.' },
  attention: { record_key: 'k15', kind: 'notify', title: 'Suspicious credential emails received', raised_at: '2026-10-26T00:16:23Z', from: 'flow_end' },
  deliveries: [
    { record_key: 'k15', channel: 'tray', via: 'stream', time: '2026-10-26T00:16:25Z', state: 'sent', device: 'a5e2' },
    { record_key: 'k15', channel: 'watch', via: 'push', device: '506b', device_name: 'Laurent’s Watch', time: '2026-10-26T00:16:26Z', state: 'sent' },
    { record_key: 'k15', channel: 'email', via: 'outbox', time: '2026-10-26T00:16:40Z', state: 'failed', reason: 'The mail server refused the password.' },
  ],
};

// Server rendering reads a zustand store's initial state; read the live one (collapsedPins.test.tsx).
vi.mock('../../hooks/useFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useFlow')>();
  const live = ((selector?: (s: unknown) => unknown) => (selector ? selector(actual.useFlowStore.getState()) : actual.useFlowStore.getState())) as unknown as typeof actual.useFlowStore;
  Object.assign(live, actual.useFlowStore);
  return { ...actual, useFlowStore: live };
});

afterEach(() => {
  useFlowStore.setState({ flowAutomationDefaults: null });
});

describe('On Flow End records the outcome (ADR-0041)', () => {
  it('a new triggered flow: On Flow Start → On Flow End with response, success, note — never notify', () => {
    useFlowStore.getState().createFlow({
      name: 'Judge what arrived',
      description: '',
      interfaces: [],
      automation: { schema_version: 1, trigger: { source_id: 'email.received', source_version: 1, config: {} } } as never,
    });
    const st = useFlowStore.getState();
    expect(st.nodes.map((n) => n.data.nodeType)).toEqual(['on_flow_start', 'on_flow_end']);
    const end = st.nodes[1];
    expect(end.data.inputs.map((p) => p.id)).toEqual(['exec-in', 'response', 'success', 'note']);
    expect(end.data.inputs.some((p) => p.id === 'notify')).toBe(false);
    expect(st.edges).toEqual([]);
    expect(st.canvasNote).toBe(AUTOMATION_CANVAS_NOTE);
    expect(AUTOMATION_CANVAS_NOTE).toContain('Add Notify me to reach yourself');
  });

  it('an older flow keeps its notify pin (the compatibility path) and gains the record pins', () => {
    const nodes = [
      {
        id: 'e',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { nodeType: 'on_flow_end', label: '', inputs: [{ id: 'exec-in', label: '', type: 'execution' }, { id: 'response', label: 'response', type: 'string' }, { id: 'notify', label: 'notify', type: 'object' }], outputs: [] },
      },
    ] as never;
    const next = withTriggerPins(nodes, 'email');
    expect((next[0] as any).data.inputs.map((p: { id: string }) => p.id)).toEqual(['exec-in', 'response', 'notify', 'success', 'note']);
    expect(AUTOMATION_END_PINS.map((p) => p.id)).toEqual(['response', 'success', 'note']);
  });

  it('the notify pin of a triggered flow says in words what it does, on the node', () => {
    expect(endPinHelp('notify')).toBe(
      'Older flows: a title here notifies you on every channel you have: tray, watch and phone, email when on. Empty: nothing rings. New flows use Notify me.'
    );
    const template = getNodeTemplate('on_flow_end')!;
    const data = createNodeData(template);
    data.inputs = [...data.inputs, { id: 'response', label: 'response', type: 'string' }, { id: 'notify', label: 'notify', type: 'object' }, { id: 'note', label: 'note', type: 'string' }];
    // Not a triggered flow: no help line (the pin means nothing there).
    expect(renderNode(data)).not.toContain('data-pin-help');
    useFlowStore.setState({ flowAutomationDefaults: { schema_version: 1, trigger: { source_id: 'email.received', source_version: 1, config: {} } } as never });
    const html = renderNode(data);
    expect(html).toContain('data-pin-help="notify"');
    expect(html).toContain('Older flows: a title here notifies you on every channel you have');
    expect(html).toContain('data-pin-help="note"');
    expect(html).not.toContain('data-pin-help="response"');
  });
});

describe('Notify me says whom it reaches and how', () => {
  it('on the node, in words; Publish to channel does not carry the line', () => {
    const data = notifyMe();
    expect(isNotifyMeNode(data)).toBe(true);
    const html = renderNode(data);
    expect(html).toContain('data-field="notify-reaches"');
    expect(html).toContain(NOTIFY_ME_REACHES);
    expect(NOTIFY_ME_REACHES).toBe('You: all my channels');
    expect(renderNode({ ...data, effectConfig: { channels: ['phone', 'watch'] } })).toContain('You: watch and phone');
    expect(notifyMeReaches(['tray', 'email'])).toBe('You: tray · email');
    expect(notifyMeReaches(['watch'])).toBe('You: watch');
    const publish = createNodeData(getNodeTemplate('publish_event')!);
    expect(isNotifyMeNode(publish)).toBe(false);
    expect(renderNode(publish)).not.toContain('data-field="notify-reaches"');
  });

  it('Where: chips, several allowed; All my channels clears the choice; none left = all again', () => {
    expect(NOTIFY_ME_CHANNEL_CHOICES.map((c) => c.label)).toEqual(['All my channels', 'Tray', 'Watch and phone', 'Email']);
    let channels = toggleNotifyChoice(null, 'push');
    expect(channels).toEqual(['watch', 'phone']);
    channels = toggleNotifyChoice(channels, 'email');
    expect(channels).toEqual(['watch', 'phone', 'email']);
    expect(NOTIFY_ME_CHANNEL_CHOICES.filter((c) => notifyChoiceOn(c, channels)).map((c) => c.value)).toEqual(['push', 'email']);
    channels = toggleNotifyChoice(channels, 'push');
    expect(channels).toEqual(['email']);
    expect(toggleNotifyChoice(channels, 'email')).toBeNull();
    expect(toggleNotifyChoice(['tray'], 'all')).toBeNull();
    // An older node (no effectConfig, or junk in it) reads as every channel.
    expect(notifyMeChannels({})).toBeNull();
    expect(notifyMeChannels({ effectConfig: { channels: ['fax'] } })).toBeNull();
  });

  it('Properties: the chips are live and save effectConfig.channels', () => {
    const data = { ...notifyMe(), effectConfig: { channels: ['tray'] } } as FlowNodeData;
    const saved: unknown[] = [];
    const html = renderToStaticMarkup(
      createElement(PublishNodeSection, { nodeId: 'n1', data, onPinDefaults: () => {}, onEffectConfig: (c: unknown) => saved.push(c) })
    );
    expect(html).toContain('data-field="notify-where"');
    expect(html).not.toContain('(not yet)');
    expect(html).not.toMatch(/<button[^>]*disabled/);
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1);
    expect(html).toContain('You: tray.');
  });

  it('the saved flow carries channels in the node’s effectConfig (the compiled JSON the gateway runs)', () => {
    const data = { ...notifyMe(), effectConfig: { channels: ['watch', 'phone'] } } as FlowNodeData;
    const flow = JSON.parse(JSON.stringify(toVisualFlow('f1', 'Judge', [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data }], [])));
    expect(flow.nodes[0].type).toBe('publish_event');
    expect(flow.nodes[0].data.effectConfig.channels).toEqual(['watch', 'phone']);
    expect(flow.nodes[0].data.pinDefaults).toMatchObject({ channel: 'me', alert: true });
    const older = JSON.parse(JSON.stringify(toVisualFlow('f1', 'Judge', [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: notifyMe() }], [])));
    expect(older.nodes[0].data.effectConfig?.channels).toBeUndefined();
  });
});

describe('After the run', () => {
  it('a spinner until the read answered, then the reason and Retry if every try failed (ADR-0039)', () => {
    const loading = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'loading' } }));
    expect(loading).toContain('After the run');
    expect(loading).toContain('class="read-loading__spinner"');
    expect(loading).not.toContain('Nothing to notify');
    const failed = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'failed', error: 'HTTP 503', onRetry: () => {} } }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('HTTP 503');
    expect(failed).toContain('>Retry</button>');
  });

  it('what arrived, when it ran, the note, the alert and each delivery with channel, route and state', () => {
    const html = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'ready', after: GMAIL } }));
    expect(html).toContain('4 new emails: “O” from codex@athena.ovh and 3 more');
    expect(html).toContain('When mail arrives in lpalbou@gmail.com');
    expect(html).toContain('4 mails judged; 4 suspicious.');
    expect(html).toContain('“Suspicious credential emails received”');
    expect(html).toContain('On Flow End’s notify (older flows)');
    expect(html).toContain('Tray · shown by the app · sent');
    expect(html).toContain('Watch (Laurent’s Watch) · push notification · sent');
    expect(html).toContain('Email · email · not delivered: The mail server refused the password.');
    expect(html).not.toContain('Nothing to notify');
  });

  it('a Notify me alert says what it asked for beside what was delivered', () => {
    const after: RunAfter = {
      run_id: 'r1',
      trigger: null,
      run: { status: 'completed', started: 'a', ended: 'b' },
      attention: { record_key: 'publish:r1:n7', kind: 'notify', title: 'Judged', from: 'notify_me', recipient: 'me', asked: ['watch', 'phone'] },
      deliveries: [{ record_key: 'publish:r1:n7', channel: 'watch', via: 'push', state: 'sent', time: 'x' }],
    };
    const html = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'ready', after } }));
    expect(html).toContain('data-field="asked"');
    expect(html).toContain('asked: watch, phone');
    expect(html).toContain('Watch · push notification · sent');
    expect(askedSentence({ record_key: 'k', asked: 'all' })).toBe('asked: all my channels');
    expect(askedSentence({ record_key: 'k', from: 'flow_end' })).toBeNull();
  });

  it('nothing rang: the reason in words', () => {
    const quiet: RunAfter = { ...GMAIL, attention: null, alerts: [], deliveries: [], quiet_reason: 'empty title' };
    const html = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'ready', after: quiet } }));
    expect(html).toContain('Nothing to notify: the title was empty.');
    expect(quietSentence('no notify')).toBe('Nothing to notify: this flow has no Notify me step.');
  });

  it('an approval on a sub-run: said as what it is, open or answered, with its deliveries', () => {
    const after: RunAfter = {
      run_id: '7abde419',
      trigger: null,
      run: { status: 'completed', started: 'a', ended: 'b' },
      attention: { record_key: 'f046', kind: 'approval', title: null, from: 'wait', open: true, run_id: '4a02', prompt_ref: '/api/gateway/runs/4a02' },
      deliveries: [{ record_key: 'f046', channel: 'phone', via: 'stream', state: 'sent', time: 'x' }],
    };
    const html = renderToStaticMarkup(createElement(AfterTheRunView, { state: { status: 'ready', after } }));
    expect(html).toContain('An approval for you');
    expect(html).toContain('waiting for your answer');
    expect(html).toContain('Phone · shown by the app · sent');
    expect(html).not.toContain('What arrived');
  });

  it('reads again while deliveries are still being recorded, a bounded number of times', () => {
    expect(shouldReadAgain({ ...GMAIL, attention: null, deliveries: [], quiet_reason: 'not recorded yet' }, 1)).toBe(true);
    expect(shouldReadAgain({ ...GMAIL, deliveries: [] }, 1)).toBe(true);
    expect(shouldReadAgain(GMAIL, 1)).toBe(false);
    expect(shouldReadAgain({ ...GMAIL, attention: null, deliveries: [], quiet_reason: 'empty title' }, 1)).toBe(false);
    expect(shouldReadAgain({ ...GMAIL, deliveries: [] }, 99)).toBe(false);
    expect(deliverySentence({ channel: 'console', via: 'stream', state: 'sent' })).toBe('Console · listed · sent');
  });

  it('shown for a triggered flow and for any run an automation started', () => {
    expect(showsAfterTheRun({ triggered: true })).toBe(true);
    expect(showsAfterTheRun({ triggered: false, automationId: 'a1' })).toBe(true);
    expect(showsAfterTheRun({ triggered: false, originKind: 'trigger' })).toBe(true);
    expect(showsAfterTheRun({ triggered: false, originKind: 'person' })).toBe(false);
  });
});
